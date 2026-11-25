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
//  Small:  today (kids / Dad holiday / phase) and next race countdown
//  Medium: the next 7 days as tiles, with the current training phase
//  Large:  this month as tiles, plus what's coming up
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
function text(stack, s, size, color, weight) {
  const t = stack.addText(s)
  t.font = weight === "heavy" ? Font.heavySystemFont(size) : weight === "bold" ? Font.boldSystemFont(size) : weight === "semi" ? Font.semiboldSystemFont(size) : Font.systemFont(size)
  t.textColor = color || C.ink
  return t
}
function bar(stack, w, h, color, r) { const b = stack.addStack(); b.size = new Size(w, h); b.backgroundColor = new Color(color); b.cornerRadius = r == null ? h / 2 : r; return b }

// One calendar tile: color fill (two colors split top/bottom), kid line on top, Dad outline, label.
function tile(parent, k, M, w, h, opts = {}) {
  const info = M.day[k] || { cs: [] }
  const d = parseKey(k), we = d.getDay() === 0 || d.getDay() === 6
  const cell = parent.addStack()
  cell.size = new Size(w, h)
  cell.cornerRadius = 6
  cell.layoutVertically()
  if (info.dad) { cell.borderColor = new Color(DAD); cell.borderWidth = 2 }
  if (info.cs.length) cell.backgroundColor = new Color(CAT[info.cs[0]], 0.75)
  else {
    const ph = M.phaseOn(k)
    cell.backgroundColor = ph ? new Color((PHASE[ph.type] || PHASE.easy)[0], 0.16) : (we ? C.we : C.tile)
  }
  if (keyOf(today0()) === k) { cell.borderColor = new Color("#2b6cff"); cell.borderWidth = 2 }
  // kid line
  const top = cell.addStack(); top.size = new Size(w, 3)
  if (info.kid) { top.addSpacer(5); bar(top, w - 10, 3, KID, 1.5); top.addSpacer(5) }
  cell.setPadding(0, 0, 0, 0)
  const body = cell.addStack(); body.layoutVertically(); body.setPadding(1, 4, 2, 3)
  const num = text(body, String(d.getDate()), opts.numSize || 10, info.cs.length ? new Color("#1a1a1a") : C.soft, "bold")
  if (info.cs.length > 1) { const s = body.addStack(); s.addSpacer(); bar(s, 7, 7, CAT[info.cs[1]], 3.5) }
  if (opts.labels) {
    const lab = M.labelOn(k)[0]
    const txt = lab ? lab.t : (info.hol || "")
    if (txt) { const t = text(body, txt, opts.labelSize || 7.5, lab ? (info.cs.length ? new Color("#222222") : C.ink) : new Color(HOL), lab ? "semi" : null); t.lineLimit = opts.lines || 2; t.minimumScaleFactor = 0.8 }
  }
  cell.addSpacer()
  return cell
}

function nextRace(M) {
  const t = keyOf(today0())
  return M.spans.filter(s => s.c === RACE && s.s >= t).sort((a, b) => a.s < b.s ? -1 : 1)[0]
}
function upcoming(M, n) {
  const t = keyOf(today0())
  return M.spans.filter(s => s.e >= t).sort((a, b) => a.s < b.s ? -1 : 1).slice(0, n)
}
function phaseLine(stack, M, k, size) {
  const p = M.phaseOn(k); if (!p) return
  const r = stack.addStack(); r.centerAlignContent(); r.spacing = 5
  bar(r, 12, 4, (PHASE[p.type] || PHASE.easy)[0])
  const total = daysBetween(parseKey(p.s), parseKey(p.e)) + 1, nth = daysBetween(parseKey(p.s), parseKey(k)) + 1
  const wk = Math.ceil(nth / 7), wks = Math.ceil(total / 7)
  const t = text(r, `${p.t} · week ${wk} of ${wks}`, size, C.soft, "semi"); t.lineLimit = 1; t.minimumScaleFactor = 0.7
}
function raceLine(stack, M, size) {
  const r = nextRace(M); if (!r) return
  const n = daysBetween(today0(), parseKey(r.s))
  const row = stack.addStack(); row.centerAlignContent(); row.spacing = 5
  bar(row, 8, 8, CAT[RACE], 4)
  const t = text(row, `${r.t} · ${n === 0 ? "today" : n + " days"}`, size, C.ink, "semi"); t.lineLimit = 1; t.minimumScaleFactor = 0.7
}

// ── SMALL ────────────────────────────────────────────────────
function small(w, M) {
  w.setPadding(14, 14, 12, 14)
  const t = today0(), k = keyOf(t), info = M.day[k] || {}
  text(w, t.toLocaleDateString(undefined, { weekday: "long" }).toUpperCase(), 10, new Color("#c94a5c"), "bold")
  text(w, String(t.getDate()), 34, C.ink, "heavy")
  w.addSpacer(2)
  const tags = []
  if (info.kid) tags.push(["Kids", KID])
  if (info.dad) tags.push(["Dad holiday", DAD])
  for (const s of M.labelOn(k).slice(0, 1)) tags.push([s.t, s.c != null ? CAT[s.c] : "#999999"])
  if (info.hol) tags.push([info.hol, HOL])
  for (const [s, c] of tags.slice(0, 2)) { const r = w.addStack(); r.centerAlignContent(); r.spacing = 5; bar(r, 8, 8, c, 4); const x = text(r, s, 10, C.ink, "semi"); x.lineLimit = 1; x.minimumScaleFactor = 0.7 }
  w.addSpacer()
  const r = nextRace(M)
  if (r) {
    const n = daysBetween(t, parseKey(r.s))
    const row = w.addStack(); row.bottomAlignContent(); row.spacing = 4
    text(row, String(n), 20, new Color("#c94a5c"), "heavy"); const d = text(row, "days", 9, C.soft, "semi")
    const nm = text(w, r.t, 9, C.soft, "semi"); nm.lineLimit = 1; nm.minimumScaleFactor = 0.7
  }
}

// ── MEDIUM ───────────────────────────────────────────────────
function medium(w, M) {
  w.setPadding(12, 12, 10, 12)
  const t = today0()
  const head = w.addStack(); head.centerAlignContent()
  text(head, "Next 7 days", 12, C.ink, "heavy"); head.addSpacer()
  raceLine(head, M, 10)
  w.addSpacer(6)
  const row = w.addStack(); row.spacing = 4
  for (let i = 0; i < 7; i++) {
    const d = addDays(t, i)
    const col = row.addStack(); col.layoutVertically(); col.spacing = 2
    const hd = col.addStack(); hd.addSpacer(); text(hd, i === 0 ? "Today" : DOW[d.getDay()], 8, i === 0 ? new Color("#2b6cff") : C.faint, "bold"); hd.addSpacer()
    tile(col, keyOf(d), M, 42, 86, { labels: true, lines: 4, labelSize: 7.5, numSize: 11 })
  }
  w.addSpacer(6)
  phaseLine(w, M, keyOf(t), 9)
}

// ── LARGE ────────────────────────────────────────────────────
function large(w, M) {
  w.setPadding(14, 12, 12, 12)
  const t = today0(), y = t.getFullYear(), m = t.getMonth()
  const head = w.addStack(); head.centerAlignContent()
  text(head, t.toLocaleDateString(undefined, { month: "long" }), 16, C.ink, "heavy")
  text(head, " " + y, 16, C.soft, null)
  head.addSpacer()
  phaseLine(head, M, keyOf(t), 9)
  w.addSpacer(6)
  const wd = w.addStack(); wd.spacing = 4
  for (const c of DOW) { const s = wd.addStack(); s.size = new Size(42, 10); text(s, c, 8, C.faint, "bold") }
  w.addSpacer(3)
  const first = new Date(y, m, 1), start = first.getDay(), days = new Date(y, m + 1, 0).getDate()
  const weeks = Math.ceil((start + days) / 7), th = weeks > 5 ? 30 : 36
  for (let r = 0; r < weeks; r++) {
    const row = w.addStack(); row.spacing = 4
    for (let i = 0; i < 7; i++) {
      const d = r * 7 + i - start + 1
      if (d < 1 || d > days) { const e = row.addStack(); e.size = new Size(42, th); continue }
      tile(row, keyOf(new Date(y, m, d)), M, 42, th, { labels: true, lines: 1, labelSize: 6.5, numSize: 9 })
    }
    w.addSpacer(4)
  }
  w.addSpacer()
  const list = w.addStack(); list.layoutVertically(); list.spacing = 3
  for (const s of upcoming(M, 3)) {
    const r = list.addStack(); r.centerAlignContent(); r.spacing = 6
    bar(r, 8, 8, s.c != null ? CAT[s.c] : "#999999", 4)
    const ds = parseKey(s.s), de = parseKey(s.e)
    const when = s.s === s.e ? `${MON[ds.getMonth()]} ${ds.getDate()}` : `${MON[ds.getMonth()]} ${ds.getDate()} – ${MON[de.getMonth()]} ${de.getDate()}`
    const a = text(r, when, 9, C.soft, "semi"); a.lineLimit = 1
    const b = text(r, s.t, 9.5, C.ink, "semi"); b.lineLimit = 1; b.minimumScaleFactor = 0.7
  }
}

// ── MAIN ─────────────────────────────────────────────────────
const yr = new Date().getFullYear()
const years = [yr, yr + 1]
const rows = await load(years)
const M = buildModel(rows, years)
const w = new ListWidget()
w.backgroundColor = C.bg
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
