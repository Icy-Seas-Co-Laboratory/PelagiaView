<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import FrameDisplayToggle from '$lib/components/FrameDisplayToggle.svelte';
  import KonvaImageCanvas from '$lib/components/KonvaImageCanvas.svelte';
  import ProcessingPresetControls from '$lib/components/ProcessingPresetControls.svelte';
  import { ApiError, authenticatedFetch } from '$lib/api/client';
  import { listProcessingPresets, saveProcessingPreset } from '$lib/api/processingPresets';
  import { imageInversionEnabled } from '$lib/stores/displayPreferences';
  import { getClient } from '$lib/stores/session';
  import type {
    DetectionSummary,
    FrameSummary,
    LiveThresholdResponse,
    RawAsset,
    RoiRefinementCapabilities,
    SegmentationCapabilities,
    SegmentationOptions,
    SystemConfigResponse
  } from '$lib/api/types';
  import {
    booleanDefault,
    nullableNumberDefault,
    numberDefault,
    processingSection,
    stringDefault
  } from '$lib/utils/configDefaults';
  import {
    frameCaption,
    payloadKindForDisplay,
    type FrameDisplayMode
  } from '$lib/utils/frameDisplay';
  import { formatBytes, formatCount } from '$lib/utils/format';
  import type {
    ImageLayer,
    ImageOverlayBlendMode,
    ImageOverlayColorMode,
    ImageOverlayImage,
    ImageOverlayRect,
    ImageRenderSpec
  } from '$lib/utils/imageRenderSpec';
  import type { ProcessingPreset, ProcessingSettings } from '$lib/processing/settings';
  import {
    PROCESSING_PRESET_APPLIED_EVENT,
    processingPresetByKey,
    pruneProcessingSettings
  } from '$lib/processing/settings';
  import {
    applyProcessingPresetToSession,
    currentLiveProcessingPreset,
    processingPresetSession,
    setLiveProcessingPresetFromSettings
  } from '$lib/stores/processingPresetSession';
  import {
    booleanPreference,
    nullableNumberPreference as nullablePreferenceNumber,
    numberPreference,
    preferenceKey,
    readPreferences,
    stringArrayPreference,
    stringPreference,
    writePreferences
  } from '$lib/utils/preferences';

  let assets: RawAsset[] = [];
  let frames: FrameSummary[] = [];
  let detections: DetectionSummary[] = [];
  let refinedDetections: DetectionSummary[] = [];
  let selectedAssetId = '';
  let selectedAsset: RawAsset | null = null;
  let selectedFrameNum = 1;
  let frameCount = 0;
  let hasLivePreview = false;
  let bboxCoordinateBasis: BboxCoordinateBasis = 'original-frame';
  let imageNaturalWidth = 0;
  let imageNaturalHeight = 0;
  let imageScaleX: number | null = null;
  let imageScaleY: number | null = null;
  let imageHeaderSerial = 0;
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
  let frameDisplayMode: FrameDisplayMode = 'original';
  let preprocessedReloadKey = 0;
  let backgroundCorrection = false;
  let backgroundFrameLimit = 25;
  let backgroundMinFieldValue = 1;
  let backgroundMaxFieldValue: number | null = 255;
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
  let showCandidateMasks = true;
  let showRefinedMasks = true;
  let showMaskDifferences = false;
  let maskDifferenceUrls = new Map<string, string>();
  let maskDifferenceKey = '';
  let maskDifferenceSerial = 0;
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
  let refining = false;
  let flatfieldCorrection = false;
  let flatfieldQ = 0.5;
  let flatfieldAxis = 0;
  let flatfieldMinFieldValue = 10;
  let flatfieldMaxFieldValue: number | null = 255;
  let applyMask = false;
  let cropEnabled = false;
  let cropX: number | null = null;
  let cropY: number | null = null;
  let cropW: number | null = null;
  let cropH: number | null = null;
  let invertIntensity = false;
  let loading = true;
  let message: string | null = null;
  let error: string | null = null;
  let stageCounts: Record<string, number> = {};
  let preferencesReady = false;
  const cropPreviewWidth = 220;
  const cropPreviewHeight = 160;
  const frameImageWidth = 1100;
  const backgroundFrameLimitFloor = 25;
  const liveSandboxDeletionDelayMs = 900 * 1000;
  const pendingLiveSandboxDeletions = new Map<string, number>();
  let lastFrameImageKey = '';
  let failedImageUrl = '';
  let liveSandboxFrameId = '';
  let liveSandboxSourceFrameId = '';
  let liveSandboxPreprocessingKey = '';
  let thresholdMaskUrl = '';
  let thresholdForegroundPixels: number | null = null;
  let thresholdForegroundFraction: number | null = null;
  let thresholdOverlayColorMode: ImageOverlayColorMode = 'red';
  let thresholdOverlayBlendMode: ImageOverlayBlendMode | 'auto' = 'auto';
  let thresholdOverlayOpacity = 1;
  const thresholdOverlayColorOptions: Array<{ value: ImageOverlayColorMode; label: string }> = [
    { value: 'red', label: 'Red' },
    { value: 'white', label: 'White' },
    { value: 'black', label: 'Black' },
    { value: 'tint', label: 'Custom red' }
  ];
  const thresholdOverlayBlendOptions: Array<{ value: ImageOverlayBlendMode | 'auto'; label: string }> = [
    { value: 'auto', label: 'Auto' },
    { value: 'normal', label: 'Normal' },
    { value: 'add', label: 'Add' },
    { value: 'subtract', label: 'Subtract' },
    { value: 'screen', label: 'Screen' },
    { value: 'multiply', label: 'Multiply' },
    { value: 'darken', label: 'Darken' },
    { value: 'lighten', label: 'Lighten' }
  ];
  let refinementMaskOverlayColorMode: ImageOverlayColorMode = 'red';
  let refinementMaskOverlayBlendMode: ImageOverlayBlendMode | 'auto' = 'auto';
  let refinementMaskOverlayOpacity = 1;
  const refinementRoiDisplayMaxWidth = 360;
  const refinementRoiDisplayMaxHeight = 280;
  let lastDetectionPreviewKey = '';
  let lastAutoThresholdPreviewKey = '';
  let thresholdPreviewTimer: number | null = null;
  let thresholdPreviewSerial = 0;
  let detectionPreviewSerial = 0;
  const explorerPreferenceKey = preferenceKey('explorer');
  let processingPresets: ProcessingPreset[] = [];
  let selectedProcessingPresetKey = 'live:live';
  let presetMessage: string | null = null;
  let presetError: string | null = null;
  let presetsLoading = false;
  let lastProcessingPresetSessionKey = '';

  type ExplorerTab = 'preprocessing' | 'threshold' | 'detection' | 'refinement' | 'presets';
  const explorerTabs: Array<{ id: ExplorerTab; label: string }> = [
    { id: 'preprocessing', label: 'Preprocessing' },
    { id: 'threshold', label: 'Threshold' },
    { id: 'detection', label: 'Candidate Detection' },
    { id: 'refinement', label: 'Refinement' },
    { id: 'presets', label: 'Presets' }
  ];
  let activeExplorerTab: ExplorerTab = 'preprocessing';

  type ExplorerPreferences = {
    selectedAssetId: string;
    selectedFrameNum: number;
    frameDisplayMode: FrameDisplayMode;
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
    backgroundCorrection: boolean;
    backgroundFrameLimit: number;
    backgroundMinFieldValue: number;
    backgroundMaxFieldValue: number | null;
    flatfieldCorrection: boolean;
    flatfieldQ: number;
    flatfieldAxis: number;
    flatfieldMinFieldValue: number;
    flatfieldMaxFieldValue: number | null;
    applyMask: boolean;
    cropEnabled: boolean;
    cropX: number | null;
    cropY: number | null;
    cropW: number | null;
    cropH: number | null;
    invertIntensity: boolean;
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
    showCandidateMasks: boolean;
    showRefinedMasks: boolean;
    showMaskDifferences: boolean;
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
  };

  $: selectedFrame = findFrameByNumber(selectedFrameNum);
  $: {
    const clampedBackgroundFrameLimit = clampBackgroundFrameLimit(backgroundFrameLimit, frameCount);
    if (backgroundFrameLimit !== clampedBackgroundFrameLimit) backgroundFrameLimit = clampedBackgroundFrameLimit;
  }
  $: explorerPreferenceSnapshot = buildPreferenceSnapshot();
  $: if (preferencesReady) writePreferences(explorerPreferenceKey, explorerPreferenceSnapshot);
  $: liveProcessingPreset = $processingPresetSession.livePreset;
  $: availableProcessingPresets = [liveProcessingPreset, ...processingPresets];
  $: if (preferencesReady) {
    explorerPreferenceSnapshot;
    setLiveProcessingPresetFromSettings(captureProcessingSettings());
  }
  $: if ($processingPresetSession.selectedKey !== lastProcessingPresetSessionKey) {
    lastProcessingPresetSessionKey = $processingPresetSession.selectedKey;
    selectedProcessingPresetKey = $processingPresetSession.selectedKey;
  }
  $: framePayloadKind = payloadKindForDisplay(frameDisplayMode);
  $: imageInverted = framePayloadKind !== 'original' && $imageInversionEnabled;
  $: imageUrl =
    selectedAssetId && selectedFrameNum > 0
      ? framePreviewUrl(frameDisplayMode, preprocessedReloadKey, selectedFrame, liveSandboxFrameId)
      : '';
  $: imageUnavailable = Boolean(imageUrl && failedImageUrl === imageUrl);
  $: if ((activeExplorerTab === 'threshold' || activeExplorerTab === 'detection') && frameDisplayMode !== 'preprocessed') {
    frameDisplayMode = 'preprocessed';
  }
  $: void loadFrameImageHeaders(imageUrl);
  $: boxes = detections.map(toCropBox).filter((box): box is BBox => box !== null);
  $: targetBoxes = detections.map(toTargetBox).filter((box): box is BBox => box !== null);
  $: detectionOverlayKey = detectionOverlaySignature(boxes, targetBoxes, bboxCoordinateBasis);
  $: hasRefinementResults = refinedDetections.length > 0;
  $: refinementRoiPairs = buildRefinementRoiPairs(detections, refinedDetections);
  $: refinementSummary = summarizeRefinedDetections(refinedDetections);
  $: canvasOverlays = hasRefinementResults
    ? []
    : frameCanvasOverlays(
        boxes,
        targetBoxes,
        bboxCoordinateBasis
      );
  $: canvasMaskOverlays = frameMaskOverlays(
    detections,
    refinedDetections,
    bboxCoordinateBasis,
    showCandidateMasks,
    showRefinedMasks,
    showMaskDifferences,
    maskDifferenceUrls
  );
  $: void updateMaskDifferenceUrls(showMaskDifferences, detections, refinedDetections);
  $: preprocessingPreviewKey = preprocessingOptionsKey(
    backgroundCorrection,
    backgroundFrameLimit,
    backgroundMinFieldValue,
    backgroundMaxFieldValue,
    flatfieldCorrection,
    flatfieldQ,
    flatfieldAxis,
    flatfieldMinFieldValue,
    flatfieldMaxFieldValue,
    cropEnabled,
    cropX,
    cropY,
    cropW,
    cropH,
    invertIntensity
  );
  $: thresholdPreviewKey = thresholdOptionsKey(
    thresholdMethod,
    manualThreshold,
    thresholdingMaximumValue,
    boundedOtsuMinContrast,
    boundedOtsuMaxForegroundFraction,
    cannyEnabled,
    cannyLowThreshold,
    cannyHighThreshold,
    cannyBlurKernel,
    dilateKernelW,
    dilateKernelH,
    adaptiveBlockSize,
    adaptiveC,
    percentileBackgroundPercentile,
    percentileMinContrast,
    hysteresisLowThreshold,
    hysteresisHighThreshold,
    hysteresisConnectivity,
    sobelPercentile,
    sobelThreshold,
    sobelKernelSize
  );
  $: detectionPreviewKey = detectionOptionsKey(
    thresholdPreviewKey,
    minPerimeter,
    maxPerimeter,
    padding,
    {
      maskAugmentationEnabled,
      maskAugmentationSteps: [...maskAugmentationSteps],
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
      minWidth,
      maxWidth,
      minHeight,
      maxHeight,
      minWidthPlusHeight,
      maxWidthPlusHeight,
      roiEncoding,
      zstdMinBytes,
      alwaysStoreMask,
      storeRoiPayloadMinArea,
      storeRoiPayloadMinWidth,
      storeRoiPayloadMinHeight,
      storeRoiPayloadMinWidthPlusHeight
    }
  );
  $: resetLivePreviewForImageOptions(selectedAssetId, selectedFrameNum, preprocessingPreviewKey);
  $: resetCandidatePreviewForDetectionOptions(selectedFrame?.id ?? '', detectionPreviewKey);
  $: scheduleThresholdAutoPreview(activeExplorerTab, selectedFrame?.id ?? '', preprocessingPreviewKey, thresholdPreviewKey);

  onMount(() => {
    window.addEventListener(PROCESSING_PRESET_APPLIED_EVENT, handleHeaderProcessingPresetApplied);
    void initializeExplorer();
    return () => {
      window.removeEventListener(PROCESSING_PRESET_APPLIED_EVENT, handleHeaderProcessingPresetApplied);
    };
  });

  async function initializeExplorer() {
    const client = getClient();
    if (!client) return;
    try {
      const [config, segmentationCapabilities, roiRefinementCapabilities] = await Promise.all([
        client.systemConfig().catch(() => null),
        client.segmentationOptions().catch(() => null),
        client.roiRefinementOptions().catch(() => null)
      ]);
      applyConfigDefaults(config, segmentationCapabilities, roiRefinementCapabilities);
      restorePreferences();
      applyStoredLiveProcessingPreset();
      await loadProcessingPresets();
      assets = await client.listAssets('video');
      if (!assets.some((asset) => asset.id === selectedAssetId)) {
        selectedAssetId = assets[0]?.id ?? '';
      }
      preferencesReady = true;
      if (selectedAssetId) await loadFrames();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  onDestroy(() => {
    clearThresholdPreviewTimer();
    clearMaskDifferenceUrls();
    void cleanupLiveSandboxFrame();
  });

  function buildPreferenceSnapshot(): ExplorerPreferences {
    return {
      selectedAssetId,
      selectedFrameNum,
      frameDisplayMode,
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
      backgroundCorrection,
      backgroundFrameLimit,
      backgroundMinFieldValue,
      backgroundMaxFieldValue,
      flatfieldCorrection,
      flatfieldQ,
      flatfieldAxis,
      flatfieldMinFieldValue,
      flatfieldMaxFieldValue,
      applyMask,
      cropEnabled,
      cropX,
      cropY,
      cropW,
      cropH,
      invertIntensity,
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
      showCandidateMasks,
      showRefinedMasks,
      showMaskDifferences,
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
      refinementEncoding
    };
  }

  function captureProcessingSettings(): ProcessingSettings {
    return pruneProcessingSettings({
      ...currentLiveProcessingPreset().settings,
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
      backgroundCorrection,
      backgroundFrameLimit,
      backgroundMinFieldValue,
      backgroundMaxFieldValue,
      flatfieldCorrection,
      flatfieldQ,
      flatfieldAxis,
      flatfieldMinFieldValue,
      flatfieldMaxFieldValue,
      applyMask,
      cropEnabled,
      cropX,
      cropY,
      cropW,
      cropH,
      invertIntensity,
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
      refinementEncoding
    });
  }

  function applyProcessingSettings(settings: ProcessingSettings) {
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
    if ('backgroundFrameLimit' in settings) backgroundFrameLimit = clampBackgroundFrameLimit(numberPreference(settings.backgroundFrameLimit, backgroundFrameLimit), frameCount);
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
  }

  async function loadProcessingPresets() {
    presetsLoading = true;
    presetError = null;
    try {
      processingPresets = await listProcessingPresets();
    } catch (err) {
      presetError = err instanceof Error ? err.message : String(err);
    } finally {
      presetsLoading = false;
    }
  }

  function selectedProcessingPreset(): ProcessingPreset | null {
    return processingPresetByKey(availableProcessingPresets, selectedProcessingPresetKey);
  }

  function applySelectedProcessingPreset(preset = selectedProcessingPreset()) {
    if (!preset) return;
    presetMessage = null;
    presetError = null;
    if (preset.source === 'live') {
      presetMessage = 'Current session settings are already active.';
      return;
    }
    applyProcessingSettings(preset.settings);
    applyProcessingPresetToSession(preset);
    presetMessage = `Applied ${preset.name}.`;
  }

  async function saveCurrentProcessingPreset(nameInput: string, descriptionInput: string) {
    presetMessage = null;
    presetError = null;
    const name = nameInput.trim();
    if (!name) {
      presetError = 'Enter a preset name before saving.';
      return;
    }
    try {
      const preset = await saveProcessingPreset({
        name,
        description: descriptionInput,
        settings: captureProcessingSettings()
      });
      await loadProcessingPresets();
      applyProcessingPresetToSession(preset);
      presetMessage = `Saved ${preset.name}.`;
    } catch (err) {
      presetError = err instanceof Error ? err.message : String(err);
    }
  }

  function applyStoredLiveProcessingPreset() {
    const preset = currentLiveProcessingPreset();
    if (preset?.source === 'live' && preset.settings) {
      applyProcessingSettings(preset.settings);
    }
  }

  function handleHeaderProcessingPresetApplied(event: Event) {
    const preset = (event as CustomEvent<ProcessingPreset>).detail;
    if (!preset?.settings) return;
    applyProcessingSettings(preset.settings);
    if (preset.source === 'live') {
      setLiveProcessingPresetFromSettings(preset.settings, { selectedKey: 'live:live' });
    } else {
      applyProcessingPresetToSession(preset);
    }
    presetMessage = 'Applied header preset.';
    presetError = null;
  }

  function commitLivePresetSettings() {
    setLiveProcessingPresetFromSettings(captureProcessingSettings(), { selectedKey: 'live:live' });
  }

  function restorePreferences() {
    const preferences = readPreferences<ExplorerPreferences>(explorerPreferenceKey);
    if (!preferences) return;
    selectedAssetId = stringPreference(preferences.selectedAssetId, selectedAssetId);
    selectedFrameNum = numberPreference(preferences.selectedFrameNum, selectedFrameNum);
    frameDisplayMode = frameDisplayModePreference(preferences.frameDisplayMode, frameDisplayMode);
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
    backgroundCorrection = booleanPreference(preferences.backgroundCorrection, backgroundCorrection);
    backgroundFrameLimit = clampBackgroundFrameLimit(numberPreference(preferences.backgroundFrameLimit, backgroundFrameLimit), frameCount);
    backgroundMinFieldValue = numberPreference(preferences.backgroundMinFieldValue, backgroundMinFieldValue);
    backgroundMaxFieldValue = nullablePreferenceNumber(preferences.backgroundMaxFieldValue, backgroundMaxFieldValue);
    flatfieldCorrection = booleanPreference(preferences.flatfieldCorrection, flatfieldCorrection);
    flatfieldQ = numberPreference(preferences.flatfieldQ, flatfieldQ);
    flatfieldAxis = numberPreference(preferences.flatfieldAxis, flatfieldAxis);
    flatfieldMinFieldValue = numberPreference(preferences.flatfieldMinFieldValue, flatfieldMinFieldValue);
    flatfieldMaxFieldValue = nullablePreferenceNumber(preferences.flatfieldMaxFieldValue, flatfieldMaxFieldValue);
    enforcePreprocessingCorrectionMode();
    applyMask = booleanPreference(preferences.applyMask, applyMask);
    cropEnabled = booleanPreference(preferences.cropEnabled, cropEnabled);
    cropX = nullablePreferenceNumber(preferences.cropX, cropX);
    cropY = nullablePreferenceNumber(preferences.cropY, cropY);
    cropW = nullablePreferenceNumber(preferences.cropW, cropW);
    cropH = nullablePreferenceNumber(preferences.cropH, cropH);
    invertIntensity = booleanPreference(preferences.invertIntensity, invertIntensity);
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
    showCandidateMasks = booleanPreference(preferences.showCandidateMasks, showCandidateMasks);
    showRefinedMasks = booleanPreference(preferences.showRefinedMasks, showRefinedMasks);
    showMaskDifferences = booleanPreference(preferences.showMaskDifferences, showMaskDifferences);
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
  }

  function frameDisplayModePreference(value: unknown, fallback: FrameDisplayMode): FrameDisplayMode {
    if (value === 'preprocessed-inverted') return 'preprocessed';
    return value === 'original' || value === 'preprocessed' ? value : fallback;
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
    flatfieldCorrection = booleanDefault(flatfield, 'flatfield_correction', flatfieldCorrection);
    flatfieldQ = numberDefault(flatfield, 'flatfield_q', flatfieldQ);
    flatfieldAxis = numberDefault(flatfield, 'flatfield_axis', flatfieldAxis);
    flatfieldMinFieldValue = numberDefault(flatfield, 'flatfield_min_field_value', flatfieldMinFieldValue);
    flatfieldMaxFieldValue = nullableNumberDefault(flatfield, 'flatfield_max_field_value', flatfieldMaxFieldValue);
    backgroundCorrection = booleanDefault(preprocessing, 'background_correction', backgroundCorrection);
    backgroundFrameLimit = clampBackgroundFrameLimit(numberDefault(preprocessing, 'background_limit', backgroundFrameLimit), frameCount);
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

  async function loadFrames() {
    const client = getClient();
    if (!client || !selectedAssetId) return;
    error = null;
    await cleanupLiveSandboxFrame();
    hasLivePreview = false;
    selectedAsset = await client.getAsset(selectedAssetId);
    frameCount = selectedAsset.frame_count ?? 0;
    frames = frameCount > 0 ? await client.listFrames(selectedAssetId, frameCount) : [];
    selectedFrameNum = frameCount > 0 ? 1 : 0;
    detections = [];
    refinedDetections = [];
    stageCounts = {};
    bboxCoordinateBasis = 'original-frame';
    await loadDetections();
  }

  async function loadDetections() {
    const client = getClient();
    if (!client || !selectedAssetId) return;
    await cleanupLiveSandboxFrame();
    hasLivePreview = false;
    const frame = await ensureSelectedFrame();
    if (!frame?.id) {
      detections = [];
      refinedDetections = [];
      stageCounts = {};
      bboxCoordinateBasis = 'original-frame';
      return;
    }
    detections = await client.listDetections(selectedAssetId, frame.id);
    refinedDetections = [];
    stageCounts = {};
    bboxCoordinateBasis = 'original-frame';
  }

  function options() {
    return {
      ...thresholdOptions(),
      ...maskAugmentationOptions(),
      ...roiAssemblyOptions(),
      ...roiFilterOptions(),
      ...roiRecordingOptions(),
      frame_payload_kind: framePayloadKind,
      apply_preprocessing: framePayloadKind === 'original',
      ...preprocessingOptions()
    };
  }

  function thresholdOptions(): SegmentationOptions {
    const method = thresholdMethod;
    const options: SegmentationOptions = { threshold_method: method };
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

  function maskAugmentationOptions(): SegmentationOptions {
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

  function roiAssemblyOptions(): SegmentationOptions {
    return {
      roi_assembly_method: roiAssemblyMethod,
      roi_assembly_connectivity: roiAssemblyConnectivity
    };
  }

  function roiFilterOptions(): SegmentationOptions {
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

  function roiRecordingOptions(): SegmentationOptions {
    return {
      padding,
      roi_encoding: roiEncoding as SegmentationOptions['roi_encoding'],
      zstd_min_bytes: zstdMinBytes,
      always_store_mask: alwaysStoreMask,
      store_roi_payload_min_area: storeRoiPayloadMinArea,
      store_roi_payload_min_width: storeRoiPayloadMinWidth,
      store_roi_payload_min_height: storeRoiPayloadMinHeight,
      store_roi_payload_min_width_plus_height: storeRoiPayloadMinWidthPlusHeight
    };
  }

  function forceRoiPayloadRecordingOptions(): SegmentationOptions {
    return {
      ...options(),
      always_store_mask: true,
      store_roi_payload_min_area: 0,
      store_roi_payload_min_width: 0,
      store_roi_payload_min_height: 0,
      store_roi_payload_min_width_plus_height: 0
    };
  }

  function hasRoiPayload(detection: DetectionSummary): boolean {
    return Number(detection.roi_payload_bytes ?? 0) > 0;
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
      encoding: refinementEncoding === 'auto' ? undefined : refinementEncoding
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

  function preprocessingOptions() {
    const backgroundWindow = backgroundCorrection ? backgroundFrameWindow() : null;
    return {
      background_correction: backgroundCorrection,
      background_asset_id: backgroundCorrection ? selectedAssetId || undefined : undefined,
      background_start_frame: backgroundWindow?.startFrame,
      background_end_frame: backgroundWindow?.endFrame,
      background_limit: backgroundCorrection ? backgroundWindow?.limit : undefined,
      background_min_field_value: backgroundCorrection ? backgroundMinFieldValue : undefined,
      background_max_field_value: backgroundCorrection ? backgroundMaxFieldValue : undefined,
      flatfield_correction: backgroundCorrection ? false : flatfieldCorrection,
      flatfield_q: !backgroundCorrection && flatfieldCorrection ? flatfieldQ : undefined,
      flatfield_axis: !backgroundCorrection && flatfieldCorrection ? flatfieldAxis : undefined,
      flatfield_min_field_value: !backgroundCorrection && flatfieldCorrection ? flatfieldMinFieldValue : undefined,
      flatfield_max_field_value: !backgroundCorrection && flatfieldCorrection ? flatfieldMaxFieldValue : undefined,
      apply_mask: applyMask,
      crop_enabled: cropEnabled,
      crop_x: cropEnabled ? cropX : undefined,
      crop_y: cropEnabled ? cropY : undefined,
      crop_w: cropEnabled ? cropW : undefined,
      crop_h: cropEnabled ? cropH : undefined,
      invert_intensity: invertIntensity
    };
  }

  function livePreprocessingOptions() {
    return {
      ...preprocessingOptions(),
      apply_mask: false
    };
  }

  function liveDetectionCandidateOptions(): SegmentationOptions {
    return {
      ...thresholdOptions(),
      ...maskAugmentationOptions(),
      ...roiAssemblyOptions(),
      ...roiFilterOptions(),
      ...roiRecordingOptions()
    };
  }

  function framePreviewUrl(
    mode: FrameDisplayMode,
    reloadKey: number,
    frame: FrameSummary | undefined,
    sandboxFrameId = ''
  ): string {
    const client = getClient();
    if (!client || !selectedAssetId || selectedFrameNum < 1) return '';
    const kind = payloadKindForDisplay(mode);
    if (kind === 'preprocessed' && !sandboxFrameId) return '';
    const frameId = kind === 'preprocessed' ? sandboxFrameId : frame?.id;
    const base = {
      frame_id: frameId,
      asset_id: frameId ? undefined : selectedAssetId,
      frame_num: frameId ? undefined : selectedFrameNum,
      format: 'jpg',
      width: frameImageWidth,
      cache_bust: kind === 'preprocessed' && reloadKey ? reloadKey : undefined
    };
    return kind === 'preprocessed' ? client.preprocessedFrameUrl(base) : client.originalFrameUrl(base);
  }

  function preprocessingOptionsKey(
    backgroundEnabled: boolean,
    backgroundLimitValue: number,
    backgroundMinFieldValue: number,
    backgroundMaxFieldValue: number | null,
    flatfieldEnabled: boolean,
    flatfieldValue: number,
    flatfieldAxisValue: number,
    flatfieldMinFieldValue: number,
    flatfieldMaxFieldValue: number | null,
    cropIsEnabled: boolean,
    cropXValue: number | null,
    cropYValue: number | null,
    cropWValue: number | null,
    cropHValue: number | null,
    invertEnabled: boolean
  ): string {
    const backgroundWindow = backgroundEnabled ? backgroundFrameWindow(backgroundLimitValue) : null;
    return JSON.stringify({
      background_correction: backgroundEnabled,
      background_asset_id: backgroundEnabled ? selectedAssetId || undefined : undefined,
      background_start_frame: backgroundWindow?.startFrame,
      background_end_frame: backgroundWindow?.endFrame,
      background_limit: backgroundEnabled ? backgroundWindow?.limit : undefined,
      background_min_field_value: backgroundEnabled ? backgroundMinFieldValue : undefined,
      background_max_field_value: backgroundEnabled ? backgroundMaxFieldValue : undefined,
      flatfield_correction: backgroundEnabled ? false : flatfieldEnabled,
      flatfield_q: !backgroundEnabled && flatfieldEnabled ? flatfieldValue : undefined,
      flatfield_axis: !backgroundEnabled && flatfieldEnabled ? flatfieldAxisValue : undefined,
      flatfield_min_field_value: !backgroundEnabled && flatfieldEnabled ? flatfieldMinFieldValue : undefined,
      flatfield_max_field_value: !backgroundEnabled && flatfieldEnabled ? flatfieldMaxFieldValue : undefined,
      crop_enabled: cropIsEnabled,
      crop_x: cropIsEnabled ? cropXValue : undefined,
      crop_y: cropIsEnabled ? cropYValue : undefined,
      crop_w: cropIsEnabled ? cropWValue : undefined,
      crop_h: cropIsEnabled ? cropHValue : undefined,
      invert_intensity: invertEnabled
    });
  }

  function setBackgroundCorrection(enabled: boolean) {
    backgroundCorrection = enabled;
    if (enabled) flatfieldCorrection = false;
    backgroundFrameLimit = clampBackgroundFrameLimit(backgroundFrameLimit, frameCount);
  }

  function setFlatfieldCorrection(enabled: boolean) {
    flatfieldCorrection = enabled;
    if (enabled) backgroundCorrection = false;
  }

  function enforcePreprocessingCorrectionMode() {
    if (backgroundCorrection && flatfieldCorrection) flatfieldCorrection = false;
    backgroundFrameLimit = clampBackgroundFrameLimit(backgroundFrameLimit, frameCount);
  }

  function backgroundFrameLimitMinimum(totalFrames = frameCount): number {
    const total = Math.max(0, Math.round(totalFrames || 0));
    return total > 0 ? Math.min(backgroundFrameLimitFloor, total) : 1;
  }

  function backgroundFrameLimitMaximum(totalFrames = frameCount): number {
    return Math.max(backgroundFrameLimitMinimum(totalFrames), Math.round(totalFrames || 0));
  }

  function clampBackgroundFrameLimit(value: number, totalFrames = frameCount): number {
    const min = backgroundFrameLimitMinimum(totalFrames);
    const max = backgroundFrameLimitMaximum(totalFrames);
    const parsed = Number(value);
    const rounded = Number.isFinite(parsed) ? Math.round(parsed) : min;
    return Math.min(Math.max(rounded, min), max);
  }

  function backgroundFrameWindow(limitValue = backgroundFrameLimit): { startFrame: number; endFrame: number; limit: number } {
    const total = Math.max(1, Math.round(frameCount || 1));
    const current = Math.min(Math.max(Math.round(selectedFrameNum || 1), 1), total);
    const limit = clampBackgroundFrameLimit(limitValue, total);
    const before = Math.floor((limit - 1) / 2);
    const after = limit - before - 1;
    let startFrame = current - before;
    let endFrame = current + after;
    if (startFrame < 1) {
      endFrame = Math.min(total, endFrame + (1 - startFrame));
      startFrame = 1;
    }
    if (endFrame > total) {
      startFrame = Math.max(1, startFrame - (endFrame - total));
      endFrame = total;
    }
    return { startFrame, endFrame, limit };
  }

  function backgroundFrameWindowLabel(): string {
    if (!frameCount) return 'No frames';
    const window = backgroundFrameWindow();
    return `frames ${window.startFrame}-${window.endFrame}`;
  }

  function thresholdOptionsKey(
    thresholdMethodValue: string,
    manualThresholdValue: number,
    thresholdMaximumValue: number | null,
    boundedOtsuMinContrastValue: number,
    boundedOtsuMaxForegroundFractionValue: number,
    cannyEnabledValue: boolean,
    cannyLowValue: number,
    cannyHighValue: number,
    cannyBlurValue: number,
    dilateWValue: number,
    dilateHValue: number,
    adaptiveBlockValue: number,
    adaptiveCValue: number,
    percentileBackgroundValue: number,
    percentileMinContrastValue: number,
    hysteresisLowValue: number,
    hysteresisHighValue: number,
    hysteresisConnectivityValue: number,
    sobelPercentileValue: number,
    sobelThresholdValue: number | null,
    sobelKernelValue: number
  ): string {
    return JSON.stringify({
      threshold_method: thresholdMethodValue,
      manual_threshold: manualThresholdValue,
      thresholding_maximum_value: thresholdMaximumValue,
      bounded_otsu_min_contrast: boundedOtsuMinContrastValue,
      bounded_otsu_max_foreground_fraction: boundedOtsuMaxForegroundFractionValue,
      canny_enabled: cannyEnabledValue,
      canny_low_threshold: cannyLowValue,
      canny_high_threshold: cannyHighValue,
      canny_blur_kernel: cannyBlurValue,
      dilate_kernel_w: dilateWValue,
      dilate_kernel_h: dilateHValue,
      adaptive_block_size: adaptiveBlockValue,
      adaptive_c: adaptiveCValue,
      percentile_background_percentile: percentileBackgroundValue,
      percentile_min_contrast: percentileMinContrastValue,
      hysteresis_low_threshold: hysteresisLowValue,
      hysteresis_high_threshold: hysteresisHighValue,
      hysteresis_connectivity: hysteresisConnectivityValue,
      sobel_percentile: sobelPercentileValue,
      sobel_threshold: sobelThresholdValue,
      sobel_kernel_size: sobelKernelValue
    });
  }

  function detectionOptionsKey(
    thresholdKey: string,
    minPerimeterValue: number,
    maxPerimeterValue: number | null,
    paddingValue: number,
    extraValues: unknown = null
  ): string {
    return JSON.stringify({
      threshold_key: thresholdKey,
      min_perimeter: minPerimeterValue,
      max_perimeter: maxPerimeterValue,
      padding: paddingValue,
      extra_values: extraValues
    });
  }

  function resetLivePreviewForImageOptions(
    assetId: string,
    frameNum: number,
    optionKey: string
  ) {
    const key = `${assetId}:${frameNum}:${optionKey}`;
    if (lastFrameImageKey && key !== lastFrameImageKey) {
      void cleanupLiveSandboxFrame();
      hasLivePreview = false;
      detections = [];
      refinedDetections = [];
      bboxCoordinateBasis = 'original-frame';
    }
    lastFrameImageKey = key;
  }

  function resetCandidatePreviewForDetectionOptions(frameId: string, optionKey: string) {
    const key = `${frameId}:${optionKey}`;
    if (lastDetectionPreviewKey && key !== lastDetectionPreviewKey) {
      detections = [];
      refinedDetections = [];
      stageCounts = {};
      bboxCoordinateBasis = 'preprocessed-local';
    }
    lastDetectionPreviewKey = key;
  }

  function clearThresholdPreviewTimer() {
    if (thresholdPreviewTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(thresholdPreviewTimer);
    }
    thresholdPreviewTimer = null;
  }

  function scheduleThresholdAutoPreview(
    tab: ExplorerTab,
    frameId: string,
    preprocessingKey: string,
    thresholdKey: string
  ) {
    if (typeof window === 'undefined') return;
    if (tab !== 'threshold' || !frameId) {
      clearThresholdPreviewTimer();
      return;
    }
    const key = `${frameId}:${preprocessingKey}:${thresholdKey}`;
    if (key === lastAutoThresholdPreviewKey || thresholdPreviewTimer !== null) {
      if (key === lastAutoThresholdPreviewKey) return;
      clearThresholdPreviewTimer();
    }
    thresholdMaskUrl = '';
    thresholdPreviewTimer = window.setTimeout(() => {
      thresholdPreviewTimer = null;
      if (activeExplorerTab !== 'threshold' || selectedFrame?.id !== frameId) return;
      lastAutoThresholdPreviewKey = key;
      void previewThresholdNow({ silent: true });
    }, 250);
  }

  function adoptLiveSandboxFrame(
    result: { sandbox_frame_id?: string | null; frame_id?: string | null },
    sourceFrameId: string
  ) {
    const sandboxFrameId = result.sandbox_frame_id ?? result.frame_id;
    if (!sandboxFrameId) return;
    cancelScheduledLiveSandboxDeletion(sandboxFrameId);
    liveSandboxFrameId = sandboxFrameId;
    liveSandboxSourceFrameId = sourceFrameId;
    liveSandboxPreprocessingKey = preprocessingPreviewKey;
  }

  function cancelScheduledLiveSandboxDeletion(sandboxFrameId: string) {
    if (typeof window === 'undefined') return;
    const timer = pendingLiveSandboxDeletions.get(sandboxFrameId);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    pendingLiveSandboxDeletions.delete(sandboxFrameId);
  }

  function scheduleLiveSandboxDeletion(sandboxFrameId: string) {
    if (typeof window === 'undefined' || pendingLiveSandboxDeletions.has(sandboxFrameId)) return;
    const timer = window.setTimeout(() => {
      pendingLiveSandboxDeletions.delete(sandboxFrameId);
      void deleteLiveSandboxFrame(sandboxFrameId);
    }, liveSandboxDeletionDelayMs);
    pendingLiveSandboxDeletions.set(sandboxFrameId, timer);
  }

  async function deleteLiveSandboxFrame(sandboxFrameId: string) {
    const client = getClient();
    if (!client) return;
    try {
      await client.deleteLiveSandboxFrame(sandboxFrameId);
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 404) {
        // Sandbox cleanup is best-effort; a stale live frame should not interrupt the explorer.
      }
    }
  }

  async function cleanupLiveSandboxFrame(options: { invalidateRequests?: boolean } = {}) {
    if (options.invalidateRequests ?? true) {
      thresholdPreviewSerial += 1;
      detectionPreviewSerial += 1;
    }
    clearThresholdPreviewTimer();
    const sandboxFrameId = liveSandboxFrameId;
    liveSandboxFrameId = '';
    liveSandboxSourceFrameId = '';
    liveSandboxPreprocessingKey = '';
    thresholdMaskUrl = '';
    thresholdForegroundPixels = null;
    thresholdForegroundFraction = null;
    lastAutoThresholdPreviewKey = '';
    if (!sandboxFrameId) return;
    scheduleLiveSandboxDeletion(sandboxFrameId);
  }

  async function ensureLivePreprocessedFrame(frame: FrameSummary, options: { force?: boolean } = {}): Promise<string> {
    const client = getClient();
    if (!client || !frame.id) throw new Error('No selected frame is available.');
    if (
      !options.force &&
      liveSandboxFrameId &&
      liveSandboxSourceFrameId === frame.id &&
      liveSandboxPreprocessingKey === preprocessingPreviewKey
    ) {
      return liveSandboxFrameId;
    }
    if (liveSandboxFrameId) await cleanupLiveSandboxFrame({ invalidateRequests: false });
    const result = await client.livePreprocessFrame(frame.id, livePreprocessingOptions());
    adoptLiveSandboxFrame(result, frame.id);
    preprocessedReloadKey = Date.now();
    failedImageUrl = '';
    frameDisplayMode = 'preprocessed';
    if (!liveSandboxFrameId) throw new Error('Live preprocessing did not return a sandbox frame.');
    return liveSandboxFrameId;
  }

  function thresholdMaskDataUrl(result: LiveThresholdResponse): string {
    const payload = result.mask?.mask_payload_base64;
    if (!payload) return '';
    const format = result.mask?.mask_format || result.mask?.mask_encoding || 'png';
    return `data:image/${format};base64,${payload}`;
  }

  function resolvedThresholdOverlayBlendMode(): ImageOverlayBlendMode {
    if (thresholdOverlayBlendMode !== 'auto') return thresholdOverlayBlendMode;
    return imageInverted ? 'add' : 'subtract';
  }

  async function previewThresholdNow(options: { silent?: boolean } = {}) {
    const client = getClient();
    const frame = await ensureSelectedFrame();
    if (!client || !frame?.id) return;
    const serial = ++thresholdPreviewSerial;
    if (!options.silent) message = null;
    error = null;
    try {
      const sandboxFrameId = await ensureLivePreprocessedFrame(frame);
      const result = await client.liveThresholdFrame(sandboxFrameId, {
        ...thresholdOptions(),
        frame_payload_kind: 'preprocessed',
        apply_preprocessing: false,
        include_mask_payload: true,
        mask_encoding: 'png'
      });
      if (serial !== thresholdPreviewSerial) return;
      adoptLiveSandboxFrame(result, frame.id);
      thresholdMaskUrl = thresholdMaskDataUrl(result);
      thresholdForegroundPixels = result.mask?.foreground_pixels ?? null;
      thresholdForegroundFraction = result.mask?.foreground_fraction ?? null;
      refinedDetections = [];
      stageCounts = result.stage_counts ?? {};
      bboxCoordinateBasis = liveBboxCoordinateBasis(result);
      hasLivePreview = true;
      commitLivePresetSettings();
      if (!options.silent) message = `Previewed threshold mask for frame ${selectedFrameNum}.`;
    } catch (err) {
      if (serial !== thresholdPreviewSerial) return;
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function previewDetectionCandidatesNow() {
    const client = getClient();
    const frame = await ensureSelectedFrame();
    if (!client || !frame?.id) return;
    const serial = ++detectionPreviewSerial;
    message = null;
    error = null;
    try {
      const sandboxFrameId = await ensureLivePreprocessedFrame(frame);
      const result = await client.liveDetectionCandidateFrame(sandboxFrameId, {
        ...liveDetectionCandidateOptions(),
        frame_payload_kind: 'preprocessed',
        apply_preprocessing: false,
        apply_mask: false,
        include_detection_payloads: false,
        max_detections: 500
      });
      if (serial !== detectionPreviewSerial) return;
      adoptLiveSandboxFrame(result, frame.id);
      detections = result.candidate_detections ?? result.detections ?? [];
      refinedDetections = [];
      stageCounts = result.stage_counts ?? {};
      bboxCoordinateBasis = liveBboxCoordinateBasis(result);
      hasLivePreview = true;
      commitLivePresetSettings();
      const count = result.candidate_detection_count ?? result.detection_count ?? detections.length;
      message = `Previewed frame ${selectedFrameNum}; ${count} candidate ROI${count === 1 ? '' : 's'} detected.`;
    } catch (err) {
      if (serial !== detectionPreviewSerial) return;
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function applyPreprocessingNow() {
    const frame = await ensureSelectedFrame();
    if (!frame?.id) return;
    message = null;
    error = null;
    try {
      await ensureLivePreprocessedFrame(frame, { force: true });
      hasLivePreview = false;
      detections = [];
      refinedDetections = [];
      stageCounts = {};
      bboxCoordinateBasis = 'original-frame';
      thresholdMaskUrl = '';
      thresholdForegroundPixels = null;
      thresholdForegroundFraction = null;
      commitLivePresetSettings();
      message = `Previewed preprocessing for frame ${selectedFrameNum} in a live sandbox.`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function refineCurrentDetections() {
    const client = getClient();
    const frame = await ensureSelectedFrame();
    if (!client || !frame?.id) return;
    message = null;
    error = null;
    refining = true;
    try {
      let storedDetections = detections.filter((detection) => detection.id);
      let refreshedRoiPayloads = false;
      if (!storedDetections.length || storedDetections.some((detection) => !hasRoiPayload(detection))) {
        const sandboxFrameId = await ensureLivePreprocessedFrame(frame);
        const result = await client.segmentFrame(sandboxFrameId, {
          ...forceRoiPayloadRecordingOptions(),
          frame_payload_kind: 'preprocessed',
          apply_preprocessing: false,
          apply_mask: false
        });
        detections = result.detections;
        refinedDetections = [];
        storedDetections = result.detections.filter((detection) => detection.id);
        stageCounts = result.stage_counts ?? {};
        bboxCoordinateBasis = liveBboxCoordinateBasis(result);
        refreshedRoiPayloads = true;
      }
      const detectionIds = storedDetections.map((detection) => detection.id).filter((id): id is string => Boolean(id));
      if (!detectionIds.length) {
        const candidateCount = detections.length;
        throw new Error(
          candidateCount
            ? `Candidate detection returned ${candidateCount} ROI${candidateCount === 1 ? '' : 's'}, but none had stored detection IDs for refinement.`
            : 'No candidate ROIs were stored for the current sandbox frame. Refresh candidates, then refine again.'
        );
      }
      if (storedDetections.some((detection) => !hasRoiPayload(detection))) {
        throw new Error('Candidate detections still do not include ROI payload data after refreshing segmentation.');
      }
      const refinementPayload = {
        detection_ids: detectionIds,
        ...roiRefinementOptions()
      };
      try {
        const result = await client.refineRois({
          ...refinementPayload,
          store: true,
          dry_run: false
        });
        refinedDetections = result.refined_detections ?? [];
        const refinedCount = result.refined_count ?? refinedDetections.length;
        message = `${refreshedRoiPayloads ? 'Saved ROI payload data, then r' : 'R'}efined ${refinedCount} ROI${refinedCount === 1 ? '' : 's'} for frame ${selectedFrameNum}.`;
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 0) throw err;
        const response = await client.queueRoiRefinementJob({
          ...refinementPayload,
          run_id: selectedAsset?.run_id ?? undefined,
          asset_id: selectedAssetId || undefined,
          store: true,
          dry_run: false
        });
        message = `${refreshedRoiPayloads ? 'Saved ROI payload data. ' : ''}Direct refinement lost the API connection, so queued refinement job ${response.job.id} for ${detectionIds.length} ROI${detectionIds.length === 1 ? '' : 's'}.`;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      refining = false;
    }
  }

  async function queueSegmentation() {
    const client = getClient();
    if (!client || !selectedAssetId) return;
    message = null;
    error = null;
    try {
      const response = await client.queueSegmentationJob({
        asset_id: selectedAssetId,
        start_frame: 1,
        end_frame: frameCount || undefined,
        ...options()
      });
      message = `Queued segmentation job ${response.job.id}.`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  function findFrameByNumber(frameNumber: number): FrameSummary | undefined {
    return frames.find((frame) => frame.frame_num === frameNumber || frame.frame_index === frameNumber);
  }

  async function ensureSelectedFrame(): Promise<FrameSummary | undefined> {
    const current = findFrameByNumber(selectedFrameNum);
    if (current) return current;
    const client = getClient();
    if (!client || !selectedAssetId || selectedFrameNum < 1) return undefined;
    const [frame] = await client.listFrames(selectedAssetId, 1, selectedFrameNum, selectedFrameNum);
    if (frame) frames = [...frames, frame];
    return frame;
  }

  function setImageNaturalSize(dimensions: { width: number; height: number }) {
    failedImageUrl = '';
    imageNaturalWidth = dimensions.width;
    imageNaturalHeight = dimensions.height;
  }

  function markImageUnavailable() {
    if (framePayloadKind === 'preprocessed') {
      failedImageUrl = imageUrl;
      hasLivePreview = false;
      return;
    }
    failedImageUrl = imageUrl;
    imageNaturalWidth = 0;
    imageNaturalHeight = 0;
    imageScaleX = null;
    imageScaleY = null;
    hasLivePreview = false;
  }

  async function loadFrameImageHeaders(url: string) {
    const serial = ++imageHeaderSerial;
    imageScaleX = null;
    imageScaleY = null;
    if (!url || typeof window === 'undefined') return;
    try {
      const headResponse = await authenticatedFetch(url, { method: 'HEAD' });
      if (serial !== imageHeaderSerial) return;
      const headScale = scaleHeaders(headResponse);
      if (headScale) {
        imageScaleX = headScale.x;
        imageScaleY = headScale.y;
        return;
      }

      const imageResponse = await authenticatedFetch(url);
      if (serial !== imageHeaderSerial) {
        await imageResponse.body?.cancel();
        return;
      }
      const imageScale = scaleHeaders(imageResponse);
      imageScaleX = imageScale?.x ?? null;
      imageScaleY = imageScale?.y ?? null;
      await imageResponse.body?.cancel();
    } catch {
      if (serial === imageHeaderSerial) {
        imageScaleX = null;
        imageScaleY = null;
      }
    }
  }

  function scaleHeaders(response: Response): { x: number; y: number } | null {
    if (!response.ok) return null;
    const uniformScale = headerNumber(response.headers, 'x-pelagia-scale');
    const scaleX = headerNumber(response.headers, 'x-pelagia-scale-x') ?? uniformScale;
    const scaleY = headerNumber(response.headers, 'x-pelagia-scale-y') ?? uniformScale;
    return scaleX !== null && scaleY !== null ? { x: scaleX, y: scaleY } : null;
  }

  function headerNumber(headers: Headers, name: string): number | null {
    const parsed = Number(headers.get(name));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  type BboxCoordinateBasis = 'original-frame' | 'preprocessed-local';

  type LiveSegmentationBasisResponse = {
    frame_payload_kind?: string | null;
    apply_preprocessing?: boolean | null;
    bbox_coordinate_space?: string | null;
    coordinate_space?: string | null;
  };

  type BBox = {
    index: number;
    x: number;
    y: number;
    w: number;
    h: number;
    area?: number;
    perimeter?: number;
  };

  type RefinementRoiRelation = 'matched' | 'inferred' | 'split' | 'merge' | 'many-to-many' | 'missing' | 'orphan';

  type RefinementRoiPair = {
    key: string;
    index: number;
    candidates: DetectionSummary[];
    candidateIds: string[];
    refinedDetections: DetectionSummary[];
    inferredByIndex: boolean;
    relation: RefinementRoiRelation;
    notes: string[];
  };

  type RefinementSummary = {
    count: number;
    areaCount: number;
    totalArea: number;
    meanArea: number | null;
    medianArea: number | null;
    minArea: number | null;
    maxArea: number | null;
    bboxAreaCount: number;
    totalBboxArea: number;
  };

  function summarizeRefinedDetections(refined: DetectionSummary[]): RefinementSummary {
    const areas = refined
      .map((detection) => numberValue(detection.area))
      .filter((value): value is number => value !== null && value >= 0)
      .sort((a, b) => a - b);
    const bboxAreas = refined
      .map((detection, index) => toTargetBox(detection, index) ?? toCropBox(detection, index))
      .filter((box): box is BBox => box !== null)
      .map((box) => Math.max(0, box.w * box.h))
      .sort((a, b) => a - b);
    const totalArea = areas.reduce((total, area) => total + area, 0);
    const totalBboxArea = bboxAreas.reduce((total, area) => total + area, 0);
    return {
      count: refined.length,
      areaCount: areas.length,
      totalArea,
      meanArea: areas.length ? totalArea / areas.length : null,
      medianArea: median(areas),
      minArea: areas[0] ?? null,
      maxArea: areas.at(-1) ?? null,
      bboxAreaCount: bboxAreas.length,
      totalBboxArea
    };
  }

  function median(values: number[]): number | null {
    if (!values.length) return null;
    const midpoint = Math.floor(values.length / 2);
    return values.length % 2
      ? values[midpoint]
      : (values[midpoint - 1] + values[midpoint]) / 2;
  }

  function formatStat(value: number | null | undefined): string {
    return value === null || value === undefined || !Number.isFinite(value)
      ? 'n/a'
      : formatCount(Math.round(value));
  }

  function toTargetBox(detection: DetectionSummary, index: number): BBox | null {
    return toBox(detection, index, readTargetTuple(detection));
  }

  function toCropBox(detection: DetectionSummary, index: number): BBox | null {
    return toBox(detection, index, readCropTuple(detection) ?? readTargetTuple(detection));
  }

  function readTargetTuple(detection: DetectionSummary): [number, number, number, number] | null {
    return (
      tupleFromBBoxLike(detection.bbox) ??
      tupleFromValues(detection.bbox_x, detection.bbox_y, detection.bbox_w, detection.bbox_h) ??
      tupleFromBBoxLike(detection.metadata?.object_bbox) ??
      tupleFromBBoxLike(detection.metadata?.bbox) ??
      tupleFromBBoxLike(detection.metadata?.bounding_box) ??
      tupleFromBBoxLike(detection.metadata?.object_bounds)
    );
  }

  function readCropTuple(detection: DetectionSummary): [number, number, number, number] | null {
    return (
      tupleFromBBoxLike(detection.crop_bbox) ??
      tupleFromValues(
        detection.crop_bbox_x,
        detection.crop_bbox_y,
        detection.crop_bbox_w,
        detection.crop_bbox_h
      ) ??
      tupleFromBBoxLike(detection.metadata?.roi_bbox) ??
      tupleFromBBoxLike(detection.metadata?.crop_bbox) ??
      tupleFromBBoxLike(detection.metadata?.crop_bounds)
    );
  }

  function tupleFromBBoxLike(value: unknown): [number, number, number, number] | null {
    if (Array.isArray(value)) return tupleFromArray(value);
    if (!value || typeof value !== 'object') return null;
    const box = value as {
      bbox?: unknown;
      box?: unknown;
      bounds?: unknown;
      rect?: unknown;
      xywh?: unknown;
      xyxy?: unknown;
      coordinates?: unknown;
      x?: number | string | undefined;
      y?: number | string | undefined;
      w?: number | string | undefined;
      h?: number | string | undefined;
      width?: number | string | undefined;
      height?: number | string | undefined;
      left?: number | string | undefined;
      top?: number | string | undefined;
      right?: number | string | undefined;
      bottom?: number | string | undefined;
      x0?: number | string | undefined;
      y0?: number | string | undefined;
      x1?: number | string | undefined;
      y1?: number | string | undefined;
      xmin?: number | string | undefined;
      ymin?: number | string | undefined;
      xmax?: number | string | undefined;
      ymax?: number | string | undefined;
    };
    const nested =
      tupleFromArray(box.xywh) ??
      tupleFromXYXY(box.xyxy) ??
      tupleFromBBoxLike(box.bbox) ??
      tupleFromBBoxLike(box.box) ??
      tupleFromBBoxLike(box.bounds) ??
      tupleFromBBoxLike(box.rect) ??
      tupleFromBBoxLike(box.coordinates);
    if (nested) return nested;

    const x = numberValue(box.x ?? box.left ?? box.x0 ?? box.xmin);
    const y = numberValue(box.y ?? box.top ?? box.y0 ?? box.ymin);
    const w = numberValue(box.w ?? box.width);
    const h = numberValue(box.h ?? box.height);
    if (x !== null && y !== null && w !== null && h !== null) return [x, y, w, h];

    const right = numberValue(box.right ?? box.x1 ?? box.xmax);
    const bottom = numberValue(box.bottom ?? box.y1 ?? box.ymax);
    if (x !== null && y !== null && right !== null && bottom !== null) {
      return [x, y, right - x, bottom - y];
    }
    return null;
  }

  function tupleFromXYXY(value: unknown): [number, number, number, number] | null {
    if (!Array.isArray(value) || value.length < 4) return null;
    const x0 = numberValue(value[0]);
    const y0 = numberValue(value[1]);
    const x1 = numberValue(value[2]);
    const y1 = numberValue(value[3]);
    if (x0 === null || y0 === null || x1 === null || y1 === null) return null;
    return [x0, y0, x1 - x0, y1 - y0];
  }

  function toBox(
    detection: DetectionSummary,
    index: number,
    tuple: [number, number, number, number] | null
  ): BBox | null {
    if (!tuple || tuple[2] <= 0 || tuple[3] <= 0) return null;
    return {
      index: Number(detection.roi_index ?? index + 1),
      x: tuple[0],
      y: tuple[1],
      w: tuple[2],
      h: tuple[3],
      area: detection.area,
      perimeter: detection.perimeter
    };
  }

  function tupleFromValues(
    x: number | string | undefined,
    y: number | string | undefined,
    w: number | string | undefined,
    h: number | string | undefined
  ): [number, number, number, number] | null {
    const values = [x, y, w, h].map(numberValue);
    return values.every((value) => value !== null) ? (values as [number, number, number, number]) : null;
  }

  function tupleFromArray(value: unknown): [number, number, number, number] | null {
    if (!Array.isArray(value) || value.length < 4) return null;
    return tupleFromValues(value[0], value[1], value[2], value[3]);
  }

  function numberValue(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function cropImageStyle(box: BBox): string {
    if (!imageNaturalWidth || !imageNaturalHeight) return '';
    const imageScale = displayedImagePreviewScale();
    if (!imageScale) return '';
    const local = boxInDisplayedFrame(box, bboxCoordinateBasis);
    const scaled = {
      ...local,
      x: local.x * imageScale.x,
      y: local.y * imageScale.y,
      w: local.w * imageScale.x,
      h: local.h * imageScale.y
    };
    const scale = Math.min(
      12,
      Math.max(1.5, Math.min(cropPreviewWidth / Math.max(scaled.w, 1), cropPreviewHeight / Math.max(scaled.h, 1)))
    );
    const scaledWidth = imageNaturalWidth * scale;
    const scaledHeight = imageNaturalHeight * scale;
    const centeredX = cropPreviewWidth / 2 - (scaled.x + scaled.w / 2) * scale;
    const centeredY = cropPreviewHeight / 2 - (scaled.y + scaled.h / 2) * scale;
    const translateX = Math.min(0, Math.max(cropPreviewWidth - scaledWidth, centeredX));
    const translateY = Math.min(0, Math.max(cropPreviewHeight - scaledHeight, centeredY));
    return `width: ${scaledWidth}px; height: ${scaledHeight}px; transform: translate(${translateX}px, ${translateY}px);`;
  }

  function boxInDisplayedFrame(box: BBox, basis: BboxCoordinateBasis): BBox {
    const origin = overlayOrigin(basis);
    return {
      ...box,
      x: box.x - origin.x,
      y: box.y - origin.y
    };
  }

  function displayedImagePreviewScale(): { x: number; y: number } | null {
    if (imageScaleX !== null && imageScaleY !== null) return { x: imageScaleX, y: imageScaleY };
    const sourceDimensions = frameRenderSourceDimensions();
    if (!sourceDimensions?.width || !sourceDimensions.height || !imageNaturalWidth || !imageNaturalHeight) {
      return null;
    }
    return {
      x: imageNaturalWidth / sourceDimensions.width,
      y: imageNaturalHeight / sourceDimensions.height
    };
  }

  function frameCanvasOverlays(
    cropBoxes: BBox[],
    targetBoxesForFrame: BBox[],
    basis: BboxCoordinateBasis
  ): ImageOverlayRect[] {
    return [
      ...cropBoxes.map((box) => {
        const local = boxInDisplayedFrame(box, basis);
        return {
          id: `crop-${box.index}`,
          x: local.x,
          y: local.y,
          w: local.w,
          h: local.h,
          stroke: '#f5e642',
          lineWidth: 1,
          coordinateSpace: 'source' as const
        };
      }),
      ...targetBoxesForFrame.map((box) => {
        const local = boxInDisplayedFrame(box, basis);
        return {
          id: `target-${box.index}`,
          x: local.x,
          y: local.y,
          w: local.w,
          h: local.h,
          stroke: '#e2322e',
          lineWidth: 1,
          coordinateSpace: 'source' as const,
          selected: true
        };
      })
    ];
  }

  function detectionOverlaySignature(
    cropBoxes: BBox[],
    targetBoxesForFrame: BBox[],
    basis: BboxCoordinateBasis
  ): string {
    return [
      basis,
      ...cropBoxes.map((box) => `c:${box.index}:${box.x}:${box.y}:${box.w}:${box.h}`),
      ...targetBoxesForFrame.map((box) => `t:${box.index}:${box.x}:${box.y}:${box.w}:${box.h}`)
    ].join('|');
  }

  function frameMaskOverlays(
    candidateDetections: DetectionSummary[],
    refined: DetectionSummary[],
    basis: BboxCoordinateBasis,
    includeCandidateMasks: boolean,
    includeRefinedMasks: boolean,
    includeMaskDifferences: boolean,
    differenceUrls: Map<string, string>
  ): ImageOverlayImage[] {
    const client = getClient();
    if (!client) return [];
    const layers: ImageOverlayImage[] = [];
    if (includeCandidateMasks) {
      for (const [index, detection] of candidateDetections.entries()) {
        if (!detection.id) continue;
        const layer = maskOverlayForDetection(
          detection,
          index,
          client.detectionMaskUrl(detection.id),
          '#ff2020',
          1,
          'candidate-mask',
          basis
        );
        if (layer) layers.push(layer);
      }
    }
    if (includeRefinedMasks) {
      for (const [index, detection] of refined.entries()) {
        const candidateId = candidateIdForRefinedDetection(detection, index);
        const maskUrl = refinedMaskUrlForDetection(detection, index);
        if (!candidateId || !maskUrl) continue;
        const layer = maskOverlayForDetection(
          detection,
          index,
          maskUrl,
          '#1688ff',
          0.38,
          'refined-mask',
          basis
        );
        if (layer) layers.push(layer);
      }
    }
    if (includeMaskDifferences) {
      for (const request of maskDifferenceRequests(candidateDetections, refined)) {
        const imageUrl = differenceUrls.get(request.key);
        if (!imageUrl) continue;
        const local = boxInDisplayedFrame(request.unionBox, basis);
        if (local.w <= 0 || local.h <= 0) continue;
        layers.push({
          id: `mask-difference-${request.key}`,
          imageUrl,
          x: local.x,
          y: local.y,
          w: local.w,
          h: local.h,
          tint: '#ffd21f',
          opacity: 1,
          coordinateSpace: 'source'
        });
      }
    }
    return layers;
  }

  type MaskDifferenceRequest = {
    key: string;
    candidateUrl: string;
    refinedUrl: string;
    candidateBox: BBox;
    refinedBox: BBox;
    unionBox: BBox;
  };

  function maskDifferenceRequests(
    candidateDetections: DetectionSummary[],
    refined: DetectionSummary[]
  ): MaskDifferenceRequest[] {
    const client = getClient();
    if (!client) return [];
    const candidateById = new Map(candidateDetections.filter((detection) => detection.id).map((detection) => [detection.id, detection]));
    const requests: MaskDifferenceRequest[] = [];
    for (const [index, refinedDetection] of refined.entries()) {
      const candidateId = candidateIdForRefinedDetection(refinedDetection, index);
      if (!candidateId) continue;
      const candidateDetection = candidateById.get(candidateId);
      if (!candidateDetection) continue;
      const candidateBox = toCropBox(candidateDetection, index);
      const refinedBox = toCropBox(refinedDetection, index);
      if (!candidateBox || !refinedBox) continue;
      const unionBox = unionCropBox(candidateBox, refinedBox);
      const candidateUrl = client.detectionMaskUrl(candidateId);
      const refinedUrl = refinedMaskUrlForDetection(refinedDetection, index) || client.refinedDetectionMaskUrl(candidateId);
      const key = [
        candidateId,
        refinedDetection.id ?? index,
        boxKey(candidateBox),
        boxKey(refinedBox),
        candidateUrl,
        refinedUrl
      ].join('|');
      requests.push({ key, candidateUrl, refinedUrl, candidateBox, refinedBox, unionBox });
    }
    return requests;
  }

  async function updateMaskDifferenceUrls(
    enabled: boolean,
    candidateDetections: DetectionSummary[],
    refined: DetectionSummary[]
  ) {
    const serial = ++maskDifferenceSerial;
    if (!enabled || typeof window === 'undefined') {
      clearMaskDifferenceUrls();
      return;
    }
    const requests = maskDifferenceRequests(candidateDetections, refined);
    const nextKey = requests.map((request) => request.key).join('||');
    if (nextKey === maskDifferenceKey) return;
    maskDifferenceKey = nextKey;

    const neededKeys = new Set(requests.map((request) => request.key));
    for (const [key, url] of maskDifferenceUrls) {
      if (!neededKeys.has(key)) URL.revokeObjectURL(url);
    }
    maskDifferenceUrls = new Map([...maskDifferenceUrls].filter(([key]) => neededKeys.has(key)));

    for (const request of requests) {
      if (serial !== maskDifferenceSerial) return;
      if (maskDifferenceUrls.has(request.key)) continue;
      try {
        const url = await buildDifferenceMaskUrl(request);
        if (serial !== maskDifferenceSerial) {
          URL.revokeObjectURL(url);
          return;
        }
        maskDifferenceUrls = new Map(maskDifferenceUrls).set(request.key, url);
      } catch {
        // Difference overlays are optional; missing masks should not interrupt the explorer.
      }
    }
  }

  function clearMaskDifferenceUrls() {
    for (const url of maskDifferenceUrls.values()) URL.revokeObjectURL(url);
    maskDifferenceUrls = new Map();
    maskDifferenceKey = '';
  }

  async function buildDifferenceMaskUrl(request: MaskDifferenceRequest): Promise<string> {
    const [candidateBitmap, refinedBitmap] = await Promise.all([
      loadMaskBitmap(request.candidateUrl),
      loadMaskBitmap(request.refinedUrl)
    ]);
    try {
      const width = Math.max(1, Math.round(request.unionBox.w));
      const height = Math.max(1, Math.round(request.unionBox.h));
      const candidateCanvas = maskCanvasForBox(candidateBitmap, request.candidateBox, request.unionBox, width, height);
      const refinedCanvas = maskCanvasForBox(refinedBitmap, request.refinedBox, request.unionBox, width, height);
      const candidate = candidateCanvas.getContext('2d')?.getImageData(0, 0, width, height);
      const refined = refinedCanvas.getContext('2d')?.getImageData(0, 0, width, height);
      if (!candidate || !refined) throw new Error('Could not read mask pixels.');

      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = width;
      outputCanvas.height = height;
      const context = outputCanvas.getContext('2d');
      if (!context) throw new Error('Could not create difference mask canvas.');
      const output = context.createImageData(width, height);
      for (let pixel = 0; pixel < width * height; pixel += 1) {
        const offset = pixel * 4;
        const candidateOn = maskPixelOn(candidate.data, offset);
        const refinedOn = maskPixelOn(refined.data, offset);
        const different = candidateOn !== refinedOn;
        output.data[offset] = 255;
        output.data[offset + 1] = 255;
        output.data[offset + 2] = 255;
        output.data[offset + 3] = different ? 255 : 0;
      }
      context.putImageData(output, 0, 0);
      return await canvasToObjectUrl(outputCanvas);
    } finally {
      candidateBitmap.close?.();
      refinedBitmap.close?.();
    }
  }

  async function loadMaskBitmap(url: string): Promise<ImageBitmap> {
    const response = await authenticatedFetch(url);
    if (!response.ok) throw new Error(`Mask image request failed: ${response.status}`);
    return createImageBitmap(await response.blob());
  }

  function maskCanvasForBox(
    bitmap: ImageBitmap,
    box: BBox,
    unionBox: BBox,
    width: number,
    height: number
  ): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return canvas;
    context.drawImage(
      bitmap,
      Math.round(box.x - unionBox.x),
      Math.round(box.y - unionBox.y),
      Math.max(1, Math.round(box.w)),
      Math.max(1, Math.round(box.h))
    );
    return canvas;
  }

  function maskPixelOn(data: Uint8ClampedArray, offset: number): boolean {
    const alpha = data[offset + 3];
    const luma = 0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2];
    return alpha > 8 && luma > 16;
  }

  async function canvasToObjectUrl(canvas: HTMLCanvasElement): Promise<string> {
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('Could not encode difference mask.'))), 'image/png');
    });
    return URL.createObjectURL(blob);
  }

  function unionCropBox(a: BBox, b: BBox): BBox {
    const x0 = Math.min(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const x1 = Math.max(a.x + a.w, b.x + b.w);
    const y1 = Math.max(a.y + a.h, b.y + b.h);
    return {
      index: a.index,
      x: x0,
      y: y0,
      w: x1 - x0,
      h: y1 - y0
    };
  }

  function boxKey(box: BBox): string {
    return [box.x, box.y, box.w, box.h].map((value) => Math.round(value)).join(',');
  }

  function maskOverlayForDetection(
    detection: DetectionSummary,
    index: number,
    maskUrl: string,
    tint: string,
    opacity: number,
    layerIdPrefix: string,
    basis: BboxCoordinateBasis
  ): ImageOverlayImage | null {
    const box = toCropBox(detection, index);
    if (!box) return null;
    const local = boxInDisplayedFrame(box, basis);
    if (local.w <= 0 || local.h <= 0) return null;
    return {
      id: `${layerIdPrefix}-${detection.id ?? index}`,
      imageUrl: maskUrl,
      x: local.x,
      y: local.y,
      w: local.w,
      h: local.h,
      tint,
      opacity,
      coordinateSpace: 'source'
    };
  }

  function candidateIdForRefinedDetection(detection: DetectionSummary, index: number): string | null {
    const direct = detection.candidate_detection_id ?? stringValue(detection.metadata?.candidate_detection_id);
    if (direct) return direct;
    return detections[index]?.id ?? null;
  }

  function buildRefinementRoiPairs(
    candidates: DetectionSummary[],
    refined: DetectionSummary[]
  ): RefinementRoiPair[] {
    const candidateById = new Map(candidates.filter((candidate) => candidate.id).map((candidate) => [candidate.id as string, candidate]));
    const candidateOrder = new Map(candidates.map((candidate, index) => [candidate.id ?? `index:${index}`, index]));
    const groups = new Map<string, {
      candidateIds: Set<string>;
      refinedDetections: DetectionSummary[];
      inferredByIndex: boolean;
      notes: Set<string>;
    }>();
    const orphanGroups: RefinementRoiPair[] = [];

    for (const [index, refinedDetection] of refined.entries()) {
      const explicitIds = explicitCandidateIdsForRefinedDetection(refinedDetection);
      const knownIds = explicitIds.filter((id) => candidateById.has(id));
      let anchorId = knownIds[0] ?? null;
      let inferredByIndex = false;
      if (!anchorId && explicitIds.length === 0 && candidates[index]?.id) {
        anchorId = candidates[index].id ?? null;
        inferredByIndex = true;
      }
      if (!anchorId) {
        orphanGroups.push(finalizeRefinementRoiPair({
          key: `orphan-${refinedDetection.id ?? index}`,
          index,
          candidateIds: new Set(explicitIds),
          refinedDetections: [refinedDetection],
          inferredByIndex: false,
          notes: new Set(explicitIds.length ? [`Unmatched candidate id: ${explicitIds.join(', ')}`] : ['No candidate relationship metadata'])
        }, candidateById, candidateOrder));
        continue;
      }

      const group = groups.get(anchorId) ?? {
        candidateIds: new Set<string>(),
        refinedDetections: [],
        inferredByIndex: false,
        notes: new Set<string>()
      };
      const idsToRecord = knownIds.length ? knownIds : [anchorId];
      for (const id of idsToRecord) group.candidateIds.add(id);
      for (const id of explicitIds) {
        if (!candidateById.has(id)) group.notes.add(`Related candidate not in current detection set: ${id}`);
      }
      if (inferredByIndex) {
        group.inferredByIndex = true;
        group.notes.add('Matched by result order because no candidate id metadata was supplied');
      }
      const childCount = numberValue(refinedDetection.metadata?.residual_discovery_child_count);
      if (childCount && childCount > 0) group.notes.add(`Discovered ${formatCount(childCount)} residual child ROI${childCount === 1 ? '' : 's'}`);
      group.refinedDetections.push(refinedDetection);
      groups.set(anchorId, group);
    }

    const assignedCandidateIds = new Set<string>();
    const comparisons = [...groups.entries()].map(([key, group], index) => {
      for (const id of group.candidateIds) assignedCandidateIds.add(id);
      return finalizeRefinementRoiPair({ key, index, ...group }, candidateById, candidateOrder);
    });
    for (const [index, candidate] of candidates.entries()) {
      if (candidate.id && assignedCandidateIds.has(candidate.id)) continue;
      comparisons.push({
        key: candidate.id ?? `candidate-${index}`,
        index,
        candidates: [candidate],
        candidateIds: candidate.id ? [candidate.id] : [],
        refinedDetections: [],
        inferredByIndex: false,
        relation: 'missing',
        notes: []
      });
    }
    return [...comparisons, ...orphanGroups].sort((a, b) => a.index - b.index);
  }

  function finalizeRefinementRoiPair(
    group: {
      key: string;
      index: number;
      candidateIds: Set<string>;
      refinedDetections: DetectionSummary[];
      inferredByIndex: boolean;
      notes: Set<string>;
    },
    candidateById: Map<string, DetectionSummary>,
    candidateOrder: Map<string, number>
  ): RefinementRoiPair {
    const candidateIds = [...group.candidateIds];
    const candidates = candidateIds
      .map((id) => candidateById.get(id))
      .filter((candidate): candidate is DetectionSummary => Boolean(candidate))
      .sort((a, b) => (candidateOrder.get(a.id ?? '') ?? 0) - (candidateOrder.get(b.id ?? '') ?? 0));
    const relation = refinementRoiRelation(candidates, group.refinedDetections, group.inferredByIndex);
    const firstCandidateIndex = candidates.length
      ? candidateOrder.get(candidates[0].id ?? '') ?? group.index
      : group.index;
    return {
      key: group.key,
      index: firstCandidateIndex,
      candidates,
      candidateIds,
      refinedDetections: group.refinedDetections,
      inferredByIndex: group.inferredByIndex,
      relation,
      notes: [...group.notes]
    };
  }

  function refinementRoiRelation(
    candidates: DetectionSummary[],
    refined: DetectionSummary[],
    inferredByIndex: boolean
  ): RefinementRoiRelation {
    if (!candidates.length) return 'orphan';
    if (!refined.length) return 'missing';
    const splitHint = refined.some((detection) =>
      Boolean(
        detection.metadata?.split_from_candidate_detection_id ??
        detection.metadata?.residual_parent_candidate_detection_id ??
        numberValue(detection.metadata?.residual_discovery_child_count)
      )
    );
    if (candidates.length > 1 && refined.length > 1) return 'many-to-many';
    if (candidates.length > 1) return 'merge';
    if (refined.length > 1 || splitHint) return 'split';
    if (inferredByIndex) return 'inferred';
    return 'matched';
  }

  function explicitCandidateIdsForRefinedDetection(detection: DetectionSummary): string[] {
    const metadata = detection.metadata ?? {};
    return uniqueStrings([
      detection.primary_candidate_detection_id,
      detection.candidate_detection_id,
      ...stringArrayValue(detection.candidate_detection_ids),
      stringValue(metadata.primary_candidate_detection_id),
      stringValue(metadata.candidate_detection_id),
      ...stringArrayValue(metadata.candidate_detection_ids),
      ...stringArrayValue(metadata.source_candidate_detection_ids),
      ...stringArrayValue(metadata.merged_candidate_detection_ids),
      stringValue(metadata.split_from_candidate_detection_id),
      stringValue(metadata.residual_parent_candidate_detection_id),
      ...stringArrayValue(metadata.consumed_candidate_detection_ids),
      ...consumedCandidateIds(metadata.overlap_reconciliation_consumed)
    ]);
  }

  function storageCandidateIdForRefinedDetection(detection: DetectionSummary): string | null {
    const metadata = detection.metadata ?? {};
    return (
      detection.primary_candidate_detection_id ??
      stringValue(metadata.primary_candidate_detection_id) ??
      stringValue(metadata.split_from_candidate_detection_id) ??
      stringValue(metadata.residual_parent_candidate_detection_id) ??
      detection.candidate_detection_id ??
      stringValue(metadata.candidate_detection_id) ??
      detection.id ??
      null
    );
  }

  function refinedDetectionRecordId(detection: DetectionSummary): string | null {
    const metadata = detection.metadata ?? {};
    return (
      detection.refined_detection_id ??
      stringValue(metadata.refined_detection_id) ??
      (detection.refinement_relationship || detection.primary_candidate_detection_id || detection.candidate_detection_ids?.length
        ? detection.id ?? null
        : null)
    );
  }

  function refinedMaskUrlForDetection(detection: DetectionSummary, index: number): string {
    const client = getClient();
    if (!client) return '';
    if (detection.refined_mask_url) return client.resolveApiUrl(detection.refined_mask_url);
    const refinedRecordId = refinedDetectionRecordId(detection);
    if (refinedRecordId) return client.refinedDetectionRecordMaskUrl(refinedRecordId, 'png');
    const candidateId = candidateIdForRefinedDetection(detection, index);
    return candidateId ? client.refinedDetectionMaskUrl(candidateId, 'png') : '';
  }

  function consumedCandidateIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((entry) => stringValue((entry as { candidate_detection_id?: unknown })?.candidate_detection_id)).filter((id): id is string => Boolean(id));
  }

  function stringArrayValue(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(stringValue).filter((id): id is string => Boolean(id));
    if (typeof value === 'string') return value.split(',').map((part) => part.trim()).filter(Boolean);
    return [];
  }

  function uniqueStrings(values: Array<string | null | undefined>): string[] {
    return [...new Set(values.filter((value): value is string => Boolean(value)))];
  }

  function resolvedRefinementMaskOverlayBlendMode(): ImageOverlayBlendMode {
    if (refinementMaskOverlayBlendMode !== 'auto') return refinementMaskOverlayBlendMode;
    return $imageInversionEnabled ? 'add' : 'subtract';
  }

  function refinementRoiSourceBox(detection: DetectionSummary, index: number): BBox | null {
    return toCropBox(detection, index) ?? toTargetBox(detection, index);
  }

  function refinementRoiSourceWidth(detection: DetectionSummary, index: number): number | null {
    const width = refinementRoiSourceBox(detection, index)?.w ?? null;
    return width && width > 0 ? width : null;
  }

  function refinementRoiSourceHeight(detection: DetectionSummary, index: number): number | null {
    const height = refinementRoiSourceBox(detection, index)?.h ?? null;
    return height && height > 0 ? height : null;
  }

  function refinementRoiImageUrl(pair: RefinementRoiPair, detection: DetectionSummary, kind: 'candidate' | 'refined'): string {
    const client = getClient();
    if (!client) return '';
    if (kind === 'refined') {
      if (detection.refined_roi_url) return client.resolveApiUrl(detection.refined_roi_url);
      const refinedRecordId = refinedDetectionRecordId(detection);
      if (refinedRecordId) return client.refinedDetectionRecordImageUrl(refinedRecordId, 'png', { applyMask: false });
      const refinedId = storageCandidateIdForRefinedDetection(detection) ?? pair.candidateIds[0] ?? detection.id;
      return refinedId ? client.refinedDetectionImageUrl(refinedId, 'png', { applyMask: false }) : '';
    }
    return detection.id ? client.detectionImageUrl(detection.id, 'png', { applyMask: false }) : '';
  }

  function refinementRoiMaskUrl(pair: RefinementRoiPair, detection: DetectionSummary, kind: 'candidate' | 'refined'): string {
    const client = getClient();
    if (!client) return '';
    if (kind === 'refined') {
      if (detection.refined_mask_url) return client.resolveApiUrl(detection.refined_mask_url);
      const refinedRecordId = refinedDetectionRecordId(detection);
      if (refinedRecordId) return client.refinedDetectionRecordMaskUrl(refinedRecordId, 'png');
      const refinedId = storageCandidateIdForRefinedDetection(detection) ?? pair.candidateIds[0] ?? detection.id;
      return refinedId ? client.refinedDetectionMaskUrl(refinedId, 'png') : '';
    }
    return detection.id ? client.detectionMaskUrl(detection.id, 'png') : '';
  }

  function refinementRoiFilename(
    pair: RefinementRoiPair,
    detection: DetectionSummary,
    kind: 'candidate' | 'refined',
    version = 'roi'
  ): string {
    const primaryCandidate = pair.candidates[0];
    const assetName =
      selectedAsset?.filename?.replace(/\.[^.]+$/, '') ??
      detection.asset_filename?.replace(/\.[^.]+$/, '') ??
      primaryCandidate?.asset_filename?.replace(/\.[^.]+$/, '') ??
      selectedAssetId ??
      'asset';
    const frame = detection.frame_index ?? primaryCandidate?.frame_index ?? selectedFrameNum ?? 'frame';
    const roi = detection.roi_index ?? primaryCandidate?.roi_index ?? pair.index + 1;
    return `${assetName}_frame_${frame}_roi_${roi}_${kind}_${version}.png`;
  }

  function refinementRoiCanvasKey(pair: RefinementRoiPair, detection: DetectionSummary, kind: 'candidate' | 'refined'): string {
    return [
      kind,
      pair.key,
      detection.id ?? detection.candidate_detection_id ?? detection.refined_detection_id ?? 'roi',
      pair.refinedDetections.map((refinedDetection) => refinedDetection.id ?? refinedDetection.candidate_detection_id ?? 'refined').join(','),
      $imageInversionEnabled ? 'inverted' : 'normal',
      kind === 'candidate' ? showCandidateMasks : showRefinedMasks,
      refinementMaskOverlayColorMode,
      refinementMaskOverlayBlendMode,
      refinementMaskOverlayOpacity
    ].join('|');
  }

  function refinementRoiRenderSpec(pair: RefinementRoiPair, detection: DetectionSummary, kind: 'candidate' | 'refined'): ImageRenderSpec {
    const imageUrl = refinementRoiImageUrl(pair, detection, kind);
    const maskUrl = refinementRoiMaskUrl(pair, detection, kind);
    const fallbackCandidate = pair.candidates[0] ?? detection;
    const sourceWidth = refinementRoiSourceWidth(detection, pair.index) ?? refinementRoiSourceWidth(fallbackCandidate, pair.index);
    const sourceHeight = refinementRoiSourceHeight(detection, pair.index) ?? refinementRoiSourceHeight(fallbackCandidate, pair.index);
    const maskEnabled = kind === 'candidate' ? showCandidateMasks : showRefinedMasks;
    const layers: ImageLayer[] =
      maskEnabled && maskUrl
        ? [
            {
              kind: 'mask-overlay',
              id: `${kind}-mask-${pair.key}`,
              imageUrl: maskUrl,
              x: 0,
              y: 0,
              w: 100,
              h: 100,
              tint: '#ff2020',
              colorMode: refinementMaskOverlayColorMode,
              blendMode: resolvedRefinementMaskOverlayBlendMode(),
              opacity: refinementMaskOverlayOpacity,
              coordinateSpace: 'percent'
            }
          ]
        : [];
    return {
      key: refinementRoiCanvasKey(pair, detection, kind),
      image: {
        url: imageUrl,
        alt: `${kind === 'refined' ? 'Refined' : 'Candidate'} ROI ${detection.roi_index ?? pair.index + 1}`,
        invert: $imageInversionEnabled,
        sourceWidth,
        sourceHeight
      },
      layers,
      scaleBar: {
        enabled: true,
        placement: 'below',
        maxPercent: 55
      },
      toolbar: {
        exportControls: 'menu',
        filename: refinementRoiFilename(pair, detection, kind, 'roi'),
        annotatedFilename: refinementRoiFilename(pair, detection, kind, 'overlay'),
        originalUrl: imageUrl,
        originalFilename: refinementRoiFilename(pair, detection, kind, 'original'),
        maskUrl,
        maskFilename: refinementRoiFilename(pair, detection, kind, 'mask'),
        info: {
          assetFilename: selectedAsset?.filename ?? detection.asset_filename ?? selectedAssetId ?? null,
          frameNumber: detection.frame_index ?? selectedFrameNum,
          collections: selectedAsset?.collections ?? null
        }
      },
      display: {
        maxWidth: refinementRoiDisplayMaxWidth,
        maxHeight: refinementRoiDisplayMaxHeight,
        background: '#111916'
      }
    };
  }

  function refinementRoiBboxLabel(detection: DetectionSummary, index: number): string {
    const box = refinementRoiSourceBox(detection, index);
    if (!box) return 'bbox unavailable';
    return `x=${Math.round(box.x)}, y=${Math.round(box.y)}, w=${Math.round(box.w)}, h=${Math.round(box.h)}`;
  }

  function refinementRoiMetricSummary(detection: DetectionSummary): string {
    const parts: string[] = [];
    if (detection.area !== undefined) parts.push(`area=${formatCount(Math.round(detection.area))}`);
    if (detection.perimeter !== undefined) parts.push(`perimeter=${formatCount(Math.round(detection.perimeter))}`);
    if (detection.roi_payload_bytes !== undefined) parts.push(formatBytes(detection.roi_payload_bytes));
    if (detection.mask_payload_bytes !== undefined) parts.push(`mask ${formatBytes(detection.mask_payload_bytes)}`);
    return parts.join(' · ') || 'metrics unavailable';
  }

  function refinementRelationLabel(relation: RefinementRoiRelation): string {
    if (relation === 'many-to-many') return 'many-to-many';
    return relation;
  }

  function refinementRelationDescription(pair: RefinementRoiPair): string {
    if (pair.relation === 'split') return `${pair.refinedDetections.length} refined ROI${pair.refinedDetections.length === 1 ? '' : 's'} for one candidate`;
    if (pair.relation === 'merge') return `${pair.candidates.length} candidates represented by one refined ROI`;
    if (pair.relation === 'many-to-many') return `${pair.candidates.length} candidates and ${pair.refinedDetections.length} refined ROIs share relationship metadata`;
    if (pair.relation === 'missing') return 'No refined ROI matched this candidate';
    if (pair.relation === 'orphan') return 'Refined ROI has no matching candidate in this frame result';
    if (pair.relation === 'inferred') return 'Matched by result order; backend should provide candidate ids';
    return 'Matched by candidate id';
  }

  function refinementTileRelationLabel(pair: RefinementRoiPair, kind: 'candidate' | 'refined'): string | null {
    if (pair.relation === 'matched') return null;
    if (kind === 'candidate' && pair.relation === 'merge') return 'merged';
    if (kind === 'refined' && pair.relation === 'split') return 'split';
    if (pair.relation === 'many-to-many') return 'many-to-many';
    if (pair.relation === 'inferred') return 'inferred';
    if (pair.relation === 'missing') return 'missing';
    if (pair.relation === 'orphan') return 'orphan';
    return null;
  }

  function stringValue(value: unknown): string | null {
    return typeof value === 'string' && value ? value : null;
  }

  function overlayOrigin(basis: BboxCoordinateBasis): { x: number; y: number } {
    if (basis === 'preprocessed-local') return { x: 0, y: 0 };
    return displayedFrameOrigin();
  }

  function liveBboxCoordinateBasis(result: LiveSegmentationBasisResponse): BboxCoordinateBasis {
    const explicitSpace = String(result.bbox_coordinate_space ?? result.coordinate_space ?? '').toLowerCase();
    if (explicitSpace.includes('preprocessed') && explicitSpace.includes('local')) return 'preprocessed-local';
    if (explicitSpace.includes('original')) return 'original-frame';
    return segmentationOptionsBboxCoordinateBasis({
      frame_payload_kind:
        result.frame_payload_kind === 'preprocessed' || result.frame_payload_kind === 'original'
          ? result.frame_payload_kind
          : framePayloadKind,
      apply_preprocessing: result.apply_preprocessing ?? framePayloadKind === 'original'
    });
  }

  function segmentationOptionsBboxCoordinateBasis(optionsValue: SegmentationOptions): BboxCoordinateBasis {
    if (optionsValue.frame_payload_kind === 'preprocessed' && !optionsValue.apply_preprocessing) {
      return 'preprocessed-local';
    }
    return 'original-frame';
  }

  function displayedFrameOrigin(): { x: number; y: number } {
    if (framePayloadKind === 'preprocessed') {
      const cropTuple =
        tupleFromBBoxLike(selectedFrame?.preprocessed_metadata?.crop_bbox) ??
        tupleFromBBoxLike(selectedFrame?.metadata?.crop_bbox);
      if (cropTuple) return { x: cropTuple[0], y: cropTuple[1] };
      if (cropEnabled && cropX !== null && cropY !== null) return { x: cropX, y: cropY };
    }
    return {
      x: numberValue(selectedFrame?.bbox_x) ?? 0,
      y: numberValue(selectedFrame?.bbox_y) ?? 0
    };
  }

  function frameExportFilename(annotated = false): string {
    const assetName = selectedAsset?.filename?.replace(/\.[^.]+$/, '') ?? selectedAssetId ?? 'asset';
    const suffix = annotated ? 'boxed' : framePayloadKind;
    return `${assetName}_frame_${selectedFrameNum}_${suffix}.png`;
  }

  function frameInfoTimestamp(): string | null {
    const metadata = selectedFrame?.metadata ?? selectedAsset?.metadata ?? {};
    const frame = selectedFrame as (FrameSummary & { captured_at?: unknown; capture_datetime?: unknown }) | null;
    const value =
      frame?.captured_at ??
      frame?.capture_datetime ??
      metadata.capture_datetime ??
      metadata.captured_at ??
      metadata.timestamp;
    return value === undefined || value === null || value === '' ? null : String(value);
  }

  function frameRenderSourceDimensions(): { width: number; height: number } | null {
    const frame = selectedFrame as
      | (FrameSummary & {
          width?: unknown;
          height?: unknown;
          shape?: unknown;
          payload_shape?: unknown;
          preprocessed_payload_shape?: unknown;
          preprocessed_metadata?: Record<string, unknown>;
          metadata?: Record<string, unknown>;
        })
      | null;
    if (!frame) return null;
    if (framePayloadKind === 'preprocessed') {
      const preprocessed =
        (liveSandboxFrameId ? preprocessingOutputDimensions(frame) : null) ??
        dimensionsFromShape(frame.preprocessed_payload_shape) ??
        dimensionsFromShape(frame.preprocessed_metadata?.shape) ??
        dimensionsFromShape(frame.preprocessed_metadata?.payload_shape) ??
        dimensionsFromBox(frame.preprocessed_metadata?.crop_bbox) ??
        dimensionsFromShape(frame.metadata?.preprocessed_payload_shape);
      if (preprocessed) return preprocessed;
    }
    const width = numberValue(frame.width);
    const height = numberValue(frame.height);
    if (width && height) return { width, height };
    return (
      dimensionsFromShape(frame.payload_shape) ??
      dimensionsFromShape(frame.shape) ??
      dimensionsFromShape(frame.metadata?.payload_shape) ??
      dimensionsFromShape(frame.metadata?.shape)
    );
  }

  function preprocessingOutputDimensions(
    frame: FrameSummary & {
      width?: unknown;
      height?: unknown;
      shape?: unknown;
      payload_shape?: unknown;
      metadata?: Record<string, unknown>;
    }
  ): { width: number; height: number } | null {
    if (cropEnabled && cropW !== null && cropH !== null && cropW > 0 && cropH > 0) {
      return { width: cropW, height: cropH };
    }
    const width = numberValue(frame.width);
    const height = numberValue(frame.height);
    if (width && height) return { width, height };
    return (
      dimensionsFromShape(frame.payload_shape) ??
      dimensionsFromShape(frame.shape) ??
      dimensionsFromShape(frame.metadata?.payload_shape) ??
      dimensionsFromShape(frame.metadata?.shape)
    );
  }

  function dimensionsFromShape(shape: unknown): { width: number; height: number } | null {
    if (!Array.isArray(shape) || shape.length < 2) return null;
    const height = numberValue(shape[0]);
    const width = numberValue(shape[1]);
    return width && height ? { width, height } : null;
  }

  function dimensionsFromBox(box: unknown): { width: number; height: number } | null {
    if (Array.isArray(box) && box.length >= 4) {
      const width = numberValue(box[2]);
      const height = numberValue(box[3]);
      return width && height ? { width, height } : null;
    }
    if (!box || typeof box !== 'object') return null;
    const value = box as { w?: unknown; h?: unknown; width?: unknown; height?: unknown };
    const width = numberValue(value.w ?? value.width);
    const height = numberValue(value.h ?? value.height);
    return width && height ? { width, height } : null;
  }

  function activeFrameCaption(tab: ExplorerTab): string {
    if (tab === 'threshold') return `${frameCaption(frameDisplayMode)} with threshold mask`;
    if (tab === 'detection') return `${frameCaption(frameDisplayMode)} with candidate ROI boxes`;
    return frameCaption(frameDisplayMode);
  }

  function activeFrameAlt(tab: ExplorerTab): string {
    if (tab === 'threshold') return 'Selected frame with threshold mask overlay';
    if (tab === 'detection') return 'Selected frame with candidate ROI overlays';
    return 'Selected frame';
  }

  function thresholdMaskOverlays(): ImageOverlayImage[] {
    if (!thresholdMaskUrl) return [];
    return [
      {
        id: 'threshold-mask',
        imageUrl: thresholdMaskUrl,
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        tint: '#ff2020',
        colorMode: thresholdOverlayColorMode,
        blendMode: resolvedThresholdOverlayBlendMode(),
        opacity: thresholdOverlayOpacity,
        coordinateSpace: 'percent'
      }
    ];
  }

  function activeImageLayers(tab: ExplorerTab): ImageLayer[] {
    if (tab === 'threshold') return imageLayersForFrame([], thresholdMaskOverlays());
    if (tab === 'detection') {
      return imageLayersForFrame(frameCanvasOverlays(boxes, targetBoxes, bboxCoordinateBasis), []);
    }
    return [];
  }

  function frameRenderSpec(tab: ExplorerTab = activeExplorerTab): ImageRenderSpec {
    const sourceDimensions = frameRenderSourceDimensions();
    return {
      key: [
        tab,
        imageUrl,
        imageInverted ? 'inverted' : 'normal',
        liveSandboxFrameId,
        preprocessedReloadKey,
        thresholdMaskUrl,
        thresholdOverlayColorMode,
        thresholdOverlayBlendMode,
        thresholdOverlayOpacity,
        detectionOverlayKey,
        sourceDimensions?.width ?? imageNaturalWidth,
        sourceDimensions?.height ?? imageNaturalHeight
      ].join('|'),
      image: {
        url: imageUrl,
        alt: hasLivePreview ? activeFrameAlt(tab) : 'Selected frame',
        invert: imageInverted,
        sourceWidth: sourceDimensions?.width ?? (imageNaturalWidth || null),
        sourceHeight: sourceDimensions?.height ?? (imageNaturalHeight || null)
      },
      layers: activeImageLayers(tab),
      scaleBar: {
        enabled: true,
        placement: 'inside'
      },
      toolbar: {
        exportControls: 'menu',
        filename: frameExportFilename(),
        annotatedFilename: frameExportFilename(true),
        originalUrl: imageUrl,
        originalFilename: frameExportFilename(),
        info: {
          assetFilename: selectedAsset?.filename ?? selectedAssetId ?? null,
          frameNumber: selectedFrame?.frame_num ?? selectedFrame?.frame_index ?? selectedFrameNum,
          timestamp: frameInfoTimestamp(),
          collections: selectedAsset?.collections ?? null
        }
      },
      display: {
        maxWidth: frameImageWidth,
        maxHeight: 760,
        background: '#050807'
      }
    };
  }

  function imageLayersForFrame(
    rects: ImageOverlayRect[],
    masks: ImageOverlayImage[]
  ): ImageLayer[] {
    return [
      ...masks.map((mask) => ({
        kind: 'mask-overlay' as const,
        id: mask.id,
        imageUrl: mask.imageUrl,
        x: mask.x,
        y: mask.y,
        w: mask.w,
        h: mask.h,
        tint: mask.tint,
        colorMode: mask.colorMode,
        blendMode: mask.blendMode,
        opacity: mask.opacity,
        compositeOperation: mask.compositeOperation,
        coordinateSpace: mask.coordinateSpace
      })),
      ...rects.map((rect) => ({
        kind: 'rect' as const,
        id: rect.id,
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        stroke: rect.stroke,
        lineWidth: rect.lineWidth,
        halo: rect.halo,
        selected: rect.selected,
        coordinateSpace: rect.coordinateSpace,
        tooltip: typeof rect.id === 'string' ? rect.id : undefined
      }))
    ];
  }

  function stageCountEntries(counts: Record<string, number>): Array<[string, number]> {
    return Object.entries(counts).filter(([, value]) => Number.isFinite(Number(value)));
  }
</script>

<div class="explorer-tabs" role="tablist" aria-label="Explorer workflow sections">
    {#each explorerTabs as tab}
      <button
        type="button"
        role="tab"
        aria-selected={activeExplorerTab === tab.id}
        class:active={activeExplorerTab === tab.id}
        on:click={() => (activeExplorerTab = tab.id)}
      >
        {tab.label}
      </button>
    {/each}
  </div>
<section class="panel explorer-nav-panel">
  


  {#if activeExplorerTab === 'preprocessing'}
    <div class="asset-row">
      <label>
        Asset
        <select bind:value={selectedAssetId} on:change={loadFrames}>
          {#each assets as asset}
            <option value={asset.id}>{asset.filename ?? asset.id}</option>
          {/each}
        </select>
      </label>
      <label>
        Frame
        <input
          type="range"
          min="1"
          max={Math.max(frameCount, 1)}
          bind:value={selectedFrameNum}
          on:change={loadDetections}
          disabled={frameCount < 1}
        />
      </label>
      <span class="frame-readout">{frameCount ? `${selectedFrameNum} / ${frameCount}` : 'No frames'}</span>
    </div>
  {/if}


<div
  class:segmentation-layout={activeExplorerTab !== 'refinement' && activeExplorerTab !== 'presets'}
  class:single-panel-layout={activeExplorerTab === 'refinement'}
  class:preset-panel-layout={activeExplorerTab === 'presets'}
>
  {#if activeExplorerTab !== 'refinement' && activeExplorerTab !== 'presets'}
  <section class="panel image-panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">{activeExplorerTab}</p>
        <h2>{activeExplorerTab === 'threshold' ? 'Threshold preview' : activeExplorerTab === 'detection' ? 'Candidate preview' : 'Preprocessing preview'}</h2>
      </div>
    </div>

    <div class="frame-stage comparison-stage">
      {#if imageUrl}
        <figure>
          <figcaption>{activeFrameCaption(activeExplorerTab)}</figcaption>
          {#if imageUnavailable}
            <div class="preview-placeholder frame-unavailable">
              {#if framePayloadKind === 'preprocessed'}
                <strong>No preprocessed image is available for this frame.</strong>
                <span>Use Apply preprocessing to store one, or switch back to Original.</span>
              {:else}
                <strong>The selected frame image could not be loaded.</strong>
                <span>Check that the frame data endpoint is available.</span>
              {/if}
            </div>
          {:else}
            {#key `${imageUrl}|${imageInverted}|${liveSandboxFrameId}|${preprocessedReloadKey}|${thresholdMaskUrl}|${thresholdOverlayColorMode}|${thresholdOverlayBlendMode}|${thresholdOverlayOpacity}|${detectionOverlayKey}`}
              <KonvaImageCanvas
                spec={frameRenderSpec(activeExplorerTab)}
                mode="viewer"
                onImageLoad={setImageNaturalSize}
                onImageError={markImageUnavailable}
              />
            {/key}
          {/if}
        </figure>
      {:else}
        <p class="empty">
          {framePayloadKind === 'preprocessed'
            ? 'Run Preview / Apply in preprocessing to create a live preprocessed sandbox.'
            : 'Select an ingested asset with stored frames to preview segmentation.'}
        </p>
      {/if}
    </div>

  </section>
  {/if}

  <section class="panel controls-panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Options</p>
        <h2>Explorer controls</h2>
      </div>
    </div>
    {#if activeExplorerTab === 'preprocessing'}
    <div class="explorer-display-row">
      <FrameDisplayToggle bind:value={frameDisplayMode} />
      <div class="detection-strip compact-strip">
        <strong>{detections.length}</strong>
        <span>detections</span>
        {#if hasRefinementResults}
          <strong>{refinementSummary.count}</strong>
          <span>refined</span>
        {/if}
      </div>
    </div>
    {/if}

    {#if activeExplorerTab === 'presets'}
      <ProcessingPresetControls
        presets={availableProcessingPresets}
        bind:selectedKey={selectedProcessingPresetKey}
        loading={presetsLoading}
        message={presetMessage}
        error={presetError}
        allowSave={true}
        onApply={applySelectedProcessingPreset}
        onRefresh={loadProcessingPresets}
        onSave={saveCurrentProcessingPreset}
      />
    {:else if activeExplorerTab === 'preprocessing'}

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
      {#if backgroundCorrection}
        <label>
          Background frames
          <input
            type="range"
            min={backgroundFrameLimitMinimum()}
            max={backgroundFrameLimitMaximum()}
            step="1"
            bind:value={backgroundFrameLimit}
          />
          <span class="range-value">{backgroundFrameLimit} ({backgroundFrameWindowLabel()})</span>
        </label>
      {/if}

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

      {#if flatfieldCorrection}
        <div class="form-grid compact-grid">
          <label>
            Min field value
            <input type="range" min="0" max="255" step="1" bind:value={flatfieldMinFieldValue} />
            <span class="range-value">{flatfieldMinFieldValue}</span>
          </label>
          <label>
            Max field value
            <input type="range" min="0" max="255" step="1" bind:value={flatfieldMaxFieldValue} />
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
            <input type="range" min="0" max="255" step="1" bind:value={backgroundMaxFieldValue} />
            <span class="range-value">{backgroundMaxFieldValue ?? 'none'}</span>
          </label>
        </div>
      {/if}

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
        <input type="checkbox" bind:checked={applyMask} />
        Apply frame mask
      </label>
    </details>

    <div class="button-row">
        <button class="ghost" type="button" on:click={applyPreprocessingNow} disabled={frameCount < 1}>
          Apply
        </button>
      </div>

    {:else if activeExplorerTab === 'threshold'}

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

    <details class="form-section collapsible-section">
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

    <details class="form-section collapsible-section">
      <summary class="section-heading">
        <span>
          <p class="eyebrow">Display layer</p>
          <strong>Threshold overlay</strong>
        </span>
      </summary>
      <div class="form-grid compact-grid">
        <label>
          Color
          <select bind:value={thresholdOverlayColorMode}>
            {#each thresholdOverlayColorOptions as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </label>
        <label>
          Blend
          <select bind:value={thresholdOverlayBlendMode}>
            {#each thresholdOverlayBlendOptions as option}
              <option value={option.value}>
                {option.value === 'auto'
                  ? `Auto (${imageInverted ? 'Add' : 'Subtract'})`
                  : option.label}
              </option>
            {/each}
          </select>
        </label>
        <label class="span-2">
          Opacity
          <input type="range" min="0" max="1" step="0.01" bind:value={thresholdOverlayOpacity} />
          <span class="range-value">{Number(thresholdOverlayOpacity).toFixed(2)}</span>
        </label>
      </div>
    </details>

    <div class="button-row">
      <button type="button" on:click={() => previewThresholdNow()} disabled={frameCount < 1}>Preview threshold</button>
    </div>

    {#if thresholdForegroundPixels !== null}
      <div class="stage-counts">
        <span><strong>{formatCount(thresholdForegroundPixels)}</strong> foreground pixels</span>
        {#if thresholdForegroundFraction !== null}
          <span><strong>{(thresholdForegroundFraction * 100).toFixed(2)}%</strong> foreground</span>
        {/if}
      </div>
    {/if}

    {:else if activeExplorerTab === 'detection'}

    <div class="form-section">
      <div class="section-heading">
        <span>
          <p class="eyebrow">Default options</p>
          <strong>Candidate detection</strong>
        </span>
      </div>
      <div class="form-grid compact-grid">
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

      <label>
        Padding
        <input type="range" min="0" max="300" step="5" bind:value={padding} />
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
        <input type="number" min="1" bind:value={zstdMinBytes} placeholder="default" />
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

    <div class="button-row">
      <button type="button" on:click={previewDetectionCandidatesNow} disabled={frameCount < 1}>Refresh candidates</button>
    </div>

    {:else if activeExplorerTab === 'refinement'}

    <details class="form-section collapsible-section" open>
      <summary class="section-heading">
        <span>
          <p class="eyebrow">Refine</p>
          <strong>ROI mask refinement</strong>
        </span>
      </summary>

      <div class="refinement-overlay-controls">
        <label class="check-row">
          <input type="checkbox" bind:checked={showCandidateMasks} />
          Candidate mask overlay
        </label>
        <label class="check-row">
          <input type="checkbox" bind:checked={showRefinedMasks} />
          Refined mask overlay
        </label>
        <label>
          Mask color
          <select bind:value={refinementMaskOverlayColorMode}>
            {#each thresholdOverlayColorOptions as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </label>
        <label>
          Blend
          <select bind:value={refinementMaskOverlayBlendMode}>
            {#each thresholdOverlayBlendOptions as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </label>
        <label>
          Opacity
          <input type="range" min="0" max="1" step="0.01" bind:value={refinementMaskOverlayOpacity} />
          <span class="range-value">{Number(refinementMaskOverlayOpacity).toFixed(2)}</span>
        </label>
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

      <div class="form-grid compact-grid">
        <label>
          Tile size
          <input type="number" min="1" step="1" bind:value={refinementTileSize} />
        </label>
        <label>
          Model batch size
          <input type="number" min="1" bind:value={refinementModelBatchSize} placeholder="default" />
        </label>
        <label>
          Output threshold
          <input type="range" min="0" max="1" step="0.01" bind:value={refinementOutputThreshold} />
          <span class="range-value">{Number(refinementOutputThreshold).toFixed(2)}</span>
        </label>
        <label>
          Overlap fraction
          <input type="range" min="0" max="0.99" step="0.01" bind:value={refinementOverlapFraction} />
          <span class="range-value">{Number(refinementOverlapFraction).toFixed(2)}</span>
        </label>
      </div>

      <details class="control-details">
        <summary>Expansion and storage</summary>
        <label class="check-row">
          <input type="checkbox" bind:checked={refinementAllowFrameExpansion} />
          Allow frame expansion
        </label>
        <div class="form-grid compact-grid">
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
        </div>
      </details>
    </details>

    <div class="button-row">
      <button class="ghost" type="button" on:click={refineCurrentDetections} disabled={frameCount < 1 || refining}>
        {refining ? 'Refining' : 'Refine current ROIs'}
      </button>
     </div>
    {/if}

    {#if message}<p class="success">{message}</p>{/if}
    {#if error}<p class="form-error">{error}</p>{/if}
  </section>
</div>

{#if activeExplorerTab === 'refinement'}
<section class="panel bbox-panel refinement-roi-panel">
  <div class="panel-heading">
    <div>
      <p class="eyebrow">ROI refinement</p>
      <h2>Candidate and refined ROIs</h2>
    </div>
    <span class="soft">
      {detections.length} candidate{detections.length === 1 ? '' : 's'}, {refinedDetections.length} refined, {refinementRoiPairs.length} comparison{refinementRoiPairs.length === 1 ? '' : 's'}
    </span>
  </div>

  {#if hasRefinementResults}
    <div class="refinement-summary-grid">
      <div>
        <span>Refined ROIs</span>
        <strong>{formatCount(refinementSummary.count)}</strong>
      </div>
      <div>
        <span>Total ROI area</span>
        <strong>{formatStat(refinementSummary.areaCount ? refinementSummary.totalArea : null)}</strong>
        <small>{refinementSummary.areaCount ? `${formatCount(refinementSummary.areaCount)} with area` : 'area unavailable'}</small>
      </div>
      <div>
        <span>Mean area</span>
        <strong>{formatStat(refinementSummary.meanArea)}</strong>
      </div>
      <div>
        <span>Median area</span>
        <strong>{formatStat(refinementSummary.medianArea)}</strong>
      </div>
      <div>
        <span>Area range</span>
        <strong>{formatStat(refinementSummary.minArea)}-{formatStat(refinementSummary.maxArea)}</strong>
      </div>
      <div>
        <span>Total bbox area</span>
        <strong>{formatStat(refinementSummary.totalBboxArea)}</strong>
        <small>{refinementSummary.bboxAreaCount ? `${formatCount(refinementSummary.bboxAreaCount)} boxes` : 'bbox unavailable'}</small>
      </div>
    </div>
  {/if}

  {#if refinementRoiPairs.length}
    <div class="refinement-roi-compare">
      <div class="refinement-roi-column-heading">Candidate ROIs</div>
      <div class="refinement-roi-column-heading">Matching refined ROIs</div>
      {#each refinementRoiPairs as pair}
        <div class="refinement-roi-comparison-header">
          <span class={`refinement-relation-badge relation-${pair.relation}`}>
            {refinementRelationLabel(pair.relation)}
          </span>
          <strong>{refinementRelationDescription(pair)}</strong>
          {#if pair.notes.length}
            <small>{pair.notes.join(' · ')}</small>
          {/if}
        </div>

        <div class="refinement-roi-stack">
          {#if pair.candidates.length}
            {#each pair.candidates as candidate, candidateIndex}
              <div class="roi-tile refinement-roi-tile">
                {#if candidate.id && hasRoiPayload(candidate)}
                  <div class="roi-image-frame">
                    {#if refinementTileRelationLabel(pair, 'candidate')}
                      <span class={`refinement-tile-badge relation-${pair.relation}`}>
                        {refinementTileRelationLabel(pair, 'candidate')}
                      </span>
                    {/if}
                    {#key refinementRoiCanvasKey(pair, candidate, 'candidate')}
                      <KonvaImageCanvas
                        spec={refinementRoiRenderSpec(pair, candidate, 'candidate')}
                        mode="thumbnail"
                      />
                    {/key}
                  </div>
                {:else}
                  <div class="refinement-roi-placeholder">
                    Candidate ROI payload is not available yet.
                  </div>
                {/if}
                <div class="roi-tile-meta">
                  <strong>ROI {candidate.roi_index ?? candidateIndex + 1}</strong>
                  <code>{refinementRoiBboxLabel(candidate, candidateIndex)}</code>
                  <small>{refinementRoiMetricSummary(candidate)}</small>
                </div>
              </div>
            {/each}
          {:else}
            <div class="refinement-roi-placeholder">
              No matching candidate ROI was found in the current detection set.
            </div>
          {/if}
        </div>

        <div class="refinement-roi-stack">
          {#if pair.refinedDetections.length}
            {#each pair.refinedDetections as refinedDetection, refinedIndex}
              <div class="roi-tile refinement-roi-tile">
                <div class="roi-image-frame">
                  {#if refinementTileRelationLabel(pair, 'refined')}
                    <span class={`refinement-tile-badge relation-${pair.relation}`}>
                      {refinementTileRelationLabel(pair, 'refined')}
                    </span>
                  {/if}
                  {#key refinementRoiCanvasKey(pair, refinedDetection, 'refined')}
                    <KonvaImageCanvas
                      spec={refinementRoiRenderSpec(pair, refinedDetection, 'refined')}
                      mode="thumbnail"
                    />
                  {/key}
                </div>
                <div class="roi-tile-meta">
                  <strong>ROI {refinedDetection.roi_index ?? refinedIndex + 1}</strong>
                  <code>{refinementRoiBboxLabel(refinedDetection, refinedIndex)}</code>
                  <small>{refinementRoiMetricSummary(refinedDetection)}</small>
                </div>
              </div>
            {/each}
          {:else}
            <div class="refinement-roi-placeholder">
              No refined ROI has been generated for this candidate.
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <p class="empty-state">Refresh candidates before refining ROIs.</p>
  {/if}

  {#if stageCountEntries(stageCounts).length}
    <div class="stage-counts">
      {#each stageCountEntries(stageCounts) as [key, value]}
        <span><strong>{value}</strong> {key.replaceAll('_', ' ')}</span>
      {/each}
    </div>
  {/if}
</section>
{:else if activeExplorerTab === 'detection'}
<section class="panel bbox-panel">
  <div class="panel-heading">
    <div>
      <p class="eyebrow">{hasRefinementResults ? 'Refinement summary' : 'Bounding boxes'}</p>
      <h2>{hasRefinementResults ? 'Current frame refinement' : 'Current frame detections'}</h2>
    </div>
    <span class="soft">{detections.length} detection{detections.length === 1 ? '' : 's'}, {boxes.length} box{boxes.length === 1 ? '' : 'es'}</span>
  </div>

  {#if hasRefinementResults}
    <div class="refinement-summary-grid">
      <div>
        <span>Refined ROIs</span>
        <strong>{formatCount(refinementSummary.count)}</strong>
      </div>
      <div>
        <span>Total ROI area</span>
        <strong>{formatStat(refinementSummary.areaCount ? refinementSummary.totalArea : null)}</strong>
        <small>{refinementSummary.areaCount ? `${formatCount(refinementSummary.areaCount)} with area` : 'area unavailable'}</small>
      </div>
      <div>
        <span>Mean area</span>
        <strong>{formatStat(refinementSummary.meanArea)}</strong>
      </div>
      <div>
        <span>Median area</span>
        <strong>{formatStat(refinementSummary.medianArea)}</strong>
      </div>
      <div>
        <span>Area range</span>
        <strong>{formatStat(refinementSummary.minArea)}-{formatStat(refinementSummary.maxArea)}</strong>
      </div>
      <div>
        <span>Total bbox area</span>
        <strong>{formatStat(refinementSummary.totalBboxArea)}</strong>
        <small>{refinementSummary.bboxAreaCount ? `${formatCount(refinementSummary.bboxAreaCount)} boxes` : 'bbox unavailable'}</small>
      </div>
    </div>
    <p class="soft">Bounding-box overlays are hidden while refined mask overlays are available.</p>
  {/if}

  {#if stageCountEntries(stageCounts).length}
    <div class="stage-counts">
      {#each stageCountEntries(stageCounts) as [key, value]}
        <span><strong>{value}</strong> {key.replaceAll('_', ' ')}</span>
      {/each}
    </div>
  {/if}
</section>
{/if}
</section>
