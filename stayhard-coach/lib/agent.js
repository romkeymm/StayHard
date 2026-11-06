// One coaching turn: send the conversation to Claude, run any tools it asks
// for, repeat until it answers. The server, not the model, has the last word
// on the totals footer: after a successful log_food the reply always ends
// with the canonical running total.

import { TOOLS, withFooter } from './coach-tools.js';

const MAX_ROUNDS = 8;
const MAX_TOOL_RESULT = 8000;

const clip = (s) => (s.length > MAX_TOOL_RESULT ? `${s.slice(0, MAX_TOOL_RESULT)}…(truncated)` : s);

// history: [{ role: 'user'|'assistant', content: string }] oldest first.
// userContent: string, or an array of Anthropic content blocks (text + image).
export async function runCoachTurn({ claude, coach, system, history = [], userContent, ctx = {}, tools = TOOLS }) {
  const messages = [...normalizeHistory(history), { role: 'user', content: userContent }];
  const toolCalls = [];
  let footer = null;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await claude.messages({ system, tools, messages });
    const blocks = res.content ?? [];
    const uses = blocks.filter((b) => b.type === 'tool_use');

    if (res.stop_reason !== 'tool_use' || uses.length === 0) {
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      return { reply: withFooter(text || 'Done.', footer), footer, toolCalls };
    }

    messages.push({ role: 'assistant', content: blocks });
    const results = [];
    for (const use of uses) {
      const out = await coach.execute(use.name, use.input ?? {}, ctx);
      toolCalls.push({ name: use.name, input: use.input, error: out?.error ?? null });
      if (use.name === 'log_food' && !out?.error && out?.footer) footer = out.footer;
      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: clip(JSON.stringify(out)),
        ...(out?.error ? { is_error: true } : {}),
      });
    }
    messages.push({ role: 'user', content: results });
  }

  return {
    reply: withFooter("I got stuck working through that one. Try rephrasing, or send it in smaller pieces.", footer),
    footer, toolCalls,
  };
}

// The API needs alternating roles starting with 'user'; merge runs and trim.
export function normalizeHistory(history) {
  const out = [];
  for (const m of history) {
    if (!m?.content || !['user', 'assistant'].includes(m.role)) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content = `${last.content}\n\n${m.content}`;
    else out.push({ role: m.role, content: String(m.content) });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  // The new user message follows, so history must end on an assistant turn.
  while (out.length && out[out.length - 1].role !== 'assistant') out.pop();
  return out;
}
