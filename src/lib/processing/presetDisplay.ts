import type { ProcessingPreset } from './settings';

export type PresetSettingEntry = { key: string; label: string; value: string };
export type PresetSettingGroup = { id: string; label: string; entries: PresetSettingEntry[] };

const settingGroups: Array<{ id: string; label: string; keys: string[] }> = [
  { id: 'ingestion', label: 'Ingestion', keys: ['ingestionTileCount', 'ingestionScanMode', 'ingestionLineScanAxis', 'ingestionBackgroundWindowWidth', 'ingestionBackgroundWindowStride', 'ingestionFlatfieldWindowWidth', 'ingestionFlatfieldWindowStride'] },
  { id: 'preprocessing', label: 'Preprocessing', keys: ['framePayloadKind', 'applyPreprocessing', 'minFieldValue', 'maxFieldValue', 'applyMask', 'cropEnabled', 'cropX', 'cropY', 'cropW', 'cropH'] },
  { id: 'threshold', label: 'Threshold', keys: ['thresholdMethod', 'manualThreshold', 'thresholdingMaximumValue', 'boundedOtsuMinContrast', 'boundedOtsuMaxForegroundFraction', 'cannyEnabled', 'cannyLowThreshold', 'cannyHighThreshold', 'cannyBlurKernel', 'adaptiveBlockSize', 'adaptiveC', 'percentileBackgroundPercentile', 'percentileMinContrast', 'hysteresisLowThreshold', 'hysteresisHighThreshold', 'hysteresisConnectivity', 'sobelPercentile', 'sobelThreshold', 'sobelKernelSize'] },
  { id: 'mask-augmentation', label: 'Mask Augmentation', keys: ['maskAugmentationEnabled', 'maskAugmentationSteps', 'dilateKernelW', 'dilateKernelH', 'dilateIterations', 'erodeKernelW', 'erodeKernelH', 'erodeIterations', 'openKernelW', 'openKernelH', 'openIterations', 'closeKernelW', 'closeKernelH', 'closeIterations', 'fillHoles', 'removeSmallComponents', 'minComponentArea', 'clearBorder'] },
  { id: 'candidate-detection', label: 'Candidate Detection', keys: ['roiAssemblyMethod', 'roiAssemblyConnectivity', 'minArea', 'maxArea', 'minPerimeter', 'maxPerimeter', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'minWidthPlusHeight', 'maxWidthPlusHeight', 'padding'] },
  { id: 'roi-storage', label: 'ROI Storage', keys: ['storeRoiPayloadMinArea', 'storeRoiPayloadMinWidth', 'storeRoiPayloadMinHeight', 'storeRoiPayloadMinWidthPlusHeight'] },
  { id: 'refinement', label: 'Refinement', keys: ['refinementModelRef', 'refinementAllowFrameExpansion', 'refinementMaxIterations', 'refinementExpansionPixels', 'refinementEdgeTouchMargin', 'refinementEncoding', 'refinementStore', 'refinementDryRun'] }
];

const settingUnits: Record<string, string> = {
  ingestionTileCount: 'frames', ingestionBackgroundWindowWidth: 'frames', ingestionBackgroundWindowStride: 'frames', ingestionFlatfieldWindowWidth: 'frames', ingestionFlatfieldWindowStride: 'frames', minFieldValue: 'DN', maxFieldValue: 'DN', cropX: 'px', cropY: 'px', cropW: 'px', cropH: 'px', manualThreshold: 'DN', thresholdingMaximumValue: 'DN', boundedOtsuMinContrast: 'DN', boundedOtsuMaxForegroundFraction: '0–1', cannyLowThreshold: 'DN', cannyHighThreshold: 'DN', cannyBlurKernel: 'px', adaptiveBlockSize: 'px', adaptiveC: 'DN', percentileBackgroundPercentile: '%', percentileMinContrast: 'DN', hysteresisLowThreshold: 'DN', hysteresisHighThreshold: 'DN', sobelPercentile: '%', sobelKernelSize: 'px', dilateKernelW: 'px', dilateKernelH: 'px', erodeKernelW: 'px', erodeKernelH: 'px', openKernelW: 'px', openKernelH: 'px', closeKernelW: 'px', closeKernelH: 'px', minComponentArea: 'px²', minArea: 'px²', maxArea: 'px²', minPerimeter: 'px', maxPerimeter: 'px', minWidth: 'px', maxWidth: 'px', minHeight: 'px', maxHeight: 'px', minWidthPlusHeight: 'px', maxWidthPlusHeight: 'px', padding: 'px', storeRoiPayloadMinArea: 'px²', storeRoiPayloadMinWidth: 'px', storeRoiPayloadMinHeight: 'px', storeRoiPayloadMinWidthPlusHeight: 'px', refinementExpansionPixels: 'px', refinementEdgeTouchMargin: 'px'
};

export function presetSettingGroups(preset: ProcessingPreset): PresetSettingGroup[] {
  const settings = preset.settings ?? {};
  const usedKeys = new Set<string>();
  const groups = settingGroups.map((group) => ({
    id: group.id,
    label: group.label,
    entries: group.keys.flatMap((key) => {
      if (!(key in settings) || settings[key as keyof typeof settings] === undefined) return [];
      usedKeys.add(key);
      return [presetSettingEntry(key, settings[key as keyof typeof settings])];
    })
  })).filter((group) => group.entries.length);
  const otherEntries = Object.entries(settings).filter(([key, value]) => !usedKeys.has(key) && value !== undefined).map(([key, value]) => presetSettingEntry(key, value)).sort((a, b) => a.label.localeCompare(b.label));
  if (otherEntries.length) groups.push({ id: 'other', label: 'Other', entries: otherEntries });
  return groups;
}

export function presetSettingEntry(key: string, value: unknown): PresetSettingEntry {
  return { key, label: presetSettingLabel(key), value: presetSettingValue(value) };
}

export function presetSettingLabel(key: string): string {
  const label = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/Roi/g, 'ROI').replace(/Bbox/g, 'BBox').replace(/Zstd/g, 'Zstd').replace(/^./, (value) => value.toUpperCase());
  return settingUnits[key] ? `${label} (${settingUnits[key]})` : label;
}

export function presetSettingValue(value: unknown): string {
  if (value === null) return 'None';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'None';
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
  if (value === '') return 'Default';
  return String(value);
}
