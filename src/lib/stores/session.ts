import { browser } from '$app/environment';
import { get, writable } from 'svelte/store';
import { PelagiaApiClient, normalizeBaseUrl } from '$lib/api/client';
import type { HealthResponse, SystemStatus } from '$lib/api/types';

const STORAGE_KEY = 'pelagia-view-session';

export type SessionState = {
  baseUrl: string;
  connected: boolean;
  connecting: boolean;
  error: string | null;
  health: HealthResponse | null;
  systemStatus: SystemStatus | null;
  connectedAt: string | null;
};

const initialBaseUrl = browser ? readStoredBaseUrl() : 'http://127.0.0.1:8000';

export const session = writable<SessionState>({
  baseUrl: initialBaseUrl,
  connected: false,
  connecting: false,
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
  const normalized = normalizeBaseUrl(baseUrl);
  session.update((state) => ({ ...state, baseUrl: normalized, connecting: true, error: null }));
  const nextClient = new PelagiaApiClient(normalized);

  try {
    const [health, systemStatus] = await Promise.all([
      nextClient.health(),
      nextClient.systemStatus().catch(() => null)
    ]);
    client = nextClient;
    session.set({
      baseUrl: normalized,
      connected: true,
      connecting: false,
      error: null,
      health,
      systemStatus,
      connectedAt: new Date().toISOString()
    });
    if (browser) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ baseUrl: normalized }));
    }
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
    throw error;
  }
}

export function disconnectSession(): void {
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
}

function readStoredBaseUrl(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return 'http://127.0.0.1:8000';
    const parsed = JSON.parse(stored) as { baseUrl?: string };
    return parsed.baseUrl ?? 'http://127.0.0.1:8000';
  } catch {
    return 'http://127.0.0.1:8000';
  }
}
