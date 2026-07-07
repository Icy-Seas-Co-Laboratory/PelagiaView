<script lang="ts">
  import { page } from '$app/stores';
  import { onDestroy, onMount, tick } from 'svelte';
  import FrameDisplayToggle from '$lib/components/FrameDisplayToggle.svelte';
  import KonvaImageCanvas from '$lib/components/KonvaImageCanvas.svelte';
  import { imageInversionEnabled } from '$lib/stores/displayPreferences';
  import { getClient } from '$lib/stores/session';
  import type { DetectionFilters, DetectionSummary, FrameContextResponse, FrameSummary, RawAsset, SystemConfigResponse } from '$lib/api/types';
  import { processingSection, stringDefault } from '$lib/utils/configDefaults';
  import { roiBrowserHref } from '$lib/utils/dashboardNavigation';
  import {
    displayModeForPayloadKind,
    frameCaption,
    payloadKindForDisplay,
    type FrameDisplayMode
  } from '$lib/utils/frameDisplay';
  import { formatBytes } from '$lib/utils/format';
  import type { ImageInfoSpec, ImageLayer, ImageOverlayRect, ImageRenderSpec } from '$lib/utils/imageRenderSpec';

  type RoiViewMode = 'candidate' | 'refined';

  let assets: RawAsset[] = [];
  let detections: DetectionSummary[] = [];
  let selectedAssetId = '';
  let selectedFrameId = '';
  let collection = '';
  let startFrame: number | null = null;
  let endFrame: number | null = null;
  let minArea: number | null = null;
  let maxArea: number | null = null;
  let minPerimeter: number | null = null;
  let maxPerimeter: number | null = null;
  let minBBoxW: number | null = null;
  let maxBBoxW: number | null = null;
  let minBBoxH: number | null = null;
  let maxBBoxH: number | null = null;
  let roiEncoding = '';
  let imageFormat = 'png';
  let invertImages = false;
  let applyRoiMask = false;
  let roiViewMode: RoiViewMode = 'candidate';
  let sortBy: 'area' | 'byte_size' | 'id' | 'asset_frame' = 'asset_frame';
  let sortDir: 'asc' | 'desc' = 'desc';
  let nextOffset = 0;
  let hasMore = true;
  let loading = false;
  let error: string | null = null;
  let detailError: string | null = null;
  let requestSerial = 0;
  let preferencesReady = false;
  let selectedDetection: DetectionSummary | null = null;
  let selectedParentAsset: RawAsset | null = null;
  let selectedParentFrame: FrameSummary | null = null;
  let selectedFrameContext: FrameContextResponse | null = null;
  let frameDetections: DetectionSummary[] = [];
  let frameDetectionsLoading = false;
  let frameDetectionsComplete = false;
  let frameDetectionLoadSerial = 0;
  let frameImageNaturalWidth = 0;
  let frameImageNaturalHeight = 0;
  let detailFrameDisplayMode: FrameDisplayMode = 'preprocessed';
  let frameDetailOpen = false;
  let frameModalDisplayMode: FrameDisplayMode = 'original';
  let detailFrameFailedUrl = '';
  let frameModalFailedUrl = '';
  let lastDetailFrameUrl = '';
  let lastFrameModalUrl = '';
  let fullResolutionTileKeys = new Set<string>();
  let tileScroller: HTMLElement;
  let loadMoreSentinel: HTMLElement;
  let pageScroller: HTMLElement | null = null;
  let lastRequestedAppendOffset: number | null = null;
  const roiBrowserPreferenceKey = 'pelagia-view:roi-browser:v1';
  const pageSize = 120;
  const frameDetectionBatchSize = 100;
  const roiDisplayMaxWidth = 220;
  const roiDisplayMaxHeight = 190;
  const roiProxyThresholdPx = 200;
  const roiProxyMaxDimensionPx = 200;
  const modalRoiDisplayMaxWidth = 520;
  const modalRoiDisplayMaxHeight = 460;
  const frameContextImageWidth = 380;
  const frameModalImageWidth = 1100;
  const frameModalImageMaxHeight = 720;
  const fullFrameBboxScale = 0.5;
  const scaleBarLengths = [1000, 500, 100, 50, 10];

  $: visibleCount = detections.filter((detection) => detection.id).length;
  $: detailFramePayloadKind = payloadKindForDisplay(detailFrameDisplayMode);
  $: frameModalPayloadKind = payloadKindForDisplay(frameModalDisplayMode);
  $: invertImages = $imageInversionEnabled;
  $: detailFrameImageInverted = detailFramePayloadKind !== 'original' && $imageInversionEnabled;
  $: frameModalImageInverted = frameModalPayloadKind !== 'original' && $imageInversionEnabled;
  $: detailFrameUrl = selectedDetection ? frameContextUrl(selectedDetection, detailFrameDisplayMode) : '';
  $: frameModalUrl = selectedDetection && frameDetailOpen ? frameModalContextUrl(selectedDetection, frameModalDisplayMode) : '';
  $: detailFrameSourceDimensions = parentFrameDimensions() ?? fallbackSourceDimensions(frameImageNaturalWidth, frameImageNaturalHeight);
  $: frameModalSourceDimensions = parentFrameDimensionsForPayload(
    frameModalPayloadKind,
    frameImageNaturalWidth,
    frameImageNaturalHeight
  );
  $: detailFrameUnavailable = Boolean(
    detailFramePayloadKind === 'preprocessed' && selectedFrameContext && !selectedFrameContext.image_urls?.preprocessed
  ) || Boolean(detailFrameUrl && detailFrameFailedUrl === detailFrameUrl);
  $: frameModalUnavailable = Boolean(frameModalUrl && frameModalFailedUrl === frameModalUrl);
  $: detailFrameCanvasOverlays = frameContextCanvasOverlays(
    frameDetections,
    selectedDetection,
    detailFramePayloadKind,
    selectedParentFrame,
    frameImageNaturalWidth,
    frameImageNaturalHeight,
    detailFrameSourceDimensions
  );
  $: frameModalCanvasOverlays = frameContextCanvasOverlays(
    frameDetections,
    selectedDetection,
    frameModalPayloadKind,
    selectedParentFrame,
    frameImageNaturalWidth,
    frameImageNaturalHeight,
    frameModalSourceDimensions
  );
  $: resetFrameContextImage(detailFrameUrl);
  $: resetFrameModalImage(frameModalUrl);
  $: syncPageScrollListener(tileScroller);
  $: roiPreferenceSnapshot = {
    selectedAssetId,
    collection,
    startFrame,
    endFrame,
    minArea,
    maxArea,
    minPerimeter,
    maxPerimeter,
    minBBoxW,
    maxBBoxW,
    minBBoxH,
    maxBBoxH,
    roiEncoding,
    imageFormat,
    applyRoiMask,
    roiViewMode,
    sortBy,
    sortDir
  };
  $: if (preferencesReady) persistPreferences(roiPreferenceSnapshot);

  onMount(async () => {
    const client = getClient();
    if (!client) return;
    try {
      const restored = restorePreferences();
      const config = await client.systemConfig().catch(() => null);
      applyConfigDefaults(config, restored);
      applyUrlFilters($page.url.searchParams);
      preferencesReady = true;
      assets = await client.listAssets('video', 500);
      await loadDetections(true);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      loading = false;
    }
  });

  onDestroy(() => {
    detachPageScrollListener();
  });

  async function loadDetections(reset = false) {
    const client = getClient();
    if (!client || loading || (!reset && !hasMore)) return;
    const offset = reset ? 0 : nextOffset;
    if (!reset && offset === lastRequestedAppendOffset) return;
    loading = true;
    error = null;
    const serial = ++requestSerial;
    if (reset) {
      fullResolutionTileKeys = new Set();
      lastRequestedAppendOffset = null;
    } else {
      lastRequestedAppendOffset = offset;
    }
    try {
      const response = await client.searchDetectionsPage(currentFilters(offset));
      const page = response.detections ?? [];
      if (serial !== requestSerial) return;
      detections = reset ? page : [...detections, ...withoutDuplicateDetections(page)];
      nextOffset = response.page?.next_offset ?? offset + page.length;
      hasMore = response.page?.next_offset !== null && response.page?.next_offset !== undefined;
    } catch (err) {
      if (!reset) lastRequestedAppendOffset = null;
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  function currentFilters(offset = 0): DetectionFilters {
    return {
      asset_id: selectedAssetId || undefined,
      frame_id: selectedFrameId || undefined,
      collection: collection || undefined,
      start_frame: startFrame,
      end_frame: endFrame,
      min_bbox_w: minBBoxW,
      max_bbox_w: maxBBoxW,
      min_bbox_h: minBBoxH,
      max_bbox_h: maxBBoxH,
      min_area: minArea,
      max_area: maxArea,
      min_perimeter: minPerimeter,
      max_perimeter: maxPerimeter,
      roi_encoding: roiEncoding || undefined,
      refinement_state: roiViewMode === 'refined' ? 'refined' : undefined,
      sort_by: sortBy,
      sort_dir: sortDir,
      limit: pageSize,
      offset
    };
  }

  function resetFilters() {
    selectedAssetId = '';
    selectedFrameId = '';
    collection = '';
    startFrame = null;
    endFrame = null;
    minArea = null;
    maxArea = null;
    minPerimeter = null;
    maxPerimeter = null;
    minBBoxW = null;
    maxBBoxW = null;
    minBBoxH = null;
    maxBBoxH = null;
    roiEncoding = '';
    nextOffset = 0;
    hasMore = true;
    fullResolutionTileKeys = new Set();
    void loadDetections(true);
  }

  type RoiPreferences = typeof roiPreferenceSnapshot;

  function restorePreferences(): boolean {
    if (typeof localStorage === 'undefined') return false;
    const saved = localStorage.getItem(roiBrowserPreferenceKey);
    if (!saved) return false;
    try {
      const preferences = JSON.parse(saved) as Partial<RoiPreferences>;
      selectedAssetId = stringPreference(preferences.selectedAssetId, selectedAssetId);
      collection = stringPreference(preferences.collection, collection);
      startFrame = nullableNumberPreference(preferences.startFrame, startFrame);
      endFrame = nullableNumberPreference(preferences.endFrame, endFrame);
      minArea = nullableNumberPreference(preferences.minArea, minArea);
      maxArea = nullableNumberPreference(preferences.maxArea, maxArea);
      minPerimeter = nullableNumberPreference(preferences.minPerimeter, minPerimeter);
      maxPerimeter = nullableNumberPreference(preferences.maxPerimeter, maxPerimeter);
      minBBoxW = nullableNumberPreference(preferences.minBBoxW, minBBoxW);
      maxBBoxW = nullableNumberPreference(preferences.maxBBoxW, maxBBoxW);
      minBBoxH = nullableNumberPreference(preferences.minBBoxH, minBBoxH);
      maxBBoxH = nullableNumberPreference(preferences.maxBBoxH, maxBBoxH);
      roiEncoding = stringPreference(preferences.roiEncoding, roiEncoding);
      imageFormat = stringPreference(preferences.imageFormat, imageFormat);
      applyRoiMask = typeof preferences.applyRoiMask === 'boolean' ? preferences.applyRoiMask : applyRoiMask;
      roiViewMode = roiViewModePreference(preferences.roiViewMode, roiViewMode);
      sortBy = sortByPreference(preferences.sortBy, sortBy);
      sortDir = sortDirPreference(preferences.sortDir, sortDir);
      return true;
    } catch {
      return false;
    }
  }

  function persistPreferences(preferences: RoiPreferences) {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(roiBrowserPreferenceKey, JSON.stringify(preferences));
  }

  function applyConfigDefaults(config: SystemConfigResponse | null, restored: boolean) {
    if (restored) return;
    const frameStorage = processingSection(config, 'frame_storage');
    const configuredFormat = stringDefault(frameStorage, 'image_encoding', imageFormat);
    imageFormat = configuredFormat === 'jpg' || configuredFormat === 'jpeg' ? 'jpg' : 'png';
  }

  function applyUrlFilters(params: URLSearchParams) {
    const assetId = params.get('asset_id');
    const frameId = params.get('frame_id');
    const frameNum = nullableNumberPreference(params.get('frame_num'), null);
    if (assetId) selectedAssetId = assetId;
    if (frameId) selectedFrameId = frameId;
    if (frameNum !== null) {
      startFrame = frameNum;
      endFrame = frameNum;
    }
  }

  function stringPreference(value: unknown, fallback: string): string {
    return typeof value === 'string' ? value : fallback;
  }

  function sortByPreference(value: unknown, fallback: typeof sortBy): typeof sortBy {
    return value === 'area' || value === 'byte_size' || value === 'id' || value === 'asset_frame'
      ? value
      : fallback;
  }

  function sortDirPreference(value: unknown, fallback: typeof sortDir): typeof sortDir {
    return value === 'asc' || value === 'desc' ? value : fallback;
  }

  function roiViewModePreference(value: unknown, fallback: RoiViewMode): RoiViewMode {
    return value === 'candidate' || value === 'refined' ? value : fallback;
  }

  function setRoiViewMode(mode: RoiViewMode) {
    if (roiViewMode === mode) return;
    roiViewMode = mode;
    nextOffset = 0;
    hasMore = true;
    closeRoiDetail();
    void loadDetections(true);
  }

  function nullableNumberPreference(value: unknown, fallback: number | null): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function maybeLoadMore(event: Event) {
    const scroller = event.currentTarget as HTMLElement;
    if (!scroller || loading || !hasMore) return;
    const remaining = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (remaining < 700) {
      void loadDetections(false);
    }
  }

  function maybeLoadMoreFromPageScroll(event: Event) {
    const scroller = event.currentTarget as HTMLElement;
    if (!scroller || loading || !hasMore || !loadMoreSentinel) return;
    const remaining = loadMoreSentinel.getBoundingClientRect().top - scroller.getBoundingClientRect().bottom;
    if (remaining < 700) {
      void loadDetections(false);
    }
  }

  function syncPageScrollListener(scroller: HTMLElement | undefined) {
    const nextScroller = scroller?.closest('.page-scroll-content') as HTMLElement | null;
    if (nextScroller === pageScroller) return;
    detachPageScrollListener();
    pageScroller = nextScroller;
    pageScroller?.addEventListener('scroll', maybeLoadMoreFromPageScroll, { passive: true });
  }

  function detachPageScrollListener() {
    pageScroller?.removeEventListener('scroll', maybeLoadMoreFromPageScroll);
    pageScroller = null;
  }

  function scrollToTop() {
    tileScroller?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function openRoiDetail(detection: DetectionSummary) {
    const serial = ++frameDetectionLoadSerial;
    selectedDetection = detection;
    selectedParentAsset = null;
    selectedParentFrame = null;
    selectedFrameContext = null;
    frameDetections = detection.id ? [detection] : [];
    frameDetectionsLoading = true;
    frameDetectionsComplete = false;
    detailError = null;
    detailFrameDisplayMode = 'preprocessed';
    detailFrameFailedUrl = '';
    frameImageNaturalWidth = 0;
    frameImageNaturalHeight = 0;
    const client = getClient();
    if (!client || !detection.asset_id || !detection.frame_id) {
      frameDetectionsLoading = false;
      return;
    }
    try {
      const context = await client.frameContext(detection.frame_id, {
        width: frameContextImageWidth,
        include_detections: true,
        detection_limit: frameDetectionBatchSize,
        detection_offset: 0,
        frame_payload_kind: detailFramePayloadKind
      });
      if (serial !== frameDetectionLoadSerial) return;
      selectedFrameContext = context;
      detailFrameDisplayMode = displayModeForPayloadKind(context.frame_payload_kind);
      selectedParentAsset = context.asset ?? null;
      selectedParentFrame = context.frame ?? null;
      const contextDetection = context.detections.find((candidate) => candidate.id && candidate.id === detection.id);
      selectedDetection = contextDetection ? { ...detection, ...contextDetection } : detection;
      frameDetections = frameDetectionsWithSelected(selectedDetection, context.detections);
      const next = context.page?.next_offset ?? null;
      frameDetectionsComplete = next === null;
      if (next !== null) {
        void loadFrameDetectionBatches(selectedDetection, serial, next);
      } else {
        frameDetectionsLoading = false;
      }
    } catch (err) {
      detailError = err instanceof Error ? err.message : String(err);
      frameDetectionsLoading = false;
    }
  }

  async function loadFrameDetectionBatches(detection: DetectionSummary, serial: number, startOffset = 0) {
    const client = getClient();
    if (!client || !detection.asset_id || !detection.frame_id) return;
    let offset: number | null = startOffset;
    try {
      while (serial === frameDetectionLoadSerial && offset !== null) {
        const context = await client.frameContext(detection.frame_id, {
          width: frameContextImageWidth,
          include_detections: true,
          detection_limit: frameDetectionBatchSize,
          detection_offset: offset,
          frame_payload_kind: detailFramePayloadKind
        });
        if (serial !== frameDetectionLoadSerial) return;
        selectedFrameContext = { ...context, detections: frameDetections };
        selectedParentAsset = context.asset ?? selectedParentAsset;
        selectedParentFrame = context.frame ?? selectedParentFrame;
        const page = context.detections ?? [];
        const additions = withoutDuplicateFrameDetections(page);
        if (additions.length) frameDetections = [...frameDetections, ...additions];
        offset = context.page?.next_offset ?? null;
        if (offset !== null && additions.length === 0) break;
        await tick();
      }
      if (serial === frameDetectionLoadSerial) frameDetectionsComplete = true;
    } catch (err) {
      if (serial === frameDetectionLoadSerial) {
        const message = err instanceof Error ? err.message : String(err);
        detailError = detailError ? `${detailError} ${message}` : message;
      }
    } finally {
      if (serial === frameDetectionLoadSerial) frameDetectionsLoading = false;
    }
  }

  function closeRoiDetail() {
    frameDetectionLoadSerial += 1;
    closeFrameDetailModal();
    selectedDetection = null;
    selectedParentAsset = null;
    selectedParentFrame = null;
    selectedFrameContext = null;
    frameDetections = [];
    frameDetectionsLoading = false;
    frameDetectionsComplete = false;
    detailError = null;
    detailFrameFailedUrl = '';
    frameImageNaturalWidth = 0;
    frameImageNaturalHeight = 0;
  }

  function openFrameDetailModal() {
    if (!selectedDetection?.frame_id) return;
    frameDetailOpen = true;
    frameModalDisplayMode = 'original';
    frameModalFailedUrl = '';
    lastFrameModalUrl = '';
    frameImageNaturalWidth = 0;
    frameImageNaturalHeight = 0;
  }

  function closeFrameDetailModal() {
    frameDetailOpen = false;
    frameModalFailedUrl = '';
    lastFrameModalUrl = '';
  }

  function withoutDuplicateDetections(page: DetectionSummary[]): DetectionSummary[] {
    const existing = new Set(detections.map((detection) => detection.id).filter(Boolean));
    return page.filter((detection) => !detection.id || !existing.has(detection.id));
  }

  function withoutDuplicateFrameDetections(page: DetectionSummary[]): DetectionSummary[] {
    const existing = new Set(frameDetections.map((detection) => detection.id).filter(Boolean));
    return page.filter((detection) => !detection.id || !existing.has(detection.id));
  }

  function frameDetectionsWithSelected(selected: DetectionSummary, page: DetectionSummary[]): DetectionSummary[] {
    if (!selected.id) return page.length ? page : [selected];
    const rest = page.filter((detection) => detection.id !== selected.id);
    return [selected, ...rest];
  }

  function imageUrl(
    detection: DetectionSummary,
    viewMode = roiViewMode,
    format = imageFormat,
    maskEnabled = applyRoiMask,
    proxyMaxDimension: number | null = null
  ): string {
    const client = getClient();
    if (!client || !detection.id) return '';
    const resizeOptions = roiProxyResizeOptions(detection, proxyMaxDimension);
    const options = { applyMask: maskEnabled, ...resizeOptions };
    if (viewMode !== 'refined') return client.detectionImageUrl(detection.id, format, options);
    if (detection.refined_roi_url && !resizeOptions.width && !resizeOptions.height) return client.resolveApiUrl(detection.refined_roi_url);
    if (detection.refined_detection_id) {
      return client.refinedDetectionRecordImageUrl(detection.refined_detection_id, format, options);
    }
    return client.refinedDetectionImageUrl(detection.id, format, options);
  }

  function roiImageMaskUrl(
    detection: DetectionSummary,
    viewMode = roiViewMode,
    proxyMaxDimension: number | null = null
  ): string {
    const client = getClient();
    if (!client || !detection.id) return '';
    const resizeOptions = roiProxyResizeOptions(detection, proxyMaxDimension);
    if (viewMode !== 'refined') return client.detectionMaskUrl(detection.id, 'png', resizeOptions);
    if (detection.refined_mask_url && !resizeOptions.width && !resizeOptions.height) return client.resolveApiUrl(detection.refined_mask_url);
    if (detection.refined_detection_id) {
      return client.refinedDetectionRecordMaskUrl(detection.refined_detection_id, 'png', resizeOptions);
    }
    return client.refinedDetectionMaskUrl(detection.id, 'png', resizeOptions);
  }

  function roiCanvasKey(
    detection: DetectionSummary,
    viewMode = roiViewMode,
    format = imageFormat,
    maskEnabled = applyRoiMask,
    inverted = invertImages,
    proxyMaxDimension: number | null = null
  ): string {
    return [
      detection.id ?? 'roi',
      viewMode,
      format,
      maskEnabled ? 'masked' : 'plain',
      inverted ? 'inverted' : 'normal',
      proxyMaxDimension ? `proxy-${proxyMaxDimension}` : 'full'
    ].join(':');
  }

  function roiImageAlt(detection: DetectionSummary, viewMode = roiViewMode): string {
    const prefix = viewMode === 'refined' ? 'Refined ROI' : 'Candidate ROI';
    return `${prefix} ${detection.roi_index ?? ''}`;
  }

  function roiImageVersionLabel(): string {
    return roiViewMode === 'refined' ? 'Refined ROI' : 'Candidate ROI';
  }

  function roiImageSourceWidth(detection: DetectionSummary): number | null {
    return roiSourceWidth(detection);
  }

  function roiImageSourceHeight(detection: DetectionSummary): number | null {
    return roiSourceHeight(detection);
  }

  function roiRenderSpec(
    detection: DetectionSummary,
    maxWidth = roiDisplayMaxWidth,
    maxHeight = roiDisplayMaxHeight,
    exportControls: 'full' | 'menu' | 'copy-menu' | 'none' = 'none',
    viewMode = roiViewMode,
    format = imageFormat,
    maskEnabled = applyRoiMask,
    inverted = invertImages,
    proxyMaxDimension: number | null = null
  ): ImageRenderSpec {
    const sourceWidth = roiImageSourceWidth(detection);
    const sourceHeight = roiImageSourceHeight(detection);
    return {
      key: roiCanvasKey(detection, viewMode, format, maskEnabled, inverted, proxyMaxDimension),
      image: {
        url: imageUrl(detection, viewMode, format, maskEnabled, proxyMaxDimension),
        alt: roiImageAlt(detection, viewMode),
        invert: inverted,
        sourceWidth,
        sourceHeight
      },
      baseMask: {
        url: roiImageMaskUrl(detection, viewMode, proxyMaxDimension),
        enabled: maskEnabled,
        outsideColor: 'black',
        applyBeforeInvert: true
      },
      layers: [],
      scaleBar: {
        enabled: true,
        placement: exportControls === 'none' ? 'below' : 'inside',
        lengths: scaleBarLengths,
        maxPercent: exportControls === 'none' ? 55 : 48
      },
      toolbar: {
        exportControls,
        filename: roiFilenameForDetection(detection, 'roi', viewMode),
        annotatedFilename: roiFilenameForDetection(detection, 'boxed', viewMode),
        originalUrl: imageUrl(detection, viewMode, format, false),
        originalFilename: roiFilenameForDetection(detection, 'original', viewMode),
        maskUrl: roiImageMaskUrl(detection, viewMode),
        maskFilename: roiFilenameForDetection(detection, 'mask', viewMode),
        maskedFilename: roiFilenameForDetection(detection, 'masked', viewMode),
        info: roiInfo(detection)
      },
      display: {
        maxWidth,
        maxHeight,
        background: '#111916'
      }
    };
  }

  function bboxLabel(detection: DetectionSummary): string {
    const values = [
      bboxValue(detection, 'bbox', 'x'),
      bboxValue(detection, 'bbox', 'y'),
      bboxValue(detection, 'bbox', 'w'),
      bboxValue(detection, 'bbox', 'h')
    ];
    if (values.some((value) => value === null)) return 'bbox unavailable';
    return `x=${values[0]}, y=${values[1]}, w=${values[2]}, h=${values[3]}`;
  }

  function roiSourceWidth(detection: DetectionSummary): number | null {
    return bboxValue(detection, 'crop_bbox', 'w');
  }

  function roiSourceHeight(detection: DetectionSummary): number | null {
    return bboxValue(detection, 'crop_bbox', 'h');
  }

  function roiTileProxyMaxDimension(detection: DetectionSummary): number | null {
    const width = roiImageSourceWidth(detection);
    const height = roiImageSourceHeight(detection);
    if (!width || !height) return null;
    return width > roiProxyThresholdPx || height > roiProxyThresholdPx ? roiProxyMaxDimensionPx : null;
  }

  function roiTileKey(detection: DetectionSummary): string {
    return [
      detection.id ?? 'roi',
      roiViewMode,
      imageFormat,
      applyRoiMask ? 'masked' : 'plain',
      invertImages ? 'inverted' : 'normal'
    ].join(':');
  }

  function roiTileProxyForRender(detection: DetectionSummary): number | null {
    return fullResolutionTileKeys.has(roiTileKey(detection)) ? null : roiTileProxyMaxDimension(detection);
  }

  function promoteRoiTileToFullResolution(detection: DetectionSummary, proxyMaxDimension: number | null) {
    if (!proxyMaxDimension) return;
    const key = roiTileKey(detection);
    if (fullResolutionTileKeys.has(key)) return;
    fullResolutionTileKeys = new Set([...fullResolutionTileKeys, key]);
  }

  function roiProxyResizeOptions(
    detection: DetectionSummary,
    proxyMaxDimension: number | null
  ): { width?: number; height?: number } {
    if (!proxyMaxDimension) return {};
    const width = roiImageSourceWidth(detection);
    const height = roiImageSourceHeight(detection);
    if (!width || !height) return {};
    return width >= height ? { width: proxyMaxDimension } : { height: proxyMaxDimension };
  }

  function roiFilename(version = 'roi'): string {
    const assetName =
      selectedParentAsset?.filename?.replace(/\.[^.]+$/, '') ??
      selectedDetection?.asset_filename?.replace(/\.[^.]+$/, '') ??
      selectedDetection?.asset_id ??
      'asset';
    const frame = selectedDetection?.frame_index ?? selectedDetection?.frame_id ?? 'frame';
    const roi = selectedDetection?.roi_index ?? selectedDetection?.id ?? 'roi';
    return `${assetName}_frame_${frame}_roi_${roi}_${roiViewMode}_${version}.png`;
  }

  function roiFilenameForDetection(
    detection: DetectionSummary,
    version = 'roi',
    viewMode = roiViewMode
  ): string {
    const assetName =
      detection.asset_filename?.replace(/\.[^.]+$/, '') ??
      detection.asset_id ??
      selectedParentAsset?.filename?.replace(/\.[^.]+$/, '') ??
      'asset';
    const frame = detection.frame_index ?? detection.frame_id ?? 'frame';
    const roi = detection.roi_index ?? detection.id ?? 'roi';
    return `${assetName}_frame_${frame}_roi_${roi}_${viewMode}_${version}.png`;
  }

  function roiInfo(detection: DetectionSummary): ImageInfoSpec {
    const isSelected = selectedDetection?.id && detection.id === selectedDetection.id;
    const metadata = detection.metadata ?? {};
    const frameMetadata = isSelected ? selectedParentFrame?.metadata ?? {} : {};
    const assetMetadata = isSelected ? selectedParentAsset?.metadata ?? {} : {};
    return {
      assetFilename:
        (isSelected ? selectedParentAsset?.filename : null) ??
        detection.asset_filename ??
        detection.asset_id ??
        null,
      frameNumber:
        (isSelected ? selectedParentFrame?.frame_num ?? selectedParentFrame?.frame_index : null) ??
        detection.frame_index ??
        detection.frame_id ??
        null,
      timestamp: valueLabel(
        frameMetadata.capture_datetime ??
          frameMetadata.captured_at ??
          frameMetadata.timestamp ??
          assetMetadata.capture_datetime ??
          metadata.capture_datetime ??
          metadata.captured_at ??
          metadata.timestamp
      ),
      collections: collectionsForDetection(detection, isSelected ? selectedParentAsset : null)
    };
  }

  function collectionsForDetection(detection: DetectionSummary, asset: RawAsset | null): string[] | string | null {
    const direct = (detection as DetectionSummary & { collections?: unknown }).collections;
    if (Array.isArray(direct) || typeof direct === 'string') return direct;
    if (asset?.collections) return asset.collections;
    const metadataCollections = detection.metadata?.collections;
    if (Array.isArray(metadataCollections) || typeof metadataCollections === 'string') return metadataCollections;
    return null;
  }

  function numberValue(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function bboxValue(
    detection: DetectionSummary,
    kind: 'bbox' | 'crop_bbox',
    field: 'x' | 'y' | 'w' | 'h'
  ): number | null {
    const nested = detection[kind];
    if (nested && !Array.isArray(nested)) {
      const value =
        field === 'w'
          ? nested.w ?? nested.width
          : field === 'h'
            ? nested.h ?? nested.height
            : nested[field];
      const parsed = numberValue(value);
      if (parsed !== null) return parsed;
    }
    if (Array.isArray(nested)) {
      const index = field === 'x' ? 0 : field === 'y' ? 1 : field === 'w' ? 2 : 3;
      const parsed = numberValue(nested[index]);
      if (parsed !== null) return parsed;
    }
    const prefix = kind === 'bbox' ? 'bbox' : 'crop_bbox';
    return numberValue(detection[`${prefix}_${field}` as keyof DetectionSummary]);
  }

  function frameContextUrl(detection: DetectionSummary, mode: FrameDisplayMode): string {
    const client = getClient();
    if (!client || !detection.frame_id) return '';
    const kind = payloadKindForDisplay(mode);
    const contextUrl = selectedFrameContext?.image_urls?.[kind];
    if (contextUrl) return contextUrl;
    if (selectedFrameContext && kind === 'preprocessed') return '';
    const base = {
      frame_id: detection.frame_id,
      format: 'jpg',
      width: frameContextImageWidth
    };
    return kind === 'preprocessed' ? client.preprocessedFrameUrl(base) : client.originalFrameUrl(base);
  }

  function frameModalContextUrl(detection: DetectionSummary, mode: FrameDisplayMode): string {
    const client = getClient();
    if (!client || !detection.frame_id) return '';
    const kind = payloadKindForDisplay(mode);
    const base = {
      frame_id: detection.frame_id,
      format: 'jpg',
      width: frameModalImageWidth
    };
    return kind === 'preprocessed' ? client.preprocessedFrameUrl(base) : client.originalFrameUrl(base);
  }

  function frameModalFullResolutionUrl(detection: DetectionSummary | null, mode: FrameDisplayMode): string {
    const client = getClient();
    if (!client || !detection?.frame_id) return frameModalUrl;
    const kind = payloadKindForDisplay(mode);
    const base = {
      frame_id: detection.frame_id,
      format: 'png'
    };
    return kind === 'preprocessed' ? client.preprocessedFrameUrl(base) : client.originalFrameUrl(base);
  }

  function resetFrameContextImage(url: string) {
    if (url === lastDetailFrameUrl) return;
    lastDetailFrameUrl = url;
    frameImageNaturalWidth = 0;
    frameImageNaturalHeight = 0;
    detailFrameFailedUrl = '';
  }

  function resetFrameModalImage(url: string) {
    if (url === lastFrameModalUrl) return;
    lastFrameModalUrl = url;
    frameImageNaturalWidth = 0;
    frameImageNaturalHeight = 0;
    frameModalFailedUrl = '';
  }

  function setFrameImageNaturalSize(dimensions: { width: number; height: number }) {
    detailFrameFailedUrl = '';
    frameImageNaturalWidth = dimensions.width;
    frameImageNaturalHeight = dimensions.height;
  }

  function markDetailFrameUnavailable() {
    const failedUrl = detailFrameUrl;
    if (detailFramePayloadKind === 'preprocessed') {
      detailFrameFailedUrl = failedUrl;
      detailFrameDisplayMode = 'original';
      return;
    }
    detailFrameFailedUrl = detailFrameUrl;
    frameImageNaturalWidth = 0;
    frameImageNaturalHeight = 0;
  }

  function markFrameModalUnavailable() {
    frameModalFailedUrl = frameModalUrl;
    frameImageNaturalWidth = 0;
    frameImageNaturalHeight = 0;
  }

  function isSelectedDetection(detection: DetectionSummary): boolean {
    return Boolean(selectedDetection?.id && detection.id === selectedDetection.id);
  }

  function parentFrameDimensions(): { width: number; height: number } | null {
    return parentFrameDimensionsForPayload(detailFramePayloadKind, frameImageNaturalWidth, frameImageNaturalHeight);
  }

  function parentFrameDimensionsForPayload(
    payloadKind: string,
    displayWidth: number,
    displayHeight: number
  ): { width: number; height: number } | null {
    if (payloadKind === 'preprocessed') {
      const preprocessedDimensions = dimensionsFromShape(
        selectedParentFrame?.preprocessed_payload_shape ??
          selectedParentFrame?.preprocessed_metadata?.shape ??
          selectedParentFrame?.metadata?.preprocessed_payload_shape
      );
      if (preprocessedDimensions) return preprocessedDimensions;
    }
    const width = numberValue(selectedParentFrame?.width);
    const height = numberValue(selectedParentFrame?.height);
    if (width && height) return { width, height };
    const shapeDimensions = dimensionsFromShape(
      selectedParentFrame?.payload_shape ??
        selectedParentFrame?.shape ??
        (Array.isArray(selectedParentFrame?.metadata?.shape) ? selectedParentFrame.metadata.shape : null)
    );
    if (shapeDimensions) return shapeDimensions;
    if (displayWidth && displayHeight) {
      return {
        width: displayWidth,
        height: displayHeight
      };
    }
    return null;
  }

  function dimensionsFromShape(shape: unknown): { width: number; height: number } | null {
    if (Array.isArray(shape) && shape.length >= 2) {
      const shapeHeight = numberValue(shape[0]);
      const shapeWidth = numberValue(shape[1]);
      if (shapeWidth && shapeHeight) return { width: shapeWidth, height: shapeHeight };
    }
    return null;
  }

  function frameNumberLabel(): string {
    return String(
      selectedParentFrame?.frame_num ??
        selectedParentFrame?.frame_index ??
        selectedDetection?.frame_index ??
        selectedDetection?.frame_id ??
        'unknown'
    );
  }

  function frameDimensionsLabel(): string {
    const dimensions = parentFrameDimensions();
    return dimensions ? `${Math.round(dimensions.width)} x ${Math.round(dimensions.height)} px` : 'unknown';
  }

  function preprocessedAvailabilityLabel(): string {
    if (!selectedParentFrame) return 'unknown';
    return selectedParentFrame.has_preprocessed_payload ? 'available' : 'not available';
  }

  function formatDateTime(value: unknown): string {
    if (typeof value !== 'string' || !value) return 'unknown';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  function metadataValue(...keys: string[]): unknown {
    const metadata = selectedParentFrame?.metadata ?? selectedParentAsset?.metadata ?? selectedDetection?.metadata ?? {};
    return keys.map((key) => metadata[key]).find((value) => value !== undefined && value !== null && value !== '');
  }

  function valueLabel(value: unknown): string {
    if (value === undefined || value === null || value === '') return 'unknown';
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  function metadataBlock(value: unknown): string {
    if (!value || typeof value !== 'object') return '{}';
    return JSON.stringify(value, null, 2);
  }

  function frameContextCanvasOverlays(
    detectionsForFrame: DetectionSummary[],
    selected: DetectionSummary | null,
    payloadKind: string,
    _frame: FrameSummary | null,
    _displayWidth: number,
    _displayHeight: number,
    sourceDimensions: { width: number; height: number } | null
  ): ImageOverlayRect[] {
    if (!sourceDimensions) return [];
    const others: ImageOverlayRect[] = [];
    const selectedOverlays: ImageOverlayRect[] = [];
    for (const detection of detectionsForFrame) {
      const rect = frameContextOverlayRect(detection, sourceDimensions, payloadKind);
      if (!rect) continue;
      if (selected?.id && detection.id === selected.id) {
        selectedOverlays.push({
          ...rect,
          stroke: '#e2322e',
          lineWidth: 3,
          halo: 'rgba(255, 255, 255, 0.8)',
          selected: true
        });
      } else {
        others.push({
          ...rect,
          stroke: '#f5e642',
          lineWidth: 2,
          halo: 'rgba(17, 25, 22, 0.7)'
        });
      }
    }
    return [...others, ...selectedOverlays];
  }

  function frameContextOverlayRect(
    detection: DetectionSummary,
    sourceDimensions: { width: number; height: number } | null,
    payloadKind: string
  ): Omit<ImageOverlayRect, 'stroke'> | null {
    const bboxX = bboxValue(detection, 'bbox', 'x');
    const bboxY = bboxValue(detection, 'bbox', 'y');
    const bboxW = bboxValue(detection, 'bbox', 'w');
    const bboxH = bboxValue(detection, 'bbox', 'h');
    if (bboxX === null || bboxY === null || bboxW === null || bboxH === null) return null;
    if (!sourceDimensions) return null;
    const origin = frameContextOrigin(payloadKind);
    return {
      x: bboxX - origin.x,
      y: bboxY - origin.y,
      w: bboxW,
      h: bboxH,
      coordinateSpace: 'source'
    };
  }

  function fallbackSourceDimensions(displayWidth: number, displayHeight: number): { width: number; height: number } | null {
    if (!displayWidth || !displayHeight) return null;
    return {
      width: displayWidth / fullFrameBboxScale,
      height: displayHeight / fullFrameBboxScale
    };
  }

  function frameContextOrigin(payloadKind: string = detailFramePayloadKind): { x: number; y: number } {
    if (payloadKind === 'preprocessed') {
      const cropTuple =
        tupleFromBBoxLike(selectedParentFrame?.preprocessed_metadata?.crop_bbox) ??
        tupleFromBBoxLike(selectedParentFrame?.metadata?.crop_bbox);
      if (cropTuple) return { x: cropTuple[0], y: cropTuple[1] };
    }
    return {
      x: numberValue(selectedParentFrame?.bbox_x) ?? 0,
      y: numberValue(selectedParentFrame?.bbox_y) ?? 0
    };
  }

  function tupleFromBBoxLike(value: unknown): [number, number, number, number] | null {
    if (Array.isArray(value) && value.length >= 4) {
      return tupleFromValues(value[0], value[1], value[2], value[3]);
    }
    if (!value || typeof value !== 'object') return null;
    const box = value as {
      x?: number | string;
      y?: number | string;
      w?: number | string;
      h?: number | string;
      width?: number | string;
      height?: number | string;
    };
    return tupleFromValues(box.x, box.y, box.w ?? box.width, box.h ?? box.height);
  }

  function tupleFromValues(
    x: unknown,
    y: unknown,
    w: unknown,
    h: unknown
  ): [number, number, number, number] | null {
    const values = [x, y, w, h].map(numberValue);
    return values.every((value) => value !== null) ? (values as [number, number, number, number]) : null;
  }

  function frameContextFilename(annotated = false): string {
    const assetName =
      selectedParentAsset?.filename?.replace(/\.[^.]+$/, '') ??
      selectedDetection?.asset_filename?.replace(/\.[^.]+$/, '') ??
      selectedDetection?.asset_id ??
      'asset';
    const suffix = annotated ? 'boxed' : detailFramePayloadKind;
    return `${assetName}_frame_${frameNumberLabel()}_${suffix}.png`;
  }

  function frameModalFilename(annotated = false): string {
    const assetName =
      selectedParentAsset?.filename?.replace(/\.[^.]+$/, '') ??
      selectedDetection?.asset_filename?.replace(/\.[^.]+$/, '') ??
      selectedDetection?.asset_id ??
      'asset';
    const suffix = annotated ? `${frameModalPayloadKind}_boxed` : frameModalPayloadKind;
    return `${assetName}_frame_${frameNumberLabel()}_${suffix}.png`;
  }

  function frameContextRenderSpec(): ImageRenderSpec {
    return {
      image: {
        url: detailFrameUrl,
        alt: 'Frame with ROI bounding boxes',
        invert: detailFrameImageInverted,
        sourceWidth: detailFrameSourceDimensions?.width ?? null,
        sourceHeight: detailFrameSourceDimensions?.height ?? null
      },
      layers: rectLayersForFrameContext(detailFrameCanvasOverlays),
      scaleBar: {
        enabled: true,
        placement: 'inside'
      },
      toolbar: {
        exportControls: 'menu',
        filename: frameContextFilename(),
        annotatedFilename: frameContextFilename(true),
        originalUrl: detailFrameUrl,
        originalFilename: frameContextFilename(),
        info: {
          assetFilename: selectedParentAsset?.filename ?? selectedDetection?.asset_filename ?? selectedDetection?.asset_id ?? null,
          frameNumber: frameNumberLabel(),
          timestamp: valueLabel(metadataValue('capture_datetime', 'captured_at', 'timestamp')),
          collections: selectedParentAsset?.collections ?? null
        }
      },
      display: {
        maxWidth: frameContextImageWidth,
        maxHeight: 360,
        background: '#050807'
      }
    };
  }

  function frameModalRenderSpec(): ImageRenderSpec {
    return {
      image: {
        url: frameModalUrl,
        alt: 'High resolution frame with ROI bounding boxes',
        invert: frameModalImageInverted,
        sourceWidth: frameModalSourceDimensions?.width ?? null,
        sourceHeight: frameModalSourceDimensions?.height ?? null
      },
      layers: rectLayersForFrameContext(frameModalCanvasOverlays),
      scaleBar: {
        enabled: true,
        placement: 'inside'
      },
      toolbar: {
        exportControls: 'menu',
        filename: frameModalFilename(),
        annotatedFilename: frameModalFilename(true),
        originalUrl: frameModalFullResolutionUrl(selectedDetection, frameModalDisplayMode),
        originalFilename: frameModalFilename(),
        info: {
          assetFilename: selectedParentAsset?.filename ?? selectedDetection?.asset_filename ?? selectedDetection?.asset_id ?? null,
          frameNumber: frameNumberLabel(),
          timestamp: valueLabel(metadataValue('capture_datetime', 'captured_at', 'timestamp')),
          collections: selectedParentAsset?.collections ?? null
        }
      },
      display: {
        maxWidth: frameModalImageWidth,
        maxHeight: frameModalImageMaxHeight,
        background: '#050807'
      }
    };
  }

  function rectLayersForFrameContext(rects: ImageOverlayRect[]): ImageLayer[] {
    return rects.map((rect) => ({
      kind: 'rect',
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
      tooltip: rect.selected ? 'Selected ROI' : 'Other ROI'
    }));
  }
</script>

<div class="roi-browser-layout">
  <aside class="panel roi-filter-panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">ROI Browser</p>
        <h2>Filters</h2>
      </div>
    </div>

    <div class="filter-group">
      <div class="section-heading">
        <p class="eyebrow">View</p>
        <strong>ROI image source</strong>
      </div>
      <div class="toggle-list">
        <button
          class:active={roiViewMode === 'candidate'}
          type="button"
          on:click={() => setRoiViewMode('candidate')}
        >
          Candidate ROIs
        </button>
        <button
          class:active={roiViewMode === 'refined'}
          type="button"
          on:click={() => setRoiViewMode('refined')}
        >
          Refined ROIs
        </button>
      </div>
      {#if roiViewMode === 'refined'}
        <p class="soft">Only detections with stored refined ROI payloads are shown.</p>
      {/if}
      <div class="view-option-stack">
        <label class="switch-row">
          <span>Apply ROI mask</span>
          <input type="checkbox" bind:checked={applyRoiMask} />
          <span class="switch-track" aria-hidden="true"></span>
        </label>
      </div>
    </div>

    <label>
      Asset
      <select bind:value={selectedAssetId}>
        <option value="">All assets</option>
        {#each assets as asset}
          <option value={asset.id}>{asset.filename ?? asset.id}</option>
        {/each}
      </select>
    </label>

    <label>
      Collection
      <input bind:value={collection} placeholder="collection name" />
    </label>

    <div class="form-grid compact-grid">
      <label>
        Start frame
        <input type="number" min="1" bind:value={startFrame} />
      </label>
      <label>
        End frame
        <input type="number" min="1" bind:value={endFrame} />
      </label>
    </div>

    <div class="form-grid compact-grid">
      <label>
        Min area
        <input type="number" min="0" bind:value={minArea} />
      </label>
      <label>
        Max area
        <input type="number" min="0" bind:value={maxArea} />
      </label>
    </div>

    <div class="form-grid compact-grid">
      <label>
        Min perimeter
        <input type="number" min="0" bind:value={minPerimeter} />
      </label>
      <label>
        Max perimeter
        <input type="number" min="0" bind:value={maxPerimeter} />
      </label>
    </div>

    <div class="form-grid compact-grid">
      <label>
        Min width
        <input type="number" min="0" bind:value={minBBoxW} />
      </label>
      <label>
        Max width
        <input type="number" min="0" bind:value={maxBBoxW} />
      </label>
    </div>

    <div class="form-grid compact-grid">
      <label>
        Min height
        <input type="number" min="0" bind:value={minBBoxH} />
      </label>
      <label>
        Max height
        <input type="number" min="0" bind:value={maxBBoxH} />
      </label>
    </div>

    <div class="form-grid compact-grid">
      <label>
        ROI encoding
        <select bind:value={roiEncoding}>
          <option value="">Any</option>
          <option value="png">png</option>
          <option value="zstd">zstd</option>
          <option value="raw">raw</option>
          <option value="jpg">jpg</option>
        </select>
      </label>
      <label>
        Image format
        <select bind:value={imageFormat}>
          <option value="png">png</option>
          <option value="jpg">jpg</option>
        </select>
      </label>
    </div>

    <div class="form-grid compact-grid">
      <label>
        Sort by
        <select bind:value={sortBy}>
          <option value="asset_frame">Asset + frame</option>
          <option value="area">Area</option>
          <option value="byte_size">Byte size</option>
          <option value="id">Random ID</option>
        </select>
      </label>
      <label>
        Direction
        <select bind:value={sortDir}>
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </select>
      </label>
    </div>

    <div class="button-row">
      <button type="button" on:click={() => loadDetections(true)}>Apply</button>
      <button class="ghost" type="button" on:click={resetFilters}>Reset</button>
    </div>
  </aside>

  <section class="panel roi-results-panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Detections</p>
        <h2>ROI Tiles</h2>
      </div>
      <span class="soft">{visibleCount} image{visibleCount === 1 ? '' : 's'} loaded</span>
    </div>

    {#if error}<p class="form-error">{error}</p>{/if}

    <div class="roi-tile-scroll" bind:this={tileScroller} on:scroll={maybeLoadMore}>
      {#if detections.length}
        <div class="roi-tile-grid">
          {#each detections as detection}
            {#if detection.id && detection.roi_payload_bytes}
              {@const proxyMaxDimension = roiTileProxyForRender(detection)}
              <div class="roi-tile">
                <div class="roi-image-frame">
                  {#key roiCanvasKey(detection, roiViewMode, imageFormat, applyRoiMask, invertImages, proxyMaxDimension)}
                    <KonvaImageCanvas
                      spec={roiRenderSpec(detection, roiDisplayMaxWidth, roiDisplayMaxHeight, 'menu', roiViewMode, imageFormat, applyRoiMask, invertImages, proxyMaxDimension)}
                      mode="thumbnail"
                      onImageLoad={() => promoteRoiTileToFullResolution(detection, proxyMaxDimension)}
                      onMoreAction={() => openRoiDetail(detection)}
                    />
                  {/key}
                </div>
                <div class="roi-tile-meta">
                  <strong>{detection.asset_filename ?? detection.asset_id ?? 'Unknown asset'}</strong>
                  <span>Frame {detection.frame_index ?? detection.frame_id ?? 'unknown'} / ROI {detection.roi_index ?? 'unknown'}</span>
                  <code>{bboxLabel(detection)}</code>
                  <small>
                    {#if detection.area !== undefined}area={Math.round(detection.area)}{/if}
                    {#if detection.area !== undefined && detection.perimeter !== undefined} · {/if}
                    {#if detection.perimeter !== undefined}perimeter={Math.round(detection.perimeter)}{/if}
                    {#if detection.roi_payload_bytes !== undefined}
                      {detection.area !== undefined || detection.perimeter !== undefined ? ' · ' : ''}
                      {formatBytes(detection.roi_payload_bytes)}
                    {/if}
                  </small>
                </div>
              </div>
            {/if}
          {/each}
        </div>
        {#if loading}<p class="soft loading-row">Loading more ROIs</p>{/if}
        {#if !loading && !hasMore}<p class="soft loading-row">All matching ROIs loaded.</p>{/if}
        <div class="load-sentinel" bind:this={loadMoreSentinel} aria-hidden="true"></div>
      {:else if loading}
        <p class="empty">Loading ROI detections.</p>
      {:else}
        <p class="empty">No ROI detections match the current filters.</p>
      {/if}
    </div>
  </section>

  <button class="scroll-top-button" type="button" aria-label="Scroll to top" on:click={scrollToTop}></button>
</div>

{#if selectedDetection}
  <div class="modal-backdrop">
    <div class="roi-detail-modal" role="dialog" aria-modal="true" aria-label="ROI details">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">ROI detail</p>
          <h2>{selectedDetection.asset_filename ?? selectedDetection.asset_id ?? 'Unknown asset'}</h2>
        </div>
        <button class="ghost" type="button" on:click={closeRoiDetail}>Close</button>
      </div>

      {#if detailError}<p class="form-error">{detailError}</p>{/if}

      <div class="roi-detail-grid">
        <div class="roi-detail-image-panel">
          {#key roiCanvasKey(selectedDetection, roiViewMode, imageFormat, applyRoiMask, invertImages)}
            <KonvaImageCanvas
              spec={roiRenderSpec(selectedDetection, modalRoiDisplayMaxWidth, modalRoiDisplayMaxHeight, 'menu', roiViewMode, imageFormat, applyRoiMask, invertImages)}
              mode="static"
            />
          {/key}
        </div>

        <div class="roi-detail-info">
          <h3>Detection</h3>
          <dl>
            <div>
              <dt>Viewing</dt>
              <dd>{roiImageVersionLabel()}</dd>
            </div>
            <div>
              <dt>Detection ID</dt>
              <dd>{selectedDetection.id}</dd>
            </div>
            <div>
              <dt>Frame</dt>
              <dd>{selectedDetection.frame_index ?? selectedDetection.frame_id ?? 'unknown'}</dd>
            </div>
            <div>
              <dt>Bounding box</dt>
              <dd><code>{bboxLabel(selectedDetection)}</code></dd>
            </div>
            <div>
              <dt>Area</dt>
              <dd>{selectedDetection.area === undefined ? 'unknown' : Math.round(selectedDetection.area)}</dd>
            </div>
            <div>
              <dt>Perimeter</dt>
              <dd>{selectedDetection.perimeter === undefined ? 'unknown' : Math.round(selectedDetection.perimeter)}</dd>
            </div>
            <div>
              <dt>Payload</dt>
              <dd>{selectedDetection.roi_payload_bytes === undefined ? 'unknown' : formatBytes(selectedDetection.roi_payload_bytes)}</dd>
            </div>
            <div>
              <dt>Encoding</dt>
              <dd>{selectedDetection.roi_encoding ?? selectedDetection.roi_format ?? 'unknown'}</dd>
            </div>
          </dl>

          <h3>Parent Frame</h3>
          <dl>
            <div>
              <dt>Asset file</dt>
              <dd>{selectedParentAsset?.filename ?? selectedDetection.asset_filename ?? 'unknown'}</dd>
            </div>
            <div>
              <dt>Asset ID</dt>
              <dd>
                {#if selectedDetection.asset_id}
                  <a
                    class="detail-uuid-link"
                    href={roiBrowserHref({ asset_id: selectedDetection.asset_id }, $page.url)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {selectedDetection.asset_id}
                  </a>
                {:else}
                  unknown
                {/if}
              </dd>
            </div>
            <div>
              <dt>Frame ID</dt>
              <dd>
                {#if selectedDetection.frame_id}
                  <button class="detail-uuid-link detail-link-button" type="button" on:click={openFrameDetailModal}>
                    {selectedDetection.frame_id}
                  </button>
                {:else}
                  unknown
                {/if}
              </dd>
            </div>
            <div>
              <dt>Frame number</dt>
              <dd>{frameNumberLabel()}</dd>
            </div>
            <div>
              <dt>Captured</dt>
              <dd>{formatDateTime(selectedParentFrame?.captured_at ?? metadataValue('captured_at', 'capture_datetime', 'capture_time', 'datetime', 'timestamp'))}</dd>
            </div>
            <div>
              <dt>Stored</dt>
              <dd>{formatDateTime(selectedParentFrame?.created_at)}</dd>
            </div>
            <div>
              <dt>Dimensions</dt>
              <dd>{frameDimensionsLabel()}</dd>
            </div>
            <div>
              <dt>Dtype</dt>
              <dd>{selectedParentFrame?.dtype ?? 'unknown'}</dd>
            </div>
            <div>
              <dt>Preprocessed</dt>
              <dd>{preprocessedAvailabilityLabel()}</dd>
            </div>
            <div>
              <dt>Collections</dt>
              <dd>{valueLabel(selectedParentAsset?.collections)}</dd>
            </div>
          </dl>
        </div>
      </div>

      <details class="roi-frame-detail">
        <summary>Frame context</summary>
        {#if selectedDetection.frame_id}
          <div class="roi-frame-controls">
            <FrameDisplayToggle bind:value={detailFrameDisplayMode} />
          </div>
          <div class="roi-frame-stage">
            {#if detailFrameUnavailable}
              <div class="preview-placeholder frame-unavailable">
                {#if detailFramePayloadKind === 'preprocessed'}
                  <strong>No preprocessed image is available for this frame.</strong>
                  <span>Switch to Original or run preprocessing for this frame.</span>
                {:else}
                  <strong>The selected frame image could not be loaded.</strong>
                  <span>Check that the frame data endpoint is available.</span>
                {/if}
              </div>
            {:else}
              {#key detailFrameUrl}
                <KonvaImageCanvas
                  spec={frameContextRenderSpec()}
                  mode="viewer"
                  onImageLoad={setFrameImageNaturalSize}
                  onImageError={markDetailFrameUnavailable}
                />
              {/key}
              {/if}
          </div>
          <p class="soft">
            {frameDetections.length} ROI{frameDetections.length === 1 ? '' : 's'} loaded for this frame{frameDetectionsLoading ? '; loading more.' : frameDetectionsComplete ? '.' : ''}
          </p>
        {:else}
          <p class="empty">This ROI does not include a frame id.</p>
        {/if}
      </details>
    </div>
  </div>
{/if}

{#if frameDetailOpen && selectedDetection}
  <div class="modal-backdrop frame-context-backdrop">
    <div class="roi-detail-modal frame-context-modal" role="dialog" aria-modal="true" aria-label="Frame details">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Frame detail</p>
          <h2>Frame {frameNumberLabel()}</h2>
        </div>
        <button class="ghost" type="button" on:click={closeFrameDetailModal}>Close</button>
      </div>

      {#if detailError}<p class="form-error">{detailError}</p>{/if}

      <div class="frame-context-layout">
        <section class="frame-context-viewer">
          <div class="roi-frame-controls">
            <FrameDisplayToggle bind:value={frameModalDisplayMode} />
            <span class="soft">Use the download menu for the original frame or frame + bounding boxes.</span>
          </div>
          <div class="frame-context-stage">
            {#if frameModalUnavailable || !frameModalUrl}
              <div class="preview-placeholder frame-unavailable">
                {#if frameModalPayloadKind === 'preprocessed'}
                  <strong>No preprocessed image is available for this frame.</strong>
                  <span>Switch to Original or run preprocessing for this frame.</span>
                {:else}
                  <strong>The selected frame image could not be loaded.</strong>
                  <span>Check that the frame data endpoint is available.</span>
                {/if}
              </div>
            {:else}
              {#key `${frameModalUrl}:${frameDetections.length}:${frameModalDisplayMode}`}
                <KonvaImageCanvas
                  spec={frameModalRenderSpec()}
                  mode="viewer"
                  onImageLoad={setFrameImageNaturalSize}
                  onImageError={markFrameModalUnavailable}
                />
              {/key}
            {/if}
          </div>
        </section>

        <aside class="frame-context-details">
          <h3>Frame</h3>
          <dl>
            <div>
              <dt>Frame ID</dt>
              <dd>{selectedDetection.frame_id ?? 'unknown'}</dd>
            </div>
            <div>
              <dt>Frame number</dt>
              <dd>{frameNumberLabel()}</dd>
            </div>
            <div>
              <dt>Asset file</dt>
              <dd>{selectedParentAsset?.filename ?? selectedDetection.asset_filename ?? 'unknown'}</dd>
            </div>
            <div>
              <dt>Asset ID</dt>
              <dd>{selectedDetection.asset_id ?? 'unknown'}</dd>
            </div>
            <div>
              <dt>Captured</dt>
              <dd>{formatDateTime(selectedParentFrame?.captured_at ?? metadataValue('captured_at', 'capture_datetime', 'capture_time', 'datetime', 'timestamp'))}</dd>
            </div>
            <div>
              <dt>Stored</dt>
              <dd>{formatDateTime(selectedParentFrame?.created_at)}</dd>
            </div>
            <div>
              <dt>Dimensions</dt>
              <dd>{frameDimensionsLabel()}</dd>
            </div>
            <div>
              <dt>Dtype</dt>
              <dd>{selectedParentFrame?.dtype ?? 'unknown'}</dd>
            </div>
            <div>
              <dt>Preprocessed</dt>
              <dd>{preprocessedAvailabilityLabel()}</dd>
            </div>
            <div>
              <dt>ROIs</dt>
              <dd>{frameDetections.length}{frameDetectionsLoading ? ' loading...' : frameDetectionsComplete ? ' loaded' : ' loaded so far'}</dd>
            </div>
          </dl>
          <details class="frame-context-metadata">
            <summary>Frame metadata</summary>
            <pre>{metadataBlock(selectedParentFrame?.metadata)}</pre>
          </details>
          <details class="frame-context-metadata">
            <summary>Preprocessed metadata</summary>
            <pre>{metadataBlock(selectedParentFrame?.preprocessed_metadata)}</pre>
          </details>
        </aside>
      </div>

      <section class="frame-roi-section">
        <div class="section-heading">
          <p class="eyebrow">ROIs from frame</p>
          <strong>{frameDetections.length} ROI{frameDetections.length === 1 ? '' : 's'}</strong>
        </div>
        {#if frameDetections.length}
          <div class="frame-roi-thumbnail-grid">
            {#each frameDetections as detection}
              {#if detection.id && detection.roi_payload_bytes}
                <button
                  class:selected={isSelectedDetection(detection)}
                  class="frame-roi-thumbnail"
                  type="button"
                  on:click={() => (selectedDetection = detection)}
                >
                  <div class="frame-roi-thumbnail-image">
                    <KonvaImageCanvas
                      spec={roiRenderSpec(detection, 132, 112, 'none', roiViewMode, imageFormat, applyRoiMask, invertImages, roiProxyMaxDimensionPx)}
                      mode="thumbnail"
                    />
                  </div>
                  <span>ROI {detection.roi_index ?? detection.id}</span>
                </button>
              {/if}
            {/each}
          </div>
          {#if frameDetectionsLoading}<p class="soft loading-row">Loading more ROIs from this frame.</p>{/if}
        {:else if frameDetectionsLoading}
          <p class="empty">Loading ROIs from this frame.</p>
        {:else}
          <p class="empty">No stored ROIs were found for this frame.</p>
        {/if}
      </section>
    </div>
  </div>
{/if}
