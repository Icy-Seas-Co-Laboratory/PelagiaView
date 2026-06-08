<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { getClient } from '$lib/stores/session';
  import type { DetectionFilters, DetectionSummary, RawAsset, SystemConfigResponse } from '$lib/api/types';
  import { processingSection, stringDefault } from '$lib/utils/configDefaults';
  import { formatBytes } from '$lib/utils/format';

  let assets: RawAsset[] = [];
  let detections: DetectionSummary[] = [];
  let selectedAssetId = '';
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
  let requestSerial = 0;
  let preferencesReady = false;
  let tileScroller: HTMLElement;
  let loadMoreSentinel: HTMLElement;
  const roiBrowserPreferenceKey = 'pelagia-view:roi-browser:v1';
  const pageSize = 120;

  $: visibleCount = detections.filter((detection) => detection.id).length;
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

  function withoutDuplicateDetections(page: DetectionSummary[]): DetectionSummary[] {
    const existing = new Set(detections.map((detection) => detection.id).filter(Boolean));
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

  function cropImageStyle(detection: DetectionSummary): string {
    const cropW = numberValue(detection.crop_bbox_w);
    const cropH = numberValue(detection.crop_bbox_h);
    if (!cropW || !cropH) return '';
    return `width: ${cropW}px; height: ${cropH}px;`;
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
      `left: ${localX}px`,
      `top: ${localY}px`,
      `width: ${bboxW}px`,
      `height: ${bboxH}px`
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
              <article class="roi-tile">
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
              </article>
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
