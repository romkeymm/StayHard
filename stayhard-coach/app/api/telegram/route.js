// POST /api/telegram — Telegram webhook. Registered with a secret token, so
// only Telegram (and nobody who merely knows the URL) can drive the coach.

import { buildCoach } from '../../../lib/coach.js';
import { handleUpdate } from '../../../lib/telegram-handler.js';
import { createTelegram } from '../../../lib/telegram.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || request.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return new Response('Unauthorized', { status: 401 });
  }
  const update = await request.json().catch(() => null);
  try {
    const deps = buildCoach();
    const result = await handleUpdate(update, {
      ownerChatId: process.env.TELEGRAM_CHAT_ID,
      telegram: deps.telegram,
      conversation: deps.conversation,
      claude: deps.claude,
      coach: deps.coach,
    });
    console.log('[telegram]', update?.update_id, result.status);
  } catch (e) {
    // Setup errors (missing or mistyped env vars). Tell Matt on Telegram, and
    // still answer 200 so Telegram doesn't retry forever.
    console.error('[telegram] setup', e);
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (chatId && update?.message?.chat?.id && String(update.message.chat.id) === String(chatId)) {
      try {
        await createTelegram({ token: process.env.TELEGRAM_BOT_TOKEN })
          .sendMessage(chatId, `I couldn't process that message. ${String(e.message).slice(0, 300)}`);
      } catch { /* token itself is broken; logs are the only signal */ }
    }
  }
  return Response.json({ ok: true });
}
