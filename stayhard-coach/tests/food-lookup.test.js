// Run: node --test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createFoodLookup, scale } from '../lib/food-lookup.js';

// ── mock fetch ───────────────────────────────────────────────
// routes: array of [predicate(url) | substring, body | (url)=>body, status]
function mockFetch(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, headers: opts.headers ?? {} });
    const route = routes.find(([m]) => (typeof m === 'function' ? m(url) : url.includes(m)));
    if (!route) return { ok: false, status: 404, json: async () => ({}) };
    const [, body, status = 200] = route;
    const payload = typeof body === 'function' ? body(url) : body;
    return { ok: status >= 200 && status < 300, status, json: async () => payload };
  };
  fn.calls = calls;
  return fn;
}

// ── fixtures (shapes match real FDC / OFF responses) ─────────
const searchBanana = {
  foods: [
    {
      fdcId: 1105314, description: 'Bananas, ripe and slightly ripe, raw', dataType: 'Foundation',
      foodNutrients: [
        { nutrientNumber: '203', unitName: 'G', value: 0.74 },
        { nutrientNumber: '204', unitName: 'G', value: 0.29 },
        { nutrientNumber: '205', unitName: 'G', value: 23 },
        { nutrientNumber: '268', unitName: 'kJ', value: 410 },     // kJ must be ignored
        { nutrientNumber: '958', unitName: 'KCAL', value: 97.5 }, // Atwater specific
        { nutrientNumber: '291', unitName: 'G', value: 1.7 },
        { nutrientNumber: '269.3', unitName: 'G', value: 15.8 },
        { nutrientNumber: '307', unitName: 'MG', value: 0 },
      ],
    },
    {
      fdcId: 173944, description: 'Bananas, raw', dataType: 'SR Legacy',
      foodNutrients: [
        { nutrientNumber: '208', unitName: 'KCAL', value: 89 },
        { nutrientNumber: '203', unitName: 'G', value: 1.09 },
      ],
    },
    { fdcId: 3, description: 'Banana chips', dataType: 'Branded', brandOwner: 'Acme', gtinUpc: '012345678905', foodNutrients: [] },
  ],
};

const foodDetailOats = {
  fdcId: 173904, description: 'Cereals, oats, regular and quick, not fortified, dry', dataType: 'SR Legacy',
  foodNutrients: [
    { nutrient: { number: '208', unitName: 'kcal' }, amount: 379 },
    { nutrient: { number: '268', unitName: 'kJ' }, amount: 1586 },
    { nutrient: { number: '203', unitName: 'g' }, amount: 13.15 },
    { nutrient: { number: '205', unitName: 'g' }, amount: 67.7 },
    { nutrient: { number: '204', unitName: 'g' }, amount: 6.52 },
    { nutrient: { number: '291', unitName: 'g' }, amount: 10.1 },
    { nutrient: { number: '269', unitName: 'g' }, amount: 0.99 },
    { nutrient: { number: '307', unitName: 'mg' }, amount: 6 },
    { nutrient: { number: '303', unitName: 'mg' }, amount: 4.25 },
    { nutrient: { number: '306', unitName: 'mg' }, amount: 362 },
  ],
};

const offNutella = {
  status: 1,
  product: {
    code: '3017620422003', product_name: 'Nutella', brands: 'Ferrero, Nutella',
    serving_size: '15 g', serving_quantity: '15',
    nutriments: {
      'energy-kcal_100g': 539, proteins_100g: 6.3, carbohydrates_100g: 57.5, fat_100g: 30.9,
      sugars_100g: 56.3, salt_100g: 0.107,
      'energy-kcal_serving': 80.9, proteins_serving: 0.945, carbohydrates_serving: 8.63,
      fat_serving: 4.64, sugars_serving: 8.45, sodium_serving: 0.0064,
    },
  },
};

const brandedDetail = {
  fdcId: 2000001, description: 'PROTEIN BAR, CHOCOLATE', dataType: 'Branded',
  brandName: 'RXBAR', brandOwner: 'Chicago Bar Co', gtinUpc: '00858562005007',
  servingSize: 52, servingSizeUnit: 'g', householdServingFullText: '1 bar',
  labelNutrients: {
    calories: { value: 210 }, protein: { value: 12 }, carbohydrates: { value: 23 },
    fat: { value: 9 }, fiber: { value: 5 }, sugars: { value: 13 }, sodium: { value: 260 },
  },
  foodNutrients: [
    { nutrient: { number: '208', unitName: 'kcal' }, amount: 404 },
    { nutrient: { number: '203', unitName: 'g' }, amount: 23.1 },
  ],
};

const KEY = 'test-key';

// ── search_food ──────────────────────────────────────────────
describe('search_food', () => {
  test('returns top matches with fdc_id and per-100 g macros', async () => {
    const fetch = mockFetch([['/foods/search', searchBanana]]);
    const { search_food } = createFoodLookup({ apiKey: KEY, fetch });
    const res = await search_food('banana', { limit: 2 });

    assert.equal(res.length, 2);
    assert.equal(res[0].fdc_id, 1105314);
    assert.equal(res[0].data_type, 'Foundation');
    assert.equal(res[0].per100.calories, 97.5, 'falls back to Atwater kcal, ignores kJ');
    assert.equal(res[0].per100.sugar_g, 15.8);
    assert.equal(res[1].per100.calories, 89);
    assert.equal(res[1].per100.fat_g, null, 'missing values stay null');
  });

  test('passes key, query and filters as query params (browser CORS safe)', async () => {
    const fetch = mockFetch([['/foods/search', { foods: [] }]]);
    const { search_food } = createFoodLookup({ apiKey: KEY, fetch });
    await search_food('  greek yogurt ', { limit: 5, dataType: ['Foundation', 'SR Legacy'] });

    const { url, headers } = fetch.calls[0];
    const u = new URL(url);
    assert.equal(u.searchParams.get('query'), 'greek yogurt');
    assert.equal(u.searchParams.get('pageSize'), '5');
    assert.equal(u.searchParams.get('dataType'), 'Foundation,SR Legacy');
    assert.equal(u.searchParams.get('api_key'), KEY);
    assert.equal(headers['X-Api-Key'], undefined, 'custom header breaks /food/{id} preflight');
  });

  test('error messages never include the API key', async () => {
    const fetch = mockFetch([['/foods/search', {}, 500]]);
    const { search_food } = createFoodLookup({ apiKey: KEY, fetch });
    await assert.rejects(search_food('rice'), (e) => !e.message.includes(KEY) && /500/.test(e.message));
  });

  test('includes brand and barcode for branded items', async () => {
    const fetch = mockFetch([['/foods/search', searchBanana]]);
    const { search_food } = createFoodLookup({ apiKey: KEY, fetch });
    const [, , chips] = await search_food('banana');
    assert.equal(chips.brand, 'Acme');
    assert.equal(chips.barcode, '012345678905');
  });

  test('rejects empty query and missing key', async () => {
    const fetch = mockFetch([]);
    const { search_food } = createFoodLookup({ apiKey: KEY, fetch });
    await assert.rejects(search_food('   '), /needs a query/);

    const saved = process.env.FDC_API_KEY;
    delete process.env.FDC_API_KEY;
    const noKey = createFoodLookup({ fetch });
    await assert.rejects(noKey.search_food('rice'), /FDC_API_KEY is not set/);
    if (saved !== undefined) process.env.FDC_API_KEY = saved;
  });

  test('surfaces API errors with status', async () => {
    const fetch = mockFetch([['/foods/search', {}, 429]]);
    const { search_food } = createFoodLookup({ apiKey: KEY, fetch });
    await assert.rejects(search_food('rice'), /429/);
  });
});

// ── foodPer100 ───────────────────────────────────────────────
describe('foodPer100', () => {
  test('parses detail-shaped nutrients and micros', async () => {
    const fetch = mockFetch([['/food/173904', foodDetailOats]]);
    const { foodPer100 } = createFoodLookup({ apiKey: KEY, fetch });
    const oats = await foodPer100(173904);

    assert.deepEqual(
      { calories: oats.calories, protein_g: oats.protein_g, carbs_g: oats.carbs_g, fat_g: oats.fat_g,
        fiber_g: oats.fiber_g, sugar_g: oats.sugar_g, sodium_mg: oats.sodium_mg },
      { calories: 379, protein_g: 13.15, carbs_g: 67.7, fat_g: 6.52, fiber_g: 10.1, sugar_g: 0.99, sodium_mg: 6 },
    );
    assert.deepEqual(oats.micros, { potassium_mg: 362, iron_mg: 4.25 });
    assert.equal(oats.fdc_id, 173904);
  });

  test('computes calories from macros when no energy value exists', async () => {
    const fetch = mockFetch([['/food/1', {
      fdcId: 1, description: 'x', foodNutrients: [
        { nutrient: { number: '203', unitName: 'g' }, amount: 10 },
        { nutrient: { number: '205', unitName: 'g' }, amount: 20 },
        { nutrient: { number: '204', unitName: 'g' }, amount: 5 },
      ],
    }]]);
    const { foodPer100 } = createFoodLookup({ apiKey: KEY, fetch });
    assert.equal((await foodPer100(1)).calories, 165);
  });

  test('returns null for unknown id and rejects bad ids', async () => {
    const fetch = mockFetch([]);
    const { foodPer100 } = createFoodLookup({ apiKey: KEY, fetch });
    assert.equal(await foodPer100(999), null);
    await assert.rejects(foodPer100('abc'), /Invalid fdc_id/);
    await assert.rejects(foodPer100(-4), /Invalid fdc_id/);
  });
});

// ── scale ────────────────────────────────────────────────────
describe('scale', () => {
  const per100 = { calories: 379, protein_g: 13.15, carbs_g: 67.7, fat_g: 6.52, fiber_g: 10.1,
    sugar_g: 0.99, sodium_mg: 6, micros: { iron_mg: 4.25, potassium_mg: 362 } };

  test('scales every nutrient to the given grams, rounded to 0.1', () => {
    assert.deepEqual(scale(per100, 40), {
      grams: 40, calories: 151.6, protein_g: 5.3, carbs_g: 27.1, fat_g: 2.6,
      fiber_g: 4, sugar_g: 0.4, sodium_mg: 2.4, micros: { iron_mg: 1.7, potassium_mg: 144.8 },
    });
  });

  test('100 g is identity, 0 g is zero', () => {
    assert.equal(scale(per100, 100).calories, 379);
    assert.equal(scale(per100, 0).protein_g, 0);
  });

  test('keeps missing values null and rejects bad input', () => {
    assert.equal(scale({ calories: 50 }, 200).fat_g, null);
    assert.throws(() => scale(per100, -5), /Invalid grams/);
    assert.throws(() => scale(per100, 'lots'), /Invalid grams/);
    assert.throws(() => scale(null, 10), /per-100 g/);
  });
});

// ── lookupBarcode ────────────────────────────────────────────
describe('lookupBarcode', () => {
  test('validates length: 8 to 14 digits only', async () => {
    const { lookupBarcode } = createFoodLookup({ apiKey: KEY, fetch: mockFetch([]) });
    for (const bad of ['1234567', '123456789012345', '12345abc90', '', null]) {
      await assert.rejects(lookupBarcode(bad), /8 to 14 digits/, `should reject ${bad}`);
    }
  });

  test('uses Open Food Facts first and returns label + per-100 g nutrients', async () => {
    const fetch = mockFetch([['openfoodfacts.org', offNutella]]);
    const { lookupBarcode } = createFoodLookup({ apiKey: KEY, fetch });
    const r = await lookupBarcode('3017620422003');

    assert.equal(r.source, 'openfoodfacts');
    assert.equal(r.name, 'Nutella');
    assert.equal(r.brand, 'Ferrero');
    assert.deepEqual(r.serving, { text: '15 g', grams: 15, ml: null });
    assert.equal(r.label.calories, 80.9);
    assert.equal(r.label.sodium_mg, 6.4, 'OFF sodium grams converted to mg');
    assert.equal(r.per100.sodium_mg, 42.8, 'derived from salt / 2.5 when sodium missing');
    assert.equal(fetch.calls.length, 1, 'USDA not called when OFF hits');
  });

  test('derives label from per-100 g when OFF has no per-serving values', async () => {
    const fetch = mockFetch([['openfoodfacts.org', { status: 1, product: {
      product_name: 'Oat bar', brands: 'Acme', serving_size: '40 g', serving_quantity: 40,
      nutriments: { 'energy-kcal_100g': 400, proteins_100g: 10, carbohydrates_100g: 60, fat_100g: 12, sodium_100g: 0.2 },
    } }]]);
    const { lookupBarcode } = createFoodLookup({ apiKey: KEY, fetch });
    const r = await lookupBarcode('12345678');
    assert.deepEqual(r.label, { calories: 160, protein_g: 4, carbs_g: 24, fat_g: 4.8,
      fiber_g: null, sugar_g: null, sodium_mg: 80 });
  });

  test('reports drinks in ml, not grams', async () => {
    const fetch = mockFetch([['openfoodfacts.org', { status: 1, product: {
      product_name: 'Coca-Cola Original', brands: 'Coca-Cola', serving_size: '1 portion (330 ml)',
      serving_quantity: 330, serving_quantity_unit: 'ml',
      nutriments: { 'energy-kcal_100g': 42.4, 'energy-kcal_serving': 140 },
    } }]]);
    const { lookupBarcode } = createFoodLookup({ apiKey: KEY, fetch });
    const r = await lookupBarcode('5449000000996');
    assert.deepEqual(r.serving, { text: '1 portion (330 ml)', grams: null, ml: 330 });
    assert.equal(r.label.calories, 140);
  });

  test('tries the EAN-13 form of a 12-digit UPC on Open Food Facts', async () => {
    const fetch = mockFetch([[(u) => u.includes('/0012345678905.json'), offNutella]]);
    const { lookupBarcode } = createFoodLookup({ apiKey: KEY, fetch });
    const r = await lookupBarcode('012345678905');
    assert.equal(r.source, 'openfoodfacts');
    assert.equal(fetch.calls.length, 2);
  });

  test('falls back to USDA branded foods, matching GTIN despite leading zeros', async () => {
    const fetch = mockFetch([
      ['openfoodfacts.org', { status: 0 }],
      ['/foods/search', { foods: [
        { fdcId: 999, description: 'WRONG', gtinUpc: '00000000000001' },
        { fdcId: 2000001, description: 'PROTEIN BAR', gtinUpc: '00858562005007' },
      ] }],
      ['/food/2000001', brandedDetail],
    ]);
    const { lookupBarcode } = createFoodLookup({ apiKey: KEY, fetch });
    const r = await lookupBarcode('858562005007');

    assert.equal(r.source, 'usda_branded');
    assert.equal(r.fdc_id, 2000001);
    assert.equal(r.brand, 'RXBAR');
    assert.deepEqual(r.serving, { text: '1 bar', grams: 52, ml: null });
    assert.deepEqual(r.label, { calories: 210, protein_g: 12, carbs_g: 23, fat_g: 9,
      fiber_g: 5, sugar_g: 13, sodium_mg: 260 });
    assert.equal(r.per100.calories, 404);

    const search = new URL(fetch.calls.find((c) => c.url.includes('/foods/search')).url);
    assert.equal(search.searchParams.get('dataType'), 'Branded');
  });

  test('retries USDA with zero-padded GTIN-14 when the UPC form finds nothing', async () => {
    const fetch = mockFetch([
      ['openfoodfacts.org', { status: 0 }],
      [(u) => u.includes('/foods/search') && u.includes('query=00038000138416'),
        { foods: [{ fdcId: 2000001, gtinUpc: '00038000138416' }] }],
      ['/foods/search', { foods: [] }],
      ['/food/2000001', brandedDetail],
    ]);
    const { lookupBarcode } = createFoodLookup({ apiKey: KEY, fetch });
    const r = await lookupBarcode('038000138416');
    assert.equal(r.source, 'usda_branded');
    const tried = fetch.calls.filter((c) => c.url.includes('/foods/search'))
      .map((c) => new URL(c.url).searchParams.get('query'));
    assert.deepEqual(tried, ['038000138416', '0038000138416', '00038000138416']);
  });

  test('returns null when neither source knows the barcode', async () => {
    const fetch = mockFetch([
      ['openfoodfacts.org', { status: 0 }],
      ['/foods/search', { foods: [] }],
    ]);
    const { lookupBarcode } = createFoodLookup({ apiKey: KEY, fetch });
    assert.equal(await lookupBarcode('12345678'), null);
  });

  test('strips spaces and dashes before validating', async () => {
    const fetch = mockFetch([['openfoodfacts.org', offNutella]]);
    const { lookupBarcode } = createFoodLookup({ apiKey: KEY, fetch });
    const r = await lookupBarcode('3017-6204 22003');
    assert.equal(r.barcode, '3017620422003');
  });
});
