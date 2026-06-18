import { browser } from '$app/environment';
import { writable } from 'svelte/store';

const displayPreferenceKey = 'pelagia-view:display-preferences:v1';

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

if (browser) {
  imageInversionEnabled.subscribe((invertImages) => {
    localStorage.setItem(displayPreferenceKey, JSON.stringify({ invertImages }));
  });
}
