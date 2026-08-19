import type { Label } from './types';

export const DIGIT_SHORTCUTS = ['1','2','3','4','5','6','7','8','9','0'] as const;

export function withDefaultShortcuts(labels: Label[], existing: Record<string, string>): Record<string, string> {
  const active = labels.filter((label) => !label.deprecated_at);
  const result = { ...existing };
  DIGIT_SHORTCUTS.forEach((digit, index) => {
    if (!Object.prototype.hasOwnProperty.call(result, digit)) result[digit] = active[index]?.label_id || '';
  });
  return result;
}

export function shortcutLabel(labels: Label[], shortcuts: Record<string, string>, digit: string): Label | undefined {
  const labelId = shortcuts[digit];
  return labels.find((label) => !label.deprecated_at && label.label_id === labelId);
}
