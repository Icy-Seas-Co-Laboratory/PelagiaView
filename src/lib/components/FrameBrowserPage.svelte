<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import CollectionTokenInput from '$lib/components/CollectionTokenInput.svelte';
  import InfoChip from '$lib/components/InfoChip.svelte';
  import KonvaImageCanvas from '$lib/components/KonvaImageCanvas.svelte';
  import { authenticatedFetch } from '$lib/api/client';
  import { imageInversionEnabled } from '$lib/stores/displayPreferences';
  import { getClient, session } from '$lib/stores/session';
  import type { CollectionSummary, DetectionSummary, FrameContextResponse, FrameProcessingState } from '$lib/api/types';
  import { formatBytes, formatCount, numericValue } from '$lib/utils/format';
  import { projectPreferenceKey } from '$lib/utils/preferences';
  import { createZipBlob, downloadBlob } from '$lib/utils/zipDownload';
  import type { ImageInfoSpec, ImageLayer, ImageOverlayRect, ImageRenderSpec } from '$lib/utils/imageRenderSpec';

  type FrameRow = NonNullable<FrameProcessingState['frames']>[number];
  type FramePayloadKind = 'original' | 'preprocessed';
  type FrameSortBy = 'asset_frame' | 'frame' | 'captured_at' | 'filename' | 'roi_count' | 'refined_count';
  type SortDir = 'asc' | 'desc';

  let collections: CollectionSummary[] = [];
  let frames: FrameRow[] = [];
  let selectedCollection = '';
  let selectedKind = '';
  let filename = '';
  let preprocessingState = '';
  let detectionState = '';
  let refinementState = '';
  let startFrame: number | null = null;
  let endFrame: number | null = null;
  let payloadKind: FramePayloadKind = 'original';
  let sortBy: FrameSortBy = 'asset_frame';
  let sortDir: SortDir = 'asc';
  let nextOffset = 0;
  let hasMore = true;
  let loading = false;
  let error: string | null = null;
  let preferencesReady = false;
  let selectedFrame: FrameRow | null = null;
  let selectedFrameContext: FrameContextResponse | null = null;
  let selectedRoiDetection: DetectionSummary | null = null;
  let frameModalPayloadKind: FramePayloadKind = 'preprocessed';
  let frameModalDetections: DetectionSummary[] = [];
  let frameModalLoading = false;
  let frameModalError: string | null = null;
  let frameModalLoadSerial = 0;
  let selectedFrameRoiIds = new Set<string>();
  let frameRoiDownloadBusy = false;
  let selectedBrowserFrameIds = new Set<string>();
  let browserFrameDownloadBusy = false;
  let previousSelectionPayloadKind: FramePayloadKind = payloadKind;
  let tileScroller: HTMLElement;
  let loadMoreSentinel: HTMLElement;
  let pageScroller: HTMLElement | null = null;

  const pageSize = 40;
  const tileDisplayMaxWidth = 250;
  const tileDisplayMaxHeight = 210;
  const frameModalImageWidth = 1100;
  const frameModalImageMaxHeight = 720;
  const tilePreviewMaxDimensionPx = 280;
  const modalPreviewMaxDimensionPx = 900;
  const frameDetectionBatchSize = 200;
  const displayImageFormat = 'jpg';
  const imageFormat = displayImageFormat;
  const scaleBarLengths = [1000, 500, 100, 50, 10];

  $: collectionOptions = uniqueStrings(collections.map((collection) => collection.collection));
  $: advancedSearchActive = Boolean(
    selectedCollection ||
      selectedKind ||
      filename.trim() ||
      preprocessingState ||
      detectionState ||
      refinementState ||
      hasFilterValue(startFrame) ||
      hasFilterValue(endFrame)
  );
  $: visibleCount = frames.length;
  $: summaryLabel = `${formatCount(visibleCount)} frame${visibleCount === 1 ? '' : 's'} loaded`;
  $: selectableBrowserFrames = frames.filter(frameIsDownloadable);
  $: selectedBrowserFrameCount = selectableBrowserFrames.filter((frame) => frame.frame_id && selectedBrowserFrameIds.has(frame.frame_id)).length;
  $: if (payloadKind !== previousSelectionPayloadKind) {
    selectedBrowserFrameIds = new Set();
    previousSelectionPayloadKind = payloadKind;
  }
  $: frameModalImageDetections = frameModalDetections.filter(hasRoiImageData);
  $: selectableFrameDetections = frameModalImageDetections.filter((detection) => detection.id);
  $: selectedFrameRoiCount = selectableFrameDetections.filter((detection) => detection.id && selectedFrameRoiIds.has(detection.id)).length;
  $: frameModalOverlayKey = overlaySignature(frameModalCanvasOverlays());
  $: preferenceSnapshot = {
    selectedCollection,
    selectedKind,
    filename,
    preprocessingState,
    detectionState,
    refinementState,
    startFrame,
    endFrame,
    payloadKind,
    sortBy,
    sortDir
  };
  $: if (preferencesReady) persistPreferences(preferenceSnapshot);
  $: syncPageScrollListener(tileScroller);

  onMount(async () => {
    const client = getClient();
    if (!client) return;
    restorePreferences();
    preferencesReady = true;
    try {
      collections = await client.listCollections(300).catch(() => []);
      await loadFrames(true);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      loading = false;
    }
  });

  onDestroy(() => {
    detachPageScrollListener();
  });

  async function loadFrames(reset = false) {
    const client = getClient();
    if (!client || loading || (!reset && !hasMore)) return;
    loading = true;
    error = null;
    const offset = reset ? 0 : nextOffset;
    if (reset) {
      frames = [];
      selectedFrame = null;
      selectedBrowserFrameIds = new Set();
      nextOffset = 0;
      hasMore = true;
    }

    try {
      const response = await client.frameProcessingState({
        collection: emptyToNull(selectedCollection),
        kind: emptyToNull(selectedKind),
        filename: emptyToNull(filename.trim()),
        preprocessing_state: emptyToNull(normalizedStateFilter(preprocessingState)),
        detection_state: emptyToNull(normalizedStateFilter(detectionState)),
        refinement_state: emptyToNull(normalizedStateFilter(refinementState)),
        start_frame: normalizedNumber(startFrame),
        end_frame: normalizedNumber(endFrame),
        sort_by: sortBy,
        sort_dir: sortDir,
        limit: pageSize,
        offset
      });
      const pageFrames = response.frames ?? [];
      frames = reset ? pageFrames : [...frames, ...pageFrames];
      nextOffset = response.page?.next_offset ?? frames.length;
      hasMore = response.page?.next_offset !== null && pageFrames.length > 0;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  function resetFilters() {
    selectedCollection = '';
    selectedKind = '';
    filename = '';
    preprocessingState = '';
    detectionState = '';
    refinementState = '';
    startFrame = null;
    endFrame = null;
    payloadKind = 'original';
    sortBy = 'asset_frame';
    sortDir = 'asc';
    void loadFrames(true);
  }

  function maybeLoadMore(event: Event) {
    const scroller = event.currentTarget as HTMLElement;
    if (!scroller || loading || !hasMore) return;
    const remaining = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (remaining < 700) void loadFrames(false);
  }

  function maybeLoadMoreFromPageScroll(event: Event) {
    const scroller = event.currentTarget as HTMLElement;
    if (!scroller || loading || !hasMore || !loadMoreSentinel) return;
    const remaining = loadMoreSentinel.getBoundingClientRect().top - scroller.getBoundingClientRect().bottom;
    if (remaining < 700) void loadFrames(false);
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
    pageScroller?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openFrameDetail(frame: FrameRow) {
    selectedFrame = frame;
    frameModalPayloadKind = frame.has_preprocessed_payload ? 'preprocessed' : 'original';
    selectedFrameRoiIds = new Set();
    void loadFrameDetail(frame, frameModalPayloadKind);
  }

  function closeFrameDetail() {
    frameModalLoadSerial += 1;
    selectedFrame = null;
    selectedRoiDetection = null;
    selectedFrameContext = null;
    frameModalDetections = [];
    frameModalLoading = false;
    frameModalError = null;
    selectedFrameRoiIds = new Set();
  }

  function setFrameModalPayloadKind(kind: FramePayloadKind) {
    frameModalPayloadKind = kind;
    if (selectedFrame) void loadFrameDetail(selectedFrame, kind);
  }

  async function loadFrameDetail(frame: FrameRow, kind: FramePayloadKind) {
    const client = getClient();
    if (!client || !frame.frame_id) return;
    const serial = ++frameModalLoadSerial;
    frameModalLoading = true;
    frameModalError = null;
    selectedFrameContext = null;
    frameModalDetections = [];
    try {
      let offset: number | null = 0;
      let contextForFrame: FrameContextResponse | null = null;
      const detections: DetectionSummary[] = [];
      while (offset !== null) {
        const context = await client.frameContext(frame.frame_id, {
          width: frameModalImageWidth,
          include_detections: true,
          detection_limit: frameDetectionBatchSize,
          detection_offset: offset,
          frame_payload_kind: kind
        });
        if (serial !== frameModalLoadSerial) return;
        contextForFrame = context;
        detections.push(...withoutDuplicateDetections(detections, context.detections ?? []));
        offset = context.page?.next_offset ?? null;
        if ((context.detections ?? []).length === 0) break;
      }
      if (serial !== frameModalLoadSerial) return;
      selectedFrameContext = contextForFrame;
      frameModalDetections = detections;
    } catch (err) {
      if (serial === frameModalLoadSerial) frameModalError = err instanceof Error ? err.message : String(err);
    } finally {
      if (serial === frameModalLoadSerial) frameModalLoading = false;
    }
  }

  function withoutDuplicateDetections(existingPage: DetectionSummary[], page: DetectionSummary[]): DetectionSummary[] {
    const existing = new Set(existingPage.map((detection) => detection.id).filter(Boolean));
    return page.filter((detection) => !detection.id || !existing.has(detection.id));
  }

  function frameImageUrl(
    frame: FrameRow,
    previewMaxDimension: number | null = tilePreviewMaxDimensionPx,
    format = displayImageFormat,
    kind: FramePayloadKind = payloadKind
  ): string | null {
    const client = getClient();
    if (!client) return null;
    if (kind === 'preprocessed' && !frame.has_preprocessed_payload) return null;
    const options = {
      frame_id: frame.frame_id,
      format,
      width: previewMaxDimension,
      cache_bust: cacheBustKey(frame)
    };
    return kind === 'preprocessed' ? client.preprocessedFrameUrl(options) : client.originalFrameUrl(options);
  }

  function frameDownloadUrl(frame: FrameRow, kind: FramePayloadKind = payloadKind): string | null {
    return frameImageUrl(frame, null, imageFormat, kind);
  }

  function frameIsDownloadable(frame: FrameRow): boolean {
    return Boolean(frame.frame_id && frameDownloadUrl(frame, payloadKind));
  }

  function toggleBrowserFrameSelection(frame: FrameRow, checked: boolean) {
    if (!frame.frame_id) return;
    const next = new Set(selectedBrowserFrameIds);
    if (checked) next.add(frame.frame_id);
    else next.delete(frame.frame_id);
    selectedBrowserFrameIds = next;
  }

  function toggleAllBrowserFrames(checked: boolean) {
    selectedBrowserFrameIds = checked
      ? new Set(selectableBrowserFrames.map((frame) => frame.frame_id).filter(Boolean) as string[])
      : new Set();
  }

  async function downloadSelectedBrowserFrames() {
    const selected = selectableBrowserFrames.filter((frame) => frame.frame_id && selectedBrowserFrameIds.has(frame.frame_id));
    if (!selected.length || browserFrameDownloadBusy) return;
    browserFrameDownloadBusy = true;
    error = null;
    try {
      const entries = [];
      for (const frame of selected) {
        const url = frameDownloadUrl(frame, payloadKind);
        if (!url) continue;
        entries.push({
          filename: frameDownloadFilename(frame, payloadKind, imageFormat, payloadKind),
          blob: await fetchRemoteBlob(url)
        });
      }
      if (entries.length) downloadBlob(await createZipBlob(entries), browserFramesZipFilename());
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      browserFrameDownloadBusy = false;
    }
  }

  function frameRenderSpec(
    frame: FrameRow,
    maxWidth: number,
    maxHeight: number,
    previewMaxDimension: number | null = tilePreviewMaxDimensionPx,
    exportControls: 'menu' | 'full' | 'none' = 'menu',
    kind: FramePayloadKind = payloadKind
  ): ImageRenderSpec | null {
    const url = frameImageUrl(frame, previewMaxDimension, displayImageFormat, kind);
    if (!url) return null;
    const downloadUrl = frameDownloadUrl(frame, kind) ?? url;
    return {
      key: frameCanvasKey(frame, previewMaxDimension, kind),
      image: {
        url,
        alt: frameAlt(frame, kind),
        invert: kind !== 'original' && $imageInversionEnabled,
        sourceWidth: frameSourceDimensions(kind)?.width ?? null,
        sourceHeight: frameSourceDimensions(kind)?.height ?? null
      },
      display: { maxWidth, maxHeight, allowUpscale: exportControls !== 'menu' },
      scaleBar: { enabled: true, placement: 'inside', lengths: scaleBarLengths },
      toolbar: {
        exportControls,
        filename: frameDownloadFilename(frame, 'annotated', 'png', kind),
        originalUrl: downloadUrl,
        originalFilename: frameDownloadFilename(frame, kind, 'png', kind),
        annotatedFilename: frameDownloadFilename(frame, 'overlay', 'png', kind),
        info: frameInfo(frame)
      }
    };
  }

  function frameCanvasKey(
    frame: FrameRow,
    previewMaxDimension: number | null = tilePreviewMaxDimensionPx,
    kind: FramePayloadKind = payloadKind
  ): string {
    return [
      frame.frame_id,
      frame.frame_num ?? frame.frame_index ?? '',
      kind,
      displayImageFormat,
      kind !== 'original' && $imageInversionEnabled ? 'inverted' : 'normal',
      previewMaxDimension ? `preview-${previewMaxDimension}` : 'full',
      cacheBustKey(frame)
    ].join(':');
  }

  function cacheBustKey(frame: FrameRow): number | null {
    const timestamp = frame.captured_at;
    if (typeof timestamp !== 'string') return null;
    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function frameInfo(frame: FrameRow): ImageInfoSpec {
    return {
      assetFilename: frame.asset_filename ?? frame.asset_id ?? 'Unknown asset',
      frameNumber: frame.frame_num ?? frame.frame_index ?? null,
      timestamp: frame.captured_at ?? null,
      collections: frame.collections ?? null
    };
  }

  function frameAlt(frame: FrameRow, kind: FramePayloadKind = payloadKind): string {
    return `${kind} frame ${frame.frame_num ?? frame.frame_index ?? frame.frame_id}`;
  }

  function frameDownloadFilename(
    frame: FrameRow,
    suffix: string = payloadKind,
    format = imageFormat,
    kind: FramePayloadKind = payloadKind
  ): string {
    const base = (frame.asset_filename ?? frame.asset_id ?? 'frame').replace(/[^a-zA-Z0-9._-]+/g, '_');
    const frameNumber = frame.frame_num ?? frame.frame_index ?? 'unknown';
    const normalizedSuffix = suffix === kind ? kind : `${kind}-${suffix}`;
    return `${base}_frame-${frameNumber}_${normalizedSuffix}.${format}`;
  }

  function browserFramesZipFilename(): string {
    return `pelagia_${payloadKind}_frames_${selectedBrowserFrameCount}.zip`;
  }

  function frameNumberLabel(frame: FrameRow): string {
    const frameNumber = frame.frame_num ?? frame.frame_index;
    return frameNumber === undefined || frameNumber === null ? 'unknown' : String(frameNumber);
  }

  function dimensionsLabel(frame: FrameRow): string {
    return frame.has_preprocessed_payload ? 'raw + preprocessed payloads' : 'raw payload only';
  }

  function countsLabel(frame: FrameRow): string {
    const detectionCount = numericValue(frame.detection_count) ?? 0;
    const refinedCount = numericValue(frame.refined_detection_count) ?? 0;
    return `${formatCount(detectionCount)} ROI${detectionCount === 1 ? '' : 's'} · ${formatCount(refinedCount)} refined`;
  }

  function frameHasSegmentation(frame: FrameRow | null): boolean {
    if (!frame) return false;
    const detectionCount = numericValue(frame.detection_count) ?? 0;
    const state = String(frame.detection_state ?? '').toLowerCase();
    return detectionCount > 0 || state.includes('detected') || state.includes('succeeded') || state.includes('complete');
  }

  function frameRoiEmptyMessage(frame: FrameRow | null): string {
    if (frameModalLoading) return 'Loading ROIs from this frame.';
    if (frameHasSegmentation(frame) || frameModalDetections.length) {
      return `${formatCount(frameModalDetections.length)} ROI${frameModalDetections.length === 1 ? '' : 's'} detected, but none have stored image data.`;
    }
    return 'This frame has not been segmented yet.';
  }

  function frameModalRenderSpec(frame: FrameRow): ImageRenderSpec | null {
    const spec = frameRenderSpec(
      frame,
      frameModalImageWidth,
      frameModalImageMaxHeight,
      modalPreviewMaxDimensionPx,
      'full',
      frameModalPayloadKind
    );
    if (!spec) return null;
    return {
      ...spec,
      layers: rectLayersForFrameContext(frameModalCanvasOverlays()),
      display: {
        maxWidth: frameModalImageWidth,
        maxHeight: frameModalImageMaxHeight,
        background: '#050807',
        allowUpscale: true
      }
    };
  }

  function frameModalCanvasOverlays(): ImageOverlayRect[] {
    const sourceDimensions = frameSourceDimensions(frameModalPayloadKind);
    const overlays: ImageOverlayRect[] = [];
    for (const detection of frameModalDetections) {
      const rect = frameContextOverlayRect(detection, frameModalPayloadKind, sourceDimensions);
      if (!rect) continue;
      const selected = Boolean(detection.id && selectedFrameRoiIds.has(detection.id));
      const hasPayload = hasRoiImageData(detection);
      overlays.push({
        ...rect,
        stroke: hasPayload ? (selected ? '#e2322e' : '#f5e642') : '#2f6b4f',
        lineWidth: selected ? 3 : 2,
        halo: hasPayload ? (selected ? 'rgba(255, 255, 255, 0.82)' : 'rgba(5, 8, 7, 0.78)') : undefined,
        selected
      });
    }
    return overlays;
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
      tooltip: rect.selected ? 'Selected ROI' : 'ROI'
    }));
  }

  function overlaySignature(rects: ImageOverlayRect[]): string {
    return rects
      .map((rect) => [
        rect.id ?? '',
        rect.x,
        rect.y,
        rect.w,
        rect.h,
        rect.stroke,
        rect.lineWidth ?? '',
        rect.selected ? 'selected' : ''
      ].join(','))
      .join('|');
  }

  function frameContextOverlayRect(
    detection: DetectionSummary,
    kind: FramePayloadKind,
    sourceDimensions: { width: number; height: number } | null
  ): Omit<ImageOverlayRect, 'stroke'> | null {
    const tuples = [readTargetTuple(detection), readCropTuple(detection)].filter(Boolean) as Array<
      [number, number, number, number]
    >;
    if (!tuples.length) return null;
    const origins = uniqueOrigins([frameContextOrigin(kind), { x: 0, y: 0 }]);
    let best: Omit<ImageOverlayRect, 'stroke'> | null = null;
    let bestScore = -1;
    for (const tuple of tuples) {
      for (const origin of origins) {
        const rect = {
          x: tuple[0] - origin.x,
          y: tuple[1] - origin.y,
          w: tuple[2],
          h: tuple[3],
          coordinateSpace: 'source' as const
        };
        if (rect.w <= 0 || rect.h <= 0) continue;
        const score = sourceDimensions ? rectIntersectionArea(rect, sourceDimensions) : 1;
        if (score > bestScore) {
          best = rect;
          bestScore = score;
        }
      }
    }
    return bestScore > 0 ? best : null;
  }

  function uniqueOrigins(origins: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
    const seen = new Set<string>();
    return origins.filter((origin) => {
      const key = `${origin.x}:${origin.y}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function rectIntersectionArea(
    rect: { x: number; y: number; w: number; h: number },
    bounds: { width: number; height: number }
  ): number {
    const x0 = Math.max(0, rect.x);
    const y0 = Math.max(0, rect.y);
    const x1 = Math.min(bounds.width, rect.x + rect.w);
    const y1 = Math.min(bounds.height, rect.y + rect.h);
    return Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  }

  function frameContextOrigin(kind: FramePayloadKind): { x: number; y: number } {
    const frame = selectedFrameContext?.frame;
    if (kind === 'preprocessed') {
      const cropTuple = tupleFromBBoxLike(frame?.preprocessed_metadata?.crop_bbox) ?? tupleFromBBoxLike(frame?.metadata?.crop_bbox);
      if (cropTuple) return { x: cropTuple[0], y: cropTuple[1] };
    }
    return {
      x: numberValue(frame?.bbox_x) ?? 0,
      y: numberValue(frame?.bbox_y) ?? 0
    };
  }

  function frameSourceDimensions(kind: FramePayloadKind = payloadKind): { width: number; height: number } | null {
    const frame = selectedFrameContext?.frame;
    if (!frame) return null;
    if (kind === 'preprocessed') {
      const preprocessed = dimensionsFromShape(
        frame.preprocessed_payload_shape ??
          frame.preprocessed_metadata?.shape ??
          frame.metadata?.preprocessed_payload_shape
      );
      if (preprocessed) return preprocessed;
      const preprocessedMetadataDimensions = dimensionsFromMetadata(frame.preprocessed_metadata);
      if (preprocessedMetadataDimensions) return preprocessedMetadataDimensions;
    }
    const width = numberValue(frame.width);
    const height = numberValue(frame.height);
    if (width && height) return { width, height };
    return (
      dimensionsFromShape(frame.payload_shape ?? frame.shape ?? (Array.isArray(frame.metadata?.shape) ? frame.metadata.shape : null)) ??
      dimensionsFromMetadata(frame.metadata) ??
      dimensionsFromDetections(frameModalDetections)
    );
  }

  function roiRenderSpec(detection: DetectionSummary): ImageRenderSpec | null {
    const client = getClient();
    if (!client || !detection.id || !hasRoiImageData(detection)) return null;
    return {
      key: `frame-modal-roi:${detection.id}:${$imageInversionEnabled ? 'inverted' : 'normal'}`,
      image: {
        url: client.detectionRoiUrl(detection.id, 'jpg', { width: 180 }),
        alt: `ROI ${detection.roi_index ?? detection.id}`,
        invert: $imageInversionEnabled,
        sourceWidth: roiSourceWidth(detection),
        sourceHeight: roiSourceHeight(detection)
      },
      display: {
        maxWidth: 132,
        maxHeight: 180,
        background: '#111916',
        allowUpscale: true
      },
      toolbar: { exportControls: 'none' }
    };
  }

  function roiDetailRenderSpec(detection: DetectionSummary): ImageRenderSpec | null {
    const client = getClient();
    if (!client || !detection.id || !hasRoiImageData(detection)) return null;
    const filename = roiFilenameForDetection(detection);
    return {
      key: `frame-modal-roi-detail:${detection.id}:${$imageInversionEnabled ? 'inverted' : 'normal'}`,
      image: {
        url: client.detectionRoiUrl(detection.id, 'jpg'),
        alt: `ROI ${detection.roi_index ?? detection.id}`,
        invert: $imageInversionEnabled,
        sourceWidth: roiSourceWidth(detection),
        sourceHeight: roiSourceHeight(detection)
      },
      display: {
        maxWidth: 520,
        maxHeight: 460,
        background: '#111916',
        allowUpscale: true
      },
      scaleBar: { enabled: true, placement: 'inside', lengths: scaleBarLengths },
      toolbar: {
        exportControls: 'menu',
        filename,
        originalUrl: client.detectionRoiUrl(detection.id, 'png'),
        originalFilename: filename,
        annotatedFilename: filename.replace(/\.png$/i, '-scale-bar.png'),
        info: {
          assetFilename: selectedFrame?.asset_filename ?? selectedFrame?.asset_id ?? detection.asset_id ?? null,
          frameNumber: selectedFrame ? frameNumberLabel(selectedFrame) : detection.frame_index ?? null,
          timestamp: selectedFrameContext?.frame?.captured_at ?? selectedFrame?.captured_at ?? null,
          collections: selectedFrame?.collections ?? null
        }
      }
    };
  }

  function hasRoiImageData(detection: DetectionSummary): boolean {
    return Boolean(detection.id && (numericValue(detection.roi_payload_bytes) ?? 0) > 0);
  }

  function openRoiDetail(detection: DetectionSummary) {
    selectedRoiDetection = detection;
  }

  function closeRoiDetail() {
    selectedRoiDetection = null;
  }

  function roiSourceWidth(detection: DetectionSummary): number | null {
    return bboxValue(detection, 'crop_bbox', 'w') ?? bboxValue(detection, 'bbox', 'w');
  }

  function roiSourceHeight(detection: DetectionSummary): number | null {
    return bboxValue(detection, 'crop_bbox', 'h') ?? bboxValue(detection, 'bbox', 'h');
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

  function frameRoiThumbnailSize(detection: DetectionSummary): { width: number; height: number } {
    const maxWidth = 132;
    const maxHeight = 180;
    const width = roiSourceWidth(detection);
    const height = roiSourceHeight(detection);
    if (!width || !height) return { width: maxWidth, height: 112 };
    const scale = Math.min(maxWidth / width, maxHeight / height);
    return {
      width: Math.max(24, Math.round(width * scale)),
      height: Math.max(24, Math.round(height * scale))
    };
  }

  function frameRoiThumbnailStyle(detection: DetectionSummary): string {
    const size = frameRoiThumbnailSize(detection);
    return `--roi-thumb-width: ${size.width}px; --roi-thumb-height: ${size.height}px;`;
  }

  function toggleFrameRoiSelection(detection: DetectionSummary, checked: boolean) {
    if (!detection.id) return;
    const next = new Set(selectedFrameRoiIds);
    if (checked) next.add(detection.id);
    else next.delete(detection.id);
    selectedFrameRoiIds = next;
  }

  function selectAllFrameRois() {
    selectedFrameRoiIds = new Set(selectableFrameDetections.map((detection) => detection.id).filter(Boolean) as string[]);
  }

  function clearFrameRoiSelection() {
    selectedFrameRoiIds = new Set();
  }

  async function downloadSelectedFrameRois() {
    const client = getClient();
    const selected = selectableFrameDetections.filter((detection) => detection.id && selectedFrameRoiIds.has(detection.id));
    if (!client || !selected.length || frameRoiDownloadBusy) return;
    frameRoiDownloadBusy = true;
    try {
      const entries = [];
      for (const detection of selected) {
        if (!detection.id) continue;
        entries.push({
          filename: roiFilenameForDetection(detection),
          blob: await fetchRemoteBlob(client.detectionRoiUrl(detection.id, 'png'))
        });
      }
      if (entries.length) downloadBlob(await createZipBlob(entries), frameRoisZipFilename());
    } finally {
      frameRoiDownloadBusy = false;
    }
  }

  async function fetchRemoteBlob(url: string): Promise<Blob> {
    const response = await authenticatedFetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Download failed (${response.status}).`);
    return response.blob();
  }

  function roiFilenameForDetection(detection: DetectionSummary): string {
    const base = (selectedFrame?.asset_filename ?? selectedFrame?.asset_id ?? detection.asset_id ?? 'asset').replace(/[^a-zA-Z0-9._-]+/g, '_');
    const frameNumber = selectedFrame ? frameNumberLabel(selectedFrame) : detection.frame_index ?? 'unknown';
    return `${base}_frame-${frameNumber}_roi-${detection.roi_index ?? detection.id ?? 'unknown'}.png`;
  }

  function frameRoisZipFilename(): string {
    const base = (selectedFrame?.asset_filename ?? selectedFrame?.asset_id ?? 'asset')
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '_');
    const frameNumber = selectedFrame ? frameNumberLabel(selectedFrame) : 'unknown';
    return `${base}_frame-${frameNumber}_rois.zip`;
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

  function numberValue(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function dimensionsFromShape(shape: unknown): { width: number; height: number } | null {
    if (Array.isArray(shape) && shape.length >= 2) {
      const shapeHeight = numberValue(shape[0]);
      const shapeWidth = numberValue(shape[1]);
      if (shapeWidth && shapeHeight) return { width: shapeWidth, height: shapeHeight };
    }
    return null;
  }

  function dimensionsFromMetadata(metadata: Record<string, unknown> | null | undefined): { width: number; height: number } | null {
    if (!metadata) return null;
    const shapeDimensions = dimensionsFromShape(
      metadata.shape ??
        metadata.payload_shape ??
        metadata.image_shape ??
        metadata.frame_shape ??
        metadata.preprocessed_payload_shape
    );
    if (shapeDimensions) return shapeDimensions;

    const width =
      numberValue(metadata.width) ??
      numberValue(metadata.image_width) ??
      numberValue(metadata.frame_width) ??
      numberValue(metadata.payload_width);
    const height =
      numberValue(metadata.height) ??
      numberValue(metadata.image_height) ??
      numberValue(metadata.frame_height) ??
      numberValue(metadata.payload_height);
    return width && height ? { width, height } : null;
  }

  function dimensionsFromDetections(detectionsForFrame: DetectionSummary[]): { width: number; height: number } | null {
    let maxX = 0;
    let maxY = 0;
    for (const detection of detectionsForFrame) {
      const x = bboxValue(detection, 'bbox', 'x');
      const y = bboxValue(detection, 'bbox', 'y');
      const w = bboxValue(detection, 'bbox', 'w');
      const h = bboxValue(detection, 'bbox', 'h');
      if (x === null || y === null || w === null || h === null) continue;
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    }
    return maxX > 0 && maxY > 0 ? { width: maxX, height: maxY } : null;
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
      x?: number | string;
      y?: number | string;
      w?: number | string;
      h?: number | string;
      width?: number | string;
      height?: number | string;
      left?: number | string;
      top?: number | string;
      right?: number | string;
      bottom?: number | string;
      x0?: number | string;
      y0?: number | string;
      x1?: number | string;
      y1?: number | string;
      xmin?: number | string;
      ymin?: number | string;
      xmax?: number | string;
      ymax?: number | string;
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

  function tupleFromArray(value: unknown): [number, number, number, number] | null {
    if (!Array.isArray(value) || value.length < 4) return null;
    return tupleFromValues(value[0], value[1], value[2], value[3]);
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

  function formatDateTime(value: unknown): string {
    if (typeof value !== 'string' || !value) return 'unknown';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  function metadataBlock(value: unknown): string {
    if (!value || typeof value !== 'object') return '{}';
    return JSON.stringify(value, null, 2);
  }

  function stateClass(value?: string | null): string {
    const normalized = String(value ?? '').toLowerCase();
    if (normalized.includes('fully') || normalized === 'complete' || normalized === 'completed') return 'good';
    if (normalized.includes('partial') || normalized.includes('needs') || normalized.includes('pending')) return 'warn';
    if (normalized.includes('failed') || normalized.includes('missing') || normalized.includes('error')) return 'bad';
    return '';
  }

  function emptyToNull(value: string): string | null {
    return value ? value : null;
  }

  function hasFilterValue(value: unknown): boolean {
    return value !== null && value !== undefined && value !== '';
  }

  function uniqueStrings(values: Array<string | null | undefined>): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of values) {
      const value = raw?.trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(value);
    }
    return result;
  }

  function normalizedNumber(value: number | string | null): number | null {
    if (value === null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function persistPreferences(snapshot: typeof preferenceSnapshot) {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(frameBrowserPreferenceKey(), JSON.stringify(snapshot));
  }

  function restorePreferences() {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(frameBrowserPreferenceKey());
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Partial<typeof preferenceSnapshot>;
      selectedCollection = typeof parsed.selectedCollection === 'string' ? parsed.selectedCollection : '';
      selectedKind = typeof parsed.selectedKind === 'string' ? parsed.selectedKind : '';
      filename = typeof parsed.filename === 'string' ? parsed.filename : '';
      preprocessingState = typeof parsed.preprocessingState === 'string' ? normalizedStateFilter(parsed.preprocessingState) : '';
      detectionState = typeof parsed.detectionState === 'string' ? normalizedStateFilter(parsed.detectionState) : '';
      refinementState = typeof parsed.refinementState === 'string' ? normalizedStateFilter(parsed.refinementState) : '';
      startFrame = normalizedNumber(parsed.startFrame ?? null);
      endFrame = normalizedNumber(parsed.endFrame ?? null);
      payloadKind = parsed.payloadKind === 'preprocessed' ? 'preprocessed' : 'original';
      sortBy = frameSortByPreference(parsed.sortBy, sortBy);
      sortDir = sortDirPreference(parsed.sortDir, sortDir);
    } catch {
      localStorage.removeItem(frameBrowserPreferenceKey());
    }
  }

  function frameSortByPreference(value: unknown, fallback: FrameSortBy): FrameSortBy {
    return value === 'asset_frame' ||
      value === 'frame' ||
      value === 'captured_at' ||
      value === 'filename' ||
      value === 'roi_count' ||
      value === 'refined_count'
      ? value
      : fallback;
  }

  function sortDirPreference(value: unknown, fallback: SortDir): SortDir {
    return value === 'asc' || value === 'desc' ? value : fallback;
  }

  function frameBrowserPreferenceKey(): string {
    return projectPreferenceKey('frame-browser', $session);
  }

  function normalizedStateFilter(value: string): string {
    const normalized = value.replaceAll('_', '-');
    if (normalized === 'needs-detection') return 'needs-detections';
    if (normalized === 'needs-preprocessing') return 'needs-preprocessed';
    return normalized;
  }
</script>

<div class="roi-browser-layout browser-top-layout">
  <section class="panel roi-filter-panel browser-filter-bar">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Filters</p>
        <h2>Frame Browser</h2>
      </div>
    </div>

    <div class="browser-primary-filters">
      <div class="browser-view-options">
        <div>
          <span class="control-label">Frame source</span>
          <div class="toggle-list">
            <button class:active={payloadKind === 'original'} type="button" on:click={() => (payloadKind = 'original')}>
              Raw
            </button>
            <button class:active={payloadKind === 'preprocessed'} type="button" on:click={() => (payloadKind = 'preprocessed')}>
              Preprocessed
            </button>
          </div>
        </div>
      </div>

      <div class="form-grid compact-grid browser-sort-group">
        <label>
          <span class="field-label-row">
            Sort by
            <InfoChip
              label="Frame sort help"
              text="Controls the order of frame tiles requested from the server. ROI count sorts are useful for review-heavy assets."
            />
          </span>
          <select bind:value={sortBy}>
            <option value="asset_frame">Asset + frame</option>
            <option value="frame">Frame number</option>
            <option value="captured_at">Captured time</option>
            <option value="filename">Filename</option>
            <option value="roi_count">ROI count</option>
            <option value="refined_count">Refined count</option>
          </select>
        </label>
        <label>
          Direction
          <select bind:value={sortDir}>
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </label>
      </div>

      <div class="button-row browser-filter-actions">
        <button type="button" on:click={() => loadFrames(true)}>Apply</button>
        <button class="ghost" type="button" on:click={resetFilters}>Reset</button>
      </div>
    </div>

    <details class="advanced-search-panel">
      <summary class:has-active-settings={advancedSearchActive}>Advanced search</summary>
      <div class="advanced-search-grid">
        <label>
          Collection
          <CollectionTokenInput
            value={selectedCollection}
            suggestions={collectionOptions}
            placeholder="Any collection"
            multi={false}
            ariaLabel="Collection filter"
            onChange={(value) => selectedCollection = value}
          />
        </label>

        <label>
          Asset kind
          <select bind:value={selectedKind}>
            <option value="">All kinds</option>
            <option value="video">Video</option>
            <option value="image">Image</option>
            <option value="image_sequence">Image sequence</option>
          </select>
        </label>

        <label>
          Filename
          <input bind:value={filename} placeholder="contains..." />
        </label>

        <label>
          Start frame
          <input type="number" min="1" bind:value={startFrame} />
        </label>
        <label>
          End frame
          <input type="number" min="1" bind:value={endFrame} />
        </label>

        <label>
          <span class="field-label-row">
            Preprocessing
            <InfoChip
              label="Preprocessing filter help"
              text="Filters frames by whether stored preprocessed payloads exist or whether the stage is complete across the selected assets."
            />
          </span>
          <select bind:value={preprocessingState}>
            <option value="">Any</option>
            <option value="has-preprocessed">Has preprocessed payload</option>
            <option value="fully-preprocessed">Fully preprocessed</option>
            <option value="partially-preprocessed">Partially preprocessed</option>
            <option value="needs-preprocessed">Needs preprocessing</option>
          </select>
        </label>

        <label>
          <span class="field-label-row">
            Candidate detection
            <InfoChip
              label="Candidate detection filter help"
              text="Filters frames by candidate ROI detection progress or whether detections are present."
            />
          </span>
          <select bind:value={detectionState}>
            <option value="">Any</option>
            <option value="has-detections">Has detections</option>
            <option value="fully-detected">Fully detected</option>
            <option value="partially-detected">Partially detected</option>
            <option value="needs-detections">Needs detection</option>
          </select>
        </label>

        <label>
          <span class="field-label-row">
            ROI refinement
            <InfoChip
              label="ROI refinement filter help"
              text="Filters frames by refined ROI availability or refinement progress."
            />
          </span>
          <select bind:value={refinementState}>
            <option value="">Any</option>
            <option value="has-refinement">Has refinement</option>
            <option value="fully-refined">Fully refined</option>
            <option value="partially-refined">Partially refined</option>
            <option value="needs-refinement">Needs refinement</option>
            <option value="no-detections">No detections</option>
          </select>
        </label>
      </div>
    </details>
  </section>

  <section class="panel roi-results-panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Frames</p>
        <h2>Raw and Preprocessed Tiles</h2>
      </div>
      <div class="browser-selection-actions">
        <label class="selection-master-toggle">
          <input
            type="checkbox"
            checked={selectableBrowserFrames.length > 0 && selectedBrowserFrameCount === selectableBrowserFrames.length}
            indeterminate={selectedBrowserFrameCount > 0 && selectedBrowserFrameCount < selectableBrowserFrames.length}
            disabled={!selectableBrowserFrames.length}
            on:change={(event) => toggleAllBrowserFrames((event.currentTarget as HTMLInputElement).checked)}
          />
          <span>{selectedBrowserFrameCount ? `${selectedBrowserFrameCount} selected` : summaryLabel}</span>
        </label>
        {#if selectedBrowserFrameCount}
          <button class="ghost compact-action" type="button" on:click={downloadSelectedBrowserFrames} disabled={browserFrameDownloadBusy}>
            {browserFrameDownloadBusy ? 'Preparing zip...' : 'Download'}
          </button>
        {/if}
      </div>
    </div>

    {#if error}<p class="form-error">{error}</p>{/if}

    <div class="roi-tile-scroll" bind:this={tileScroller} on:scroll={maybeLoadMore}>
      {#if frames.length}
        <div class="roi-tile-grid frame-tile-grid">
          {#each frames as frame}
            {@const spec = frameRenderSpec(frame, tileDisplayMaxWidth, tileDisplayMaxHeight, tilePreviewMaxDimensionPx, 'menu')}
            <div class="roi-tile frame-tile" class:tile-selected={frame.frame_id ? selectedBrowserFrameIds.has(frame.frame_id) : false}>
              <div class="roi-image-frame">
                {#if frameIsDownloadable(frame)}
                  <label class="tile-selection-toggle" aria-label="Select frame tile">
                    <input
                      type="checkbox"
                      checked={frame.frame_id ? selectedBrowserFrameIds.has(frame.frame_id) : false}
                      on:change={(event) => toggleBrowserFrameSelection(frame, (event.currentTarget as HTMLInputElement).checked)}
                    />
                  </label>
                {/if}
                {#if spec}
                  {#key frameCanvasKey(frame, tilePreviewMaxDimensionPx)}
                    <KonvaImageCanvas
                      {spec}
                      mode="thumbnail"
                      onMoreAction={() => openFrameDetail(frame)}
                    />
                  {/key}
                {:else}
                  <div class="frame-unavailable">
                    <strong>No preprocessed image</strong>
                    <span>Run preprocessing to populate this frame payload.</span>
                  </div>
                {/if}
              </div>
              <button class="roi-tile-meta frame-tile-meta" type="button" on:click={() => openFrameDetail(frame)}>
                <strong>{frame.asset_filename ?? frame.asset_id ?? 'Unknown asset'}</strong>
                <span>Frame {frameNumberLabel(frame)} · {dimensionsLabel(frame)}</span>
                <small>{countsLabel(frame)}</small>
                <div class="frame-state-row" aria-label="Frame processing states">
                  <span class={`status-pill ${stateClass(frame.preprocessing_state)}`}>{frame.preprocessing_state ?? 'raw'}</span>
                  <span class={`status-pill ${stateClass(frame.detection_state)}`}>{frame.detection_state ?? 'undetected'}</span>
                  <span class={`status-pill ${stateClass(frame.refinement_state)}`}>{frame.refinement_state ?? 'unrefined'}</span>
                </div>
              </button>
            </div>
          {/each}
        </div>
        {#if loading}<p class="soft loading-row">Loading more frames</p>{/if}
        {#if !loading && !hasMore}<p class="soft loading-row">All matching frames loaded.</p>{/if}
        <div class="load-sentinel" bind:this={loadMoreSentinel} aria-hidden="true"></div>
      {:else if loading}
        <p class="empty">Loading frames.</p>
      {:else}
        <p class="empty">No frames match the current filters.</p>
      {/if}
    </div>
  </section>

  <button class="scroll-top-button" type="button" aria-label="Scroll to top" on:click={scrollToTop}></button>
</div>

{#if selectedFrame}
  {@const detailSpec = frameModalRenderSpec(selectedFrame)}
  <div class="modal-backdrop frame-context-backdrop">
    <div class="roi-detail-modal frame-context-modal" role="dialog" aria-modal="true" aria-label="Frame details">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Frame detail</p>
          <h2>Frame {frameNumberLabel(selectedFrame)}</h2>
        </div>
        <button class="ghost" type="button" on:click={closeFrameDetail}>Close</button>
      </div>

      {#if frameModalError}<p class="form-error">{frameModalError}</p>{/if}

      <div class="frame-context-layout">
        <section class="frame-context-viewer">
          <div class="roi-frame-controls">
            <div class="toggle-list">
              <button class:active={frameModalPayloadKind === 'original'} type="button" on:click={() => setFrameModalPayloadKind('original')}>
                Original
              </button>
              <button
                class:active={frameModalPayloadKind === 'preprocessed'}
                type="button"
                disabled={!selectedFrame.has_preprocessed_payload}
                on:click={() => setFrameModalPayloadKind('preprocessed')}
              >
                Preprocessed
              </button>
            </div>
          </div>
          <div class="frame-context-stage">
            {#if detailSpec}
              {#key `${frameCanvasKey(selectedFrame, modalPreviewMaxDimensionPx, frameModalPayloadKind)}:${frameModalDetections.length}:${selectedFrameRoiCount}:${frameModalOverlayKey}`}
                <KonvaImageCanvas spec={detailSpec} mode="viewer" />
              {/key}
            {:else}
              <div class="frame-unavailable">
                {#if frameModalPayloadKind === 'preprocessed'}
                  <strong>No preprocessed image is available for this frame.</strong>
                  <span>Switch to Original or run preprocessing for this frame.</span>
                {:else}
                  <strong>The selected frame image could not be loaded.</strong>
                  <span>Check that the frame data endpoint is available.</span>
                {/if}
              </div>
            {/if}
          </div>
        </section>

        <aside class="frame-context-details">
          <h3>Frame</h3>
          <dl>
            <div>
              <dt>Frame ID</dt>
              <dd>{selectedFrame.frame_id}</dd>
            </div>
            <div>
              <dt>Frame number</dt>
              <dd>{frameNumberLabel(selectedFrame)}</dd>
            </div>
            <div>
              <dt>Asset file</dt>
              <dd>{selectedFrame.asset_filename ?? selectedFrame.asset_id ?? 'unknown'}</dd>
            </div>
            <div>
              <dt>Asset ID</dt>
              <dd>{selectedFrame.asset_id ?? 'unknown'}</dd>
            </div>
            <div>
              <dt>Captured</dt>
              <dd>{formatDateTime(selectedFrameContext?.frame?.captured_at ?? selectedFrame.captured_at)}</dd>
            </div>
            <div>
              <dt>Dimensions</dt>
              <dd>{dimensionsLabel(selectedFrame)}</dd>
            </div>
            <div>
              <dt>Preprocessed</dt>
              <dd>{selectedFrame.has_preprocessed_payload ? 'available' : 'not available'}</dd>
            </div>
            <div>
              <dt>ROIs</dt>
              <dd>{frameModalDetections.length}{frameModalLoading ? ' loading...' : ' loaded'}</dd>
            </div>
          </dl>
          <details class="frame-context-metadata">
            <summary>Frame metadata</summary>
            <pre>{metadataBlock(selectedFrameContext?.frame?.metadata)}</pre>
          </details>
          <details class="frame-context-metadata">
            <summary>Preprocessed metadata</summary>
            <pre>{metadataBlock(selectedFrameContext?.frame?.preprocessed_metadata)}</pre>
          </details>
        </aside>
      </div>

      <section class="frame-roi-section">
        <div class="section-heading">
          <p class="eyebrow">ROIs from frame</p>
          <strong>{frameModalImageDetections.length} ROI{frameModalImageDetections.length === 1 ? '' : 's'} with image data</strong>
        </div>
        {#if frameModalImageDetections.length}
          <div class="frame-roi-selection-bar">
            <div class="frame-roi-selection-status">
              <label>
                <input
                  type="checkbox"
                  checked={selectableFrameDetections.length > 0 && selectedFrameRoiCount === selectableFrameDetections.length}
                  indeterminate={selectedFrameRoiCount > 0 && selectedFrameRoiCount < selectableFrameDetections.length}
                  on:change={(event) => event.currentTarget.checked ? selectAllFrameRois() : clearFrameRoiSelection()}
                />
                Select all
              </label>
              <span>{selectedFrameRoiCount} selected</span>
            </div>
            <div class="frame-roi-download-actions">
              <button type="button" on:click={downloadSelectedFrameRois} disabled={!selectedFrameRoiCount || frameRoiDownloadBusy}>
                {frameRoiDownloadBusy ? 'Preparing zip...' : 'Download selected ROIs'}
              </button>
            </div>
          </div>
          <div class="frame-roi-thumbnail-grid">
            {#each frameModalImageDetections as detection}
              {@const roiSpec = roiRenderSpec(detection)}
              {#if detection.id && roiSpec}
                <div
                  class:download-selected={selectedFrameRoiIds.has(detection.id)}
                  class="frame-roi-thumbnail"
                >
                  <label class="frame-roi-select">
                    <input
                      type="checkbox"
                      checked={selectedFrameRoiIds.has(detection.id)}
                      on:change={(event) => toggleFrameRoiSelection(detection, event.currentTarget.checked)}
                    />
                    <span>Select</span>
                  </label>
                  <button class="frame-roi-thumbnail-inner" type="button" on:dblclick={() => openRoiDetail(detection)}>
                    <div class="frame-roi-thumbnail-image" style={frameRoiThumbnailStyle(detection)}>
                      <KonvaImageCanvas spec={roiSpec} mode="thumbnail" />
                    </div>
                    <span>ROI {detection.roi_index ?? detection.id}</span>
                    <small>{detection.roi_payload_bytes ? formatBytes(detection.roi_payload_bytes) : ''}</small>
                  </button>
                </div>
              {/if}
            {/each}
          </div>
          {#if frameModalLoading}<p class="soft loading-row">Loading ROIs from this frame.</p>{/if}
        {:else if frameModalLoading}
          <p class="empty">Loading ROIs from this frame.</p>
        {:else}
          <p class="empty">{frameRoiEmptyMessage(selectedFrame)}</p>
        {/if}
      </section>
    </div>
  </div>
{/if}

{#if selectedRoiDetection}
  {@const roiDetailSpec = roiDetailRenderSpec(selectedRoiDetection)}
  <div class="modal-backdrop roi-detail-backdrop">
    <div class="roi-detail-modal" role="dialog" aria-modal="true" aria-label="ROI details">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">ROI detail</p>
          <h2>{selectedFrame?.asset_filename ?? selectedFrame?.asset_id ?? selectedRoiDetection.asset_id ?? 'Unknown asset'}</h2>
        </div>
        <button class="ghost" type="button" on:click={closeRoiDetail}>Close</button>
      </div>

      <div class="roi-detail-grid">
        <div class="roi-detail-image-panel">
          {#if roiDetailSpec}
            {#key roiDetailSpec.key}
              <KonvaImageCanvas spec={roiDetailSpec} mode="static" />
            {/key}
          {:else}
            <div class="frame-unavailable">
              <strong>ROI image unavailable</strong>
              <span>The ROI payload endpoint did not return image data for this detection.</span>
            </div>
          {/if}
        </div>

        <div class="roi-detail-info">
          <h3>Detection</h3>
          <dl>
            <div>
              <dt>Detection ID</dt>
              <dd>{selectedRoiDetection.id}</dd>
            </div>
            <div>
              <dt>Frame</dt>
              <dd>{selectedFrame ? frameNumberLabel(selectedFrame) : selectedRoiDetection.frame_index ?? selectedRoiDetection.frame_id ?? 'unknown'}</dd>
            </div>
            <div>
              <dt>Bounding box</dt>
              <dd><code>{bboxLabel(selectedRoiDetection)}</code></dd>
            </div>
            <div>
              <dt>Area</dt>
              <dd>{selectedRoiDetection.area === undefined ? 'unknown' : Math.round(selectedRoiDetection.area)}</dd>
            </div>
            <div>
              <dt>Perimeter</dt>
              <dd>{selectedRoiDetection.perimeter === undefined ? 'unknown' : Math.round(selectedRoiDetection.perimeter)}</dd>
            </div>
            <div>
              <dt>Payload</dt>
              <dd>{selectedRoiDetection.roi_payload_bytes === undefined ? 'unknown' : formatBytes(selectedRoiDetection.roi_payload_bytes)}</dd>
            </div>
            <div>
              <dt>Encoding</dt>
              <dd>{selectedRoiDetection.roi_encoding ?? selectedRoiDetection.roi_format ?? 'unknown'}</dd>
            </div>
          </dl>

          <h3>Parent Frame</h3>
          <dl>
            <div>
              <dt>Frame ID</dt>
              <dd>{selectedFrame?.frame_id ?? selectedRoiDetection.frame_id ?? 'unknown'}</dd>
            </div>
            <div>
              <dt>Asset file</dt>
              <dd>{selectedFrame?.asset_filename ?? selectedRoiDetection.asset_filename ?? 'unknown'}</dd>
            </div>
            <div>
              <dt>Asset ID</dt>
              <dd>{selectedFrame?.asset_id ?? selectedRoiDetection.asset_id ?? 'unknown'}</dd>
            </div>
            <div>
              <dt>Captured</dt>
              <dd>{formatDateTime(selectedFrameContext?.frame?.captured_at ?? selectedFrame?.captured_at)}</dd>
            </div>
            <div>
              <dt>Dimensions</dt>
              <dd>{selectedFrame ? dimensionsLabel(selectedFrame) : 'unknown'}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  </div>
{/if}
