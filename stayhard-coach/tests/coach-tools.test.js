// Run: node --test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOOLS, createCoachTools, createSupabase, formatFooter, withFooter, localDate, mealForHour,
} from '../lib/coach-tools.js';

// ── fakes ────────────────────────────────────────────────────
function fakeDb(seed = {}) {
  const t = { food_log: [], weigh_ins: [], ...structuredClone(seed) };
  let id = 100;
  const calls = [];
  const match = (row, k, v) => {
    const [op, val] = [v.slice(0, v.indexOf('.')), v.slice(v.indexOf('.') + 1)];
    if (op === 'eq') return String(row[k]) === val;
    if (op === 'lt') return String(row[k]) < val;
    throw new Error(`fake db: unsupported op ${op}`);
  };
  return {
    tables: t, calls,
    async select(table, q) {
      calls.push(['select', table, q]);
      const p = new URLSearchParams(q);
      let rows = t[table].filter((r) => [...p].every(([k, v]) => ['select', 'order', 'limit'].includes(k) || match(r, k, v)));
      const order = p.get('order');
      if (order) {
        const [col, dir] = order.split('.');
        rows = [...rows].sort((a, b) => (a[col] < b[col] ? -1 : 1) * (dir === 'desc' ? -1 : 1));
      }
      if (p.get('limit')) rows = rows.slice(0, Number(p.get('limit')));
      return structuredClone(rows);
    },
    async insert(table, rows) {
      calls.push(['insert', table, rows]);
      const saved = rows.map((r) => ({ id: id++, ...r }));
      t[table].push(...saved);
      return structuredClone(saved);
    },
    async upsert(table, rows, key) {
      calls.push(['upsert', table, rows, key]);
      return rows.map((r) => {
        const i = t[table].findIndex((x) => x[key] === r[key]);
        const row = i >= 0 ? Object.assign(t[table][i], r) : (t[table].push({ id: id++, ...r }), t[table].at(-1));
        return structuredClone(row);
      });
    },
  };
}

const OATS = {
  fdc_id: 173904, description: 'Cereals, oats, regular and quick, not fortified, dry', data_type: 'SR Legacy',
  calories: 379, protein_g: 13.15, carbs_g: 67.7, fat_g: 6.52, fiber_g: 10.1, sugar_g: 0.99, sodium_mg: 6,
  micros: { iron_mg: 4.25, potassium_mg: 362 },
};
const PRINGLES = {
  source: 'openfoodfacts', barcode: '038000138416', fdc_id: null, name: 'Original Potato Crisps', brand: 'Pringles',
  serving: { text: '1 portion (28.349 g)', grams: 28.349, ml: null },
  label: { calories: 152, protein_g: 0.992, carbs_g: 16.2, fat_g: 9.07, fiber_g: 1.13, sugar_g: 0.283, sodium_mg: 152 },
  per100: { calories: 536 },
};
const PER100_ONLY = {
  source: 'openfoodfacts', barcode: '12345678', fdc_id: null, name: 'Oat Bar', brand: 'Acme',
  serving: { text: '40 g', grams: 40, ml: null }, label: null,
  per100: { calories: 400, protein_g: 10, carbs_g: 60, fat_g: 12, fiber_g: null, sugar_g: null, sodium_mg: 200 },
};
function fakeFood() {
  const calls = [];
  return {
    calls,
    async search_food(q, opts) {
      calls.push(['search', q, opts]);
      return [{ fdc_id: 173904, description: OATS.description, data_type: 'SR Legacy', brand: null, barcode: null,
        per100: { calories: 379, protein_g: 13.15, carbs_g: 67.7, fat_g: 6.52, fiber_g: 10.1, sugar_g: 0.99, sodium_mg: 6 } }];
    },
    async foodPer100(id) { calls.push(['per100', id]); return id === 173904 ? structuredClone(OATS) : null; },
    async lookupBarcode(code) {
      calls.push(['barcode', code]);
      return { '038000138416': PRINGLES, '12345678': PER100_ONLY }[code] ?? null;
    },
  };
}

// 2026-11-06 08:15 Central (CST, UTC-6)
const MORNING = new Date('2026-11-06T14:15:00Z');
const TARGETS = { calories: 2800, protein_g: 180 };

function setup({ seed, now = MORNING, targets = TARGETS } = {}) {
  const db = fakeDb(seed);
  const food = fakeFood();
  const coach = createCoachTools({ db, food, targets, now: () => now });
  return { db, food, coach };
}

// ── tool definitions ─────────────────────────────────────────
test('exposes exactly the six tools, each with a handler', () => {
  const { coach } = setup();
  assert.deepEqual(TOOLS.map((t) => t.name),
    ['search_food', 'lookup_barcode', 'log_food', 'get_nutrition_day', 'show_nutrition_card', 'log_weight']);
  for (const t of TOOLS) {
    assert.equal(typeof coach[t.name], 'function');
    assert.equal(t.input_schema.type, 'object');
  }
});

// ── log_food ─────────────────────────────────────────────────
describe('log_food', () => {
  test('fdc_id + grams: server computes nutrients from USDA and saves verbatim body', async () => {
    const { db, coach } = setup();
    const res = await coach.execute('log_food',
      { items: [{ fdc_id: 173904, grams: 80, description: 'Oats', quantity: '1 cup dry', meal: 'breakfast' }] },
      { userText: 'had a cup of oats before my run lol', source: 'text' });

    const [row] = db.tables.food_log;
    assert.equal(row.calories, 303.2);      // 379 * 0.8
    assert.equal(row.protein_g, 10.5);
    assert.equal(row.carbs_g, 54.2);
    assert.deepEqual(row.micros, { iron_mg: 3.4, potassium_mg: 289.6 });
    assert.equal(row.fdc_id, 173904);
    assert.equal(row.body, 'had a cup of oats before my run lol');
    assert.equal(row.source, 'text');
    assert.equal(row.log_date, '2026-11-06');
    assert.equal(row.eaten_at, MORNING.toISOString());
    assert.equal(res.footer, 'Calories: 303 / 2,800\nProtein: 11 / 180 g');
  });

  test('ignores nutrient numbers the model tries to pass with an fdc_id', async () => {
    const { db, coach } = setup();
    await coach.execute('log_food', { items: [{ fdc_id: 173904, grams: 100, calories: 9999, label: undefined }] });
    assert.equal(db.tables.food_log[0].calories, 379);
  });

  test('barcode logs 1 serving right away and names the product', async () => {
    const { db, coach } = setup();
    const res = await coach.execute('log_food', { items: [{ barcode: '038000138416' }] }, { userText: '038000138416' });

    const [row] = db.tables.food_log;
    assert.equal(row.calories, 152);
    assert.equal(row.source, 'barcode');
    assert.equal(row.barcode, '038000138416');
    assert.equal(row.description, 'Pringles Original Potato Crisps');
    assert.equal(row.quantity, '1 × 1 portion (28.349 g)');
    assert.equal(row.grams, 28.3);
    assert.equal(res.logged[0].product, 'Pringles Original Potato Crisps');
  });

  test('barcode with servings multiplies the label server-side', async () => {
    const { db, coach } = setup();
    await coach.execute('log_food', { items: [{ barcode: '038000138416', servings: 2 }] });
    assert.equal(db.tables.food_log[0].calories, 304);
    assert.equal(db.tables.food_log[0].fat_g, 18.1);
    assert.equal(db.tables.food_log[0].quantity, '2 × 1 portion (28.349 g)');
  });

  test('barcode with only per-100 g data scales by serving grams', async () => {
    const { db, coach } = setup();
    await coach.execute('log_food', { items: [{ barcode: '12345678' }] });
    assert.equal(db.tables.food_log[0].calories, 160);
    assert.equal(db.tables.food_log[0].sodium_mg, 80);
  });

  test('label values (photo of a label) are multiplied server-side', async () => {
    const { db, coach } = setup();
    await coach.execute('log_food',
      { items: [{ description: 'Gu gel', label: { calories: 100, carbs_g: 22, sodium_mg: 60 }, servings: 3, meal: 'pre' }] },
      { source: 'photo' });
    const [row] = db.tables.food_log;
    assert.deepEqual([row.calories, row.carbs_g, row.sodium_mg, row.protein_g], [300, 66, 180, null]);
    assert.equal(row.source, 'photo');
    assert.equal(row.meal, 'pre');
  });

  test('logs several items at once and the footer is the running day total', async () => {
    const { db, coach } = setup({ seed: { food_log: [
      { id: 1, log_date: '2026-11-06', eaten_at: '2026-11-06T12:00:00Z', calories: 500, protein_g: 40 },
      { id: 2, log_date: '2026-11-05', eaten_at: '2026-11-05T12:00:00Z', calories: 9000, protein_g: 900 },
    ] } });
    const res = await coach.execute('log_food', { items: [
      { fdc_id: 173904, grams: 100 },
      { barcode: '038000138416' },
    ] });
    assert.equal(db.tables.food_log.length, 4);
    assert.equal(res.totals.calories, 1031);          // 500 + 379 + 152, other days excluded
    assert.equal(res.footer, 'Calories: 1,031 / 2,800\nProtein: 54 / 180 g');
    assert.equal(res.remaining.calories, 1769);
  });

  test('one bad item saves nothing and returns an error the model can act on', async () => {
    const { db, coach } = setup();
    const res = await coach.execute('log_food', { items: [
      { fdc_id: 173904, grams: 50 },
      { barcode: '99999999' },
    ] });
    assert.match(res.error, /Item 2.*no product found for barcode 99999999/);
    assert.equal(db.tables.food_log.length, 0);
    assert.equal(db.calls.filter((c) => c[0] === 'insert').length, 0);
  });

  test('rejects items the server cannot compute', async () => {
    const { coach } = setup();
    const cases = [
      [{ description: 'Burrito' }, /needs fdc_id \+ grams, a barcode, or label/],
      [{ fdc_id: 173904 }, /needs grams/],
      [{ fdc_id: 173904, grams: 0 }, /needs grams/],
      [{ fdc_id: 1, grams: 50 }, /no food with fdc_id 1/],
      [{ fdc_id: 173904, grams: 50, barcode: '038000138416' }, /only one of/],
      [{ label: { protein_g: 20 }, description: 'Shake' }, /at least calories/],
      [{ label: { calories: 200 } }, /need a description/],
      [{ barcode: '038000138416', servings: 0 }, /servings must be/],
      [{ fdc_id: 173904, grams: 50, meal: 'brunch' }, /meal must be one of/],
    ];
    for (const [item, re] of cases) {
      const res = await coach.execute('log_food', { items: [item] });
      assert.match(res.error ?? '', re, JSON.stringify(item));
    }
    assert.match((await coach.execute('log_food', { items: [] })).error, /at least one item/);
  });

  test('infers meal and log_date from Central time, not UTC', async () => {
    // 2026-11-07 03:30 UTC is 2026-11-06 21:30 Central
    const { db, coach } = setup({ now: new Date('2026-11-07T03:30:00Z') });
    await coach.execute('log_food', { items: [{ fdc_id: 173904, grams: 40 }] });
    assert.equal(db.tables.food_log[0].log_date, '2026-11-06');
    assert.equal(db.tables.food_log[0].meal, 'snack');
  });

  test('can log to a past date', async () => {
    const { db, coach } = setup();
    await coach.execute('log_food', { items: [{ fdc_id: 173904, grams: 40 }], date: '2026-11-04' });
    assert.equal(db.tables.food_log[0].log_date, '2026-11-04');
    assert.equal(db.tables.food_log[0].eaten_at, '2026-11-04T18:00:00.000Z', 'stamped on that day, not today');
    assert.equal(db.tables.food_log[0].meal, 'snack');
    assert.match((await coach.execute('log_food', { items: [{ fdc_id: 173904, grams: 40 }], date: '11/4' })).error, /YYYY-MM-DD/);
  });
});

// ── get_nutrition_day ────────────────────────────────────────
describe('get_nutrition_day', () => {
  test('returns items, totals, target and remaining for today', async () => {
    const { coach } = setup({ seed: { food_log: [
      { id: 1, log_date: '2026-11-06', eaten_at: '2026-11-06T13:00:00Z', description: 'Eggs', calories: 210, protein_g: 18, carbs_g: 1, fat_g: 15 },
      { id: 2, log_date: '2026-11-06', eaten_at: '2026-11-06T12:00:00Z', description: 'Coffee', calories: 5, protein_g: 0.3 },
    ] } });
    const day = await coach.execute('get_nutrition_day', {});
    assert.equal(day.date, '2026-11-06');
    assert.deepEqual(day.items.map((i) => i.description), ['Coffee', 'Eggs']);
    assert.equal(day.totals.calories, 215);
    assert.equal(day.totals.protein_g, 18.3);
    assert.deepEqual(day.target, TARGETS);
    assert.deepEqual(day.remaining, { calories: 2585, protein_g: 161.7 });
  });

  test('empty day and a specific date', async () => {
    const { coach, db } = setup();
    const day = await coach.execute('get_nutrition_day', { date: '2026-10-25' });
    assert.equal(day.items.length, 0);
    assert.equal(day.totals.calories, 0);
    assert.match(db.calls[0][2], /log_date=eq\.2026-10-25/);
  });

  test('targets can be a function of the date (e.g. long-run days)', async () => {
    const db = fakeDb();
    const coach = createCoachTools({
      db, food: fakeFood(), now: () => MORNING,
      targets: async (d) => (d === '2026-11-08' ? { calories: 3400, protein_g: 180 } : TARGETS),
    });
    assert.equal((await coach.execute('get_nutrition_day', { date: '2026-11-08' })).target.calories, 3400);
    assert.equal((await coach.execute('get_nutrition_day', {})).target.calories, 2800);
  });
});

// ── log_weight ───────────────────────────────────────────────
describe('log_weight', () => {
  test('saves today and reports change since last weigh-in', async () => {
    const { db, coach } = setup({ seed: { weigh_ins: [
      { id: 1, weigh_date: '2026-11-01', weight_lb: 171.0 },
      { id: 2, weigh_date: '2026-11-04', weight_lb: 170.4 },
    ] } });
    const res = await coach.execute('log_weight', { weight_lb: 169.84 });
    assert.deepEqual(res, {
      weigh_date: '2026-11-06', weight_lb: 169.8,
      previous: { date: '2026-11-04', weight_lb: 170.4 }, change_lb: -0.6,
    });
    assert.equal(db.tables.weigh_ins.at(-1).source, 'telegram');
  });

  test('second weigh-in the same day replaces the first', async () => {
    const { db, coach } = setup();
    await coach.execute('log_weight', { weight_lb: 172 });
    await coach.execute('log_weight', { weight_lb: 171.2 });
    assert.equal(db.tables.weigh_ins.length, 1);
    assert.equal(db.tables.weigh_ins[0].weight_lb, 171.2);
    assert.equal(db.calls.find((c) => c[0] === 'upsert')[3], 'weigh_date');
  });

  test('rejects implausible weights', async () => {
    const { coach } = setup();
    for (const w of [17, 1700, 'heavy', null]) {
      assert.match((await coach.execute('log_weight', { weight_lb: w })).error, /looks wrong/);
    }
  });
});

// ── search_food / lookup_barcode ─────────────────────────────
describe('lookup tools', () => {
  test('search_food returns compact matches and clamps limit', async () => {
    const { coach, food } = setup();
    const res = await coach.execute('search_food', { query: 'oats', limit: 50 });
    assert.equal(res.results[0].fdc_id, 173904);
    assert.deepEqual(Object.keys(res.results[0].per100g), ['calories', 'protein_g', 'carbs_g', 'fat_g']);
    assert.equal(food.calls[0][2].limit, 10);
  });

  test('lookup_barcode reads without logging', async () => {
    const { coach, db } = setup();
    assert.equal((await coach.execute('lookup_barcode', { barcode: '038000138416' })).name, 'Original Potato Crisps');
    assert.deepEqual(await coach.execute('lookup_barcode', { barcode: '11111111' }), { found: false, barcode: '11111111' });
    assert.equal(db.calls.length, 0);
  });

  test('unknown tool returns an error', async () => {
    const { coach } = setup();
    assert.match((await coach.execute('delete_everything', {})).error, /Unknown tool/);
  });
});

// ── footer helpers ───────────────────────────────────────────
describe('footer', () => {
  test('one line per number, carbs/fat only when targeted', () => {
    assert.equal(formatFooter({ calories: 1840.4, protein_g: 142.6 }, { calories: 2800, protein_g: 180 }),
      'Calories: 1,840 / 2,800\nProtein: 143 / 180 g');
    assert.equal(formatFooter({ calories: 900, protein_g: 60, carbs_g: 120, fat_g: 30 },
      { calories: 2800, protein_g: 180, carbs_g: 400, fat_g: 80 }),
      'Calories: 900 / 2,800\nProtein: 60 / 180 g\nCarbs: 120 / 400 g\nFat: 30 / 80 g');
    assert.equal(formatFooter({ calories: 900, protein_g: 60 }, {}),
      'Calories: 900 / no target set\nProtein: 60 / no target set');
  });

  test('withFooter replaces whatever totals the model wrote with the real ones', () => {
    const footer = 'Calories: 1,031 / 2,800\nProtein: 54 / 180 g';
    assert.equal(withFooter('Logged Pringles.\n\nCalories: 1000 / 2800\nprotein: 50/180g', footer),
      `Logged Pringles.\n\n${footer}`);
    assert.equal(withFooter(`Logged.\n\n${footer}`, footer), `Logged.\n\n${footer}`);
    assert.equal(withFooter('Nice work.', null), 'Nice work.');
  });
});

// ── helpers + Supabase client ────────────────────────────────
test('Central date and meal-of-day helpers', () => {
  assert.equal(localDate(new Date('2026-11-07T05:59:00Z')), '2026-11-06');
  assert.equal(localDate(new Date('2026-11-07T06:00:00Z')), '2026-11-07');
  assert.deepEqual([6, 12, 16, 19, 23, 2].map(mealForHour), ['breakfast', 'lunch', 'snack', 'dinner', 'snack', 'snack']);
});

describe('createSupabase', () => {
  const mk = (status = 200, body = '[]') => {
    const calls = [];
    const fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: status < 300, status, text: async () => body }; };
    return { calls, db: createSupabase({ url: 'https://x.supabase.co/', key: 'sb_key', fetch }) };
  };

  test('sends auth headers, representation and upsert preferences', async () => {
    const { calls, db } = mk(201, '[{"id":1}]');
    await db.insert('food_log', [{ a: 1 }]);
    await db.upsert('weigh_ins', [{ weigh_date: '2026-11-06' }], 'weigh_date');
    assert.equal(calls[0].url, 'https://x.supabase.co/rest/v1/food_log');
    assert.equal(calls[0].opts.headers.apikey, 'sb_key');
    assert.equal(calls[0].opts.headers.Authorization, 'Bearer sb_key');
    assert.equal(calls[0].opts.headers.Prefer, 'return=representation');
    assert.equal(calls[1].url, 'https://x.supabase.co/rest/v1/weigh_ins?on_conflict=weigh_date');
    assert.match(calls[1].opts.headers.Prefer, /resolution=merge-duplicates/);
  });

  test('errors include status and body but not the key', async () => {
    const { db } = mk(400, '{"message":"violates check constraint food_log_meal_check"}');
    await assert.rejects(db.insert('food_log', [{}]), (e) => /400/.test(e.message) && /meal_check/.test(e.message) && !e.message.includes('sb_key'));
  });
});
