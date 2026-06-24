import { browser } from '$app/environment';
import { get, writable } from 'svelte/store';
import type { ProcessingPreset, ProcessingSettings } from '$lib/processing/settings';
import {
  liveProcessingPreset,
  processingPresetKey,
  pruneProcessingSettings
} from '$lib/processing/settings';

const STORAGE_KEY = 'pelagia-view-processing-preset-session';
const LEGACY_LIVE_PRESET_KEY = 'pelagia-view:processing-preset:live';
const livePresetKey = 'live:live';

type ProcessingPresetSessionState = {
  selectedKey: string;
  livePreset: ProcessingPreset;
};

type StoredProcessingPresetSession = Partial<ProcessingPresetSessionState>;

const initialState = browser ? readStoredProcessingPresetSession() : null;

export const processingPresetSession = writable<ProcessingPresetSessionState>({
  selectedKey: initialState?.selectedKey ?? livePresetKey,
  livePreset: normalizeLivePreset(initialState?.livePreset)
});

if (browser) {
  processingPresetSession.subscribe((state) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  });
}

export function setSelectedProcessingPresetKey(selectedKey: string) {
  processingPresetSession.update((state) => ({
    ...state,
    selectedKey: selectedKey || livePresetKey
  }));
}

export function setLiveProcessingPresetFromSettings(settings: ProcessingSettings, options: { selectedKey?: string } = {}) {
  const livePreset = liveProcessingPreset(settings);
  processingPresetSession.update((state) => ({
    selectedKey: options.selectedKey ?? state.selectedKey,
    livePreset
  }));
  return livePreset;
}

export function applyProcessingPresetToSession(preset: ProcessingPreset): ProcessingPreset {
  const selectedKey = preset.source === 'live' ? livePresetKey : processingPresetKey(preset);
  const livePreset = liveProcessingPreset(preset.settings);
  processingPresetSession.set({ selectedKey, livePreset });
  return preset.source === 'live' ? livePreset : preset;
}

export function currentLiveProcessingPreset(): ProcessingPreset {
  return get(processingPresetSession).livePreset;
}

function readStoredProcessingPresetSession(): ProcessingPresetSessionState | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      const legacyPreset = readLegacyLivePreset();
      return legacyPreset ? { selectedKey: livePresetKey, livePreset: legacyPreset } : null;
    }
    const parsed = JSON.parse(stored) as StoredProcessingPresetSession;
    return {
      selectedKey: typeof parsed.selectedKey === 'string' && parsed.selectedKey ? parsed.selectedKey : livePresetKey,
      livePreset: normalizeLivePreset(parsed.livePreset)
    };
  } catch {
    return null;
  }
}

function readLegacyLivePreset(): ProcessingPreset | null {
  try {
    const stored = localStorage.getItem(LEGACY_LIVE_PRESET_KEY);
    if (!stored) return null;
    return normalizeLivePreset(JSON.parse(stored) as ProcessingPreset);
  } catch {
    return null;
  }
}

function normalizeLivePreset(preset: ProcessingPreset | null | undefined): ProcessingPreset {
  if (preset?.source === 'live' && preset.settings) {
    return {
      ...preset,
      id: 'live',
      source: 'live',
      settings: pruneProcessingSettings(preset.settings)
    };
  }
  return liveProcessingPreset({});
}
