import { browser } from '$app/environment';

export function recordClientEvent(eventType: string, payload: Record<string, unknown> = {}) {
  if (!browser) return;
  const body = JSON.stringify({
    event_type: eventType,
    route: window.location.pathname + window.location.search,
    payload
  });

  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: 'application/json' });
    navigator.sendBeacon('/analytics', blob);
    return;
  }

  void fetch('/analytics', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    keepalive: true
  }).catch(() => undefined);
}
