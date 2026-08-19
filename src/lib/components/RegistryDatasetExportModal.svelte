<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { getClient } from '$lib/stores/session';
  import { formatBytes } from '$lib/utils/format';
  import type {
    CurationOptions, Job, RegistryDatasetPreview, RegistryDatasetSelection
  } from '$lib/api/types';

  export let options: CurationOptions;

  const dispatch = createEventDispatcher<{ close: void }>();
  let name = 'Pelagia Registry dataset';
  let path = options.registry_export?.default_path ?? 'data/import/pelagia-registry-dataset.sqlite';
  let annotationState: RegistryDatasetSelection['annotation_state'] = 'all';
  let reviewState: RegistryDatasetSelection['review_state'] = 'all';
  let evidenceState: RegistryDatasetSelection['evidence_state'] = 'all';
  let minArea: number | undefined;
  let maxArea: number | undefined;
  let subsampleRatio = 1;
  let selectedAssets = new Set<string>();
  let preview: RegistryDatasetPreview | null = null;
  let previewing = false;
  let exporting = false;
  let error: string | null = null;
  let job: Job | null = null;
  let previewTimer: number | null = null;
  let pollTimer: number | null = null;
  let initialized = false;

  $: selection = buildSelection();
  $: previewKey = JSON.stringify({ selection, subsampleRatio });
  $: if (initialized && previewKey) schedulePreview();

  queueMicrotask(() => {
    initialized = true;
    void refreshPreview();
  });

  onDestroy(() => {
    if (previewTimer !== null) window.clearTimeout(previewTimer);
    if (pollTimer !== null) window.clearInterval(pollTimer);
  });

  function buildSelection(): RegistryDatasetSelection {
    return {
      asset_ids: [...selectedAssets],
      annotation_state: annotationState,
      review_state: reviewState,
      evidence_state: evidenceState,
      min_area: finiteOrNull(minArea),
      max_area: finiteOrNull(maxArea)
    };
  }

  function finiteOrNull(value: unknown): number | null {
    const number = Number(value);
    return value === '' || value === undefined || !Number.isFinite(number) ? null : number;
  }

  function schedulePreview() {
    if (previewTimer !== null) window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => void refreshPreview(), 300);
  }

  async function refreshPreview() {
    const client = getClient();
    if (!client) return;
    previewing = true;
    error = null;
    try {
      preview = await client.previewRegistryDataset({ selection, subsample_ratio: subsampleRatio });
    } catch (cause) {
      preview = null;
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      previewing = false;
    }
  }

  function toggleAsset(id: string) {
    const next = new Set(selectedAssets);
    next.has(id) ? next.delete(id) : next.add(id);
    selectedAssets = next;
  }

  async function exportDataset() {
    const client = getClient();
    if (!client || exporting || !preview?.selected_count) return;
    exporting = true;
    error = null;
    try {
      const response = await client.generateRegistryDataset({
        name: name.trim(), path: path.trim(), selection, subsample_ratio: subsampleRatio
      });
      job = response.job;
      pollTimer = window.setInterval(() => void pollJob(), 1200);
      await pollJob();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      exporting = false;
    }
  }

  async function pollJob() {
    const client = getClient();
    if (!client || !job) return;
    try {
      job = await client.getJob(job.id);
      if (!['queued', 'leased', 'working', 'paused'].includes(job.status ?? '')) {
        exporting = false;
        if (pollTimer !== null) window.clearInterval(pollTimer);
        pollTimer = null;
        if (job.status !== 'succeeded') error = job.error_message || 'Dataset generation failed.';
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function progressPercent(): number {
    const value = Number(job?.progress?.percent);
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  }
</script>

<div class="modal-backdrop export-backdrop" role="presentation" on:click={() => !exporting && dispatch('close')}>
  <div class="export-dialog" role="dialog" aria-modal="true" aria-labelledby="registry-export-title" tabindex="-1" on:click|stopPropagation on:keydown|stopPropagation>
    <header>
      <div><p class="eyebrow">Portable curation handoff</p><h2 id="registry-export-title">Create Registry dataset</h2><p>Filter Pelagia ROIs, write a portable SQLite revision, and load it into Registry.</p></div>
      <button class="close" aria-label="Close" disabled={exporting} on:click={() => dispatch('close')}>×</button>
    </header>

    <div class="dialog-body">
      <section class="filters">
        <h3>1. Select ROIs</h3>
        <div class="form-grid">
          <label>Annotation state<select bind:value={annotationState}><option value="all">All ROIs</option><option value="labeled">Labeled</option><option value="unlabeled">Unlabeled</option></select></label>
          <label>Evidence state<select bind:value={evidenceState}><option value="all">All states</option><option value="available">Evidence available</option><option value="missing">No evidence</option><option value="disagreement">Evidence disagreement</option></select></label>
          <label>Review state<select bind:value={reviewState}><option value="all">All states</option><option value="unreviewed">Unreviewed</option><option value="verified">Verified</option><option value="needs_review">Needs review</option><option value="rejected">Rejected</option></select></label>
          <div class="area-range"><label>Minimum area (px²)<input type="number" min="0" bind:value={minArea} placeholder="No minimum" /></label><label>Maximum area (px²)<input type="number" min="0" bind:value={maxArea} placeholder="No maximum" /></label></div>
        </div>
        <details>
          <summary>Assets {selectedAssets.size ? `(${selectedAssets.size} selected)` : '(all)'}</summary>
          <div class="asset-actions"><button on:click={() => (selectedAssets = new Set())}>All assets</button><button on:click={() => (selectedAssets = new Set((options.assets ?? []).map((asset) => asset.id)))}>Select listed</button></div>
          <div class="asset-list">{#each options.assets ?? [] as asset (asset.id)}<label><input type="checkbox" checked={selectedAssets.has(asset.id)} on:change={() => toggleAsset(asset.id)} /><span>{asset.filename}</span><small>{asset.kind ?? ''}</small></label>{/each}</div>
        </details>
        <label class="ratio"><span>Subsample ratio <strong>1:{subsampleRatio}</strong></span><input type="range" min="1" max="1000" step="1" bind:value={subsampleRatio} /><small>Includes every {subsampleRatio.toLocaleString()}th ROI in stable asset/frame/ROI order.</small></label>
      </section>

      <aside class="preview" aria-live="polite">
        <h3>Live preview</h3>
        {#if previewing && !preview}<p>Calculating…</p>{:else if preview}<div class="preview-count"><strong>{preview.selected_count.toLocaleString()}</strong><span>ROIs selected</span></div><dl><dt>Before subsampling</dt><dd>{preview.matching_count.toLocaleString()}</dd><dt>ROI payloads</dt><dd>{formatBytes(preview.payload_bytes)}</dd><dt>Estimated SQLite</dt><dd>{formatBytes(preview.estimated_sqlite_bytes)}</dd></dl>{/if}
        {#if previewing && preview}<small>Updating preview…</small>{/if}
      </aside>

      <section class="destination">
        <h3>2. Save and load</h3>
        <label>Dataset name<input bind:value={name} maxlength="160" /></label>
        <label>SQLite path<input bind:value={path} /><small>Must be within a configured Registry root.</small></label>
      </section>

      {#if job}<section class="job" class:failed={job.status === 'failed' || job.status === 'dead_lettered'}><div><strong>{job.status === 'succeeded' ? 'Dataset ready in Registry' : job.progress?.message || 'Preparing dataset…'}</strong><span>{progressPercent().toFixed(0)}%</span></div><i><b style={`width:${progressPercent()}%`}></b></i>{#if job.status === 'succeeded'}<button on:click={() => goto('/registry/')}>Open Registry</button>{/if}</section>{/if}
      {#if error}<p class="error">{error}</p>{/if}
    </div>

    <footer><button class="secondary" disabled={exporting} on:click={() => dispatch('close')}>Close</button><button disabled={exporting || !name.trim() || !path.trim() || !preview?.selected_count} on:click={exportDataset}>{exporting ? 'Generating…' : 'Export dataset'}</button></footer>
  </div>
</div>

<style>
  .export-backdrop{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:24px;background:rgba(8,17,20,.68);backdrop-filter:blur(3px)}
  .export-dialog{width:min(940px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;background:var(--surface,#fff);border:1px solid var(--border,#ccd9dc);border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.3)}
  header,footer{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:18px 22px;border-bottom:1px solid var(--border,#d9e1e3)}footer{align-items:center;justify-content:flex-end;border:0;border-top:1px solid var(--border,#d9e1e3)}
  header h2,header p,.eyebrow{margin:0}.eyebrow{color:var(--accent,#197997);font-size:.7rem;text-transform:uppercase;letter-spacing:.09em}header>div>p:last-child{margin-top:5px;color:var(--muted,#66777b)}.close{font-size:1.5rem;background:transparent;color:inherit}
  .dialog-body{padding:20px 22px;display:grid;grid-template-columns:minmax(0,1fr) 240px;gap:18px}.filters,.destination,.preview,.job{border:1px solid var(--border,#d9e1e3);border-radius:10px;padding:15px}.filters{grid-column:1}.preview{grid-column:2;grid-row:1}.destination,.job,.error{grid-column:1/-1}h3{margin:0 0 12px;font-size:.95rem}
  .form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}label{display:grid;gap:5px;font-size:.78rem;font-weight:600}input,select{width:100%;box-sizing:border-box}.area-range{display:grid;grid-template-columns:1fr 1fr;gap:8px}.ratio{margin-top:16px}.ratio>span{display:flex;justify-content:space-between}.ratio small,.destination small,.preview small{color:var(--muted,#66777b);font-weight:400}
  details{margin-top:14px}summary{cursor:pointer;font-weight:650}.asset-actions{display:flex;gap:7px;margin:9px 0}.asset-list{max-height:170px;overflow:auto;border:1px solid var(--border,#d9e1e3);border-radius:7px}.asset-list label{display:grid;grid-template-columns:auto 1fr auto;align-items:center;padding:7px 9px;border-bottom:1px solid var(--border,#e3e8e9);font-weight:400}.asset-list input{width:auto}.asset-list small{color:var(--muted,#66777b)}
  .preview-count{display:grid;margin:18px 0}.preview-count strong{font-size:2rem;color:var(--accent,#197997)}.preview-count span{color:var(--muted,#66777b)}dl{display:grid;grid-template-columns:1fr auto;gap:8px;margin:0;font-size:.8rem}dt{color:var(--muted,#66777b)}dd{margin:0;font-weight:650}
  .destination{display:grid;grid-template-columns:1fr 2fr;gap:10px}.destination h3{grid-column:1/-1}.job div{display:flex;justify-content:space-between}.job i{display:block;height:7px;margin:9px 0;background:var(--border,#d9e1e3);border-radius:5px;overflow:hidden}.job b{display:block;height:100%;background:var(--accent,#197997)}.job.failed b{background:#b44343}.error{margin:0;color:#b44343}.secondary{background:transparent;color:inherit;border:1px solid var(--border,#ccd9dc)}
  @media(max-width:720px){.dialog-body{grid-template-columns:1fr}.filters,.preview{grid-column:1;grid-row:auto}.form-grid,.destination{grid-template-columns:1fr}.destination h3{grid-column:1}.area-range{grid-template-columns:1fr}}
</style>
