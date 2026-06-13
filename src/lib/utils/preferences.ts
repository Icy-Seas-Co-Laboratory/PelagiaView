import { browser } from '$app/environment';

type PreferenceObject = Record<string, unknown>;

const writeTimers = new Map<string, number>();

export function preferenceKey(name: string, version = 1): string {
  return `pelagia-view:${name}:v${version}`;
}

export function readPreferences<T extends PreferenceObject>(key: string): Partial<T> | null {
  if (!browser) return null;
  const saved = localStorage.getItem(key);
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Partial<T>) : null;
  } catch {
    return null;
  }
}

export function writePreferences(key: string, preferences: PreferenceObject, debounceMs = 250): void {
  if (!browser) return;
  const existing = writeTimers.get(key);
  if (existing) window.clearTimeout(existing);
  const timer = window.setTimeout(() => {
    localStorage.setItem(key, JSON.stringify(preferences));
    writeTimers.delete(key);
  }, Math.max(0, debounceMs));
  writeTimers.set(key, timer);
}

export function stringPreference(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

export function booleanPreference(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function numberPreference(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function nullableNumberPreference(value: unknown, fallback: number | null): number | null {
  if (value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function stringArrayPreference(value: unknown, fallback: string[] = []): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : fallback;
}

export function stringSetPreference(value: unknown, fallback = new Set<string>()): Set<string> {
  return new Set(stringArrayPreference(value, [...fallback]));
}
