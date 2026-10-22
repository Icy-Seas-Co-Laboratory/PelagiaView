import test from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'svelte/store';
import { setClient, setSession } from './support/queueStatusMock';

const listeners = new Map<string, Set<() => void>>();
const timers = new Map<number, { due: number; delay: number; run: () => void }>();
let now = 0;
let timerId = 0;
const documentMock = {
  visibilityState: 'visible',
  addEventListener(name: string, fn: () => void) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name)!.add(fn);
  },
  removeEventListener: (name: string, fn: () => void) => listeners.get(name)?.delete(fn)
};
globalThis.document = documentMock as unknown as Document;
globalThis.window = {
  setTimeout(run: () => void, delay: number) {
    timers.set(++timerId, { due: now + delay, delay, run });
    return timerId;
  },
  clearTimeout: (id: number) => timers.delete(id)
} as unknown as Window & typeof globalThis;

const { queueStatus, invalidateQueueStatus } = await import('../src/lib/stores/queueStatus');
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const snapshot = (queued = 1, projectId = 'p1') => ({
  schema_version: 1, snapshot_id: `snapshot-${queued}`, as_of: '2026-01-01T00:00:00Z',
  scope: { project_id: projectId }, total: { job_count: queued, active: queued, queued, leased: 0, working: 0 },
  by_stage: [], work_groups: [], health: {}, jobs: { items: [], limit: 50, matching_count: queued, truncated: false },
  recent_failures: []
});

function setup() {
  setSession({ connected: false });
  documentMock.visibilityState = 'visible';
  const calls: Array<{ resolve: (value: unknown) => void; reject: (error: Error) => void }> = [];
  setClient({ queueStatus: () => new Promise((resolve, reject) => calls.push({ resolve, reject })) });
  setSession({ connected: true, baseUrl: 'http://api', token: 'token', project: { id: 'p1' } });
  return calls;
}

function advance(milliseconds: number) {
  now += milliseconds;
  for (const [id, timer] of [...timers]) {
    if (timer.due <= now) { timers.delete(id); timer.run(); }
  }
}

test('independent equivalent scopes deduplicate and publish the same snapshot object', async (t) => {
  const calls = setup();
  const first = queueStatus({ stage: ['segment', 'classify'] });
  const second = queueStatus({ stage: ['classify', 'segment', 'segment'] });
  let firstSnapshot: unknown;
  let secondSnapshot: unknown;
  const stopA = first.subscribe((state) => { firstSnapshot = state.snapshot; });
  const stopB = second.subscribe((state) => { secondSnapshot = state.snapshot; });
  t.after(() => { stopA(); stopB(); });
  assert.equal(calls.length, 1);
  const value = snapshot();
  calls[0].resolve(value);
  await flush();
  assert.equal(firstSnapshot, value);
  assert.equal(secondSnapshot, value);
  assert.equal(calls.length, 1);
});

test('project switching immediately clears old data and accepts only the new response', async (t) => {
  const calls = setup();
  const store = queueStatus();
  const stop = store.subscribe(() => {});
  t.after(stop);
  calls[0].resolve(snapshot(1));
  await flush();
  invalidateQueueStatus();
  assert.equal(calls.length, 2);
  setSession({ connected: true, baseUrl: 'http://api', token: 'new-token', project: { id: 'p2' } });
  assert.equal(get(store).snapshot, null);
  calls[1].resolve(snapshot(99));
  await flush();
  assert.equal(get(store).snapshot, null);
  assert.equal(calls.length, 3);
  const fresh = snapshot(3, 'p2');
  calls[2].resolve(fresh);
  await flush();
  assert.equal(get(store).snapshot, fresh);
  assert.equal(get(store).stale, false);
});

test('mutations during a request coalesce one followup; errors preserve stale snapshot', async (t) => {
  const calls = setup();
  const store = queueStatus();
  const stop = store.subscribe(() => {});
  t.after(stop);
  const value = snapshot(2);
  calls[0].resolve(value);
  await flush();
  invalidateQueueStatus();
  invalidateQueueStatus();
  invalidateQueueStatus();
  assert.equal(calls.length, 2);
  calls[1].reject(new Error('temporary outage'));
  await flush();
  assert.equal(calls.length, 3);
  assert.equal(get(store).snapshot, value);
  assert.equal(get(store).stale, true);
  calls[2].reject(new Error('still unavailable'));
  await flush();
  assert.equal(get(store).error, 'still unavailable');
  assert.equal(calls.length, 3);
});

test('active, idle, and hidden scopes use adaptive intervals', async (t) => {
  const calls = setup();
  const store = queueStatus();
  const stop = store.subscribe(() => {});
  t.after(stop);
  calls[0].resolve(snapshot(1));
  await flush();
  assert.deepEqual([...timers.values()].map((timer) => timer.delay), [2500]);
  advance(2499);
  assert.equal(calls.length, 1);
  advance(1);
  assert.equal(calls.length, 2);
  calls[1].resolve(snapshot(0));
  await flush();
  assert.deepEqual([...timers.values()].map((timer) => timer.delay), [12000]);
  documentMock.visibilityState = 'hidden';
  listeners.get('visibilitychange')?.forEach((run) => run());
  calls[2].resolve(snapshot(1));
  await flush();
  assert.deepEqual([...timers.values()].map((timer) => timer.delay), [30000]);
});

test('last unsubscribe clears timers/listeners and late requests cannot restart polling', async () => {
  const calls = setup();
  const store = queueStatus();
  const stop = store.subscribe(() => {});
  calls[0].resolve(snapshot());
  await flush();
  advance(2500);
  assert.equal(calls.length, 2);
  stop();
  calls[1].resolve(snapshot(9));
  await flush();
  advance(60000);
  invalidateQueueStatus();
  assert.equal(calls.length, 2);
  assert.equal(timers.size, 0);
  assert.equal(listeners.get('visibilitychange')?.size ?? 0, 0);
});

test('retained handles resubscribe to the same live scope after eviction', async (t) => {
  const calls = setup();
  const retained = queueStatus();
  const firstStop = retained.subscribe(() => {});
  calls[0].resolve(snapshot());
  await flush();
  firstStop();
  const current = queueStatus();
  const stopA = current.subscribe(() => {});
  const stopB = retained.subscribe(() => {});
  t.after(() => { stopA(); stopB(); });
  assert.equal(calls.length, 2, 'resubscribing an old handle must not create another polling loop');
  calls[1].resolve(snapshot(2));
  await flush();
  assert.equal(get(current).snapshot, get(retained).snapshot);
  setSession({ connected: true, baseUrl: 'http://api', token: 'token', project: { id: 'p2' } });
  assert.equal(get(current).snapshot, null);
  assert.equal(get(retained).snapshot, null);
  assert.equal(calls.length, 3);
  calls[2].resolve(snapshot(3, 'p2'));
  await flush();
  assert.equal(get(current).snapshot, get(retained).snapshot);
});

test('awaiting an in-flight refresh waits for its post-mutation followup', async (t) => {
  const calls = setup();
  const store = queueStatus();
  const stop = store.subscribe(() => {});
  t.after(stop);
  let finished = false;
  const pending = store.refresh(true).then(() => { finished = true; });
  calls[0].resolve(snapshot(1));
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(finished, false, 'mutation refresh must wait for the new request');
  calls[1].resolve(snapshot(2));
  await pending;
  assert.equal(get(store).snapshot?.total.queued, 2);
  assert.equal(finished, true);
});

test('rejects a snapshot whose project scope does not match the session', async (t) => {
  const calls = setup();
  const store = queueStatus();
  const stop = store.subscribe(() => {});
  t.after(stop);
  calls[0].resolve(snapshot(99, 'different-project'));
  await flush();
  assert.equal(get(store).snapshot, null);
  assert.ok(get(store).error);
});
