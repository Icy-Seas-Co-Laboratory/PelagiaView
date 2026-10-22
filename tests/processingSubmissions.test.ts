import test from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'svelte/store';
import { setClient, setSession } from './support/queueStatusMock';
import type { ProcessingQueueRequest, ProcessingSubmission } from '../src/lib/api/types';

const timers = new Map<number, { delay: number; run: () => void }>();
let nextTimer = 0;
globalThis.document = {
  visibilityState: 'visible',
  addEventListener() {},
  removeEventListener() {}
} as unknown as Document;
globalThis.window = {
  setTimeout(run: () => void, delay: number) { timers.set(++nextTimer, { delay, run }); return nextTimer; },
  clearTimeout(id: number) { timers.delete(id); }
} as unknown as Window & typeof globalThis;
const storage = new Map<string, string>();
let storageBlocked = false;
globalThis.sessionStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { if (storageBlocked) throw new Error('storage blocked'); storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
  clear: () => storage.clear(),
  key: () => null,
  get length() { return storage.size; }
} as Storage;

const { processingSubmissions } = await import('../src/lib/stores/processingSubmissions');
const { prepareSubmission, persistRetrySubmission, restoreRetrySubmission } = await import('../src/lib/processing/submissionRequest');
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const item = (status: 'accepted' | 'planning' | 'succeeded' | 'failed', project_id = 'p1'): ProcessingSubmission => ({
  id: `submission-${status}`, project_id, request_id: 'request-1', kind: 'queue' as const, status,
  request: { stage: 'segment', filters: { collection: ['plankton'] } } as ProcessingQueueRequest, created_at: '2026-01-01T00:00:00Z'
});

test('durable submission monitor accepts criteria records and uses active polling', async (t) => {
  const calls: Array<{ resolve: (value: unknown) => void }> = [];
  setSession({ connected: true, baseUrl: 'http://api', token: 'token', project: { id: 'p1' } });
  setClient({ listProcessingSubmissions: () => new Promise((resolve) => calls.push({ resolve })) });
  const stop = processingSubmissions.subscribe(() => {});
  t.after(stop);
  assert.equal(calls.length, 1);
  calls[0].resolve([item('planning')]);
  await flush();
  const request = get(processingSubmissions).submissions[0].request;
  assert.equal(request && 'filters' in request ? request.filters?.collection?.[0] : undefined, 'plankton');
  assert.deepEqual([...timers.values()].map((timer) => timer.delay), [2500]);
});

test('project changes clear submissions and reject previous project responses', async (t) => {
  const calls: Array<{ resolve: (value: unknown) => void }> = [];
  setSession({ connected: true, baseUrl: 'http://api', token: 'token', project: { id: 'p1' } });
  setClient({ listProcessingSubmissions: () => new Promise((resolve) => calls.push({ resolve })) });
  const stop = processingSubmissions.subscribe(() => {});
  t.after(stop);
  calls[0].resolve([item('accepted')]);
  await flush();
  setSession({ connected: true, baseUrl: 'http://api', token: 'new-token', project: { id: 'p2' } });
  assert.deepEqual(get(processingSubmissions).submissions, []);
  assert.equal(calls.length, 2);
  calls[1].resolve([item('succeeded', 'p1')]);
  await flush();
  assert.deepEqual(get(processingSubmissions).submissions, []);
  assert.match(get(processingSubmissions).error ?? '', /different project/);
});

test('ambiguous retry preserves criteria and the idempotency key without enumerating frames', () => {
  const criteria: ProcessingQueueRequest = { stage: 'segment', filters: { asset_ids: ['asset-a'], collection: ['tag-a'], preprocessing_status: ['succeeded'] } };
  const first = prepareSubmission('queue', criteria);
  const retry = prepareSubmission('queue', { stage: 'segment' as const, filters: { asset_ids: ['changed'] } }, first);
  assert.equal(retry.request_id, first.request_id);
  assert.equal(retry.request, criteria);
  assert.equal('frame_ids' in retry.request.filters!, false);
});

test('pending retries survive navigation only for the same project and user scope', () => {
  const pending = prepareSubmission('queue', { stage: 'segment', filters: { collection: ['plankton'] } });
  persistRetrySubmission('http://api:p1:user-a', 'queue', pending);
  assert.equal(restoreRetrySubmission('http://api:p1:user-a', 'queue')?.request_id, pending.request_id);
  assert.equal(restoreRetrySubmission('http://api:p2:user-a', 'queue'), null);
});

test('blocked session storage does not prevent an in-memory submission attempt', () => {
  storageBlocked = true;
  const pending = prepareSubmission('queue', { stage: 'segment', filters: { collection: ['plankton'] } });
  assert.doesNotThrow(() => persistRetrySubmission('http://api:p1:user-a', 'queue', pending));
  storageBlocked = false;
});

test('terminal empty and failed submissions retain distinct server outcomes', () => {
  setSession({ connected: true, baseUrl: 'http://api', token: 'token', project: { id: 'p1' } });
  processingSubmissions.observe({ ...item('succeeded'), result: { job_count: 0, matched_count: 0 } });
  processingSubmissions.observe({ ...item('failed'), error: 'invalid stored criterion' });
  const terminal = get(processingSubmissions).submissions;
  const empty = terminal.find((value) => value.status === 'succeeded');
  assert.equal(empty?.result && 'job_count' in empty.result ? empty.result.job_count : null, 0);
  assert.equal(terminal.find((value) => value.status === 'failed')?.error, 'invalid stored criterion');
});
