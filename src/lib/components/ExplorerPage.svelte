<script lang="ts">
  import { onMount } from 'svelte';
  import FrameDisplayToggle from '$lib/components/FrameDisplayToggle.svelte';
  import ImageCanvas from '$lib/components/ImageCanvas.svelte';
  import { getClient } from '$lib/stores/session';
  import type {
    DetectionSummary,
    FrameSummary,
    RawAsset,
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
    isFrameDisplayInverted,
    payloadKindForDisplay,
    type FrameDisplayMode
  } from '$lib/utils/frameDisplay';
  import type { CanvasOverlayRect } from '$lib/utils/imageCanvas';

  let assets: RawAsset[] = [];
  let frames: FrameSummary[] = [];
  let detections: DetectionSummary[] = [];
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
  let backgroundPercentile = 50;
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
  let flatfieldCorrection = false;
  let flatfieldQ = 0.95;
  let flatfieldAxis = 0;
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
  const cropPreviewWidth = 220;
  const cropPreviewHeight = 160;
  const frameImageWidth = 1100;
  let lastFrameImageKey = '';
  let failedImageUrl = '';

  $: selectedFrame = findFrameByNumber(selectedFrameNum);
  $: framePayloadKind = payloadKindForDisplay(frameDisplayMode);
  $: imageInverted = isFrameDisplayInverted(frameDisplayMode);
  $: imageUrl =
    selectedAssetId && selectedFrameNum > 0
      ? framePreviewUrl(frameDisplayMode, preprocessedReloadKey, selectedFrame)
      : '';
  $: imageUnavailable = Boolean(imageUrl && failedImageUrl === imageUrl);
  $: void loadFrameImageHeaders(imageUrl);
  $: boxes = detections.map(toCropBox).filter((box): box is BBox => box !== null);
  $: targetBoxes = detections.map(toTargetBox).filter((box): box is BBox => box !== null);
  $: canvasOverlays = frameCanvasOverlays(
    boxes,
    targetBoxes,
    imageUrl,
    imageInverted,
    bboxCoordinateBasis
  );
  $: previewOptionsKey = optionsKey(
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
    sobelKernelSize,
    backgroundCorrection,
    backgroundPercentile,
    flatfieldCorrection,
    flatfieldQ,
    flatfieldAxis,
    applyMask,
    cropEnabled,
    cropX,
    cropY,
    cropW,
    cropH,
    invertIntensity,
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
  $: resetLivePreviewForImageOptions(selectedAssetId, selectedFrameNum, previewOptionsKey);

  onMount(async () => {
    const client = getClient();
    if (!client) return;
    try {
      const [config, segmentationCapabilities] = await Promise.all([
        client.systemConfig().catch(() => null),
        client.segmentationOptions().catch(() => null)
      ]);
      applyConfigDefaults(config, segmentationCapabilities);
      assets = await client.listAssets('video');
      selectedAssetId = assets[0]?.id ?? '';
      if (selectedAssetId) await loadFrames();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  });

  function applyConfigDefaults(config: SystemConfigResponse | null, capabilities: SegmentationCapabilities | null = null) {
    const thresholding = pipelineSection(config, capabilities, 'thresholding');
    const flatfield = capabilities?.defaults?.preprocessing ?? processingSection(config, 'flatfield');
    const preprocessing = pipelineSection(config, capabilities, 'preprocessing');
    const maskAugmentation = pipelineSection(config, capabilities, 'mask_augmentation');
    const roiAssembly = pipelineSection(config, capabilities, 'roi_assembly');
    const roiFilter = pipelineSection(config, capabilities, 'roi_filter');
    const roiRecording = pipelineSection(config, capabilities, 'roi_recording');

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
    backgroundCorrection = booleanDefault(preprocessing, 'background_correction', backgroundCorrection);
    backgroundPercentile = numberDefault(preprocessing, 'background_percentile', backgroundPercentile);
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
    hasLivePreview = false;
    selectedAsset = await client.getAsset(selectedAssetId);
    frameCount = selectedAsset.frame_count ?? 0;
    frames = frameCount > 0 ? await client.listFrames(selectedAssetId, frameCount) : [];
    selectedFrameNum = frameCount > 0 ? 1 : 0;
    detections = [];
    stageCounts = {};
    bboxCoordinateBasis = 'original-frame';
    await loadDetections();
  }

  async function loadDetections() {
    const client = getClient();
    if (!client || !selectedAssetId) return;
    hasLivePreview = false;
    const frame = await ensureSelectedFrame();
    if (!frame?.id) {
      detections = [];
      stageCounts = {};
      bboxCoordinateBasis = 'original-frame';
      return;
    }
    detections = await client.listDetections(selectedAssetId, frame.id);
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
    return {
      background_correction: backgroundCorrection,
      background_percentile: backgroundCorrection ? backgroundPercentile : undefined,
      flatfield_correction: flatfieldCorrection,
      flatfield_q: flatfieldCorrection ? flatfieldQ : undefined,
      flatfield_axis: flatfieldCorrection ? flatfieldAxis : undefined,
      apply_mask: applyMask,
      crop_enabled: cropEnabled,
      crop_x: cropEnabled ? cropX : undefined,
      crop_y: cropEnabled ? cropY : undefined,
      crop_w: cropEnabled ? cropW : undefined,
      crop_h: cropEnabled ? cropH : undefined,
      invert_intensity: invertIntensity
    };
  }

  function framePreviewUrl(
    mode: FrameDisplayMode,
    reloadKey: number,
    frame: FrameSummary | undefined
  ): string {
    const client = getClient();
    if (!client || !selectedAssetId || selectedFrameNum < 1) return '';
    const kind = payloadKindForDisplay(mode);
    const base = {
      frame_id: frame?.id,
      asset_id: frame?.id ? undefined : selectedAssetId,
      frame_num: frame?.id ? undefined : selectedFrameNum,
      format: 'jpg',
      width: frameImageWidth,
      cache_bust: kind === 'preprocessed' && reloadKey ? reloadKey : undefined
    };
    return kind === 'preprocessed' ? client.preprocessedFrameUrl(base) : client.originalFrameUrl(base);
  }

  function optionsKey(
    mode: FrameDisplayMode,
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
    sobelKernelValue: number,
    backgroundEnabled: boolean,
    backgroundValue: number,
    flatfieldEnabled: boolean,
    flatfieldValue: number,
    flatfieldAxisValue: number,
    maskEnabled: boolean,
    cropIsEnabled: boolean,
    cropXValue: number | null,
    cropYValue: number | null,
    cropWValue: number | null,
    cropHValue: number | null,
    invertEnabled: boolean,
    minPerimeterValue: number,
    maxPerimeterValue: number | null,
    paddingValue: number,
    extraValues: unknown = null
  ): string {
    return JSON.stringify({
      frame_display_mode: mode,
      frame_payload_kind: payloadKindForDisplay(mode),
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
      sobel_kernel_size: sobelKernelValue,
      background_correction: backgroundEnabled,
      background_percentile: backgroundEnabled ? backgroundValue : undefined,
      flatfield_correction: flatfieldEnabled,
      flatfield_q: flatfieldEnabled ? flatfieldValue : undefined,
      flatfield_axis: flatfieldEnabled ? flatfieldAxisValue : undefined,
      apply_mask: maskEnabled,
      crop_enabled: cropIsEnabled,
      crop_x: cropIsEnabled ? cropXValue : undefined,
      crop_y: cropIsEnabled ? cropYValue : undefined,
      crop_w: cropIsEnabled ? cropWValue : undefined,
      crop_h: cropIsEnabled ? cropHValue : undefined,
      invert_intensity: invertEnabled,
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
      hasLivePreview = false;
      detections = [];
      bboxCoordinateBasis = 'original-frame';
    }
    lastFrameImageKey = key;
  }

  async function segmentNow() {
    const client = getClient();
    const frame = await ensureSelectedFrame();
    if (!client || !frame?.id) return;
    message = null;
    error = null;
    try {
      const result = await client.liveSegmentFrame(frame.id, options());
      detections = result.detections;
      stageCounts = result.stage_counts ?? {};
      bboxCoordinateBasis = liveBboxCoordinateBasis(result);
      hasLivePreview = true;
      message = `Previewed frame ${selectedFrameNum}; ${result.detection_count} ROI${result.detection_count === 1 ? '' : 's'} detected.`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function applyPreprocessingNow() {
    const client = getClient();
    const frame = await ensureSelectedFrame();
    if (!client || !frame?.id) return;
    message = null;
    error = null;
    try {
      await client.preprocessFrame({
        frame_id: frame.id,
        ...preprocessingOptions(),
        store: true,
        encoding: 'png'
      });
      frameDisplayMode = 'preprocessed';
      preprocessedReloadKey = Date.now();
      hasLivePreview = false;
      detections = [];
      stageCounts = {};
      bboxCoordinateBasis = 'original-frame';
      message = `Applied preprocessing to frame ${selectedFrameNum} and reloaded the preprocessed image.`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function saveSegmentation() {
    const client = getClient();
    const frame = await ensureSelectedFrame();
    if (!client || !frame?.id) return;
    message = null;
    error = null;
    try {
      const result = await client.segmentFrame(frame.id, options());
      detections = result.detections;
      stageCounts = result.stage_counts ?? {};
      bboxCoordinateBasis = liveBboxCoordinateBasis(result);
      message = `Saved segmentation for frame ${selectedFrameNum}; ${result.detection_count} ROI${result.detection_count === 1 ? '' : 's'} stored.`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
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
      const headResponse = await fetch(url, { method: 'HEAD' });
      if (serial !== imageHeaderSerial) return;
      const headScale = scaleHeaders(headResponse);
      if (headScale) {
        imageScaleX = headScale.x;
        imageScaleY = headScale.y;
        return;
      }

      const imageResponse = await fetch(url);
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
    if (!imageNaturalWidth || !imageNaturalHeight || imageScaleX === null || imageScaleY === null) return '';
    const scaled = scaleBoxToDisplayedFrame(box, imageScaleX, imageScaleY, bboxCoordinateBasis);
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

  function scaleBoxToDisplayedFrame(
    box: BBox,
    scaleX: number,
    scaleY: number,
    basis: BboxCoordinateBasis
  ): BBox {
    const origin = overlayOrigin(basis);
    return {
      ...box,
      x: (box.x - origin.x) * scaleX,
      y: (box.y - origin.y) * scaleY,
      w: box.w * scaleX,
      h: box.h * scaleY
    };
  }

  function frameCanvasOverlays(
    cropBoxes: BBox[],
    targetBoxesForFrame: BBox[],
    currentImageUrl: string,
    currentImageInverted: boolean,
    basis: BboxCoordinateBasis
  ): CanvasOverlayRect[] {
    if (imageScaleX === null || imageScaleY === null) return [];
    const scaleX = imageScaleX;
    const scaleY = imageScaleY;
    return [
      ...cropBoxes.map((box) => {
        const scaled = scaleBoxToDisplayedFrame(box, scaleX, scaleY, basis);
        return {
          id: `crop-${box.index}`,
          x: scaled.x,
          y: scaled.y,
          w: scaled.w,
          h: scaled.h,
          stroke: '#f5e642',
          lineWidth: 2,
          halo: 'rgba(17, 25, 22, 0.7)',
          className: 'bbox-hotspot',
          coordinateSpace: 'image' as const,
          hoverPreview: {
            imageUrl: currentImageUrl,
            inverted: currentImageInverted,
            imageStyle: cropImageStyle(box)
          }
        };
      }),
      ...targetBoxesForFrame.map((box) => {
        const scaled = scaleBoxToDisplayedFrame(box, scaleX, scaleY, basis);
        return {
          id: `target-${box.index}`,
          x: scaled.x,
          y: scaled.y,
          w: scaled.w,
          h: scaled.h,
          stroke: '#e2322e',
          lineWidth: 3,
          halo: 'rgba(255, 255, 255, 0.8)',
          className: 'bbox-target',
          coordinateSpace: 'image' as const,
          selected: true
        };
      })
    ];
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

  function stageCountEntries(counts: Record<string, number>): Array<[string, number]> {
    return Object.entries(counts).filter(([, value]) => Number.isFinite(Number(value)));
  }
</script>

<div class="segmentation-layout">
  <section class="panel image-panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Frame data</p>
        <h2>Explorer preview</h2>
      </div>
      {#if loading}<span class="soft">Loading</span>{/if}
    </div>

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

    <FrameDisplayToggle bind:value={frameDisplayMode} />

    <div class="frame-stage comparison-stage">
      {#if imageUrl}
        <figure>
          <figcaption>{frameCaption(frameDisplayMode)}</figcaption>
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
            {#key imageUrl}
              <ImageCanvas
                imageUrl={imageUrl}
                alt={hasLivePreview ? 'Selected frame with explorer bounding boxes' : 'Selected frame'}
                filename={frameExportFilename()}
                annotatedFilename={frameExportFilename(true)}
                overlays={canvasOverlays}
                inverted={imageInverted}
                onImageLoad={setImageNaturalSize}
                onImageError={markImageUnavailable}
                exportControls="menu"
              />
            {/key}
          {/if}
        </figure>
      {:else}
        <p class="empty">Select an ingested asset with stored frames to preview segmentation.</p>
      {/if}
    </div>

    <div class="detection-strip">
      <strong>{detections.length}</strong>
      <span>detections on selected frame</span>
    </div>
  </section>

  <section class="panel controls-panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Options</p>
        <h2>Explorer controls</h2>
      </div>
    </div>

    <details class="form-section collapsible-section" open>
      <summary class="section-heading">
        <span>
          <p class="eyebrow">Background + flatfield</p>
          <strong>Correction</strong>
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
          <p class="eyebrow">Crop + mask + invert</p>
          <strong>Candidate image</strong>
        </span>
      </summary>

      <label class="check-row">
        <input type="checkbox" bind:checked={applyMask} />
        Apply stored frame mask
      </label>

      <label class="check-row">
        <input type="checkbox" bind:checked={cropEnabled} />
        Crop before thresholding
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

      <div class="button-row">
        <button class="ghost" type="button" on:click={applyPreprocessingNow} disabled={frameCount < 1}>
          Apply preprocessing
        </button>
      </div>
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
      <button type="button" on:click={segmentNow} disabled={frameCount < 1}>Preview live</button>
     </div>

    {#if message}<p class="success">{message}</p>{/if}
    {#if error}<p class="form-error">{error}</p>{/if}
  </section>
</div>

<section class="panel bbox-panel">
  <div class="panel-heading">
    <div>
      <p class="eyebrow">Bounding boxes</p>
      <h2>Current frame detections</h2>
    </div>
    <span class="soft">{detections.length} detection{detections.length === 1 ? '' : 's'}, {boxes.length} box{boxes.length === 1 ? '' : 'es'}</span>
  </div>

  {#if stageCountEntries(stageCounts).length}
    <div class="stage-counts">
      {#each stageCountEntries(stageCounts) as [key, value]}
        <span><strong>{value}</strong> {key.replaceAll('_', ' ')}</span>
      {/each}
    </div>
  {/if}

  {#if boxes.length}
    <ol class="bbox-list">
      {#each boxes as box}
        <li>
          <span class="bbox-index">#{box.index}</span>
          <code>x={box.x}, y={box.y}, w={box.w}, h={box.h}</code>
          {#if box.area !== undefined || box.perimeter !== undefined}
            <small>
              {#if box.area !== undefined}area={Math.round(box.area)}{/if}
              {#if box.area !== undefined && box.perimeter !== undefined} · {/if}
              {#if box.perimeter !== undefined}perimeter={Math.round(box.perimeter)}{/if}
            </small>
          {/if}
          {#if imageUrl && !imageUnavailable && imageNaturalWidth && imageNaturalHeight}
            <div class="bbox-hover-preview" aria-hidden="true">
              <img class:inverted-frame={imageInverted} src={imageUrl} alt="" style={cropImageStyle(box)} />
            </div>
          {/if}
        </li>
      {/each}
    </ol>
  {:else}
    <p class="empty">{detections.length ? 'Detections were returned, but no bbox fields could be parsed.' : 'No bounding boxes for the current frame.'}</p>
  {/if}
</section>
