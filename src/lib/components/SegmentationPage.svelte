<script lang="ts">
  import { onMount } from 'svelte';
  import { getClient } from '$lib/stores/session';
  import type { DetectionSummary, FrameSummary, RawAsset } from '$lib/api/types';

  let assets: RawAsset[] = [];
  let frames: FrameSummary[] = [];
  let detections: DetectionSummary[] = [];
  let selectedAssetId = '';
  let selectedFrameIndex = 0;
  let threshold: number | null = null;
  let minPerimeter = 100;
  let maxPerimeter: number | null = null;
  let padding = 100;
  let roiEncoding: 'zstd' | 'png' | 'raw' | 'auto' = 'zstd';
  let zstdMinBytes = 1024;
  let loading = true;
  let message: string | null = null;
  let error: string | null = null;

  $: selectedFrame = frames[selectedFrameIndex];
  $: frameNum = selectedFrame?.frame_num ?? 0;
  $: imageUrl = selectedAssetId && selectedFrame ? getClient()?.frameImageUrl(selectedAssetId, frameNum) : '';

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
    frames = await client.listFrames(selectedAssetId);
    selectedFrameIndex = 0;
    detections = [];
    await loadDetections();
  }

  async function loadDetections() {
    const client = getClient();
    if (!client || !selectedAssetId || !selectedFrame?.id) return;
    detections = await client.listDetections(selectedAssetId, selectedFrame.id);
  }

  function options() {
    return {
      threshold,
      min_perimeter: minPerimeter,
      max_perimeter: maxPerimeter,
      padding,
      roi_encoding: roiEncoding,
      zstd_min_bytes: zstdMinBytes
    };
  }

  async function segmentNow() {
    const client = getClient();
    if (!client || !selectedFrame?.id) return;
    message = null;
    error = null;
    try {
      const result = await client.liveSegmentFrame(selectedFrame.id, options(), false);
      detections = result.detections;
      message = `Previewed frame ${frameNum}; ${result.detection_count} ROI${result.detection_count === 1 ? '' : 's'} detected.`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function saveSegmentation() {
    const client = getClient();
    if (!client || !selectedFrame?.id) return;
    message = null;
    error = null;
    try {
      const result = await client.segmentFrame(selectedFrame.id, options());
      detections = result.detections;
      message = `Saved segmentation for frame ${frameNum}; ${result.detection_count} ROI${result.detection_count === 1 ? '' : 's'} stored.`;
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
        start_frame: frames[0]?.frame_num,
        end_frame: frames[frames.length - 1]?.frame_num,
        ...options()
      });
      message = `Queued segmentation job ${response.job.id}.`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
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
          min="0"
          max={Math.max(frames.length - 1, 0)}
          bind:value={selectedFrameIndex}
          on:change={loadDetections}
        />
      </label>
      <span class="frame-readout">{frames.length ? `${frameNum} / ${frames[frames.length - 1]?.frame_num ?? frameNum}` : 'No frames'}</span>
    </div>

    <div class="frame-stage">
      {#if imageUrl}
        <img src={imageUrl} alt="Selected frame from Pelagia asset" />
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
    <label>
      ROI encoding
      <select bind:value={roiEncoding}>
        <option value="zstd">zstd</option>
        <option value="png">png</option>
        <option value="raw">raw</option>
        <option value="auto">auto</option>
      </select>
    </label>
    <label>
      Zstd minimum bytes
      <input type="number" min="0" step="128" bind:value={zstdMinBytes} />
    </label>

    <div class="button-row">
      <button type="button" on:click={segmentNow} disabled={!selectedFrame}>Preview live</button>
      <button class="ghost" type="button" on:click={saveSegmentation} disabled={!selectedFrame}>Save frame</button>
      <button class="ghost" type="button" on:click={queueSegmentation} disabled={!selectedAssetId}>Queue asset</button>
    </div>

    <p class="callout">Live preview uses <code>POST /live/segment</code> and does not persist detections unless you save the frame or queue an asset job.</p>
    {#if message}<p class="success">{message}</p>{/if}
    {#if error}<p class="form-error">{error}</p>{/if}
  </section>
</div>
