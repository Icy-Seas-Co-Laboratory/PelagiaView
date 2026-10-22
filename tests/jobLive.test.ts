import test from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'svelte/store';
import { setClient, setSession } from './support/queueStatusMock';

const listeners = new Map<string, Set<() => void>>();
let timerId = 0;
globalThis.document = {
  visibilityState: 'visible',
  addEventListener(name: string, fn: () => void) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name)!.add(fn);
  },
  removeEventListener: (name: string, fn: () => void) => listeners.get(name)?.delete(fn)
} as unknown as Document;
globalThis.window = {
  setTimeout: () => ++timerId,
  clearTimeout: () => undefined
} as unknown as Window & typeof globalThis;

const { jobSeriesLive } = await import('../src/lib/stores/jobLive');

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function snapshot(projectId: string, jobId: string) {
  return {
    schema_version: 1,
    snapshot_id: `snapshot-${projectId}`,
    as_of: '2026-10-22T00:00:00Z',
    scope: { project_id: projectId, ids: [jobId] },
    total: { job_count: 1, active: 1, leased: 1 },
    by_stage: [],
    work_groups: [],
    health: {},
    jobs: {
      items: [{ id: jobId, stage: 'segment', status: 'leased', progress: { percent: 25 } }],
      limit: 1,
      matching_count: 1,
      truncated: false
    },
    recent_failures: []
  };
}

test('project switch clears state and rejects the prior project response', async () => {
  setSession({ connected: false, baseUrl: '', token: null, project: null });
  const oldList = deferred<any[]>();
  setClient({
    listJobSeries: () => oldList.promise,
    getJobSeries: async () => ({ id: 'series-a', job_ids: ['job-a'] }),
    queueStatus: async () => snapshot('p1', 'job-a'),
    listJobEvents: async () => [],
    listLogs: async () => []
  });
  setSession({ connected: true, baseUrl: 'http://api', token: 'token-a', project: { id: 'p1' } });
  const pending = jobSeriesLive.refresh();

  setClient({
    listJobSeries: async () => [{ id: 'series-b', job_ids: ['job-b'] }],
    getJobSeries: async () => ({ id: 'series-b', job_ids: ['job-b'] }),
    queueStatus: async () => snapshot('p2', 'job-b'),
    listJobEvents: async () => [],
    listLogs: async () => []
  });
  setSession({ connected: true, baseUrl: 'http://api', token: 'token-b', project: { id: 'p2' } });
  oldList.resolve([{ id: 'series-a', job_ids: ['job-a'] }]);
  await pending;

  assert.equal(get(jobSeriesLive).selected, null);
  assert.deepEqual(get(jobSeriesLive).jobs, []);

  await jobSeriesLive.refresh();
  assert.equal(get(jobSeriesLive).selected?.id, 'series-b');
  assert.deepEqual(get(jobSeriesLive).jobs.map((job) => job.id), ['job-b']);
});

test('successful controls invalidate shared status and wait for normalized refresh', async () => {
  setSession({ connected: false, baseUrl: '', token: null, project: null });
  let statusCalls = 0;
  let controlCalls = 0;
  const client = {
    listJobSeries: async () => [{ id: 'series-c', job_ids: ['job-c'], status: 'active' }],
    getJobSeries: async () => ({ id: 'series-c', job_ids: ['job-c'], status: controlCalls ? 'paused' : 'active' }),
    queueStatus: async () => {
      statusCalls += 1;
      return snapshot('p3', 'job-c');
    },
    listJobEvents: async () => [],
    listLogs: async () => [],
    controlJobSeries: async () => {
      controlCalls += 1;
      return { id: 'series-c', job_ids: ['job-c'], status: 'paused' };
    }
  };
  setClient(client);
  setSession({ connected: true, baseUrl: 'http://api', token: 'token-c', project: { id: 'p3' } });
  await jobSeriesLive.refresh();
  const beforeControl = statusCalls;

  const updated = await jobSeriesLive.control('pause');

  assert.equal(updated.status, 'paused');
  assert.equal(get(jobSeriesLive).selected?.status, 'paused');
  assert.ok(statusCalls > beforeControl, 'control must refresh the shared authoritative status before resolving');
});
