import { browser } from '$app/environment';
import { get, writable, type Readable } from 'svelte/store';
import type { QueueStatusOptions, QueueStatusResponse } from '$lib/api/types';
import { getClient, session } from '$lib/stores/session';

export type QueueStatusState = {
  snapshot: QueueStatusResponse | null;
  loading: boolean;
  refreshing: boolean;
  stale: boolean;
  error: string | null;
};

export type QueueStatusStore = Readable<QueueStatusState> & {
  refresh: (quiet?: boolean) => Promise<void>;
  /** Call after a queue mutation; all mounted scopes then converge on fresh snapshots. */
  invalidate: () => void;
};

const initial = (): QueueStatusState => ({ snapshot: null, loading: false, refreshing: false, stale: false, error: null });
const stores = new Map<string, InternalStore>();

function normalized(options: QueueStatusOptions): QueueStatusOptions {
  const sorted = (value: string | string[] | null | undefined) => value == null ? undefined : [...new Set(Array.isArray(value) ? value : [value])].sort();
  return {
    run_id: options.run_id ?? undefined,
    asset_id: options.asset_id ?? undefined,
    worker_id: options.worker_id ?? undefined,
    status: sorted(options.status), stage: sorted(options.stage), ids: sorted(options.ids),
    job_limit: options.job_limit ?? 50,
    recent_failure_limit: options.recent_failure_limit ?? 10
  };
}

function keyFor(options: QueueStatusOptions): string { return JSON.stringify(normalized(options)); }
function active(snapshot: QueueStatusResponse | null): boolean {
  const total = snapshot?.total;
  return Number(total?.active ?? 0) > 0 || Number(total?.queued ?? 0) > 0 || Number(total?.leased ?? 0) > 0 || Number(total?.working ?? 0) > 0;
}

class InternalStore implements QueueStatusStore {
  private readonly data = writable<QueueStatusState>(initial());
  private subscribers = 0;
  private timer: number | null = null;
  private version = 0;
  private inFlight: Promise<void> | null = null;
  private dirty = false;

  constructor(private readonly key: string, private readonly options: QueueStatusOptions) {}

  subscribe = (run: Parameters<Readable<QueueStatusState>['subscribe']>[0], invalidate?: Parameters<Readable<QueueStatusState>['subscribe']>[1]) => {
    this.subscribers += 1;
    if (this.subscribers === 1 && browser) {
      document.addEventListener('visibilitychange', this.visibilityChanged);
      void this.refresh();
    }
    const unsubscribe = this.data.subscribe(run, invalidate);
    return () => {
      unsubscribe();
      this.subscribers = Math.max(0, this.subscribers - 1);
      if (!this.subscribers) this.stop();
    };
  };

  private visibilityChanged = () => { void this.refresh(true); };

  private schedule(): void {
    if (!browser || !this.subscribers) return;
    if (this.timer !== null) window.clearTimeout(this.timer);
    const current = get(this.data);
    const delay = document.visibilityState === 'visible' ? active(current.snapshot) ? 2_500 : 12_000 : 30_000;
    this.timer = window.setTimeout(() => { void this.refresh(true); }, delay);
  }

  private stop(): void {
    this.version += 1;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    if (browser) document.removeEventListener('visibilitychange', this.visibilityChanged);
    // Keep a bounded lifetime cache only while it is actually observed.
    stores.delete(this.key);
  }

  async refresh(quiet = false): Promise<void> {
    if (this.inFlight) {
      this.dirty = true;
      // A caller awaiting a refresh after a mutation must not resume on the
      // obsolete request. The finally below starts exactly one coalesced pass.
      return this.inFlight.then(() => this.inFlight ?? Promise.resolve());
    }
    const client = getClient();
    const auth = get(session);
    if (!client || !auth.connected) return;
    const version = ++this.version;
    const identity = `${auth.baseUrl}:${auth.token ?? ''}:${auth.project?.id ?? auth.project?.project_key ?? ''}`;
    this.data.update((state) => ({ ...state, loading: !quiet && !state.snapshot, refreshing: Boolean(state.snapshot), error: null }));
    this.inFlight = client.queueStatus(this.options).then((snapshot) => {
      const current = get(session);
      const currentIdentity = `${current.baseUrl}:${current.token ?? ''}:${current.project?.id ?? current.project?.project_key ?? ''}`;
      if (version !== this.version || identity !== currentIdentity) return;
      if (!snapshot.scope.project_id || (current.project?.id && snapshot.scope.project_id !== current.project.id)) {
        throw new Error('Queue status belongs to a different project. Refresh the connection.');
      }
      this.data.set({ snapshot, loading: false, refreshing: false, stale: false, error: null });
    }).catch((error) => {
      if (version === this.version) this.data.update((state) => ({ ...state, loading: false, refreshing: false, stale: Boolean(state.snapshot), error: error instanceof Error ? error.message : String(error) }));
    }).finally(() => {
      this.inFlight = null;
      const refreshAgain = this.dirty;
      this.dirty = false;
      if (refreshAgain && this.subscribers) void this.refresh(true);
      else this.schedule();
    });
    return this.inFlight;
  }

  invalidate = (): void => { if (this.subscribers) void this.refresh(true); };
  reset(): void { this.version += 1; this.data.set(initial()); }
}

/**
 * Stable public handle. It deliberately resolves the cache entry at subscribe
 * time: a Svelte component can retain this handle across an unsubscribe while
 * another component mounts the same scope without creating a second poller.
 */
class QueueStatusHandle implements QueueStatusStore {
  constructor(private readonly key: string, private readonly options: QueueStatusOptions) {}

  private current(): InternalStore {
    let store = stores.get(this.key);
    if (!store) {
      store = new InternalStore(this.key, this.options);
      stores.set(this.key, store);
    }
    return store;
  }

  subscribe = (run: Parameters<Readable<QueueStatusState>['subscribe']>[0], invalidate?: Parameters<Readable<QueueStatusState>['subscribe']>[1]) =>
    this.current().subscribe(run, invalidate);
  refresh = (quiet = false) => this.current().refresh(quiet);
  invalidate = () => this.current().invalidate();
}

/** A deduplicated, scope-aware authoritative queue snapshot. */
export function queueStatus(options: QueueStatusOptions = {}): QueueStatusStore {
  const key = keyFor(options);
  return new QueueStatusHandle(key, normalized(options));
}

/** Refresh every active scope after control, retry, or enqueue operations. */
export function invalidateQueueStatus(): void { stores.forEach((store) => store.invalidate()); }

if (browser && typeof globalThis.addEventListener === 'function') globalThis.addEventListener('pelagia:queue-mutation', invalidateQueueStatus);

let sessionIdentity = '';
session.subscribe(($session) => {
  const identity = $session.connected ? `${$session.baseUrl}:${$session.token ?? ''}:${$session.project?.id ?? $session.project?.project_key ?? ''}` : '';
  if (identity === sessionIdentity) return;
  sessionIdentity = identity;
  stores.forEach((store) => { store.reset(); store.invalidate(); });
});
