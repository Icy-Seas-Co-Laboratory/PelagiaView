import { browser } from '$app/environment';
import { get, writable } from 'svelte/store';
import type { ProcessingPreset, ProcessingSettings } from '$lib/processing/settings';
import {
  liveProcessingPreset,
  processingPresetKey,
  pruneProcessingSettings
} from '$lib/processing/settings';
import { session, type SessionState } from '$lib/stores/session';

const STORAGE_KEY_PREFIX = 'pelagia-view-processing-preset-session';
const LEGACY_STORAGE_KEY = 'pelagia-view-processing-preset-session';
const LEGACY_LIVE_PRESET_KEY = 'pelagia-view:processing-preset:live';
const livePresetKey = 'live:live';

type ProcessingPresetSessionState = {
  selectedKey: string;
  livePreset: ProcessingPreset;
  selectedPreset: ProcessingPreset | null;
};

type StoredProcessingPresetSession = Partial<ProcessingPresetSessionState>;

let activeStorageScope = browser ? processingPresetStorageScope(get(session)) : 'server:no-project';
let activeStorageKey = processingPresetStorageKey(activeStorageScope);
let loadingScopedState = false;

const initialState = browser ? readStoredProcessingPresetSession(activeStorageKey, { allowLegacyFallback: true }) : null;

export const processingPresetSession = writable<ProcessingPresetSessionState>({
  selectedKey: initialState?.selectedKey ?? livePresetKey,
  livePreset: normalizeLivePreset(initialState?.livePreset),
  selectedPreset: normalizeSelectedPreset(initialState?.selectedPreset)
});

if (browser) {
  processingPresetSession.subscribe((state) => {
    if (loadingScopedState) return;
    localStorage.setItem(activeStorageKey, JSON.stringify(state));
  });

  session.subscribe((state) => {
    const nextScope = processingPresetStorageScope(state);
    if (nextScope === activeStorageScope) return;
    activeStorageScope = nextScope;
    activeStorageKey = processingPresetStorageKey(nextScope);
    loadingScopedState = true;
    processingPresetSession.set(defaultProcessingPresetSession(readStoredProcessingPresetSession(activeStorageKey)));
    loadingScopedState = false;
  });
}

export function setSelectedProcessingPresetKey(selectedKey: string) {
  processingPresetSession.update((state) => ({
    ...state,
    selectedKey: selectedKey || livePresetKey,
    selectedPreset: selectedKey && selectedKey !== livePresetKey ? state.selectedPreset : null
  }));
}

export function setLiveProcessingPresetFromSettings(settings: ProcessingSettings, options: { selectedKey?: string } = {}) {
  const livePreset = liveProcessingPreset(settings);
  processingPresetSession.update((state) => ({
    selectedKey: options.selectedKey ?? state.selectedKey,
    livePreset,
    selectedPreset: options.selectedKey === livePresetKey ? null : state.selectedPreset
  }));
  return livePreset;
}

export function applyProcessingPresetToSession(
  preset: ProcessingPreset,
  options: { appliedSettings?: ProcessingSettings } = {}
): ProcessingPreset {
  const selectedKey = preset.source === 'live' ? livePresetKey : processingPresetKey(preset);
  const livePreset = liveProcessingPreset(options.appliedSettings ?? preset.settings);
  processingPresetSession.set({
    selectedKey,
    livePreset,
    selectedPreset: preset.source === 'live' ? null : normalizeSelectedPreset(preset)
  });
  return preset.source === 'live' ? livePreset : preset;
}

export function currentLiveProcessingPreset(): ProcessingPreset {
  return get(processingPresetSession).livePreset;
}

function defaultProcessingPresetSession(stored?: ProcessingPresetSessionState | null): ProcessingPresetSessionState {
  return {
    selectedKey: stored?.selectedKey ?? livePresetKey,
    livePreset: normalizeLivePreset(stored?.livePreset),
    selectedPreset: normalizeSelectedPreset(stored?.selectedPreset)
  };
}

function processingPresetStorageScope(state: SessionState): string {
  const projectKey = state.project?.id ?? state.project?.project_key ?? 'no-project';
  return `${state.baseUrl || 'unknown-server'}:${projectKey}`;
}

function processingPresetStorageKey(scope: string): string {
  return `${STORAGE_KEY_PREFIX}:${encodeURIComponent(scope)}`;
}

function readStoredProcessingPresetSession(
  storageKey: string,
  options: { allowLegacyFallback?: boolean } = {}
): ProcessingPresetSessionState | null {
  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored) {
      if (!options.allowLegacyFallback) return null;
      const legacySession = readLegacyProcessingPresetSession();
      if (legacySession) return legacySession;
      const legacyPreset = readLegacyLivePreset();
      return legacyPreset ? { selectedKey: livePresetKey, livePreset: legacyPreset, selectedPreset: null } : null;
    }
    const parsed = JSON.parse(stored) as StoredProcessingPresetSession;
    return {
      selectedKey: typeof parsed.selectedKey === 'string' && parsed.selectedKey ? parsed.selectedKey : livePresetKey,
      livePreset: normalizeLivePreset(parsed.livePreset),
      selectedPreset: normalizeSelectedPreset(parsed.selectedPreset)
    };
  } catch {
    return null;
  }
}

function readLegacyProcessingPresetSession(): ProcessingPresetSessionState | null {
  try {
    const stored = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as StoredProcessingPresetSession;
    return {
      selectedKey: typeof parsed.selectedKey === 'string' && parsed.selectedKey ? parsed.selectedKey : livePresetKey,
      livePreset: normalizeLivePreset(parsed.livePreset),
      selectedPreset: normalizeSelectedPreset(parsed.selectedPreset)
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

function normalizeSelectedPreset(preset: ProcessingPreset | null | undefined): ProcessingPreset | null {
  if (!preset || preset.source === 'live' || !preset.settings) return null;
  return {
    ...preset,
    settings: pruneProcessingSettings(preset.settings)
  };
}
