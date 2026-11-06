// StayHard Telegram coach: tool definitions + server-side handlers.
//
// The model only chooses foods, grams, servings and meals. Every nutrient
// number that reaches food_log is computed here, from USDA, Open Food Facts,
// or label values multiplied server-side. The model never does the math.
//
//   import { createFoodLookup } from './food-lookup.js';
//   import { createSupabase, createCoachTools, TOOLS, withFooter } from './coach-tools.js';
//
//   const coach = createCoachTools({
//     db: createSupabase({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_KEY }),
//     food: createFoodLookup({ apiKey: process.env.FDC_API_KEY }),
//   });
//   const result = await coach.execute(toolName, toolInput, { userText, source: 'text' });
//
// Works in Node 18+ and the browser (fetch only, no dependencies).

import { scale } from './food-lookup.js';

const TZ = 'America/Chicago';
const MEALS = ['breakfast', 'lunch', 'dinner', 'snack', 'pre', 'post'];
const NUTRIENTS = ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g', 'sodium_mg'];
const round1 = (n) => Math.round(n * 10) / 10;

// ── Tool definitions (Anthropic tool-use format) ────────────────
export const TOOLS = [
  {
    name: 'search_food',
    description:
      'Search USDA FoodData Central. Returns matches with fdc_id and per-100 g macros. ' +
      'For whole foods prefer Foundation or SR Legacy results; use Branded for packaged products. ' +
      'Then call log_food with the chosen fdc_id and your gram estimate.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Food to search for, e.g. "greek yogurt plain nonfat"' },
        limit: { type: 'integer', minimum: 1, maximum: 10, description: 'Max results, default 6' },
      },
      required: ['query'],
    },
  },
  {
    name: 'lookup_barcode',
    description:
      'Read a product barcode (8 to 14 digits) without logging it. To log a scanned item, ' +
      'call log_food with the barcode instead; that logs 1 serving right away.',
    input_schema: {
      type: 'object',
      properties: { barcode: { type: 'string' } },
      required: ['barcode'],
    },
  },
  {
    name: 'log_food',
    description:
      'Save one or more food items to the log. Give each item exactly one of: ' +
      '(a) fdc_id + grams from search_food; the server computes nutrients from USDA. ' +
      '(b) barcode; logs 1 serving (or `servings`) of the scanned product. ' +
      '(c) label: per-serving values read off a nutrition label or menu, plus `servings`; the server multiplies. ' +
      'Never compute or scale nutrients yourself. Name the product in your reply for barcode items. ' +
      'End your reply with the returned `footer` exactly as given.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              description: { type: 'string', description: 'Short name, e.g. "Oats, dry"' },
              meal: { type: 'string', enum: MEALS, description: 'Omit to infer from time of day' },
              quantity: { type: 'string', description: 'How the user described the amount, e.g. "1 cup"' },
              fdc_id: { type: 'integer' },
              grams: { type: 'number', exclusiveMinimum: 0 },
              barcode: { type: 'string' },
              servings: { type: 'number', exclusiveMinimum: 0, description: 'For barcode or label items; default 1' },
              label: {
                type: 'object',
                description: 'Per-serving values exactly as printed',
                properties: Object.fromEntries(NUTRIENTS.map((k) => [k, { type: 'number', minimum: 0 }])),
                required: ['calories'],
              },
            },
          },
        },
        date: { type: 'string', description: 'YYYY-MM-DD, only when logging a past day' },
      },
      required: ['items'],
    },
  },
  {
    name: 'get_nutrition_day',
    description: "A day's logged items, totals, targets and what's left. Defaults to today (Central time).",
    input_schema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD' } },
    },
  },
  {
    name: 'show_nutrition_card',
    description:
      "Render a day's totals vs. target as an image and send it to the chat. Use when asked " +
      'for a summary, a card, or "how am I doing today". The image is already sent when this ' +
      'returns, so reply in one short line and do not repeat the numbers.',
    input_schema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD, defaults to today' } },
    },
  },
  {
    name: 'log_weight',
    description: 'Save a body weight in pounds. One per day; a second entry the same day replaces the first.',
    input_schema: {
      type: 'object',
      properties: {
        weight_lb: { type: 'number' },
        date: { type: 'string', description: 'YYYY-MM-DD, defaults to today' },
      },
      required: ['weight_lb'],
    },
  },
];

// ── Supabase REST client ───────────────────────────────────────
export function createSupabase({ url, key, fetch: fetchImpl } = {}) {
  if (!url || !key) throw new Error('Supabase url and key are required');
  const doFetch = fetchImpl ?? globalThis.fetch;
  const base = `${url.replace(/\/$/, '')}/rest/v1`;

  async function req(path, { method = 'GET', body, prefer } = {}) {
    const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
    if (prefer) headers.Prefer = prefer;
    const res = await doFetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    if (!res.ok) throw new Error(`Supabase ${method} ${path.split('?')[0]} failed (${res.status}): ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  }

  return {
    select: (table, query = '') => req(`/${table}?${query}`),
    insert: (table, rows) => req(`/${table}`, { method: 'POST', body: rows, prefer: 'return=representation' }),
    upsert: (table, rows, onConflict) =>
      req(`/${table}?on_conflict=${onConflict}`, {
        method: 'POST', body: rows, prefer: 'return=representation,resolution=merge-duplicates',
      }),
  };
}

// ── Date helpers (Central time) ────────────────────────────────
export function localDate(d = new Date(), tz = TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function localHour(d = new Date(), tz = TZ) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(d));
}
export function mealForHour(h) {
  if (h >= 4 && h < 11) return 'breakfast';
  if (h >= 11 && h < 15) return 'lunch';
  if (h >= 17 && h < 21) return 'dinner';
  return 'snack';
}
function checkDate(s) {
  if (s == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) {
    throw new Error(`Date must be YYYY-MM-DD, got "${s}"`);
  }
  return s;
}

// ── Targets ────────────────────────────────────────────────────
// Pass `targets` as an object or async (date) => object. Default reads env:
// TARGET_CALORIES, TARGET_PROTEIN_G, TARGET_CARBS_G, TARGET_FAT_G.
function envTargets() {
  const env = globalThis.process?.env ?? {};
  const n = (k) => (env[k] ? Number(env[k]) : null);
  return { calories: n('TARGET_CALORIES'), protein_g: n('TARGET_PROTEIN_G'), carbs_g: n('TARGET_CARBS_G'), fat_g: n('TARGET_FAT_G') };
}

const fmt = (n) => Math.round(n).toLocaleString('en-US');

// "Calories: x / target", "Protein: x / target g", one line per number.
// Carbs and fat lines appear only when those targets are set.
export function formatFooter(totals, target = {}) {
  const line = (label, key, unit, always) => {
    const t = target[key];
    if (t == null && !always) return null;
    return `${label}: ${fmt(totals[key] ?? 0)} / ${t == null ? 'no target set' : fmt(t)}${t == null ? '' : unit}`;
  };
  return [
    line('Calories', 'calories', '', true),
    line('Protein', 'protein_g', ' g', true),
    line('Carbs', 'carbs_g', ' g', false),
    line('Fat', 'fat_g', ' g', false),
  ].filter(Boolean).join('\n');
}

// Guarantees a reply ends with the canonical footer: strips any totals lines
// the model wrote itself, then appends the server's version.
export function withFooter(reply, footer) {
  if (!footer) return reply;
  const lines = String(reply ?? '').trimEnd().split('\n');
  while (lines.length && /^\s*(calories|protein|carbs|fat)\s*:/i.test(lines[lines.length - 1])) lines.pop();
  const body = lines.join('\n').trimEnd();
  return body ? `${body}\n\n${footer}` : footer;
}

const multiply = (vals, servings) =>
  Object.fromEntries(NUTRIENTS.map((k) => [k, typeof vals?.[k] === 'number' ? round1(vals[k] * servings) : null]));

// ── Tools ──────────────────────────────────────────────────────
// sendCard: async (day, ctx) => any. Renders and delivers the nutrition card;
// injected so this module stays free of Next.js and Telegram specifics.
export function createCoachTools({ db, food, targets, sendCard, tz = TZ, now = () => new Date() } = {}) {
  if (!db || !food) throw new Error('createCoachTools needs db and food');
  const getTargets = async (date) =>
    (typeof targets === 'function' ? await targets(date) : targets) ?? envTargets();

  async function search_food({ query, limit = 6 }) {
    const results = await food.search_food(query, { limit: Math.min(Math.max(limit, 1), 10) });
    return {
      results: results.map((r) => ({
        fdc_id: r.fdc_id, description: r.description, data_type: r.data_type, brand: r.brand,
        per100g: { calories: r.per100.calories, protein_g: r.per100.protein_g, carbs_g: r.per100.carbs_g, fat_g: r.per100.fat_g },
      })),
    };
  }

  async function lookup_barcode({ barcode }) {
    const p = await food.lookupBarcode(barcode);
    return p ? { found: true, ...p } : { found: false, barcode };
  }

  // Resolve one item into a food_log row, or throw a message the model can act on.
  async function resolveItem(item, i, ctx) {
    const tag = `Item ${i + 1}${item.description ? ` ("${item.description}")` : ''}`;
    const paths = [item.fdc_id != null, item.barcode != null, item.label != null].filter(Boolean).length;
    if (paths === 0) throw new Error(`${tag}: needs fdc_id + grams, a barcode, or label values. Call search_food first.`);
    if (paths > 1) throw new Error(`${tag}: give only one of fdc_id, barcode, or label.`);
    const servings = item.servings ?? 1;
    if (!(servings > 0)) throw new Error(`${tag}: servings must be greater than 0.`);

    if (item.fdc_id != null) {
      if (!(item.grams > 0)) throw new Error(`${tag}: fdc_id needs grams greater than 0.`);
      const per = await food.foodPer100(item.fdc_id);
      if (!per) throw new Error(`${tag}: USDA has no food with fdc_id ${item.fdc_id}.`);
      const { grams, micros, ...n } = scale(per, item.grams);
      return {
        description: item.description || per.description, quantity: item.quantity ?? `${grams} g`,
        grams, ...n, micros, source: ctx.source ?? 'text', barcode: null, fdc_id: per.fdc_id,
      };
    }

    if (item.barcode != null) {
      const p = await food.lookupBarcode(item.barcode);
      if (!p) throw new Error(`${tag}: no product found for barcode ${item.barcode}. Ask for the label or search_food.`);
      let n = null;
      let grams = p.serving?.grams ? round1(p.serving.grams * servings) : null;
      if (p.label) n = multiply(p.label, servings);
      else if (p.per100 && grams) { const { grams: _g, micros: _m, ...s } = scale(p.per100, grams); n = s; }
      if (!n || n.calories == null) throw new Error(`${tag}: ${p.name ?? 'product'} has no usable nutrition data. Ask for a photo of the label.`);
      const name = [p.brand, p.name].filter(Boolean).join(' ') || `Barcode ${p.barcode}`;
      return {
        description: item.description || name,
        quantity: item.quantity ?? (p.serving?.text ? `${servings} × ${p.serving.text}` : `${servings} serving${servings === 1 ? '' : 's'}`),
        grams, ...n, micros: {}, source: 'barcode', barcode: p.barcode, fdc_id: p.fdc_id ?? null,
        _product: name,
      };
    }

    if (typeof item.label?.calories !== 'number') throw new Error(`${tag}: label needs at least calories.`);
    if (!item.description) throw new Error(`${tag}: label items need a description.`);
    return {
      description: item.description, quantity: item.quantity ?? `${servings} serving${servings === 1 ? '' : 's'}`,
      grams: item.grams ?? null, ...multiply(item.label, servings), micros: {},
      source: ctx.source ?? 'text', barcode: null, fdc_id: null,
    };
  }

  async function getDay(date) {
    const cols = 'id,eaten_at,meal,description,quantity,grams,' + NUTRIENTS.join(',');
    const items = (await db.select('food_log', `select=${cols}&log_date=eq.${date}&order=eaten_at.asc`)) ?? [];
    const totals = Object.fromEntries(NUTRIENTS.map((k) => [k, round1(items.reduce((s, r) => s + (Number(r[k]) || 0), 0))]));
    const target = await getTargets(date);
    const remaining = Object.fromEntries(
      ['calories', 'protein_g', 'carbs_g', 'fat_g'].filter((k) => target[k] != null).map((k) => [k, round1(target[k] - totals[k])]),
    );
    return { date, items, totals, target, remaining, footer: formatFooter(totals, target) };
  }

  async function log_food({ items, date }, ctx = {}) {
    if (!Array.isArray(items) || items.length === 0) throw new Error('log_food needs at least one item.');
    const current = now();
    const logDate = checkDate(date) ?? localDate(current, tz);
    // Backdated entries get noon Central on that day (18:00 UTC; 17:00 in DST)
    // so eaten_at stays on the right day; their meal should be given explicitly.
    const backdated = logDate !== localDate(current, tz);
    const at = backdated ? new Date(`${logDate}T18:00:00Z`) : current;
    const defaultMeal = backdated ? 'snack' : mealForHour(localHour(current, tz));

    // Resolve everything first so a bad item saves nothing (no half-logged meals).
    const resolved = [];
    for (const [i, item] of items.entries()) resolved.push(await resolveItem(item, i, ctx));

    const rows = resolved.map(({ _product, ...r }, i) => {
      const meal = items[i].meal ?? defaultMeal;
      if (!MEALS.includes(meal)) throw new Error(`Item ${i + 1}: meal must be one of ${MEALS.join(', ')}.`);
      return { ...r, meal, log_date: logDate, eaten_at: at.toISOString(), body: ctx.userText ?? null };
    });
    const saved = await db.insert('food_log', rows);
    const day = await getDay(logDate);
    return {
      logged: (saved ?? rows).map((r, i) => ({
        id: r.id, description: r.description, quantity: r.quantity, meal: r.meal,
        product: resolved[i]._product ?? undefined,
        ...Object.fromEntries(['calories', 'protein_g', 'carbs_g', 'fat_g'].map((k) => [k, r[k]])),
      })),
      totals: day.totals, target: day.target, remaining: day.remaining, footer: day.footer,
    };
  }

  async function get_nutrition_day({ date } = {}) {
    return getDay(checkDate(date) ?? localDate(now(), tz));
  }

  async function log_weight({ weight_lb, date }, ctx = {}) {
    const w = Number(weight_lb);
    if (!Number.isFinite(w) || w < 50 || w > 500) throw new Error(`Weight ${weight_lb} lb looks wrong; expected 50 to 500.`);
    const d = checkDate(date) ?? localDate(now(), tz);
    const prev = await db.select('weigh_ins', `select=weigh_date,weight_lb&weigh_date=lt.${d}&order=weigh_date.desc&limit=1`);
    const [saved] = await db.upsert('weigh_ins', [{ weigh_date: d, weight_lb: round1(w), source: ctx.weightSource ?? 'telegram' }], 'weigh_date');
    const last = prev?.[0];
    return {
      weigh_date: saved.weigh_date, weight_lb: Number(saved.weight_lb),
      previous: last ? { date: last.weigh_date, weight_lb: Number(last.weight_lb) } : null,
      change_lb: last ? round1(Number(saved.weight_lb) - Number(last.weight_lb)) : null,
    };
  }

  async function show_nutrition_card({ date } = {}, ctx = {}) {
    if (!sendCard) throw new Error('Card sending is not configured on this server.');
    const day = await getDay(checkDate(date) ?? localDate(now(), tz));
    await sendCard(day, ctx);
    return { sent: true, date: day.date, items: day.items.length, footer: day.footer };
  }

  const handlers = { search_food, lookup_barcode, log_food, get_nutrition_day, show_nutrition_card, log_weight };

  // Tool errors go back to the model as { error } so it can fix the call.
  async function execute(name, input = {}, ctx = {}) {
    const fn = handlers[name];
    if (!fn) return { error: `Unknown tool: ${name}` };
    try { return await fn(input, ctx); } catch (e) { return { error: e.message }; }
  }

  return { ...handlers, execute };
}
