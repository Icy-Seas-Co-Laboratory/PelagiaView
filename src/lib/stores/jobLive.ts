import { browser } from '$app/environment';
import { derived, get, writable } from 'svelte/store';
import type { Job, JobEvent, JobSeries, LogEntry } from '$lib/api/types';
import { getClient, session } from '$lib/stores/session';
import { invalidateQueueStatus, queueStatus, type QueueStatusStore } from '$lib/stores/queueStatus';

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
let selectedId: string | null = null;
let statusStore: QueueStatusStore | null = null;
let stopStatusStore: (() => void) | null = null;
let statusScopeKey = '';
let statusScopeIdentity = '';
let statusError: string | null = null;

type SessionIdentitySource = {
  connected?: boolean;
  baseUrl?: string;
  token?: string | null;
  project?: { id?: string | null; project_key?: string | null } | null;
};

function identityFor(value: SessionIdentitySource): string {
  return value.connected
    ? `${value.baseUrl ?? ''}:${value.token ?? ''}:${value.project?.id ?? value.project?.project_key ?? ''}`
    : '';
}

function isCurrentRequest(version: number, identity: string): boolean {
  return version === requestVersion && identity === identityFor(get(session));
}

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

function clearStatusStore(clearJobs = false): void {
  stopStatusStore?.();
  stopStatusStore = null;
  statusStore = null;
  statusScopeKey = '';
  statusScopeIdentity = '';
  statusError = null;
  if (clearJobs) state.update((current) => ({ ...current, jobs: [] }));
}

function bindStatusStore(ids: string[], identity: string, projectId: string | null): QueueStatusStore | null {
  const normalizedIds = [...new Set(ids)].sort();
  const scopeKey = JSON.stringify(normalizedIds);
  if (!normalizedIds.length) {
    clearStatusStore(true);
    return null;
  }
  if (statusStore && statusScopeKey === scopeKey && statusScopeIdentity === identity) return statusStore;

  clearStatusStore(true);
  const next = queueStatus({ ids: normalizedIds, job_limit: normalizedIds.length, recent_failure_limit: 0 });
  statusStore = next;
  statusScopeKey = scopeKey;
  statusScopeIdentity = identity;
  stopStatusStore = next.subscribe((status) => {
    if (identity !== identityFor(get(session)) || statusScopeKey !== scopeKey) return;
    const snapshotProject = status.snapshot?.scope?.project_id ?? null;
    const scopeMismatch = Boolean(projectId && snapshotProject && projectId !== snapshotProject);
    const previousStatusError = statusError;
    statusError = scopeMismatch
      ? `Queue status scope ${snapshotProject} does not match project ${projectId}.`
      : status.error;
    state.update((current) => ({
      ...current,
      jobs: !scopeMismatch && status.snapshot ? status.snapshot.jobs.items : current.jobs,
      error: statusError ?? (current.error === previousStatusError ? null : current.error)
    }));
  });
  return next;
}

async function refresh(quiet = false): Promise<void> {
  const client = getClient();
  const auth = get(session);
  if (!client || !auth.connected) return;
  const identity = identityFor(auth);
  const version = ++requestVersion;
  state.update((current) => ({ ...current, loading: !quiet, refreshing: quiet, error: quiet ? current.error : null }));
  try {
    const list = await client.listJobSeries({ limit: 100, include_details: true });
    if (!isCurrentRequest(version, identity)) return;
    const desired = selectedId ?? get(state).selected?.id ?? list[0]?.id ?? null;
    const listed = desired ? list.find((item) => item.id === desired) ?? null : null;
    const detail = desired ? await client.getJobSeries(desired) : listed;
    if (!isCurrentRequest(version, identity)) return;
    const ids = jobIds(detail);
    // Details are intentionally bounded: a workflow with thousands of units
    // remains inspectable without turning a monitor refresh into a fan-out.
    const inspectedIds = ids.slice(0, 50);
    // Job progress is always obtained from the authoritative queue snapshot;
    // workflow metadata, events, and logs remain their own bounded resources.
    const sharedStatus = bindStatusStore(inspectedIds, identity, auth.project?.id ?? null);
    const statusRefresh = sharedStatus?.refresh(true) ?? Promise.resolve();
    const eventAndLogs = await Promise.all(inspectedIds.slice(0, 20).map(async (id) => {
      const [events, logs] = await Promise.all([
        client.listJobEvents({ job_id: id, limit: 30 }).catch(() => []),
        client.listLogs({ job_id: id, limit: 20 }).catch(() => [])
      ]);
      return { events, logs };
    }));
    await statusRefresh;
    if (!isCurrentRequest(version, identity)) return;
    const jobSnapshot = sharedStatus ? get(sharedStatus).snapshot : null;
    const snapshotProject = jobSnapshot?.scope?.project_id ?? null;
    if (auth.project?.id && snapshotProject && auth.project.id !== snapshotProject) {
      throw new Error(`Queue status scope ${snapshotProject} does not match project ${auth.project.id}.`);
    }
    state.set({
      series: list,
      selected: detail ?? listed,
      jobs: jobSnapshot?.jobs.items ?? [],
      events: eventAndLogs.flatMap((item) => item.events).sort((a, b) => (b.id ?? 0) - (a.id ?? 0)),
      logs: eventAndLogs.flatMap((item) => item.logs).sort((a, b) => (b.id ?? 0) - (a.id ?? 0)),
      loading: false, refreshing: false, error: statusError, lastUpdatedAt: new Date(), transport: 'adaptive-polling'
    });
  } catch (error) {
    if (isCurrentRequest(version, identity)) {
      state.update((current) => ({ ...current, loading: false, refreshing: false, error: error instanceof Error ? error.message : String(error) }));
    }
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
      void refresh().finally(schedule);
    }
    return () => {
      activeConsumers = Math.max(0, activeConsumers - 1);
      if (activeConsumers === 0 && browser) {
        requestVersion += 1;
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
        document.removeEventListener('visibilitychange', onVisibilityChange);
        clearStatusStore();
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
    invalidateQueueStatus();
  },
  async control(action: 'pause' | 'resume' | 'cancel' | 'retry'): Promise<JobSeries> {
    const client = getClient();
    const identity = identityFor(get(session));
    const selected = get(state).selected;
    if (!client || !selected) throw new Error('Connect to Pelagia and select a job series first.');
    const updated = await client.controlJobSeries(selected.id, action);
    if (!identity || identity !== identityFor(get(session))) {
      throw new Error('The project or session changed before the job-series control completed.');
    }
    state.update((current) => ({
      ...current,
      selected: updated,
      series: current.series.map((item) => item.id === updated.id ? { ...item, ...updated } : item)
    }));
    invalidateQueueStatus();
    await refresh(true);
    return updated;
  }
};

// Switching projects/session invalidates data owned by the prior project.
let sessionIdentity = '';
session.subscribe(($session) => {
  const identity = identityFor($session);
  if (identity !== sessionIdentity) {
    sessionIdentity = identity;
    requestVersion += 1;
    selectedId = null;
    clearStatusStore();
    state.set(initial);
    if (identity && activeConsumers > 0) void refresh().finally(schedule);
  }
});
