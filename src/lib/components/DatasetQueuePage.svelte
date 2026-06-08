<script lang="ts">
  import { onMount } from 'svelte';
  import { getClient } from '$lib/stores/session';
  import type { AssetDetectionStats, FrameSummary, RawAsset, SystemConfigResponse } from '$lib/api/types';
  import {
    booleanDefault,
    nullableNumberDefault,
    numberDefault,
    processingSection,
    stringDefault
  } from '$lib/utils/configDefaults';
  import { formatCount } from '$lib/utils/format';

  export let mode: 'preprocessing' | 'segmentation';

  type Dataset = {
    asset: RawAsset;
    frames: FrameSummary[];
    frameCount: number;
    preprocessedCount: number;
    detectionCount: number;
    collections: string[];
  };

  type FilterGroup = 'asset' | 'collection' | 'preprocess' | 'detection';

  let datasets: Dataset[] = [];
  let collectionOptions: string[] = [];
  let selectedAssetIds = new Set<string>();
  let selectedCollections = new Set<string>();
  let selectedPreprocessStates = new Set<string>();
  let selectedDetectionStates = new Set<string>();
  let loading = true;
  let queueing = false;
  let message: string | null = null;
  let error: string | null = null;

  let startFrame: number | null = null;
  let endFrame: number | null = null;
  let frameLimit: number | null = null;
  let priority: number | null = null;

  let flatfieldCorrection = false;
  let flatfieldQ = 0.95;
  let flatfieldAxis = 0;
  let backgroundCorrection = false;
  let backgroundPercentile = 50;
  let applyMask = false;
  let cropEnabled = false;
  let cropX: number | null = null;
  let cropY: number | null = null;
  let cropW: number | null = null;
  let cropH: number | null = null;
  let invertIntensity = false;
  let preprocessingEncoding = 'png';

  let framePayloadKind: 'original' | 'preprocessed' = 'preprocessed';
  let applyPreprocessing = false;
  let threshold: number | null = null;
  let minPerimeter = 100;
  let maxPerimeter: number | null = null;
  let padding = 100;
  let roiEncoding = 'zstd';
  let zstdMinBytes: number | null = null;

  const title = mode === 'preprocessing' ? 'Queue preprocessing' : 'Queue segmentation';
  const eyebrow = mode === 'preprocessing' ? 'Preprocessing' : 'Segmentation';
  const actionLabel = mode === 'preprocessing' ? 'Queue preprocessing jobs' : 'Queue segmentation jobs';
  const preprocessStateOptions = [
    { id: 'needs-preprocessed', label: 'No preprocessed data' },
    { id: 'has-preprocessed', label: 'Has preprocessed data' }
  ];
  const detectionStateOptions = [
    { id: 'needs-detections', label: 'No detections' },
    { id: 'has-detections', label: 'Has detections' }
  ];

  $: filteredDatasets = datasets.filter((dataset) => matchesDataset(dataset));
  $: prospectiveAssetCount = filteredDatasets.length;
  $: prospectiveFrameCount = filteredDatasets.reduce((total, dataset) => total + dataset.frameCount, 0);
  $: prospectivePreprocessedCount = filteredDatasets.reduce(
    (total, dataset) => total + dataset.preprocessedCount,
    0
  );
  $: prospectiveDetectionCount = filteredDatasets.reduce((total, dataset) => total + dataset.detectionCount, 0);
  $: preprocessedSourceWarning =
    mode === 'segmentation' &&
    framePayloadKind === 'preprocessed' &&
    filteredDatasets.some((dataset) => dataset.preprocessedCount === 0);

  onMount(loadCatalog);

  async function loadCatalog() {
    const client = getClient();
    if (!client) return;
    loading = true;
    error = null;
    try {
      const [assets, detectionStats, collections, config] = await Promise.all([
        client.listAssets('video', 500),
        client.assetDetectionStats('video', 500).catch(() => ({}) as AssetDetectionStats),
        client.listCollections(500).catch(() => []),
        client.systemConfig().catch(() => null)
      ]);
      applyConfigDefaults(config);
      const detectionByAsset = new Map(
        (detectionStats.assets ?? []).map((asset) => [asset.asset_id, Number(asset.detection_count ?? 0)])
      );
      datasets = await Promise.all(
        assets.map(async (asset) => {
          const fullAsset = await client.getAsset(asset.id).catch(() => asset);
          const frameCount = Number(fullAsset.frame_count ?? asset.frame_count ?? 0);
          const frames =
            frameCount > 0 ? await client.listFrames(asset.id, Math.max(frameCount, 1)).catch(() => []) : [];
          return {
            asset: { ...asset, ...fullAsset },
            frames,
            frameCount: frameCount || frames.length,
            preprocessedCount: frames.filter((frame) => frame.has_preprocessed_payload).length,
            detectionCount: detectionByAsset.get(asset.id) ?? 0,
            collections: assetCollections({ ...asset, ...fullAsset })
          };
        })
      );
      collectionOptions = uniqueStrings([
        ...collections.map((collection) => collection.collection),
        ...datasets.flatMap((dataset) => dataset.collections)
      ]);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  function applyConfigDefaults(config: SystemConfigResponse | null) {
    const segmentation = processingSection(config, 'segmentation');
    const flatfield = processingSection(config, 'flatfield');
    const preprocessing = processingSection(config, 'preprocessing');
    const frameStorage = processingSection(config, 'frame_storage');

    flatfieldCorrection = booleanDefault(flatfield, 'flatfield_correction', flatfieldCorrection);
    flatfieldQ = numberDefault(flatfield, 'flatfield_q', flatfieldQ);
    flatfieldAxis = numberDefault(flatfield, 'flatfield_axis', flatfieldAxis);
    backgroundCorrection = booleanDefault(preprocessing, 'background_correction', backgroundCorrection);
    backgroundPercentile = numberDefault(preprocessing, 'background_percentile', backgroundPercentile);
    applyMask = booleanDefault(preprocessing, 'apply_mask', applyMask);
    cropEnabled = booleanDefault(preprocessing, 'crop_enabled', cropEnabled);
    cropX = nullableNumberDefault(preprocessing, 'crop_x', cropX);
    cropY = nullableNumberDefault(preprocessing, 'crop_y', cropY);
    cropW = nullableNumberDefault(preprocessing, 'crop_w', cropW);
    cropH = nullableNumberDefault(preprocessing, 'crop_h', cropH);
    invertIntensity = booleanDefault(preprocessing, 'invert_intensity', invertIntensity);
    preprocessingEncoding = stringDefault(frameStorage, 'image_encoding', preprocessingEncoding);

    minPerimeter = numberDefault(segmentation, 'min_perimeter', minPerimeter);
    maxPerimeter = nullableNumberDefault(segmentation, 'max_perimeter', maxPerimeter);
    padding = numberDefault(segmentation, 'padding', padding);
    roiEncoding = stringDefault(segmentation, 'roi_encoding', roiEncoding);
    zstdMinBytes = nullableNumberDefault(segmentation, 'zstd_min_bytes', zstdMinBytes);
  }

  function assetCollections(asset: RawAsset): string[] {
    const value = asset.collections ?? asset.metadata?.collections;
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    if (typeof value === 'string') return value.split(',').map((part) => part.trim()).filter(Boolean);
    return [];
  }

  function uniqueStrings(values: Array<string | undefined | null>): string[] {
    return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) =>
      a.localeCompare(b)
    );
  }

  function matchesDataset(
    dataset: Dataset,
    overrides: Partial<{
      assetIds: Set<string>;
      collections: Set<string>;
      preprocessStates: Set<string>;
      detectionStates: Set<string>;
    }> = {}
  ): boolean {
    const assetIds = overrides.assetIds ?? selectedAssetIds;
    const collections = overrides.collections ?? selectedCollections;
    const preprocessStates = overrides.preprocessStates ?? selectedPreprocessStates;
    const detectionStates = overrides.detectionStates ?? selectedDetectionStates;

    if (assetIds.size && !assetIds.has(dataset.asset.id)) return false;
    if (collections.size && !dataset.collections.some((collection) => collections.has(collection))) return false;
    if (preprocessStates.size && !preprocessStates.has(preprocessState(dataset))) return false;
    if (mode === 'segmentation' && detectionStates.size && !detectionStates.has(detectionState(dataset))) {
      return false;
    }
    return true;
  }

  function preprocessState(dataset: Dataset): string {
    return dataset.preprocessedCount > 0 ? 'has-preprocessed' : 'needs-preprocessed';
  }

  function detectionState(dataset: Dataset): string {
    return dataset.detectionCount > 0 ? 'has-detections' : 'needs-detections';
  }

  function optionCount(group: FilterGroup, value?: string): number {
    const overrides: Parameters<typeof matchesDataset>[1] = {};
    if (group === 'asset') overrides.assetIds = value ? new Set([value]) : new Set();
    if (group === 'collection') overrides.collections = value ? new Set([value]) : new Set();
    if (group === 'preprocess') overrides.preprocessStates = value ? new Set([value]) : new Set();
    if (group === 'detection') overrides.detectionStates = value ? new Set([value]) : new Set();
    return datasets.filter((dataset) => matchesDataset(dataset, overrides)).length;
  }

  function optionFrameCount(group: FilterGroup, value?: string): number {
    const overrides: Parameters<typeof matchesDataset>[1] = {};
    if (group === 'asset') overrides.assetIds = value ? new Set([value]) : new Set();
    if (group === 'collection') overrides.collections = value ? new Set([value]) : new Set();
    if (group === 'preprocess') overrides.preprocessStates = value ? new Set([value]) : new Set();
    if (group === 'detection') overrides.detectionStates = value ? new Set([value]) : new Set();
    return datasets
      .filter((dataset) => matchesDataset(dataset, overrides))
      .reduce((total, dataset) => total + dataset.frameCount, 0);
  }

  function toggleAsset(assetId: string) {
    selectedAssetIds = toggled(selectedAssetIds, assetId);
  }

  function toggleCollection(collection: string) {
    selectedCollections = toggled(selectedCollections, collection);
  }

  function togglePreprocessState(state: string) {
    selectedPreprocessStates = toggled(selectedPreprocessStates, state);
  }

  function toggleDetectionState(state: string) {
    selectedDetectionStates = toggled(selectedDetectionStates, state);
  }

  function toggled(values: Set<string>, value: string): Set<string> {
    const next = new Set(values);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  function clearGroup(group: FilterGroup) {
    if (group === 'asset') selectedAssetIds = new Set();
    if (group === 'collection') selectedCollections = new Set();
    if (group === 'preprocess') selectedPreprocessStates = new Set();
    if (group === 'detection') selectedDetectionStates = new Set();
  }

  async function queueJobs() {
    const client = getClient();
    if (!client || filteredDatasets.length === 0) return;
    queueing = true;
    message = null;
    error = null;
    let queued = 0;
    for (const dataset of filteredDatasets) {
      try {
        if (mode === 'preprocessing') {
          await client.queuePreprocessJob({
            asset_id: dataset.asset.id,
            run_id: dataset.asset.run_id,
            start_frame: startFrame,
            end_frame: endFrame,
            limit: frameLimit,
            priority,
            flatfield_correction: flatfieldCorrection,
            flatfield_q: flatfieldCorrection ? flatfieldQ : undefined,
            flatfield_axis: flatfieldCorrection ? flatfieldAxis : undefined,
            background_correction: backgroundCorrection,
            background_percentile: backgroundCorrection ? backgroundPercentile : undefined,
            apply_mask: applyMask,
            crop_enabled: cropEnabled,
            crop_x: cropEnabled ? cropX : undefined,
            crop_y: cropEnabled ? cropY : undefined,
            crop_w: cropEnabled ? cropW : undefined,
            crop_h: cropEnabled ? cropH : undefined,
            invert_intensity: invertIntensity,
            encoding: preprocessingEncoding as 'png' | 'jpg' | 'raw' | 'zstd'
          });
        } else {
          await client.queueSegmentationJob({
            asset_id: dataset.asset.id,
            run_id: dataset.asset.run_id,
            start_frame: startFrame,
            end_frame: endFrame,
            limit: frameLimit,
            priority,
            threshold,
            frame_payload_kind: framePayloadKind,
            apply_preprocessing: framePayloadKind === 'original' ? applyPreprocessing : false,
            min_perimeter: minPerimeter,
            max_perimeter: maxPerimeter,
            padding,
            roi_encoding: roiEncoding,
            zstd_min_bytes: zstdMinBytes
          });
        }
        queued += 1;
      } catch (err) {
        error = `Queued ${queued}/${filteredDatasets.length}. ${err instanceof Error ? err.message : String(err)}`;
        queueing = false;
        return;
      }
    }
    message = `Queued ${queued} ${mode === 'preprocessing' ? 'preprocessing' : 'segmentation'} job${queued === 1 ? '' : 's'}.`;
    queueing = false;
  }
</script>

<div class="queue-layout">
  <section class="panel queue-filter-panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {#if loading}<span class="soft">Loading</span>{/if}
    </div>

    <div class="metric-grid compact-metrics">
      <div class="metric">
        <span>Matched assets</span>
        <strong>{formatCount(prospectiveAssetCount)}</strong>
      </div>
      <div class="metric">
        <span>Matched frames</span>
        <strong>{formatCount(prospectiveFrameCount)}</strong>
      </div>
      <div class="metric">
        <span>Preprocessed frames</span>
        <strong>{formatCount(prospectivePreprocessedCount)}</strong>
      </div>
      {#if mode === 'segmentation'}
        <div class="metric">
          <span>Existing detections</span>
          <strong>{formatCount(prospectiveDetectionCount)}</strong>
        </div>
      {/if}
    </div>

    <div class="queue-filter-grid">
      <div class="filter-group">
        <div class="section-heading">
          <p class="eyebrow">Asset</p>
          <strong>Original file name</strong>
        </div>
        <div class="compact-select-list">
          <button class:active={selectedAssetIds.size === 0} type="button" on:click={() => clearGroup('asset')}>
            <span>Any asset</span>
            <small>{formatCount(optionCount('asset'))} assets · {formatCount(optionFrameCount('asset'))} frames</small>
          </button>
          {#each datasets as dataset}
            <button
              class:active={selectedAssetIds.has(dataset.asset.id)}
              type="button"
              on:click={() => toggleAsset(dataset.asset.id)}
            >
              <span>{dataset.asset.filename ?? dataset.asset.id}</span>
              <small>{formatCount(dataset.frameCount)} frames · {formatCount(dataset.preprocessedCount)} preprocessed</small>
            </button>
          {/each}
        </div>
      </div>

      <div class="filter-group">
        <div class="section-heading">
          <p class="eyebrow">Collection</p>
          <strong>Collection tags</strong>
        </div>
        <div class="compact-select-list">
          <button class:active={selectedCollections.size === 0} type="button" on:click={() => clearGroup('collection')}>
            <span>Any collection</span>
            <small>{formatCount(optionCount('collection'))} assets · {formatCount(optionFrameCount('collection'))} frames</small>
          </button>
          {#each collectionOptions as collection}
            <button
              class:active={selectedCollections.has(collection)}
              type="button"
              on:click={() => toggleCollection(collection)}
            >
              <span>{collection}</span>
              <small>{formatCount(optionCount('collection', collection))} assets · {formatCount(optionFrameCount('collection', collection))} frames</small>
            </button>
          {/each}
        </div>
      </div>

      <div class="filter-group">
        <div class="section-heading">
          <p class="eyebrow">State</p>
          <strong>Preprocessing state</strong>
        </div>
        <div class="compact-select-list">
          <button class:active={selectedPreprocessStates.size === 0} type="button" on:click={() => clearGroup('preprocess')}>
            <span>Any preprocessing state</span>
            <small>{formatCount(optionCount('preprocess'))} assets · {formatCount(optionFrameCount('preprocess'))} frames</small>
          </button>
          {#each preprocessStateOptions as option}
            <button
              class:active={selectedPreprocessStates.has(option.id)}
              type="button"
              on:click={() => togglePreprocessState(option.id)}
            >
              <span>{option.label}</span>
              <small>{formatCount(optionCount('preprocess', option.id))} assets · {formatCount(optionFrameCount('preprocess', option.id))} frames</small>
            </button>
          {/each}
        </div>
      </div>

      {#if mode === 'segmentation'}
        <div class="filter-group">
          <div class="section-heading">
            <p class="eyebrow">State</p>
            <strong>Detection state</strong>
          </div>
          <div class="compact-select-list">
            <button class:active={selectedDetectionStates.size === 0} type="button" on:click={() => clearGroup('detection')}>
              <span>Any detection state</span>
              <small>{formatCount(optionCount('detection'))} assets · {formatCount(optionFrameCount('detection'))} frames</small>
            </button>
            {#each detectionStateOptions as option}
              <button
                class:active={selectedDetectionStates.has(option.id)}
                type="button"
                on:click={() => toggleDetectionState(option.id)}
              >
                <span>{option.label}</span>
                <small>{formatCount(optionCount('detection', option.id))} assets · {formatCount(optionFrameCount('detection', option.id))} frames</small>
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </section>

  <section class="panel controls-panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Parameters</p>
        <h2>{mode === 'preprocessing' ? 'Preprocessing job' : 'Segmentation job'}</h2>
      </div>
    </div>

    <div class="form-section">
      <div class="section-heading">
        <p class="eyebrow">Scope</p>
        <strong>Frame range</strong>
      </div>
      <div class="form-grid compact-grid">
        <label>
          Start frame
          <input type="number" min="1" bind:value={startFrame} placeholder="any" />
        </label>
        <label>
          End frame
          <input type="number" min="1" bind:value={endFrame} placeholder="any" />
        </label>
        <label>
          Limit
          <input type="number" min="1" bind:value={frameLimit} placeholder="none" />
        </label>
        <label>
          Priority
          <input type="number" bind:value={priority} placeholder="default" />
        </label>
      </div>
    </div>

    {#if mode === 'preprocessing'}
      <div class="form-section">
        <div class="section-heading">
          <p class="eyebrow">Correction</p>
          <strong>Background and flatfield</strong>
        </div>
        <label class="check-row">
          <input type="checkbox" bind:checked={backgroundCorrection} />
          Background removal
        </label>
        {#if backgroundCorrection}
          <label>
            Background percentile
            <input type="range" min="0" max="100" step="1" bind:value={backgroundPercentile} />
            <span class="range-value">{backgroundPercentile}</span>
          </label>
        {/if}
        <label class="check-row">
          <input type="checkbox" bind:checked={flatfieldCorrection} />
          Flatfield correction
        </label>
        {#if flatfieldCorrection}
          <label>
            Flatfield q
            <input type="range" min="0" max="1" step="0.01" bind:value={flatfieldQ} />
            <span class="range-value">{flatfieldQ.toFixed(2)}</span>
          </label>
          <label>
            Flatfield axis
            <select bind:value={flatfieldAxis}>
              <option value={0}>0</option>
              <option value={1}>1</option>
            </select>
          </label>
        {/if}
      </div>

      <div class="form-section">
        <div class="section-heading">
          <p class="eyebrow">Candidate image</p>
          <strong>Crop, mask, and invert</strong>
        </div>
        <label class="check-row">
          <input type="checkbox" bind:checked={applyMask} />
          Apply stored frame mask
        </label>
        <label class="check-row">
          <input type="checkbox" bind:checked={cropEnabled} />
          Crop image
        </label>
        {#if cropEnabled}
          <div class="form-grid compact-grid">
            <label>
              Crop x
              <input type="number" min="0" bind:value={cropX} />
            </label>
            <label>
              Crop y
              <input type="number" min="0" bind:value={cropY} />
            </label>
            <label>
              Crop width
              <input type="number" min="1" bind:value={cropW} />
            </label>
            <label>
              Crop height
              <input type="number" min="1" bind:value={cropH} />
            </label>
          </div>
        {/if}
        <label class="check-row">
          <input type="checkbox" bind:checked={invertIntensity} />
          Invert intensity
        </label>
        <label>
          Stored encoding
          <select bind:value={preprocessingEncoding}>
            <option value="png">png</option>
            <option value="zstd">zstd</option>
            <option value="raw">raw</option>
            <option value="jpg">jpg</option>
          </select>
        </label>
      </div>
    {:else}
      <div class="form-section">
        <div class="section-heading">
          <p class="eyebrow">Source</p>
          <strong>Frame payload</strong>
        </div>
        <label>
          Frame source
          <select bind:value={framePayloadKind}>
            <option value="preprocessed">preprocessed</option>
            <option value="original">original</option>
          </select>
        </label>
        {#if framePayloadKind === 'original'}
          <label class="check-row">
            <input type="checkbox" bind:checked={applyPreprocessing} />
            Apply preprocessing before thresholding
          </label>
        {/if}
        {#if preprocessedSourceWarning}
          <p class="callout">Some matched assets have no preprocessed frames. Jobs using the preprocessed source may fail for those assets.</p>
        {/if}
      </div>

      <div class="form-section">
        <div class="section-heading">
          <p class="eyebrow">Threshold</p>
          <strong>Candidate ROIs</strong>
        </div>
        <label>
          Threshold
          <input type="number" bind:value={threshold} placeholder="auto" />
        </label>
        <label>
          Minimum perimeter
          <input type="range" min="0" max="1000" step="10" bind:value={minPerimeter} />
          <span class="range-value">{minPerimeter}</span>
        </label>
        <label>
          Maximum perimeter
          <input type="number" bind:value={maxPerimeter} placeholder="none" />
        </label>
      </div>

      <div class="form-section">
        <div class="section-heading">
          <p class="eyebrow">Refine</p>
          <strong>ROI storage</strong>
        </div>
        <label>
          Padding
          <input type="range" min="0" max="500" step="1" bind:value={padding} />
          <span class="range-value">{padding}</span>
        </label>
        <label>
          ROI encoding
          <select bind:value={roiEncoding}>
            <option value="png">png</option>
            <option value="zstd">zstd</option>
            <option value="raw">raw</option>
            <option value="auto">auto</option>
          </select>
        </label>
        <label>
          zstd min bytes
          <input type="number" min="0" bind:value={zstdMinBytes} placeholder="default" />
        </label>
      </div>
    {/if}

    <button type="button" on:click={queueJobs} disabled={queueing || filteredDatasets.length === 0}>
      {queueing ? 'Queueing' : actionLabel}
    </button>
    <p class="soft">
      {formatCount(prospectiveAssetCount)} asset job{prospectiveAssetCount === 1 ? '' : 's'} covering about {formatCount(prospectiveFrameCount)} frame{prospectiveFrameCount === 1 ? '' : 's'}.
    </p>
    {#if message}<p class="success">{message}</p>{/if}
    {#if error}<p class="form-error">{error}</p>{/if}
  </section>
</div>
