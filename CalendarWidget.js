// ─────────────────────────────────────────────────────────────
//  BIG CALENDAR widget for Scriptable
//
//  Reads the same data as romkeymm.github.io/StayHard/calendar.html
//  (Supabase table big_calendar), so it always matches the calendar.
//
//  SETUP
//  1. In Scriptable, tap + and paste this whole script. Name it "Calendar".
//  2. Tap ▶ to preview.
//  3. Long-press the home screen → + → Scriptable → pick Small, Medium or Large
//     → long-press the new widget → Edit Widget → Script: Calendar.
//  Tapping the widget opens the full calendar.
//
//  Small:  today's items (kids, Dad holiday, events) and your training week
//  Medium: today, plus the next 4 days, with your training week
//  Large:  training card with season ribbon, this week, today and tomorrow
// ─────────────────────────────────────────────────────────────

const SB_URL = "https://urqcldfagszngbxtdmck.supabase.co/rest/v1/big_calendar"
const SB_KEY = "sb_publishable_2_QTJRjxaZ7QcUdfJB03FA_2ljD_bSo"
const CAL_URL = "https://romkeymm.github.io/StayHard/calendar.html"

// Same colors as the calendar
const CAT = ["#8cc8e8", "#f2e173", "#f4a3a3", "#9fd8a0", "#b7a6e6", "#c4c4c4", "#f5b872", "#f0a6c8"]
const RACE = 2
const PHASE = { easy: ["#a9a9a3", "Recovery"], base: ["#6f97c4", "Base"], build: ["#d9874a", "Build"], peak: ["#c94a5c", "Peak"], taper: ["#4aa574", "Taper"] }
const KID = "#7fcbb4", DAD = "#0f766e", HOL = "#7a68b3"
const KID_ANCHOR = Date.UTC(2027, 0, 4), KID_ON = [0, 1, 4, 5, 6, 9, 10]

const dyn = (l, d) => Color.dynamic(new Color(l), new Color(d))
const C = {
  bg: dyn("#ffffff", "#111111"), tile: dyn("#f2f1ed", "#1d1d1d"), we: dyn("#e9e7e1", "#181818"),
  ink: dyn("#1a1a1a", "#f2f2f2"), soft: dyn("#8a8a86", "#8f8f8f"), faint: dyn("#b8b8b3", "#555555"),
}

// ── dates ────────────────────────────────────────────────────
const pad = n => String(n).padStart(2, "0")
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const today0 = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t }
const parseKey = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d) }
const daysBetween = (a, b) => Math.round((b - a) / 864e5)
const DOW = ["S", "M", "T", "W", "T", "F", "S"]
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

// ── rules shared with the calendar page ──────────────────────
function easter(Y) { const a = Y % 19, b = Math.floor(Y / 100), c = Y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), n = h + l - 7 * m + 114; return [Math.floor(n / 31) - 1, (n % 31) + 1] }
function holidays(Y) {
  const h = {}, p = (m, d, n) => { h[`${Y}-${pad(m + 1)}-${pad(d)}`] = n }
  const nth = (m, wd, n) => { const f = new Date(Y, m, 1).getDay(); return 1 + ((wd - f + 7) % 7) + 7 * (n - 1) }
  const last = (m, wd) => { const L = new Date(Y, m + 1, 0); return L.getDate() - ((L.getDay() - wd + 7) % 7) }
  p(0, 1, "New Year's Day"); p(0, nth(0, 1, 3), "MLK Jr. Day"); p(1, 14, "Valentine's Day"); p(1, nth(1, 1, 3), "Presidents' Day"); p(2, 17, "St. Patrick's Day")
  p(4, nth(4, 0, 2), "Mother's Day"); p(4, last(4, 1), "Memorial Day"); p(5, nth(5, 0, 3), "Father's Day"); p(6, 4, "Independence Day"); p(8, nth(8, 1, 1), "Labor Day")
  p(9, nth(9, 1, 2), "Columbus Day"); p(9, 31, "Halloween"); p(10, 11, "Veterans Day"); p(10, nth(10, 4, 4), "Thanksgiving")
  p(11, 24, "Christmas Eve"); p(11, 25, "Christmas"); p(11, 31, "New Year's Eve"); const [em, ed] = easter(Y); p(em, ed, "Easter")
  return h
}
function dadAuto(Y) {
  const odd = Y % 2 === 1, H = holidays(Y), by = {}; for (const k in H) by[H[k]] = k
  const want = [["New Year's Day", odd], ["Easter", !odd], ["Memorial Day", odd], ["Father's Day", true], ["Independence Day", !odd], ["Labor Day", odd], ["Halloween", !odd], ["Thanksgiving", odd], ["Christmas Eve", !odd], ["Christmas", odd], ["New Year's Eve", odd]]
  const out = {}; for (const [n, dad] of want) if (dad && by[n]) out[by[n]] = 1
  if (Y === 2027) for (let d = parseKey("2027-03-11"); d <= parseKey("2027-03-21"); d = addDays(d, 1)) out[keyOf(d)] = 1
  return out
}
const kidAuto = k => { const [Y, M, D] = k.split("-").map(Number); const n = Math.round((Date.UTC(Y, M - 1, D) - KID_ANCHOR) / 864e5); return KID_ON.includes(((n % 14) + 14) % 14) }

// ── data ─────────────────────────────────────────────────────
async function load(years) {
  const keys = ["settings", ...years.map(y => "year-" + y)]
  const cacheFile = FileManager.local().joinPath(FileManager.local().documentsDirectory(), "big-calendar-cache.json")
  const fm = FileManager.local()
  try {
    const r = new Request(`${SB_URL}?select=key,value&key=in.(${keys.join(",")})`)
    r.headers = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY }
    r.timeoutInterval = 10
    const rows = await r.loadJSON()
    if (!Array.isArray(rows)) throw new Error("bad response")
    fm.writeString(cacheFile, JSON.stringify(rows))
    return rows
  } catch (e) {
    return fm.fileExists(cacheFile) ? JSON.parse(fm.readString(cacheFile)) : []
  }
}

function buildModel(rows, years) {
  const st = (rows.find(r => r.key === "settings") || {}).value || {}
  const labels = st.labels || ["Travel", "No School", "Race", "Start of Semester", "Birthdays", "Busy", "PTO", "Special Event"]
  const show = { kids: st.showKids !== false, dad: st.showDad !== false, trn: st.showTrn !== false, hol: st.showHol !== false }
  const day = {}, spans = [], phases = []
  for (const y of years) {
    const v = (rows.find(r => r.key === "year-" + y) || {}).value || {}
    const data = v.data || {}, H = holidays(y), D = dadAuto(y)
    for (const sp of v.spans || []) spans.push(sp)
    for (const p of v.phases || []) phases.push(p)
    for (let d = new Date(y, 0, 1); d.getFullYear() === y; d = addDays(d, 1)) {
      const k = keyOf(d), x = data[k] || {}
      day[k] = {
        cs: x.cs || (x.c != null ? [x.c] : []),
        kid: show.kids && (x.kid !== undefined ? x.kid : kidAuto(k)),
        dad: show.dad && (x.dad !== undefined ? x.dad : !!D[k]),
        hol: show.hol ? H[k] : null,
      }
    }
  }
  const labelOn = k => spans.filter(s => k >= s.s && k <= s.e)
  const phaseOn = k => show.trn ? phases.find(p => k >= p.s && k <= p.e) : null
  return { labels, day, spans, phases, labelOn, phaseOn }
}

// ── drawing helpers ──────────────────────────────────────────
const INK = new Color("#1a1a1a"), MUTE = new Color("#8a8a86"), FAINT = new Color("#aaaaaa"), RED = new Color("#e0362c")
const TRACK = "#e6e4de", CARD = "#f4f3ef", CHIP = "#efeee9"
function text(stack, s, size, color, weight) {
  const t = stack.addText(String(s))
  t.font = weight === "heavy" ? Font.heavySystemFont(size) : weight === "bold" ? Font.boldSystemFont(size) : weight === "semi" ? Font.semiboldSystemFont(size) : Font.systemFont(size)
  t.textColor = color || INK
  return t
}
function box(stack, w, h, color, r) { const b = stack.addStack(); b.size = new Size(w, h); if (color) b.backgroundColor = new Color(color); if (r != null) b.cornerRadius = r; return b }
const WD = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]

function itemsOf(M, k) {
  const I = M.day[k] || {}
  const out = []
  if (I.kid) out.push(["#7fcbb4", "Kids"])
  if (I.dad) out.push([DAD, "Dad holiday"])
  for (const s of M.labelOn(k)) out.push([s.c != null ? CAT[s.c] : "#999999", s.t])
  if (I.hol) out.push([HOL, I.hol])
  return out
}
function header(stack, d, size) {
  const r = stack.addStack(); r.bottomAlignContent(); r.spacing = 5
  text(r, d.getDate(), size, INK, "heavy")
  const w = text(r, WD[d.getDay()], Math.round(size * 0.42), RED, "heavy")
  return r
}
function item(stack, color, label, size) {
  const r = stack.addStack(); r.centerAlignContent(); r.spacing = 7
  box(r, 3, size + 3, color, 1.5)
  const t = text(r, label, size, INK, "bold"); t.lineLimit = 1; t.minimumScaleFactor = 0.75
}
function agenda(stack, M, k, max, size) {
  const it = itemsOf(M, k)
  if (!it.length) { text(stack, "Nothing planned", size - 1.5, FAINT, "semi"); return }
  for (const [c, l] of it.slice(0, max)) { item(stack, c, l, size); stack.addSpacer(4) }
  if (it.length > max) text(stack, `+${it.length - max} more`, 9, FAINT, "semi")
}
function phaseInfo(M, k) {
  const p = M.phaseOn(k); if (!p) return null
  const total = daysBetween(parseKey(p.s), parseKey(p.e)) + 1, nth = daysBetween(parseKey(p.s), parseKey(k)) + 1
  return { p, frac: nth / total, wk: Math.ceil(nth / 7), wks: Math.ceil(total / 7), color: (PHASE[p.type] || PHASE.easy)[0], name: (PHASE[p.type] || PHASE.easy)[1] }
}
function trainingBar(stack, M, k, width) {
  const P = phaseInfo(M, k); if (!P) return false
  const r = stack.addStack(); r.centerAlignContent(); r.spacing = 6
  text(r, P.name.toUpperCase(), 8, new Color(P.color), "heavy")
  const tw = width - 92
  const track = box(r, tw, 5, TRACK, 2.5); track.layoutHorizontally()
  box(track, Math.max(5, Math.round(tw * P.frac)), 5, P.color, 2.5); track.addSpacer()
  text(r, `WK ${P.wk}/${P.wks}`, 8, MUTE, "heavy")
  return true
}
function seasonRibbon(stack, M, year, width) {
  const ps = M.phases.filter(p => p.s.startsWith(String(year)) || p.e.startsWith(String(year))).sort((a, b) => a.s < b.s ? -1 : 1)
  if (!ps.length) return
  const N = daysBetween(new Date(year, 0, 1), new Date(year + 1, 0, 1)), tday = daysBetween(new Date(year, 0, 1), today0())
  const segs = []; let cur = 0
  for (const p of ps) {
    const s = Math.max(0, daysBetween(new Date(year, 0, 1), parseKey(p.s))), e = Math.min(N - 1, daysBetween(new Date(year, 0, 1), parseKey(p.e)))
    if (s > cur) segs.push([cur, s - 1, CHIP]); segs.push([s, e, (PHASE[p.type] || PHASE.easy)[0]]); cur = e + 1
  }
  if (cur < N) segs.push([cur, N - 1, CHIP])
  const rib = stack.addStack(); rib.cornerRadius = 4; rib.size = new Size(width, 8); rib.layoutHorizontally()
  const px = d => Math.round(d / N * width)
  for (const [s, e, c] of segs) {
    if (tday >= s && tday <= e && today0().getFullYear() === year) {
      const a = px(tday) - px(s); if (a > 0) box(rib, a, 8, c)
      box(rib, 2, 8, "#1a1a1a")
      const b = px(e + 1) - px(tday) - 2; if (b > 0) box(rib, b, 8, c)
    } else { const w = px(e + 1) - px(s); if (w > 0) box(rib, w, 8, c) }
  }
  stack.addSpacer(2)
  const ml = stack.addStack(); ml.size = new Size(width, 9)
  "JFMAMJJASOND".split("").forEach((c, i) => { text(ml, c, 7, FAINT, "bold"); if (i < 11) ml.addSpacer() })
}

// ── SMALL ────────────────────────────────────────────────────
function small(w, M) {
  w.setPadding(13, 14, 12, 14)
  const t = today0(), k = keyOf(t)
  header(w, t, 26)
  w.addSpacer(5)
  agenda(w, M, k, 3, 11.5)
  w.addSpacer()
  trainingBar(w, M, k, 142)
}

// ── MEDIUM ───────────────────────────────────────────────────
function medium(w, M) {
  w.setPadding(13, 14, 12, 14)
  const t = today0(), k = keyOf(t)
  const root = w.addStack(); root.spacing = 12
  const left = root.addStack(); left.layoutVertically(); left.size = new Size(128, 0)
  header(left, t, 26)
  text(left, "TODAY", 8, FAINT, "heavy"); left.addSpacer(4)
  agenda(left, M, k, 3, 11.5); left.addSpacer()
  box(root, 1, 0, TRACK)
  const right = root.addStack(); right.layoutVertically()
  text(right, "NEXT 4 DAYS", 8, FAINT, "heavy"); right.addSpacer(4)
  for (let i = 1; i <= 4; i++) {
    const d = addDays(t, i), dk = keyOf(d), I = M.day[dk] || {}
    const main = itemsOf(M, dk).find(x => x[1] !== "Kids" && x[1] !== "Dad holiday")
    const r = right.addStack(); r.centerAlignContent(); r.spacing = 6
    const wd = r.addStack(); wd.size = new Size(26, 0); text(wd, WD[d.getDay()], 9.5, MUTE, "heavy")
    box(r, 6, 6, I.kid ? "#7fcbb4" : "#dcdad4", 3)
    const tx = text(r, main ? main[1] : "—", 10, main ? INK : FAINT, main ? "semi" : null); tx.lineLimit = 1; tx.minimumScaleFactor = 0.75
    right.addSpacer(5)
  }
  right.addSpacer()
  trainingBar(right, M, k, 170)
}

// ── LARGE ────────────────────────────────────────────────────
function large(w, M) {
  w.setPadding(14, 14, 14, 14)
  const t = today0(), k = keyOf(t), W = 312
  const head = w.addStack(); head.bottomAlignContent()
  header(head, t, 24); head.addSpacer()
  text(head, t.toLocaleDateString(undefined, { month: "long", year: "numeric" }).toUpperCase(), 9, FAINT, "bold")
  w.addSpacer(10)
  const P = phaseInfo(M, k)
  if (P) {
    const card = w.addStack(); card.layoutVertically(); card.backgroundColor = new Color(CARD); card.cornerRadius = 10; card.setPadding(9, 11, 9, 11)
    const r1 = card.addStack(); r1.centerAlignContent()
    text(r1, "TRAINING", 8, new Color(P.color), "heavy"); r1.addSpacer()
    const nx = M.phases.filter(p => p.s > k).sort((a, b) => a.s < b.s ? -1 : 1)[0]
    if (nx) { const d = parseKey(nx.s); const x = text(r1, `NEXT: ${nx.t} · ${MON[d.getMonth()]} ${d.getDate()}`.toUpperCase(), 8, MUTE, "bold"); x.lineLimit = 1; x.minimumScaleFactor = 0.6 }
    card.addSpacer(2)
    const nm = text(card, P.p.t, 13.5, INK, "heavy"); nm.lineLimit = 1; nm.minimumScaleFactor = 0.7
    card.addSpacer(6)
    trainingBar(card, M, k, W - 22)
    card.addSpacer(8)
    seasonRibbon(card, M, t.getFullYear(), W - 22)
    w.addSpacer(10)
  }
  text(w, "THIS WEEK", 8, FAINT, "heavy"); w.addSpacer(5)
  const wk = w.addStack(); wk.spacing = 0
  for (let i = 0; i < 7; i++) {
    const d = addDays(t, i), dk = keyOf(d), I = M.day[dk] || { cs: [] }
    const col = wk.addStack(); col.layoutVertically(); col.size = new Size(W / 7, 0); col.centerAlignContent()
    const l1 = col.addStack(); l1.addSpacer(); text(l1, DOW[d.getDay()], 8, i ? FAINT : INK, "heavy"); l1.addSpacer()
    col.addSpacer(3)
    const l2 = col.addStack(); l2.addSpacer()
    const chip = l2.addStack(); chip.size = new Size(30, 26); chip.cornerRadius = 7; chip.centerAlignContent()
    chip.backgroundColor = new Color(I.cs.length ? CAT[I.cs[0]] : CHIP)
    if (I.dad) { chip.borderColor = new Color(DAD); chip.borderWidth = 2 }
    if (i === 0) { chip.borderColor = new Color("#2b6cff"); chip.borderWidth = 2 }
    chip.addSpacer(); text(chip, d.getDate(), 11, I.cs.length ? INK : MUTE, "heavy"); chip.addSpacer()
    l2.addSpacer()
    col.addSpacer(3)
    const l3 = col.addStack(); l3.addSpacer(); box(l3, 16, 3, I.kid ? "#7fcbb4" : null, 1.5); l3.addSpacer()
  }
  w.addSpacer(10)
  const cols = w.addStack(); cols.spacing = 14
  ;[0, 1].forEach(i => {
    const c = cols.addStack(); c.layoutVertically(); c.size = new Size((W - 14) / 2, 0)
    text(c, i ? "TOMORROW" : "TODAY", 8, i ? FAINT : INK, "heavy"); c.addSpacer(4)
    agenda(c, M, keyOf(addDays(t, i)), P ? 3 : 5, 11.5)
  })
  w.addSpacer()
}

// ── MAIN ─────────────────────────────────────────────────────
const yr = new Date().getFullYear()
const years = [yr, yr + 1]
const rows = await load(years)
const M = buildModel(rows, years)
const w = new ListWidget()
w.backgroundColor = Color.white()
w.url = CAL_URL
w.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000)
const fam = config.widgetFamily
if (fam === "small") small(w, M)
else if (fam === "large") large(w, M)
else medium(w, M)
if (config.runInWidget) Script.setWidget(w)
else if (fam === "small") await w.presentSmall()
else if (fam === "large") await w.presentLarge()
else await w.presentMedium()
Script.complete()
