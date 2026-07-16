import { get, writable } from 'svelte/store';
import { getClient } from '$lib/stores/session';
import type { SystemUsageResponse } from '$lib/api/types';

type SystemUsageState = {
  usage: SystemUsageResponse | null;
  loading: boolean;
  error: string | null;
  lastUpdatedAt: string | null;
};

export const systemUsageState = writable<SystemUsageState>({
  usage: null,
  loading: false,
  error: null,
  lastUpdatedAt: null
});

let pollTimer: number | null = null;
let subscriberCount = 0;
let refreshSequence = 0;

export function startSystemUsagePolling(intervalMs = 15000): () => void {
  subscriberCount += 1;
  if (subscriberCount === 1) {
    void refreshSystemUsage();
    pollTimer = window.setInterval(() => void refreshSystemUsage(), intervalMs);
  }
  return () => {
    subscriberCount = Math.max(0, subscriberCount - 1);
    if (subscriberCount === 0 && pollTimer !== null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  };
}

export async function refreshSystemUsage(): Promise<void> {
  const client = getClient();
  if (!client) {
    systemUsageState.set({ usage: null, loading: false, error: null, lastUpdatedAt: null });
    return;
  }
  const sequence = ++refreshSequence;
  systemUsageState.update((state) => ({ ...state, loading: true }));
  try {
    const usage = await client.systemUsage();
    if (sequence !== refreshSequence) return;
    systemUsageState.set({
      usage,
      loading: false,
      error: null,
      lastUpdatedAt: new Date().toISOString()
    });
  } catch (error) {
    if (sequence !== refreshSequence) return;
    const current = get(systemUsageState);
    systemUsageState.set({
      usage: current.usage,
      loading: false,
      error: error instanceof Error ? error.message : String(error),
      lastUpdatedAt: current.lastUpdatedAt
    });
  }
}
