import { browser } from '$app/environment';

const SESSION_STORAGE_KEY = 'pelagia-view-analytics-session-id';
const ACTIVITY_EVENT_INTERVAL_MS = 30_000;

type PageMetrics = {
  route: string;
  startedAt: number;
  hiddenStartedAt: number | null;
  hiddenDurationMs: number;
  interactionCount: number;
  firstInteractionAt: number | null;
  lastInteractionAt: number | null;
};

let currentPage: PageMetrics | null = null;
let lastActivityEventAt = 0;

export function recordClientEvent(eventType: string, payload: Record<string, unknown> = {}) {
  if (!browser) return;
  const body = JSON.stringify({
    event_type: eventType,
    route: window.location.pathname + window.location.search,
    session_id: analyticsSessionId(),
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

export function initClientAnalytics(): () => void {
  if (!browser) return () => undefined;

  const route = window.location.pathname + window.location.search;
  if (!currentPage) {
    startPage(route);
  } else if (currentPage.route !== route) {
    recordRouteChange(route);
  }

  const handleVisibilityChange = () => {
    const now = performance.now();
    if (!currentPage) return;
    if (document.visibilityState === 'hidden') {
      currentPage.hiddenStartedAt = now;
      recordPageDuration('visibility_hidden');
    } else {
      startPage(window.location.pathname + window.location.search, { recordView: false });
    }
  };

  const handlePageHide = () => {
    recordPageDuration('pagehide');
  };

  const handleInteraction = (event: Event) => {
    recordInteraction(event.type);
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pagehide', handlePageHide);
  for (const eventName of ['click', 'keydown', 'pointerdown', 'input', 'change']) {
    window.addEventListener(eventName, handleInteraction, { passive: true });
  }

  return () => {
    recordPageDuration('cleanup');
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('pagehide', handlePageHide);
    for (const eventName of ['click', 'keydown', 'pointerdown', 'input', 'change']) {
      window.removeEventListener(eventName, handleInteraction);
    }
  };
}

export function recordRouteChange(route: string) {
  if (!browser) return;
  if (currentPage?.route === route) return;
  recordPageDuration('navigation');
  startPage(route);
}

export function recordApiRequest(input: string, init: RequestInit | undefined, response: Response | null, durationMs: number, error?: unknown) {
  if (!browser) return;
  const url = new URL(input, window.location.href);
  const method = String(init?.method ?? 'GET').toUpperCase();
  recordClientEvent('client_api_request', {
    method,
    endpoint: url.pathname,
    endpoint_group: endpointGroup(url.pathname),
    query_keys: [...url.searchParams.keys()].sort(),
    status: response?.status ?? 0,
    ok: Boolean(response?.ok),
    duration_ms: roundedDuration(durationMs),
    error_name: error instanceof Error ? error.name : error ? 'UnknownError' : null,
    base_origin: url.origin
  });
}

export function recordSessionEvent(
  eventType:
    | 'client_session_connected'
    | 'client_session_restored'
    | 'client_session_disconnected'
    | 'client_session_failed'
    | 'client_session_project_switched',
  payload: Record<string, unknown> = {}
) {
  recordClientEvent(eventType, payload);
}

function startPage(route: string, options: { recordView?: boolean } = {}) {
  const recordView = options.recordView ?? true;
  currentPage = {
    route,
    startedAt: performance.now(),
    hiddenStartedAt: document.visibilityState === 'hidden' ? performance.now() : null,
    hiddenDurationMs: 0,
    interactionCount: 0,
    firstInteractionAt: null,
    lastInteractionAt: null
  };
  if (recordView) {
    recordClientEvent('client_page_view', {
      page_route: route,
      visibility_state: document.visibilityState
    });
  }
}

function recordPageDuration(reason: string) {
  if (!browser || !currentPage) return;
  const now = performance.now();
  const hiddenDurationMs =
    currentPage.hiddenDurationMs +
    (currentPage.hiddenStartedAt === null ? 0 : Math.max(0, now - currentPage.hiddenStartedAt));
  const durationMs = Math.max(0, now - currentPage.startedAt);
  recordClientEvent('client_page_duration', {
    page_route: currentPage.route,
    reason,
    duration_ms: roundedDuration(durationMs),
    visible_duration_ms: roundedDuration(Math.max(0, durationMs - hiddenDurationMs)),
    interaction_count: currentPage.interactionCount,
    first_interaction_ms:
      currentPage.firstInteractionAt === null
        ? null
        : roundedDuration(currentPage.firstInteractionAt - currentPage.startedAt),
    last_interaction_ms:
      currentPage.lastInteractionAt === null
        ? null
        : roundedDuration(currentPage.lastInteractionAt - currentPage.startedAt)
  });
  currentPage = null;
}

function recordInteraction(activityType: string) {
  if (!currentPage || document.visibilityState === 'hidden') return;
  const now = performance.now();
  currentPage.interactionCount += 1;
  currentPage.firstInteractionAt ??= now;
  currentPage.lastInteractionAt = now;
  if (now - lastActivityEventAt < ACTIVITY_EVENT_INTERVAL_MS) return;
  lastActivityEventAt = now;
  recordClientEvent('client_activity', {
    page_route: currentPage.route,
    activity_type: activityType,
    interaction_count: currentPage.interactionCount,
    elapsed_ms: roundedDuration(now - currentPage.startedAt)
  });
}

function analyticsSessionId(): string {
  let value = localStorage.getItem(SESSION_STORAGE_KEY);
  if (!value) {
    value = generateSessionId();
    localStorage.setItem(SESSION_STORAGE_KEY, value);
  }
  return value;
}

function generateSessionId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `pv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function endpointGroup(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  return `/${segments.slice(0, 2).join('/')}`;
}

function roundedDuration(value: number): number {
  return Math.round(value * 10) / 10;
}
