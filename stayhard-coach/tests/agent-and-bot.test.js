// Run: npm test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runCoachTurn, normalizeHistory } from '../lib/agent.js';
import { handleUpdate, WELCOME } from '../lib/telegram-handler.js';
import { createConversation } from '../lib/conversation.js';
import { buildSystemPrompt } from '../lib/system-prompt.js';
import { createClaude } from '../lib/anthropic.js';
import { createCoachTools, TOOLS } from '../lib/coach-tools.js';

// ── fakes ────────────────────────────────────────────────────
// A scripted Claude: each call returns the next scripted response.
function fakeClaude(script) {
  const calls = [];
  return {
    calls,
    async messages(body) {
      calls.push(structuredClone(body));
      const next = script.shift();
      if (!next) throw new Error('script exhausted');
      return typeof next === 'function' ? next(body) : next;
    },
  };
}
const text = (t) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
const use = (name, input, id = `tu_${name}`) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] });

function fakeCoach(results = {}) {
  const calls = [];
  return {
    calls,
    async execute(name, input, ctx) {
      calls.push({ name, input, ctx });
      const r = results[name];
      return typeof r === 'function' ? r(input) : r ?? { ok: true };
    },
  };
}

const FOOTER = 'Calories: 455 / 2,800\nProtein: 12 / 180 g';

// ── agent loop ───────────────────────────────────────────────
describe('runCoachTurn', () => {
  test('runs tools, feeds results back, and returns the final text', async () => {
    const claude = fakeClaude([
      use('search_food', { query: 'banana' }),
      use('log_food', { items: [{ fdc_id: 173944, grams: 118 }] }),
      text('Logged a medium banana (~118 g).'),
    ]);
    const coach = fakeCoach({ search_food: { results: [{ fdc_id: 173944 }] }, log_food: { logged: [], footer: FOOTER } });
    const out = await runCoachTurn({ claude, coach, system: 'S', userContent: 'had a banana', ctx: { userText: 'had a banana' } });

    assert.equal(out.reply, `Logged a medium banana (~118 g).\n\n${FOOTER}`);
    assert.deepEqual(out.toolCalls.map((t) => t.name), ['search_food', 'log_food']);
    assert.equal(coach.calls[1].ctx.userText, 'had a banana', 'ctx passed to tools');
    // second call carries the tool result back
    const second = claude.calls[1].messages;
    assert.equal(second.at(-1).content[0].type, 'tool_result');
    assert.equal(second.at(-1).content[0].tool_use_id, 'tu_search_food');
    assert.equal(claude.calls[0].tools.length, TOOLS.length);
  });

  test('replaces totals the model wrote itself with the server footer', async () => {
    const claude = fakeClaude([use('log_food', { items: [] }), text('Logged.\nCalories: 999 / 2800\nProtein: 1 / 180 g')]);
    const out = await runCoachTurn({ claude, coach: fakeCoach({ log_food: { footer: FOOTER } }), system: 'S', userContent: 'x' });
    assert.equal(out.reply, `Logged.\n\n${FOOTER}`);
  });

  test('no footer when log_food failed or was not called', async () => {
    const claude = fakeClaude([use('log_food', { items: [] }), text('That barcode was not found.')]);
    const out = await runCoachTurn({ claude, coach: fakeCoach({ log_food: { error: 'no product' } }), system: 'S', userContent: 'x' });
    assert.equal(out.reply, 'That barcode was not found.');
    assert.equal(claude.calls[1].messages.at(-1).content[0].is_error, true);

    const plain = await runCoachTurn({ claude: fakeClaude([text('Morning!')]), coach: fakeCoach(), system: 'S', userContent: 'hi' });
    assert.equal(plain.reply, 'Morning!');
  });

  test('handles several tool calls in one round', async () => {
    const claude = fakeClaude([
      { stop_reason: 'tool_use', content: [
        { type: 'text', text: 'Logging both.' },
        { type: 'tool_use', id: 't1', name: 'log_weight', input: { weight_lb: 171 } },
        { type: 'tool_use', id: 't2', name: 'get_nutrition_day', input: {} },
      ] },
      text('Weight saved.'),
    ]);
    const coach = fakeCoach();
    await runCoachTurn({ claude, coach, system: 'S', userContent: 'x' });
    assert.deepEqual(coach.calls.map((c) => c.name), ['log_weight', 'get_nutrition_day']);
    assert.deepEqual(claude.calls[1].messages.at(-1).content.map((c) => c.tool_use_id), ['t1', 't2']);
  });

  test('stops after too many rounds instead of looping forever', async () => {
    const claude = fakeClaude(Array.from({ length: 8 }, () => use('search_food', { query: 'x' })));
    const out = await runCoachTurn({ claude, coach: fakeCoach(), system: 'S', userContent: 'x' });
    assert.match(out.reply, /stuck/);
    assert.equal(claude.calls.length, 8);
  });

  test('history is normalized to alternating turns ending on assistant', () => {
    assert.deepEqual(normalizeHistory([
      { role: 'assistant', content: 'orphan' },
      { role: 'user', content: 'a' }, { role: 'user', content: 'b' },
      { role: 'assistant', content: 'c' },
      { role: 'user', content: 'unanswered' },
    ]), [{ role: 'user', content: 'a\n\nb' }, { role: 'assistant', content: 'c' }]);
  });
});

// ── telegram handler ─────────────────────────────────────────
function fakeConversation() {
  const seen = new Set();
  const saved = [];
  return {
    saved,
    async claim({ updateId, text }) { if (seen.has(updateId)) return false; seen.add(updateId); saved.push({ role: 'user', text }); return true; },
    async saveReply({ text }) { saved.push({ role: 'assistant', text }); },
    async recent() { return [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'ok' }]; },
  };
}
function fakeTelegram() {
  const sent = [];
  return {
    sent,
    sendMessage: async (chat, t) => sent.push({ chat, t }),
    sendChatAction: async () => {},
    downloadFile: async () => ({ bytes: new Uint8Array([1, 2, 3]), mediaType: 'image/jpeg' }),
  };
}
const OWNER = 8719138509;
const upd = (id, message) => ({ update_id: id, message: { chat: { id: OWNER }, ...message } });

describe('handleUpdate', () => {
  const deps = (claudeScript, coachResults) => ({
    ownerChatId: String(OWNER),
    telegram: fakeTelegram(),
    conversation: fakeConversation(),
    claude: fakeClaude(claudeScript),
    coach: fakeCoach(coachResults),
    now: () => new Date('2026-11-11T14:00:00Z'),
  });

  test('text message: replies, saves both sides, passes history and ctx', async () => {
    const d = deps([use('log_food', { items: [] }), text('Logged 2 eggs.')], { log_food: { footer: FOOTER } });
    const res = await handleUpdate(upd(1, { text: 'had 2 eggs' }), d);
    assert.equal(res.status, 'replied');
    assert.equal(d.telegram.sent[0].t, `Logged 2 eggs.\n\n${FOOTER}`);
    assert.deepEqual(d.conversation.saved.map((s) => s.role), ['user', 'assistant']);
    assert.equal(d.coach.calls[0].ctx.userText, 'had 2 eggs');
    assert.equal(d.coach.calls[0].ctx.source, 'text');
    const msgs = d.claude.calls[0].messages;
    assert.equal(msgs[0].content, 'earlier');
    assert.equal(msgs.at(-1).content, 'had 2 eggs');
    assert.match(d.claude.calls[0].system, /Wednesday, 2026-11-11/);
  });

  test('photo: downloads it, sends it to Claude as an image, marks source photo', async () => {
    const d = deps([use('log_food', { items: [] }), text('Logged your lunch.')], { log_food: { footer: FOOTER } });
    await handleUpdate(upd(2, { photo: [{ file_id: 'small' }, { file_id: 'big' }], caption: 'lunch' }), d);
    const content = d.claude.calls[0].messages.at(-1).content;
    assert.equal(content[0].type, 'image');
    assert.equal(content[0].source.data, 'AQID');
    assert.equal(content[1].text, 'lunch');
    assert.equal(d.coach.calls[0].ctx.source, 'photo');
  });

  test('ignores strangers and duplicate deliveries', async () => {
    const d = deps([text('hi')]);
    const stranger = await handleUpdate({ update_id: 3, message: { chat: { id: 123 }, text: 'log 10 donuts' } }, d);
    assert.equal(stranger.status, 'ignored');
    await handleUpdate(upd(4, { text: 'hello' }), d);
    const again = await handleUpdate(upd(4, { text: 'hello' }), d);
    assert.equal(again.status, 'duplicate');
    assert.equal(d.telegram.sent.length, 1);
  });

  test('/start sends the welcome without calling Claude', async () => {
    const d = deps([]);
    assert.equal((await handleUpdate(upd(5, { text: '/start' }), d)).status, 'welcome');
    assert.equal(d.telegram.sent[0].t, WELCOME);
    assert.equal(d.claude.calls.length, 0);
  });

  test('errors are reported to Matt instead of failing silently', async () => {
    const d = deps([() => { throw new Error('Claude API 529: overloaded'); }]);
    const res = await handleUpdate(upd(6, { text: 'had oatmeal' }), d);
    assert.equal(res.status, 'error');
    assert.match(d.telegram.sent[0].t, /nothing new was saved.*overloaded/);
  });

  test('stickers and other non-text messages get a short note', async () => {
    const d = deps([]);
    assert.equal((await handleUpdate(upd(7, { sticker: {} }), d)).status, 'unsupported');
    assert.equal(d.telegram.sent.length, 1);
  });
});

// ── conversation store ───────────────────────────────────────
describe('conversation', () => {
  test('claim returns false on a duplicate update_id (409)', async () => {
    const db = { insert: async () => { throw new Error('Supabase POST /coach_messages failed (409): duplicate key'); } };
    assert.equal(await createConversation({ db }).claim({ chatId: 1, updateId: 9, text: 'x' }), false);
  });

  test('recent returns oldest first, skips the current message, flags photos', async () => {
    let query = '';
    const db = { select: async (_t, q) => { query = q; return [
      { role: 'user', content: 'now', update_id: 10 },
      { role: 'assistant', content: 'Logged.', update_id: null },
      { role: 'user', content: 'lunch', has_photo: true, update_id: 9 },
    ]; } };
    const rows = await createConversation({ db, now: () => new Date('2026-11-11T12:00:00Z') }).recent({ chatId: 1, excludeUpdateId: 10 });
    assert.deepEqual(rows, [{ role: 'user', content: '[sent a photo] lunch' }, { role: 'assistant', content: 'Logged.' }]);
    assert.match(query, /created_at=gte\.2026-11-09T12:00:00\.000Z/);
  });
});

// ── system prompt + training tool ────────────────────────────
describe('coach context', () => {
  test('system prompt knows the day, week type, block week and today\'s lift', () => {
    const p = buildSystemPrompt(new Date('2026-11-11T14:00:00Z')); // Wed, heavy week, week 1
    assert.match(p, /Wednesday, 2026-11-11/);
    assert.match(p, /heavy kid week/);
    assert.match(p, /week 1 of 8/);
    assert.match(p, /Today's lift: session L/);
    assert.match(p, /never plan, change or prescribe runs/i);
    assert.match(p, /NEVER compute or scale nutrients/);
  });

  test('get_training_week returns the plan with exercises', async () => {
    const coach = createCoachTools({ db: {}, food: {}, now: () => new Date('2026-11-17T15:00:00Z') });
    const w = await coach.execute('get_training_week', {});
    assert.equal(w.type, 'light');
    assert.deepEqual(w.block, { name: 'Foundation Block', week: 2, of: 8, deload: false });
    assert.deepEqual(w.lifts.map((l) => l.session), ['A', 'B', 'C']);
    assert.equal(w.lifts[0].exercises[0].name, 'Trap-bar deadlift');
    const deload = await coach.execute('get_training_week', { date: '2026-12-02' });
    assert.equal(deload.block.deload, true);
    assert.equal(deload.lifts[0].exercises[0].sets, 2);
  });

  test('Claude client sends the right headers and surfaces API errors without the key', async () => {
    const calls = [];
    const ok = createClaude({ apiKey: 'sk-ant-SECRET', fetch: async (u, o) => { calls.push(o); return { ok: true, json: async () => ({ content: [] }) }; } });
    await ok.messages({ messages: [] });
    assert.equal(calls[0].headers['x-api-key'], 'sk-ant-SECRET');
    assert.equal(calls[0].headers['anthropic-version'], '2023-06-01');
    assert.equal(JSON.parse(calls[0].body).model, 'claude-sonnet-5-5');
    const bad = createClaude({ apiKey: 'sk-ant-SECRET', fetch: async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid x-api-key' } }) }) });
    await assert.rejects(bad.messages({}), (e) => /401/.test(e.message) && !e.message.includes('SECRET'));
  });
});
