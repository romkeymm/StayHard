// Run: npm test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSIONS, BLOCK, LOWER, resolveTemplates, buildRoutine, weekOf, isDeload, scheduleWeek, weekType, mondayOf,
} from '../lib/strength-block.js';
import { createHevy } from '../lib/hevy.js';

// A fake Hevy library covering every exercise (titles in Hevy's style).
const LIBRARY = [
  'Trap Bar Deadlift', 'Romanian Deadlift (Barbell)', 'Pallof Press', 'Bulgarian Split Squat',
  'Nordic Hamstrings Curls', 'Seated Calf Raise', 'Bench Press (Barbell)',
  'Chest Supported Incline Row (Dumbbell)', 'Single Arm Overhead Press (Dumbbell)', 'Lat Pulldown (Cable)',
  'Copenhagen Plank', 'Farmers Walk', 'Front Squat (Barbell)', 'Single Leg Romanian Deadlift (Dumbbell)',
  'Step Up', 'Hip Thrust (Barbell)', 'Seated Leg Curl (Machine)', 'Standing Calf Raise (Machine)', 'Tibialis Raise',
  'Squat (Barbell)', 'Deadlift (Barbell)',
].map((title, i) => ({ id: `T${i}`, title }));

const fullMap = () => resolveTemplates(LIBRARY).map;

describe('custody-aware schedule', () => {
  test('week 1 (Nov 9) is a heavy kid week: L Wed, B Thu, long run Fri', () => {
    const w = scheduleWeek('2026-11-09');
    assert.equal(w.type, 'heavy');
    assert.deepEqual(w.kidDays, ['2026-11-09', '2026-11-10', '2026-11-13', '2026-11-14', '2026-11-15']);
    assert.equal(w.longRun, '2026-11-13');
    assert.deepEqual(w.lifts, [
      { day: 'Wed', date: '2026-11-11', session: 'L' },
      { day: 'Thu', date: '2026-11-12', session: 'B' },
    ]);
  });

  test('week 2 (Nov 16) is a light kid week: A Mon, B Tue, C Sun, long run Sat', () => {
    const w = scheduleWeek('2026-11-19');
    assert.equal(w.weekOf, '2026-11-16');
    assert.equal(w.type, 'light');
    assert.deepEqual(w.kidDays, ['2026-11-18', '2026-11-19']);
    assert.equal(w.longRun, '2026-11-21');
    assert.deepEqual(w.lifts.map((l) => `${l.day} ${l.session}`), ['Mon A', 'Tue B', 'Sun C']);
  });

  test('matches this week as described: kids Wed and Thu (Nov 4–5)', () => {
    assert.equal(weekType('2026-11-06'), 'light');
    assert.deepEqual(scheduleWeek('2026-11-06').kidDays, ['2026-11-04', '2026-11-05']);
  });

  test('rules hold across the whole block and every week boundary', () => {
    const days = [];
    for (let i = 0; i < 8; i++) {
      const monday = new Date(Date.parse('2026-11-09T00:00:00Z') + i * 7 * 86_400_000).toISOString().slice(0, 10);
      const w = scheduleWeek(monday);
      for (const l of w.lifts) {
        assert.ok(!w.kidDays.includes(l.date), `lift on kid day ${l.date}`);
        const dayBeforeLong = new Date(Date.parse(`${w.longRun}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
        if (LOWER.has(l.session)) assert.notEqual(l.date, dayBeforeLong, `lower day before long run ${l.date}`);
        days.push(l);
      }
    }
    for (let i = 1; i < days.length; i++) {
      const gap = (Date.parse(days[i].date) - Date.parse(days[i - 1].date)) / 86_400_000;
      if (LOWER.has(days[i].session) && LOWER.has(days[i - 1].session)) assert.ok(gap >= 2, `back-to-back lower ${days[i].date}`);
    }
    assert.equal(days.length, 20, '2 + 3 sessions per fortnight over 8 weeks');
  });

  test('mondayOf handles Sundays and year boundaries', () => {
    assert.equal(mondayOf('2026-11-15'), '2026-11-09');
    assert.equal(mondayOf('2027-01-03'), '2026-12-28');
    assert.equal(weekType('2027-01-03'), 'light');
  });
});

describe('block design', () => {
  test('four sessions, each ~45 minutes of work', () => {
    assert.deepEqual(SESSIONS.map((s) => s.key), ['A', 'B', 'C', 'L']);
    for (const s of SESSIONS) {
      // rough time: sets × (work ~40 s + rest), supersets share rest
      const seconds = s.exercises.reduce((sum, ex) => sum + ex.sets * (40 + (ex.ss != null ? ex.rest / 2 : ex.rest)), 0);
      assert.ok(seconds / 60 <= 47, `${s.key} ≈ ${Math.round(seconds / 60)} min`);
    }
  });

  test('hamstrings get hinge, eccentric and single-leg work in both week types', () => {
    const has = (keys, re) => SESSIONS.filter((s) => keys.includes(s.key)).flatMap((s) => s.exercises).some((e) => re.test(e.name));
    for (const keys of [['L', 'B'], ['A', 'B', 'C']]) {
      assert.ok(has(keys, /deadlift/i), `hinge in ${keys}`);
      assert.ok(has(keys, /nordic|leg curl/i), `eccentric in ${keys}`);
      assert.ok(has(keys, /single-leg|split squat/i), `single-leg in ${keys}`);
    }
  });

  test('superset groups always pair exactly two exercises', () => {
    for (const s of SESSIONS) {
      const groups = {};
      for (const e of s.exercises) if (e.ss != null) groups[e.ss] = (groups[e.ss] ?? 0) + 1;
      for (const [g, n] of Object.entries(groups)) assert.equal(n, 2, `${s.key} superset ${g}`);
    }
  });

  test('week math: block dates, deloads on 4 and 8', () => {
    assert.equal(weekOf('2026-11-09'), 1);
    assert.equal(weekOf('2026-11-15'), 1);
    assert.equal(weekOf('2026-11-30'), 4);
    assert.equal(weekOf('2027-01-03'), 8);
    assert.equal(weekOf('2026-10-01'), 1, 'clamped');
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].filter((w) => isDeload(w)), [4, 8]);
    assert.equal(BLOCK.start, '2026-11-09');
  });
});

describe('template matching', () => {
  test('matches every exercise against a full library', () => {
    const { map, missing } = resolveTemplates(LIBRARY);
    assert.deepEqual(missing, []);
    assert.equal(map['Trap-bar deadlift'].title, 'Trap Bar Deadlift');
    assert.equal(map['Nordic hamstring curl'].title, 'Nordic Hamstrings Curls');
  });

  test('prefers exact titles and never confuses similar lifts', () => {
    const { map } = resolveTemplates(LIBRARY);
    assert.equal(map['Romanian deadlift'].title, 'Romanian Deadlift (Barbell)');
    assert.notEqual(map['Trap-bar deadlift'].title, 'Deadlift (Barbell)');
    assert.equal(map['Single-leg RDL'].title, 'Single Leg Romanian Deadlift (Dumbbell)');
  });

  test('reports missing exercises instead of guessing', () => {
    const lib = LIBRARY.filter((t) => !/Copenhagen|Tibialis/.test(t.title));
    const { missing } = resolveTemplates(lib);
    assert.deepEqual(missing, ['Copenhagen plank', 'Tibialis raise']);
  });

  test('falls back to "starts with" for equipment suffixes', () => {
    const lib = [...LIBRARY.filter((t) => t.title !== 'Pallof Press'), { id: 'X', title: 'Pallof Press (Cable)' }];
    assert.equal(resolveTemplates(lib).map['Pallof press'].id, 'X');
  });
});

describe('routine payloads', () => {
  const [A, B] = SESSIONS;

  test('week 1: no weights, reps/ranges set, supersets and pinned notes', () => {
    const r = buildRoutine(A, fullMap(), { week: 1, folderId: 7 });
    assert.equal(r.title, 'A · Lower (hinge)');
    assert.equal(r.folder_id, 7);
    const [dl, rdl, pallof, bss, nordic] = r.exercises;
    assert.equal(dl.sets.length, 4);
    assert.ok(dl.sets.every((s) => s.reps === 5 && s.weight_kg === null && s.type === 'normal'));
    assert.match(dl.notes, /RPE 7–8/);
    assert.equal(dl.superset_id, null);
    assert.equal(rdl.superset_id, 0);
    assert.equal(pallof.superset_id, 0);
    assert.equal(bss.superset_id, 1);
    assert.deepEqual(nordic.sets[0].rep_range, { start: 4, end: 6 });
    assert.equal(nordic.sets[0].reps, null);
  });

  test('duration and carry exercises use the right set fields', () => {
    const r = buildRoutine(B, fullMap());
    const cph = r.exercises.find((e) => e.notes.startsWith('20 s'));
    const carry = r.exercises.find((e) => e.notes.startsWith('40 m'));
    assert.equal(cph.sets[0].duration_seconds, 20);
    assert.equal(cph.sets[0].reps, null);
    assert.equal(carry.sets[0].distance_meters, 40);
  });

  test('deload weeks cut sets ~40% and say so', () => {
    const r = buildRoutine(A, fullMap(), { week: 4 });
    assert.equal(r.title, 'A · Lower (hinge) (deload)');
    assert.equal(r.exercises[0].sets.length, 2); // 4 → 2
    assert.equal(r.exercises[1].sets.length, 2); // 3 → 2
    assert.match(r.exercises[0].notes, /DELOAD/);
  });

  test('heavy phase (weeks 5–7): main lifts drop to 3 reps, accessories unchanged', () => {
    const r = buildRoutine(A, fullMap(), { week: 6 });
    assert.ok(r.exercises[0].sets.every((s) => s.reps === 3));
    assert.match(r.exercises[0].notes, /Heavy phase/);
    assert.ok(r.exercises[1].sets.every((s) => s.reps === 8));
  });

  test('refuses to build with unmatched exercises', () => {
    const { map } = resolveTemplates(LIBRARY.filter((t) => t.title !== 'Nordic Hamstrings Curls'));
    assert.throws(() => buildRoutine(A, map), /No Hevy exercise matched: Nordic hamstring curl/);
  });
});

describe('hevy client', () => {
  const mk = (responses) => {
    const calls = [];
    const fetch = async (url, opts) => {
      calls.push({ url, opts });
      const [status, body] = responses.shift() ?? [200, {}];
      return { ok: status < 300, status, text: async () => JSON.stringify(body) };
    };
    return { calls, hevy: createHevy({ apiKey: 'hv-SECRET', fetch }) };
  };

  test('sends api-key header and paginates exercise templates', async () => {
    const { calls, hevy } = mk([
      [200, { page: 1, page_count: 2, exercise_templates: [{ id: 'a' }] }],
      [200, { page: 2, page_count: 2, exercise_templates: [{ id: 'b' }] }],
    ]);
    const all = await hevy.listExerciseTemplates();
    assert.deepEqual(all.map((t) => t.id), ['a', 'b']);
    assert.equal(calls[0].opts.headers['api-key'], 'hv-SECRET');
    assert.match(calls[1].url, /page=2&pageSize=100/);
  });

  test('createRoutine wraps the body and unwraps array responses', async () => {
    const { calls, hevy } = mk([[201, { routine: [{ id: 'r1', title: 'A' }] }]]);
    const r = await hevy.createRoutine({ title: 'A', exercises: [] });
    assert.equal(r.id, 'r1');
    assert.deepEqual(JSON.parse(calls[0].opts.body), { routine: { title: 'A', exercises: [] } });
  });

  test('updateRoutine drops folder_id (Hevy rejects it on PUT)', async () => {
    const { calls, hevy } = mk([[200, { routine: { id: 'r1' } }]]);
    await hevy.updateRoutine('r1', { title: 'A', folder_id: 3, exercises: [] });
    assert.equal(calls[0].opts.method, 'PUT');
    assert.deepEqual(JSON.parse(calls[0].opts.body), { routine: { title: 'A', exercises: [] } });
  });

  test('errors carry status and body but not the key', async () => {
    const { hevy } = mk([[403, { error: 'Pro required' }]]);
    await assert.rejects(hevy.listRoutines(), (e) => /403/.test(e.message) && /Pro required/.test(e.message) && !e.message.includes('SECRET'));
  });
});
