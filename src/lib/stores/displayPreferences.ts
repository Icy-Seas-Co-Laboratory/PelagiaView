import { browser } from '$app/environment';
import { writable } from 'svelte/store';

const displayPreferenceKey = 'pelagia-view:display-preferences:v1';
const themePreferenceKey = 'pelagia-view:theme';
export type ThemePreference = 'system' | 'light' | 'dark';

function readImageInversionPreference(): boolean {
  if (!browser) return false;
  const saved = localStorage.getItem(displayPreferenceKey);
  if (!saved) return false;
  try {
    const parsed = JSON.parse(saved) as { invertImages?: unknown };
    return parsed.invertImages === true;
  } catch {
    return false;
  }
}

export const imageInversionEnabled = writable(readImageInversionPreference());
export const themePreference = writable<ThemePreference>(readThemePreference());

function readThemePreference(): ThemePreference {
  if (!browser) return 'system';
  const saved = localStorage.getItem(themePreferenceKey);
  return saved === 'light' || saved === 'dark' ? saved : 'system';
}

function applyTheme(theme: ThemePreference): void {
  if (!browser) return;
  const resolved = theme === 'system'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

if (browser) {
  imageInversionEnabled.subscribe((invertImages) => {
    localStorage.setItem(displayPreferenceKey, JSON.stringify({ invertImages }));
  });
  themePreference.subscribe((theme) => {
    localStorage.setItem(themePreferenceKey, theme);
    applyTheme(theme);
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    let current: ThemePreference = 'system';
    themePreference.subscribe((value) => { current = value; })();
    if (current === 'system') applyTheme(current);
  });
}
