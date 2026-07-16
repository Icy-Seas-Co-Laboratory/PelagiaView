export type ProcessingSettings = {
  ingestionTileCount?: number;
  framePayloadKind?: 'original' | 'preprocessed';
  applyPreprocessing?: boolean;
  thresholdMethod?: string;
  manualThreshold?: number;
  thresholdingMaximumValue?: number | null;
  boundedOtsuMinContrast?: number;
  boundedOtsuMaxForegroundFraction?: number;
  cannyEnabled?: boolean;
  cannyLowThreshold?: number;
  cannyHighThreshold?: number;
  cannyBlurKernel?: number;
  adaptiveBlockSize?: number;
  adaptiveC?: number;
  percentileBackgroundPercentile?: number;
  percentileMinContrast?: number;
  hysteresisLowThreshold?: number;
  hysteresisHighThreshold?: number;
  hysteresisConnectivity?: number;
  sobelPercentile?: number;
  sobelThreshold?: number | null;
  sobelKernelSize?: number;
  maskAugmentationEnabled?: boolean;
  maskAugmentationSteps?: string[];
  dilateKernelW?: number;
  dilateKernelH?: number;
  dilateIterations?: number;
  erodeKernelW?: number;
  erodeKernelH?: number;
  erodeIterations?: number;
  openKernelW?: number;
  openKernelH?: number;
  openIterations?: number;
  closeKernelW?: number;
  closeKernelH?: number;
  closeIterations?: number;
  fillHoles?: boolean;
  removeSmallComponents?: boolean;
  minComponentArea?: number;
  clearBorder?: boolean;
  roiAssemblyMethod?: string;
  roiAssemblyConnectivity?: number;
  backgroundCorrection?: boolean;
  backgroundFrameLimit?: number;
  backgroundWindowWidth?: number;
  backgroundWindowStride?: number;
  backgroundMinFieldValue?: number;
  backgroundMaxFieldValue?: number | null;
  flatfieldCorrection?: boolean;
  flatfieldQ?: number;
  flatfieldAxis?: number;
  flatfieldMinFieldValue?: number;
  flatfieldMaxFieldValue?: number | null;
  applyMask?: boolean;
  cropEnabled?: boolean;
  cropX?: number | null;
  cropY?: number | null;
  cropW?: number | null;
  cropH?: number | null;
  invertIntensity?: boolean;
  minArea?: number | null;
  maxArea?: number | null;
  minPerimeter?: number;
  maxPerimeter?: number | null;
  minWidth?: number | null;
  maxWidth?: number | null;
  minHeight?: number | null;
  maxHeight?: number | null;
  minWidthPlusHeight?: number | null;
  maxWidthPlusHeight?: number | null;
  padding?: number;
  storeRoiPayloadMinArea?: number | null;
  storeRoiPayloadMinWidth?: number | null;
  storeRoiPayloadMinHeight?: number | null;
  storeRoiPayloadMinWidthPlusHeight?: number | null;
  refinementModelKind?: string;
  refinementModelRef?: string;
  refinementModelRunDir?: string;
  refinementModelArtifact?: string;
  refinementTileSize?: number;
  refinementOverlapFraction?: number;
  refinementModelBatchSize?: number | null;
  refinementOutputThreshold?: number;
  refinementAllowFrameExpansion?: boolean;
  refinementMaxIterations?: number;
  refinementExpansionPixels?: number | null;
  refinementEdgeTouchMargin?: number;
  refinementEncoding?: string;
  refinementStore?: boolean;
  refinementDryRun?: boolean;
};

export type ProcessingSettingKey = keyof ProcessingSettings;

export type ProcessingPresetSource = 'builtin' | 'user' | 'live';

export type ProcessingPreset = {
  id: string;
  name: string;
  description?: string;
  source: ProcessingPresetSource;
  settings: ProcessingSettings;
  updatedAt?: string | null;
};

export type ProcessingPresetSaveRequest = {
  id?: string;
  name: string;
  description?: string;
  settings: ProcessingSettings;
};

export const PROCESSING_PRESET_APPLIED_EVENT = 'pelagia-view:processing-preset-applied';

export function processingPresetLabel(preset: ProcessingPreset): string {
  return preset.source === 'live' ? `${preset.name} (live)` : preset.name;
}

export function processingPresetKey(preset: Pick<ProcessingPreset, 'source' | 'id'>): string {
  return `${preset.source}:${preset.id}`;
}

export function liveProcessingPreset(settings: ProcessingSettings): ProcessingPreset {
  return {
    id: 'live',
    name: 'Current session',
    description: 'The settings currently active in this browser session.',
    source: 'live',
    settings: pruneProcessingSettings(settings)
  };
}

export function processingPresetByKey(
  presets: ProcessingPreset[],
  key: string
): ProcessingPreset | null {
  return presets.find((preset) => processingPresetKey(preset) === key) ?? null;
}

export function pruneProcessingSettings(settings: ProcessingSettings): ProcessingSettings {
  const pruned: ProcessingSettings = {};

  const has = (key: keyof ProcessingSettings) => key in settings && settings[key] !== undefined;
  const copy = <K extends keyof ProcessingSettings>(key: K) => {
    if (has(key)) pruned[key] = settings[key] as never;
  };
  const copyIfPresentValue = <K extends keyof ProcessingSettings>(key: K) => {
    const value = settings[key];
    if (value !== undefined && value !== null && value !== '') pruned[key] = value as never;
  };

  copy('ingestionTileCount');

  copy('framePayloadKind');
  copy('applyPreprocessing');

  copy('backgroundCorrection');
  if (settings.backgroundCorrection) {
    copy('backgroundFrameLimit');
    copy('backgroundWindowWidth');
    copy('backgroundWindowStride');
    copy('backgroundMinFieldValue');
    copy('backgroundMaxFieldValue');
  }

  copy('flatfieldCorrection');
  if (settings.flatfieldCorrection) {
    copy('flatfieldQ');
    copy('flatfieldAxis');
    copy('flatfieldMinFieldValue');
    copy('flatfieldMaxFieldValue');
  }

  copy('applyMask');
  copy('cropEnabled');
  if (settings.cropEnabled) {
    copy('cropX');
    copy('cropY');
    copy('cropW');
    copy('cropH');
  }
  copy('invertIntensity');

  const thresholdMethod = settings.thresholdMethod;
  copy('thresholdMethod');
  if (thresholdMethod === 'manual') copy('manualThreshold');
  if (thresholdMethod === 'otsu' || thresholdMethod === 'bounded_otsu' || thresholdMethod === 'bounded_otsu_canny') {
    copy('thresholdingMaximumValue');
  }
  if (thresholdMethod === 'bounded_otsu' || thresholdMethod === 'bounded_otsu_canny') {
    copy('boundedOtsuMinContrast');
    copy('boundedOtsuMaxForegroundFraction');
  }
  if (thresholdMethod === 'bounded_otsu_canny') copy('cannyEnabled');
  if (thresholdMethod === 'canny' || (thresholdMethod === 'bounded_otsu_canny' && settings.cannyEnabled)) {
    copy('cannyLowThreshold');
    copy('cannyHighThreshold');
    copy('cannyBlurKernel');
  }
  if (thresholdMethod === 'adaptive_mean' || thresholdMethod === 'adaptive_gaussian') {
    copy('adaptiveBlockSize');
    copy('adaptiveC');
  }
  if (thresholdMethod === 'percentile_background') {
    copy('percentileBackgroundPercentile');
    copy('percentileMinContrast');
  }
  if (thresholdMethod === 'hysteresis') {
    copy('hysteresisLowThreshold');
    copy('hysteresisHighThreshold');
    copy('hysteresisConnectivity');
  }
  if (thresholdMethod === 'sobel_edges') {
    copy('sobelPercentile');
    copy('sobelThreshold');
    copy('sobelKernelSize');
  }

  copy('maskAugmentationEnabled');
  if (settings.maskAugmentationEnabled) {
    const steps = (settings.maskAugmentationSteps ?? []).filter((step) => step && step !== 'none');
    if (steps.length) pruned.maskAugmentationSteps = steps;
    if (steps.includes('dilate')) {
      copy('dilateKernelW');
      copy('dilateKernelH');
      copy('dilateIterations');
    }
    if (steps.includes('erode')) {
      copy('erodeKernelW');
      copy('erodeKernelH');
      copy('erodeIterations');
    }
    if (steps.includes('open')) {
      copy('openKernelW');
      copy('openKernelH');
      copy('openIterations');
    }
    if (steps.includes('close')) {
      copy('closeKernelW');
      copy('closeKernelH');
      copy('closeIterations');
    }
    copy('fillHoles');
    copy('removeSmallComponents');
    if (settings.removeSmallComponents || steps.includes('remove_small_components')) copy('minComponentArea');
    copy('clearBorder');
  }

  copy('roiAssemblyMethod');
  copy('roiAssemblyConnectivity');
  copyIfPresentValue('minArea');
  copyIfPresentValue('maxArea');
  copy('minPerimeter');
  copyIfPresentValue('maxPerimeter');
  copyIfPresentValue('minWidth');
  copyIfPresentValue('maxWidth');
  copyIfPresentValue('minHeight');
  copyIfPresentValue('maxHeight');
  copyIfPresentValue('minWidthPlusHeight');
  copyIfPresentValue('maxWidthPlusHeight');
  copy('padding');

  copyIfPresentValue('storeRoiPayloadMinArea');
  copyIfPresentValue('storeRoiPayloadMinWidth');
  copyIfPresentValue('storeRoiPayloadMinHeight');
  copyIfPresentValue('storeRoiPayloadMinWidthPlusHeight');

  copy('refinementModelKind');
  copyIfPresentValue('refinementModelRef');
  if (settings.refinementModelKind === 'oracle_builder_unet') copyIfPresentValue('refinementModelRunDir');
  if (settings.refinementModelKind === 'keras_artifact') copyIfPresentValue('refinementModelArtifact');
  copy('refinementTileSize');
  copy('refinementOverlapFraction');
  copy('refinementModelBatchSize');
  copy('refinementOutputThreshold');
  copy('refinementAllowFrameExpansion');
  if (settings.refinementAllowFrameExpansion) {
    copy('refinementMaxIterations');
    copy('refinementExpansionPixels');
    copy('refinementEdgeTouchMargin');
  }
  copy('refinementEncoding');
  copy('refinementStore');
  copy('refinementDryRun');

  return pruned;
}

export function processingSettingsBaseline(
  globalDefaults: ProcessingSettings,
  selectedPreset: ProcessingPreset | null | undefined
): ProcessingSettings {
  if (!selectedPreset || selectedPreset.source === 'live') return { ...globalDefaults };
  return {
    ...globalDefaults,
    ...selectedPreset.settings
  };
}

export function processingSettingChangedFromBaseline<K extends ProcessingSettingKey>(
  baseline: ProcessingSettings,
  key: K,
  value: ProcessingSettings[K]
): boolean {
  return !processingSettingValuesEqual(value, baseline[key]);
}

export function processingSettingValuesEqual(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizeProcessingSettingValue(left);
  const normalizedRight = normalizeProcessingSettingValue(right);
  if (Array.isArray(normalizedLeft) || Array.isArray(normalizedRight)) {
    if (!Array.isArray(normalizedLeft) || !Array.isArray(normalizedRight)) return false;
    if (normalizedLeft.length !== normalizedRight.length) return false;
    return normalizedLeft.every((value, index) => processingSettingValuesEqual(value, normalizedRight[index]));
  }
  return normalizedLeft === normalizedRight;
}

function normalizeProcessingSettingValue(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return null;
  if (Array.isArray(value)) {
    const normalized = value
      .filter((entry) => entry !== undefined && entry !== null && entry !== '' && entry !== 'none')
      .map((entry) => normalizeProcessingSettingValue(entry))
      .sort((left, right) => String(left).localeCompare(String(right)));
    return normalized.length ? normalized : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? Number(value.toFixed(8)) : value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return value.trim() !== '' && Number.isFinite(parsed) ? Number(parsed.toFixed(8)) : value;
  }
  return value;
}
