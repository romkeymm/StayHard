// Wires the coach from environment variables. Server-only.
//
// Required env: SUPABASE_URL, SUPABASE_KEY, FDC_API_KEY, TELEGRAM_BOT_TOKEN,
//               TELEGRAM_CHAT_ID, CRON_SECRET
// Optional env: TARGET_CALORIES, TARGET_PROTEIN_G, TARGET_CARBS_G, TARGET_FAT_G

import { createFoodLookup } from './food-lookup.js';
import { createCoachTools, createSupabase } from './coach-tools.js';
import { createTelegram } from './telegram.js';
import { renderCardPng } from './nutrition-card.js';

export function buildCoach(env = process.env) {
  const telegram = createTelegram({ token: env.TELEGRAM_BOT_TOKEN });
  const defaultChat = env.TELEGRAM_CHAT_ID;

  const sendCard = async (day, ctx = {}) => {
    const chatId = ctx.chatId ?? defaultChat;
    if (!chatId) throw new Error('No Telegram chat id (set TELEGRAM_CHAT_ID)');
    const png = await renderCardPng(day);
    return telegram.sendPhoto(chatId, png, { caption: day.footer });
  };

  const coach = createCoachTools({
    db: createSupabase({ url: env.SUPABASE_URL, key: env.SUPABASE_KEY }),
    food: createFoodLookup({ apiKey: env.FDC_API_KEY }),
    sendCard,
  });

  return {
    coach,
    telegram,
    sendCard,
    sendMessage: (text, chatId = defaultChat) => telegram.sendMessage(chatId, text),
  };
}

// Vercel sends `Authorization: Bearer <CRON_SECRET>` to cron routes.
export function authorized(request, env = process.env) {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get('authorization');
  const query = new URL(request.url).searchParams.get('key');
  return header === `Bearer ${secret}` || query === secret;
}
