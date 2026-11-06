// StayHard food lookup: USDA FoodData Central + Open Food Facts.
// Works in Node 18+ and the browser (ES module, uses fetch).
//
//   import { search_food, foodPer100, scale, lookupBarcode } from './food-lookup.js';
//
// The default exports read the key from process.env.FDC_API_KEY (Node) or
// globalThis.FDC_API_KEY (browser). For tests or a custom setup, use
// createFoodLookup({ apiKey, fetch }).

const FDC_BASE = 'https://api.nal.usda.gov/fdc/v1';
const OFF_BASE = 'https://world.openfoodfacts.org/api/v2/product';
const TIMEOUT_MS = 10000;

// USDA nutrient numbers (stable across Foundation, SR Legacy, FNDDS, Branded).
const CORE = {
  calories:  ['208'],                 // Energy, kcal
  protein_g: ['203'],
  carbs_g:   ['205'],
  fat_g:     ['204'],
  fiber_g:   ['291'],
  sugar_g:   ['269', '269.3'],        // Total sugars; Foundation sometimes uses 269.3
  sodium_mg: ['307'],
};
// Foundation foods often lack 208 and report Atwater energy instead.
const ENERGY_FALLBACK = ['958', '957'];

// Micros worth keeping for an endurance athlete; stored in food_log.micros.
const MICROS = {
  potassium_mg:     '306',
  calcium_mg:       '301',
  iron_mg:          '303',
  magnesium_mg:     '304',
  zinc_mg:          '309',
  vitamin_c_mg:     '401',
  vitamin_d_ug:     '328',
  vitamin_b12_ug:   '418',
  saturated_fat_g:  '606',
  cholesterol_mg:   '601',
  caffeine_mg:      '262',
};

const round1 = (n) => Math.round(n * 10) / 10;

// Normalize the two FDC nutrient shapes into { number, unit, value }.
//   search results: { nutrientNumber, unitName, value }
//   food detail:    { nutrient: { number, unitName }, amount }
function readNutrients(foodNutrients = []) {
  return foodNutrients
    .map((n) => ({
      number: String(n.nutrientNumber ?? n.nutrient?.number ?? ''),
      unit: String(n.unitName ?? n.nutrient?.unitName ?? '').toLowerCase(),
      value: n.value ?? n.amount,
    }))
    .filter((n) => n.number && typeof n.value === 'number');
}

function pick(nutrients, numbers, { unit } = {}) {
  for (const num of numbers) {
    const hit = nutrients.find((n) => n.number === num && (!unit || n.unit === unit));
    if (hit) return hit.value;
  }
  return null;
}

function nutrientsPer100(foodNutrients) {
  const list = readNutrients(foodNutrients);
  const out = {};
  for (const [key, nums] of Object.entries(CORE)) {
    out[key] = key === 'calories' ? pick(list, nums, { unit: 'kcal' }) : pick(list, nums);
  }
  if (out.calories == null) out.calories = pick(list, ENERGY_FALLBACK, { unit: 'kcal' });
  if (out.calories == null && [out.protein_g, out.carbs_g, out.fat_g].some((v) => v != null)) {
    out.calories = round1(4 * (out.protein_g ?? 0) + 4 * (out.carbs_g ?? 0) + 9 * (out.fat_g ?? 0));
  }
  const micros = {};
  for (const [key, num] of Object.entries(MICROS)) {
    const v = pick(list, [num]);
    if (v != null) micros[key] = v;
  }
  return { ...out, micros };
}

const digitsOnly = (s) => String(s).replace(/^0+/, '');

export function createFoodLookup({ apiKey, fetch: fetchImpl } = {}) {
  const doFetch = fetchImpl ?? globalThis.fetch;
  const key = () => {
    const k = apiKey ?? globalThis.process?.env?.FDC_API_KEY ?? globalThis.FDC_API_KEY;
    if (!k) throw new Error('FDC_API_KEY is not set');
    return k;
  };

  async function getJson(url, headers = {}) {
    const opts = { headers };
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) opts.signal = AbortSignal.timeout(TIMEOUT_MS);
    const res = await doFetch(url, opts);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Request failed (${res.status}) for ${url.split('?')[0]}`);
    return res.json();
  }

  // Key goes in the query string: the /food/{id} endpoint fails the browser
  // CORS preflight when it is sent as an X-Api-Key header. getJson strips the
  // query string from error messages so the key never lands in a log.
  const fdc = (path, params = {}) => {
    const qs = new URLSearchParams({ ...params, api_key: key() }).toString();
    return getJson(`${FDC_BASE}${path}?${qs}`);
  };

  // ── search_food ────────────────────────────────────────────
  async function search_food(query, { limit = 10, dataType } = {}) {
    const q = String(query ?? '').trim();
    if (!q) throw new Error('search_food needs a query');
    const params = { query: q, pageSize: String(limit) };
    if (dataType) params.dataType = [].concat(dataType).join(',');
    const data = await fdc('/foods/search', params);
    return (data?.foods ?? []).slice(0, limit).map((f) => {
      const { micros, ...per100 } = nutrientsPer100(f.foodNutrients);
      return {
        fdc_id: f.fdcId,
        description: f.description,
        data_type: f.dataType,
        brand: f.brandName || f.brandOwner || null,
        barcode: f.gtinUpc || null,
        per100,
      };
    });
  }

  // ── foodPer100 ─────────────────────────────────────────────
  // FDC reports nutrients per 100 g for every data type, Branded included.
  async function foodPer100(fdc_id) {
    const id = Number(fdc_id);
    if (!Number.isInteger(id) || id <= 0) throw new Error(`Invalid fdc_id: ${fdc_id}`);
    const food = await fdc(`/food/${id}`);
    if (!food) return null;
    return {
      fdc_id: food.fdcId,
      description: food.description,
      data_type: food.dataType,
      brand: food.brandName || food.brandOwner || null,
      ...nutrientsPer100(food.foodNutrients),
    };
  }

  // ── lookupBarcode ──────────────────────────────────────────
  async function lookupBarcode(code) {
    const clean = String(code ?? '').replace(/[\s-]/g, '');
    if (!/^\d{8,14}$/.test(clean)) {
      throw new Error(`Barcode must be 8 to 14 digits, got "${code}"`);
    }
    return (await fromOpenFoodFacts(clean)) ?? (await fromUsdaBranded(clean));
  }

  async function fromOpenFoodFacts(code) {
    // OFF stores UPC-A (12) as EAN-13 with a leading zero; try both.
    const tries = code.length === 12 ? [code, `0${code}`] : [code];
    for (const c of tries) {
      const fields = 'code,product_name,brands,serving_size,serving_quantity,serving_quantity_unit,nutriments';
      const data = await getJson(`${OFF_BASE}/${c}.json?fields=${fields}`);
      if (data?.status !== 1 || !data.product) continue;
      const p = data.product;
      const nm = p.nutriments ?? {};
      const read = (suffix) => {
        const num = (k) => (typeof nm[`${k}_${suffix}`] === 'number' ? nm[`${k}_${suffix}`] : null);
        let sodiumG = num('sodium');
        if (sodiumG == null && num('salt') != null) sodiumG = num('salt') / 2.5;
        const out = {
          calories: num('energy-kcal'),
          protein_g: num('proteins'),
          carbs_g: num('carbohydrates'),
          fat_g: num('fat'),
          fiber_g: num('fiber'),
          sugar_g: num('sugars'),
          sodium_mg: sodiumG == null ? null : round1(sodiumG * 1000),
        };
        return Object.values(out).every((v) => v == null) ? null : out;
      };
      const qty = Number(p.serving_quantity) || null;
      const unit = String(p.serving_quantity_unit || (/\bml\b/i.test(p.serving_size ?? '') ? 'ml' : 'g')).toLowerCase();
      const per100 = read('100g');
      // Some products list per-100 g values and a serving size but no
      // per-serving numbers; derive the label from per-100 in that case.
      let label = read('serving');
      if (!label && per100 && qty) {
        const { grams, micros, ...scaled } = scale(per100, qty);
        label = scaled;
      }
      return {
        source: 'openfoodfacts',
        barcode: code,
        fdc_id: null,
        name: p.product_name || null,
        brand: p.brands ? p.brands.split(',')[0].trim() : null,
        serving: {
          text: p.serving_size || null,
          grams: unit === 'g' ? qty : null,
          ml: unit === 'ml' ? qty : null,
        },
        label,
        per100,
      };
    }
    return null;
  }

  async function fromUsdaBranded(code) {
    // FDC search only matches the exact stored string, and gtinUpc is stored
    // as 12 digits for some products and 14 (zero-padded) for others.
    const bare = digitsOnly(code);
    const variants = [...new Set([code, ...[12, 13, 14].map((n) => bare.padStart(n, '0'))])]
      .filter((v) => v.length >= code.length || v === code);
    let match = null;
    for (const q of variants) {
      const data = await fdc('/foods/search', { query: q, dataType: 'Branded', pageSize: '10' });
      match = (data?.foods ?? []).find((f) => f.gtinUpc && digitsOnly(f.gtinUpc) === bare);
      if (match) break;
    }
    if (!match) return null;
    const food = await fdc(`/food/${match.fdcId}`);
    if (!food) return null;
    const ln = food.labelNutrients ?? {};
    const v = (k) => (typeof ln[k]?.value === 'number' ? ln[k].value : null);
    const unit = String(food.servingSizeUnit ?? '').toLowerCase();
    const { micros, ...per100 } = nutrientsPer100(food.foodNutrients);
    return {
      source: 'usda_branded',
      barcode: code,
      fdc_id: food.fdcId,
      name: food.description || null,
      brand: food.brandName || food.brandOwner || null,
      serving: {
        text: food.householdServingFullText
          || (food.servingSize ? `${food.servingSize} ${food.servingSizeUnit ?? ''}`.trim() : null),
        grams: unit === 'g' || unit === 'grm' ? food.servingSize ?? null : null,
        ml: unit === 'ml' || unit === 'mlt' ? food.servingSize ?? null : null,
      },
      label: {
        calories: v('calories'),
        protein_g: v('protein'),
        carbs_g: v('carbohydrates'),
        fat_g: v('fat'),
        fiber_g: v('fiber'),
        sugar_g: v('sugars'),
        sodium_mg: v('sodium'),
      },
      per100,
    };
  }

  return { search_food, foodPer100, scale, lookupBarcode };
}

// ── scale ────────────────────────────────────────────────────
// Turn a per-100 g profile into the amounts for a given weight.
// Missing values stay null rather than becoming 0.
export function scale(per100, grams) {
  const g = Number(grams);
  if (!per100) throw new Error('scale needs a per-100 g profile');
  if (!Number.isFinite(g) || g < 0) throw new Error(`Invalid grams: ${grams}`);
  const f = g / 100;
  const s = (v) => (typeof v === 'number' ? round1(v * f) : null);
  const out = { grams: g };
  for (const k of Object.keys(CORE)) out[k] = s(per100[k]);
  out.micros = Object.fromEntries(
    Object.entries(per100.micros ?? {}).map(([k, v]) => [k, s(v)]).filter(([, v]) => v != null),
  );
  return out;
}

// Default instance using env/global key and global fetch.
const defaults = createFoodLookup();
export const search_food = (...a) => defaults.search_food(...a);
export const foodPer100 = (...a) => defaults.foodPer100(...a);
export const lookupBarcode = (...a) => defaults.lookupBarcode(...a);
