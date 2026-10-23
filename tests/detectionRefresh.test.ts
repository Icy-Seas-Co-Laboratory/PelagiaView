import test from 'node:test';
import assert from 'node:assert/strict';
import { PelagiaApiClient } from '../src/lib/api/client';

test('explicit detection searches bypass the short-lived result cache', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls: RequestInit[] = [];
  globalThis.fetch = async (_input, init) => {
    calls.push(init ?? {});
    return new Response(JSON.stringify({ detections: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const client = new PelagiaApiClient('http://pelagia.test');
  await client.searchDetectionsPage({ limit: 20 });
  await client.searchDetectionsPage({ limit: 20 });
  assert.equal(calls.length, 1, 'ordinary repeated searches may use the brief cache');

  await client.searchDetectionsPage({ limit: 20 }, { fresh: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].cache, 'no-store');
});
