// Wires the coach from environment variables. Server-only.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_KEY (or SUPABASE_KEY), FDC_API_KEY,
//               TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, CRON_SECRET, TELEGRAM_WEBHOOK_SECRET,
//               and one model key: GEMINI_API_KEY (free tier) or ANTHROPIC_API_KEY
// Optional env: GEMINI_MODEL, ANTHROPIC_MODEL, TARGET_CALORIES, TARGET_PROTEIN_G, TARGET_CARBS_G, TARGET_FAT_G

import { createFoodLookup } from './food-lookup.js';
import { createCoachTools, createSupabase } from './coach-tools.js';
import { createTelegram } from './telegram.js';
import { renderCardPng } from './nutrition-card.js';
import { createClaude } from './anthropic.js';
import { createGemini } from './gemini.js';
import { createConversation } from './conversation.js';

// Catches the common setup mistakes (missing value, pasted placeholder text,
// stray spaces) with a message that names the variable.
export function checkEnv(env = process.env, names = ['SUPABASE_URL', 'TELEGRAM_BOT_TOKEN', 'FDC_API_KEY']) {
  const problems = [];
  for (const n of names) {
    const v = env[n];
    if (!v) problems.push(`${n} is not set`);
    else if (/[^\x21-\x7e]/.test(v)) problems.push(`${n} contains spaces or special characters; it looks like placeholder text rather than the real value`);
    else if (/^<.*>$/.test(v)) problems.push(`${n} still has the <placeholder> from the instructions`);
  }
  if (!env.SUPABASE_SERVICE_KEY && !env.SUPABASE_KEY) problems.push('SUPABASE_SERVICE_KEY is not set');
  else if (env.SUPABASE_SERVICE_KEY && /[^\x21-\x7e]/.test(env.SUPABASE_SERVICE_KEY)) problems.push('SUPABASE_SERVICE_KEY contains spaces or special characters; paste the actual sb_secret_... key');
  if (problems.length) throw new Error(`Setup problem: ${problems.join('; ')}.`);
}

export function buildCoach(env = process.env) {
  checkEnv(env);
  const telegram = createTelegram({ token: env.TELEGRAM_BOT_TOKEN });
  const defaultChat = env.TELEGRAM_CHAT_ID;
  // The secret (service) key bypasses row level security; it never leaves the server.
  const db = createSupabase({ url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_KEY || env.SUPABASE_KEY });

  const sendCard = async (day, ctx = {}) => {
    const chatId = ctx.chatId ?? defaultChat;
    if (!chatId) throw new Error('No Telegram chat id (set TELEGRAM_CHAT_ID)');
    const png = await renderCardPng(day);
    return telegram.sendPhoto(chatId, png, { caption: day.footer });
  };

  const coach = createCoachTools({
    db,
    food: createFoodLookup({ apiKey: env.FDC_API_KEY }),
    sendCard,
  });

  return {
    coach,
    telegram,
    sendCard,
    sendMessage: (text, chatId = defaultChat) => telegram.sendMessage(chatId, text),
    conversation: createConversation({ db }),
    // The model behind the coach. Gemini (free tier) when GEMINI_API_KEY is set,
    // otherwise Claude. Created lazily so cron routes work before either key exists.
    get claude() {
      if (env.GEMINI_API_KEY) return createGemini({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || undefined });
      return createClaude({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL || undefined });
    },
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
