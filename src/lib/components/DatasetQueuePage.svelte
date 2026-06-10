<script lang="ts">
  import { onMount } from 'svelte';
  import { getClient, session } from '$lib/stores/session';
  import type {
    AssetProcessingState,
    FrameProcessingState,
    FrameSummary,
    RawAsset,
    SegmentationCapabilities,
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
  let thresholdMethod = 'bounded_otsu_canny';
  let manualThreshold = 100;
  let thresholdingMaximumValue: number | null = 100;
  let boundedOtsuMinContrast = 50;
  let boundedOtsuMaxForegroundFraction = 0.5;
  let cannyEnabled = false;
  let cannyLowThreshold = 60;
  let cannyHighThreshold = 120;
  let cannyBlurKernel = 5;
  let thresholdMethods = [
    'manual',
    'otsu',
    'bounded_otsu',
    'bounded_otsu_canny',
    'canny',
    'adaptive_mean',
    'adaptive_gaussian',
    'percentile_background',
    'hysteresis',
    'sobel_edges',
    'auto'
  ];
  let maskAugmentationEnabled = true;
  let maskAugmentationSteps = new Set<string>(['dilate']);
  let maskAugmentationStepOptions = [
    'none',
    'dilate',
    'erode',
    'open',
    'close',
    'fill_holes',
    'remove_small_components',
    'clear_border'
  ];
  let dilateKernelW = 3;
  let dilateKernelH = 3;
  let dilateIterations = 1;
  let erodeKernelW = 3;
  let erodeKernelH = 3;
  let erodeIterations = 1;
  let openKernelW = 3;
  let openKernelH = 3;
  let openIterations = 1;
  let closeKernelW = 3;
  let closeKernelH = 3;
  let closeIterations = 1;
  let fillHoles = false;
  let removeSmallComponents = false;
  let minComponentArea = 1;
  let clearBorder = false;
  let adaptiveBlockSize = 31;
  let adaptiveC = 5;
  let percentileBackgroundPercentile = 50;
  let percentileMinContrast = 50;
  let hysteresisLowThreshold = 30;
  let hysteresisHighThreshold = 80;
  let hysteresisConnectivity = 8;
  let sobelPercentile = 90;
  let sobelThreshold: number | null = null;
  let sobelKernelSize = 3;
  let roiAssemblyMethod = 'connected_components';
  let roiAssemblyMethods = ['connected_components', 'contours'];
  let roiAssemblyConnectivity = 8;
  let minArea: number | null = null;
  let maxArea: number | null = null;
  let minPerimeter = 100;
  let maxPerimeter: number | null = null;
  let minWidth: number | null = null;
  let maxWidth: number | null = null;
  let minHeight: number | null = null;
  let maxHeight: number | null = null;
  let minWidthPlusHeight: number | null = null;
  let maxWidthPlusHeight: number | null = null;
  let padding = 100;
  let roiEncoding = 'zstd';
  let roiEncodingOptions = ['zstd', 'png', 'raw', 'auto'];
  let zstdMinBytes: number | null = null;
  let alwaysStoreMask = true;
  let storeRoiPayloadMinArea: number | null = null;
  let storeRoiPayloadMinWidth: number | null = null;
  let storeRoiPayloadMinHeight: number | null = null;
  let storeRoiPayloadMinWidthPlusHeight: number | null = null;

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
      const segmentationCapabilities = await client.segmentationOptions().catch(() => null);
      applyConfigDefaults(config, segmentationCapabilities);
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

  function applyConfigDefaults(config: SystemConfigResponse | null, capabilities: SegmentationCapabilities | null = null) {
    const thresholding = pipelineSection(config, capabilities, 'thresholding');
    const flatfield = capabilities?.defaults?.preprocessing ?? processingSection(config, 'flatfield');
    const preprocessing = pipelineSection(config, capabilities, 'preprocessing');
    const maskAugmentation = pipelineSection(config, capabilities, 'mask_augmentation');
    const roiAssembly = pipelineSection(config, capabilities, 'roi_assembly');
    const roiFilter = pipelineSection(config, capabilities, 'roi_filter');
    const roiRecording = pipelineSection(config, capabilities, 'roi_recording');
    const frameStorage = processingSection(config, 'frame_storage');

    thresholdMethods = capabilities?.supported?.threshold_methods?.length
      ? capabilities.supported.threshold_methods
      : thresholdMethods;
    maskAugmentationStepOptions = capabilities?.supported?.mask_augmentation_steps?.length
      ? capabilities.supported.mask_augmentation_steps
      : maskAugmentationStepOptions;
    roiAssemblyMethods = capabilities?.supported?.roi_assembly_methods?.length
      ? capabilities.supported.roi_assembly_methods
      : roiAssemblyMethods;
    roiEncodingOptions = capabilities?.supported?.roi_encoding_options?.length
      ? capabilities.supported.roi_encoding_options
      : roiEncodingOptions;

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

    thresholdMethod = stringDefault(thresholding, 'method', thresholdMethod);
    manualThreshold = numberDefault(thresholding, 'manual_threshold', manualThreshold);
    thresholdingMaximumValue = nullableNumberDefault(thresholding, 'thresholding_maximum_value', thresholdingMaximumValue);
    boundedOtsuMinContrast = numberDefault(thresholding, 'bounded_otsu_min_contrast', boundedOtsuMinContrast);
    boundedOtsuMaxForegroundFraction = numberDefault(thresholding, 'bounded_otsu_max_foreground_fraction', boundedOtsuMaxForegroundFraction);
    cannyEnabled = booleanDefault(thresholding, 'canny_enabled', cannyEnabled);
    cannyLowThreshold = numberDefault(thresholding, 'canny_low_threshold', cannyLowThreshold);
    cannyHighThreshold = numberDefault(thresholding, 'canny_high_threshold', cannyHighThreshold);
    cannyBlurKernel = numberDefault(thresholding, 'canny_blur_kernel', cannyBlurKernel);
    adaptiveBlockSize = numberDefault(thresholding, 'adaptive_block_size', adaptiveBlockSize);
    adaptiveC = numberDefault(thresholding, 'adaptive_c', adaptiveC);
    percentileBackgroundPercentile = numberDefault(thresholding, 'percentile_background_percentile', percentileBackgroundPercentile);
    percentileMinContrast = numberDefault(thresholding, 'percentile_min_contrast', percentileMinContrast);
    hysteresisLowThreshold = numberDefault(thresholding, 'hysteresis_low_threshold', hysteresisLowThreshold);
    hysteresisHighThreshold = numberDefault(thresholding, 'hysteresis_high_threshold', hysteresisHighThreshold);
    hysteresisConnectivity = numberDefault(thresholding, 'hysteresis_connectivity', hysteresisConnectivity);
    sobelPercentile = numberDefault(thresholding, 'sobel_percentile', sobelPercentile);
    sobelThreshold = nullableNumberDefault(thresholding, 'sobel_threshold', sobelThreshold);
    sobelKernelSize = numberDefault(thresholding, 'sobel_kernel_size', sobelKernelSize);

    maskAugmentationEnabled = booleanDefault(maskAugmentation, 'mask_augmentation_enabled', booleanDefault(maskAugmentation, 'enabled', maskAugmentationEnabled));
    maskAugmentationSteps = new Set(arrayDefault(maskAugmentation, 'mask_augmentation_steps', arrayDefault(maskAugmentation, 'steps', [...maskAugmentationSteps])));
    dilateKernelW = numberDefault(maskAugmentation, 'dilate_kernel_w', dilateKernelW);
    dilateKernelH = numberDefault(maskAugmentation, 'dilate_kernel_h', dilateKernelH);
    dilateIterations = numberDefault(maskAugmentation, 'dilate_iterations', dilateIterations);
    erodeKernelW = numberDefault(maskAugmentation, 'erode_kernel_w', erodeKernelW);
    erodeKernelH = numberDefault(maskAugmentation, 'erode_kernel_h', erodeKernelH);
    erodeIterations = numberDefault(maskAugmentation, 'erode_iterations', erodeIterations);
    openKernelW = numberDefault(maskAugmentation, 'open_kernel_w', openKernelW);
    openKernelH = numberDefault(maskAugmentation, 'open_kernel_h', openKernelH);
    openIterations = numberDefault(maskAugmentation, 'open_iterations', openIterations);
    closeKernelW = numberDefault(maskAugmentation, 'close_kernel_w', closeKernelW);
    closeKernelH = numberDefault(maskAugmentation, 'close_kernel_h', closeKernelH);
    closeIterations = numberDefault(maskAugmentation, 'close_iterations', closeIterations);
    fillHoles = booleanDefault(maskAugmentation, 'fill_holes', fillHoles);
    removeSmallComponents = booleanDefault(maskAugmentation, 'remove_small_components', removeSmallComponents);
    minComponentArea = numberDefault(maskAugmentation, 'min_component_area', minComponentArea);
    clearBorder = booleanDefault(maskAugmentation, 'clear_border', clearBorder);

    roiAssemblyMethod = stringDefault(roiAssembly, 'roi_assembly_method', stringDefault(roiAssembly, 'method', roiAssemblyMethod));
    roiAssemblyConnectivity = numberDefault(roiAssembly, 'roi_assembly_connectivity', numberDefault(roiAssembly, 'connectivity', roiAssemblyConnectivity));

    minArea = nullableNumberDefault(roiFilter, 'min_area', minArea);
    maxArea = nullableNumberDefault(roiFilter, 'max_area', maxArea);
    minPerimeter = numberDefault(roiFilter, 'min_perimeter', minPerimeter);
    maxPerimeter = nullableNumberDefault(roiFilter, 'max_perimeter', maxPerimeter);
    minWidth = nullableNumberDefault(roiFilter, 'min_width', minWidth);
    maxWidth = nullableNumberDefault(roiFilter, 'max_width', maxWidth);
    minHeight = nullableNumberDefault(roiFilter, 'min_height', minHeight);
    maxHeight = nullableNumberDefault(roiFilter, 'max_height', maxHeight);
    minWidthPlusHeight = nullableNumberDefault(roiFilter, 'min_width_plus_height', minWidthPlusHeight);
    maxWidthPlusHeight = nullableNumberDefault(roiFilter, 'max_width_plus_height', maxWidthPlusHeight);

    padding = numberDefault(roiRecording, 'padding', padding);
    roiEncoding = stringDefault(roiRecording, 'roi_encoding', roiEncoding);
    zstdMinBytes = nullableNumberDefault(roiRecording, 'zstd_min_bytes', zstdMinBytes);
    alwaysStoreMask = booleanDefault(roiRecording, 'always_store_mask', alwaysStoreMask);
    storeRoiPayloadMinArea = nullableNumberDefault(roiRecording, 'store_roi_payload_min_area', storeRoiPayloadMinArea);
    storeRoiPayloadMinWidth = nullableNumberDefault(roiRecording, 'store_roi_payload_min_width', storeRoiPayloadMinWidth);
    storeRoiPayloadMinHeight = nullableNumberDefault(roiRecording, 'store_roi_payload_min_height', storeRoiPayloadMinHeight);
    storeRoiPayloadMinWidthPlusHeight = nullableNumberDefault(roiRecording, 'store_roi_payload_min_width_plus_height', storeRoiPayloadMinWidthPlusHeight);
  }

  function pipelineSection(
    config: SystemConfigResponse | null,
    capabilities: SegmentationCapabilities | null,
    section: string
  ): Record<string, unknown> | undefined {
    return capabilities?.defaults?.[section] ?? processingSection(config, section as Parameters<typeof processingSection>[1]);
  }

  function arrayDefault(section: Record<string, unknown> | undefined, key: string, fallback: string[]): string[] {
    const value = section?.[key];
    return Array.isArray(value) ? value.map(String).filter(Boolean) : fallback;
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
            ...thresholdOptions(),
            ...maskAugmentationOptions(),
            ...roiAssemblyOptions(),
            ...roiFilterOptions(),
            ...roiRecordingOptions(),
            frame_payload_kind: framePayloadKind,
            apply_preprocessing: framePayloadKind === 'original' ? applyPreprocessing : false
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

  function thresholdOptions(): Record<string, unknown> {
    const method = thresholdMethod;
    const options: Record<string, unknown> = { threshold_method: method };
    if (method === 'manual') options.manual_threshold = manualThreshold;
    if (method === 'sobel_edges') options.sobel_threshold = sobelThreshold;
    if (usesThresholdMaximum(method)) options.thresholding_maximum_value = thresholdingMaximumValue;
    if (usesBoundedOtsu(method)) {
      options.bounded_otsu_min_contrast = boundedOtsuMinContrast;
      options.bounded_otsu_max_foreground_fraction = boundedOtsuMaxForegroundFraction;
    }
    if (method === 'bounded_otsu_canny') {
      options.canny_enabled = cannyEnabled;
    }
    if (usesCanny(method)) {
      options.canny_low_threshold = cannyLowThreshold;
      options.canny_high_threshold = cannyHighThreshold;
      options.canny_blur_kernel = cannyBlurKernel;
    }
    if (method === 'adaptive_mean' || method === 'adaptive_gaussian') {
      options.adaptive_block_size = adaptiveBlockSize;
      options.adaptive_c = adaptiveC;
    }
    if (method === 'percentile_background') {
      options.percentile_background_percentile = percentileBackgroundPercentile;
      options.percentile_min_contrast = percentileMinContrast;
    }
    if (method === 'hysteresis') {
      options.hysteresis_low_threshold = hysteresisLowThreshold;
      options.hysteresis_high_threshold = hysteresisHighThreshold;
      options.hysteresis_connectivity = hysteresisConnectivity;
    }
    if (method === 'sobel_edges') {
      options.sobel_percentile = sobelPercentile;
      options.sobel_kernel_size = sobelKernelSize;
    }
    return options;
  }

  function maskAugmentationOptions(): Record<string, unknown> {
    return {
      mask_augmentation_enabled: maskAugmentationEnabled,
      mask_augmentation_steps: maskAugmentationEnabled ? normalizedMaskSteps() : [],
      dilate_kernel_w: dilateKernelW,
      dilate_kernel_h: dilateKernelH,
      dilate_iterations: dilateIterations,
      erode_kernel_w: erodeKernelW,
      erode_kernel_h: erodeKernelH,
      erode_iterations: erodeIterations,
      open_kernel_w: openKernelW,
      open_kernel_h: openKernelH,
      open_iterations: openIterations,
      close_kernel_w: closeKernelW,
      close_kernel_h: closeKernelH,
      close_iterations: closeIterations,
      fill_holes: fillHoles,
      remove_small_components: removeSmallComponents,
      min_component_area: minComponentArea,
      clear_border: clearBorder
    };
  }

  function roiAssemblyOptions(): Record<string, unknown> {
    return {
      roi_assembly_method: roiAssemblyMethod,
      roi_assembly_connectivity: roiAssemblyConnectivity
    };
  }

  function roiFilterOptions(): Record<string, unknown> {
    return {
      min_area: minArea,
      max_area: maxArea,
      min_perimeter: minPerimeter,
      max_perimeter: maxPerimeter,
      min_width: minWidth,
      max_width: maxWidth,
      min_height: minHeight,
      max_height: maxHeight,
      min_width_plus_height: minWidthPlusHeight,
      max_width_plus_height: maxWidthPlusHeight
    };
  }

  function roiRecordingOptions(): Record<string, unknown> {
    return {
      padding,
      roi_encoding: roiEncoding,
      zstd_min_bytes: zstdMinBytes,
      always_store_mask: alwaysStoreMask,
      store_roi_payload_min_area: storeRoiPayloadMinArea,
      store_roi_payload_min_width: storeRoiPayloadMinWidth,
      store_roi_payload_min_height: storeRoiPayloadMinHeight,
      store_roi_payload_min_width_plus_height: storeRoiPayloadMinWidthPlusHeight
    };
  }

  function normalizedMaskSteps(): string[] {
    const steps = [...maskAugmentationSteps].filter((step) => step && step !== 'none');
    return steps.length ? steps : ['none'];
  }

  function toggleMaskStep(step: string) {
    if (step === 'none') {
      maskAugmentationSteps = new Set(maskAugmentationSteps.has('none') ? [] : ['none']);
      return;
    }
    const next = new Set(maskAugmentationSteps);
    next.delete('none');
    if (next.has(step)) next.delete(step);
    else next.add(step);
    maskAugmentationSteps = next;
  }

  function usesThresholdMaximum(method: string): boolean {
    return method === 'otsu' || usesBoundedOtsu(method);
  }

  function usesBoundedOtsu(method: string): boolean {
    return method === 'bounded_otsu' || method === 'bounded_otsu_canny';
  }

  function usesCanny(method: string): boolean {
    return method === 'canny' || method === 'bounded_otsu_canny';
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

    <details class="form-section collapsible-section" open>
      <summary class="section-heading">
        <span>
          <p class="eyebrow">Scope</p>
          <strong>Frame batches</strong>
        </span>
      </summary>
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
    </details>

    {#if mode === 'preprocessing'}
      <details class="form-section collapsible-section" open>
        <summary class="section-heading">
          <span>
            <p class="eyebrow">Correction</p>
            <strong>Background and flatfield</strong>
          </span>
        </summary>
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
      </details>

      <details class="form-section collapsible-section" open>
        <summary class="section-heading">
          <span>
            <p class="eyebrow">Candidate image</p>
            <strong>Crop, mask, and invert</strong>
          </span>
        </summary>
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
      </details>
    {:else}
      <details class="form-section collapsible-section" open>
        <summary class="section-heading">
          <span>
            <p class="eyebrow">Source</p>
            <strong>Frame payload</strong>
          </span>
        </summary>
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
      </details>

      <details class="form-section collapsible-section" open>
        <summary class="section-heading">
          <span>
            <p class="eyebrow">Threshold</p>
            <strong>Candidate ROIs</strong>
          </span>
        </summary>
        <label>
          Method
          <select bind:value={thresholdMethod}>
            {#each thresholdMethods as method}
              <option value={method}>{method}</option>
            {/each}
          </select>
        </label>
        {#if thresholdMethod === 'manual'}
          <label>
            Manual threshold
            <input type="number" min="0" max="255" bind:value={manualThreshold} />
          </label>
        {/if}
        {#if usesThresholdMaximum(thresholdMethod)}
          <label>
            Maximum threshold
            <input type="number" min="0" max="255" bind:value={thresholdingMaximumValue} placeholder="none" />
          </label>
        {/if}
        {#if usesBoundedOtsu(thresholdMethod)}
          <label>
            Minimum contrast
            <input type="range" min="0" max="255" step="1" bind:value={boundedOtsuMinContrast} />
            <span class="range-value">{boundedOtsuMinContrast}</span>
          </label>
          <label>
            Max foreground fraction
            <input type="range" min="0" max="1" step="0.01" bind:value={boundedOtsuMaxForegroundFraction} />
            <span class="range-value">{boundedOtsuMaxForegroundFraction.toFixed(2)}</span>
          </label>
        {/if}
        {#if thresholdMethod === 'bounded_otsu_canny'}
          <label class="check-row">
            <input type="checkbox" bind:checked={cannyEnabled} />
            Add Canny edges
          </label>
        {/if}
        {#if usesCanny(thresholdMethod)}
          <div class="form-grid compact-grid">
            <label>
              Canny low
              <input type="number" min="0" max="255" bind:value={cannyLowThreshold} />
            </label>
            <label>
              Canny high
              <input type="number" min="0" max="255" bind:value={cannyHighThreshold} />
            </label>
            <label>
              Blur kernel
              <input type="number" min="1" step="2" bind:value={cannyBlurKernel} />
            </label>
          </div>
        {/if}
        {#if thresholdMethod === 'adaptive_mean' || thresholdMethod === 'adaptive_gaussian'}
          <div class="form-grid compact-grid">
            <label>
              Block size
              <input type="number" min="3" step="2" bind:value={adaptiveBlockSize} />
            </label>
            <label>
              C offset
              <input type="number" bind:value={adaptiveC} />
            </label>
          </div>
        {/if}
        {#if thresholdMethod === 'percentile_background'}
          <label>
            Background percentile
            <input type="range" min="0" max="100" step="1" bind:value={percentileBackgroundPercentile} />
            <span class="range-value">{percentileBackgroundPercentile}</span>
          </label>
          <label>
            Minimum contrast
            <input type="range" min="0" max="255" step="1" bind:value={percentileMinContrast} />
            <span class="range-value">{percentileMinContrast}</span>
          </label>
        {/if}
        {#if thresholdMethod === 'hysteresis'}
          <div class="form-grid compact-grid">
            <label>
              Low threshold
              <input type="number" min="0" max="255" bind:value={hysteresisLowThreshold} />
            </label>
            <label>
              High threshold
              <input type="number" min="0" max="255" bind:value={hysteresisHighThreshold} />
            </label>
            <label>
              Connectivity
              <select bind:value={hysteresisConnectivity}>
                <option value={4}>4</option>
                <option value={8}>8</option>
              </select>
            </label>
          </div>
        {/if}
        {#if thresholdMethod === 'sobel_edges'}
          <div class="form-grid compact-grid">
            <label>
              Sobel threshold
              <input type="number" bind:value={sobelThreshold} placeholder="percentile" />
            </label>
            <label>
              Percentile
              <input type="range" min="0" max="100" step="1" bind:value={sobelPercentile} />
              <span class="range-value">{sobelPercentile}</span>
            </label>
            <label>
              Kernel size
              <input type="number" min="1" step="2" bind:value={sobelKernelSize} />
            </label>
          </div>
        {/if}
      </details>

      <details class="form-section collapsible-section" open>
        <summary class="section-heading">
          <span>
            <p class="eyebrow">Mask</p>
            <strong>Augment threshold mask</strong>
          </span>
        </summary>
        <label class="check-row">
          <input type="checkbox" bind:checked={maskAugmentationEnabled} />
          Enable mask augmentation
        </label>
        {#if maskAugmentationEnabled}
          <div class="toggle-list">
            {#each maskAugmentationStepOptions as step}
              <button
                class:active={maskAugmentationSteps.has(step)}
                type="button"
                on:click={() => toggleMaskStep(step)}
              >
                {step}
              </button>
            {/each}
          </div>
          <div class="form-grid compact-grid">
            <label>
              Dilate width
              <input type="number" min="1" bind:value={dilateKernelW} />
            </label>
            <label>
              Dilate height
              <input type="number" min="1" bind:value={dilateKernelH} />
            </label>
            <label>
              Dilate iterations
              <input type="number" min="1" bind:value={dilateIterations} />
            </label>
            <label>
              Erode width
              <input type="number" min="1" bind:value={erodeKernelW} />
            </label>
            <label>
              Erode height
              <input type="number" min="1" bind:value={erodeKernelH} />
            </label>
            <label>
              Erode iterations
              <input type="number" min="1" bind:value={erodeIterations} />
            </label>
          </div>
          <details class="control-details">
            <summary>Additional mask controls</summary>
            <div class="form-grid compact-grid">
              <label>
                Open width
                <input type="number" min="1" bind:value={openKernelW} />
              </label>
              <label>
                Open height
                <input type="number" min="1" bind:value={openKernelH} />
              </label>
              <label>
                Open iterations
                <input type="number" min="1" bind:value={openIterations} />
              </label>
              <label>
                Close width
                <input type="number" min="1" bind:value={closeKernelW} />
              </label>
              <label>
                Close height
                <input type="number" min="1" bind:value={closeKernelH} />
              </label>
              <label>
                Close iterations
                <input type="number" min="1" bind:value={closeIterations} />
              </label>
              <label>
                Min component area
                <input type="number" min="0" bind:value={minComponentArea} />
              </label>
            </div>
            <label class="check-row">
              <input type="checkbox" bind:checked={fillHoles} />
              Fill holes
            </label>
            <label class="check-row">
              <input type="checkbox" bind:checked={removeSmallComponents} />
              Remove small components
            </label>
            <label class="check-row">
              <input type="checkbox" bind:checked={clearBorder} />
              Clear border components
            </label>
          </details>
        {/if}
      </details>

      <details class="form-section collapsible-section" open>
        <summary class="section-heading">
          <span>
            <p class="eyebrow">Assemble</p>
            <strong>Candidate ROIs</strong>
          </span>
        </summary>
        <div class="form-grid compact-grid">
          <label>
            Assembly method
            <select bind:value={roiAssemblyMethod}>
              {#each roiAssemblyMethods as method}
                <option value={method}>{method}</option>
              {/each}
            </select>
          </label>
          <label>
            Connectivity
            <select bind:value={roiAssemblyConnectivity}>
              <option value={4}>4</option>
              <option value={8}>8</option>
            </select>
          </label>
        </div>
      </details>

      <details class="form-section collapsible-section" open>
        <summary class="section-heading">
          <span>
            <p class="eyebrow">Filter</p>
            <strong>Candidate geometry</strong>
          </span>
        </summary>
        <div class="form-grid compact-grid">
          <label>
            Min area
            <input type="number" min="0" bind:value={minArea} placeholder="none" />
          </label>
          <label>
            Max area
            <input type="number" min="0" bind:value={maxArea} placeholder="none" />
          </label>
          <label>
            Min perimeter
            <input type="number" min="0" bind:value={minPerimeter} />
          </label>
          <label>
            Max perimeter
            <input type="number" min="0" bind:value={maxPerimeter} placeholder="none" />
          </label>
          <label>
            Min width
            <input type="number" min="0" bind:value={minWidth} placeholder="none" />
          </label>
          <label>
            Max width
            <input type="number" min="0" bind:value={maxWidth} placeholder="none" />
          </label>
          <label>
            Min height
            <input type="number" min="0" bind:value={minHeight} placeholder="none" />
          </label>
          <label>
            Max height
            <input type="number" min="0" bind:value={maxHeight} placeholder="none" />
          </label>
          <label>
            Min width + height
            <input type="number" min="0" bind:value={minWidthPlusHeight} placeholder="none" />
          </label>
          <label>
            Max width + height
            <input type="number" min="0" bind:value={maxWidthPlusHeight} placeholder="none" />
          </label>
        </div>
      </details>

      <details class="form-section collapsible-section" open>
        <summary class="section-heading">
          <span>
            <p class="eyebrow">Record</p>
            <strong>ROI payloads</strong>
          </span>
        </summary>
        <label>
          Padding
          <input type="range" min="0" max="500" step="1" bind:value={padding} />
          <span class="range-value">{padding}</span>
        </label>
        <label>
          ROI encoding
          <select bind:value={roiEncoding}>
            {#each roiEncodingOptions as encoding}
              <option value={encoding}>{encoding}</option>
            {/each}
          </select>
        </label>
        <label>
          zstd min bytes
          <input type="number" min="0" bind:value={zstdMinBytes} placeholder="default" />
        </label>
        <label class="check-row">
          <input type="checkbox" bind:checked={alwaysStoreMask} />
          Always store mask
        </label>
        <details class="control-details">
          <summary>Payload storage thresholds</summary>
          <div class="form-grid compact-grid">
            <label>
              Min area
              <input type="number" min="0" bind:value={storeRoiPayloadMinArea} placeholder="none" />
            </label>
            <label>
              Min width
              <input type="number" min="0" bind:value={storeRoiPayloadMinWidth} placeholder="none" />
            </label>
            <label>
              Min height
              <input type="number" min="0" bind:value={storeRoiPayloadMinHeight} placeholder="none" />
            </label>
            <label>
              Min width + height
              <input type="number" min="0" bind:value={storeRoiPayloadMinWidthPlusHeight} placeholder="none" />
            </label>
          </div>
        </details>
      </details>
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
