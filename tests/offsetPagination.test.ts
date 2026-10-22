import test from 'node:test';
import assert from 'node:assert/strict';
import { collectOffsetPages } from '../src/lib/utils/offsetPagination';

test('collectOffsetPages collects each page until the server ends pagination', async () => {
  const offsets: number[] = [];
  const values = await collectOffsetPages(async (offset) => {
    offsets.push(offset);
    if (offset === 0) return { items: ['a', 'b'], nextOffset: 2 };
    return { items: ['c'], nextOffset: null };
  }, 'ROI');
  assert.deepEqual(values, ['a', 'b', 'c']);
  assert.deepEqual(offsets, [0, 2]);
});

test('collectOffsetPages rejects a repeated cursor instead of returning incomplete data', async () => {
  await assert.rejects(
    collectOffsetPages(async () => ({ items: ['a'], nextOffset: 0 }), 'ROI'),
    /ROI pagination did not advance/
  );
});
