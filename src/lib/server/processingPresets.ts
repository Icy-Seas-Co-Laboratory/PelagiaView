import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { parse, stringify } from 'smol-toml';
import type { ProcessingPreset, ProcessingPresetSaveRequest, ProcessingSettings } from '$lib/processing/settings';

const builtinPresetModules = import.meta.glob('/src/lib/presets/processing/*.toml', {
  eager: true,
  query: '?raw',
  import: 'default'
}) as Record<string, string>;

const userPresetDir = resolve(process.env.PELAGIA_VIEW_PROCESSING_PRESET_DIR ?? '.pelagia-view/processing-presets');

export async function listServerProcessingPresets(): Promise<ProcessingPreset[]> {
  const [builtins, userPresets] = await Promise.all([readBuiltinPresets(), readUserPresets()]);
  return [...builtins, ...userPresets].sort(comparePresets);
}

export async function saveServerProcessingPreset(request: ProcessingPresetSaveRequest): Promise<ProcessingPreset> {
  const name = request.name.trim();
  if (!name) throw new Error('Preset name is required.');
  const id = presetId(request.id || name);
  if (!id) throw new Error('Preset name must include at least one letter or number.');
  const now = new Date().toISOString();
  const preset: ProcessingPreset = {
    id,
    name,
    description: request.description?.trim() || undefined,
    source: 'user',
    settings: cleanSettings(request.settings),
    updatedAt: now
  };
  await mkdir(userPresetDir, { recursive: true });
  await writeFile(join(userPresetDir, `${id}.toml`), serializePresetToml(preset), 'utf8');
  return preset;
}

async function readBuiltinPresets(): Promise<ProcessingPreset[]> {
  return Object.entries(builtinPresetModules).map(([path, source]) =>
    parsePresetToml(source, presetId(basename(path, '.toml')), 'builtin')
  );
}

async function readUserPresets(): Promise<ProcessingPreset[]> {
  try {
    const entries = await readdir(userPresetDir, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.toml'));
    const presets = await Promise.all(
      files.map(async (file) => {
        const source = await readFile(join(userPresetDir, file.name), 'utf8');
        return parsePresetToml(source, presetId(basename(file.name, '.toml')), 'user');
      })
    );
    return presets;
  } catch {
    return [];
  }
}

function parsePresetToml(source: string, fallbackId: string, fallbackSource: 'builtin' | 'user'): ProcessingPreset {
  const parsed = parse(source) as Record<string, unknown>;
  const presetSection = objectValue(parsed.preset);
  const rawSettings = objectValue(parsed.settings);
  const nullSettings = stringArrayValue(parsed.null_settings);
  const settings: ProcessingSettings = {};
  for (const [key, value] of Object.entries(rawSettings)) {
    if (isSettingValue(value)) settings[key as keyof ProcessingSettings] = value as never;
  }
  for (const key of nullSettings) {
    settings[key as keyof ProcessingSettings] = null as never;
  }
  const id = presetId(stringValue(presetSection.id) || fallbackId);
  return {
    id,
    name: stringValue(presetSection.name) || titleFromId(id),
    description: stringValue(presetSection.description) || undefined,
    source: fallbackSource,
    settings,
    updatedAt: stringValue(presetSection.updated_at)
  };
}

function serializePresetToml(preset: ProcessingPreset): string {
  const settings = cleanSettings(preset.settings);
  const nullSettings = Object.entries(settings)
    .filter(([, value]) => value === null)
    .map(([key]) => key)
    .sort();
  const serializableSettings = Object.fromEntries(
    Object.entries(settings).filter(([, value]) => value !== null && value !== undefined)
  );
  return stringify({
    preset: {
      id: preset.id,
      name: preset.name,
      description: preset.description ?? '',
      source: preset.source,
      updated_at: preset.updatedAt ?? new Date().toISOString()
    },
    null_settings: nullSettings,
    settings: serializableSettings
  });
}

function cleanSettings(settings: ProcessingSettings): ProcessingSettings {
  return Object.fromEntries(
    Object.entries(settings).filter(([, value]) => isSettingValue(value) || value === null)
  ) as ProcessingSettings;
}

function isSettingValue(value: unknown): boolean {
  return ['string', 'number', 'boolean'].includes(typeof value) || stringArrayValue(value).length > 0;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function presetId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function titleFromId(id: string): string {
  return id
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function comparePresets(left: ProcessingPreset, right: ProcessingPreset): number {
  if (left.source !== right.source) return left.source === 'builtin' ? -1 : 1;
  return left.name.localeCompare(right.name);
}

