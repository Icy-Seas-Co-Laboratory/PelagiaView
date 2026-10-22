import { browser } from '$app/environment';
import { get, writable, type Readable } from 'svelte/store';
import type { ProcessingSubmission } from '$lib/api/types';
import { getClient, session } from '$lib/stores/session';
import { invalidateQueueStatus } from '$lib/stores/queueStatus';

export type ProcessingSubmissionsState = {
  submissions: ProcessingSubmission[];
  loading: boolean;
  refreshing: boolean;
  stale: boolean;
  error: string | null;
};

export type ProcessingSubmissionsStore = Readable<ProcessingSubmissionsState> & {
  refresh: (quiet?: boolean) => Promise<void>;
  observe: (submission: ProcessingSubmission) => void;
};

const initial = (): ProcessingSubmissionsState => ({ submissions: [], loading: false, refreshing: false, stale: false, error: null });
const active = (submission: ProcessingSubmission) => submission.status === 'accepted' || submission.status === 'planning';

class SubmissionStore implements ProcessingSubmissionsStore {
  private readonly data = writable<ProcessingSubmissionsState>(initial());
  private subscribers = 0;
  private timer: number | null = null;
  private version = 0;
  private inFlight: Promise<void> | null = null;
  private dirty = false;
  private materializedSubmissionIds = new Set<string>();

  subscribe = (run: Parameters<Readable<ProcessingSubmissionsState>['subscribe']>[0], invalidate?: Parameters<Readable<ProcessingSubmissionsState>['subscribe']>[1]) => {
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

  private stop(): void {
    this.version += 1;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    if (browser) document.removeEventListener('visibilitychange', this.visibilityChanged);
  }

  private schedule(): void {
    if (!browser || !this.subscribers) return;
    if (this.timer !== null) window.clearTimeout(this.timer);
    const state = get(this.data);
    const delay = document.visibilityState === 'visible'
      ? state.submissions.some(active) ? 2_500 : 15_000
      : 30_000;
    this.timer = window.setTimeout(() => { void this.refresh(true); }, delay);
  }

  async refresh(quiet = false): Promise<void> {
    if (this.inFlight) {
      this.dirty = true;
      return this.inFlight.then(() => this.inFlight ?? Promise.resolve());
    }
    const client = getClient();
    const auth = get(session);
    if (!client || !auth.connected) return;
    const version = ++this.version;
    const identity = `${auth.baseUrl}:${auth.token ?? ''}:${auth.project?.id ?? auth.project?.project_key ?? ''}`;
    this.data.update((state) => ({ ...state, loading: !quiet && !state.submissions.length, refreshing: Boolean(state.submissions.length), error: null }));
    this.inFlight = client.listProcessingSubmissions(50).then((submissions) => {
      const current = get(session);
      const currentIdentity = `${current.baseUrl}:${current.token ?? ''}:${current.project?.id ?? current.project?.project_key ?? ''}`;
      if (version !== this.version || identity !== currentIdentity) return;
      if (current.project?.id && submissions.some((item) => item.project_id !== current.project!.id)) {
        throw new Error('Processing submissions belong to a different project. Refresh the connection.');
      }
      this.data.set({ submissions, loading: false, refreshing: false, stale: false, error: null });
      let newlyMaterialized = false;
      for (const item of submissions) {
        if (item.status !== 'succeeded' || this.materializedSubmissionIds.has(item.id)) continue;
        this.materializedSubmissionIds.add(item.id);
        newlyMaterialized = true;
      }
      if (newlyMaterialized) invalidateQueueStatus();
    }).catch((error) => {
      if (version === this.version) this.data.update((state) => ({ ...state, loading: false, refreshing: false, stale: Boolean(state.submissions.length), error: error instanceof Error ? error.message : String(error) }));
    }).finally(() => {
      this.inFlight = null;
      const again = this.dirty;
      this.dirty = false;
      if (again && this.subscribers) void this.refresh(true);
      else this.schedule();
    });
    return this.inFlight;
  }

  observe = (submission: ProcessingSubmission): void => {
    const auth = get(session);
    if (auth.project?.id && submission.project_id !== auth.project.id) return;
    if (this.inFlight) {
      this.version += 1;
      this.dirty = true;
    }
    this.data.update((state) => ({ ...state, submissions: [submission, ...state.submissions.filter((item) => item.id !== submission.id)].slice(0, 50) }));
    if (submission.status === 'succeeded' && !this.materializedSubmissionIds.has(submission.id)) {
      this.materializedSubmissionIds.add(submission.id);
      invalidateQueueStatus();
    }
  };

  reset(): void {
    this.version += 1;
    this.materializedSubmissionIds.clear();
    this.data.set(initial());
  }
}

export const processingSubmissions = new SubmissionStore();

let identity = '';
session.subscribe(($session) => {
  const next = $session.connected ? `${$session.baseUrl}:${$session.token ?? ''}:${$session.project?.id ?? $session.project?.project_key ?? ''}` : '';
  if (next === identity) return;
  identity = next;
  processingSubmissions.reset();
  if (next) void processingSubmissions.refresh(true);
});
