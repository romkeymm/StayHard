// Handles one Telegram update end to end. Kept separate from the route so it
// can be tested without Next.js.

import { runCoachTurn } from './agent.js';
import { buildSystemPrompt } from './system-prompt.js';

const TELEGRAM_LIMIT = 4000;

export const WELCOME =
  "StayHard coach here. Tell me what you eat (text, a photo, or a barcode) and I'll log it. " +
  'Send your weight any morning. Ask "what am I lifting this week?" or "how am I doing today?" anytime.';

function chunks(text) {
  const out = [];
  let rest = text;
  while (rest.length > TELEGRAM_LIMIT) {
    const cut = rest.lastIndexOf('\n', TELEGRAM_LIMIT) > 1000 ? rest.lastIndexOf('\n', TELEGRAM_LIMIT) : TELEGRAM_LIMIT;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  out.push(rest);
  return out;
}

const toBase64 = (bytes) => Buffer.from(bytes).toString('base64');

// deps: { ownerChatId, telegram, conversation, claude, coach, now }
export async function handleUpdate(update, deps) {
  const { ownerChatId, telegram, conversation, claude, coach, now = () => new Date() } = deps;
  const msg = update?.message;
  if (!msg) return { status: 'ignored', reason: 'not a message' };

  const chatId = msg.chat?.id;
  if (String(chatId) !== String(ownerChatId)) return { status: 'ignored', reason: 'not the owner' };

  const text = (msg.text ?? msg.caption ?? '').trim();
  const photo = Array.isArray(msg.photo) && msg.photo.length ? msg.photo[msg.photo.length - 1] : null;
  if (!text && !photo) {
    await telegram.sendMessage(chatId, 'I can read text and photos. Send me what you ate, your weight, or a question.');
    return { status: 'unsupported' };
  }

  const fresh = await conversation.claim({ chatId, updateId: update.update_id, text, hasPhoto: !!photo });
  if (!fresh) return { status: 'duplicate' };

  if (text === '/start') {
    await telegram.sendMessage(chatId, WELCOME);
    await conversation.saveReply({ chatId, text: WELCOME });
    return { status: 'welcome' };
  }

  try { await telegram.sendChatAction(chatId, 'typing'); } catch { /* cosmetic only */ }

  try {
    let userContent = text;
    if (photo) {
      const { bytes, mediaType } = await telegram.downloadFile(photo.file_id);
      userContent = [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: toBase64(bytes) } },
        { type: 'text', text: text || 'Log what is in this photo.' },
      ];
    }

    const history = await conversation.recent({ chatId, excludeUpdateId: update.update_id });
    const { reply, toolCalls } = await runCoachTurn({
      claude, coach,
      system: buildSystemPrompt(now()),
      history,
      userContent,
      ctx: { chatId, userText: text || '[photo]', source: photo ? 'photo' : 'text' },
    });

    for (const part of chunks(reply)) await telegram.sendMessage(chatId, part);
    await conversation.saveReply({ chatId, text: reply });
    return { status: 'replied', toolCalls: toolCalls.map((t) => t.name) };
  } catch (e) {
    console.error('[telegram]', e);
    const note = `Something broke on my end, so nothing new was saved from that message. (${String(e.message).slice(0, 150)})`;
    try { await telegram.sendMessage(chatId, note); } catch { /* nothing more to do */ }
    return { status: 'error', error: e.message };
  }
}
