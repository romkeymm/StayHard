// ─────────────────────────────────────────────────────────────
//  RUN. Dashboard Widget for Scriptable
//  
//  SETUP:
//  1. Replace DATA_URL below with your GitHub Pages data.json URL
//     e.g. https://yourusername.github.io/running-dashboard/data.json
//  2. Replace DASHBOARD_URL with your GitHub Pages dashboard URL
//     e.g. https://yourusername.github.io/running-dashboard/
//  3. In Scriptable, tap + → paste this script → tap Run to test
//  4. Add a Scriptable widget to your home screen, pick this script
//  5. Supports Small, Medium, and Large widget sizes
// ─────────────────────────────────────────────────────────────

const DATA_URL       = "https://romkeymm.github.io/stayhard/data.json"
const DASHBOARD_URL  = "https://romkeymm.github.io/StayHard/"

// ── COLORS ───────────────────────────────────────────────────
const C = {
  bg:      new Color("#0a0a0a"),
  bg2:     new Color("#111111"),
  red:     new Color("#ff2d20"),
  green:   new Color("#00e676"),
  blue:    new Color("#4a9eff"),
  yellow:  new Color("#ffd600"),
  purple:  new Color("#bb86fc"),
  orange:  new Color("#ff7043"),
  white:   new Color("#ffffff"),
  muted:   new Color("#888888"),
  dim:     new Color("#444444"),
}

// ── FETCH DATA ────────────────────────────────────────────────
async function fetchData() {
  try {
    const req = new Request(DATA_URL)
    req.timeoutInterval = 10
    return await req.loadJSON()
  } catch (e) {
    return null
  }
}

// ── HELPERS ──────────────────────────────────────────────────
function daysUntil(dateStr) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const race = new Date(dateStr + "T12:00:00")
  race.setHours(0, 0, 0, 0)
  return Math.ceil((race - today) / 86400000)
}

function readinessColor(score) {
  if (score >= 80) return C.green
  if (score >= 65) return C.yellow
  if (score >= 50) return C.orange
  return C.red
}

function readinessLabel(score) {
  if (score >= 80) return "Optimal"
  if (score >= 65) return "Good"
  if (score >= 50) return "Moderate"
  return "Rest Day"
}

function addRow(stack, label, value, valueColor) {
  const row = stack.addStack()
  row.layoutHorizontally()
  row.centerAlignContent()
  const lbl = row.addText(label)
  lbl.font = Font.systemFont(10)
  lbl.textColor = C.muted
  row.addSpacer()
  const val = row.addText(value)
  val.font = Font.boldSystemFont(11)
  val.textColor = valueColor || C.white
}

function addDivider(stack) {
  const div = stack.addStack()
  div.backgroundColor = C.bg2
  div.size = new Size(0, 1)
  stack.addSpacer(6)
}

// ── SMALL WIDGET ─────────────────────────────────────────────
// Shows: next race countdown + readiness score
function buildSmall(widget, data) {
  widget.setPadding(14, 14, 14, 14)

  // Logo
  const logo = widget.addText("RUN.")
  logo.font = new Font("Barlow-Black", 14) 
  logo.font = Font.heavySystemFont(13)
  logo.textColor = C.red
  widget.addSpacer(4)

  // Next race
  if (data) {
    const nextRace = data.races.find(r => daysUntil(r.date) >= 0)
    if (nextRace) {
      const days = daysUntil(nextRace.date)
      const daysNum = widget.addText(String(days))
      daysNum.font = Font.heavySystemFont(42)
      daysNum.textColor = C.white
      daysNum.minimumScaleFactor = 0.5

      const daysLbl = widget.addText("DAYS TO RACE")
      daysLbl.font = Font.boldSystemFont(8)
      daysLbl.textColor = C.dim

      widget.addSpacer(4)

      const raceName = widget.addText(nextRace.short.toUpperCase())
      raceName.font = Font.boldSystemFont(9)
      raceName.textColor = C.yellow
      raceName.lineLimit = 1

      widget.addSpacer()

      const score = data.fitness.readiness_score
      const scoreRow = widget.addStack()
      scoreRow.layoutHorizontally()
      scoreRow.centerAlignContent()
      const dot = scoreRow.addText("● ")
      dot.font = Font.systemFont(8)
      dot.textColor = readinessColor(score)
      const readLbl = scoreRow.addText(readinessLabel(score).toUpperCase())
      readLbl.font = Font.boldSystemFont(8)
      readLbl.textColor = readinessColor(score)
    }
  } else {
    const err = widget.addText("Tap to open")
    err.font = Font.systemFont(11)
    err.textColor = C.muted
  }
}

// ── MEDIUM WIDGET ─────────────────────────────────────────────
// Shows: countdown + all upcoming races list + readiness
function buildMedium(widget, data) {
  widget.setPadding(14, 16, 14, 16)

  const root = widget.addStack()
  root.layoutHorizontally()
  root.spacing = 14

  // LEFT: countdown
  const left = root.addStack()
  left.layoutVertically()
  left.size = new Size(110, 0)

  const logoRow = left.addStack()
  logoRow.layoutHorizontally()
  logoRow.centerAlignContent()
  const logoTxt = logoRow.addText("RUN")
  logoTxt.font = Font.heavySystemFont(14)
  logoTxt.textColor = C.white
  const dot = logoRow.addText(".")
  dot.font = Font.heavySystemFont(14)
  dot.textColor = C.red
  left.addSpacer(8)

  if (data) {
    const nextRace = data.races.find(r => daysUntil(r.date) >= 0)
    if (nextRace) {
      const days = daysUntil(nextRace.date)
      const num = left.addText(String(days))
      num.font = Font.heavySystemFont(40)
      num.textColor = C.yellow
      num.minimumScaleFactor = 0.5

      const lbl = left.addText("DAYS")
      lbl.font = Font.boldSystemFont(9)
      lbl.textColor = C.dim
      left.addSpacer(2)

      const name = left.addText(nextRace.short.toUpperCase())
      name.font = Font.boldSystemFont(9)
      name.textColor = C.red
      name.lineLimit = 2

      left.addSpacer()

      const score = data.fitness.readiness_score
      const scoreVal = left.addText(String(score) + " / 100")
      scoreVal.font = Font.boldSystemFont(10)
      scoreVal.textColor = readinessColor(score)
      const scoreLbl = left.addText(readinessLabel(score).toUpperCase())
      scoreLbl.font = Font.boldSystemFont(8)
      scoreLbl.textColor = C.dim
    }
  }

  // DIVIDER
  root.addSpacer(0)
  const divStack = root.addStack()
  divStack.backgroundColor = new Color("#222222")
  divStack.size = new Size(1, 0)
  root.addSpacer(0)

  // RIGHT: upcoming races
  const right = root.addStack()
  right.layoutVertically()
  right.spacing = 5

  const upcomingLbl = right.addText("UPCOMING")
  upcomingLbl.font = Font.boldSystemFont(8)
  upcomingLbl.textColor = C.dim
  right.addSpacer(2)

  if (data) {
    const upcoming = data.races.filter(r => daysUntil(r.date) >= 0).slice(0, 4)
    upcoming.forEach((race, i) => {
      const row = right.addStack()
      row.layoutHorizontally()
      row.centerAlignContent()
      row.spacing = 4

      const days = daysUntil(race.date)
      const isNext = i === 0

      const daysTxt = row.addText(String(days) + "d")
      daysTxt.font = Font.boldSystemFont(isNext ? 11 : 10)
      daysTxt.textColor = isNext ? C.yellow : C.muted
      daysTxt.minimumScaleFactor = 0.7

      const nameTxt = row.addText(race.short)
      nameTxt.font = Font.systemFont(isNext ? 10 : 9)
      nameTxt.textColor = isNext ? C.white : C.muted
      nameTxt.lineLimit = 1
      nameTxt.minimumScaleFactor = 0.7
    })

    right.addSpacer()

    // Quick stats
    const statsRow = right.addStack()
    statsRow.layoutHorizontally()
    statsRow.spacing = 10

    const vo2Stack = statsRow.addStack()
    vo2Stack.layoutVertically()
    const vo2Val = vo2Stack.addText(String(data.fitness.vo2_max))
    vo2Val.font = Font.boldSystemFont(12)
    vo2Val.textColor = C.green
    const vo2Lbl = vo2Stack.addText("VO2")
    vo2Lbl.font = Font.systemFont(7)
    vo2Lbl.textColor = C.dim

    const miStack = statsRow.addStack()
    miStack.layoutVertically()
    const miVal = miStack.addText(String(data.training.miles_2026))
    miVal.font = Font.boldSystemFont(12)
    miVal.textColor = C.blue
    const miLbl = miStack.addText("MI '26")
    miLbl.font = Font.systemFont(7)
    miLbl.textColor = C.dim

    const hrvStack = statsRow.addStack()
    hrvStack.layoutVertically()
    const hrvVal = hrvStack.addText(String(data.fitness.hrv))
    hrvVal.font = Font.boldSystemFont(12)
    hrvVal.textColor = C.purple
    const hrvLbl = hrvStack.addText("HRV")
    hrvLbl.font = Font.systemFont(7)
    hrvLbl.textColor = C.dim
  }
}

// ── LARGE WIDGET ─────────────────────────────────────────────
// Shows everything: countdown, all races, fitness stats
function buildLarge(widget, data) {
  widget.setPadding(16, 16, 16, 16)

  // Header
  const header = widget.addStack()
  header.layoutHorizontally()
  header.centerAlignContent()
  const h_logo = header.addText("RUN")
  h_logo.font = Font.heavySystemFont(18)
  h_logo.textColor = C.white
  const h_dot = header.addText(".")
  h_dot.font = Font.heavySystemFont(18)
  h_dot.textColor = C.red
  header.addSpacer()
  if (data) {
    const updated = header.addText("Updated " + data.updated)
    updated.font = Font.systemFont(8)
    updated.textColor = C.dim
  }

  widget.addSpacer(10)

  if (!data) {
    const err = widget.addText("Could not load data. Check your DATA_URL.")
    err.font = Font.systemFont(11)
    err.textColor = C.muted
    return
  }

  // Next race hero
  const nextRace = data.races.find(r => daysUntil(r.date) >= 0)
  if (nextRace) {
    const days = daysUntil(nextRace.date)
    const heroRow = widget.addStack()
    heroRow.layoutHorizontally()
    heroRow.centerAlignContent()
    heroRow.backgroundColor = C.bg2
    heroRow.cornerRadius = 8
    heroRow.setPadding(10, 12, 10, 12)

    const heroLeft = heroRow.addStack()
    heroLeft.layoutVertically()
    const heroName = heroLeft.addText(nextRace.name.toUpperCase())
    heroName.font = Font.boldSystemFont(9)
    heroName.textColor = C.yellow
    heroName.lineLimit = 1
    heroName.minimumScaleFactor = 0.7
    heroLeft.addSpacer(2)
    const heroDist = heroLeft.addText(nextRace.distance + "  ·  " + nextRace.date)
    heroDist.font = Font.systemFont(8)
    heroDist.textColor = C.muted

    heroRow.addSpacer()

    const heroRight = heroRow.addStack()
    heroRight.layoutVertically()
    heroRight.centerAlignContent()
    const heroDays = heroRight.addText(String(days))
    heroDays.font = Font.heavySystemFont(28)
    heroDays.textColor = C.red
    const heroDaysLbl = heroRight.addText("DAYS")
    heroDaysLbl.font = Font.boldSystemFont(7)
    heroDaysLbl.textColor = C.dim
  }

  widget.addSpacer(8)

  // All races
  const racesLbl = widget.addText("2026 RACE CALENDAR")
  racesLbl.font = Font.boldSystemFont(8)
  racesLbl.textColor = C.dim
  widget.addSpacer(4)

  data.races.forEach((race, i) => {
    const days = daysUntil(race.date)
    const isPast = days < 0
    const isNext = !isPast && data.races.findIndex(r => daysUntil(r.date) >= 0) === i

    const row = widget.addStack()
    row.layoutHorizontally()
    row.centerAlignContent()
    row.spacing = 6
    row.setPadding(3, 0, 3, 0)

    const dot = row.addText(isPast ? "✓" : "●")
    dot.font = Font.systemFont(7)
    dot.textColor = isPast ? C.dim : (isNext ? C.yellow : C.muted)

    const name = row.addText(race.short)
    name.font = isNext ? Font.boldSystemFont(10) : Font.systemFont(10)
    name.textColor = isPast ? C.dim : (isNext ? C.white : C.muted)
    name.lineLimit = 1

    row.addSpacer()

    const dateOrDays = isPast ? "Done" : (days === 0 ? "TODAY!" : days + "d")
    const dateTxt = row.addText(dateOrDays)
    dateTxt.font = Font.boldSystemFont(10)
    dateTxt.textColor = isPast ? C.dim : (isNext ? C.yellow : C.muted)
  })

  widget.addSpacer(10)

  // Fitness stats grid
  const statsLbl = widget.addText("FITNESS")
  statsLbl.font = Font.boldSystemFont(8)
  statsLbl.textColor = C.dim
  widget.addSpacer(6)

  const statsRow = widget.addStack()
  statsRow.layoutHorizontally()
  statsRow.spacing = 8

  const statItems = [
    { label: "VO2 MAX", value: String(data.fitness.vo2_max), color: C.green },
    { label: "MILES '26", value: String(data.training.miles_2026), color: C.blue },
    { label: "HRV", value: String(data.fitness.hrv) + "ms", color: C.purple },
    { label: "READINESS", value: String(data.fitness.readiness_score), color: readinessColor(data.fitness.readiness_score) },
    { label: "RESTING HR", value: String(data.fitness.resting_hr), color: C.yellow },
  ]

  statItems.forEach(stat => {
    const col = statsRow.addStack()
    col.layoutVertically()
    col.centerAlignContent()

    const val = col.addText(stat.value)
    val.font = Font.boldSystemFont(13)
    val.textColor = stat.color
    val.minimumScaleFactor = 0.7

    const lbl = col.addText(stat.label)
    lbl.font = Font.systemFont(7)
    lbl.textColor = C.dim
    lbl.minimumScaleFactor = 0.6

    statsRow.addSpacer()
  })
}

// ── MAIN ─────────────────────────────────────────────────────
const data   = await fetchData()
const widget = new ListWidget()
widget.backgroundColor = C.bg
widget.url = DASHBOARD_URL

const size = config.widgetFamily

if (size === "small")  buildSmall(widget, data)
else if (size === "large") buildLarge(widget, data)
else buildMedium(widget, data)   // default: medium

if (config.runInWidget) {
  Script.setWidget(widget)
} else {
  // Preview all sizes when running in Scriptable app
  await widget.presentSmall()
}

Script.complete()
