export type ProcessingSettings = {
  preprocessingEncoding?: string;
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
  backgroundPercentile?: number;
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
  roiEncoding?: string;
  zstdMinBytes?: number | null;
  alwaysStoreMask?: boolean;
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
    settings
  };
}

export function processingPresetByKey(
  presets: ProcessingPreset[],
  key: string
): ProcessingPreset | null {
  return presets.find((preset) => processingPresetKey(preset) === key) ?? null;
}
