import { json, type RequestHandler } from '@sveltejs/kit';
import { recordAnalytics } from '$lib/server/analytics';

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  const payload = await request.json().catch(() => ({}));
  const eventType =
    typeof payload?.event_type === 'string' && payload.event_type
      ? payload.event_type
      : 'client_event';
  const route = typeof payload?.route === 'string' ? payload.route : undefined;
  const sessionId = typeof payload?.session_id === 'string' ? payload.session_id : null;
  const rawEventPayload =
    typeof payload === 'object' && payload !== null && 'payload' in payload
      ? (payload as { payload?: unknown }).payload
      : payload;
  const eventPayload =
    typeof rawEventPayload === 'object' && rawEventPayload !== null
      ? (rawEventPayload as Record<string, unknown>)
      : rawEventPayload === undefined
        ? {}
        : { value: rawEventPayload };

  await recordAnalytics({
    event_type: eventType,
    route,
    session_id: sessionId,
    user_agent: request.headers.get('user-agent'),
    remote_addr: getClientAddress(),
    payload: eventPayload
  });

  return json({ ok: true });
};
