<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import ExportBundleModal from '$lib/components/ExportBundleModal.svelte';
  import { authenticatedFetch } from '$lib/api/client';
  import { getClient } from '$lib/stores/session';
  import type { ExportArtifact } from '$lib/api/types';
  import { formatDate, formatRelativeTime, formatPercent, statusTone } from '$lib/utils/format';
  import { downloadBlob } from '$lib/utils/zipDownload';

  let exports: ExportArtifact[] = [];
  let loading = true;
  let refreshing = false;
  let modalOpen = false;
  let error: string | null = null;
  let downloading = new Set<string>();
  let refreshTimer: number | null = null;

  onMount(() => {
    void load();
    refreshTimer = window.setInterval(() => void load(true), 4000);
  });

  onDestroy(() => {
    if (refreshTimer !== null) window.clearInterval(refreshTimer);
  });

  async function load(silent = false) {
    const client = getClient();
    if (!client) {
      error = 'Connect to a Pelagia server to view exports.';
      loading = false;
      return;
    }
    if (silent) refreshing = true;
    else loading = true;
    try {
      exports = await client.listExports();
      error = null;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
      refreshing = false;
    }
  }

  function productLabel(value: string) {
    return ({ raw_roi_statistics: 'ROI measurements', binned_roi_statistics: 'ROI size-bin summary', roi_evidence: 'ROI images & metadata', telemetry: 'Telemetry archive' } as Record<string, string>)[value] ?? value;
  }

  function statusLabel(value?: string | null) {
    return String(value ?? 'queued').replace(/_/g, ' ');
  }

  function progress(value: ExportArtifact) {
    const percent = Number(value.job?.progress?.percent);
    return Number.isFinite(percent) ? formatPercent(percent) : null;
  }

  function progressValue(value: ExportArtifact) {
    const percent = Number(value.job?.progress?.percent);
    return Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null;
  }

  function eta(value: ExportArtifact) {
    const total = Number(value.job?.progress?.total);
    const completed = Number(value.job?.progress?.completed);
    const rate = Number(value.job?.progress?.rates?.units_per_second);
    if (!Number.isFinite(total) || !Number.isFinite(completed) || !Number.isFinite(rate) || rate <= 0 || total <= completed) return null;
    return formatDuration((total - completed) / rate);
  }

  function formatDuration(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 1) return 'under a minute';
    const minutes = Math.ceil(seconds / 60);
    if (minutes < 60) return `about ${minutes}m`;
    return `about ${Math.ceil(minutes / 60)}h`;
  }

  async function download(artifact: ExportArtifact) {
    const client = getClient();
    if (!client || !artifact.download_url || downloading.has(artifact.id)) return;
    downloading = new Set([...downloading, artifact.id]);
    error = null;
    try {
      const response = await authenticatedFetch(client.resolveApiUrl(artifact.download_url));
      if (!response.ok) throw new Error(`Download failed (${response.status}).`);
      downloadBlob(await response.blob(), `pelagia-export-${artifact.id}.zip`);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      const next = new Set(downloading);
      next.delete(artifact.id);
      downloading = next;
    }
  }

  function scopeSummary(artifact: ExportArtifact) {
    const request = artifact.request;
    if (!request) return 'Project-scoped export.';
    const parts: string[] = [];
    if (request.asset_ids?.length) parts.push(`${request.asset_ids.length} asset${request.asset_ids.length === 1 ? '' : 's'}`);
    if (request.run_ids?.length) parts.push(`${request.run_ids.length} run${request.run_ids.length === 1 ? '' : 's'}`);
    if (request.telemetry_source_ids?.length) parts.push(`${request.telemetry_source_ids.length} telemetry source${request.telemetry_source_ids.length === 1 ? '' : 's'}`);
    if (Object.keys(request.filters ?? {}).length) parts.push('filtered ROI scope');
    return parts.length ? parts.join(' · ') : 'All data in the active project.';
  }
</script>

<div class="exports-page">
  <header class="page-heading"><div><p class="eyebrow">Project deliverables</p><h1>Exports</h1><p>Create and retrieve reproducible bundles. Every finished ZIP includes a manifest, checksums, README, and data dictionary.</p><p class="estimate-note">In-progress progress and ETAs are estimates from the frozen export scope; they update while a worker prepares the bundle.</p></div><button type="button" on:click={() => modalOpen = true}>Create export</button></header>

  {#if error}<p class="notice error" role="alert">{error}</p>{/if}
  {#if loading}<p class="empty">Loading exports…</p>
  {:else if !exports.length}<section class="empty card"><h2>No exports yet</h2><p>Create a project export here, or start from Curation or Telemetry to carry over your current scope.</p></section>
  {:else}<section class="export-list" aria-label="Export history">{#each exports as artifact (artifact.id)}<article class="card export-row"><div class="export-main"><div class="export-title"><strong>{(artifact.request?.products ?? []).map(productLabel).join(' + ') || 'Export bundle'}</strong><span class={`status ${statusTone(artifact.status)}`}>{statusLabel(artifact.status)}</span></div><p>{scopeSummary(artifact)}</p><small>Created {formatDate(artifact.created_at)} · {formatRelativeTime(artifact.updated_at ?? artifact.created_at)} · <code>{artifact.id}</code></small>{#if artifact.error_message}<p class="failure">{artifact.error_message}</p>{/if}</div><div class="export-action">{#if artifact.download_url}<button type="button" disabled={downloading.has(artifact.id)} on:click={() => download(artifact)}>{downloading.has(artifact.id) ? 'Downloading…' : 'Download ZIP'}</button>{:else}{#if progressValue(artifact) !== null}<div class="progress-detail"><span>Estimated progress · {progress(artifact)}</span><div class="progress-track" role="progressbar" aria-label="Estimated export progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progressValue(artifact) ?? undefined}><i style={`width:${progressValue(artifact)}%`}></i></div><small>{artifact.job?.progress?.message ?? 'Preparing bundle'} · {eta(artifact) ? `Estimated ETA ${eta(artifact)}` : 'Calculating estimated ETA'}</small></div>{:else}<span>{artifact.job?.progress?.message ?? 'Waiting for an export worker…'}</span>{/if}{/if}</div></article>{/each}</section>{/if}
  {#if refreshing}<small class="refreshing">Refreshing…</small>{/if}
</div>

{#if modalOpen}<ExportBundleModal on:close={() => modalOpen = false} on:created={() => { modalOpen = false; void load(); }} />{/if}

<style>
  .exports-page{max-width:1050px;margin:0 auto;padding:1.5rem clamp(1rem,3vw,2.5rem) 3rem}.page-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;margin-bottom:1.25rem}h1,h2,p{margin:0}h1{margin-top:.15rem}.page-heading p:last-child{max-width:46rem;margin-top:.35rem;color:var(--muted,#66777b)}.estimate-note{font-size:.8rem}.eyebrow{color:var(--accent,#197997);font-size:.7rem;font-weight:750;letter-spacing:.09em;text-transform:uppercase}button{border:0;border-radius:7px;padding:.6rem .85rem;background:var(--accent,#197997);color:#fff;cursor:pointer;font:inherit;font-weight:750;white-space:nowrap}button:disabled{cursor:not-allowed;opacity:.5}.card{border:1px solid var(--border,#d9e1e3);border-radius:11px;background:var(--surface,#fff);box-shadow:0 .25rem 1rem rgb(20 40 45 / 4%)}.empty{padding:2rem;color:var(--muted,#66777b);text-align:center}.empty h2{color:inherit;margin-bottom:.4rem}.export-list{display:grid;gap:.65rem}.export-row{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem}.export-main{display:grid;min-width:0;gap:.35rem}.export-title{display:flex;flex-wrap:wrap;align-items:center;gap:.55rem}.export-main>p{color:var(--muted,#66777b);font-size:.85rem}.export-main small{color:var(--muted,#66777b);font-size:.72rem}.export-main code{font-size:.68rem}.status{border-radius:999px;padding:.22rem .5rem;font-size:.68rem;font-weight:750;text-transform:capitalize}.status.good{background:color-mix(in srgb,#23865e 14%,transparent);color:#23865e}.status.warn{background:color-mix(in srgb,#bf8515 16%,transparent);color:#885d0b}.status.bad{background:color-mix(in srgb,#b44343 12%,transparent);color:#9d3333}.status.idle{background:var(--surface-soft,#eef3f3);color:var(--muted,#66777b)}.export-action{display:grid;justify-items:end;min-width:12rem;color:var(--muted,#66777b);font-size:.8rem}.progress-detail{display:grid;gap:.35rem;width:100%}.progress-detail>span{font-weight:750;text-align:right}.progress-detail small{font-size:.7rem;text-align:right}.progress-track{height:.42rem;overflow:hidden;border-radius:99px;background:color-mix(in srgb,var(--border,#d9e1e3) 75%,transparent)}.progress-track i{display:block;height:100%;border-radius:inherit;background:var(--accent,#197997);transition:width .3s ease}.failure,.notice.error{padding:.55rem;border-radius:6px;background:color-mix(in srgb,#b44343 10%,transparent);color:#9d3333}.notice{margin:0 0 1rem}.refreshing{display:block;margin-top:.65rem;color:var(--muted,#66777b)}@media(max-width:620px){.page-heading,.export-row{align-items:flex-start;flex-direction:column}.export-action{justify-items:start}.progress-detail>span,.progress-detail small{text-align:left}}
</style>
