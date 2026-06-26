<script lang="ts">
  import { onMount } from 'svelte';
  import KonvaImageCanvas from '$lib/components/KonvaImageCanvas.svelte';
  import { imageInversionEnabled } from '$lib/stores/displayPreferences';
  import { getClient } from '$lib/stores/session';
  import type { CollectionSummary, FrameProcessingState } from '$lib/api/types';
  import { formatCount, formatDate, numericValue } from '$lib/utils/format';
  import type { ImageInfoSpec, ImageRenderSpec } from '$lib/utils/imageRenderSpec';

  type FrameRow = NonNullable<FrameProcessingState['frames']>[number];
  type FramePayloadKind = 'original' | 'preprocessed';

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
  let imageFormat = 'png';
  let nextOffset = 0;
  let hasMore = true;
  let loading = false;
  let error: string | null = null;
  let preferencesReady = false;
  let selectedFrame: FrameRow | null = null;
  let tileScroller: HTMLElement;
  let loadMoreSentinel: HTMLElement;

  const preferenceKey = 'pelagia-view:frame-browser:v1';
  const pageSize = 120;
  const tileDisplayMaxWidth = 250;
  const tileDisplayMaxHeight = 210;
  const modalDisplayMaxWidth = 900;
  const modalDisplayMaxHeight = 680;
  const tilePreviewMaxDimensionPx = 280;
  const modalPreviewMaxDimensionPx = 900;
  const scaleBarLengths = [1000, 500, 100, 50, 10];

  $: visibleCount = frames.length;
  $: summaryLabel = `${formatCount(visibleCount)} frame${visibleCount === 1 ? '' : 's'} loaded`;
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
    imageFormat
  };
  $: if (preferencesReady) persistPreferences(preferenceSnapshot);

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

  async function loadFrames(reset = false) {
    const client = getClient();
    if (!client || loading || (!reset && !hasMore)) return;
    loading = true;
    error = null;
    const offset = reset ? 0 : nextOffset;
    if (reset) {
      frames = [];
      selectedFrame = null;
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
    void loadFrames(true);
  }

  function maybeLoadMore() {
    if (!tileScroller || !loadMoreSentinel || loading || !hasMore) return;
    const scrollerBottom = tileScroller.scrollTop + tileScroller.clientHeight;
    if (loadMoreSentinel.offsetTop - scrollerBottom < 480) void loadFrames(false);
  }

  function scrollToTop() {
    tileScroller?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openFrameDetail(frame: FrameRow) {
    selectedFrame = frame;
  }

  function closeFrameDetail() {
    selectedFrame = null;
  }

  function frameImageUrl(frame: FrameRow, previewMaxDimension: number | null = tilePreviewMaxDimensionPx): string | null {
    const client = getClient();
    if (!client) return null;
    if (payloadKind === 'preprocessed' && !frame.has_preprocessed_payload) return null;
    const options = {
      frame_id: frame.frame_id,
      format: imageFormat,
      preview_max_dim: previewMaxDimension,
      cache_bust: cacheBustKey(frame)
    };
    return payloadKind === 'preprocessed' ? client.preprocessedFrameUrl(options) : client.originalFrameUrl(options);
  }

  function frameRenderSpec(
    frame: FrameRow,
    maxWidth: number,
    maxHeight: number,
    previewMaxDimension: number | null = tilePreviewMaxDimensionPx,
    exportControls: 'menu' | 'full' | 'none' = 'menu'
  ): ImageRenderSpec | null {
    const url = frameImageUrl(frame, previewMaxDimension);
    if (!url) return null;
    return {
      key: frameCanvasKey(frame, previewMaxDimension),
      image: {
        url,
        alt: frameAlt(frame),
        invert: payloadKind !== 'original' && $imageInversionEnabled
      },
      display: { maxWidth, maxHeight },
      scaleBar: { enabled: true, placement: 'inside', lengths: scaleBarLengths },
      toolbar: {
        exportControls,
        filename: frameDownloadFilename(frame, 'annotated'),
        originalUrl: url,
        originalFilename: frameDownloadFilename(frame),
        info: frameInfo(frame)
      }
    };
  }

  function frameCanvasKey(frame: FrameRow, previewMaxDimension: number | null = tilePreviewMaxDimensionPx): string {
    return [
      frame.frame_id,
      frame.frame_num ?? frame.frame_index ?? '',
      payloadKind,
      imageFormat,
      payloadKind !== 'original' && $imageInversionEnabled ? 'inverted' : 'normal',
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

  function frameAlt(frame: FrameRow): string {
    return `${payloadKind} frame ${frame.frame_num ?? frame.frame_index ?? frame.frame_id}`;
  }

  function frameDownloadFilename(frame: FrameRow, suffix: string = payloadKind): string {
    const base = (frame.asset_filename ?? frame.asset_id ?? 'frame').replace(/[^a-zA-Z0-9._-]+/g, '_');
    const frameNumber = frame.frame_num ?? frame.frame_index ?? 'unknown';
    return `${base}_frame-${frameNumber}_${suffix}.${imageFormat}`;
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

  function normalizedNumber(value: number | string | null): number | null {
    if (value === null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function persistPreferences(snapshot: typeof preferenceSnapshot) {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(preferenceKey, JSON.stringify(snapshot));
  }

  function restorePreferences() {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(preferenceKey);
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
      imageFormat = parsed.imageFormat === 'jpg' ? 'jpg' : 'png';
    } catch {
      localStorage.removeItem(preferenceKey);
    }
  }

  function normalizedStateFilter(value: string): string {
    const normalized = value.replaceAll('_', '-');
    if (normalized === 'needs-detection') return 'needs-detections';
    if (normalized === 'needs-preprocessing') return 'needs-preprocessed';
    return normalized;
  }
</script>

<div class="roi-browser-layout">
  <aside class="panel roi-filter-panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Filters</p>
        <h2>Frame Browser</h2>
      </div>
    </div>

    <div class="filter-group">
      <div class="section-heading">
        <p class="eyebrow">View</p>
        <strong>Frame image source</strong>
      </div>
      <div class="toggle-list">
        <button class:active={payloadKind === 'original'} type="button" on:click={() => (payloadKind = 'original')}>
          Raw
        </button>
        <button class:active={payloadKind === 'preprocessed'} type="button" on:click={() => (payloadKind = 'preprocessed')}>
          Preprocessed
        </button>
      </div>
      {#if payloadKind === 'preprocessed'}
        <p class="soft">Frames without a stored preprocessed payload are kept in the result set but cannot render this view.</p>
      {/if}
    </div>

    <label>
      Collection
      <select bind:value={selectedCollection}>
        <option value="">All collections</option>
        {#each collections as collection}
          <option value={collection.collection}>{collection.collection}</option>
        {/each}
      </select>
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

    <label>
      Preprocessing
      <select bind:value={preprocessingState}>
        <option value="">Any</option>
        <option value="has-preprocessed">Has preprocessed payload</option>
        <option value="fully-preprocessed">Fully preprocessed</option>
        <option value="partially-preprocessed">Partially preprocessed</option>
        <option value="needs-preprocessed">Needs preprocessing</option>
      </select>
    </label>

    <label>
      Candidate detection
      <select bind:value={detectionState}>
        <option value="">Any</option>
        <option value="has-detections">Has detections</option>
        <option value="fully-detected">Fully detected</option>
        <option value="partially-detected">Partially detected</option>
        <option value="needs-detections">Needs detection</option>
      </select>
    </label>

    <label>
      ROI refinement
      <select bind:value={refinementState}>
        <option value="">Any</option>
        <option value="has-refinement">Has refinement</option>
        <option value="fully-refined">Fully refined</option>
        <option value="partially-refined">Partially refined</option>
        <option value="needs-refinement">Needs refinement</option>
        <option value="no-detections">No detections</option>
      </select>
    </label>

    <label>
      Image format
      <select bind:value={imageFormat}>
        <option value="png">png</option>
        <option value="jpg">jpg</option>
      </select>
    </label>

    <div class="button-row">
      <button type="button" on:click={() => loadFrames(true)}>Apply</button>
      <button class="ghost" type="button" on:click={resetFilters}>Reset</button>
    </div>
  </aside>

  <section class="panel roi-results-panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Frames</p>
        <h2>Raw and Preprocessed Tiles</h2>
      </div>
      <span class="soft">{summaryLabel}</span>
    </div>

    {#if error}<p class="form-error">{error}</p>{/if}

    <div class="roi-tile-scroll" bind:this={tileScroller} on:scroll={maybeLoadMore}>
      {#if frames.length}
        <div class="roi-tile-grid frame-tile-grid">
          {#each frames as frame}
            {@const spec = frameRenderSpec(frame, tileDisplayMaxWidth, tileDisplayMaxHeight, tilePreviewMaxDimensionPx, 'menu')}
            <div class="roi-tile frame-tile">
              <div class="roi-image-frame">
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
  {@const detailSpec = frameRenderSpec(selectedFrame, modalDisplayMaxWidth, modalDisplayMaxHeight, modalPreviewMaxDimensionPx, 'full')}
  <div class="modal-backdrop">
    <div class="roi-detail-modal frame-detail-modal" role="dialog" aria-modal="true" aria-label="Frame details">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Frame detail</p>
          <h2>{selectedFrame.asset_filename ?? selectedFrame.asset_id ?? 'Unknown asset'}</h2>
        </div>
        <button class="ghost" type="button" on:click={closeFrameDetail}>Close</button>
      </div>

      <div class="frame-detail-layout">
        <div class="frame-detail-image">
          {#if detailSpec}
            {#key frameCanvasKey(selectedFrame, modalPreviewMaxDimensionPx)}
              <KonvaImageCanvas spec={detailSpec} mode="viewer" />
            {/key}
          {:else}
            <div class="frame-unavailable">
              <strong>No preprocessed image</strong>
              <span>Run preprocessing to populate this frame payload.</span>
            </div>
          {/if}
        </div>

        <dl class="frame-detail-list">
          <div>
            <dt>Frame</dt>
            <dd>{frameNumberLabel(selectedFrame)}</dd>
          </div>
          <div>
            <dt>Dimensions</dt>
            <dd>{dimensionsLabel(selectedFrame)}</dd>
          </div>
          <div>
            <dt>Captured</dt>
            <dd>{formatDate(selectedFrame.captured_at)}</dd>
          </div>
          <div>
            <dt>Detections</dt>
            <dd>{countsLabel(selectedFrame)}</dd>
          </div>
          <div>
            <dt>Frame ID</dt>
            <dd>{selectedFrame.frame_id}</dd>
          </div>
        </dl>
      </div>
    </div>
  </div>
{/if}
