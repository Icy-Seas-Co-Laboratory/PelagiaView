<script lang="ts">
  import { onMount } from 'svelte';
  import { getClient } from '$lib/stores/session';
  import type { DetectionSummary, FrameSummary, RawAsset, SystemConfigResponse } from '$lib/api/types';
  import {
    booleanDefault,
    nullableNumberDefault,
    numberDefault,
    processingSection
  } from '$lib/utils/configDefaults';

  let assets: RawAsset[] = [];
  let frames: FrameSummary[] = [];
  let detections: DetectionSummary[] = [];
  let selectedAssetId = '';
  let selectedAsset: RawAsset | null = null;
  let selectedFrameNum = 1;
  let frameCount = 0;
  let hasLivePreview = false;
  let imageNaturalWidth = 0;
  let imageNaturalHeight = 0;
  let threshold: number | null = null;
  type FrameDisplayMode = 'original' | 'preprocessed' | 'preprocessed-inverted';
  let frameDisplayMode: FrameDisplayMode = 'original';
  let preprocessedReloadKey = 0;
  let backgroundCorrection = false;
  let backgroundPercentile = 50;
  let minPerimeter = 100;
  let maxPerimeter: number | null = null;
  let padding = 100;
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
  const cropPreviewWidth = 220;
  const cropPreviewHeight = 160;
  const frameImageScale = 0.5;
  let lastFrameImageKey = '';
  let failedImageUrl = '';

  $: selectedFrame = findFrameByNumber(selectedFrameNum);
  $: framePayloadKind = payloadKindForDisplay(frameDisplayMode);
  $: imageInverted = frameDisplayMode === 'preprocessed-inverted';
  $: imageUrl =
    selectedAssetId && selectedFrameNum > 0
      ? framePreviewUrl(frameDisplayMode, preprocessedReloadKey)
      : '';
  $: imageUnavailable = Boolean(imageUrl && failedImageUrl === imageUrl);
  $: boxes = detections.map(toCropBox).filter((box): box is BBox => box !== null);
  $: targetBoxes = detections.map(toTargetBox).filter((box): box is BBox => box !== null);
  $: previewOptionsKey = optionsKey(
    frameDisplayMode,
    threshold,
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
    padding
  );
  $: resetLivePreviewForImageOptions(selectedAssetId, selectedFrameNum, previewOptionsKey);

  onMount(async () => {
    const client = getClient();
    if (!client) return;
    try {
      const config = await client.systemConfig().catch(() => null);
      applyConfigDefaults(config);
      assets = await client.listAssets('video');
      selectedAssetId = assets[0]?.id ?? '';
      if (selectedAssetId) await loadFrames();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  });

  function applyConfigDefaults(config: SystemConfigResponse | null) {
    const segmentation = processingSection(config, 'segmentation');
    const flatfield = processingSection(config, 'flatfield');
    const preprocessing = processingSection(config, 'preprocessing');

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

    minPerimeter = numberDefault(segmentation, 'min_perimeter', minPerimeter);
    maxPerimeter = nullableNumberDefault(segmentation, 'max_perimeter', maxPerimeter);
    padding = numberDefault(segmentation, 'padding', padding);
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
    await loadDetections();
  }

  async function loadDetections() {
    const client = getClient();
    if (!client || !selectedAssetId) return;
    hasLivePreview = false;
    const frame = await ensureSelectedFrame();
    if (!frame?.id) {
      detections = [];
      return;
    }
    detections = await client.listDetections(selectedAssetId, frame.id);
  }

  function options() {
    return {
      threshold,
      frame_payload_kind: framePayloadKind,
      apply_preprocessing: framePayloadKind === 'original',
      ...preprocessingOptions(),
      min_perimeter: minPerimeter,
      max_perimeter: maxPerimeter,
      padding
    };
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

  function payloadKindForDisplay(mode: FrameDisplayMode): 'original' | 'preprocessed' {
    return mode === 'original' ? 'original' : 'preprocessed';
  }

  function frameCaption(mode: FrameDisplayMode): string {
    if (mode === 'preprocessed-inverted') return 'Preprocessed frame, inverted';
    if (mode === 'preprocessed') return 'Preprocessed frame';
    return 'Original frame';
  }

  function framePreviewUrl(mode: FrameDisplayMode, reloadKey: number): string {
    const client = getClient();
    if (!client || !selectedAssetId || selectedFrameNum < 1) return '';
    const kind = payloadKindForDisplay(mode);
    const base = {
      asset_id: selectedAssetId,
      frame_num: selectedFrameNum,
      format: 'jpg',
      scale: frameImageScale,
      cache_bust: kind === 'preprocessed' && reloadKey ? reloadKey : undefined
    };
    return kind === 'preprocessed' ? client.preprocessedFrameUrl(base) : client.originalFrameUrl(base);
  }

  function optionsKey(
    mode: FrameDisplayMode,
    thresholdValue: number | null,
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
    paddingValue: number
  ): string {
    return JSON.stringify({
      frame_display_mode: mode,
      frame_payload_kind: payloadKindForDisplay(mode),
      threshold: thresholdValue,
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
      padding: paddingValue
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

  function setImageNaturalSize(event: Event) {
    const image = event.currentTarget as HTMLImageElement;
    failedImageUrl = '';
    imageNaturalWidth = image.naturalWidth;
    imageNaturalHeight = image.naturalHeight;
  }

  function markImageUnavailable() {
    failedImageUrl = imageUrl;
    imageNaturalWidth = 0;
    imageNaturalHeight = 0;
    hasLivePreview = false;
  }

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
      tupleFromValues(detection.bbox_x, detection.bbox_y, detection.bbox_w, detection.bbox_h) ??
      tupleFromArray(detection.metadata?.object_bbox) ??
      tupleFromArray(detection.bbox)
    );
  }

  function readCropTuple(detection: DetectionSummary): [number, number, number, number] | null {
    return (
      tupleFromValues(
        detection.crop_bbox_x,
        detection.crop_bbox_y,
        detection.crop_bbox_w,
        detection.crop_bbox_h
      ) ?? tupleFromArray(detection.metadata?.roi_bbox)
    );
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
    const scaled = scaleBox(box);
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

  function boxOverlayStyle(box: BBox): string {
    const scaled = scaleBox(box);
    return [
      `left: ${scaled.x}px`,
      `top: ${scaled.y}px`,
      `width: ${scaled.w}px`,
      `height: ${scaled.h}px`
    ].join('; ');
  }

  function scaleBox(box: BBox): BBox {
    return {
      ...box,
      x: box.x * frameImageScale,
      y: box.y * frameImageScale,
      w: box.w * frameImageScale,
      h: box.h * frameImageScale
    };
  }

  function overlaySizeStyle(): string {
    return imageNaturalWidth && imageNaturalHeight
      ? `width: ${imageNaturalWidth}px; height: ${imageNaturalHeight}px;`
      : '';
  }
</script>

<div class="segmentation-layout">
  <section class="panel image-panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Frame data</p>
        <h2>Live segmentation preview</h2>
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

    <div class="frame-type-toggle" aria-label="Frame preview source">
      <button
        type="button"
        class:active={frameDisplayMode === 'original'}
        on:click={() => (frameDisplayMode = 'original')}
      >
        Original
      </button>
      <button
        type="button"
        class:active={frameDisplayMode === 'preprocessed'}
        on:click={() => (frameDisplayMode = 'preprocessed')}
      >
        Preprocessed
      </button>
      <button
        type="button"
        class:active={frameDisplayMode === 'preprocessed-inverted'}
        on:click={() => (frameDisplayMode = 'preprocessed-inverted')}
      >
        Preprocessed inverted
      </button>
    </div>

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
            <div class="annotated-image">
              {#key imageUrl}
                <img
                  class:inverted-frame={imageInverted}
                  src={imageUrl}
                  alt={hasLivePreview ? 'Selected frame with live segmentation bounding boxes' : 'Selected frame'}
                  on:load={setImageNaturalSize}
                  on:error={markImageUnavailable}
                />
              {/key}
              {#if hasLivePreview && imageNaturalWidth && imageNaturalHeight}
                <div class="bbox-overlay" style={overlaySizeStyle()} aria-hidden="true">
                  {#each boxes as box}
                    <div class="bbox-hotspot" style={boxOverlayStyle(box)}>
                      <div class="bbox-hover-preview image-hover-preview">
                        <img class:inverted-frame={imageInverted} src={imageUrl} alt="" style={cropImageStyle(box)} />
                      </div>
                    </div>
                  {/each}
                  {#each targetBoxes as box}
                    <div class="bbox-target" style={boxOverlayStyle(box)}></div>
                  {/each}
                </div>
              {/if}
            </div>
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
        <h2>Segmentation controls</h2>
      </div>
    </div>

    <div class="form-section">
      <div class="section-heading">
        <p class="eyebrow">Background + flatfield</p>
        <strong>Correction</strong>
      </div>

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
    </div>

    <div class="form-section">
      <div class="section-heading">
        <p class="eyebrow">Crop + mask + invert</p>
        <strong>Candidate image</strong>
      </div>

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
    </div>

    <div class="form-section">
      <div class="section-heading">
        <p class="eyebrow">Threshold</p>
        <strong>Candidate ROIs</strong>
      </div>

      <label>
        Threshold
        <input type="number" bind:value={threshold} placeholder="auto" />
      </label>
      <label>
        Minimum perimeter
        <input type="range" min="0" max="1000" step="10" bind:value={minPerimeter} />
        <span class="range-value">{minPerimeter}</span>
      </label>
      <label>
        Maximum perimeter
        <input type="number" bind:value={maxPerimeter} placeholder="none" />
      </label>
    </div>

    <div class="form-section">
      <div class="section-heading">
        <p class="eyebrow">Refine</p>
        <strong>Refined ROI storage</strong>
      </div>

      <label>
        Padding
        <input type="range" min="0" max="300" step="5" bind:value={padding} />
        <span class="range-value">{padding}</span>
      </label>
    </div>

    <div class="button-row">
      <button type="button" on:click={segmentNow} disabled={frameCount < 1}>Preview live</button>
      <button class="ghost" type="button" on:click={saveSegmentation} disabled={frameCount < 1}>Save frame</button>
      <button class="ghost" type="button" on:click={queueSegmentation} disabled={!selectedAssetId || frameCount < 1}>Queue asset</button>
    </div>

    <p class="callout">Live preview uses <code>GET /live/segmentation</code>. The preprocessing action uses <code>POST /frame/preprocess</code> and reloads <code>/frame/preprocessed</code>.</p>
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
