import test from 'node:test';
import assert from 'node:assert/strict';
import { createSingleFlightRefresh, isCurrentRefresh } from '../src/lib/utils/singleFlightRefresh';

type Deferred = { resolve: () => void; promise: Promise<void> };
const deferred = (): Deferred => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { resolve, promise };
};

function scheduler() {
  let nextId = 0;
  const pending = new Map<number, { delay: number; callback: () => void }>();
  return {
    pending,
    setTimeout(callback: () => void, delay: number) {
      pending.set(++nextId, { delay, callback });
      return nextId as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout(id: ReturnType<typeof setTimeout>) { pending.delete(id as unknown as number); },
    run(delay: number) {
      const entry = [...pending.entries()].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `expected a ${delay}ms timer`);
      pending.delete(entry[0]);
      entry[1].callback();
    }
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test('slow refreshes never overlap and repeated changes collapse into one follow-up', async () => {
  const clock = scheduler();
  const calls: Deferred[] = [];
  const refresh = createSingleFlightRefresh(() => {
    const next = deferred();
    calls.push(next);
    return next.promise;
  }, { pollDelayMs: 5000, shouldPoll: () => true, scheduler: clock });

  refresh.schedule(0);
  clock.run(0);
  await flush();
  assert.equal(calls.length, 1);

  // This models a refresh still running after the old five-second interval.
  refresh.schedule(5000);
  clock.run(5000);
  refresh.schedule(150);
  clock.run(150);
  assert.equal(calls.length, 1, 'no overlapping request is started while the first is pending');

  calls[0].resolve();
  await flush();
  await flush();
  assert.equal(calls.length, 2, 'all intervening changes result in exactly one follow-up');
  calls[1].resolve();
  await flush();
  assert.deepEqual([...clock.pending.values()].map((timer) => timer.delay), [5000]);
});

test('a change debounce survives when the prior request settles before it fires', async () => {
  const clock = scheduler();
  const calls: Deferred[] = [];
  const refresh = createSingleFlightRefresh(() => {
    const next = deferred();
    calls.push(next);
    return next.promise;
  }, { pollDelayMs: 5000, shouldPoll: () => true, scheduler: clock });
  void refresh.refresh();
  await flush();
  refresh.schedule(150);
  calls[0].resolve();
  await flush();
  assert.deepEqual([...clock.pending.values()].map((timer) => timer.delay), [150]);
  clock.run(150);
  await flush();
  assert.equal(calls.length, 2);
});

test('a failed stats request keeps the guard until slower sibling requests settle', async () => {
  const clock = scheduler();
  const slow = deferred();
  let calls = 0;
  const refresh = createSingleFlightRefresh(async () => {
    calls += 1;
    if (calls === 1) await Promise.allSettled([Promise.reject(new Error('facet failed')), slow.promise]);
  }, { pollDelayMs: 5000, shouldPoll: () => false, scheduler: clock });

  void refresh.refresh();
  await flush();
  void refresh.refresh();
  await flush();
  assert.equal(calls, 1, 'a rejected sibling cannot release the guard before the slow request settles');
  slow.resolve();
  await flush();
  await flush();
  assert.equal(calls, 2, 'the queued refresh starts only after all first-pass requests settle');
});

test('same-key schedules replace their debounce timer and run once', async () => {
  const clock = scheduler();
  let calls = 0;
  const refresh = createSingleFlightRefresh(async () => { calls += 1; }, {
    pollDelayMs: 5000, shouldPoll: () => false, scheduler: clock
  });
  refresh.schedule(150);
  refresh.schedule(150);
  refresh.schedule(150);
  assert.equal(clock.pending.size, 1);
  clock.run(150);
  await flush();
  assert.equal(calls, 1);
});

test('a manual refresh clears an already scheduled poll', async () => {
  const clock = scheduler();
  let calls = 0;
  const refresh = createSingleFlightRefresh(async () => { calls += 1; }, {
    pollDelayMs: 5000, shouldPoll: () => false, scheduler: clock
  });
  refresh.schedule(5000);
  await refresh.refresh();
  assert.equal(calls, 1);
  assert.equal(clock.pending.size, 0);
});

test('stale session or project scopes cannot publish a refresh result', () => {
  const client = {};
  assert.equal(isCurrentRefresh(4, 4, client, client, 'api:p1:user', 'api:p1:user'), true);
  assert.equal(isCurrentRefresh(4, 5, client, client, 'api:p1:user', 'api:p1:user'), false);
  assert.equal(isCurrentRefresh(4, 4, client, {}, 'api:p1:user', 'api:p1:user'), false);
  assert.equal(isCurrentRefresh(4, 4, client, client, 'api:p1:user', 'api:p2:user'), false);
});

test('stop clears future polling and suppresses a follow-up after unmount', async () => {
  const clock = scheduler();
  const first = deferred();
  let calls = 0;
  const refresh = createSingleFlightRefresh(() => {
    calls += 1;
    return first.promise;
  }, { pollDelayMs: 5000, shouldPoll: () => true, scheduler: clock });
  void refresh.refresh();
  await flush();
  void refresh.refresh();
  refresh.stop();
  first.resolve();
  await flush();
  await flush();
  assert.equal(calls, 1);
  assert.equal(clock.pending.size, 0);
});
