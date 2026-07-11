import { browser } from '$app/environment';
import { preferenceKey } from '$lib/utils/preferences';

export type PreferenceCategory = 'connection' | 'interface' | 'workflow' | 'image' | 'diagnostics';

export type PreferenceDefinition = {
  key: string;
  label: string;
  description: string;
  category: PreferenceCategory;
  resetWithUiState?: boolean;
};

export type PreferenceEntry = PreferenceDefinition & {
  present: boolean;
  bytes: number;
  updatedAt: string | null;
  valuePreview: string | null;
  known: boolean;
};

export type PreferenceExport = {
  format: 'pelagia-view-preferences';
  version: 1;
  exportedAt: string;
  entries: Record<string, string>;
};

export const preferenceDefinitions: PreferenceDefinition[] = [
  {
    key: 'pelagia-view-session',
    label: 'Backend connection',
    description: 'Saved API endpoint and active session restore state.',
    category: 'connection'
  },
  {
    key: 'pelagia-view:sidebar-collapsed',
    label: 'Sidebar layout',
    description: 'Whether the dashboard navigation sidebar is collapsed.',
    category: 'interface',
    resetWithUiState: true
  },
  {
    key: preferenceKey('status'),
    label: 'Status page',
    description: 'Table sorting, paging, and status dashboard display preferences.',
    category: 'interface',
    resetWithUiState: true
  },
  {
    key: preferenceKey('ingestion'),
    label: 'Ingestion page',
    description: 'File browser path, selected paths, and ingestion defaults.',
    category: 'workflow',
    resetWithUiState: true
  },
  {
    key: preferenceKey('dataset-queue:preprocessing'),
    label: 'Preprocessing queue',
    description: 'Frame filters, batch size, priority, and preprocessing parameters.',
    category: 'workflow',
    resetWithUiState: true
  },
  {
    key: preferenceKey('dataset-queue:segmentation'),
    label: 'Candidate queue',
    description: 'Frame filters, batch size, priority, and candidate generation parameters.',
    category: 'workflow',
    resetWithUiState: true
  },
  {
    key: preferenceKey('dataset-queue:roi_refinement'),
    label: 'Refinement queue',
    description: 'Frame and ROI filters, batch size, priority, and refinement parameters.',
    category: 'workflow',
    resetWithUiState: true
  },
  {
    key: preferenceKey('explorer'),
    label: 'Explorer',
    description: 'Selected frame, display mode, overlays, and live processing parameters.',
    category: 'image',
    resetWithUiState: true
  },
  {
    key: 'pelagia-view-processing-preset-session',
    label: 'Processing preset session',
    description: 'The selected processing preset and current session processing settings.',
    category: 'workflow'
  },
  {
    key: preferenceKey('roi-browser'),
    label: 'ROI browser',
    description: 'ROI filters, sorting, inversion, masking, and tile view options.',
    category: 'image',
    resetWithUiState: true
  },
  {
    key: preferenceKey('frame-browser'),
    label: 'Frame browser',
    description: 'Frame filters, display mode, download format, and tile browser options.',
    category: 'image',
    resetWithUiState: true
  },
  {
    key: 'pelagia-view-analytics-session-id',
    label: 'Analytics session',
    description: 'Anonymous local session id used to group PelagiaView analytics events.',
    category: 'diagnostics'
  }
];

const definitionByKey = new Map(preferenceDefinitions.map((definition) => [definition.key, definition]));
const uiStateBaseKeys = preferenceDefinitions
  .filter((definition) => definition.resetWithUiState)
  .map((definition) => definition.key);

export function listPreferenceEntries(): PreferenceEntry[] {
  if (!browser) return [];
  const keys = new Set<string>(preferenceDefinitions.map((definition) => definition.key));
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith('pelagia-view')) keys.add(key);
  }
  return [...keys].sort(sortPreferenceKeys).map((key) => preferenceEntryForKey(key));
}

export function exportPreferences(keys?: string[]): PreferenceExport {
  const entries: Record<string, string> = {};
  if (browser) {
    const selectedKeys = keys ?? listPreferenceEntries().filter((entry) => entry.present).map((entry) => entry.key);
    for (const key of selectedKeys) {
      const value = localStorage.getItem(key);
      if (value !== null) entries[key] = value;
    }
  }
  return {
    format: 'pelagia-view-preferences',
    version: 1,
    exportedAt: new Date().toISOString(),
    entries
  };
}

export function importPreferences(source: string): { imported: number; skipped: number } {
  if (!browser) return { imported: 0, skipped: 0 };
  const parsed = JSON.parse(source) as unknown;
  const entries = extractImportEntries(parsed);
  let imported = 0;
  let skipped = 0;
  for (const [key, value] of Object.entries(entries)) {
    if (!key.startsWith('pelagia-view')) {
      skipped += 1;
      continue;
    }
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    imported += 1;
  }
  return { imported, skipped };
}

export function clearPreference(key: string): void {
  if (!browser) return;
  localStorage.removeItem(key);
}

export function clearPreferences(keys: string[]): void {
  if (!browser) return;
  for (const key of keys) localStorage.removeItem(key);
}

export function uiStatePreferenceKeys(): string[] {
  const keys = new Set(uiStateBaseKeys);
  if (browser) {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && isUiStatePreferenceKey(key)) keys.add(key);
    }
  }
  return [...keys];
}

function preferenceEntryForKey(key: string): PreferenceEntry {
  const definition = definitionByKey.get(key) ?? scopedDefinitionForKey(key);
  const value = browser ? localStorage.getItem(key) : null;
  return {
    key,
    label: definition?.label ?? friendlyLabel(key),
    description: definition?.description ?? 'Saved PelagiaView data discovered in local browser storage.',
    category: definition?.category ?? 'interface',
    resetWithUiState: definition?.resetWithUiState ?? true,
    known: Boolean(definition),
    present: value !== null,
    bytes: value ? byteLength(value) : 0,
    updatedAt: updatedAtFromValue(value),
    valuePreview: value ? previewValue(value) : null
  };
}

function isUiStatePreferenceKey(key: string): boolean {
  return uiStateBaseKeys.some((baseKey) => key === baseKey || key.startsWith(`${baseKey}:server:`));
}

function scopedDefinitionForKey(key: string): PreferenceDefinition | undefined {
  const baseKey = uiStateBaseKeys.find((candidate) => key.startsWith(`${candidate}:server:`));
  return baseKey ? definitionByKey.get(baseKey) : undefined;
}

function extractImportEntries(parsed: unknown): Record<string, unknown> {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Preferences import must be a JSON object.');
  }
  const record = parsed as Record<string, unknown>;
  const entries = record.entries;
  if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
    return entries as Record<string, unknown>;
  }
  return record;
}

function sortPreferenceKeys(left: string, right: string): number {
  const leftKnown = definitionByKey.has(left);
  const rightKnown = definitionByKey.has(right);
  if (leftKnown && rightKnown) {
    return preferenceDefinitions.findIndex((definition) => definition.key === left) - preferenceDefinitions.findIndex((definition) => definition.key === right);
  }
  if (leftKnown) return -1;
  if (rightKnown) return 1;
  return left.localeCompare(right);
}

function friendlyLabel(key: string): string {
  return key
    .replace(/^pelagia-view:?/, '')
    .replace(/:v\d+$/, '')
    .replace(/[-_:]+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function byteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
  return value.length;
}

function updatedAtFromValue(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const candidates = [parsed.updatedAt, parsed.connectedAt, parsed.expiresAt].filter((candidate) => typeof candidate === 'string');
    return (candidates[0] as string | undefined) ?? null;
  } catch {
    return null;
  }
}

function previewValue(value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const keys = Object.keys(parsed).slice(0, 4);
      return keys.length ? keys.join(', ') : 'Stored object';
    }
  } catch {
    // String preferences are expected for a few legacy keys.
  }
  return value.length > 52 ? `${value.slice(0, 49)}...` : value;
}
