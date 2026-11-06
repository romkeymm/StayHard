// GET /api/cron/evening — called by Vercel cron (see vercel.json).
// Manual test: /api/cron/evening?key=CRON_SECRET&force=1 sends now.

import { buildCoach, authorized } from '../../../../lib/coach.js';
import { runEveningCheckin } from '../../../../lib/evening.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!authorized(request)) return new Response('Unauthorized', { status: 401 });
  const force = new URL(request.url).searchParams.get('force') === '1';
  try {
    const { coach, sendCard, sendMessage } = buildCoach();
    const result = await runEveningCheckin({ coach, sendCard, sendMessage, force });
    return Response.json(result);
  } catch (e) {
    console.error('[evening]', e);
    return Response.json({ error: e.message }, { status: 500 });
  }
}
