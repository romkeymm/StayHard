// Foundation block (8 weeks, Nov 9 2026 → Jan 3 2027), 3 sessions × ~45 min.
// Turns the plan into Hevy routine payloads. Hevy routines have no RPE field
// and routine-level notes don't display, so targets live in each exercise's
// pinned note. Week 1 has no weights: loads are set by feel (RPE) and logged.

export const BLOCK = {
  title: 'Foundation Block',
  start: '2026-11-09',
  weeks: 8,
  deloadWeeks: [4, 8],
};

// kind: reps | duration | carry. ss = superset group within the session.
// main lifts drop to 3 reps in weeks 5–7 (heavier phase).
export const SESSIONS = [
  {
    key: 'A', title: 'A · Lower (hinge)',
    exercises: [
      { name: 'Trap-bar deadlift', candidates: ['Trap Bar Deadlift', 'Deadlift (Trap bar)'], sets: 4, reps: 5, main: true, rest: 150, note: 'RPE 7–8: 2–3 reps left in the tank. Fast, crisp reps.' },
      { name: 'Romanian deadlift', candidates: ['Romanian Deadlift (Barbell)', 'Romanian Deadlift'], sets: 3, reps: 8, ss: 0, rest: 75, note: 'RPE 7. 3 s down, stop when hips stop moving back.' },
      { name: 'Pallof press', candidates: ['Pallof Press', 'Pallof Press (Cable)'], sets: 3, reps: 10, ss: 0, rest: 75, note: '10 per side. Resist rotation, ribs down.' },
      { name: 'Bulgarian split squat', candidates: ['Bulgarian Split Squat (Dumbbell)', 'Bulgarian Split Squat'], sets: 3, reps: 8, ss: 1, rest: 75, note: '8 per leg, RPE 7.' },
      { name: 'Nordic hamstring curl', candidates: ['Nordic Hamstrings Curls', 'Nordic Hamstring Curl', 'Nordic Curl'], sets: 3, range: [4, 6], ss: 1, rest: 75, note: 'Band-assisted. Lower as slowly as you can control; stop if the hamstring feels sharp (>3/10).' },
      { name: 'Seated calf raise', candidates: ['Seated Calf Raise', 'Seated Calf Raise (Machine)'], sets: 2, reps: 15, rest: 45, note: 'Pause 1 s at the bottom.' },
    ],
  },
  {
    key: 'B', title: 'B · Upper + core',
    exercises: [
      { name: 'Bench press', candidates: ['Bench Press (Barbell)'], sets: 4, reps: 6, ss: 0, rest: 90, note: 'RPE 7–8.' },
      { name: 'Chest-supported row', candidates: ['Chest Supported Incline Row (Dumbbell)', 'Chest Supported Row', 'Seated Row (Machine)'], sets: 4, reps: 8, ss: 0, rest: 90, note: 'Pause at the top.' },
      { name: 'Half-kneeling DB press', candidates: ['Single Arm Overhead Press (Dumbbell)', 'Shoulder Press (Dumbbell)', 'Overhead Press (Dumbbell)'], sets: 3, reps: 8, ss: 1, rest: 75, note: 'Half-kneeling, 8 per side. Squeeze the down-knee glute.' },
      { name: 'Lat pulldown', candidates: ['Lat Pulldown (Cable)', 'Lat Pulldown'], sets: 3, reps: 8, ss: 1, rest: 75, note: 'Full stretch at the top.' },
      { name: 'Copenhagen plank', candidates: ['Copenhagen Plank', 'Copenhagen Adductor Plank'], sets: 2, duration: 20, kind: 'duration', ss: 2, rest: 60, note: '20 s per side. Short lever (knee) if needed.' },
      { name: 'Farmer carry', candidates: ["Farmers Walk", "Farmer's Walk", 'Farmer Carry'], sets: 2, distance: 40, kind: 'carry', ss: 2, rest: 60, note: '40 m, heavy, tall posture.' },
    ],
  },
  {
    key: 'C', title: 'C · Lower (single-leg + hamstrings)',
    exercises: [
      { name: 'Front squat', candidates: ['Front Squat (Barbell)', 'Front Squat'], sets: 4, reps: 5, main: true, rest: 150, note: 'RPE 7. Upright torso, full depth you own.' },
      { name: 'Single-leg RDL', candidates: ['Single Leg Romanian Deadlift (Dumbbell)', 'Single Leg Romanian Deadlift', 'Single Leg Deadlift'], sets: 3, reps: 8, ss: 0, rest: 75, note: '8 per leg. Hips square, slow lowering.' },
      { name: 'Step-up', candidates: ['Step Up', 'Step-up (Dumbbell)', 'Dumbbell Step Up'], sets: 3, reps: 8, ss: 0, rest: 75, note: '8 per leg, knee-height box, drive through the heel.' },
      { name: 'Hip thrust', candidates: ['Hip Thrust (Barbell)', 'Hip Thrust'], sets: 3, reps: 8, ss: 1, rest: 75, note: 'RPE 7. Pause 1 s at lockout.' },
      { name: 'Seated leg curl', candidates: ['Seated Leg Curl (Machine)', 'Seated Leg Curl'], sets: 3, reps: 10, ss: 1, rest: 75, note: '3 s lowering on every rep.' },
      { name: 'Standing calf raise', candidates: ['Standing Calf Raise (Machine)', 'Standing Calf Raise', 'Calf Raise (Machine)'], sets: 2, reps: 12, ss: 2, rest: 45, note: 'Full range, pause at the top.' },
      { name: 'Tibialis raise', candidates: ['Tibialis Raise', 'Tib Raise'], sets: 2, reps: 12, ss: 2, rest: 45, note: 'Heels on floor, back against a wall.' },
    ],
  },
  // Heavy kid weeks allow only one lower day, so L packs all three hamstring
  // patterns (hinge, eccentric, single-leg) into one 45-minute session.
  {
    key: 'L', title: 'L · Lower (full, 2-day weeks)',
    exercises: [
      { name: 'Trap-bar deadlift', candidates: ['Trap Bar Deadlift', 'Deadlift (Trap bar)'], sets: 4, reps: 5, main: true, rest: 150, note: 'RPE 7–8: 2–3 reps left in the tank. Fast, crisp reps.' },
      { name: 'Bulgarian split squat', candidates: ['Bulgarian Split Squat (Dumbbell)', 'Bulgarian Split Squat'], sets: 3, reps: 8, ss: 0, rest: 75, note: '8 per leg, RPE 7.' },
      { name: 'Nordic hamstring curl', candidates: ['Nordic Hamstrings Curls', 'Nordic Hamstring Curl', 'Nordic Curl'], sets: 3, range: [4, 6], ss: 0, rest: 75, note: 'Band-assisted. Lower as slowly as you can control; stop if the hamstring feels sharp (>3/10).' },
      { name: 'Single-leg RDL', candidates: ['Single Leg Romanian Deadlift (Dumbbell)', 'Single Leg Romanian Deadlift', 'Single Leg Deadlift'], sets: 3, reps: 8, ss: 1, rest: 60, note: '8 per leg. Hips square, slow lowering.' },
      { name: 'Seated calf raise', candidates: ['Seated Calf Raise', 'Seated Calf Raise (Machine)'], sets: 3, reps: 15, ss: 1, rest: 60, note: 'Pause 1 s at the bottom.' },
    ],
  },
];

export const LOWER = new Set(['A', 'C', 'L']);

// Custody runs 2-2-3 and alternates weekly. Anchor: the week of Nov 9, 2026 is
// a "heavy" kid week (kids Mon, Tue, Fri, Sat, Sun). No lifting on kid days.
export const CUSTODY = { anchorWeek: '2026-11-09', anchorType: 'heavy' };

export const WEEK_TYPES = {
  heavy: { kidDays: ['Mon', 'Tue', 'Fri', 'Sat', 'Sun'], longRun: 'Fri', lifts: { Wed: 'L', Thu: 'B' } },
  light: { kidDays: ['Wed', 'Thu'], longRun: 'Sat', lifts: { Mon: 'A', Tue: 'B', Sun: 'C' } },
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_MS = 86_400_000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// Monday (YYYY-MM-DD) of the week containing dateISO.
export function mondayOf(dateISO) {
  const t = Date.parse(`${dateISO}T00:00:00Z`);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // Mon = 0
  return isoDay(t - dow * DAY_MS);
}

export function weekType(dateISO, custody = CUSTODY) {
  const weeks = Math.round((Date.parse(`${mondayOf(dateISO)}T00:00:00Z`) - Date.parse(`${custody.anchorWeek}T00:00:00Z`)) / (7 * DAY_MS));
  const same = ((weeks % 2) + 2) % 2 === 0;
  return same ? custody.anchorType : custody.anchorType === 'heavy' ? 'light' : 'heavy';
}

// The lifting plan for the week containing dateISO.
export function scheduleWeek(dateISO) {
  const monday = Date.parse(`${mondayOf(dateISO)}T00:00:00Z`);
  const type = weekType(dateISO);
  const spec = WEEK_TYPES[type];
  const dayDate = (d) => isoDay(monday + DAYS.indexOf(d) * DAY_MS);
  return {
    weekOf: isoDay(monday),
    type,
    kidDays: spec.kidDays.map(dayDate),
    longRun: dayDate(spec.longRun),
    lifts: DAYS.filter((d) => spec.lifts[d]).map((d) => ({ day: d, date: dayDate(d), session: spec.lifts[d] })),
  };
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Match each exercise to a Hevy template by title: exact candidate first, then
// a candidate contained in a template title. Unmatched ones are reported, never guessed.
export function resolveTemplates(templates, sessions = SESSIONS) {
  const byTitle = new Map(templates.map((t) => [norm(t.title), t]));
  const map = {};
  const missing = [];
  for (const s of sessions) {
    for (const ex of s.exercises) {
      if (map[ex.name]) continue;
      let hit = null;
      for (const c of ex.candidates) { hit = byTitle.get(norm(c)); if (hit) break; }
      if (!hit) {
        for (const c of ex.candidates) {
          hit = templates.find((t) => norm(t.title).startsWith(norm(c)));
          if (hit) break;
        }
      }
      if (hit) map[ex.name] = { id: hit.id, title: hit.title };
      else missing.push(ex.name);
    }
  }
  return { map, missing };
}

export function weekOf(dateISO, block = BLOCK) {
  const days = Math.floor((Date.parse(`${dateISO}T00:00:00Z`) - Date.parse(`${block.start}T00:00:00Z`)) / 86_400_000);
  return Math.min(Math.max(Math.floor(days / 7) + 1, 1), block.weeks);
}

export function isDeload(week, block = BLOCK) {
  return block.deloadWeeks.includes(week);
}

function setsFor(ex, week) {
  const n = isDeload(week) ? Math.max(1, Math.round(ex.sets * 0.6)) : ex.sets;
  const heavy = ex.main && week >= 5 && week <= 7;
  const make = () => {
    const base = { type: 'normal', weight_kg: null, reps: null, distance_meters: null, duration_seconds: null };
    if (ex.kind === 'duration') return { ...base, duration_seconds: ex.duration };
    if (ex.kind === 'carry') return { ...base, distance_meters: ex.distance };
    if (ex.range) return { ...base, rep_range: { start: ex.range[0], end: ex.range[1] } };
    return { ...base, reps: heavy ? 3 : ex.reps };
  };
  return Array.from({ length: n }, make);
}

function noteFor(ex, week) {
  const tags = [];
  if (isDeload(week)) tags.push('DELOAD week: same weight as last week, fewer sets, finish fresh.');
  if (ex.main && week >= 5 && week <= 7) tags.push('Heavy phase: 3 reps, add load vs. weeks 1–3, RPE 8.');
  return [ex.note, ...tags].join(' ');
}

// Build a Hevy routine payload for one session and week.
export function buildRoutine(session, templateMap, { week = 1, folderId = null } = {}) {
  const unresolved = session.exercises.filter((ex) => !templateMap[ex.name]).map((ex) => ex.name);
  if (unresolved.length) throw new Error(`No Hevy exercise matched: ${unresolved.join(', ')}`);
  return {
    title: `${session.title}${isDeload(week) ? ' (deload)' : ''}`,
    folder_id: folderId,
    notes: `${BLOCK.title}, week ${week} of ${BLOCK.weeks}`,
    exercises: session.exercises.map((ex) => ({
      exercise_template_id: templateMap[ex.name].id,
      superset_id: ex.ss ?? null,
      rest_seconds: ex.rest,
      notes: noteFor(ex, week),
      sets: setsFor(ex, week),
    })),
  };
}
