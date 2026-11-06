// GET /api/card?key=CRON_SECRET[&date=YYYY-MM-DD] — preview the card PNG in a
// browser without sending it. Protected because it shows your food log.

import { buildCoach, authorized } from '../../../lib/coach.js';
import { renderCardPng } from '../../../lib/nutrition-card.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!authorized(request)) return new Response('Unauthorized', { status: 401 });
  const date = new URL(request.url).searchParams.get('date') ?? undefined;
  const { coach } = buildCoach();
  const day = await coach.get_nutrition_day({ date });
  if (day.error) return Response.json(day, { status: 400 });
  return new Response(await renderCardPng(day), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
  });
}
