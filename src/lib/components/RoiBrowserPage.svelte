<script lang="ts">
  import { page } from '$app/stores';
  import { onMount, tick } from 'svelte';
  import FrameDisplayToggle from '$lib/components/FrameDisplayToggle.svelte';
  import { getClient } from '$lib/stores/session';
  import type { DetectionFilters, DetectionSummary, FrameSummary, RawAsset, SystemConfigResponse } from '$lib/api/types';
  import { processingSection, stringDefault } from '$lib/utils/configDefaults';
  import { roiBrowserHref } from '$lib/utils/dashboardNavigation';
  import {
    frameCaption,
    isFrameDisplayInverted,
    payloadKindForDisplay,
    type FrameDisplayMode
  } from '$lib/utils/frameDisplay';
  import { formatBytes } from '$lib/utils/format';

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
  let frameDetections: DetectionSummary[] = [];
  let frameDetectionsLoading = false;
  let frameDetectionsComplete = false;
  let frameDetectionLoadSerial = 0;
  let frameImageNaturalWidth = 0;
  let frameImageNaturalHeight = 0;
  let detailFrameDisplayMode: FrameDisplayMode = 'preprocessed';
  let detailFrameFailedUrl = '';
  let lastDetailFrameUrl = '';
  let tileScroller: HTMLElement;
  let loadMoreSentinel: HTMLElement;
  const roiBrowserPreferenceKey = 'pelagia-view:roi-browser:v1';
  const pageSize = 120;
  const frameDetectionBatchSize = 100;
  const roiDisplayMaxWidth = 220;
  const roiDisplayMaxHeight = 190;
  const modalRoiDisplayMaxWidth = 520;
  const modalRoiDisplayMaxHeight = 460;
  const frameContextImageScale = 0.33;
  const scaleBarLengths = [1000, 500, 100, 50, 10];

  $: visibleCount = detections.filter((detection) => detection.id).length;
  $: detailFramePayloadKind = payloadKindForDisplay(detailFrameDisplayMode);
  $: detailFrameImageInverted = isFrameDisplayInverted(detailFrameDisplayMode);
  $: detailFrameUrl = selectedDetection ? frameContextUrl(selectedDetection, detailFrameDisplayMode) : '';
  $: detailFrameUnavailable = Boolean(detailFrameUrl && detailFrameFailedUrl === detailFrameUrl);
  $: resetFrameContextImage(detailFrameUrl);
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
    invertImages,
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

  async function loadDetections(reset = false) {
    const client = getClient();
    if (!client || loading || (!reset && !hasMore)) return;
    loading = true;
    error = null;
    const offset = reset ? 0 : nextOffset;
    const serial = ++requestSerial;
    try {
      const page = await client.searchDetections(currentFilters(offset));
      if (serial !== requestSerial) return;
      detections = reset ? page : [...detections, ...withoutDuplicateDetections(page)];
      nextOffset = offset + page.length;
      hasMore = page.length >= pageSize;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
      await tick();
      maybeLoadMoreFromViewport();
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
      invertImages = typeof preferences.invertImages === 'boolean' ? preferences.invertImages : invertImages;
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

  function nullableNumberPreference(value: unknown, fallback: number | null): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function maybeLoadMore(event: Event) {
    const scroller = event.currentTarget as HTMLElement;
    const remaining = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (!loading && hasMore && remaining < 700) {
      void loadDetections(false);
    }
  }

  function maybeLoadMoreFromViewport() {
    if (!loadMoreSentinel || loading || !hasMore || typeof window === 'undefined') return;
    const rect = loadMoreSentinel.getBoundingClientRect();
    if (rect.top < window.innerHeight + 700) {
      void loadDetections(false);
    }
  }

  function scrollToTop() {
    tileScroller?.scrollTo({ top: 0, behavior: 'smooth' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function openRoiDetail(detection: DetectionSummary) {
    const serial = ++frameDetectionLoadSerial;
    selectedDetection = detection;
    selectedParentAsset = null;
    selectedParentFrame = null;
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
    void loadFrameDetectionBatches(detection, serial);
    try {
      const frameIndex = numberValue(detection.frame_index);
      const [asset, framesForParent] = await Promise.all([
        client.getAsset(detection.asset_id).catch(() => null),
        frameIndex === null
          ? Promise.resolve([])
          : client.listFrames(detection.asset_id, 1, frameIndex, frameIndex).catch(() => [])
      ]);
      if (serial !== frameDetectionLoadSerial) return;
      selectedParentAsset = asset;
      selectedParentFrame = framesForParent[0] ?? null;
    } catch (err) {
      detailError = err instanceof Error ? err.message : String(err);
    }
  }

  async function loadFrameDetectionBatches(detection: DetectionSummary, serial: number) {
    const client = getClient();
    if (!client || !detection.asset_id || !detection.frame_id) return;
    let offset = 0;
    try {
      while (serial === frameDetectionLoadSerial) {
        const page = await client.listDetections(
          detection.asset_id,
          detection.frame_id,
          frameDetectionBatchSize,
          offset
        );
        if (serial !== frameDetectionLoadSerial) return;
        const additions = withoutDuplicateFrameDetections(page);
        if (additions.length) frameDetections = [...frameDetections, ...additions];
        if (page.length < frameDetectionBatchSize || (offset > 0 && additions.length === 0)) break;
        offset += page.length;
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
    selectedDetection = null;
    selectedParentAsset = null;
    selectedParentFrame = null;
    frameDetections = [];
    frameDetectionsLoading = false;
    frameDetectionsComplete = false;
    detailError = null;
    detailFrameFailedUrl = '';
    frameImageNaturalWidth = 0;
    frameImageNaturalHeight = 0;
  }

  function withoutDuplicateDetections(page: DetectionSummary[]): DetectionSummary[] {
    const existing = new Set(detections.map((detection) => detection.id).filter(Boolean));
    return page.filter((detection) => !detection.id || !existing.has(detection.id));
  }

  function withoutDuplicateFrameDetections(page: DetectionSummary[]): DetectionSummary[] {
    const existing = new Set(frameDetections.map((detection) => detection.id).filter(Boolean));
    return page.filter((detection) => !detection.id || !existing.has(detection.id));
  }

  function imageUrl(detection: DetectionSummary): string {
    const client = getClient();
    return client && detection.id ? client.detectionImageUrl(detection.id, imageFormat) : '';
  }

  function bboxLabel(detection: DetectionSummary): string {
    const values = [detection.bbox_x, detection.bbox_y, detection.bbox_w, detection.bbox_h];
    if (values.some((value) => value === undefined || value === null || value === '')) return 'bbox unavailable';
    return `x=${values[0]}, y=${values[1]}, w=${values[2]}, h=${values[3]}`;
  }

  function cropImageStyle(detection: DetectionSummary, maxWidth = roiDisplayMaxWidth, maxHeight = roiDisplayMaxHeight): string {
    const cropW = numberValue(detection.crop_bbox_w);
    const cropH = numberValue(detection.crop_bbox_h);
    if (!cropW || !cropH) return '';
    const scale = roiDisplayScale(cropW, cropH, maxWidth, maxHeight);
    return [
      `width: ${Math.max(1, Math.round(cropW * scale))}px`,
      `aspect-ratio: ${cropW} / ${cropH}`
    ].join('; ');
  }

  function localBBoxStyle(detection: DetectionSummary): string {
    const bboxX = numberValue(detection.bbox_x);
    const bboxY = numberValue(detection.bbox_y);
    const bboxW = numberValue(detection.bbox_w);
    const bboxH = numberValue(detection.bbox_h);
    const cropX = numberValue(detection.crop_bbox_x);
    const cropY = numberValue(detection.crop_bbox_y);
    const cropW = numberValue(detection.crop_bbox_w);
    const cropH = numberValue(detection.crop_bbox_h);
    if (
      bboxX === null ||
      bboxY === null ||
      bboxW === null ||
      bboxH === null ||
      cropX === null ||
      cropY === null ||
      !cropW ||
      !cropH
    ) {
      return '';
    }
    const localX = bboxX - cropX;
    const localY = bboxY - cropY;
    return [
      `left: ${(localX / cropW) * 100}%`,
      `top: ${(localY / cropH) * 100}%`,
      `width: ${(bboxW / cropW) * 100}%`,
      `height: ${(bboxH / cropH) * 100}%`
    ].join('; ');
  }

  function hasLocalBBox(detection: DetectionSummary): boolean {
    return Boolean(localBBoxStyle(detection));
  }

  function numberValue(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function roiDisplayScale(cropW: number, cropH: number, maxWidth = roiDisplayMaxWidth, maxHeight = roiDisplayMaxHeight): number {
    return Math.min(1, maxWidth / cropW, maxHeight / cropH);
  }

  function scaleBarLength(
    detection: DetectionSummary,
    maxWidth = roiDisplayMaxWidth,
    maxHeight = roiDisplayMaxHeight
  ): number | null {
    const cropW = numberValue(detection.crop_bbox_w);
    const cropH = numberValue(detection.crop_bbox_h);
    if (!cropW || !cropH) return null;
    const scale = roiDisplayScale(cropW, cropH, maxWidth, maxHeight);
    return (
      scaleBarLengths.find((length) => length <= cropW * 0.9 && length * scale <= 110 && length * scale >= 28) ??
      scaleBarLengths.find((length) => length <= cropW * 0.9 && length * scale <= 140) ??
      scaleBarLengths.slice().reverse().find((length) => length <= cropW) ??
      null
    );
  }

  function scaleBarStyle(
    detection: DetectionSummary,
    maxWidth = roiDisplayMaxWidth,
    maxHeight = roiDisplayMaxHeight
  ): string {
    const cropW = numberValue(detection.crop_bbox_w);
    const cropH = numberValue(detection.crop_bbox_h);
    const length = scaleBarLength(detection, maxWidth, maxHeight);
    if (!cropW || !cropH || !length) return '';
    return `width: ${Math.max(10, Math.round(length * roiDisplayScale(cropW, cropH, maxWidth, maxHeight)))}px`;
  }

  function frameContextUrl(detection: DetectionSummary, mode: FrameDisplayMode): string {
    const client = getClient();
    if (!client || !detection.frame_id) return '';
    const kind = payloadKindForDisplay(mode);
    const base = {
      frame_id: detection.frame_id,
      format: 'jpg',
      scale: frameContextImageScale
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

  function setFrameImageNaturalSize(event: Event) {
    const image = event.currentTarget as HTMLImageElement;
    detailFrameFailedUrl = '';
    frameImageNaturalWidth = image.naturalWidth;
    frameImageNaturalHeight = image.naturalHeight;
  }

  function markDetailFrameUnavailable() {
    detailFrameFailedUrl = detailFrameUrl;
    frameImageNaturalWidth = 0;
    frameImageNaturalHeight = 0;
  }

  function fullFrameBBoxStyle(detection: DetectionSummary): string {
    const bboxX = numberValue(detection.bbox_x);
    const bboxY = numberValue(detection.bbox_y);
    const bboxW = numberValue(detection.bbox_w);
    const bboxH = numberValue(detection.bbox_h);
    if (bboxX === null || bboxY === null || bboxW === null || bboxH === null) return '';
    const dimensions = parentFrameDimensions();
    if (dimensions) {
      return [
        `left: ${(bboxX / dimensions.width) * 100}%`,
        `top: ${(bboxY / dimensions.height) * 100}%`,
        `width: ${(bboxW / dimensions.width) * 100}%`,
        `height: ${(bboxH / dimensions.height) * 100}%`
      ].join('; ');
    }
    return [
      `left: ${bboxX * frameContextImageScale}px`,
      `top: ${bboxY * frameContextImageScale}px`,
      `width: ${bboxW * frameContextImageScale}px`,
      `height: ${bboxH * frameContextImageScale}px`
    ].join('; ');
  }

  function fullFrameOverlayStyle(): string {
    return frameImageNaturalWidth && frameImageNaturalHeight ? 'width: 100%; height: 100%;' : '';
  }

  function isSelectedDetection(detection: DetectionSummary): boolean {
    return Boolean(selectedDetection?.id && detection.id === selectedDetection.id);
  }

  function parentFrameDimensions(): { width: number; height: number } | null {
    const width = numberValue(selectedParentFrame?.width);
    const height = numberValue(selectedParentFrame?.height);
    if (width && height) return { width, height };
    const shape = selectedParentFrame?.shape;
    if (Array.isArray(shape) && shape.length >= 2) {
      const shapeHeight = numberValue(shape[0]);
      const shapeWidth = numberValue(shape[1]);
      if (shapeWidth && shapeHeight) return { width: shapeWidth, height: shapeHeight };
    }
    if (frameImageNaturalWidth && frameImageNaturalHeight) {
      return {
        width: frameImageNaturalWidth / frameContextImageScale,
        height: frameImageNaturalHeight / frameContextImageScale
      };
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

  function parentFrameNumberForHref(): number | string | null {
    return selectedParentFrame?.frame_num ?? selectedParentFrame?.frame_index ?? selectedDetection?.frame_index ?? null;
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
</script>

<svelte:window on:scroll={maybeLoadMoreFromViewport} on:resize={maybeLoadMoreFromViewport} />

<div class="roi-browser-layout">
  <aside class="panel roi-filter-panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">ROI Browser</p>
        <h2>Filters</h2>
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

    <label class="check-row">
      <input type="checkbox" bind:checked={invertImages} />
      Invert grayscale ROI images
    </label>

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
            {#if detection.id}
              <button
                type="button"
                class="roi-tile"
                on:click={() => openRoiDetail(detection)}
              >
                <div class="roi-image-frame">
                  <div class="roi-image-wrap" style={cropImageStyle(detection)}>
                    <img
                      class:inverted-frame={invertImages}
                      src={imageUrl(detection)}
                      alt={`ROI ${detection.roi_index ?? ''}`}
                      loading="lazy"
                    />
                    {#if hasLocalBBox(detection)}
                      <div class="roi-local-bbox" style={localBBoxStyle(detection)} aria-hidden="true"></div>
                    {/if}
                  </div>
                  {#if scaleBarLength(detection)}
                    <div class="roi-scale-reference" aria-hidden="true">
                      <span class="roi-scale-bar" style={scaleBarStyle(detection)}></span>
                      <span>{scaleBarLength(detection)} px</span>
                    </div>
                  {/if}
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
              </button>
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
          <div class="roi-detail-image-wrap" style={cropImageStyle(selectedDetection, modalRoiDisplayMaxWidth, modalRoiDisplayMaxHeight)}>
            <img
              class:inverted-frame={invertImages}
              src={imageUrl(selectedDetection)}
              alt={`ROI ${selectedDetection.roi_index ?? ''}`}
            />
            {#if hasLocalBBox(selectedDetection)}
              <div class="roi-local-bbox" style={localBBoxStyle(selectedDetection)} aria-hidden="true"></div>
            {/if}
          </div>
          {#if scaleBarLength(selectedDetection, modalRoiDisplayMaxWidth, modalRoiDisplayMaxHeight)}
            <div class="roi-scale-reference detail-scale-reference" aria-hidden="true">
              <span class="roi-scale-bar" style={scaleBarStyle(selectedDetection, modalRoiDisplayMaxWidth, modalRoiDisplayMaxHeight)}></span>
              <span>{scaleBarLength(selectedDetection, modalRoiDisplayMaxWidth, modalRoiDisplayMaxHeight)} px</span>
            </div>
          {/if}
        </div>

        <div class="roi-detail-info">
          <h3>Detection</h3>
          <dl>
            <div>
              <dt>Detection ID</dt>
              <dd>{selectedDetection.id}</dd>
            </div>
            <div>
              <dt>Frame</dt>
              <dd>{selectedDetection.frame_index ?? selectedDetection.frame_id ?? 'unknown'}</dd>
            </div>
            <div>
              <dt>ROI index</dt>
              <dd>{selectedDetection.roi_index ?? 'unknown'}</dd>
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
              <dt>Source path</dt>
              <dd>{selectedParentAsset?.path ?? 'unknown'}</dd>
            </div>
            <div>
              <dt>Frame ID</dt>
              <dd>
                {#if selectedDetection.frame_id}
                  <a
                    class="detail-uuid-link"
                    href={roiBrowserHref(
                      {
                        asset_id: selectedDetection.asset_id,
                        frame_num: parentFrameNumberForHref(),
                        frame_id: parentFrameNumberForHref() === null ? selectedDetection.frame_id : null
                      },
                      $page.url
                    )}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {selectedDetection.frame_id}
                  </a>
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
            <span class="soft">{frameCaption(detailFrameDisplayMode)}</span>
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
              <div class="roi-frame-wrap">
                {#key detailFrameUrl}
                  <img
                    class:inverted-frame={detailFrameImageInverted}
                    src={detailFrameUrl}
                    alt="Frame with ROI bounding boxes"
                    on:load={setFrameImageNaturalSize}
                    on:error={markDetailFrameUnavailable}
                  />
                {/key}
                {#if frameImageNaturalWidth && frameImageNaturalHeight}
                  <div class="bbox-overlay" style={fullFrameOverlayStyle()} aria-hidden="true">
                    {#each frameDetections as detection}
                      {#if fullFrameBBoxStyle(detection)}
                        <div
                          class:roi-frame-selected={isSelectedDetection(detection)}
                          class:roi-frame-other={!isSelectedDetection(detection)}
                          style={fullFrameBBoxStyle(detection)}
                        ></div>
                      {/if}
                    {/each}
                  </div>
                {/if}
              </div>
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
