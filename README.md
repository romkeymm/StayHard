# Romkey Dashboard
Romkey Dashboard

## Monthly Apple Health update

1. On iPhone: Health app > profile picture > Export All Health Data, then save `export.zip`.
2. Run `python3 scripts/apple_health_to_data.py path/to/export.zip` from the repo root (or give the zip to Claude and ask for the monthly update).
3. Commit and push `data.json`.

`data.json` is the single source for the current fitness snapshot: VO2 max (latest month average and all-time peak), resting HR, HRV, HR recovery, readiness, and the current year's runs, miles and monthly mileage. The fitness page overview, readiness panel and current-year mileage, the homepage stats and the Scriptable iPhone widget all read it, so one push updates all of them. Race dates live in the `races` list in `data.json`, `fitness.html` and `index.html`.
