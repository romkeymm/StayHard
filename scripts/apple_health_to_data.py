#!/usr/bin/env python3
"""Rebuild the fitness snapshot in data.json from an Apple Health export.

Usage:
    python3 scripts/apple_health_to_data.py path/to/export.zip   (or export.xml)

Reads the export (Health app > profile > Export All Health Data) and updates
the "fitness" and "training" blocks of data.json. Race data is left alone.
The fitness page, homepage and iPhone widget all read these numbers.
"""
import datetime as dt
import json
import math
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

DATA_JSON = Path(__file__).resolve().parent.parent / "data.json"

QTY = {
    "HKQuantityTypeIdentifierVO2Max": "vo2",
    "HKQuantityTypeIdentifierRestingHeartRate": "rhr",
    "HKQuantityTypeIdentifierHeartRateVariabilitySDNN": "hrv",
    "HKQuantityTypeIdentifierHeartRateRecoveryOneMinute": "hrr",
}
RUN = "HKWorkoutActivityTypeRunning"
DIST = "HKQuantityTypeIdentifierDistanceWalkingRunning"


def to_miles(value, unit):
    v = float(value)
    return {"mi": v, "km": v * 0.621371, "m": v / 1609.344}.get(unit, v)


def to_minutes(value, unit):
    v = float(value)
    return {"min": v, "s": v / 60, "hr": v * 60}.get(unit, v)


def day(s):
    return dt.date.fromisoformat(s[:10])


def open_xml(path):
    path = Path(path)
    if path.suffix == ".zip":
        z = zipfile.ZipFile(path)
        name = next(n for n in z.namelist() if n.endswith("export.xml") and "cda" not in n)
        return z.open(name)
    return open(path, "rb")


def parse(path):
    samples = defaultdict(list)          # key -> [(date, value)]
    runs = []                            # (date, miles)
    minutes_by_day = defaultdict(float)  # all workouts, for training load
    for _, el in ET.iterparse(open_xml(path), events=("end",)):
        if el.tag == "Record":
            key = QTY.get(el.get("type"))
            if key:
                samples[key].append((day(el.get("startDate")), float(el.get("value"))))
        elif el.tag == "Workout":
            d = day(el.get("startDate"))
            minutes_by_day[d] += to_minutes(el.get("duration", 0), el.get("durationUnit", "min"))
            if el.get("workoutActivityType") == RUN:
                miles = 0.0
                for st in el.iter("WorkoutStatistics"):
                    if st.get("type") == DIST and st.get("sum"):
                        miles = to_miles(st.get("sum"), st.get("unit"))
                if not miles and el.get("totalDistance"):
                    miles = to_miles(el.get("totalDistance"), el.get("totalDistanceUnit", "mi"))
                runs.append((d, miles))
            el.clear()
        elif el.tag != "WorkoutStatistics":
            el.clear()
    return samples, runs, minutes_by_day


def avg(vals):
    vals = list(vals)
    return sum(vals) / len(vals) if vals else None


def window(pts, start, end):
    return [v for d, v in pts if start <= d <= end]


def training_load(minutes_by_day, end):
    """CTL (42-day) and ATL (7-day) exponentially weighted workout minutes."""
    if not minutes_by_day:
        return 0.0, 0.0
    d, ctl, atl = min(minutes_by_day), 0.0, 0.0
    kc, ka = 1 - math.exp(-1 / 42), 1 - math.exp(-1 / 7)
    while d <= end:
        load = minutes_by_day.get(d, 0.0)
        ctl += (load - ctl) * kc
        atl += (load - atl) * ka
        d += dt.timedelta(days=1)
    return ctl, atl


def readiness(hrv, hrv_base, rhr, rhr_base, tsb):
    """Same scoring as the fitness page: HRV 40%, resting HR 30%, form 30%."""
    clamp = lambda x: min(100, max(0, x))
    parts = [(clamp(50 + tsb * 2), 0.3)]
    if hrv and hrv_base:
        parts.append((clamp(50 + (hrv - hrv_base) / hrv_base * 100), 0.4))
    if rhr and rhr_base:
        parts.append((clamp(50 + (rhr_base - rhr) / rhr_base * 100), 0.3))
    total = sum(w for _, w in parts)
    return round(sum(s * w for s, w in parts) / total)


def main(path):
    samples, runs, minutes_by_day = parse(path)
    all_dates = [d for pts in samples.values() for d, _ in pts] + [d for d, _ in runs]
    if not all_dates:
        sys.exit("No Health records found in that export.")
    end = max(all_dates)
    month_start = end.replace(day=1)
    last7 = end - dt.timedelta(days=6)
    base_start, base_end = end - dt.timedelta(days=67), end - dt.timedelta(days=7)
    year = end.year

    def month_avg(key):
        v = avg(window(samples[key], month_start, end))
        return round(v, 1) if v is not None else None

    hrv7, rhr7 = avg(window(samples["hrv"], last7, end)), avg(window(samples["rhr"], last7, end))
    hrv_base = avg(window(samples["hrv"], base_start, base_end))
    rhr_base = avg(window(samples["rhr"], base_start, base_end))
    ctl, atl = training_load(minutes_by_day, end)
    tsb = ctl - atl
    score = readiness(hrv7, hrv_base, rhr7, rhr_base, tsb)
    label = "Optimal" if score >= 80 else "Good" if score >= 65 else "Moderate" if score >= 50 else "Rest Day"
    color = {"Optimal": "green", "Good": "yellow", "Moderate": "orange"}.get(label, "red")

    monthly = [0.0] * 12
    for d, mi in runs:
        if d.year == year:
            monthly[d.month - 1] += mi
    year_runs = [r for r in runs if r[0].year == year]

    # Last complete month (the export's own month counts only if it ends on the month's last day)
    by_month = defaultdict(float)
    for d, mi in runs:
        by_month[(d.year, d.month)] += mi
    next_day = end + dt.timedelta(days=1)
    lm = (end.year, end.month) if next_day.month != end.month else None
    if lm is None or next_day.day != 1:
        first = end.replace(day=1) - dt.timedelta(days=1)
        lm = (first.year, first.month)
    pm_date = dt.date(lm[0], lm[1], 1) - dt.timedelta(days=1)
    pm = (pm_date.year, pm_date.month)
    lm_mi, pm_mi = by_month.get(lm, 0.0), by_month.get(pm, 0.0)
    last_month = {
        "label": dt.date(lm[0], lm[1], 1).strftime("%b"),
        "year": lm[0],
        "miles": round(lm_mi, 1),
        "prev_label": dt.date(pm[0], pm[1], 1).strftime("%b"),
        "prev_miles": round(pm_mi, 1),
        "change_pct": round((lm_mi - pm_mi) / pm_mi * 100) if pm_mi else None,
    }
    vo2_all = [v for _, v in samples["vo2"]]

    data = json.loads(DATA_JSON.read_text())
    data["updated"] = dt.date.today().isoformat()
    data["fitness"] = {
        "as_of": end.isoformat(),
        "vo2_max": month_avg("vo2"),
        "vo2_max_peak": round(max(vo2_all), 1) if vo2_all else None,
        "resting_hr": round(month_avg("rhr")) if month_avg("rhr") else None,
        "hrv": round(month_avg("hrv")) if month_avg("hrv") else None,
        "hr_recovery": round(month_avg("hrr")) if month_avg("hrr") else None,
        "readiness_score": score,
        "readiness_label": label,
        "readiness_color": color,
        "readiness_inputs": {
            "hrv_7d": round(hrv7) if hrv7 else None,
            "rhr_7d": round(rhr7) if rhr7 else None,
            "tsb": round(tsb, 1),
            "atl": round(atl, 1),
        },
    }
    data["training"] = {
        "year": year,
        "runs_ytd": len(year_runs),
        "miles_ytd": round(sum(mi for _, mi in year_runs), 1),
        f"miles_{year}": round(sum(mi for _, mi in year_runs), 1),  # older widget copies read this key
        "monthly_miles": [round(m, 2) for m in monthly],
        "last_month": last_month,
        "ctl": round(ctl, 1),
        "atl": round(atl, 1),
        "tsb": round(tsb, 1),
    }
    upcoming = [r for r in data.get("races", []) if r["date"] >= dt.date.today().isoformat()]
    if upcoming:
        r = upcoming[0]
        data["next_race"] = {"name": r["name"], "short_name": r["short"], "date": r["date"], "distance": r["distance"]}
    DATA_JSON.write_text(json.dumps(data, indent=2) + "\n")
    f, t = data["fitness"], data["training"]
    print(f"Data through {end}: VO2 {f['vo2_max']} (peak {f['vo2_max_peak']}), RHR {f['resting_hr']}, "
          f"HRV {f['hrv']}, HRR {f['hr_recovery']}, readiness {score} {label}; "
          f"{t['runs_ytd']} runs / {t['miles_ytd']} mi in {year}")
    print("Monthly miles:", t["monthly_miles"])


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
