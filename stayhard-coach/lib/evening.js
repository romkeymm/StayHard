// Evening check-in: at 8 PM Central, send the nutrition card, or a short
// nudge if nothing was logged today.
//
// Vercel cron is UTC-only and, on Hobby, fires anywhere within the scheduled
// hour. vercel.json schedules 01:30 and 02:30 UTC (8:30 PM in CDT and CST).
// Only the run that lands in the 8 PM Central hour sends; the other skips.

import { localHour } from './coach-tools.js';

export const SEND_HOUR = 20;

export const NUDGE =
  "Nothing logged today. Send me what you ate, even a rough list, and I'll tally it before bed.";

export function isEveningSlot(now = new Date()) {
  return localHour(now) === SEND_HOUR;
}

// coach: from createCoachTools; sendCard and sendMessage deliver to Telegram.
export async function runEveningCheckin({ coach, sendCard, sendMessage, now = new Date(), force = false }) {
  if (!force && !isEveningSlot(now)) {
    return { action: 'skipped', reason: `not the ${SEND_HOUR}:00 hour in Central time`, hour: localHour(now) };
  }
  const day = await coach.get_nutrition_day({});
  if (!day.items.length) {
    await sendMessage(NUDGE);
    return { action: 'nudge', date: day.date };
  }
  await sendCard(day);
  return { action: 'card', date: day.date, items: day.items.length, footer: day.footer };
}
