import { browser } from '$app/environment';
import { derived, get, writable } from 'svelte/store';
import type { Job, JobEvent, JobSeries, LogEntry } from '$lib/api/types';
import { getClient, session } from '$lib/stores/session';

/**
 * One client-side source of truth for the job-series monitor.  The API does
 * not currently expose an authenticated job-event stream, so this store uses
 * adaptive polling as its transport.  Consumers do not need to change when an
 * SSE transport is added: replace `refresh` with an event application path.
 */
export type LiveJobSeriesState = {
  series: JobSeries[];
  selected: JobSeries | null;
  jobs: Job[];
  events: JobEvent[];
  logs: LogEntry[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  lastUpdatedAt: Date | null;
  transport: 'adaptive-polling';
};

const initial: LiveJobSeriesState = {
  series: [], selected: null, jobs: [], events: [], logs: [],
  loading: false, refreshing: false, error: null, lastUpdatedAt: null,
  transport: 'adaptive-polling'
};

const state = writable<LiveJobSeriesState>(initial);
let timer: number | null = null;
let activeConsumers = 0;
let requestVersion = 0;
let refreshing = false;
let selectedId: string | null = null;

function pollDelay(): number {
  if (!browser || document.visibilityState !== 'visible') return 30_000;
  const value = get(state);
  return value.selected && !isTerminal(value.selected.status) ? 4_000 : 12_000;
}

function isTerminal(status: string | null | undefined): boolean {
  return ['succeeded', 'failed', 'cancelled', 'dead_lettered', 'completed'].includes(String(status ?? '').toLowerCase());
}

function schedule(): void {
  if (!browser || activeConsumers === 0) return;
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(async () => {
    await refresh(true);
    schedule();
  }, pollDelay());
}

function jobIds(series: JobSeries | null): string[] {
  if (!series) return [];
  return [...new Set([...(series.job_ids ?? []), ...(series.steps ?? []).flatMap((step) => step.job_ids ?? [])])];
}

async function refresh(quiet = false): Promise<void> {
  const client = getClient();
  if (!client || refreshing) return;
  refreshing = true;
  const version = ++requestVersion;
  state.update((current) => ({ ...current, loading: !quiet, refreshing: quiet, error: quiet ? current.error : null }));
  try {
    const list = await client.listJobSeries({ limit: 100, include_details: true });
    const desired = selectedId ?? get(state).selected?.id ?? list[0]?.id ?? null;
    const listed = desired ? list.find((item) => item.id === desired) ?? null : null;
    const detail = desired ? await client.getJobSeries(desired) : listed;
    const ids = jobIds(detail);
    // Details are intentionally bounded: a workflow with thousands of units
    // remains inspectable without turning a monitor refresh into a fan-out.
    const inspectedIds = ids.slice(0, 50);
    const jobs = await Promise.all(inspectedIds.map((id) => client.getJob(id).catch(() => null)));
    const eventAndLogs = await Promise.all(inspectedIds.slice(0, 20).map(async (id) => {
      const [events, logs] = await Promise.all([
        client.listJobEvents({ job_id: id, limit: 30 }).catch(() => []),
        client.listLogs({ job_id: id, limit: 20 }).catch(() => [])
      ]);
      return { events, logs };
    }));
    if (version !== requestVersion) return;
    state.set({
      series: list,
      selected: detail ?? listed,
      jobs: jobs.filter((job): job is Job => Boolean(job)),
      events: eventAndLogs.flatMap((item) => item.events).sort((a, b) => (b.id ?? 0) - (a.id ?? 0)),
      logs: eventAndLogs.flatMap((item) => item.logs).sort((a, b) => (b.id ?? 0) - (a.id ?? 0)),
      loading: false, refreshing: false, error: null, lastUpdatedAt: new Date(), transport: 'adaptive-polling'
    });
  } catch (error) {
    if (version === requestVersion) {
      state.update((current) => ({ ...current, loading: false, refreshing: false, error: error instanceof Error ? error.message : String(error) }));
    }
  } finally {
    refreshing = false;
  }
}

function onVisibilityChange(): void {
  void refresh(true).finally(schedule);
}

export const jobSeriesLive = {
  subscribe: state.subscribe,
  selectedId: derived(state, ($state) => $state.selected?.id ?? null),
  start(): () => void {
    activeConsumers += 1;
    if (activeConsumers === 1 && browser) {
      document.addEventListener('visibilitychange', onVisibilityChange);
      void refresh();
      schedule();
    }
    return () => {
      activeConsumers = Math.max(0, activeConsumers - 1);
      if (activeConsumers === 0 && browser) {
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
    };
  },
  async select(id: string | null): Promise<void> {
    selectedId = id;
    await refresh();
    schedule();
  },
  refresh,
  reportError(error: unknown): void {
    state.update((current) => ({
      ...current,
      error: error instanceof Error ? error.message : String(error)
    }));
  },
  async control(action: 'pause' | 'resume' | 'cancel' | 'retry'): Promise<JobSeries> {
    const client = getClient();
    const selected = get(state).selected;
    if (!client || !selected) throw new Error('Connect to Pelagia and select a job series first.');
    const updated = await client.controlJobSeries(selected.id, action);
    state.update((current) => ({
      ...current,
      selected: updated,
      series: current.series.map((item) => item.id === updated.id ? { ...item, ...updated } : item)
    }));
    void refresh(true);
    return updated;
  }
};

// Switching projects/session invalidates data owned by the prior project.
session.subscribe(($session) => {
  if (!$session.connected) {
    requestVersion += 1;
    selectedId = null;
    state.set(initial);
  }
});
