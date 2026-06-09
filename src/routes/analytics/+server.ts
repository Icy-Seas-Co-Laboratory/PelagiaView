import { json, type RequestHandler } from '@sveltejs/kit';
import { recordAnalytics } from '$lib/server/analytics';

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  const payload = await request.json().catch(() => ({}));
  const eventType =
    typeof payload?.event_type === 'string' && payload.event_type
      ? payload.event_type
      : 'client_event';

  await recordAnalytics({
    event_type: eventType,
    user_agent: request.headers.get('user-agent'),
    remote_addr: getClientAddress(),
    payload: typeof payload === 'object' && payload !== null ? payload : { value: payload }
  });

  return json({ ok: true });
};
