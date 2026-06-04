<script lang="ts">
  import { onMount } from 'svelte';
  import { getClient } from '$lib/stores/session';
  import type { DetectionSummary, FrameSummary, RawAsset } from '$lib/api/types';

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
  let minPerimeter = 100;
  let maxPerimeter: number | null = null;
  let padding = 100;
  let loading = true;
  let message: string | null = null;
  let error: string | null = null;
  const cropPreviewWidth = 220;
  const cropPreviewHeight = 160;

  $: selectedFrame = findFrameByNumber(selectedFrameNum);
  $: imageUrl = selectedAssetId && selectedFrameNum > 0 ? getClient()?.frameImageUrl(selectedAssetId, selectedFrameNum) : '';
  $: boxes = detections.map(normalizeBox).filter((box): box is BBox => box !== null);

  onMount(async () => {
    const client = getClient();
    if (!client) return;
    try {
      assets = await client.listAssets('video');
      selectedAssetId = assets[0]?.id ?? '';
      if (selectedAssetId) await loadFrames();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  });

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
      min_perimeter: minPerimeter,
      max_perimeter: maxPerimeter,
      padding
    };
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
    imageNaturalWidth = image.naturalWidth;
    imageNaturalHeight = image.naturalHeight;
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

  function normalizeBox(detection: DetectionSummary, index: number): BBox | null {
    const direct = tupleFromValues(detection.bbox_x, detection.bbox_y, detection.bbox_w, detection.bbox_h);
    const arrayBox = tupleFromArray(detection.bbox);
    const metadata = detection.metadata ?? {};
    const objectBox = tupleFromArray(metadata.object_bbox);
    const roiBox = tupleFromArray(metadata.roi_bbox);
    const cropBox = tupleFromValues(
      detection.crop_bbox_x,
      detection.crop_bbox_y,
      detection.crop_bbox_w,
      detection.crop_bbox_h
    );
    const box = direct ?? arrayBox ?? objectBox ?? roiBox ?? cropBox;
    if (!box || box[2] <= 0 || box[3] <= 0) return null;
    return {
      index: Number(detection.roi_index ?? index + 1),
      x: box[0],
      y: box[1],
      w: box[2],
      h: box[3],
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
    const scale = Math.min(
      12,
      Math.max(1.5, Math.min(cropPreviewWidth / Math.max(box.w, 1), cropPreviewHeight / Math.max(box.h, 1)))
    );
    const scaledWidth = imageNaturalWidth * scale;
    const scaledHeight = imageNaturalHeight * scale;
    const centeredX = cropPreviewWidth / 2 - (box.x + box.w / 2) * scale;
    const centeredY = cropPreviewHeight / 2 - (box.y + box.h / 2) * scale;
    const translateX = Math.min(0, Math.max(cropPreviewWidth - scaledWidth, centeredX));
    const translateY = Math.min(0, Math.max(cropPreviewHeight - scaledHeight, centeredY));
    return `width: ${scaledWidth}px; height: ${scaledHeight}px; transform: translate(${translateX}px, ${translateY}px);`;
  }

  function boxOverlayStyle(box: BBox): string {
    if (!imageNaturalWidth || !imageNaturalHeight) return '';
    return [
      `left: ${(box.x / imageNaturalWidth) * 100}%`,
      `top: ${(box.y / imageNaturalHeight) * 100}%`,
      `width: ${(box.w / imageNaturalWidth) * 100}%`,
      `height: ${(box.h / imageNaturalHeight) * 100}%`
    ].join('; ');
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

    <div class="frame-stage comparison-stage">
      {#if imageUrl}
        <figure>
          <figcaption>Source frame</figcaption>
          <img src={imageUrl} alt="Selected source frame from Pelagia asset" on:load={setImageNaturalSize} />
        </figure>
        <figure>
          <figcaption>Live segmentation</figcaption>
          {#if hasLivePreview}
            <div class="annotated-image">
              <img src={imageUrl} alt="Selected frame with live segmentation bounding boxes" />
              {#if imageNaturalWidth && imageNaturalHeight}
                <div class="bbox-overlay" aria-hidden="true">
                  {#each boxes as box}
                    <div class="bbox-hotspot" style={boxOverlayStyle(box)}>
                      <div class="bbox-hover-preview image-hover-preview">
                        <img src={imageUrl} alt="" style={cropImageStyle(box)} />
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {:else}
            <div class="preview-placeholder">Run live preview</div>
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
    <label>
      Padding
      <input type="range" min="0" max="300" step="5" bind:value={padding} />
      <span class="range-value">{padding}</span>
    </label>

    <div class="button-row">
      <button type="button" on:click={segmentNow} disabled={frameCount < 1}>Preview live</button>
      <button class="ghost" type="button" on:click={saveSegmentation} disabled={frameCount < 1}>Save frame</button>
      <button class="ghost" type="button" on:click={queueSegmentation} disabled={!selectedAssetId || frameCount < 1}>Queue asset</button>
    </div>

    <p class="callout">Live preview uses <code>GET /live/segment</code> and overlays returned bounding boxes on the framedata image without persisting detections.</p>
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
          {#if imageUrl && imageNaturalWidth && imageNaturalHeight}
            <div class="bbox-hover-preview" aria-hidden="true">
              <img src={imageUrl} alt="" style={cropImageStyle(box)} />
            </div>
          {/if}
        </li>
      {/each}
    </ol>
  {:else}
    <p class="empty">{detections.length ? 'Detections were returned, but no bbox fields could be parsed.' : 'No bounding boxes for the current frame.'}</p>
  {/if}
</section>
