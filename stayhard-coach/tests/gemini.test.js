// Run: npm test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createGemini, toGeminiSchema, toGeminiContents, fromGeminiResponse } from '../lib/gemini.js';
import { runCoachTurn } from '../lib/agent.js';
import { TOOLS } from '../lib/coach-tools.js';
import { buildCoach, checkEnv } from '../lib/coach.js';

describe('schema conversion', () => {
  test('strips JSON Schema keywords Gemini rejects, keeps the rest, recursively', () => {
    const log = TOOLS.find((t) => t.name === 'log_food').input_schema;
    const g = toGeminiSchema(log);
    const grams = g.properties.items.items.properties.grams;
    assert.equal(grams.type, 'number');
    assert.equal(grams.exclusiveMinimum, undefined);
    assert.deepEqual(g.properties.items.items.properties.meal.enum, ['breakfast', 'lunch', 'dinner', 'snack', 'pre', 'post']);
    assert.equal(g.properties.items.minItems, 1);
    assert.deepEqual(g.required, ['items']);
    assert.ok(!JSON.stringify(toGeminiSchema(TOOLS.map((t) => t.input_schema))).includes('exclusiveMinimum'));
  });
});

describe('message conversion', () => {
  test('text, images, tool calls and results map to Gemini parts', () => {
    const contents = toGeminiContents([
      { role: 'user', content: 'earlier' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AQID' } },
        { type: 'text', text: 'lunch' },
      ] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'g0_0', name: 'search_food', input: { query: 'rice' }, signature: 'SIG' }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'g0_0', content: '{"results":[1]}' }] },
    ]);
    assert.deepEqual(contents.map((c) => c.role), ['user', 'model', 'user', 'model', 'user']);
    assert.deepEqual(contents[2].parts[0], { inlineData: { mimeType: 'image/jpeg', data: 'AQID' } });
    assert.deepEqual(contents[3].parts[0], { functionCall: { name: 'search_food', args: { query: 'rice' } }, thoughtSignature: 'SIG' });
    assert.deepEqual(contents[4].parts[0], { functionResponse: { name: 'search_food', response: { results: [1] } } });
  });

  test('non-object tool results are wrapped', () => {
    const c = toGeminiContents([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'n', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: '[1,2]' }] },
    ]);
    assert.deepEqual(c[1].parts[0].functionResponse.response, { result: [1, 2] });
  });

  test('responses become text or tool_use blocks, skipping thought parts', () => {
    const r = fromGeminiResponse({ candidates: [{ content: { parts: [
      { text: 'thinking...', thought: true },
      { text: 'Logging.' },
      { functionCall: { name: 'log_weight', args: { weight_lb: 171 } }, thoughtSignature: 'S1' },
    ] } }] }, 2);
    assert.equal(r.stop_reason, 'tool_use');
    assert.deepEqual(r.content, [
      { type: 'text', text: 'Logging.', signature: undefined },
      { type: 'tool_use', id: 'g2_2', name: 'log_weight', input: { weight_lb: 171 }, signature: 'S1' },
    ]);
    assert.equal(fromGeminiResponse({ candidates: [{ content: { parts: [{ text: 'Hi' }] } }] }).stop_reason, 'end_turn');
  });
});

describe('Gemini client', () => {
  const reply = (parts) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts } }] }) });

  test('drives a full tool round-trip through the agent loop', async () => {
    const calls = [];
    const script = [
      reply([{ functionCall: { name: 'log_food', args: { items: [{ fdc_id: 173904, grams: 40 }] } }, thoughtSignature: 'SIG1' }]),
      reply([{ text: 'Logged 40 g of oats.' }]),
    ];
    const gemini = createGemini({ apiKey: 'AIza-SECRET', fetch: async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body), headers: opts.headers }); return script.shift(); } });
    const coach = { async execute(name) { return name === 'log_food' ? { footer: 'Calories: 152 / 2,800\nProtein: 5 / 180 g' } : {}; } };

    const out = await runCoachTurn({ claude: gemini, coach, system: 'SYS', userContent: 'had oats' });
    assert.equal(out.reply, 'Logged 40 g of oats.\n\nCalories: 152 / 2,800\nProtein: 5 / 180 g');
    assert.match(calls[0].url, /models\/gemini-flash-latest:generateContent$/);
    assert.equal(calls[0].headers['x-goog-api-key'], 'AIza-SECRET');
    assert.equal(calls[0].body.systemInstruction.parts[0].text, 'SYS');
    assert.equal(calls[0].body.tools[0].functionDeclarations.length, TOOLS.length);
    // second request replays the call with its signature, then the result
    const second = calls[1].body.contents;
    assert.equal(second.at(-2).parts[0].thoughtSignature, 'SIG1');
    assert.equal(second.at(-1).parts[0].functionResponse.name, 'log_food');
  });

  const busy = (status = 503) => ({ ok: false, status, json: async () => ({ error: { message: 'This model is currently experiencing high demand.' } }) });
  const missing = { ok: false, status: 404, json: async () => ({ error: { message: 'model not found' } }) };
  const msg = { system: 's', messages: [{ role: 'user', content: 'x' }] };

  test('busy main model: retries once, then falls back to lighter models', async () => {
    const urls = [];
    const g = createGemini({ apiKey: 'k', retryDelayMs: 1, fetch: async (u) => {
      urls.push(u.match(/models\/(.+):/)[1]);
      return urls.length <= 2 ? busy() : reply([{ text: 'fine' }]);
    } });
    assert.equal((await g.messages(msg)).content[0].text, 'fine');
    assert.deepEqual(urls, ['gemini-flash-latest', 'gemini-flash-latest', 'gemini-flash-lite-latest']);
  });

  test('skips fallback models this key cannot use (404)', async () => {
    const urls = [];
    const g = createGemini({ apiKey: 'k', retryDelayMs: 1, fetch: async (u) => {
      const m = u.match(/models\/(.+):/)[1]; urls.push(m);
      if (m === 'gemini-flash-latest') return busy();
      if (m === 'gemini-flash-lite-latest') return missing;
      return reply([{ text: 'ok' }]);
    } });
    await g.messages(msg);
    assert.deepEqual(urls, ['gemini-flash-latest', 'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.5-flash']);
  });

  test('everything busy: clear error, no key in the message', async () => {
    let n = 0;
    const g = createGemini({ apiKey: 'AIza-SECRET', retryDelayMs: 1, fetch: async () => { n++; return busy(429); } });
    await assert.rejects(g.messages(msg), (e) => /429/.test(e.message) && /all free Gemini models are busy/.test(e.message) && !e.message.includes('SECRET'));
    assert.equal(n, 5); // main ×2 + 3 fallbacks
  });

  test('a real error (bad request) is reported immediately, no fallback', async () => {
    let n = 0;
    const g = createGemini({ apiKey: 'k', retryDelayMs: 1, fetch: async () => { n++; return { ok: false, status: 400, json: async () => ({ error: { message: 'Invalid schema' } }) }; } });
    await assert.rejects(g.messages(msg), /400: Invalid schema/);
    assert.equal(n, 1);
  });
});

describe('provider selection', () => {
  const base = { TELEGRAM_BOT_TOKEN: 't', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_KEY: 'k', FDC_API_KEY: 'f' };
  test('uses Gemini when GEMINI_API_KEY is set, Claude otherwise', () => {
    assert.equal(buildCoach({ ...base, GEMINI_API_KEY: 'g' }).claude.model, 'gemini-flash-latest');
    assert.equal(buildCoach({ ...base, GEMINI_API_KEY: 'g', GEMINI_MODEL: 'gemini-x' }).claude.model, 'gemini-x');
    assert.equal(buildCoach({ ...base, ANTHROPIC_API_KEY: 'a' }).claude.model, 'claude-sonnet-5-5');
    assert.throws(() => buildCoach(base).claude, /ANTHROPIC_API_KEY is not set/);
  });
});

describe('setup checks', () => {
  const good = { SUPABASE_URL: 'https://x.supabase.co', TELEGRAM_BOT_TOKEN: '1:abc', FDC_API_KEY: 'k', SUPABASE_SERVICE_KEY: 'sb_secret_abc' };
  test('passes with real-looking values', () => { assert.doesNotThrow(() => checkEnv(good)); });
  test('names the variable when placeholder text was pasted', () => {
    assert.throws(() => checkEnv({ ...good, SUPABASE_SERVICE_KEY: '<Supabase → Project Settings → API Keys>' }),
      /SUPABASE_SERVICE_KEY contains spaces or special characters/);
    assert.throws(() => checkEnv({ ...good, FDC_API_KEY: '<yourkey>' }), /FDC_API_KEY still has the <placeholder>/);
    assert.throws(() => checkEnv({ ...good, TELEGRAM_BOT_TOKEN: '' }), /TELEGRAM_BOT_TOKEN is not set/);
  });
});
