<script lang="ts">
  import { onMount } from 'svelte';
  import HelpChip from '$lib/components/HelpChip.svelte';
  import InfoChip from '$lib/components/InfoChip.svelte';
  import QueueStatusSummary from '$lib/components/QueueStatusSummary.svelte';
  import { getClient, session } from '$lib/stores/session';
  import type {
    ProcessingQueueFilters,
    ProcessingQueueRequest,
    ProcessingQueueResponse,
    ProcessingQueueStage,
    ProcessingStatusFacets,
    ProcessingStatusFilters,
    ProcessingStatusSummary,
    RawAsset,
    RoiRefinementCapabilities,
    SegmentationCapabilities,
    SystemCapabilitiesResponse,
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
    PROCESSING_PRESET_APPLIED_EVENT,
    processingSettingChangedFromBaseline,
    processingSettingsBaseline,
    pruneProcessingSettings
  } from '$lib/processing/settings';
  import {
    currentLiveProcessingPreset,
    processingPresetSession,
    setLiveProcessingPresetFromSettings
  } from '$lib/stores/processingPresetSession';
  import {
    booleanPreference,
    nullableNumberPreference as nullablePreferenceNumber,
    numberPreference,
    projectPreferenceKey,
    readPreferences,
    stringArrayPreference,
    stringPreference,
    stringSetPreference,
    writePreferences
  } from '$lib/utils/preferences';
  import {
    codecAvailable,
    codecUnavailableTitle,
    ensureAvailableCodec,
    uniqueCodecOptions,
    type CodecAvailability
  } from '$lib/utils/codecs';

  type QueueMode = 'preprocessing' | 'segmentation' | 'roi_refinement';

  export let mode: QueueMode;

  type Dataset = {
    asset: RawAsset;
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

  type FilterGroup = 'asset' | 'collection' | 'preprocess' | 'detection' | 'refinement';

  let datasets: Dataset[] = [];
  let collectionOptions: string[] = [];
  let assetOptionFrameCounts = new Map<string, number>();
  let collectionOptionFrameCounts = new Map<string, number>();
  let preprocessOptionFrameCounts = new Map<string, number>();
  let detectionOptionFrameCounts = new Map<string, number>();
  let refinementOptionRoiCounts = new Map<string, number>();
  let activeStatusSummary: ProcessingStatusSummary | null = null;
  let statusSnapshotVersion: string | null = null;
  let statusRefreshTimer: number | null = null;
  let statusRefreshSequence = 0;
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
  let globalDefaultProcessingSettings: ProcessingSettings = {};

  let minFieldValue = 1;
  let maxFieldValue: number | null = 255;
  let applyMask = false;
  let cropEnabled = false;
  let cropX: number | null = null;
  let cropY: number | null = null;
  let cropW: number | null = null;
  let cropH: number | null = null;
  let imageCodecAvailability: CodecAvailability = {};

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
  let storeRoiPayloadMinArea: number | null = null;
  let storeRoiPayloadMinWidth: number | null = null;
  let storeRoiPayloadMinHeight: number | null = null;
  let storeRoiPayloadMinWidthPlusHeight: number | null = null;

  let refinementMethod: 'oracle' | 'identity' = 'oracle';
  let refinementModelRef = '';
  let refinementModelRefs: string[] = [];
  let oracleStatus = 'unknown';
  let refinementAllowFrameExpansion = true;
  let refinementMaxIterations = 3;
  let refinementExpansionPixels: number | null = null;
  let refinementEdgeTouchMargin = 1;
  let refinementEncoding = 'auto';
  let refinementEncodingOptions = ['auto', 'zstd', 'png', 'jpg', 'jxl', 'jxs', 'raw'];
  let refinementStore = true;
  let refinementDryRun = false;

  type DatasetQueuePreferences = {
    selectedAssetIds: string[];
    selectedCollections: string[];
    selectedPreprocessStates: string[];
    selectedDetectionStates: string[];
    selectedRefinementStates: string[];
    minFieldValue: number;
    maxFieldValue: number | null;
    applyMask: boolean;
    cropEnabled: boolean;
    cropX: number | null;
    cropY: number | null;
    cropW: number | null;
    cropH: number | null;
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
    storeRoiPayloadMinArea: number | null;
    storeRoiPayloadMinWidth: number | null;
    storeRoiPayloadMinHeight: number | null;
    storeRoiPayloadMinWidthPlusHeight: number | null;
    refinementModelRef: string;
    refinementMethod: 'oracle' | 'identity';
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
  $: datasetQueuePreferenceSnapshot = buildPreferenceSnapshot();
  $: if (preferencesReady) writePreferences(datasetQueuePreferenceKey(), datasetQueuePreferenceSnapshot);
  $: if (preferencesReady) {
    datasetQueuePreferenceSnapshot;
    setLiveProcessingPresetFromSettings(captureProcessingSettings());
  }
  $: processingBaselineSettings = processingSettingsBaseline(
    globalDefaultProcessingSettings,
    $processingPresetSession.selectedPreset
  );
  $: selectedCollectionArray = [...selectedCollections];
  $: selectedAssetArray = [...selectedAssetIds];
  $: filteredDatasets = datasets.filter((dataset) => datasetMatchesFilters(dataset));
  $: preprocessStateOptions = statusOptions();
  $: detectionStateOptions = statusOptions();
  $: refinementStateOptions = [
    { id: 'refined', label: 'Refined' },
    { id: 'unrefined', label: 'Unrefined' }
  ];
  $: assetFrameCounts = assetOptionFrameCounts;
  $: collectionFrameCounts = collectionOptionFrameCounts;
  $: preprocessFrameCounts = preprocessOptionFrameCounts;
  $: detectionFrameCounts = detectionOptionFrameCounts;
  $: refinementRoiCounts = refinementOptionRoiCounts;
  $: assetAnyFrameCount = statusFrameCount(activeStatusSummary);
  $: collectionAnyFrameCount = statusFrameCount(activeStatusSummary);
  $: preprocessAnyFrameCount = statusFrameCount(activeStatusSummary);
  $: detectionAnyFrameCount = statusFrameCount(activeStatusSummary);
  $: refinementAnyRoiCount = prospectiveUnrefinedDetectionCount;
  $: prospectiveFrameCount = statusFrameCount(activeStatusSummary);
  $: prospectivePreprocessedCount = numericStatusValue(activeStatusSummary?.preprocessing_succeeded_count);
  $: prospectiveDetectionCount = numericStatusValue(activeStatusSummary?.candidate_detection_count);
  $: prospectiveRefinedCandidateCount = numericStatusValue(activeStatusSummary?.frames_with_refined_rois_count);
  $: prospectiveUnrefinedDetectionCount = numericStatusValue(activeStatusSummary?.unrefined_candidate_count);
  $: prospectiveRefinedDetectionCount = numericStatusValue(activeStatusSummary?.refined_detection_count);
  $: prospectiveRefinementCandidateCount =
    selectedRefinementStates.size === 0
      ? prospectiveUnrefinedDetectionCount
      : selectedRefinementStates.has('refined') && selectedRefinementStates.has('unrefined')
        ? prospectiveRefinedDetectionCount + prospectiveUnrefinedDetectionCount
        : selectedRefinementStates.has('refined')
          ? prospectiveRefinedDetectionCount
          : prospectiveUnrefinedDetectionCount;
  $: prospectiveQueueItemCount = mode === 'roi_refinement' ? prospectiveRefinementCandidateCount : prospectiveFrameCount;
  $: missingPreprocessedFrameCount = 0;
  $: payloadStorageThresholdsActive = Boolean(
    fieldChanged('storeRoiPayloadMinArea', storeRoiPayloadMinArea) ||
      fieldChanged('storeRoiPayloadMinWidth', storeRoiPayloadMinWidth) ||
      fieldChanged('storeRoiPayloadMinHeight', storeRoiPayloadMinHeight) ||
      fieldChanged('storeRoiPayloadMinWidthPlusHeight', storeRoiPayloadMinWidthPlusHeight)
  );
  $: preprocessingAdvancedActive = Boolean(
    fieldChanged('applyMask', applyMask) ||
      fieldChanged('cropEnabled', cropEnabled) ||
      (cropEnabled &&
        (fieldChanged('cropX', cropX) ||
          fieldChanged('cropY', cropY) ||
          fieldChanged('cropW', cropW) ||
          fieldChanged('cropH', cropH)))
  );
  $: thresholdAdvancedActive = thresholdAdvancedSettingsActive();
  $: maskAugmentationAdvancedActive = maskAugmentationSettingsActive();
  $: candidateDetectionAdvancedActive = Boolean(
    thresholdAdvancedActive ||
      maskAugmentationAdvancedActive ||
      fieldChanged('roiAssemblyConnectivity', roiAssemblyConnectivity) ||
      fieldChanged('minArea', minArea) ||
      fieldChanged('maxArea', maxArea) ||
      fieldChanged('minPerimeter', minPerimeter) ||
      fieldChanged('maxPerimeter', maxPerimeter) ||
      fieldChanged('maxWidth', maxWidth) ||
      fieldChanged('maxHeight', maxHeight) ||
      fieldChanged('minWidthPlusHeight', minWidthPlusHeight) ||
      fieldChanged('maxWidthPlusHeight', maxWidthPlusHeight) ||
      fieldChanged('padding', padding) ||
      payloadStorageThresholdsActive
  );
  $: refinementAdvancedActive = Boolean(
    fieldChanged('refinementAllowFrameExpansion', refinementAllowFrameExpansion) ||
      fieldChanged('refinementMaxIterations', refinementMaxIterations) ||
      fieldChanged('refinementExpansionPixels', refinementExpansionPixels) ||
      fieldChanged('refinementEdgeTouchMargin', refinementEdgeTouchMargin) ||
      fieldChanged('refinementEncoding', refinementEncoding) ||
      fieldChanged('refinementStore', refinementStore) ||
      fieldChanged('refinementDryRun', refinementDryRun)
  );
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

  $: catalogKey = `${$session.connected ? $session.baseUrl : 'disconnected'}:${$session.project?.id ?? $session.project?.project_key ?? 'no-project'}:${mode}`;
  $: if ($session.connected && catalogKey !== lastCatalogKey) {
    lastCatalogKey = catalogKey;
    void loadCatalog();
  }
  $: statusFilterKey = JSON.stringify({
    mode,
    assets: selectedAssetArray,
    collections: selectedCollectionArray,
    preprocessing: [...selectedPreprocessStates],
    candidateDetection: [...selectedDetectionStates],
    roiRefinement: [...selectedRefinementStates]
  });
  $: if (preferencesReady && $session.connected) {
    statusFilterKey;
    scheduleStatusRefresh();
  }

  onMount(() => {
    window.addEventListener(PROCESSING_PRESET_APPLIED_EVENT, handleHeaderProcessingPresetApplied);
    applyStoredLiveProcessingPreset();
    if ($session.connected) void loadCatalog();
    const statusPollTimer = window.setInterval(() => {
      if ($session.connected && preferencesReady) void refreshStatusSummary();
    }, 5000);
    return () => {
      window.removeEventListener(PROCESSING_PRESET_APPLIED_EVENT, handleHeaderProcessingPresetApplied);
      window.clearInterval(statusPollTimer);
      if (statusRefreshTimer !== null) window.clearTimeout(statusRefreshTimer);
    };
  });

  function datasetQueuePreferenceKey(): string {
    return projectPreferenceKey(`dataset-queue:${mode}`, $session);
  }

  function buildPreferenceSnapshot(): DatasetQueuePreferences {
    return {
      selectedAssetIds: [...selectedAssetIds],
      selectedCollections: [...selectedCollections],
      selectedPreprocessStates: [...selectedPreprocessStates],
      selectedDetectionStates: [...selectedDetectionStates],
      selectedRefinementStates: [...selectedRefinementStates],
      minFieldValue,
      maxFieldValue,
      applyMask,
      cropEnabled,
      cropX,
      cropY,
      cropW,
      cropH,
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
      storeRoiPayloadMinArea,
      storeRoiPayloadMinWidth,
      storeRoiPayloadMinHeight,
      storeRoiPayloadMinWidthPlusHeight,
      refinementModelRef,
      refinementMethod,
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
    minFieldValue = numberPreference(preferences.minFieldValue, minFieldValue);
    maxFieldValue = nullablePreferenceNumber(preferences.maxFieldValue, maxFieldValue);
    applyMask = booleanPreference(preferences.applyMask, applyMask);
    cropEnabled = booleanPreference(preferences.cropEnabled, cropEnabled);
    cropX = nullablePreferenceNumber(preferences.cropX, cropX);
    cropY = nullablePreferenceNumber(preferences.cropY, cropY);
    cropW = nullablePreferenceNumber(preferences.cropW, cropW);
    cropH = nullablePreferenceNumber(preferences.cropH, cropH);
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
    storeRoiPayloadMinArea = nullablePreferenceNumber(preferences.storeRoiPayloadMinArea, storeRoiPayloadMinArea);
    storeRoiPayloadMinWidth = nullablePreferenceNumber(preferences.storeRoiPayloadMinWidth, storeRoiPayloadMinWidth);
    storeRoiPayloadMinHeight = nullablePreferenceNumber(preferences.storeRoiPayloadMinHeight, storeRoiPayloadMinHeight);
    storeRoiPayloadMinWidthPlusHeight = nullablePreferenceNumber(preferences.storeRoiPayloadMinWidthPlusHeight, storeRoiPayloadMinWidthPlusHeight);
    refinementModelRef = stringPreference(preferences.refinementModelRef, refinementModelRef);
    refinementMethod = preferences.refinementMethod === 'identity' ? 'identity' : 'oracle';
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
    return pruneProcessingSettings({
      ...currentLiveProcessingPreset().settings,
      ...currentPageProcessingSettings()
    });
  }

  function currentPageProcessingSettings(): ProcessingSettings {
    const {
      selectedAssetIds: _selectedAssetIds,
      selectedCollections: _selectedCollections,
      selectedPreprocessStates: _selectedPreprocessStates,
      selectedDetectionStates: _selectedDetectionStates,
      selectedRefinementStates: _selectedRefinementStates,
      ...settings
    } = buildPreferenceSnapshot();
    return settings;
  }

  function fieldChanged<K extends keyof ProcessingSettings>(key: K, value: ProcessingSettings[K]): boolean {
    return processingSettingChangedFromBaseline(processingBaselineSettings, key, value);
  }

  function processingSettingsWithDefaults(settings: ProcessingSettings): ProcessingSettings {
    return {
      ...globalDefaultProcessingSettings,
      ...settings
    };
  }

  function applyProcessingPresetSettings(preset: ProcessingPreset, options: { updateSession?: boolean } = {}) {
    const resolvedSettings = processingSettingsWithDefaults(preset.settings);
    applyProcessingSettings(resolvedSettings);
    if (options.updateSession) {
      setLiveProcessingPresetFromSettings(captureProcessingSettings(), {
        selectedKey: preset.source === 'live' ? 'live:live' : undefined
      });
    }
  }

  function applyProcessingSettings(settings: ProcessingSettings) {
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
    if ('minFieldValue' in settings) minFieldValue = numberPreference(settings.minFieldValue, minFieldValue);
    if ('maxFieldValue' in settings) maxFieldValue = nullablePreferenceNumber(settings.maxFieldValue, maxFieldValue);
    if ('applyMask' in settings) applyMask = booleanPreference(settings.applyMask, applyMask);
    if ('cropEnabled' in settings) cropEnabled = booleanPreference(settings.cropEnabled, cropEnabled);
    if ('cropX' in settings) cropX = nullablePreferenceNumber(settings.cropX, cropX);
    if ('cropY' in settings) cropY = nullablePreferenceNumber(settings.cropY, cropY);
    if ('cropW' in settings) cropW = nullablePreferenceNumber(settings.cropW, cropW);
    if ('cropH' in settings) cropH = nullablePreferenceNumber(settings.cropH, cropH);
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
    if ('storeRoiPayloadMinArea' in settings) storeRoiPayloadMinArea = nullablePreferenceNumber(settings.storeRoiPayloadMinArea, storeRoiPayloadMinArea);
    if ('storeRoiPayloadMinWidth' in settings) storeRoiPayloadMinWidth = nullablePreferenceNumber(settings.storeRoiPayloadMinWidth, storeRoiPayloadMinWidth);
    if ('storeRoiPayloadMinHeight' in settings) storeRoiPayloadMinHeight = nullablePreferenceNumber(settings.storeRoiPayloadMinHeight, storeRoiPayloadMinHeight);
    if ('storeRoiPayloadMinWidthPlusHeight' in settings) storeRoiPayloadMinWidthPlusHeight = nullablePreferenceNumber(settings.storeRoiPayloadMinWidthPlusHeight, storeRoiPayloadMinWidthPlusHeight);
    if ('refinementModelRef' in settings) refinementModelRef = stringPreference(settings.refinementModelRef, refinementModelRef);
    if ('refinementAllowFrameExpansion' in settings) refinementAllowFrameExpansion = booleanPreference(settings.refinementAllowFrameExpansion, refinementAllowFrameExpansion);
    if ('refinementMaxIterations' in settings) refinementMaxIterations = numberPreference(settings.refinementMaxIterations, refinementMaxIterations);
    if ('refinementExpansionPixels' in settings) refinementExpansionPixels = nullablePreferenceNumber(settings.refinementExpansionPixels, refinementExpansionPixels);
    if ('refinementEdgeTouchMargin' in settings) refinementEdgeTouchMargin = numberPreference(settings.refinementEdgeTouchMargin, refinementEdgeTouchMargin);
    if ('refinementEncoding' in settings) refinementEncoding = stringPreference(settings.refinementEncoding, refinementEncoding);
    if ('refinementStore' in settings) refinementStore = booleanPreference(settings.refinementStore, refinementStore);
    if ('refinementDryRun' in settings) refinementDryRun = booleanPreference(settings.refinementDryRun, refinementDryRun);
    enforceCodecAvailability();
  }

  function applyStoredLiveProcessingPreset() {
    const preset = currentLiveProcessingPreset();
    if (preset?.source === 'live' && preset.settings) {
      applyProcessingPresetSettings(preset);
    }
  }

  function handleHeaderProcessingPresetApplied(event: Event) {
    const preset = (event as CustomEvent<ProcessingPreset>).detail;
    if (!preset?.settings) return;
    applyProcessingPresetSettings(preset, { updateSession: true });
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
    catalogStatus = 'Loading queue status.';
    try {
      const [assets, collections, config, systemCapabilities] = await Promise.all([
        client.listAssets(undefined, 10000).catch(() => []),
        client.listCollections(500).catch(() => []),
        client.systemConfig().catch(() => null),
        client.systemCapabilities().catch(() => null)
      ]);
      const [segmentationCapabilities, roiRefinementCapabilities] = await Promise.all([
        client.segmentationOptions().catch(() => null),
        client.roiRefinementOptions().catch(() => null)
      ]);
      preferencesReady = false;
      applyConfigDefaults(config, segmentationCapabilities, roiRefinementCapabilities, systemCapabilities);
      restorePreferences();
      applyStoredLiveProcessingPreset();
      enforceCodecAvailability();
      datasets = datasetsFromAssets(assets);
      collectionOptions = uniqueStrings([
        ...collections.map((collection) => collection.collection),
        ...datasets.flatMap((dataset) => dataset.collections)
      ]);
      await refreshStatusSummary();
      catalogStatus = `Loaded queue status for ${formatCount(datasets.length)} asset${datasets.length === 1 ? '' : 's'}.`;
      preferencesReady = true;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      catalogStatus = 'Dataset catalog failed to load.';
    } finally {
      loading = false;
    }
  }

  function datasetsFromAssets(assets: RawAsset[]): Dataset[] {
    return assets.map((asset) => {
      const frameCount = Number(asset.frame_count ?? 0);
      return {
        asset,
        frameIds: [],
        frameCount,
        preprocessedCount: 0,
        detectionCount: 0,
        refinedCandidateDetectionCount: 0,
        unrefinedDetectionCount: 0,
        refinedDetectionCount: 0,
        collections: assetCollections(asset),
        preprocessingState: undefined,
        detectionState: undefined,
        refinementState: undefined
      };
    });
  }

  function applyConfigDefaults(
    config: SystemConfigResponse | null,
    capabilities: SegmentationCapabilities | null = null,
    refinementCapabilities: RoiRefinementCapabilities | null = null,
    systemCapabilities: SystemCapabilitiesResponse | null = null
  ) {
    const thresholding = pipelineSection(config, capabilities, 'thresholding');
    const preprocessing = pipelineSection(config, capabilities, 'preprocessing');
    const maskAugmentation = pipelineSection(config, capabilities, 'mask_augmentation');
    const roiAssembly = pipelineSection(config, capabilities, 'roi_assembly');
    const roiFilter = pipelineSection(config, capabilities, 'roi_filter');
    const roiRecording = pipelineSection(config, capabilities, 'roi_recording');
    const roiRefinement = refinementCapabilities?.defaults?.roi_refinement ?? processingSection(config, 'roi_refinement');

    thresholdMethods = capabilities?.supported?.threshold_methods?.length
      ? capabilities.supported.threshold_methods
      : thresholdMethods;
    maskAugmentationStepOptions = capabilities?.supported?.mask_augmentation_steps?.length
      ? capabilities.supported.mask_augmentation_steps
      : maskAugmentationStepOptions;
    roiAssemblyMethods = capabilities?.supported?.roi_assembly_methods?.length
      ? capabilities.supported.roi_assembly_methods
      : roiAssemblyMethods;
    imageCodecAvailability = systemCapabilities?.supported?.image_codec_availability ?? {};
    refinementModelRefs = refinementCapabilities?.supported?.model_refs ?? refinementModelRefs;
    oracleStatus = refinementCapabilities?.supported?.oracle?.status ?? 'unknown';
    refinementEncodingOptions = uniqueCodecOptions(
      refinementCapabilities?.supported?.roi_encoding_options?.length
        ? refinementCapabilities.supported.roi_encoding_options
        : refinementEncodingOptions
    );

    minFieldValue = numberDefault(preprocessing, 'min_field_value', minFieldValue);
    maxFieldValue = nullableNumberDefault(preprocessing, 'max_field_value', maxFieldValue);
    applyMask = booleanDefault(preprocessing, 'apply_mask', applyMask);
    cropEnabled = booleanDefault(preprocessing, 'crop_enabled', cropEnabled);
    cropX = nullableNumberDefault(preprocessing, 'crop_x', cropX);
    cropY = nullableNumberDefault(preprocessing, 'crop_y', cropY);
    cropW = nullableNumberDefault(preprocessing, 'crop_w', cropW);
    cropH = nullableNumberDefault(preprocessing, 'crop_h', cropH);

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
    storeRoiPayloadMinArea = nullableNumberDefault(roiRecording, 'store_roi_payload_min_area', storeRoiPayloadMinArea);
    storeRoiPayloadMinWidth = nullableNumberDefault(roiRecording, 'store_roi_payload_min_width', storeRoiPayloadMinWidth);
    storeRoiPayloadMinHeight = nullableNumberDefault(roiRecording, 'store_roi_payload_min_height', storeRoiPayloadMinHeight);
    storeRoiPayloadMinWidthPlusHeight = nullableNumberDefault(roiRecording, 'store_roi_payload_min_width_plus_height', storeRoiPayloadMinWidthPlusHeight);

    refinementModelRef = stringDefault(roiRefinement, 'model_ref', refinementModelRef);
    refinementMaxIterations = numberDefault(roiRefinement, 'max_iterations', refinementMaxIterations);
    refinementExpansionPixels = nullableNumberDefault(roiRefinement, 'expansion_pixels', refinementExpansionPixels);
    refinementEdgeTouchMargin = numberDefault(roiRefinement, 'edge_touch_margin', refinementEdgeTouchMargin);
    refinementEncoding = ensureAvailableCodec(
      stringDefault(roiRefinement, 'encoding', refinementEncoding),
      refinementEncodingOptions,
      imageCodecAvailability,
      'auto'
    );
    globalDefaultProcessingSettings = currentPageProcessingSettings();
  }

  function enforceCodecAvailability() {
    refinementEncoding = ensureAvailableCodec(refinementEncoding, refinementEncodingOptions, imageCodecAvailability, 'auto');
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

  function datasetMatchesFilters(dataset: Dataset): boolean {
    if (selectedAssetIds.size && !selectedAssetIds.has(dataset.asset.id)) return false;
    if (selectedCollections.size && !dataset.collections.some((collection) => selectedCollections.has(collection))) return false;
    return true;
  }

  function statusOptions(): Array<{ id: string; label: string }> {
    return ['unknown', 'queued', 'leased', 'working', 'succeeded', 'failed', 'cancelled', 'dead_lettered'].map((status) => ({
      id: status,
      label: stateLabel(status)
    }));
  }

  function statusFrameCount(summary: ProcessingStatusSummary | null): number {
    return numericStatusValue(summary?.total_frame_count);
  }

  function numericStatusValue(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
  }

  function activeStatusFacetFilters(): ProcessingStatusFilters {
    const filters: ProcessingStatusFilters = {};
    if (selectedAssetIds.size) filters.asset_id = [...selectedAssetIds];
    if (selectedCollections.size) filters.collection = [...selectedCollections];
    if (mode === 'preprocessing' && selectedPreprocessStates.size) {
      filters.preprocessing_status = [...selectedPreprocessStates];
    }
    if (mode === 'segmentation') {
      filters.preprocessing_status = 'succeeded';
      if (selectedDetectionStates.size) filters.candidate_detection_status = [...selectedDetectionStates];
    }
    if (mode === 'roi_refinement') {
      filters.candidate_detection_status = 'succeeded';
      if (selectedRefinementStates.size === 0) {
        filters.has_refined_rois = false;
      } else if (selectedRefinementStates.size === 1) {
        if (selectedRefinementStates.has('refined')) filters.has_refined_rois = true;
        if (selectedRefinementStates.has('unrefined')) filters.has_refined_rois = false;
      }
    }
    return filters;
  }

  function processingQueueStage(): ProcessingQueueStage {
    if (mode === 'preprocessing') return 'preprocess_frames';
    if (mode === 'segmentation') return 'segment';
    return 'roi_refinement';
  }

  function processingQueueFilters(): ProcessingQueueFilters {
    const filters: ProcessingQueueFilters = {};
    filters.asset_ids = selectedAssetArray;
    if (selectedCollectionArray.length) filters.collection = selectedCollectionArray;
    if (mode === 'preprocessing' && selectedPreprocessStates.size) {
      filters.preprocessing_status = [...selectedPreprocessStates];
    }
    if (mode === 'segmentation') {
      filters.preprocessing_status = ['succeeded'];
      if (selectedDetectionStates.size) filters.candidate_detection_status = [...selectedDetectionStates];
    }
    if (mode === 'roi_refinement') {
      const refinementStates = selectedQueueRefinementStates();
      if (refinementStates.length) filters.refinement_state = refinementStates;
    }
    return filters;
  }

  function selectedQueueRefinementStates(): Array<'refined' | 'unrefined'> {
    return [...selectedRefinementStates].filter(
      (state): state is 'refined' | 'unrefined' => state === 'refined' || state === 'unrefined'
    );
  }

  function processingQueueOptions(): Record<string, unknown> {
    if (mode === 'preprocessing') return preprocessingQueueOptions();
    if (mode === 'segmentation') {
      return {
        ...thresholdOptions(),
        ...maskAugmentationOptions(),
        ...roiAssemblyOptions(),
        ...roiFilterOptions(),
        ...roiRecordingOptions(),
        frame_payload_kind: 'preprocessed',
        apply_preprocessing: false
      };
    }
    return roiRefinementOptions();
  }

  function preprocessingQueueOptions(): Record<string, unknown> {
    return {
      min_field_value: minFieldValue,
      max_field_value: maxFieldValue,
      apply_mask: applyMask,
      crop_enabled: cropEnabled,
      crop_x: cropEnabled ? cropX : undefined,
      crop_y: cropEnabled ? cropY : undefined,
      crop_w: cropEnabled ? cropW : undefined,
      crop_h: cropEnabled ? cropH : undefined
    };
  }

  function processingQueueRequest(): ProcessingQueueRequest {
    return {
      stage: processingQueueStage(),
      filters: processingQueueFilters(),
      options: processingQueueOptions(),
      dry_run: false
    };
  }

  function scheduleStatusRefresh() {
    if (statusRefreshTimer !== null) window.clearTimeout(statusRefreshTimer);
    statusRefreshTimer = window.setTimeout(() => {
      statusRefreshTimer = null;
      void refreshStatusSummary();
    }, 150);
  }

  async function refreshStatusSummary() {
    const client = getClient();
    if (!client) return;
    const sequence = ++statusRefreshSequence;
    try {
      const response = await client.processingStatusFacets(activeStatusFacetFilters());
      if (sequence !== statusRefreshSequence) return;
      const facets = response.facets ?? {};
      activeStatusSummary = response.summary ?? {};
      statusSnapshotVersion = String(response.snapshot?.status_version ?? '') || null;
      assetOptionFrameCounts = facetCountMap(facets.assets);
      collectionOptionFrameCounts = facetCountMap(facets.collections);
      preprocessOptionFrameCounts =
        mode === 'preprocessing' ? facetCountMap(facets.preprocessing_status) : new Map<string, number>();
      detectionOptionFrameCounts =
        mode === 'segmentation' ? facetCountMap(facets.candidate_detection_status) : new Map<string, number>();
      refinementOptionRoiCounts =
        mode === 'roi_refinement' ? facetCountMap(facets.refinement_state) : new Map<string, number>();
    } catch (err) {
      if (sequence === statusRefreshSequence) {
        error = err instanceof Error ? err.message : String(err);
      }
    }
  }

  function facetCountMap(facet: ProcessingStatusFacets[keyof ProcessingStatusFacets] | undefined): Map<string, number> {
    return new Map(Object.entries(facet ?? {}).map(([key, value]) => [key, numericStatusValue(value)]));
  }

  function stateLabel(state: string): string {
    return state
      .replace(/_/g, '-')
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  function countFor(counts: Map<string, number>, value: string): number {
    return counts.get(value) ?? 0;
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

    if (queueBlocked) {
      error =
        `Cannot queue segmentation from preprocessed frames because ${formatCount(missingPreprocessedFrameCount)} selected frame${missingPreprocessedFrameCount === 1 ? '' : 's'} lack preprocessed payloads.`;
      queueing = false;
      return;
    }

    let response: ProcessingQueueResponse;
    try {
      response = await client.queueProcessing(processingQueueRequest());
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      queueing = false;
      return;
    }

    const queued = numericStatusValue(response.job_count);
    const matchedCount = numericStatusValue(response.matched_count);
    if (queued === 0) {
      error = `No eligible ${queueItemLabelPlural} matched the current filters.`;
      queueing = false;
      return;
    }
    submittedJobIds = [...(response.job_ids ?? []), ...submittedJobIds].slice(0, 100);
    message = `Queued ${formatCount(queued)} ${mode === 'preprocessing' ? 'preprocessing' : mode === 'segmentation' ? 'segmentation' : 'ROI refinement'} batch job${queued === 1 ? '' : 's'} covering ${formatCount(matchedCount)} ${matchedCount === 1 ? queueItemLabel : queueItemLabelPlural}.`;
    scheduleStatusRefresh();
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
    const steps = normalizedMaskSteps();
    const hasStep = (step: string) => maskAugmentationEnabled && steps.includes(step);
    return {
      mask_augmentation_enabled: maskAugmentationEnabled,
      mask_augmentation_steps: maskAugmentationEnabled ? steps : [],
      dilate_kernel_w: hasStep('dilate') ? dilateKernelW : undefined,
      dilate_kernel_h: hasStep('dilate') ? dilateKernelH : undefined,
      dilate_iterations: hasStep('dilate') ? dilateIterations : undefined,
      erode_kernel_w: hasStep('erode') ? erodeKernelW : undefined,
      erode_kernel_h: hasStep('erode') ? erodeKernelH : undefined,
      erode_iterations: hasStep('erode') ? erodeIterations : undefined,
      open_kernel_w: hasStep('open') ? openKernelW : undefined,
      open_kernel_h: hasStep('open') ? openKernelH : undefined,
      open_iterations: hasStep('open') ? openIterations : undefined,
      close_kernel_w: hasStep('close') ? closeKernelW : undefined,
      close_kernel_h: hasStep('close') ? closeKernelH : undefined,
      close_iterations: hasStep('close') ? closeIterations : undefined,
      fill_holes: maskAugmentationEnabled && fillHoles ? true : undefined,
      remove_small_components: maskAugmentationEnabled && removeSmallComponents ? true : undefined,
      min_component_area: maskAugmentationEnabled && removeSmallComponents ? minComponentArea : undefined,
      clear_border: maskAugmentationEnabled && clearBorder ? true : undefined
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
      store_roi_payload_min_area: storeRoiPayloadMinArea,
      store_roi_payload_min_width: storeRoiPayloadMinWidth,
      store_roi_payload_min_height: storeRoiPayloadMinHeight,
      store_roi_payload_min_width_plus_height: storeRoiPayloadMinWidthPlusHeight
    };
  }

  function roiRefinementOptions(): Record<string, unknown> {
    return {
      method: refinementMethod,
      model_ref: refinementModelRef || undefined,
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
    return steps;
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

  function hasSettingValue(value: unknown): boolean {
    return value !== null && value !== undefined && value !== '';
  }

  function numberSettingChanged(value: unknown, defaultValue: number): boolean {
    if (!hasSettingValue(value)) return false;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed !== defaultValue;
  }

  function nullableNumberSettingEquals(value: unknown, defaultValue: number | null): boolean {
    if (!hasSettingValue(value)) return defaultValue === null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed === defaultValue;
  }

  function thresholdAdvancedSettingsActive(): boolean {
    if (fieldChanged('thresholdMethod', thresholdMethod)) return true;
    if (thresholdMethod === 'manual') return fieldChanged('manualThreshold', manualThreshold);
    if (usesBoundedOtsu(thresholdMethod)) {
      return (
        fieldChanged('thresholdingMaximumValue', thresholdingMaximumValue) ||
        fieldChanged('boundedOtsuMinContrast', boundedOtsuMinContrast) ||
        fieldChanged('boundedOtsuMaxForegroundFraction', boundedOtsuMaxForegroundFraction) ||
        (thresholdMethod === 'bounded_otsu_canny' && fieldChanged('cannyEnabled', cannyEnabled)) ||
        fieldChanged('cannyLowThreshold', cannyLowThreshold) ||
        fieldChanged('cannyHighThreshold', cannyHighThreshold) ||
        fieldChanged('cannyBlurKernel', cannyBlurKernel)
      );
    }
    if (thresholdMethod === 'otsu') return fieldChanged('thresholdingMaximumValue', thresholdingMaximumValue);
    if (thresholdMethod === 'canny') {
      return (
        fieldChanged('cannyLowThreshold', cannyLowThreshold) ||
        fieldChanged('cannyHighThreshold', cannyHighThreshold) ||
        fieldChanged('cannyBlurKernel', cannyBlurKernel)
      );
    }
    if (thresholdMethod === 'adaptive_mean' || thresholdMethod === 'adaptive_gaussian') {
      return fieldChanged('adaptiveBlockSize', adaptiveBlockSize) || fieldChanged('adaptiveC', adaptiveC);
    }
    if (thresholdMethod === 'percentile_background') {
      return (
        fieldChanged('percentileBackgroundPercentile', percentileBackgroundPercentile) ||
        fieldChanged('percentileMinContrast', percentileMinContrast)
      );
    }
    if (thresholdMethod === 'hysteresis') {
      return (
        fieldChanged('hysteresisLowThreshold', hysteresisLowThreshold) ||
        fieldChanged('hysteresisHighThreshold', hysteresisHighThreshold) ||
        fieldChanged('hysteresisConnectivity', hysteresisConnectivity)
      );
    }
    if (thresholdMethod === 'sobel_edges') {
      return (
        fieldChanged('sobelThreshold', sobelThreshold) ||
        fieldChanged('sobelPercentile', sobelPercentile) ||
        fieldChanged('sobelKernelSize', sobelKernelSize)
      );
    }
    return false;
  }

  function maskAugmentationSettingsActive(): boolean {
    const steps = normalizedMaskSteps();
    const hasStep = (step: string) => maskAugmentationEnabled && steps.includes(step);
    return (
      fieldChanged('maskAugmentationEnabled', maskAugmentationEnabled) ||
      (maskAugmentationEnabled &&
        (fieldChanged('maskAugmentationSteps', steps) ||
          (hasStep('dilate') &&
            (fieldChanged('dilateKernelW', dilateKernelW) ||
              fieldChanged('dilateKernelH', dilateKernelH) ||
              fieldChanged('dilateIterations', dilateIterations))) ||
          (hasStep('erode') &&
            (fieldChanged('erodeKernelW', erodeKernelW) ||
              fieldChanged('erodeKernelH', erodeKernelH) ||
              fieldChanged('erodeIterations', erodeIterations))) ||
          (hasStep('open') &&
            (fieldChanged('openKernelW', openKernelW) ||
              fieldChanged('openKernelH', openKernelH) ||
              fieldChanged('openIterations', openIterations))) ||
          (hasStep('close') &&
            (fieldChanged('closeKernelW', closeKernelW) ||
              fieldChanged('closeKernelH', closeKernelH) ||
              fieldChanged('closeIterations', closeIterations))) ||
          fieldChanged('fillHoles', fillHoles) ||
          fieldChanged('removeSmallComponents', removeSmallComponents) ||
          ((removeSmallComponents || hasStep('remove_small_components')) &&
            fieldChanged('minComponentArea', minComponentArea)) ||
          fieldChanged('clearBorder', clearBorder)))
    );
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
              <span>Default: unrefined ROIs</span>
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
        <label class="check-row" class:has-field-override={fieldChanged('applyMask', applyMask)}>
          <input type="checkbox" bind:checked={applyMask} />
          Apply frame mask
        </label>
        <div class="form-grid compact-grid">
          <label class:has-field-override={fieldChanged('minFieldValue', minFieldValue)}>
            <span class="field-label-row">
              Min field value
              <InfoChip
                label="Minimum field value help"
                text="Correction-field pixels below this mean sensor value are treated as invalid and replaced with the fallback mean value, usually 255."
              />
            </span>
            <input type="range" min="0" max="255" step="1" bind:value={minFieldValue} />
            <span class="range-value">{minFieldValue}</span>
          </label>
          <label class:has-field-override={fieldChanged('maxFieldValue', maxFieldValue)}>
            <span class="field-label-row">
              Max field value
              <InfoChip
                label="Maximum field value help"
                text="Correction-field pixels above this mean sensor value are treated as invalid and replaced with the fallback mean value, usually 255."
              />
            </span>
            <input type="range" min="1" max="4096" step="1" bind:value={maxFieldValue} />
            <span class="range-value">{maxFieldValue ?? 'none'}</span>
          </label>
        </div>
      </div>

      <details class="form-section collapsible-section">
        <summary class="section-heading" class:has-active-settings={preprocessingAdvancedActive}>
          <span>
            <p class="eyebrow">Advanced options</p>
            <strong>Preprocessing details</strong>
          </span>
        </summary>
        <label class="check-row" class:has-field-override={fieldChanged('cropEnabled', cropEnabled)}>
          <input type="checkbox" bind:checked={cropEnabled} />
          Crop image
        </label>
        <div class="form-grid compact-grid">
          <label class:field-disabled={!cropEnabled} class:has-field-override={fieldChanged('cropX', cropX)}>
            Crop x
            <input type="number" min="0" bind:value={cropX} disabled={!cropEnabled} />
          </label>
          <label class:field-disabled={!cropEnabled} class:has-field-override={fieldChanged('cropY', cropY)}>
            Crop y
            <input type="number" min="0" bind:value={cropY} disabled={!cropEnabled} />
          </label>
          <label class:field-disabled={!cropEnabled} class:has-field-override={fieldChanged('cropW', cropW)}>
            Crop width
            <input type="number" min="1" bind:value={cropW} disabled={!cropEnabled} />
          </label>
          <label class:field-disabled={!cropEnabled} class:has-field-override={fieldChanged('cropH', cropH)}>
            Crop height
            <input type="number" min="1" bind:value={cropH} disabled={!cropEnabled} />
          </label>
        </div>
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
          <label class:has-field-override={fieldChanged('thresholdMethod', thresholdMethod)}>
            <span class="field-label-row">
              Threshold method
              <HelpChip topic="threshold-methods" label="Open threshold method help" />
            </span>
            <select bind:value={thresholdMethod}>
              {#each thresholdMethods as method}
                <option value={method}>{method}</option>
              {/each}
            </select>
          </label>
          <label class:has-field-override={fieldChanged('roiAssemblyMethod', roiAssemblyMethod)}>
            <span class="field-label-row">
              Method
              <InfoChip
                label="Candidate assembly method help"
                text="Controls how connected foreground mask regions are converted into candidate ROI objects."
              />
            </span>
            <select bind:value={roiAssemblyMethod}>
              {#each roiAssemblyMethods as method}
                <option value={method}>{method}</option>
              {/each}
            </select>
          </label>
          <label class:has-field-override={fieldChanged('minWidth', minWidth)}>
            Min width
            <input type="number" min="0" bind:value={minWidth} placeholder="none" />
          </label>
          <label class:has-field-override={fieldChanged('minHeight', minHeight)}>
            Min height
            <input type="number" min="0" bind:value={minHeight} placeholder="none" />
          </label>
        </div>
      </div>

      <details class="form-section collapsible-section">
        <summary class="section-heading" class:has-active-settings={candidateDetectionAdvancedActive}>
          <span>
            <p class="eyebrow">Advanced options</p>
            <strong>Candidate detection details</strong>
          </span>
        </summary>

        <details class="control-details" open>
          <summary class:has-active-settings={thresholdAdvancedActive}>Threshold</summary>
        {#if thresholdMethod === 'manual'}
          <label class:has-field-override={fieldChanged('manualThreshold', manualThreshold)}>
            Manual threshold
            <InfoChip
              label="Manual threshold help"
              text="Pixels at or above this value enter the foreground mask before optional mask augmentation."
            />
            <input type="number" min="0" max="255" bind:value={manualThreshold} />
          </label>
        {/if}
        {#if usesThresholdMaximum(thresholdMethod)}
          <label class:has-field-override={fieldChanged('thresholdingMaximumValue', thresholdingMaximumValue)}>
            Maximum threshold
            <InfoChip
              label="Maximum threshold help"
              text="Optional upper intensity clamp for methods that produce a threshold value. Leave empty when no upper clamp is needed."
            />
            <input type="number" min="0" max="255" bind:value={thresholdingMaximumValue} placeholder="none" />
          </label>
        {/if}
        {#if usesBoundedOtsu(thresholdMethod)}
          <label class:has-field-override={fieldChanged('boundedOtsuMinContrast', boundedOtsuMinContrast)}>
            Minimum contrast
            <InfoChip
              label="Minimum contrast help"
              text="Rejects weak threshold masks when foreground and background are not separated by at least this intensity difference."
            />
            <input type="range" min="0" max="255" step="1" bind:value={boundedOtsuMinContrast} />
            <span class="range-value">{boundedOtsuMinContrast}</span>
          </label>
          <label class:has-field-override={fieldChanged('boundedOtsuMaxForegroundFraction', boundedOtsuMaxForegroundFraction)}>
            Max foreground fraction
            <InfoChip
              label="Maximum foreground fraction help"
              text="Rejects masks that classify too much of the frame as foreground, which usually indicates a bad threshold."
            />
            <input type="range" min="0" max="1" step="0.01" bind:value={boundedOtsuMaxForegroundFraction} />
            <span class="range-value">{boundedOtsuMaxForegroundFraction.toFixed(2)}</span>
          </label>
        {/if}
        {#if thresholdMethod === 'bounded_otsu_canny'}
          <label class="check-row" class:has-field-override={fieldChanged('cannyEnabled', cannyEnabled)}>
            <input type="checkbox" bind:checked={cannyEnabled} />
            Add Canny edges
          </label>
        {/if}
        {#if usesCanny(thresholdMethod)}
          <div class="form-grid compact-grid">
            <label class:has-field-override={fieldChanged('cannyLowThreshold', cannyLowThreshold)}>
              Canny low
              <input type="number" min="0" max="255" bind:value={cannyLowThreshold} />
            </label>
            <label class:has-field-override={fieldChanged('cannyHighThreshold', cannyHighThreshold)}>
              Canny high
              <input type="number" min="0" max="255" bind:value={cannyHighThreshold} />
            </label>
            <label class:has-field-override={fieldChanged('cannyBlurKernel', cannyBlurKernel)}>
              Blur kernel
              <input type="number" min="1" step="2" bind:value={cannyBlurKernel} />
            </label>
          </div>
        {/if}
        {#if thresholdMethod === 'adaptive_mean' || thresholdMethod === 'adaptive_gaussian'}
          <div class="form-grid compact-grid">
            <label class:has-field-override={fieldChanged('adaptiveBlockSize', adaptiveBlockSize)}>
              Block size
              <input type="number" min="3" step="2" bind:value={adaptiveBlockSize} />
            </label>
            <label class:has-field-override={fieldChanged('adaptiveC', adaptiveC)}>
              C offset
              <input type="number" bind:value={adaptiveC} />
            </label>
          </div>
        {/if}
        {#if thresholdMethod === 'percentile_background'}
          <label class:has-field-override={fieldChanged('percentileBackgroundPercentile', percentileBackgroundPercentile)}>
            Background percentile
            <input type="range" min="0" max="100" step="1" bind:value={percentileBackgroundPercentile} />
            <span class="range-value">{percentileBackgroundPercentile}</span>
          </label>
          <label class:has-field-override={fieldChanged('percentileMinContrast', percentileMinContrast)}>
            Minimum contrast
            <input type="range" min="0" max="255" step="1" bind:value={percentileMinContrast} />
            <span class="range-value">{percentileMinContrast}</span>
          </label>
        {/if}
        {#if thresholdMethod === 'hysteresis'}
          <div class="form-grid compact-grid">
            <label class:has-field-override={fieldChanged('hysteresisLowThreshold', hysteresisLowThreshold)}>
              Low threshold
              <input type="number" min="0" max="255" bind:value={hysteresisLowThreshold} />
            </label>
            <label class:has-field-override={fieldChanged('hysteresisHighThreshold', hysteresisHighThreshold)}>
              High threshold
              <input type="number" min="0" max="255" bind:value={hysteresisHighThreshold} />
            </label>
            <label class:has-field-override={fieldChanged('hysteresisConnectivity', hysteresisConnectivity)}>
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
            <label class:has-field-override={fieldChanged('sobelThreshold', sobelThreshold)}>
              Sobel threshold
              <input type="number" bind:value={sobelThreshold} placeholder="percentile" />
            </label>
            <label class:has-field-override={fieldChanged('sobelPercentile', sobelPercentile)}>
              Percentile
              <input type="range" min="0" max="100" step="1" bind:value={sobelPercentile} />
              <span class="range-value">{sobelPercentile}</span>
            </label>
            <label class:has-field-override={fieldChanged('sobelKernelSize', sobelKernelSize)}>
              Kernel size
              <input type="number" min="1" step="2" bind:value={sobelKernelSize} />
            </label>
          </div>
        {/if}
        </details>

        <details class="control-details" open>
          <summary class:has-active-settings={maskAugmentationAdvancedActive}>
            <span class="field-label-row">
              Mask augmentation
              <HelpChip topic="mask-augmentation" label="Open mask augmentation help" />
            </span>
          </summary>
        <label class="check-row" class:has-field-override={fieldChanged('maskAugmentationEnabled', maskAugmentationEnabled)}>
          <input type="checkbox" bind:checked={maskAugmentationEnabled} />
          Enable mask augmentation
        </label>
        {#if maskAugmentationEnabled}
          <div class="toggle-list field-control" class:has-field-override={fieldChanged('maskAugmentationSteps', [...maskAugmentationSteps])}>
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
            <label class:has-field-override={fieldChanged('dilateKernelW', dilateKernelW)}>
              Dilate width
              <input type="number" min="1" bind:value={dilateKernelW} />
            </label>
            <label class:has-field-override={fieldChanged('dilateKernelH', dilateKernelH)}>
              Dilate height
              <input type="number" min="1" bind:value={dilateKernelH} />
            </label>
            <label class:has-field-override={fieldChanged('dilateIterations', dilateIterations)}>
              Dilate iterations
              <input type="number" min="1" bind:value={dilateIterations} />
            </label>
            <label class:has-field-override={fieldChanged('erodeKernelW', erodeKernelW)}>
              Erode width
              <input type="number" min="1" bind:value={erodeKernelW} />
            </label>
            <label class:has-field-override={fieldChanged('erodeKernelH', erodeKernelH)}>
              Erode height
              <input type="number" min="1" bind:value={erodeKernelH} />
            </label>
            <label class:has-field-override={fieldChanged('erodeIterations', erodeIterations)}>
              Erode iterations
              <input type="number" min="1" bind:value={erodeIterations} />
            </label>
          </div>
          <details class="control-details">
            <summary>Additional mask controls</summary>
            <div class="form-grid compact-grid">
              <label class:has-field-override={fieldChanged('openKernelW', openKernelW)}>
                Open width
                <input type="number" min="1" bind:value={openKernelW} />
              </label>
              <label class:has-field-override={fieldChanged('openKernelH', openKernelH)}>
                Open height
                <input type="number" min="1" bind:value={openKernelH} />
              </label>
              <label class:has-field-override={fieldChanged('openIterations', openIterations)}>
                Open iterations
                <input type="number" min="1" bind:value={openIterations} />
              </label>
              <label class:has-field-override={fieldChanged('closeKernelW', closeKernelW)}>
                Close width
                <input type="number" min="1" bind:value={closeKernelW} />
              </label>
              <label class:has-field-override={fieldChanged('closeKernelH', closeKernelH)}>
                Close height
                <input type="number" min="1" bind:value={closeKernelH} />
              </label>
              <label class:has-field-override={fieldChanged('closeIterations', closeIterations)}>
                Close iterations
                <input type="number" min="1" bind:value={closeIterations} />
              </label>
              <label class:has-field-override={fieldChanged('minComponentArea', minComponentArea)}>
                Min component area
                <input type="number" min="0" bind:value={minComponentArea} />
              </label>
            </div>
            <label class="check-row" class:has-field-override={fieldChanged('fillHoles', fillHoles)}>
              <input type="checkbox" bind:checked={fillHoles} />
              Fill holes
            </label>
            <label class="check-row" class:has-field-override={fieldChanged('removeSmallComponents', removeSmallComponents)}>
              <input type="checkbox" bind:checked={removeSmallComponents} />
              Remove small components
            </label>
            <label class="check-row" class:has-field-override={fieldChanged('clearBorder', clearBorder)}>
              <input type="checkbox" bind:checked={clearBorder} />
              Clear border components
            </label>
          </details>
        {/if}
        </details>

        <details class="control-details" open>
          <summary>Geometry and assembly</summary>
        <div class="form-grid compact-grid">
          <label class:has-field-override={fieldChanged('roiAssemblyConnectivity', roiAssemblyConnectivity)}>
            Connectivity
            <InfoChip
              label="Connectivity help"
              text="4-connectivity joins edge-adjacent pixels only; 8-connectivity also joins diagonal neighbors."
            />
            <select bind:value={roiAssemblyConnectivity}>
              <option value={4}>4</option>
              <option value={8}>8</option>
            </select>
          </label>
          <label class:has-field-override={fieldChanged('minArea', minArea)}>
            Min area
            <InfoChip
              label="Minimum area help"
              text="Drops candidate ROIs whose foreground area is smaller than this value."
            />
            <input type="number" min="0" bind:value={minArea} placeholder="none" />
          </label>
          <label class:has-field-override={fieldChanged('maxArea', maxArea)}>
            Max area
            <input type="number" min="0" bind:value={maxArea} placeholder="none" />
          </label>
          <label class:has-field-override={fieldChanged('minPerimeter', minPerimeter)}>
            Min perimeter
            <input type="number" min="0" bind:value={minPerimeter} />
          </label>
          <label class:has-field-override={fieldChanged('maxPerimeter', maxPerimeter)}>
            Max perimeter
            <input type="number" min="0" bind:value={maxPerimeter} placeholder="none" />
          </label>
          <label class:has-field-override={fieldChanged('maxWidth', maxWidth)}>
            Max width
            <input type="number" min="0" bind:value={maxWidth} placeholder="none" />
          </label>
          <label class:has-field-override={fieldChanged('maxHeight', maxHeight)}>
            Max height
            <input type="number" min="0" bind:value={maxHeight} placeholder="none" />
          </label>
          <label class:has-field-override={fieldChanged('minWidthPlusHeight', minWidthPlusHeight)}>
            Min width + height
            <input type="number" min="0" bind:value={minWidthPlusHeight} placeholder="none" />
          </label>
          <label class:has-field-override={fieldChanged('maxWidthPlusHeight', maxWidthPlusHeight)}>
            Max width + height
            <input type="number" min="0" bind:value={maxWidthPlusHeight} placeholder="none" />
          </label>
        </div>
        </details>

        <details class="control-details" open>
          <summary class:has-active-settings={fieldChanged('padding', padding) || payloadStorageThresholdsActive}>
            <span class="field-label-row">
              ROI payloads
              <HelpChip topic="roi-storage" label="Open ROI payload storage help" />
            </span>
          </summary>
        <label class:has-field-override={fieldChanged('padding', padding)}>
          Padding
          <InfoChip
            label="ROI padding help"
            text="Extra pixels added around each candidate crop before storing the ROI image payload."
          />
          <input type="range" min="0" max="500" step="1" bind:value={padding} />
          <span class="range-value">{padding}</span>
        </label>
        <div class="form-grid compact-grid">
          <label class:has-field-override={fieldChanged('storeRoiPayloadMinArea', storeRoiPayloadMinArea)}>
            Store payload min area
            <input type="number" min="0" bind:value={storeRoiPayloadMinArea} placeholder="none" />
          </label>
          <label class:has-field-override={fieldChanged('storeRoiPayloadMinWidth', storeRoiPayloadMinWidth)}>
            Store payload min width
            <input type="number" min="0" bind:value={storeRoiPayloadMinWidth} placeholder="none" />
          </label>
          <label class:has-field-override={fieldChanged('storeRoiPayloadMinHeight', storeRoiPayloadMinHeight)}>
            Store payload min height
            <input type="number" min="0" bind:value={storeRoiPayloadMinHeight} placeholder="none" />
          </label>
          <label class:has-field-override={fieldChanged('storeRoiPayloadMinWidthPlusHeight', storeRoiPayloadMinWidthPlusHeight)}>
            Store payload min width + height
            <input type="number" min="0" bind:value={storeRoiPayloadMinWidthPlusHeight} placeholder="none" />
          </label>
        </div>
        </details>
      </details>
    {:else}
      <div class="form-section">
        <div class="section-heading">
          <span>
            <p class="eyebrow">Model selection</p>
            <strong>Refinement model</strong>
            <HelpChip topic="refinement-models" label="Open ROI refinement help" />
          </span>
        </div>
        <label>
          Refinement method
          <select bind:value={refinementMethod}>
            <option value="oracle">Oracle mask refinement</option>
            <option value="identity">Identity — promote candidates unchanged</option>
          </select>
        </label>
        {#if refinementMethod === 'identity'}
          <p class="muted">Selected candidate ROIs will become refined ROIs without model inference, expansion, residual discovery, or overlap reconciliation.</p>
        {:else}
        <p class="muted">Oracle Builder status: {oracleStatus}</p>
        {#if refinementModelRefs.length}
          <label class:has-field-override={fieldChanged('refinementModelRef', refinementModelRef)}>
            Model reference
            <select bind:value={refinementModelRef}>
              <option value="">Default</option>
              {#each refinementModelRefs as modelRef}
                <option value={modelRef}>{modelRef}</option>
              {/each}
            </select>
          </label>
        {:else}
          <label class:has-field-override={fieldChanged('refinementModelRef', refinementModelRef)}>
            Model reference
            <input bind:value={refinementModelRef} placeholder="default" />
          </label>
        {/if}
        {/if}
      </div>

      <details class="form-section collapsible-section">
        <summary class="section-heading" class:has-active-settings={refinementAdvancedActive}>
          <span>
            <p class="eyebrow">Advanced options</p>
            <strong>ROI refinement details</strong>
          </span>
        </summary>

        {#if refinementMethod === 'oracle'}
        <details class="control-details" open>
          <summary>Frame-aware ROI growth</summary>
          <label class="check-row" class:has-field-override={fieldChanged('refinementAllowFrameExpansion', refinementAllowFrameExpansion)}>
            <input type="checkbox" bind:checked={refinementAllowFrameExpansion} />
            Allow frame expansion
          </label>
          <label class:has-field-override={fieldChanged('refinementMaxIterations', refinementMaxIterations)}>
            Max iterations
            <input type="number" min="1" step="1" bind:value={refinementMaxIterations} />
          </label>
          <label class:has-field-override={fieldChanged('refinementExpansionPixels', refinementExpansionPixels)}>
            Expansion pixels
            <input type="number" min="1" step="1" bind:value={refinementExpansionPixels} placeholder="tile stride" />
          </label>
          <label class:has-field-override={fieldChanged('refinementEdgeTouchMargin', refinementEdgeTouchMargin)}>
            Edge touch margin
            <input type="number" min="1" step="1" bind:value={refinementEdgeTouchMargin} />
          </label>
        </details>
        {/if}

        <details class="control-details" open>
          <summary>Refined detections</summary>
          <label class="check-row" class:has-field-override={fieldChanged('refinementStore', refinementStore)}>
            <input type="checkbox" bind:checked={refinementStore} />
            Store refined detections
          </label>
          <label class:has-field-override={fieldChanged('refinementEncoding', refinementEncoding)}>
            Encoding
            <select bind:value={refinementEncoding}>
              <option value="auto">default</option>
              {#each refinementEncodingOptions as encoding}
                {#if encoding !== 'auto'}
                  <option
                    value={encoding}
                    disabled={!codecAvailable(imageCodecAvailability, encoding)}
                    title={codecUnavailableTitle(imageCodecAvailability, encoding)}
                  >{encoding}</option>
                {/if}
              {/each}
            </select>
          </label>
          <label class="check-row" class:has-field-override={fieldChanged('refinementDryRun', refinementDryRun)}>
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
    </div>

    <button type="button" on:click={queueJobs} disabled={queueing || prospectiveQueueItemCount === 0 || queueBlocked}>
      {queueing ? 'Queueing' : actionLabel}
    </button>
    <p class="soft">
      The backend will plan optimized jobs for {formatCount(prospectiveQueueItemCount)} selected {prospectiveQueueItemCount === 1 ? queueItemLabel : queueItemLabelPlural}.
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
