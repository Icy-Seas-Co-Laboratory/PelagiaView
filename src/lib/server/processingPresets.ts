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
  const rawSettings = flattenSettings(objectValue(parsed.settings));
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
  const flatSettings = Object.fromEntries(
    Object.entries(settings).filter(([, value]) => value !== null && value !== undefined)
  );
  const payload: Record<string, unknown> = {
    preset: {
      id: preset.id,
      name: preset.name,
      description: preset.description ?? '',
      source: preset.source,
      updated_at: preset.updatedAt ?? new Date().toISOString()
    },
    settings: groupSettings(flatSettings)
  };
  if (nullSettings.length) payload.null_settings = nullSettings;
  return stringify(payload);
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

function flattenSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const flattened: Record<string, unknown> = {};
  for (const value of Object.values(settings)) {
    const group = objectValue(value);
    for (const [groupKey, groupValue] of Object.entries(group)) {
      flattened[groupKey] = groupValue;
    }
  }
  return flattened;
}

function groupSettings(settings: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const grouped: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(settings)) {
    const group = settingGroupForKey(key);
    grouped[group] = { ...(grouped[group] ?? {}), [key]: value };
  }
  return grouped;
}

function settingGroupForKey(key: string): string {
  if (
    [
      'ingestionTileCount',
      'ingestionScanMode',
      'ingestionLineScanAxis',
      'ingestionBackgroundWindowWidth',
      'ingestionBackgroundWindowStride',
      'ingestionFlatfieldWindowWidth',
      'ingestionFlatfieldWindowStride'
    ].includes(key)
  ) {
    return 'ingestion';
  }
  if (
    [
      'framePayloadKind',
      'applyPreprocessing',
      'minFieldValue',
      'maxFieldValue',
      'applyMask',
      'cropEnabled',
      'cropX',
      'cropY',
      'cropW',
      'cropH'
    ].includes(key)
  ) {
    return 'preprocessing';
  }
  if (
    [
      'thresholdMethod',
      'manualThreshold',
      'thresholdingMaximumValue',
      'boundedOtsuMinContrast',
      'boundedOtsuMaxForegroundFraction',
      'cannyEnabled',
      'cannyLowThreshold',
      'cannyHighThreshold',
      'cannyBlurKernel',
      'adaptiveBlockSize',
      'adaptiveC',
      'percentileBackgroundPercentile',
      'percentileMinContrast',
      'hysteresisLowThreshold',
      'hysteresisHighThreshold',
      'hysteresisConnectivity',
      'sobelPercentile',
      'sobelThreshold',
      'sobelKernelSize'
    ].includes(key)
  ) {
    return 'threshold';
  }
  if (
    [
      'maskAugmentationEnabled',
      'maskAugmentationSteps',
      'dilateKernelW',
      'dilateKernelH',
      'dilateIterations',
      'erodeKernelW',
      'erodeKernelH',
      'erodeIterations',
      'openKernelW',
      'openKernelH',
      'openIterations',
      'closeKernelW',
      'closeKernelH',
      'closeIterations',
      'fillHoles',
      'removeSmallComponents',
      'minComponentArea',
      'clearBorder'
    ].includes(key)
  ) {
    return 'mask_augmentation';
  }
  if (
    [
      'roiAssemblyMethod',
      'roiAssemblyConnectivity',
      'minArea',
      'maxArea',
      'minPerimeter',
      'maxPerimeter',
      'minWidth',
      'maxWidth',
      'minHeight',
      'maxHeight',
      'minWidthPlusHeight',
      'maxWidthPlusHeight',
      'padding'
    ].includes(key)
  ) {
    return 'candidate_detection';
  }
  if (
    [
      'storeRoiPayloadMinArea',
      'storeRoiPayloadMinWidth',
      'storeRoiPayloadMinHeight',
      'storeRoiPayloadMinWidthPlusHeight'
    ].includes(key)
  ) {
    return 'roi_storage';
  }
  if (
    [
      'refinementModelKind',
      'refinementModelRef',
      'refinementModelRunDir',
      'refinementModelArtifact',
      'refinementTileSize',
      'refinementOverlapFraction',
      'refinementModelBatchSize',
      'refinementOutputThreshold',
      'refinementAllowFrameExpansion',
      'refinementMaxIterations',
      'refinementExpansionPixels',
      'refinementEdgeTouchMargin',
      'refinementEncoding',
      'refinementStore',
      'refinementDryRun'
    ].includes(key)
  ) {
    return 'refinement';
  }
  return 'other';
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
