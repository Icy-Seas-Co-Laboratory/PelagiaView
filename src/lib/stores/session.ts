import { browser } from '$app/environment';
import { get, writable } from 'svelte/store';
import { PelagiaApiClient, normalizeBaseUrl } from '$lib/api/client';
import type { HealthResponse, SystemStatus } from '$lib/api/types';
import { recordSessionEvent } from '$lib/utils/analytics';

const STORAGE_KEY = 'pelagia-view-session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

type StoredSession = {
  baseUrl?: string;
  active?: boolean;
  connectedAt?: string | null;
  expiresAt?: string | null;
};

export type SessionState = {
  baseUrl: string;
  connected: boolean;
  connecting: boolean;
  error: string | null;
  health: HealthResponse | null;
  systemStatus: SystemStatus | null;
  connectedAt: string | null;
};

const initialStoredSession = browser ? readStoredSession() : null;
const initialBaseUrl = initialStoredSession?.baseUrl ?? 'http://127.0.0.1:8000';
const initialShouldRestore = shouldRestoreStoredSession(initialStoredSession);

export const session = writable<SessionState>({
  baseUrl: initialBaseUrl,
  connected: false,
  connecting: initialShouldRestore,
  error: null,
  health: null,
  systemStatus: null,
  connectedAt: null
});

let client: PelagiaApiClient | null = null;

export function getClient(): PelagiaApiClient | null {
  const state = get(session);
  if (!state.connected) return null;
  if (!client || client.baseUrl !== normalizeBaseUrl(state.baseUrl)) {
    client = new PelagiaApiClient(state.baseUrl);
  }
  return client;
}

export async function connectSession(baseUrl: string): Promise<void> {
  await establishSession(baseUrl, { persistActive: true });
}

export async function restoreSession(): Promise<void> {
  if (!browser) return;
  const stored = readStoredSession();
  if (!shouldRestoreStoredSession(stored) || !stored?.baseUrl) {
    session.update((state) => ({ ...state, connecting: false }));
    persistStoredSession({ baseUrl: stored?.baseUrl ?? get(session).baseUrl, active: false });
    return;
  }
  try {
    await establishSession(stored.baseUrl, { persistActive: true, restoring: true });
  } catch {
    persistStoredSession({ baseUrl: stored.baseUrl, active: false });
  }
}

async function establishSession(
  baseUrl: string,
  options: { persistActive: boolean; restoring?: boolean }
): Promise<void> {
  const normalized = normalizeBaseUrl(baseUrl);
  session.update((state) => ({ ...state, baseUrl: normalized, connecting: true, error: null }));
  const nextClient = new PelagiaApiClient(normalized);

  try {
    const [health, systemStatus] = await Promise.all([
      nextClient.health(),
      nextClient.systemStatus().catch(() => null)
    ]);
    client = nextClient;
    const connectedAt = new Date().toISOString();
    session.set({
      baseUrl: normalized,
      connected: true,
      connecting: false,
      error: null,
      health,
      systemStatus,
      connectedAt
    });
    if (browser && options.persistActive) {
      persistStoredSession({
        baseUrl: normalized,
        active: true,
        connectedAt,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
      });
    }
    recordSessionEvent(options.restoring ? 'client_session_restored' : 'client_session_connected', {
      base_origin: baseOrigin(normalized),
      health_status: health.status,
      has_system_status: Boolean(systemStatus)
    });
  } catch (error) {
    session.update((state) => ({
      ...state,
      connected: false,
      connecting: false,
      error: error instanceof Error ? error.message : String(error),
      health: null,
      systemStatus: null,
      connectedAt: null
    }));
    if (browser && !options.restoring) {
      persistStoredSession({ baseUrl: normalized, active: false });
    }
    recordSessionEvent('client_session_failed', {
      base_origin: baseOrigin(normalized),
      restoring: Boolean(options.restoring),
      error_name: error instanceof Error ? error.name : 'UnknownError'
    });
    throw error;
  }
}

export function disconnectSession(): void {
  const baseUrl = get(session).baseUrl;
  client = null;
  session.update((state) => ({
    ...state,
    connected: false,
    connecting: false,
    error: null,
    health: null,
    systemStatus: null,
    connectedAt: null
  }));
  if (browser) {
    persistStoredSession({ baseUrl: get(session).baseUrl, active: false });
  }
  recordSessionEvent('client_session_disconnected', {
    base_origin: baseOrigin(baseUrl)
  });
}

function readStoredSession(): StoredSession | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    return JSON.parse(stored) as StoredSession;
  } catch {
    return null;
  }
}

function shouldRestoreStoredSession(stored: StoredSession | null): boolean {
  if (!stored?.active || !stored.baseUrl || !stored.expiresAt) return false;
  return new Date(stored.expiresAt).getTime() > Date.now();
}

function persistStoredSession(stored: StoredSession): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      baseUrl: stored.baseUrl ?? 'http://127.0.0.1:8000',
      active: Boolean(stored.active),
      connectedAt: stored.connectedAt ?? null,
      expiresAt: stored.expiresAt ?? null
    })
  );
}

function baseOrigin(value: string): string {
  try {
    return new URL(normalizeBaseUrl(value)).origin;
  } catch {
    return 'unknown';
  }
}
