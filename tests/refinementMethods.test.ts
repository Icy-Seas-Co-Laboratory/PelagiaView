import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRefinementMethod, refinementMethods } from '../src/lib/processing/refinementMethods';

test('all selectable refinement methods survive default and preference restoration', () => {
  assert.deepEqual(refinementMethods.map(({ value }) => value), [
    'heuristic_edge_v1', 'heuristic_v2', 'heuristic_v3', 'oracle', 'identity'
  ]);
  for (const { value } of refinementMethods) assert.equal(normalizeRefinementMethod(value), value);
});

test('missing or unsupported refinement preferences use the established fallback', () => {
  for (const value of [undefined, null, '', 'unsupported']) {
    assert.equal(normalizeRefinementMethod(value), 'heuristic_edge_v1');
  }
});
