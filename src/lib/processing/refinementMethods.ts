import type { RoiRefinementMethod } from '../api/types';

export const refinementMethods: ReadonlyArray<{ value: RoiRefinementMethod; label: string }> = [
  { value: 'heuristic_edge_v1', label: 'Heuristic edge refinement (v1)' },
  { value: 'heuristic_v2', label: 'Heuristic v2' },
  { value: 'heuristic_v3', label: 'Heuristic v3' },
  { value: 'oracle', label: 'Oracle mask refinement' },
  { value: 'identity', label: 'Identity — promote candidates unchanged' }
];

export function normalizeRefinementMethod(value: unknown): RoiRefinementMethod {
  return refinementMethods.find((method) => method.value === value)?.value ?? 'heuristic_edge_v1';
}
