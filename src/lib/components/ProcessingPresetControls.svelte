<script lang="ts">
  import type { ProcessingPreset } from '$lib/processing/settings';
  import { processingPresetByKey, processingPresetKey } from '$lib/processing/settings';

  export let presets: ProcessingPreset[] = [];
  export let selectedKey = 'live:live';
  export let loading = false;
  export let message: string | null = null;
  export let error: string | null = null;
  export let allowSave = false;
  export let onApply: ((preset: ProcessingPreset) => void | Promise<void>) | null = null;
  export let onRefresh: (() => void | Promise<void>) | null = null;
  export let onSave: ((name: string, description: string) => void | Promise<void>) | null = null;

  let saveName = '';
  let saveDescription = '';

  $: selectedPreset = processingPresetByKey(presets, selectedKey) ?? presets[0] ?? null;
  $: selectedPresetGroups = selectedPreset ? presetSettingGroups(selectedPreset) : [];
  $: selectedPresetEntryCount = selectedPresetGroups.reduce((total, group) => total + group.entries.length, 0);

  type PresetSettingEntry = { key: string; label: string; value: string };
  type PresetSettingGroup = { id: string; label: string; entries: PresetSettingEntry[] };

  const settingGroups: Array<{ id: string; label: string; keys: string[] }> = [
    {
      id: 'ingestion',
      label: 'Ingestion',
      keys: [
        'ingestionTileCount',
        'ingestionScanMode',
        'ingestionLineScanAxis',
        'ingestionBackgroundWindowWidth',
        'ingestionBackgroundWindowStride',
        'ingestionFlatfieldWindowWidth',
        'ingestionFlatfieldWindowStride'
      ]
    },
    {
      id: 'preprocessing',
      label: 'Preprocessing',
      keys: [
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
      ]
    },
    {
      id: 'threshold',
      label: 'Threshold',
      keys: [
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
      ]
    },
    {
      id: 'mask-augmentation',
      label: 'Mask Augmentation',
      keys: [
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
      ]
    },
    {
      id: 'candidate-detection',
      label: 'Candidate Detection',
      keys: [
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
      ]
    },
    {
      id: 'roi-storage',
      label: 'ROI Storage',
      keys: [
        'storeRoiPayloadMinArea',
        'storeRoiPayloadMinWidth',
        'storeRoiPayloadMinHeight',
        'storeRoiPayloadMinWidthPlusHeight'
      ]
    },
    {
      id: 'refinement',
      label: 'Refinement',
      keys: [
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
      ]
    }
  ];

  async function applyPreset() {
    if (!selectedPreset) return;
    await onApply?.(selectedPreset);
  }

  async function savePreset() {
    await onSave?.(saveName, saveDescription);
    saveName = '';
    saveDescription = '';
  }

  function presetSettingGroups(preset: ProcessingPreset): PresetSettingGroup[] {
    const settings = preset.settings ?? {};
    const usedKeys = new Set<string>();
    const groups = settingGroups
      .map((group) => {
        const entries = group.keys.flatMap((key) => {
          if (!(key in settings) || settings[key as keyof typeof settings] === undefined) return [];
          usedKeys.add(key);
          return [settingEntry(key, settings[key as keyof typeof settings])];
        });
        return { id: group.id, label: group.label, entries };
      })
      .filter((group) => group.entries.length);

    const otherEntries = Object.entries(settings)
      .filter(([key, value]) => !usedKeys.has(key) && value !== undefined)
      .map(([key, value]) => settingEntry(key, value))
      .sort((a, b) => a.label.localeCompare(b.label));
    if (otherEntries.length) groups.push({ id: 'other', label: 'Other', entries: otherEntries });
    return groups;
  }

  function settingEntry(key: string, value: unknown): PresetSettingEntry {
    return {
      key,
      label: settingLabel(key),
      value: settingValue(value)
    };
  }

  function settingLabel(key: string): string {
    return key
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/Roi/g, 'ROI')
      .replace(/Bbox/g, 'BBox')
      .replace(/Zstd/g, 'Zstd')
      .replace(/^./, (value) => value.toUpperCase());
  }

  function settingValue(value: unknown): string {
    if (value === null) return 'None';
    if (Array.isArray(value)) return value.length ? value.join(', ') : 'None';
    if (typeof value === 'boolean') return value ? 'On' : 'Off';
    if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
    if (value === '') return 'Default';
    return String(value);
  }
</script>

<details class="form-section collapsible-section" open>
  <summary class="section-heading">
    <span>
      <p class="eyebrow">Settings</p>
      <strong>Presets</strong>
    </span>
  </summary>

  <div class="form-grid compact-grid">
    <label class="span-2">
      Active preset
      <select bind:value={selectedKey}>
        {#each presets as preset}
          <option value={processingPresetKey(preset)}>
            {preset.name}{preset.source === 'builtin' ? ' · built in' : preset.source === 'user' ? ' · saved' : ' · live'}
          </option>
        {/each}
      </select>
    </label>
    <button class="ghost" type="button" on:click={applyPreset} disabled={!selectedPreset}>Apply preset</button>
    <button class="ghost" type="button" on:click={() => onRefresh?.()} disabled={loading}>
      {loading ? 'Refreshing' : 'Refresh presets'}
    </button>
  </div>

  {#if selectedPreset?.description}
    <p class="soft">{selectedPreset.description}</p>
  {/if}

  <details class="preset-values" open>
    <summary>
      <span>Preset values</span>
      <small>{selectedPresetEntryCount} setting{selectedPresetEntryCount === 1 ? '' : 's'}</small>
    </summary>
    {#if selectedPresetGroups.length}
      <div class="preset-value-groups">
        {#each selectedPresetGroups as group}
          <details class="preset-value-group" open>
            <summary>
              <span>{group.label}</span>
              <small>{group.entries.length}</small>
            </summary>
            <div class="preset-value-list">
              {#each group.entries as entry}
                <div class="preset-value-row">
                  <span>{entry.label}</span>
                  <code>{entry.value}</code>
                </div>
              {/each}
            </div>
          </details>
        {/each}
      </div>
    {:else}
      <p class="soft">This preset does not define any settings.</p>
    {/if}
  </details>

  {#if allowSave}
    <div class="form-grid compact-grid">
      <label>
        Preset name
        <input bind:value={saveName} placeholder="My cruise settings" />
      </label>
      <label>
        Description
        <input bind:value={saveDescription} placeholder="Optional note" />
      </label>
    </div>
    <button type="button" on:click={savePreset}>Save current settings</button>
  {/if}

  {#if message}<p class="success">{message}</p>{/if}
  {#if error}<p class="form-error">{error}</p>{/if}
</details>

<style>
  .preset-values {
    margin: 14px 0;
    border: 1px solid #e0e8e5;
    border-radius: 8px;
    overflow: hidden;
  }

  .preset-values summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    cursor: pointer;
    color: #17201b;
    background: #f4f8f6;
  }

  .preset-values summary small {
    color: #60746c;
    font-size: 0.78rem;
  }

  .preset-value-groups {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 10px;
    padding: 10px;
  }

  .preset-value-group {
    align-self: start;
    border: 1px solid #e0e8e5;
    border-radius: 7px;
    overflow: hidden;
    background: #ffffff;
  }

  .preset-value-group > summary {
    padding: 8px 10px;
    background: #eef5f2;
  }

  .preset-value-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  }

  .preset-value-row {
    display: grid;
    gap: 3px;
    align-content: start;
    min-width: 0;
    padding: 7px 10px;
    border-top: 1px solid #e0e8e5;
  }

  .preset-value-row span {
    color: #60746c;
    font-size: 0.82rem;
  }

  .preset-value-row code {
    min-width: 0;
    overflow-wrap: anywhere;
    color: #17201b;
    font-size: 0.78rem;
    line-height: 1.35;
    background: transparent;
  }

  @media (max-width: 720px) {
    .preset-value-row {
      grid-template-columns: 1fr;
      gap: 4px;
    }
  }
</style>
