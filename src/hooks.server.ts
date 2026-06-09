import type { Handle } from '@sveltejs/kit';
import { recordAnalytics } from '$lib/server/analytics';

export const handle: Handle = async ({ event, resolve }) => {
  const started = performance.now();
  const response = await resolve(event);
  const durationMs = Math.round((performance.now() - started) * 10) / 10;
  const pathname = event.url.pathname;

  if (!pathname.startsWith('/_app/') && pathname !== '/favicon.ico') {
    void recordAnalytics({
      event_type: 'server_request',
      route: `${pathname}${event.url.search}`,
      method: event.request.method,
      status: response.status,
      duration_ms: durationMs,
      user_agent: event.request.headers.get('user-agent'),
      remote_addr: event.getClientAddress()
    });
  }

  return response;
};
