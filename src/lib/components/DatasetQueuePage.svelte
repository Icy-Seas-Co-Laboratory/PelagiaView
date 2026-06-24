<script lang="ts">
  import { onMount } from 'svelte';
  import QueueStatusSummary from '$lib/components/QueueStatusSummary.svelte';
  import { getClient, session } from '$lib/stores/session';
  import type {
    AssetProcessingState,
    DetectionSummary,
    FrameProcessingState,
    FrameSummary,
    RawAsset,
    RoiRefinementCapabilities,
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
  import type { ProcessingPreset, ProcessingSettings } from '$lib/processing/settings';
  import {
    liveProcessingPreset as createLiveProcessingPreset,
    PROCESSING_PRESET_APPLIED_EVENT,
    pruneProcessingSettings
  } from '$lib/processing/settings';
  import {
    booleanPreference,
    nullableNumberPreference as nullablePreferenceNumber,
    numberPreference,
    preferenceKey,
    readPreferences,
    stringArrayPreference,
    stringPreference,
    stringSetPreference,
    writePreferences
  } from '$lib/utils/preferences';

  type QueueMode = 'preprocessing' | 'segmentation' | 'roi_refinement';

  export let mode: QueueMode;

  type Dataset = {
    asset: RawAsset;
    frames: FrameSummary[];
    frameIds: string[];
    frameCount: number;
    preprocessedCount: number;
    detectionCount: number;
    refinedCandidateDetectionCount: number;
    unrefinedDetectionCount: number;
    refinedDetectionCount: number;
    collections: string[];
    preprocessingState?: string;
    detectionState?: string;
    refinementState?: string;
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
    refinedCandidateDetectionCount: number;
    unrefinedDetectionCount: number;
    refinedDetectionCount: number;
    preprocessingState: string;
    detectionState: string;
    refinementState: string;
  };

  type FrameBatch = {
    assetId: string;
    runId?: string | null;
    frameIds: string[];
  };

  type DetectionBatch = {
    assetId: string;
    runId?: string | null;
    firstFrameId: string;
    detectionIds: string[];
  };

  type FilterGroup = 'asset' | 'collection' | 'preprocess' | 'detection' | 'refinement';

  type FrameFilters = {
    assetIds: Set<string>;
    collections: Set<string>;
    preprocessStates: Set<string>;
    detectionStates: Set<string>;
    refinementStates: Set<string>;
  };

  let datasets: Dataset[] = [];
  let frameRows: FrameCatalogRow[] = [];
  let collectionOptions: string[] = [];
  let selectedAssetIds = new Set<string>();
  let selectedCollections = new Set<string>();
  let selectedPreprocessStates = new Set<string>();
  let selectedDetectionStates = new Set<string>();
  let selectedRefinementStates = new Set<string>();
  let loading = true;
  let queueing = false;
  let message: string | null = null;
  let error: string | null = null;
  let catalogStatus = 'Catalog not loaded yet.';
  let lastCatalogKey = '';
  let preferencesReady = false;
  let submittedJobIds: string[] = [];
  const liveProcessingPresetKey = preferenceKey('processing-preset:live');

  let frameBatchSize = mode === 'roi_refinement' ? 2500 : 100;
  let lastBatchMode: QueueMode | null = null;
  let priority: number | null = null;

  let flatfieldCorrection = false;
  let flatfieldQ = 0.95;
  let flatfieldAxis = 0;
  let flatfieldMinFieldValue = 1;
  let flatfieldMaxFieldValue: number | null = 255;
  let backgroundCorrection = false;
  let backgroundMinFieldValue = 1;
  let backgroundMaxFieldValue: number | null = 255;
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

  let refinementModelKind = 'identity';
  let refinementModelRef = '';
  let refinementModelRunDir = '';
  let refinementModelArtifact = 'auto';
  let refinementModelKinds = ['identity', 'keras_artifact', 'oracle_builder_unet'];
  let refinementModelRefs: string[] = [];
  let refinementModelArtifacts = ['auto', 'keras', 'savedmodel'];
  let refinementTileSize = 256;
  let refinementOverlapFraction = 0.25;
  let refinementModelBatchSize: number | null = null;
  let refinementOutputThreshold = 0.5;
  let refinementAllowFrameExpansion = true;
  let refinementMaxIterations = 3;
  let refinementExpansionPixels: number | null = null;
  let refinementEdgeTouchMargin = 1;
  let refinementEncoding = 'auto';
  let refinementEncodingOptions = ['auto', 'zstd', 'png', 'raw'];
  let refinementStore = true;
  let refinementDryRun = false;

  type DatasetQueuePreferences = {
    selectedAssetIds: string[];
    selectedCollections: string[];
    selectedPreprocessStates: string[];
    selectedDetectionStates: string[];
    selectedRefinementStates: string[];
    frameBatchSize: number;
    priority: number | null;
    flatfieldCorrection: boolean;
    flatfieldQ: number;
    flatfieldAxis: number;
    flatfieldMinFieldValue: number;
    flatfieldMaxFieldValue: number | null;
    backgroundCorrection: boolean;
    backgroundMinFieldValue: number;
    backgroundMaxFieldValue: number | null;
    applyMask: boolean;
    cropEnabled: boolean;
    cropX: number | null;
    cropY: number | null;
    cropW: number | null;
    cropH: number | null;
    invertIntensity: boolean;
    preprocessingEncoding: string;
    framePayloadKind: 'original' | 'preprocessed';
    applyPreprocessing: boolean;
    thresholdMethod: string;
    manualThreshold: number;
    thresholdingMaximumValue: number | null;
    boundedOtsuMinContrast: number;
    boundedOtsuMaxForegroundFraction: number;
    cannyEnabled: boolean;
    cannyLowThreshold: number;
    cannyHighThreshold: number;
    cannyBlurKernel: number;
    adaptiveBlockSize: number;
    adaptiveC: number;
    percentileBackgroundPercentile: number;
    percentileMinContrast: number;
    hysteresisLowThreshold: number;
    hysteresisHighThreshold: number;
    hysteresisConnectivity: number;
    sobelPercentile: number;
    sobelThreshold: number | null;
    sobelKernelSize: number;
    maskAugmentationEnabled: boolean;
    maskAugmentationSteps: string[];
    dilateKernelW: number;
    dilateKernelH: number;
    dilateIterations: number;
    erodeKernelW: number;
    erodeKernelH: number;
    erodeIterations: number;
    openKernelW: number;
    openKernelH: number;
    openIterations: number;
    closeKernelW: number;
    closeKernelH: number;
    closeIterations: number;
    fillHoles: boolean;
    removeSmallComponents: boolean;
    minComponentArea: number;
    clearBorder: boolean;
    roiAssemblyMethod: string;
    roiAssemblyConnectivity: number;
    minArea: number | null;
    maxArea: number | null;
    minPerimeter: number;
    maxPerimeter: number | null;
    minWidth: number | null;
    maxWidth: number | null;
    minHeight: number | null;
    maxHeight: number | null;
    minWidthPlusHeight: number | null;
    maxWidthPlusHeight: number | null;
    padding: number;
    roiEncoding: string;
    zstdMinBytes: number | null;
    alwaysStoreMask: boolean;
    storeRoiPayloadMinArea: number | null;
    storeRoiPayloadMinWidth: number | null;
    storeRoiPayloadMinHeight: number | null;
    storeRoiPayloadMinWidthPlusHeight: number | null;
    refinementModelKind: string;
    refinementModelRef: string;
    refinementModelRunDir: string;
    refinementModelArtifact: string;
    refinementTileSize: number;
    refinementOverlapFraction: number;
    refinementModelBatchSize: number | null;
    refinementOutputThreshold: number;
    refinementAllowFrameExpansion: boolean;
    refinementMaxIterations: number;
    refinementExpansionPixels: number | null;
    refinementEdgeTouchMargin: number;
    refinementEncoding: string;
    refinementStore: boolean;
    refinementDryRun: boolean;
  };

  $: title =
    mode === 'preprocessing'
      ? 'Queue preprocessing'
      : mode === 'segmentation'
        ? 'Queue segmentation'
        : 'Queue ROI refinement';
  $: eyebrow =
    mode === 'preprocessing'
      ? 'Preprocessing'
      : mode === 'segmentation'
        ? 'Segmentation'
        : 'ROI refinement';
  $: actionLabel =
    mode === 'preprocessing'
      ? 'Queue preprocessing jobs'
      : mode === 'segmentation'
        ? 'Queue segmentation jobs'
        : 'Queue refinement jobs';
  $: if (mode !== lastBatchMode) {
    preferencesReady = false;
    lastBatchMode = mode;
    frameBatchSize = defaultBatchSize();
  }
  $: datasetQueuePreferenceSnapshot = buildPreferenceSnapshot();
  $: if (preferencesReady) writePreferences(datasetQueuePreferenceKey(), datasetQueuePreferenceSnapshot);
  $: liveProcessingPreset = createLiveProcessingPreset(captureProcessingSettings());
  $: if (preferencesReady) writePreferences(liveProcessingPresetKey, liveProcessingPreset);
  $: activeFilters = {
    assetIds: selectedAssetIds,
    collections: selectedCollections,
    preprocessStates: selectedPreprocessStates,
    detectionStates: selectedDetectionStates,
    refinementStates: selectedRefinementStates
  };
  $: matchingFrames = frameRows.filter((frame) => matchesFrame(frame, activeFilters));
  $: filteredFrames = matchingFrames;
  $: filteredDatasets = datasets.filter((dataset) => filteredFrames.some((frame) => frame.assetId === dataset.asset.id));
  $: preprocessStateOptions = stateOptions(frameRows.map((frame) => frame.preprocessingState));
  $: detectionStateOptions = stateOptions(frameRows.map((frame) => frame.detectionState));
  $: refinementStateOptions = [
    { id: 'refined', label: 'Refined' },
    { id: 'unrefined', label: 'Unrefined' }
  ];
  $: assetFrameCounts = frameCountMap('asset', datasets.map((dataset) => dataset.asset.id), activeFilters);
  $: collectionFrameCounts = frameCountMap('collection', collectionOptions, activeFilters);
  $: preprocessFrameCounts = frameCountMap('preprocess', preprocessStateOptions.map((option) => option.id), activeFilters);
  $: detectionFrameCounts = frameCountMap('detection', detectionStateOptions.map((option) => option.id), activeFilters);
  $: refinementRoiCounts = refinementRoiCountMap(refinementStateOptions.map((option) => option.id), activeFilters);
  $: assetAnyFrameCount = sumFrameCounts(assetFrameCounts);
  $: collectionAnyFrameCount = sumFrameCounts(collectionFrameCounts);
  $: preprocessAnyFrameCount = sumFrameCounts(preprocessFrameCounts);
  $: detectionAnyFrameCount = sumFrameCounts(detectionFrameCounts);
  $: refinementAnyRoiCount = prospectiveDetectionCount;
  $: prospectiveFrameCount = filteredFrames.length;
  $: prospectivePreprocessedCount = filteredFrames.filter((frame) => frame.hasPreprocessedPayload).length;
  $: prospectiveDetectionCount = filteredFrames.reduce((total, frame) => total + frame.detectionCount, 0);
  $: prospectiveRefinedCandidateCount = filteredFrames.reduce((total, frame) => total + frame.refinedCandidateDetectionCount, 0);
  $: prospectiveUnrefinedDetectionCount = filteredFrames.reduce((total, frame) => total + frame.unrefinedDetectionCount, 0);
  $: prospectiveRefinedDetectionCount = filteredFrames.reduce((total, frame) => total + frame.refinedDetectionCount, 0);
  $: prospectiveRefinementCandidateCount = refinementCandidateCountForFrames(filteredFrames);
  $: prospectiveQueueItemCount = mode === 'roi_refinement' ? prospectiveRefinementCandidateCount : prospectiveFrameCount;
  $: missingPreprocessedFrameCount = filteredFrames.filter((frame) => !frame.hasPreprocessedPayload).length;
  $: prospectiveBatchCount =
    mode === 'roi_refinement'
      ? estimatedDetectionBatchCount(filteredFrames, frameBatchSize)
      : frameBatches(filteredFrames, frameBatchSize).length;
  $: queueItemLabel = mode === 'roi_refinement' ? 'ROI' : 'frame';
  $: queueItemLabelPlural = mode === 'roi_refinement' ? 'ROIs' : 'frames';
  $: queueStage = mode;
  $: queueStatusTitle =
    mode === 'preprocessing'
      ? 'Preprocessing queue'
      : mode === 'segmentation'
        ? 'Candidate ROI queue'
        : 'ROI refinement queue';
  $: preprocessedSourceWarning =
    mode === 'segmentation' &&
    framePayloadKind === 'preprocessed' &&
    missingPreprocessedFrameCount > 0;
  $: queueBlocked = preprocessedSourceWarning;

  $: catalogKey = `${$session.connected ? $session.baseUrl : 'disconnected'}:${mode}`;
  $: if ($session.connected && catalogKey !== lastCatalogKey) {
    lastCatalogKey = catalogKey;
    void loadCatalog();
  }

  onMount(() => {
    window.addEventListener(PROCESSING_PRESET_APPLIED_EVENT, handleHeaderProcessingPresetApplied);
    applyStoredLiveProcessingPreset();
    if ($session.connected) void loadCatalog();
    return () => {
      window.removeEventListener(PROCESSING_PRESET_APPLIED_EVENT, handleHeaderProcessingPresetApplied);
    };
  });

  function datasetQueuePreferenceKey(): string {
    return preferenceKey(`dataset-queue:${mode}`);
  }

  function buildPreferenceSnapshot(): DatasetQueuePreferences {
    return {
      selectedAssetIds: [...selectedAssetIds],
      selectedCollections: [...selectedCollections],
      selectedPreprocessStates: [...selectedPreprocessStates],
      selectedDetectionStates: [...selectedDetectionStates],
      selectedRefinementStates: [...selectedRefinementStates],
      frameBatchSize,
      priority,
      flatfieldCorrection,
      flatfieldQ,
      flatfieldAxis,
      flatfieldMinFieldValue,
      flatfieldMaxFieldValue,
      backgroundCorrection,
      backgroundMinFieldValue,
      backgroundMaxFieldValue,
      applyMask,
      cropEnabled,
      cropX,
      cropY,
      cropW,
      cropH,
      invertIntensity,
      preprocessingEncoding,
      framePayloadKind,
      applyPreprocessing,
      thresholdMethod,
      manualThreshold,
      thresholdingMaximumValue,
      boundedOtsuMinContrast,
      boundedOtsuMaxForegroundFraction,
      cannyEnabled,
      cannyLowThreshold,
      cannyHighThreshold,
      cannyBlurKernel,
      adaptiveBlockSize,
      adaptiveC,
      percentileBackgroundPercentile,
      percentileMinContrast,
      hysteresisLowThreshold,
      hysteresisHighThreshold,
      hysteresisConnectivity,
      sobelPercentile,
      sobelThreshold,
      sobelKernelSize,
      maskAugmentationEnabled,
      maskAugmentationSteps: [...maskAugmentationSteps],
      dilateKernelW,
      dilateKernelH,
      dilateIterations,
      erodeKernelW,
      erodeKernelH,
      erodeIterations,
      openKernelW,
      openKernelH,
      openIterations,
      closeKernelW,
      closeKernelH,
      closeIterations,
      fillHoles,
      removeSmallComponents,
      minComponentArea,
      clearBorder,
      roiAssemblyMethod,
      roiAssemblyConnectivity,
      minArea,
      maxArea,
      minPerimeter,
      maxPerimeter,
      minWidth,
      maxWidth,
      minHeight,
      maxHeight,
      minWidthPlusHeight,
      maxWidthPlusHeight,
      padding,
      roiEncoding,
      zstdMinBytes,
      alwaysStoreMask,
      storeRoiPayloadMinArea,
      storeRoiPayloadMinWidth,
      storeRoiPayloadMinHeight,
      storeRoiPayloadMinWidthPlusHeight,
      refinementModelKind,
      refinementModelRef,
      refinementModelRunDir,
      refinementModelArtifact,
      refinementTileSize,
      refinementOverlapFraction,
      refinementModelBatchSize,
      refinementOutputThreshold,
      refinementAllowFrameExpansion,
      refinementMaxIterations,
      refinementExpansionPixels,
      refinementEdgeTouchMargin,
      refinementEncoding,
      refinementStore,
      refinementDryRun
    };
  }

  function restorePreferences() {
    const preferences = readPreferences<DatasetQueuePreferences>(datasetQueuePreferenceKey());
    if (!preferences) return;
    selectedAssetIds = stringSetPreference(preferences.selectedAssetIds, selectedAssetIds);
    selectedCollections = stringSetPreference(preferences.selectedCollections, selectedCollections);
    selectedPreprocessStates = stringSetPreference(preferences.selectedPreprocessStates, selectedPreprocessStates);
    selectedDetectionStates = stringSetPreference(preferences.selectedDetectionStates, selectedDetectionStates);
    selectedRefinementStates = stringSetPreference(preferences.selectedRefinementStates, selectedRefinementStates);
    frameBatchSize = boundedBatchSize(numberPreference(preferences.frameBatchSize, frameBatchSize));
    priority = nullablePreferenceNumber(preferences.priority, priority);
    flatfieldCorrection = booleanPreference(preferences.flatfieldCorrection, flatfieldCorrection);
    flatfieldQ = numberPreference(preferences.flatfieldQ, flatfieldQ);
    flatfieldAxis = numberPreference(preferences.flatfieldAxis, flatfieldAxis);
    flatfieldMinFieldValue = numberPreference(preferences.flatfieldMinFieldValue, flatfieldMinFieldValue);
    flatfieldMaxFieldValue = nullablePreferenceNumber(preferences.flatfieldMaxFieldValue, flatfieldMaxFieldValue);
    backgroundCorrection = booleanPreference(preferences.backgroundCorrection, backgroundCorrection);
    backgroundMinFieldValue = numberPreference(preferences.backgroundMinFieldValue, backgroundMinFieldValue);
    backgroundMaxFieldValue = nullablePreferenceNumber(preferences.backgroundMaxFieldValue, backgroundMaxFieldValue);
    enforcePreprocessingCorrectionMode();
    applyMask = booleanPreference(preferences.applyMask, applyMask);
    cropEnabled = booleanPreference(preferences.cropEnabled, cropEnabled);
    cropX = nullablePreferenceNumber(preferences.cropX, cropX);
    cropY = nullablePreferenceNumber(preferences.cropY, cropY);
    cropW = nullablePreferenceNumber(preferences.cropW, cropW);
    cropH = nullablePreferenceNumber(preferences.cropH, cropH);
    invertIntensity = booleanPreference(preferences.invertIntensity, invertIntensity);
    preprocessingEncoding = stringPreference(preferences.preprocessingEncoding, preprocessingEncoding);
    framePayloadKind = framePayloadKindPreference(preferences.framePayloadKind, framePayloadKind);
    applyPreprocessing = booleanPreference(preferences.applyPreprocessing, applyPreprocessing);
    thresholdMethod = stringPreference(preferences.thresholdMethod, thresholdMethod);
    manualThreshold = numberPreference(preferences.manualThreshold, manualThreshold);
    thresholdingMaximumValue = nullablePreferenceNumber(preferences.thresholdingMaximumValue, thresholdingMaximumValue);
    boundedOtsuMinContrast = numberPreference(preferences.boundedOtsuMinContrast, boundedOtsuMinContrast);
    boundedOtsuMaxForegroundFraction = numberPreference(preferences.boundedOtsuMaxForegroundFraction, boundedOtsuMaxForegroundFraction);
    cannyEnabled = booleanPreference(preferences.cannyEnabled, cannyEnabled);
    cannyLowThreshold = numberPreference(preferences.cannyLowThreshold, cannyLowThreshold);
    cannyHighThreshold = numberPreference(preferences.cannyHighThreshold, cannyHighThreshold);
    cannyBlurKernel = numberPreference(preferences.cannyBlurKernel, cannyBlurKernel);
    adaptiveBlockSize = numberPreference(preferences.adaptiveBlockSize, adaptiveBlockSize);
    adaptiveC = numberPreference(preferences.adaptiveC, adaptiveC);
    percentileBackgroundPercentile = numberPreference(preferences.percentileBackgroundPercentile, percentileBackgroundPercentile);
    percentileMinContrast = numberPreference(preferences.percentileMinContrast, percentileMinContrast);
    hysteresisLowThreshold = numberPreference(preferences.hysteresisLowThreshold, hysteresisLowThreshold);
    hysteresisHighThreshold = numberPreference(preferences.hysteresisHighThreshold, hysteresisHighThreshold);
    hysteresisConnectivity = numberPreference(preferences.hysteresisConnectivity, hysteresisConnectivity);
    sobelPercentile = numberPreference(preferences.sobelPercentile, sobelPercentile);
    sobelThreshold = nullablePreferenceNumber(preferences.sobelThreshold, sobelThreshold);
    sobelKernelSize = numberPreference(preferences.sobelKernelSize, sobelKernelSize);
    maskAugmentationEnabled = booleanPreference(preferences.maskAugmentationEnabled, maskAugmentationEnabled);
    maskAugmentationSteps = new Set(stringArrayPreference(preferences.maskAugmentationSteps, [...maskAugmentationSteps]));
    dilateKernelW = numberPreference(preferences.dilateKernelW, dilateKernelW);
    dilateKernelH = numberPreference(preferences.dilateKernelH, dilateKernelH);
    dilateIterations = numberPreference(preferences.dilateIterations, dilateIterations);
    erodeKernelW = numberPreference(preferences.erodeKernelW, erodeKernelW);
    erodeKernelH = numberPreference(preferences.erodeKernelH, erodeKernelH);
    erodeIterations = numberPreference(preferences.erodeIterations, erodeIterations);
    openKernelW = numberPreference(preferences.openKernelW, openKernelW);
    openKernelH = numberPreference(preferences.openKernelH, openKernelH);
    openIterations = numberPreference(preferences.openIterations, openIterations);
    closeKernelW = numberPreference(preferences.closeKernelW, closeKernelW);
    closeKernelH = numberPreference(preferences.closeKernelH, closeKernelH);
    closeIterations = numberPreference(preferences.closeIterations, closeIterations);
    fillHoles = booleanPreference(preferences.fillHoles, fillHoles);
    removeSmallComponents = booleanPreference(preferences.removeSmallComponents, removeSmallComponents);
    minComponentArea = numberPreference(preferences.minComponentArea, minComponentArea);
    clearBorder = booleanPreference(preferences.clearBorder, clearBorder);
    roiAssemblyMethod = stringPreference(preferences.roiAssemblyMethod, roiAssemblyMethod);
    roiAssemblyConnectivity = numberPreference(preferences.roiAssemblyConnectivity, roiAssemblyConnectivity);
    minArea = nullablePreferenceNumber(preferences.minArea, minArea);
    maxArea = nullablePreferenceNumber(preferences.maxArea, maxArea);
    minPerimeter = numberPreference(preferences.minPerimeter, minPerimeter);
    maxPerimeter = nullablePreferenceNumber(preferences.maxPerimeter, maxPerimeter);
    minWidth = nullablePreferenceNumber(preferences.minWidth, minWidth);
    maxWidth = nullablePreferenceNumber(preferences.maxWidth, maxWidth);
    minHeight = nullablePreferenceNumber(preferences.minHeight, minHeight);
    maxHeight = nullablePreferenceNumber(preferences.maxHeight, maxHeight);
    minWidthPlusHeight = nullablePreferenceNumber(preferences.minWidthPlusHeight, minWidthPlusHeight);
    maxWidthPlusHeight = nullablePreferenceNumber(preferences.maxWidthPlusHeight, maxWidthPlusHeight);
    padding = numberPreference(preferences.padding, padding);
    roiEncoding = stringPreference(preferences.roiEncoding, roiEncoding);
    zstdMinBytes = nullablePreferenceNumber(preferences.zstdMinBytes, zstdMinBytes);
    alwaysStoreMask = booleanPreference(preferences.alwaysStoreMask, alwaysStoreMask);
    storeRoiPayloadMinArea = nullablePreferenceNumber(preferences.storeRoiPayloadMinArea, storeRoiPayloadMinArea);
    storeRoiPayloadMinWidth = nullablePreferenceNumber(preferences.storeRoiPayloadMinWidth, storeRoiPayloadMinWidth);
    storeRoiPayloadMinHeight = nullablePreferenceNumber(preferences.storeRoiPayloadMinHeight, storeRoiPayloadMinHeight);
    storeRoiPayloadMinWidthPlusHeight = nullablePreferenceNumber(preferences.storeRoiPayloadMinWidthPlusHeight, storeRoiPayloadMinWidthPlusHeight);
    refinementModelKind = stringPreference(preferences.refinementModelKind, refinementModelKind);
    refinementModelRef = stringPreference(preferences.refinementModelRef, refinementModelRef);
    refinementModelRunDir = stringPreference(preferences.refinementModelRunDir, refinementModelRunDir);
    refinementModelArtifact = stringPreference(preferences.refinementModelArtifact, refinementModelArtifact);
    refinementTileSize = numberPreference(preferences.refinementTileSize, refinementTileSize);
    refinementOverlapFraction = numberPreference(preferences.refinementOverlapFraction, refinementOverlapFraction);
    refinementModelBatchSize = nullablePreferenceNumber(preferences.refinementModelBatchSize, refinementModelBatchSize);
    refinementOutputThreshold = numberPreference(preferences.refinementOutputThreshold, refinementOutputThreshold);
    refinementAllowFrameExpansion = booleanPreference(preferences.refinementAllowFrameExpansion, refinementAllowFrameExpansion);
    refinementMaxIterations = numberPreference(preferences.refinementMaxIterations, refinementMaxIterations);
    refinementExpansionPixels = nullablePreferenceNumber(preferences.refinementExpansionPixels, refinementExpansionPixels);
    refinementEdgeTouchMargin = numberPreference(preferences.refinementEdgeTouchMargin, refinementEdgeTouchMargin);
    refinementEncoding = stringPreference(preferences.refinementEncoding, refinementEncoding);
    refinementStore = booleanPreference(preferences.refinementStore, refinementStore);
    refinementDryRun = booleanPreference(preferences.refinementDryRun, refinementDryRun);
  }

  function framePayloadKindPreference(value: unknown, fallback: 'original' | 'preprocessed'): 'original' | 'preprocessed' {
    return value === 'original' || value === 'preprocessed' ? value : fallback;
  }

  function captureProcessingSettings(): ProcessingSettings {
    const {
      selectedAssetIds: _selectedAssetIds,
      selectedCollections: _selectedCollections,
      selectedPreprocessStates: _selectedPreprocessStates,
      selectedDetectionStates: _selectedDetectionStates,
      selectedRefinementStates: _selectedRefinementStates,
      frameBatchSize: _frameBatchSize,
      priority: _priority,
      ...settings
    } = buildPreferenceSnapshot();
    return pruneProcessingSettings(settings);
  }

  function applyProcessingSettings(settings: ProcessingSettings) {
    if ('preprocessingEncoding' in settings) preprocessingEncoding = stringPreference(settings.preprocessingEncoding, preprocessingEncoding);
    if ('framePayloadKind' in settings) framePayloadKind = framePayloadKindPreference(settings.framePayloadKind, framePayloadKind);
    if ('applyPreprocessing' in settings) applyPreprocessing = booleanPreference(settings.applyPreprocessing, applyPreprocessing);
    if ('thresholdMethod' in settings) thresholdMethod = stringPreference(settings.thresholdMethod, thresholdMethod);
    if ('manualThreshold' in settings) manualThreshold = numberPreference(settings.manualThreshold, manualThreshold);
    if ('thresholdingMaximumValue' in settings) thresholdingMaximumValue = nullablePreferenceNumber(settings.thresholdingMaximumValue, thresholdingMaximumValue);
    if ('boundedOtsuMinContrast' in settings) boundedOtsuMinContrast = numberPreference(settings.boundedOtsuMinContrast, boundedOtsuMinContrast);
    if ('boundedOtsuMaxForegroundFraction' in settings) boundedOtsuMaxForegroundFraction = numberPreference(settings.boundedOtsuMaxForegroundFraction, boundedOtsuMaxForegroundFraction);
    if ('cannyEnabled' in settings) cannyEnabled = booleanPreference(settings.cannyEnabled, cannyEnabled);
    if ('cannyLowThreshold' in settings) cannyLowThreshold = numberPreference(settings.cannyLowThreshold, cannyLowThreshold);
    if ('cannyHighThreshold' in settings) cannyHighThreshold = numberPreference(settings.cannyHighThreshold, cannyHighThreshold);
    if ('cannyBlurKernel' in settings) cannyBlurKernel = numberPreference(settings.cannyBlurKernel, cannyBlurKernel);
    if ('adaptiveBlockSize' in settings) adaptiveBlockSize = numberPreference(settings.adaptiveBlockSize, adaptiveBlockSize);
    if ('adaptiveC' in settings) adaptiveC = numberPreference(settings.adaptiveC, adaptiveC);
    if ('percentileBackgroundPercentile' in settings) percentileBackgroundPercentile = numberPreference(settings.percentileBackgroundPercentile, percentileBackgroundPercentile);
    if ('percentileMinContrast' in settings) percentileMinContrast = numberPreference(settings.percentileMinContrast, percentileMinContrast);
    if ('hysteresisLowThreshold' in settings) hysteresisLowThreshold = numberPreference(settings.hysteresisLowThreshold, hysteresisLowThreshold);
    if ('hysteresisHighThreshold' in settings) hysteresisHighThreshold = numberPreference(settings.hysteresisHighThreshold, hysteresisHighThreshold);
    if ('hysteresisConnectivity' in settings) hysteresisConnectivity = numberPreference(settings.hysteresisConnectivity, hysteresisConnectivity);
    if ('sobelPercentile' in settings) sobelPercentile = numberPreference(settings.sobelPercentile, sobelPercentile);
    if ('sobelThreshold' in settings) sobelThreshold = nullablePreferenceNumber(settings.sobelThreshold, sobelThreshold);
    if ('sobelKernelSize' in settings) sobelKernelSize = numberPreference(settings.sobelKernelSize, sobelKernelSize);
    if ('maskAugmentationEnabled' in settings) maskAugmentationEnabled = booleanPreference(settings.maskAugmentationEnabled, maskAugmentationEnabled);
    if ('maskAugmentationSteps' in settings) maskAugmentationSteps = new Set(stringArrayPreference(settings.maskAugmentationSteps, [...maskAugmentationSteps]));
    if ('dilateKernelW' in settings) dilateKernelW = numberPreference(settings.dilateKernelW, dilateKernelW);
    if ('dilateKernelH' in settings) dilateKernelH = numberPreference(settings.dilateKernelH, dilateKernelH);
    if ('dilateIterations' in settings) dilateIterations = numberPreference(settings.dilateIterations, dilateIterations);
    if ('erodeKernelW' in settings) erodeKernelW = numberPreference(settings.erodeKernelW, erodeKernelW);
    if ('erodeKernelH' in settings) erodeKernelH = numberPreference(settings.erodeKernelH, erodeKernelH);
    if ('erodeIterations' in settings) erodeIterations = numberPreference(settings.erodeIterations, erodeIterations);
    if ('openKernelW' in settings) openKernelW = numberPreference(settings.openKernelW, openKernelW);
    if ('openKernelH' in settings) openKernelH = numberPreference(settings.openKernelH, openKernelH);
    if ('openIterations' in settings) openIterations = numberPreference(settings.openIterations, openIterations);
    if ('closeKernelW' in settings) closeKernelW = numberPreference(settings.closeKernelW, closeKernelW);
    if ('closeKernelH' in settings) closeKernelH = numberPreference(settings.closeKernelH, closeKernelH);
    if ('closeIterations' in settings) closeIterations = numberPreference(settings.closeIterations, closeIterations);
    if ('fillHoles' in settings) fillHoles = booleanPreference(settings.fillHoles, fillHoles);
    if ('removeSmallComponents' in settings) removeSmallComponents = booleanPreference(settings.removeSmallComponents, removeSmallComponents);
    if ('minComponentArea' in settings) minComponentArea = numberPreference(settings.minComponentArea, minComponentArea);
    if ('clearBorder' in settings) clearBorder = booleanPreference(settings.clearBorder, clearBorder);
    if ('roiAssemblyMethod' in settings) roiAssemblyMethod = stringPreference(settings.roiAssemblyMethod, roiAssemblyMethod);
    if ('roiAssemblyConnectivity' in settings) roiAssemblyConnectivity = numberPreference(settings.roiAssemblyConnectivity, roiAssemblyConnectivity);
    if ('backgroundCorrection' in settings) backgroundCorrection = booleanPreference(settings.backgroundCorrection, backgroundCorrection);
    if ('backgroundMinFieldValue' in settings) backgroundMinFieldValue = numberPreference(settings.backgroundMinFieldValue, backgroundMinFieldValue);
    if ('backgroundMaxFieldValue' in settings) backgroundMaxFieldValue = nullablePreferenceNumber(settings.backgroundMaxFieldValue, backgroundMaxFieldValue);
    if ('flatfieldCorrection' in settings) flatfieldCorrection = booleanPreference(settings.flatfieldCorrection, flatfieldCorrection);
    if ('flatfieldQ' in settings) flatfieldQ = numberPreference(settings.flatfieldQ, flatfieldQ);
    if ('flatfieldAxis' in settings) flatfieldAxis = numberPreference(settings.flatfieldAxis, flatfieldAxis);
    if ('flatfieldMinFieldValue' in settings) flatfieldMinFieldValue = numberPreference(settings.flatfieldMinFieldValue, flatfieldMinFieldValue);
    if ('flatfieldMaxFieldValue' in settings) flatfieldMaxFieldValue = nullablePreferenceNumber(settings.flatfieldMaxFieldValue, flatfieldMaxFieldValue);
    enforcePreprocessingCorrectionMode();
    if ('applyMask' in settings) applyMask = booleanPreference(settings.applyMask, applyMask);
    if ('cropEnabled' in settings) cropEnabled = booleanPreference(settings.cropEnabled, cropEnabled);
    if ('cropX' in settings) cropX = nullablePreferenceNumber(settings.cropX, cropX);
    if ('cropY' in settings) cropY = nullablePreferenceNumber(settings.cropY, cropY);
    if ('cropW' in settings) cropW = nullablePreferenceNumber(settings.cropW, cropW);
    if ('cropH' in settings) cropH = nullablePreferenceNumber(settings.cropH, cropH);
    if ('invertIntensity' in settings) invertIntensity = booleanPreference(settings.invertIntensity, invertIntensity);
    if ('minArea' in settings) minArea = nullablePreferenceNumber(settings.minArea, minArea);
    if ('maxArea' in settings) maxArea = nullablePreferenceNumber(settings.maxArea, maxArea);
    if ('minPerimeter' in settings) minPerimeter = numberPreference(settings.minPerimeter, minPerimeter);
    if ('maxPerimeter' in settings) maxPerimeter = nullablePreferenceNumber(settings.maxPerimeter, maxPerimeter);
    if ('minWidth' in settings) minWidth = nullablePreferenceNumber(settings.minWidth, minWidth);
    if ('maxWidth' in settings) maxWidth = nullablePreferenceNumber(settings.maxWidth, maxWidth);
    if ('minHeight' in settings) minHeight = nullablePreferenceNumber(settings.minHeight, minHeight);
    if ('maxHeight' in settings) maxHeight = nullablePreferenceNumber(settings.maxHeight, maxHeight);
    if ('minWidthPlusHeight' in settings) minWidthPlusHeight = nullablePreferenceNumber(settings.minWidthPlusHeight, minWidthPlusHeight);
    if ('maxWidthPlusHeight' in settings) maxWidthPlusHeight = nullablePreferenceNumber(settings.maxWidthPlusHeight, maxWidthPlusHeight);
    if ('padding' in settings) padding = numberPreference(settings.padding, padding);
    if ('roiEncoding' in settings) roiEncoding = stringPreference(settings.roiEncoding, roiEncoding);
    if ('zstdMinBytes' in settings) zstdMinBytes = nullablePreferenceNumber(settings.zstdMinBytes, zstdMinBytes);
    if ('alwaysStoreMask' in settings) alwaysStoreMask = booleanPreference(settings.alwaysStoreMask, alwaysStoreMask);
    if ('storeRoiPayloadMinArea' in settings) storeRoiPayloadMinArea = nullablePreferenceNumber(settings.storeRoiPayloadMinArea, storeRoiPayloadMinArea);
    if ('storeRoiPayloadMinWidth' in settings) storeRoiPayloadMinWidth = nullablePreferenceNumber(settings.storeRoiPayloadMinWidth, storeRoiPayloadMinWidth);
    if ('storeRoiPayloadMinHeight' in settings) storeRoiPayloadMinHeight = nullablePreferenceNumber(settings.storeRoiPayloadMinHeight, storeRoiPayloadMinHeight);
    if ('storeRoiPayloadMinWidthPlusHeight' in settings) storeRoiPayloadMinWidthPlusHeight = nullablePreferenceNumber(settings.storeRoiPayloadMinWidthPlusHeight, storeRoiPayloadMinWidthPlusHeight);
    if ('refinementModelKind' in settings) refinementModelKind = stringPreference(settings.refinementModelKind, refinementModelKind);
    if ('refinementModelRef' in settings) refinementModelRef = stringPreference(settings.refinementModelRef, refinementModelRef);
    if ('refinementModelRunDir' in settings) refinementModelRunDir = stringPreference(settings.refinementModelRunDir, refinementModelRunDir);
    if ('refinementModelArtifact' in settings) refinementModelArtifact = stringPreference(settings.refinementModelArtifact, refinementModelArtifact);
    if ('refinementTileSize' in settings) refinementTileSize = numberPreference(settings.refinementTileSize, refinementTileSize);
    if ('refinementOverlapFraction' in settings) refinementOverlapFraction = numberPreference(settings.refinementOverlapFraction, refinementOverlapFraction);
    if ('refinementModelBatchSize' in settings) refinementModelBatchSize = nullablePreferenceNumber(settings.refinementModelBatchSize, refinementModelBatchSize);
    if ('refinementOutputThreshold' in settings) refinementOutputThreshold = numberPreference(settings.refinementOutputThreshold, refinementOutputThreshold);
    if ('refinementAllowFrameExpansion' in settings) refinementAllowFrameExpansion = booleanPreference(settings.refinementAllowFrameExpansion, refinementAllowFrameExpansion);
    if ('refinementMaxIterations' in settings) refinementMaxIterations = numberPreference(settings.refinementMaxIterations, refinementMaxIterations);
    if ('refinementExpansionPixels' in settings) refinementExpansionPixels = nullablePreferenceNumber(settings.refinementExpansionPixels, refinementExpansionPixels);
    if ('refinementEdgeTouchMargin' in settings) refinementEdgeTouchMargin = numberPreference(settings.refinementEdgeTouchMargin, refinementEdgeTouchMargin);
    if ('refinementEncoding' in settings) refinementEncoding = stringPreference(settings.refinementEncoding, refinementEncoding);
    if ('refinementStore' in settings) refinementStore = booleanPreference(settings.refinementStore, refinementStore);
    if ('refinementDryRun' in settings) refinementDryRun = booleanPreference(settings.refinementDryRun, refinementDryRun);
  }

  function setBackgroundCorrection(enabled: boolean) {
    backgroundCorrection = enabled;
    if (enabled) flatfieldCorrection = false;
  }

  function setFlatfieldCorrection(enabled: boolean) {
    flatfieldCorrection = enabled;
    if (enabled) backgroundCorrection = false;
  }

  function enforcePreprocessingCorrectionMode() {
    if (backgroundCorrection && flatfieldCorrection) flatfieldCorrection = false;
  }

  function applyStoredLiveProcessingPreset() {
    const preset = readPreferences<ProcessingPreset>(liveProcessingPresetKey);
    if (preset?.source === 'live' && preset.settings) {
      applyProcessingSettings(preset.settings);
    }
  }

  function handleHeaderProcessingPresetApplied(event: Event) {
    const preset = (event as CustomEvent<ProcessingPreset>).detail;
    if (!preset?.settings) return;
    applyProcessingSettings(preset.settings);
  }

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
      const [segmentationCapabilities, roiRefinementCapabilities] = await Promise.all([
        client.segmentationOptions().catch(() => null),
        client.roiRefinementOptions().catch(() => null)
      ]);
      preferencesReady = false;
      applyConfigDefaults(config, segmentationCapabilities, roiRefinementCapabilities);
      restorePreferences();
      applyStoredLiveProcessingPreset();
      frameRows = processingState ?? (await loadCatalogFallback());
      datasets = datasetsFromFrames(frameRows);
      catalogStatus = processingState
        ? `Loaded ${formatCount(frameRows.length)} frames from processing state.`
        : `Loaded ${formatCount(frameRows.length)} frames from fallback catalog.`;
      collectionOptions = uniqueStrings([
        ...collections.map((collection) => collection.collection),
        ...frameRows.flatMap((frame) => frame.collections)
      ]);
      preferencesReady = true;
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
          const refinedCandidateDetectionCount = 0;
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
            refinedCandidateDetectionCount,
            unrefinedDetectionCount: detectionCount,
            refinedDetectionCount: 0,
            preprocessingState: hasPreprocessedPayload ? 'fully-preprocessed' : 'needs-preprocessed',
            detectionState: detectionCount > 0 ? 'fully-detected' : 'needs-detections',
            refinementState: detectionCount > 0 ? 'needs-refinement' : 'no-detections'
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
      refinedCandidateDetectionCount: Number(entry.refined_candidate_detection_count ?? 0),
      unrefinedDetectionCount: Number(
        entry.unrefined_detection_count ?? Math.max(0, Number(entry.detection_count ?? 0) - Number(entry.refined_candidate_detection_count ?? 0))
      ),
      refinedDetectionCount: Number(entry.refined_detection_count ?? entry.refined_candidate_detection_count ?? 0),
      preprocessingState: entry.preprocessing_state ?? inferredFramePreprocessingState(entry),
      detectionState: entry.detection_state ?? inferredFrameDetectionState(entry),
      refinementState: entry.refinement_state ?? inferredFrameRefinementState(entry)
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
        refinedCandidateDetectionCount: assetFrames.reduce((total, frame) => total + frame.refinedCandidateDetectionCount, 0),
        unrefinedDetectionCount: assetFrames.reduce((total, frame) => total + frame.unrefinedDetectionCount, 0),
        refinedDetectionCount: assetFrames.reduce((total, frame) => total + frame.refinedDetectionCount, 0),
        collections: assetCollections(asset),
        preprocessingState: uniqueStrings(assetFrames.map((frame) => frame.preprocessingState)).join(', '),
        detectionState: uniqueStrings(assetFrames.map((frame) => frame.detectionState)).join(', '),
        refinementState: uniqueStrings(assetFrames.map((frame) => frame.refinementState)).join(', ')
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

  function inferredFrameRefinementState(entry: NonNullable<FrameProcessingState['frames']>[number]): string {
    const detectionCount = Number(entry.detection_count ?? 0);
    const refinedCount = Number(entry.refined_candidate_detection_count ?? 0);
    if (detectionCount <= 0) return 'no-detections';
    if (refinedCount <= 0) return 'needs-refinement';
    if (refinedCount >= detectionCount) return 'fully-refined';
    return 'partially-refined';
  }

  function applyConfigDefaults(
    config: SystemConfigResponse | null,
    capabilities: SegmentationCapabilities | null = null,
    refinementCapabilities: RoiRefinementCapabilities | null = null
  ) {
    const thresholding = pipelineSection(config, capabilities, 'thresholding');
    const flatfield = capabilities?.defaults?.preprocessing ?? processingSection(config, 'flatfield');
    const preprocessing = pipelineSection(config, capabilities, 'preprocessing');
    const maskAugmentation = pipelineSection(config, capabilities, 'mask_augmentation');
    const roiAssembly = pipelineSection(config, capabilities, 'roi_assembly');
    const roiFilter = pipelineSection(config, capabilities, 'roi_filter');
    const roiRecording = pipelineSection(config, capabilities, 'roi_recording');
    const roiRefinement = refinementCapabilities?.defaults?.roi_refinement ?? processingSection(config, 'roi_refinement');
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
    refinementModelKinds = refinementCapabilities?.supported?.model_kinds?.length
      ? refinementCapabilities.supported.model_kinds
      : refinementModelKinds;
    refinementModelRefs = refinementCapabilities?.supported?.model_refs ?? refinementModelRefs;
    refinementEncodingOptions = refinementCapabilities?.supported?.roi_encoding_options?.length
      ? refinementCapabilities.supported.roi_encoding_options
      : refinementEncodingOptions;
    refinementModelArtifacts = modelArtifactOptions(refinementCapabilities);

    flatfieldCorrection = booleanDefault(flatfield, 'flatfield_correction', flatfieldCorrection);
    flatfieldQ = numberDefault(flatfield, 'flatfield_q', flatfieldQ);
    flatfieldAxis = numberDefault(flatfield, 'flatfield_axis', flatfieldAxis);
    flatfieldMinFieldValue = numberDefault(flatfield, 'flatfield_min_field_value', flatfieldMinFieldValue);
    flatfieldMaxFieldValue = nullableNumberDefault(flatfield, 'flatfield_max_field_value', flatfieldMaxFieldValue);
    backgroundCorrection = booleanDefault(preprocessing, 'background_correction', backgroundCorrection);
    backgroundMinFieldValue = numberDefault(preprocessing, 'background_min_field_value', backgroundMinFieldValue);
    backgroundMaxFieldValue = nullableNumberDefault(preprocessing, 'background_max_field_value', backgroundMaxFieldValue);
    enforcePreprocessingCorrectionMode();
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

    refinementModelKind = stringDefault(roiRefinement, 'model_kind', refinementModelKind);
    refinementModelRef = stringDefault(roiRefinement, 'model_ref', refinementModelRef);
    refinementModelRunDir = stringDefault(roiRefinement, 'model_run_dir', refinementModelRunDir);
    refinementModelArtifact = stringDefault(roiRefinement, 'model_artifact', refinementModelArtifact);
    refinementTileSize = numberDefault(roiRefinement, 'tile_size', refinementTileSize);
    refinementOverlapFraction = numberDefault(roiRefinement, 'overlap_fraction', refinementOverlapFraction);
    refinementMaxIterations = numberDefault(roiRefinement, 'max_iterations', refinementMaxIterations);
    refinementExpansionPixels = nullableNumberDefault(roiRefinement, 'expansion_pixels', refinementExpansionPixels);
    refinementEdgeTouchMargin = numberDefault(roiRefinement, 'edge_touch_margin', refinementEdgeTouchMargin);
    refinementOutputThreshold = numberDefault(roiRefinement, 'output_threshold', refinementOutputThreshold);
    refinementModelBatchSize = nullableNumberDefault(roiRefinement, 'batch_size', refinementModelBatchSize);
    refinementEncoding = stringDefault(roiRefinement, 'encoding', refinementEncoding);
  }

  function modelArtifactOptions(capabilities: RoiRefinementCapabilities | null): string[] {
    const fieldOptions = capabilities?.fields?.model_selection
      ?.find((field) => field.key === 'model_artifact')
      ?.options;
    if (Array.isArray(fieldOptions)) return fieldOptions.map(String).filter(Boolean);
    return refinementModelArtifacts;
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
    const refinementStates = filters.refinementStates;
    const preprocessingState = frame.preprocessingState;
    const detectionState = frame.detectionState;

    if (assetIds.size && !assetIds.has(frame.assetId)) return false;
    if (collections.size && !frame.collections.some((collection) => collections.has(collection))) return false;
    if (mode === 'segmentation' && !frame.hasPreprocessedPayload) return false;
    if (mode === 'roi_refinement' && detectionState !== 'fully-detected') return false;
    if (mode === 'preprocessing' && preprocessStates.size && (!preprocessingState || !preprocessStates.has(preprocessingState))) return false;
    if (mode === 'segmentation' && detectionStates.size && (!detectionState || !detectionStates.has(detectionState))) {
      return false;
    }
    if (mode === 'roi_refinement' && refinementStates.size && !frameMatchesRefinementStates(frame, refinementStates)) {
      return false;
    }
    return true;
  }

  function frameMatchesRefinementStates(frame: FrameCatalogRow, states: Set<string>): boolean {
    if (states.has('refined') && frame.refinedCandidateDetectionCount > 0) return true;
    if (states.has('unrefined') && frame.unrefinedDetectionCount > 0) return true;
    return false;
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

  function refinementRoiCountMap(values: string[], filters: FrameFilters): Map<string, number> {
    return new Map(
      values.map((value) => {
        const frames = framesForOption('refinement', value, filters);
        const count = frames.reduce((total, frame) => {
          if (value === 'refined') return total + frame.refinedCandidateDetectionCount;
          if (value === 'unrefined') return total + frame.unrefinedDetectionCount;
          return total;
        }, 0);
        return [value, count];
      })
    );
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
      detectionStates: group === 'detection' ? new Set([value]) : filters.detectionStates,
      refinementStates: group === 'refinement' ? new Set([value]) : filters.refinementStates
    };
    return frameRows.filter((frame) => matchesFrame(frame, optionFilters));
  }

  function refinementCandidateCountForFrames(frames: FrameCatalogRow[]): number {
    return frames.reduce((total, frame) => total + refinementCandidateCountForFrame(frame), 0);
  }

  function refinementCandidateCountForFrame(frame: FrameCatalogRow): number {
    if (selectedRefinementStates.size > 0) {
      return (
        (selectedRefinementStates.has('refined') ? frame.refinedCandidateDetectionCount : 0) +
        (selectedRefinementStates.has('unrefined') ? frame.unrefinedDetectionCount : 0)
      );
    }
    return frame.detectionCount;
  }

  function boundedFrameBatchSize(): number {
    const minimum = batchSizeMin();
    const maximum = batchSizeMax();
    return Math.min(maximum, Math.max(minimum, Math.round(Number(frameBatchSize) || defaultBatchSize())));
  }

  function batchSizeMin(): number {
    return mode === 'roi_refinement' ? 100 : 20;
  }

  function batchSizeMax(): number {
    return mode === 'roi_refinement' ? 10000 : 1000;
  }

  function batchSizeStep(): number {
    return mode === 'roi_refinement' ? 100 : 20;
  }

  function defaultBatchSize(): number {
    return mode === 'roi_refinement' ? 2500 : 100;
  }

  function boundedBatchSize(batchSize: number): number {
    const minimum = batchSizeMin();
    const maximum = batchSizeMax();
    return Math.min(maximum, Math.max(minimum, Math.round(Number(batchSize) || defaultBatchSize())));
  }

  function compareFrameId(a: FrameCatalogRow, b: FrameCatalogRow): number {
    return a.frameId.localeCompare(b.frameId);
  }

  function frameBatches(frames: FrameCatalogRow[], batchSize: number): FrameBatch[] {
    const resolvedBatchSize = boundedBatchSize(batchSize);
    const grouped = new Map<string, FrameCatalogRow[]>();
    for (const frame of frames) {
      const key = `${frame.assetId}:${frame.runId ?? ''}`;
      grouped.set(key, [...(grouped.get(key) ?? []), frame]);
    }
    const batches: FrameBatch[] = [];
    for (const group of grouped.values()) {
      group.sort(compareFrameId);
      for (let index = 0; index < group.length; index += resolvedBatchSize) {
        const batch = group.slice(index, index + resolvedBatchSize);
        if (!batch.length) continue;
        batches.push({
          assetId: batch[0].assetId,
          runId: batch[0].runId,
          frameIds: batch.map((frame) => frame.frameId)
        });
      }
    }
    return batches.sort((a, b) => (a.frameIds[0] ?? '').localeCompare(b.frameIds[0] ?? ''));
  }

  function estimatedDetectionBatchCount(frames: FrameCatalogRow[], batchSize: number): number {
    const resolvedBatchSize = boundedBatchSize(batchSize);
    const groupedCounts = new Map<string, number>();
    for (const frame of [...frames].sort(compareFrameId)) {
      const key = `${frame.assetId}:${frame.runId ?? ''}`;
      groupedCounts.set(key, (groupedCounts.get(key) ?? 0) + refinementCandidateCountForFrame(frame));
    }
    return [...groupedCounts.values()].reduce(
      (total, count) => total + (count > 0 ? Math.ceil(count / resolvedBatchSize) : 0),
      0
    );
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

  function toggleRefinementState(state: string) {
    selectedRefinementStates = toggled(selectedRefinementStates, state);
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
    if (group === 'refinement') selectedRefinementStates = new Set();
  }

  async function queueJobs() {
    const client = getClient();
    if (!client) return;
    queueing = true;
    message = null;
    error = null;
    let queued = 0;
    const nextJobIds: string[] = [];

    if (queueBlocked) {
      error =
        `Cannot queue segmentation from preprocessed frames because ${formatCount(missingPreprocessedFrameCount)} selected frame${missingPreprocessedFrameCount === 1 ? '' : 's'} lack preprocessed payloads.`;
      queueing = false;
      return;
    }

    if (mode === 'roi_refinement') {
      const batches = await detectionBatchesForFrames(client, filteredFrames, boundedFrameBatchSize()).catch((err) => {
        error = err instanceof Error ? err.message : String(err);
        return [] as DetectionBatch[];
      });
      if (!batches.length) {
        if (!error) error = 'No candidate ROI detections matched the current frame filters.';
        queueing = false;
        return;
      }
      for (const batch of batches) {
        try {
          const response = await client.queueRoiRefinementJob({
            asset_id: batch.assetId,
            run_id: batch.runId,
            detection_ids: batch.detectionIds,
            priority,
            ...roiRefinementOptions()
          });
          if (response.job?.id) nextJobIds.push(response.job.id);
          queued += 1;
        } catch (err) {
          error = `Queued ${queued}/${batches.length}. ${err instanceof Error ? err.message : String(err)}`;
          queueing = false;
          return;
        }
      }
      message = `Queued ${queued} ROI refinement batch job${queued === 1 ? '' : 's'} covering ${formatCount(
        batches.reduce((total, batch) => total + batch.detectionIds.length, 0)
      )} ROI${batches.reduce((total, batch) => total + batch.detectionIds.length, 0) === 1 ? '' : 's'}.`;
      submittedJobIds = [...nextJobIds, ...submittedJobIds].slice(0, 100);
      queueing = false;
      return;
    }

    const batches = frameBatches(filteredFrames, boundedFrameBatchSize());
    if (batches.length === 0) {
      queueing = false;
      return;
    }
    for (const batch of batches) {
      try {
        if (mode === 'preprocessing') {
          const response = await client.queuePreprocessJob({
            asset_id: batch.assetId,
            run_id: batch.runId,
            frame_ids: batch.frameIds,
            priority,
            flatfield_correction: backgroundCorrection ? false : flatfieldCorrection,
            flatfield_q: !backgroundCorrection && flatfieldCorrection ? flatfieldQ : undefined,
            flatfield_axis: !backgroundCorrection && flatfieldCorrection ? flatfieldAxis : undefined,
            flatfield_min_field_value: !backgroundCorrection && flatfieldCorrection ? flatfieldMinFieldValue : undefined,
            flatfield_max_field_value: !backgroundCorrection && flatfieldCorrection ? flatfieldMaxFieldValue : undefined,
            background_correction: backgroundCorrection,
            background_min_field_value: backgroundCorrection ? backgroundMinFieldValue : undefined,
            background_max_field_value: backgroundCorrection ? backgroundMaxFieldValue : undefined,
            apply_mask: applyMask,
            crop_enabled: cropEnabled,
            crop_x: cropEnabled ? cropX : undefined,
            crop_y: cropEnabled ? cropY : undefined,
            crop_w: cropEnabled ? cropW : undefined,
            crop_h: cropEnabled ? cropH : undefined,
            invert_intensity: invertIntensity,
            encoding: preprocessingEncoding as 'png' | 'jpg' | 'raw' | 'zstd'
          });
          if (response.job?.id) nextJobIds.push(response.job.id);
        } else {
          const response = await client.queueSegmentationJob({
            asset_id: batch.assetId,
            run_id: batch.runId,
            frame_ids: batch.frameIds,
            priority,
            ...thresholdOptions(),
            ...maskAugmentationOptions(),
            ...roiAssemblyOptions(),
            ...roiFilterOptions(),
            ...roiRecordingOptions(),
            frame_payload_kind: 'preprocessed',
            apply_preprocessing: false
          });
          if (response.job?.id) nextJobIds.push(response.job.id);
        }
        queued += 1;
      } catch (err) {
        error = `Queued ${queued}/${batches.length}. ${err instanceof Error ? err.message : String(err)}`;
        queueing = false;
        return;
      }
    }
    submittedJobIds = [...nextJobIds, ...submittedJobIds].slice(0, 100);
    message = `Queued ${queued} ${mode === 'preprocessing' ? 'preprocessing' : 'segmentation'} batch job${queued === 1 ? '' : 's'} covering ${formatCount(prospectiveFrameCount)} frame${prospectiveFrameCount === 1 ? '' : 's'}.`;
    queueing = false;
  }

  async function detectionBatchesForFrames(
    client: NonNullable<ReturnType<typeof getClient>>,
    frames: FrameCatalogRow[],
    batchSize: number
  ): Promise<DetectionBatch[]> {
    const resolvedBatchSize = boundedBatchSize(batchSize);
    const grouped = new Map<string, FrameCatalogRow[]>();
    for (const frame of [...frames].sort(compareFrameId).filter((candidate) => candidate.detectionCount > 0)) {
      const key = `${frame.assetId}:${frame.runId ?? ''}`;
      grouped.set(key, [...(grouped.get(key) ?? []), frame]);
    }

    const batches: DetectionBatch[] = [];
    for (const group of grouped.values()) {
      const detectionEntries: Array<{ detectionId: string; frameId: string }> = [];
      const sortedFrames = [...group].sort(compareFrameId);
      for (const frame of sortedFrames) {
        const detections = await detectionsForFrame(client, frame, selectedDetectionRefinementStates());
        detectionEntries.push(
          ...detections
            .map((detection) => detection.id)
            .filter((id): id is string => Boolean(id))
            .map((detectionId) => ({ detectionId, frameId: frame.frameId }))
        );
      }
      for (let index = 0; index < detectionEntries.length; index += resolvedBatchSize) {
        const detectionBatch = detectionEntries.slice(index, index + resolvedBatchSize);
        if (!detectionBatch.length) continue;
        batches.push({
          assetId: group[0].assetId,
          runId: group[0].runId,
          firstFrameId: detectionBatch[0].frameId,
          detectionIds: detectionBatch.map((entry) => entry.detectionId)
        });
      }
    }
    return batches.sort((a, b) => a.firstFrameId.localeCompare(b.firstFrameId));
  }

  async function detectionsForFrame(
    client: NonNullable<ReturnType<typeof getClient>>,
    frame: FrameCatalogRow,
    refinementStates: string[]
  ): Promise<DetectionSummary[]> {
    const detections: DetectionSummary[] = [];
    const states = refinementStates.length ? refinementStates : ['any'];
    let offset = 0;
    const limit = 1000;
    for (const state of states) {
      offset = 0;
      while (true) {
        const page = await client.searchDetectionsPage({
          asset_id: frame.assetId,
          frame_id: frame.frameId,
          sort_by: 'asset_frame',
          sort_dir: 'asc',
          refinement_state: state === 'any' ? undefined : (state as 'refined' | 'unrefined'),
          limit,
          offset
        });
        detections.push(...(page.detections ?? []));
        const nextOffset = page.page?.next_offset;
        if (nextOffset === null || nextOffset === undefined) break;
        offset = Number(nextOffset);
        if (!Number.isFinite(offset) || offset <= detections.length - limit) break;
      }
    }
    return detections;
  }

  function selectedDetectionRefinementStates(): string[] {
    const states = [...selectedRefinementStates].filter((state) => state === 'refined' || state === 'unrefined');
    return states.length === 2 ? [] : states;
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

  function roiRefinementOptions(): Record<string, unknown> {
    return {
      model_kind: refinementModelKind,
      model_ref: refinementModelRef || undefined,
      model_run_dir: refinementModelRunDir || undefined,
      model_artifact: refinementModelArtifact || undefined,
      tile_size: refinementTileSize,
      overlap_fraction: refinementOverlapFraction,
      batch_size: refinementModelBatchSize,
      output_threshold: refinementOutputThreshold,
      allow_frame_expansion: refinementAllowFrameExpansion,
      max_iterations: refinementMaxIterations,
      expansion_pixels: refinementExpansionPixels,
      edge_touch_margin: refinementEdgeTouchMargin,
      encoding: refinementEncoding,
      store: refinementStore,
      dry_run: refinementDryRun
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
      {#if mode !== 'preprocessing'}
        <div class="metric">
          <span>{mode === 'roi_refinement' ? 'Candidate ROIs' : 'Existing detections'}</span>
          <strong>{formatCount(prospectiveDetectionCount)}</strong>
        </div>
      {/if}
      {#if mode === 'roi_refinement'}
        <div class="metric">
          <span>Refined ROIs</span>
          <strong>{formatCount(prospectiveRefinedDetectionCount)}</strong>
        </div>
        <div class="metric">
          <span>Unrefined candidates</span>
          <strong>{formatCount(prospectiveUnrefinedDetectionCount)}</strong>
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

      {#if mode === 'preprocessing'}
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
      {/if}

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

      {#if mode === 'roi_refinement'}
        <div class="filter-group">
          <div class="section-heading">
            <p class="eyebrow">State</p>
            <strong>ROI refinement state</strong>
          </div>
          <div class="compact-select-list">
            <button class="wildcard-filter" class:active={selectedRefinementStates.size === 0} type="button" on:click={() => clearGroup('refinement')}>
              <span>Any ROI refinement state</span>
              <small>{formatCount(refinementAnyRoiCount)} ROIs</small>
            </button>
            {#each refinementStateOptions as option}
              <button
                class:active={selectedRefinementStates.has(option.id)}
                type="button"
                on:click={() => toggleRefinementState(option.id)}
              >
                <span>{option.label}</span>
                <small>{formatCount(countFor(refinementRoiCounts, option.id))} ROIs</small>
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
        <h2>{mode === 'preprocessing' ? 'Preprocessing job' : mode === 'segmentation' ? 'Segmentation job' : 'ROI refinement job'}</h2>
      </div>
    </div>

    {#if mode === 'preprocessing'}
      <div class="form-section">
        <div class="section-heading">
          <span>
            <p class="eyebrow">Default options</p>
            <strong>Preprocessing</strong>
          </span>
        </div>
        <label class="check-row">
          <input
            type="checkbox"
            checked={backgroundCorrection}
            on:change={(event) => setBackgroundCorrection((event.currentTarget as HTMLInputElement).checked)}
          />
          Background correction
        </label>
        <label class="check-row">
          <input
            type="checkbox"
            checked={flatfieldCorrection}
            on:change={(event) => setFlatfieldCorrection((event.currentTarget as HTMLInputElement).checked)}
          />
          Flatfield correction
        </label>
        {#if flatfieldCorrection}
          <label>
            Flatfield q
            <input type="range" min="0" max="1" step="0.01" bind:value={flatfieldQ} />
            <span class="range-value">{flatfieldQ.toFixed(2)}</span>
          </label>
        {/if}

        <label class="check-row">
          <input type="checkbox" bind:checked={invertIntensity} />
          Invert intensity
        </label>
      </div>

      <details class="form-section collapsible-section">
        <summary class="section-heading">
          <span>
            <p class="eyebrow">Advanced options</p>
            <strong>Preprocessing details</strong>
          </span>
        </summary>

        <label class="span-2">
          Batch size
          <input
            type="range"
            min={batchSizeMin()}
            max={batchSizeMax()}
            step={batchSizeStep()}
            bind:value={frameBatchSize}
          />
          <span class="range-value">{boundedFrameBatchSize()} frames per job</span>
        </label>
        <label>
          Priority
          <input type="number" bind:value={priority} placeholder="default" />
        </label>

        {#if flatfieldCorrection}
          <div class="form-grid compact-grid">
            <label>
              Min field value
              <input type="range" min="0" max="255" step="1" bind:value={flatfieldMinFieldValue} />
              <span class="range-value">{flatfieldMinFieldValue}</span>
            </label>
            <label>
              Max field value
              <input type="range" min="1" max="4096" step="1" bind:value={flatfieldMaxFieldValue} />
              <span class="range-value">{flatfieldMaxFieldValue ?? 'none'}</span>
            </label>
            <label>
              Flatfield axis
              <select bind:value={flatfieldAxis}>
                <option value={0}>0</option>
                <option value={1}>1</option>
              </select>
            </label>
          </div>
        {:else if backgroundCorrection}
          <div class="form-grid compact-grid">
            <label>
              Min background field value
              <input type="range" min="0" max="255" step="1" bind:value={backgroundMinFieldValue} />
              <span class="range-value">{backgroundMinFieldValue}</span>
            </label>
            <label>
              Max background field value
              <input type="range" min="1" max="4096" step="1" bind:value={backgroundMaxFieldValue} />
              <span class="range-value">{backgroundMaxFieldValue ?? 'none'}</span>
            </label>
          </div>
        {/if}

        <label class="check-row">
          <input type="checkbox" bind:checked={applyMask} />
          Apply frame mask
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
    {:else if mode === 'segmentation'}
      <div class="form-section">
        <div class="section-heading">
          <span>
            <p class="eyebrow">Default options</p>
            <strong>Candidate detection</strong>
          </span>
        </div>
        <div class="form-grid compact-grid">
          <label>
            Threshold method
            <select bind:value={thresholdMethod}>
              {#each thresholdMethods as method}
                <option value={method}>{method}</option>
              {/each}
            </select>
          </label>
          <label>
            Method
            <select bind:value={roiAssemblyMethod}>
              {#each roiAssemblyMethods as method}
                <option value={method}>{method}</option>
              {/each}
            </select>
          </label>
          <label>
            Min area
            <input type="number" min="0" bind:value={minArea} placeholder="none" />
          </label>
          <label>
            Max area
            <input type="number" min="0" bind:value={maxArea} placeholder="none" />
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
      </div>

      <details class="form-section collapsible-section">
        <summary class="section-heading">
          <span>
            <p class="eyebrow">Advanced options</p>
            <strong>Candidate detection details</strong>
          </span>
        </summary>

        <div class="form-grid compact-grid">
          <label class="span-2">
            Batch size
            <input
              type="range"
              min={batchSizeMin()}
              max={batchSizeMax()}
              step={batchSizeStep()}
              bind:value={frameBatchSize}
            />
            <span class="range-value">{boundedFrameBatchSize()} frames per job</span>
          </label>
          <label>
            Priority
            <input type="number" bind:value={priority} placeholder="default" />
          </label>
        </div>

        <details class="control-details" open>
          <summary>Threshold</summary>
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

        <details class="control-details" open>
          <summary>Mask augmentation</summary>
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

        <details class="control-details" open>
          <summary>Assembly and secondary geometry</summary>
        <div class="form-grid compact-grid">
          <label>
            Connectivity
            <select bind:value={roiAssemblyConnectivity}>
              <option value={4}>4</option>
              <option value={8}>8</option>
            </select>
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
        </div>
        </details>

        <details class="control-details" open>
          <summary>ROI payloads</summary>
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
      </details>
    {:else}
      <div class="form-section">
        <div class="section-heading">
          <span>
            <p class="eyebrow">Model selection</p>
            <strong>Refinement model</strong>
          </span>
        </div>
        <label>
          Model kind
          <select bind:value={refinementModelKind}>
            {#each refinementModelKinds as kind}
              <option value={kind}>{kind}</option>
            {/each}
          </select>
        </label>
        {#if refinementModelRefs.length}
          <label>
            Model reference
            <select bind:value={refinementModelRef}>
              <option value="">Default</option>
              {#each refinementModelRefs as modelRef}
                <option value={modelRef}>{modelRef}</option>
              {/each}
            </select>
          </label>
        {:else}
          <label>
            Model reference
            <input bind:value={refinementModelRef} placeholder="default" />
          </label>
        {/if}
        {#if refinementModelKind === 'oracle_builder_unet'}
          <label>
            Model run directory
            <input bind:value={refinementModelRunDir} placeholder="oracle-builder run path" />
          </label>
        {/if}
        {#if refinementModelKind === 'keras_artifact'}
          <label>
            Model artifact
            <select bind:value={refinementModelArtifact}>
              {#each refinementModelArtifacts as artifact}
                <option value={artifact}>{artifact}</option>
              {/each}
            </select>
          </label>
        {/if}
      </div>

      <details class="form-section collapsible-section">
        <summary class="section-heading">
          <span>
            <p class="eyebrow">Advanced options</p>
            <strong>ROI refinement details</strong>
          </span>
        </summary>

        <details class="control-details" open>
          <summary>Scope</summary>
          <div class="form-grid compact-grid">
            <label class="span-2">
              Batch size
              <input
                type="range"
                min={batchSizeMin()}
                max={batchSizeMax()}
                step={batchSizeStep()}
                bind:value={frameBatchSize}
              />
              <span class="range-value">{boundedFrameBatchSize()} ROIs per job</span>
            </label>
            <label>
              Priority
              <input type="number" bind:value={priority} placeholder="default" />
            </label>
          </div>
        </details>

        <details class="control-details" open>
          <summary>Model input geometry</summary>
          <label>
            Tile size
            <input type="number" min="1" step="1" bind:value={refinementTileSize} />
          </label>
          <label>
            Overlap fraction
            <input type="range" min="0" max="0.99" step="0.01" bind:value={refinementOverlapFraction} />
            <span class="range-value">{Number(refinementOverlapFraction).toFixed(2)}</span>
          </label>
          <label>
            Model batch size
            <input type="number" min="1" bind:value={refinementModelBatchSize} placeholder="default" />
          </label>
        </details>

        <details class="control-details" open>
          <summary>Prediction</summary>
          <label>
            Output threshold
            <input type="range" min="0" max="1" step="0.01" bind:value={refinementOutputThreshold} />
            <span class="range-value">{Number(refinementOutputThreshold).toFixed(2)}</span>
          </label>
        </details>

        <details class="control-details" open>
          <summary>Frame-aware ROI growth</summary>
          <label class="check-row">
            <input type="checkbox" bind:checked={refinementAllowFrameExpansion} />
            Allow frame expansion
          </label>
          <label>
            Max iterations
            <input type="number" min="1" step="1" bind:value={refinementMaxIterations} />
          </label>
          <label>
            Expansion pixels
            <input type="number" min="1" step="1" bind:value={refinementExpansionPixels} placeholder="tile stride" />
          </label>
          <label>
            Edge touch margin
            <input type="number" min="1" step="1" bind:value={refinementEdgeTouchMargin} />
          </label>
        </details>

        <details class="control-details" open>
          <summary>Refined detections</summary>
          <label class="check-row">
            <input type="checkbox" bind:checked={refinementStore} />
            Store refined detections
          </label>
          <label>
            Encoding
            <select bind:value={refinementEncoding}>
              <option value="auto">default</option>
              {#each refinementEncodingOptions as encoding}
                {#if encoding !== 'auto'}
                  <option value={encoding}>{encoding}</option>
                {/if}
              {/each}
            </select>
          </label>
          <label class="check-row">
            <input type="checkbox" bind:checked={refinementDryRun} />
            Dry run
          </label>
        </details>
      </details>
    {/if}

    <div class="selected-frame-summary">
      <span>Currently selected</span>
      <strong>{formatCount(prospectiveQueueItemCount)} {prospectiveQueueItemCount === 1 ? queueItemLabel : queueItemLabelPlural}</strong>
      {#if mode === 'roi_refinement'}
        <small>from {formatCount(prospectiveFrameCount)} frame{prospectiveFrameCount === 1 ? '' : 's'}</small>
      {/if}
      <small>{formatCount(prospectiveBatchCount)} batch job{prospectiveBatchCount === 1 ? '' : 's'}</small>
    </div>

    <button type="button" on:click={queueJobs} disabled={queueing || prospectiveBatchCount === 0 || queueBlocked}>
      {queueing ? 'Queueing' : actionLabel}
    </button>
    <p class="soft">
      {formatCount(prospectiveBatchCount)} batch job{prospectiveBatchCount === 1 ? '' : 's'} covering {formatCount(prospectiveQueueItemCount)} {prospectiveQueueItemCount === 1 ? queueItemLabel : queueItemLabelPlural}.
    </p>
    {#if message}<p class="success">{message}</p>{/if}
    {#if error}<p class="form-error">{error}</p>{/if}

    <QueueStatusSummary
      title={queueStatusTitle}
      eyebrow="Live status"
      stage={queueStage}
      jobIds={submittedJobIds}
      mode="compact"
    />
  </section>
</div>
