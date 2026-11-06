// Run: npm test   (uses tests/next-resolve.mjs so plain Node can load next/og)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCoachTools } from '../lib/coach-tools.js';
import { renderCardPng, cardSize, prettyDate } from '../lib/nutrition-card.js';
import { createTelegram } from '../lib/telegram.js';
import { runEveningCheckin, isEveningSlot, NUDGE } from '../lib/evening.js';
import { authorized } from '../lib/coach.js';

const DAY = {
  date: '2026-11-06',
  items: [{ id: 1 }, { id: 2 }],
  totals: { calories: 1840, protein_g: 142.6, carbs_g: 221, fat_g: 58, fiber_g: 24, sugar_g: 60, sodium_mg: 2140 },
  target: { calories: 2800, protein_g: 180 },
  remaining: { calories: 960, protein_g: 37.4 },
  footer: 'Calories: 1,840 / 2,800\nProtein: 143 / 180 g',
};

const pngSize = (bytes) => {
  const dv = new DataView(bytes.buffer, bytes.byteOffset);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
};
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

// ── card ─────────────────────────────────────────────────────
describe('nutrition card', () => {
  test('renders a PNG at the expected size', async () => {
    const png = await renderCardPng(DAY);
    assert.deepEqual([...png.slice(0, 4)], PNG_MAGIC);
    assert.deepEqual(pngSize(png), { width: 1080, height: 700 });
    assert.ok(png.length > 10_000, 'not a blank image');
  });

  test('grows taller when carbs and fat have targets, and handles an empty day', async () => {
    const full = { ...DAY, target: { calories: 2800, protein_g: 180, carbs_g: 380, fat_g: 80 } };
    assert.deepEqual(cardSize(full), { width: 1080, height: 900 });
    assert.deepEqual(pngSize(await renderCardPng(full)), cardSize(full));
    const empty = { date: '2026-11-06', items: [], totals: {}, target: {}, footer: '' };
    assert.deepEqual([...(await renderCardPng(empty)).slice(0, 4)], PNG_MAGIC);
  });

  test('date label is the calendar day, not shifted by timezone', () => {
    assert.equal(prettyDate('2026-11-06'), 'Friday, Nov 6');
    assert.equal(prettyDate('2027-01-01'), 'Friday, Jan 1');
  });
});

// ── show_nutrition_card tool ─────────────────────────────────
describe('show_nutrition_card', () => {
  const db = {
    async select() { return [{ id: 1, calories: 500, protein_g: 40 }, { id: 2, calories: 300, protein_g: 20 }]; },
    async insert() { throw new Error('unused'); },
    async upsert() { throw new Error('unused'); },
  };
  const now = () => new Date('2026-11-06T20:00:00Z');

  test('builds the day and hands it to sendCard with the chat context', async () => {
    const sent = [];
    const coach = createCoachTools({ db, food: {}, targets: { calories: 2800, protein_g: 180 }, now,
      sendCard: async (day, ctx) => { sent.push({ day, ctx }); } });
    const res = await coach.execute('show_nutrition_card', {}, { chatId: 42 });
    assert.deepEqual(res, { sent: true, date: '2026-11-06', items: 2, footer: 'Calories: 800 / 2,800\nProtein: 60 / 180 g' });
    assert.equal(sent[0].day.totals.calories, 800);
    assert.equal(sent[0].ctx.chatId, 42);
  });

  test('reports an error when sending is not configured or fails', async () => {
    const noSend = createCoachTools({ db, food: {}, now });
    assert.match((await noSend.execute('show_nutrition_card', {})).error, /not configured/);
    const failing = createCoachTools({ db, food: {}, now, sendCard: async () => { throw new Error('Telegram sendPhoto failed (400): chat not found'); } });
    assert.match((await failing.execute('show_nutrition_card', {})).error, /chat not found/);
  });
});

// ── telegram ─────────────────────────────────────────────────
describe('telegram client', () => {
  const TOKEN = '123:SECRET';
  const mk = (reply = { ok: true, result: { message_id: 7 } }, status = 200) => {
    const calls = [];
    const fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: status < 300, status, json: async () => reply }; };
    return { calls, tg: createTelegram({ token: TOKEN, fetch }) };
  };

  test('sendPhoto uploads PNG bytes as multipart with caption', async () => {
    const { calls, tg } = mk();
    const res = await tg.sendPhoto(99, new Uint8Array([1, 2, 3]), { caption: 'Calories: 1 / 2' });
    assert.equal(res.message_id, 7);
    assert.equal(calls[0].url, `https://api.telegram.org/bot${TOKEN}/sendPhoto`);
    const form = calls[0].opts.body;
    assert.ok(form instanceof FormData);
    assert.equal(form.get('chat_id'), '99');
    assert.equal(form.get('caption'), 'Calories: 1 / 2');
    const photo = form.get('photo');
    assert.equal(photo.type, 'image/png');
    assert.equal(photo.name, 'nutrition.png');
    assert.deepEqual([...new Uint8Array(await photo.arrayBuffer())], [1, 2, 3]);
  });

  test('sendMessage posts JSON', async () => {
    const { calls, tg } = mk();
    await tg.sendMessage(99, 'hi');
    assert.deepEqual(JSON.parse(calls[0].opts.body), { chat_id: 99, text: 'hi' });
  });

  test('errors carry Telegram\'s description but never the token', async () => {
    const { tg } = mk({ ok: false, description: 'Bad Request: chat not found' }, 400);
    await assert.rejects(tg.sendMessage(1, 'x'), (e) => /chat not found/.test(e.message) && !e.message.includes('SECRET'));
  });
});

// ── evening check-in ─────────────────────────────────────────
describe('evening check-in', () => {
  // 8:30 PM Central: CST (UTC-6) in winter, CDT (UTC-5) in summer
  const WINTER_830PM = new Date('2026-11-07T02:30:00Z');
  const SUMMER_830PM = new Date('2026-07-16T01:30:00Z');

  test('exactly one of the two UTC crons lands in the 8 PM Central hour, all year', () => {
    for (const day of ['2026-01-15', '2026-03-09', '2026-07-15', '2026-11-02', '2026-12-31']) {
      const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      // Hobby plan may fire anywhere in the scheduled hour; check both ends.
      for (const minute of ['00', '30', '59']) {
        const hits = ['01', '02'].filter((h) => isEveningSlot(new Date(`${next}T${h}:${minute}:00Z`)));
        assert.equal(hits.length, 1, `${day} :${minute}`);
      }
    }
    assert.ok(isEveningSlot(WINTER_830PM));
    assert.ok(isEveningSlot(SUMMER_830PM));
  });

  const deps = (items) => {
    const out = { cards: [], messages: [] };
    return {
      out,
      coach: { get_nutrition_day: async () => ({ ...DAY, items }) },
      sendCard: async (day) => out.cards.push(day),
      sendMessage: async (text) => out.messages.push(text),
    };
  };

  test('sends the card when something was logged', async () => {
    const d = deps([{ id: 1 }]);
    const res = await runEveningCheckin({ ...d, now: WINTER_830PM });
    assert.equal(res.action, 'card');
    assert.equal(d.out.cards.length, 1);
    assert.equal(d.out.messages.length, 0);
  });

  test('sends a short nudge when nothing was logged', async () => {
    const d = deps([]);
    const res = await runEveningCheckin({ ...d, now: SUMMER_830PM });
    assert.equal(res.action, 'nudge');
    assert.deepEqual(d.out.messages, [NUDGE]);
    assert.ok(NUDGE.length < 120);
    assert.equal(d.out.cards.length, 0);
  });

  test('the off-season cron skips without sending; force overrides', async () => {
    const d = deps([{ id: 1 }]);
    const offSeason = new Date('2026-11-07T01:30:00Z'); // 7:30 PM CST
    assert.equal((await runEveningCheckin({ ...d, now: offSeason })).action, 'skipped');
    assert.equal(d.out.cards.length + d.out.messages.length, 0);
    assert.equal((await runEveningCheckin({ ...d, now: offSeason, force: true })).action, 'card');
  });
});

// ── cron auth + config ───────────────────────────────────────
describe('cron route', () => {
  const env = { CRON_SECRET: 's3cret' };
  const req = (url, headers = {}) => new Request(url, { headers });

  test('accepts Vercel\'s Bearer header or ?key=, rejects everything else', () => {
    assert.ok(authorized(req('https://x/api/cron/evening', { authorization: 'Bearer s3cret' }), env));
    assert.ok(authorized(req('https://x/api/cron/evening?key=s3cret'), env));
    assert.ok(!authorized(req('https://x/api/cron/evening'), env));
    assert.ok(!authorized(req('https://x/api/cron/evening', { authorization: 'Bearer nope' }), env));
    assert.ok(!authorized(req('https://x/api/cron/evening?key=s3cret'), {}), 'no secret configured means locked');
  });

  test('vercel.json schedules 01:30 and 02:30 UTC daily (Hobby-plan safe)', () => {
    const { crons } = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url)));
    assert.deepEqual(crons, [
      { path: '/api/cron/evening', schedule: '30 1 * * *' },
      { path: '/api/cron/evening', schedule: '30 2 * * *' },
    ]);
  });
});
