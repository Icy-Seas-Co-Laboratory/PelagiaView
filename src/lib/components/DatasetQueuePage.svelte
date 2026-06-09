<script lang="ts">
  import { onMount } from 'svelte';
  import { getClient, session } from '$lib/stores/session';
  import type {
    AssetProcessingState,
    FrameProcessingState,
    FrameSummary,
    RawAsset,
    SystemConfigResponse
  } from '$lib/api/types';
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
    frameIds: string[];
    frameCount: number;
    preprocessedCount: number;
    detectionCount: number;
    collections: string[];
    preprocessingState?: string;
    detectionState?: string;
  };

  type FrameCatalogRow = {
    frameId: string;
    runId?: string | null;
    assetId: string;
    frameIndex?: number;
    assetFilename?: string;
    kind?: string;
    collections: string[];
    hasPreprocessedPayload: boolean;
    detectionCount: number;
    preprocessingState: string;
    detectionState: string;
  };

  type FrameBatch = {
    assetId: string;
    runId?: string | null;
    frameIds: string[];
  };

  type FilterGroup = 'asset' | 'collection' | 'preprocess' | 'detection';

  type FrameFilters = {
    assetIds: Set<string>;
    collections: Set<string>;
    preprocessStates: Set<string>;
    detectionStates: Set<string>;
  };

  let datasets: Dataset[] = [];
  let frameRows: FrameCatalogRow[] = [];
  let collectionOptions: string[] = [];
  let selectedAssetIds = new Set<string>();
  let selectedCollections = new Set<string>();
  let selectedPreprocessStates = new Set<string>();
  let selectedDetectionStates = new Set<string>();
  let loading = true;
  let queueing = false;
  let message: string | null = null;
  let error: string | null = null;
  let catalogStatus = 'Catalog not loaded yet.';
  let lastCatalogKey = '';

  let frameBatchSize = 100;
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
  $: activeFilters = {
    assetIds: selectedAssetIds,
    collections: selectedCollections,
    preprocessStates: selectedPreprocessStates,
    detectionStates: selectedDetectionStates
  };
  $: matchingFrames = frameRows.filter((frame) => matchesFrame(frame, activeFilters));
  $: filteredFrames = matchingFrames;
  $: filteredDatasets = datasets.filter((dataset) => filteredFrames.some((frame) => frame.assetId === dataset.asset.id));
  $: preprocessStateOptions = stateOptions(frameRows.map((frame) => frame.preprocessingState));
  $: detectionStateOptions = stateOptions(frameRows.map((frame) => frame.detectionState));
  $: assetFrameCounts = frameCountMap('asset', datasets.map((dataset) => dataset.asset.id), activeFilters);
  $: collectionFrameCounts = frameCountMap('collection', collectionOptions, activeFilters);
  $: preprocessFrameCounts = frameCountMap('preprocess', preprocessStateOptions.map((option) => option.id), activeFilters);
  $: detectionFrameCounts = frameCountMap('detection', detectionStateOptions.map((option) => option.id), activeFilters);
  $: assetAnyFrameCount = sumFrameCounts(assetFrameCounts);
  $: collectionAnyFrameCount = sumFrameCounts(collectionFrameCounts);
  $: preprocessAnyFrameCount = sumFrameCounts(preprocessFrameCounts);
  $: detectionAnyFrameCount = sumFrameCounts(detectionFrameCounts);
  $: prospectiveFrameCount = filteredFrames.length;
  $: prospectivePreprocessedCount = filteredFrames.filter((frame) => frame.hasPreprocessedPayload).length;
  $: prospectiveDetectionCount = filteredFrames.reduce((total, frame) => total + frame.detectionCount, 0);
  $: prospectiveBatchCount = frameBatches(filteredFrames, frameBatchSize).length;
  $: preprocessedSourceWarning =
    mode === 'segmentation' &&
    framePayloadKind === 'preprocessed' &&
    filteredFrames.some((frame) => !frame.hasPreprocessedPayload);

  $: catalogKey = `${$session.connected ? $session.baseUrl : 'disconnected'}:${mode}`;
  $: if ($session.connected && catalogKey !== lastCatalogKey) {
    lastCatalogKey = catalogKey;
    void loadCatalog();
  }

  onMount(() => {
    if ($session.connected) void loadCatalog();
  });

  async function loadCatalog() {
    const client = getClient();
    if (!client) {
      loading = false;
      catalogStatus = 'No active API session.';
      return;
    }
    loading = true;
    error = null;
    catalogStatus = 'Loading dataset catalog.';
    try {
      const [processingState, collections, config] = await Promise.all([
        loadFrameProcessingRows(client).catch(() => null),
        client.listCollections(500).catch(() => []),
        client.systemConfig().catch(() => null)
      ]);
      applyConfigDefaults(config);
      frameRows = processingState ?? (await loadCatalogFallback());
      datasets = datasetsFromFrames(frameRows);
      catalogStatus = processingState
        ? `Loaded ${formatCount(frameRows.length)} frames from processing state.`
        : `Loaded ${formatCount(frameRows.length)} frames from fallback catalog.`;
      collectionOptions = uniqueStrings([
        ...collections.map((collection) => collection.collection),
        ...frameRows.flatMap((frame) => frame.collections)
      ]);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      catalogStatus = 'Dataset catalog failed to load.';
    } finally {
      loading = false;
    }
  }

  async function loadFrameProcessingRows(client: NonNullable<ReturnType<typeof getClient>>): Promise<FrameCatalogRow[]> {
    const rows: FrameCatalogRow[] = [];
    let offset = 0;
    const limit = 10000;
    while (true) {
      const page = await client.frameProcessingState({ limit, offset });
      rows.push(...frameRowsFromProcessingState(page));
      const nextOffset = page.page?.next_offset;
      if (nextOffset === null || nextOffset === undefined) break;
      offset = Number(nextOffset);
      if (!Number.isFinite(offset) || offset <= rows.length - limit) break;
    }
    return rows;
  }

  async function loadCatalogFallback(): Promise<FrameCatalogRow[]> {
    const client = getClient();
    if (!client) return [];
    const assets = await client.listAssets(undefined, 500);
    const detectionStats = await client.assetDetectionStats(undefined, 500).catch(() => ({}) as AssetProcessingState);
    const detectionByAsset = new Map(
      (detectionStats.assets ?? []).map((asset) => [asset.asset_id, Number(asset.detection_count ?? 0)])
    );
    const nested = await Promise.all(
      assets.map(async (asset): Promise<FrameCatalogRow[]> => {
        const fullAsset = await client.getAsset(asset.id).catch(() => asset);
        const frameCount = Number(fullAsset.frame_count ?? asset.frame_count ?? 0);
        const frames =
          frameCount > 0 ? await client.listFrames(asset.id, Math.max(frameCount, 1)).catch(() => []) : [];
        const assetWithDetails = { ...asset, ...fullAsset };
        return frames.map((frame) => {
          const hasPreprocessedPayload = Boolean(frame.has_preprocessed_payload);
          const detectionCount = detectionByAsset.get(asset.id) ?? 0;
          return {
            frameId: frame.id,
            runId: frame.run_id ?? assetWithDetails.run_id,
            assetId: asset.id,
            frameIndex: frame.frame_num ?? frame.frame_index,
            assetFilename: assetWithDetails.filename,
            kind: assetWithDetails.kind,
            collections: assetCollections(assetWithDetails),
            hasPreprocessedPayload,
            detectionCount,
            preprocessingState: hasPreprocessedPayload ? 'fully-preprocessed' : 'needs-preprocessed',
            detectionState: detectionCount > 0 ? 'fully-detected' : 'needs-detections'
          };
        });
      })
    );
    return nested.flat();
  }

  function frameRowsFromProcessingState(processingState: FrameProcessingState): FrameCatalogRow[] {
    return (processingState.frames ?? []).map((entry) => ({
      frameId: entry.frame_id,
      runId: entry.run_id,
      assetId: entry.asset_id ?? '',
      frameIndex: entry.frame_index ?? entry.frame_num,
      assetFilename: entry.asset_filename,
      kind: entry.kind,
      collections: entry.collections ?? [],
      hasPreprocessedPayload: Boolean(entry.has_preprocessed_payload),
      detectionCount: Number(entry.detection_count ?? 0),
      preprocessingState: entry.preprocessing_state ?? inferredFramePreprocessingState(entry),
      detectionState: entry.detection_state ?? inferredFrameDetectionState(entry)
    })).filter((frame) => Boolean(frame.frameId && frame.assetId));
  }

  function datasetsFromFrames(frames: FrameCatalogRow[]): Dataset[] {
    const byAsset = new Map<string, FrameCatalogRow[]>();
    for (const frame of frames) {
      byAsset.set(frame.assetId, [...(byAsset.get(frame.assetId) ?? []), frame]);
    }
    return [...byAsset.entries()].map(([assetId, assetFrames]) => {
      const first = assetFrames[0];
      const asset = {
        id: assetId,
        run_id: first?.runId,
        filename: first?.assetFilename,
        kind: first?.kind,
        collections: first?.collections ?? []
      } satisfies RawAsset;
      return {
        asset,
        frames: [],
        frameIds: assetFrames.map((frame) => frame.frameId),
        frameCount: assetFrames.length,
        preprocessedCount: assetFrames.filter((frame) => frame.hasPreprocessedPayload).length,
        detectionCount: assetFrames.reduce((total, frame) => total + frame.detectionCount, 0),
        collections: assetCollections(asset),
        preprocessingState: uniqueStrings(assetFrames.map((frame) => frame.preprocessingState)).join(', '),
        detectionState: uniqueStrings(assetFrames.map((frame) => frame.detectionState)).join(', ')
      };
    });
  }

  function inferredFramePreprocessingState(entry: NonNullable<FrameProcessingState['frames']>[number]): string {
    return entry.has_preprocessed_payload ? 'fully-preprocessed' : 'needs-preprocessed';
  }

  function inferredFrameDetectionState(entry: NonNullable<FrameProcessingState['frames']>[number]): string {
    const detectionCount = Number(entry.detection_count ?? 0);
    return detectionCount > 0 ? 'fully-detected' : 'needs-detections';
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

  function matchesFrame(frame: FrameCatalogRow, filters: FrameFilters): boolean {
    const assetIds = filters.assetIds;
    const collections = filters.collections;
    const preprocessStates = filters.preprocessStates;
    const detectionStates = filters.detectionStates;
    const preprocessingState = frame.preprocessingState;
    const detectionState = frame.detectionState;

    if (assetIds.size && !assetIds.has(frame.assetId)) return false;
    if (collections.size && !frame.collections.some((collection) => collections.has(collection))) return false;
    if (preprocessStates.size && (!preprocessingState || !preprocessStates.has(preprocessingState))) return false;
    if (mode === 'segmentation' && detectionStates.size && (!detectionState || !detectionStates.has(detectionState))) {
      return false;
    }
    return true;
  }

  function stateOptions(states: Array<string | undefined>): Array<{ id: string; label: string }> {
    return uniqueStrings(states).map((state) => ({ id: state, label: stateLabel(state) }));
  }

  function stateLabel(state: string): string {
    return state
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  function frameCountMap(group: FilterGroup, values: string[], filters: FrameFilters): Map<string, number> {
    return new Map(values.map((value) => [value, framesForOption(group, value, filters).length]));
  }

  function sumFrameCounts(counts: Map<string, number>): number {
    return [...counts.values()].reduce((total, count) => total + count, 0);
  }

  function countFor(counts: Map<string, number>, value: string): number {
    return counts.get(value) ?? 0;
  }

  function framesForOption(group: FilterGroup, value: string, filters: FrameFilters): FrameCatalogRow[] {
    const optionFilters: FrameFilters = {
      assetIds: group === 'asset' ? new Set([value]) : filters.assetIds,
      collections: group === 'collection' ? new Set([value]) : filters.collections,
      preprocessStates: group === 'preprocess' ? new Set([value]) : filters.preprocessStates,
      detectionStates: group === 'detection' ? new Set([value]) : filters.detectionStates
    };
    return frameRows.filter((frame) => matchesFrame(frame, optionFilters));
  }

  function boundedFrameBatchSize(): number {
    return Math.min(1000, Math.max(100, Math.round(Number(frameBatchSize) || 100)));
  }

  function frameBatches(frames: FrameCatalogRow[], batchSize: number): FrameBatch[] {
    const boundedBatchSize = Math.min(1000, Math.max(100, Math.round(Number(batchSize) || 100)));
    const grouped = new Map<string, FrameCatalogRow[]>();
    for (const frame of frames) {
      const key = `${frame.assetId}:${frame.runId ?? ''}`;
      grouped.set(key, [...(grouped.get(key) ?? []), frame]);
    }
    const batches: FrameBatch[] = [];
    for (const group of grouped.values()) {
      group.sort((a, b) => {
        const frameDelta = Number(a.frameIndex ?? 0) - Number(b.frameIndex ?? 0);
        return frameDelta || a.frameId.localeCompare(b.frameId);
      });
      for (let index = 0; index < group.length; index += boundedBatchSize) {
        const batch = group.slice(index, index + boundedBatchSize);
        if (!batch.length) continue;
        batches.push({
          assetId: batch[0].assetId,
          runId: batch[0].runId,
          frameIds: batch.map((frame) => frame.frameId)
        });
      }
    }
    return batches;
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
    const batches = frameBatches(filteredFrames, boundedFrameBatchSize());
    if (!client || batches.length === 0) return;
    queueing = true;
    message = null;
    error = null;
    let queued = 0;
    for (const batch of batches) {
      try {
        if (mode === 'preprocessing') {
          await client.queuePreprocessJob({
            asset_id: batch.assetId,
            run_id: batch.runId,
            frame_ids: batch.frameIds,
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
            asset_id: batch.assetId,
            run_id: batch.runId,
            frame_ids: batch.frameIds,
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
        error = `Queued ${queued}/${batches.length}. ${err instanceof Error ? err.message : String(err)}`;
        queueing = false;
        return;
      }
    }
    message = `Queued ${queued} ${mode === 'preprocessing' ? 'preprocessing' : 'segmentation'} batch job${queued === 1 ? '' : 's'} covering ${formatCount(prospectiveFrameCount)} frame${prospectiveFrameCount === 1 ? '' : 's'}.`;
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
      <div class="metric">
        <span>Queued batches</span>
        <strong>{formatCount(prospectiveBatchCount)}</strong>
      </div>
    </div>

    <div class="queue-filter-grid">
      <div class="filter-group">
        <div class="section-heading">
          <p class="eyebrow">Asset</p>
          <strong>Original file name</strong>
        </div>
        <div class="compact-select-list">
          <button class="wildcard-filter" class:active={selectedAssetIds.size === 0} type="button" on:click={() => clearGroup('asset')}>
            <span>Any asset</span>
            <small>{formatCount(assetAnyFrameCount)} frames</small>
          </button>
          {#each datasets as dataset}
            <button
              class:active={selectedAssetIds.has(dataset.asset.id)}
              type="button"
              on:click={() => toggleAsset(dataset.asset.id)}
            >
              <span>{dataset.asset.filename ?? dataset.asset.id}</span>
              <small>{formatCount(countFor(assetFrameCounts, dataset.asset.id))} frames</small>
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
          <button class="wildcard-filter" class:active={selectedCollections.size === 0} type="button" on:click={() => clearGroup('collection')}>
            <span>Any collection</span>
            <small>{formatCount(collectionAnyFrameCount)} frames</small>
          </button>
          {#each collectionOptions as collection}
            <button
              class:active={selectedCollections.has(collection)}
              type="button"
              on:click={() => toggleCollection(collection)}
            >
              <span>{collection}</span>
              <small>{formatCount(countFor(collectionFrameCounts, collection))} frames</small>
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
          <button class="wildcard-filter" class:active={selectedPreprocessStates.size === 0} type="button" on:click={() => clearGroup('preprocess')}>
            <span>Any preprocessing state</span>
            <small>{formatCount(preprocessAnyFrameCount)} frames</small>
          </button>
          {#each preprocessStateOptions as option}
            <button
              class:active={selectedPreprocessStates.has(option.id)}
              type="button"
              on:click={() => togglePreprocessState(option.id)}
            >
              <span>{option.label}</span>
              <small>{formatCount(countFor(preprocessFrameCounts, option.id))} frames</small>
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
            <button class="wildcard-filter" class:active={selectedDetectionStates.size === 0} type="button" on:click={() => clearGroup('detection')}>
              <span>Any detection state</span>
              <small>{formatCount(detectionAnyFrameCount)} frames</small>
            </button>
            {#each detectionStateOptions as option}
              <button
                class:active={selectedDetectionStates.has(option.id)}
                type="button"
                on:click={() => toggleDetectionState(option.id)}
              >
                <span>{option.label}</span>
                <small>{formatCount(countFor(detectionFrameCounts, option.id))} frames</small>
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </div>
    
    <p class="soft panel-bottom">{catalogStatus}</p>
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
        <strong>Frame batches</strong>
      </div>
      <div class="form-grid compact-grid">
        <label class="span-2">
          Batch size
          <input type="range" min="100" max="1000" step="50" bind:value={frameBatchSize} />
          <span class="range-value">{boundedFrameBatchSize()} frames per job</span>
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

    <div class="selected-frame-summary">
      <span>Currently selected</span>
      <strong>{formatCount(prospectiveFrameCount)} frame{prospectiveFrameCount === 1 ? '' : 's'}</strong>
      <small>{formatCount(prospectiveBatchCount)} batch job{prospectiveBatchCount === 1 ? '' : 's'}</small>
    </div>

    <button type="button" on:click={queueJobs} disabled={queueing || prospectiveBatchCount === 0}>
      {queueing ? 'Queueing' : actionLabel}
    </button>
    <p class="soft">
      {formatCount(prospectiveBatchCount)} batch job{prospectiveBatchCount === 1 ? '' : 's'} covering {formatCount(prospectiveFrameCount)} frame{prospectiveFrameCount === 1 ? '' : 's'}.
    </p>
    {#if message}<p class="success">{message}</p>{/if}
    {#if error}<p class="form-error">{error}</p>{/if}
  </section>
</div>
