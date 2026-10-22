import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRefinedComparison, refinementFrameId } from '../src/lib/processing/refinementComparison';

test('comparison follows the candidate sandbox frame through every result page', async () => {
  const calls: Array<[string, number]> = [];
  const result = await loadRefinedComparison(
    [{ frame_id: 'sandbox-frame' }, { frame_id: 'sandbox-frame' }],
    'original-frame',
    async (frameId, offset) => {
      calls.push([frameId, offset]);
      return offset === 0
        ? { items: ['refined-1', 'split-child'], nextOffset: 2 }
        : { items: ['refined-2'], nextOffset: null };
    }
  );
  assert.deepEqual(calls, [['sandbox-frame', 0], ['sandbox-frame', 2]]);
  assert.deepEqual(result, ['refined-1', 'split-child', 'refined-2']);
});

test('persisted original candidates override a stale sandbox fallback', () => {
  assert.equal(refinementFrameId([{ frame_id: 'original-frame' }], 'sandbox-frame'), 'original-frame');
});

test('missing frame metadata uses the actual segmentation target', () => {
  assert.equal(refinementFrameId([{}], 'sandbox-frame'), 'sandbox-frame');
});

test('mixed candidate frames fail before loading unrelated comparison results', async () => {
  let called = false;
  await assert.rejects(loadRefinedComparison(
    [{ frame_id: 'original-frame' }, { frame_id: 'sandbox-frame' }], 'original-frame',
    async () => { called = true; return { items: [] }; }
  ), /different frames/);
  assert.equal(called, false);
});

test('a failed result reload propagates without returning an empty successful comparison', async () => {
  await assert.rejects(loadRefinedComparison([{ frame_id: 'sandbox' }], 'original', async () => {
    throw new Error('API disconnected');
  }), /API disconnected/);
});
