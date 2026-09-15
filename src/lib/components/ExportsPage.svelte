<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import ExportBundleModal from '$lib/components/ExportBundleModal.svelte';
  import { authenticatedFetch } from '$lib/api/client';
  import { getClient, session } from '$lib/stores/session';
  import type { ExportArtifact, LogEntry } from '$lib/api/types';
  import { formatDate, formatRelativeTime, formatPercent, statusTone } from '$lib/utils/format';
  import { downloadBlob } from '$lib/utils/zipDownload';

  let exports: ExportArtifact[] = [];
  let loading = true;
  let refreshing = false;
  let modalOpen = false;
  let error: string | null = null;
  let downloading = new Set<string>();
  let expandedLogIds = new Set<string>();
  let logsByJobId: Record<string, { loading: boolean; entries: LogEntry[]; error: string | null }> = {};
  let refreshTimer: number | null = null;
  let requestInFlight = false;

  onMount(() => {
    const cached = readCachedExports();
    if (cached) exports = cached;
    if (cached) loading = false;
    void load(Boolean(cached));
    refreshTimer = window.setInterval(() => void load(true), 4000);
  });

  onDestroy(() => {
    if (refreshTimer !== null) window.clearInterval(refreshTimer);
  });

  async function load(silent = false) {
    if (requestInFlight) return;
    const client = getClient();
    if (!client) {
      error = 'Connect to a Pelagia server to view exports.';
      loading = false;
      return;
    }
    requestInFlight = true;
    if (silent) refreshing = true;
    else loading = true;
    try {
      exports = await client.listExports();
      cacheExports(exports);
      error = null;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
      refreshing = false;
      requestInFlight = false;
    }
  }

  function cacheKey() {
    const project = $session.project?.id ?? $session.project?.project_key;
    return project ? `pelagia.exports.${project}` : null;
  }

  function readCachedExports(): ExportArtifact[] | null {
    const key = cacheKey();
    if (!key) return null;
    try {
      const value = JSON.parse(sessionStorage.getItem(key) ?? '');
      return Array.isArray(value) ? value : null;
    } catch {
      return null;
    }
  }

  function cacheExports(value: ExportArtifact[]) {
    const key = cacheKey();
    if (!key) return;
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // The network response remains the source of truth if browser storage is unavailable.
    }
  }

  async function toggleTaskLogs(artifact: ExportArtifact) {
    const jobId = artifact.job_id;
    if (!jobId) return;
    const next = new Set(expandedLogIds);
    if (next.has(artifact.id)) {
      next.delete(artifact.id);
      expandedLogIds = next;
      return;
    }
    next.add(artifact.id);
    expandedLogIds = next;
    if (logsByJobId[jobId]) return;
    logsByJobId = { ...logsByJobId, [jobId]: { loading: true, entries: [], error: null } };
    const client = getClient();
    if (!client) return;
    try {
      const entries = await client.listLogs({ job_id: jobId, limit: 100 });
      logsByJobId = { ...logsByJobId, [jobId]: { loading: false, entries, error: null } };
    } catch (cause) {
      logsByJobId = {
        ...logsByJobId,
        [jobId]: { loading: false, entries: [], error: cause instanceof Error ? cause.message : String(cause) }
      };
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
  {#if loading}
    <section class="export-skeletons" aria-busy="true" aria-label="Loading export history">
      {#each Array(3) as _}
        <article class="card export-row export-skeleton" aria-hidden="true">
          <div class="export-main"><i class="skeleton-line title"></i><i class="skeleton-line"></i><i class="skeleton-line short"></i></div>
          <div class="export-action"><i class="skeleton-line action"></i></div>
        </article>
      {/each}
      <p class="loading-label">Loading export history…</p>
    </section>
  {:else if !exports.length}<section class="empty card"><h2>No exports yet</h2><p>Create a project export here, or start from Curation or Telemetry to carry over your current scope.</p></section>
  {:else}<section class="export-list" aria-label="Export history">{#each exports as artifact (artifact.id)}<article class="card export-row"><div class="export-main"><div class="export-title"><strong>{(artifact.request?.products ?? []).map(productLabel).join(' + ') || 'Export bundle'}</strong><span class={`status ${statusTone(artifact.status)}`}>{statusLabel(artifact.status)}</span></div><p>{scopeSummary(artifact)}</p><small>Created {formatDate(artifact.created_at)} · {formatRelativeTime(artifact.updated_at ?? artifact.created_at)} · <code>{artifact.id}</code></small>{#if artifact.error_message}<p class="failure">{artifact.error_message}</p>{/if}{#if artifact.job_id}<div class="task-log"><button class="log-toggle" type="button" aria-expanded={expandedLogIds.has(artifact.id)} on:click={() => toggleTaskLogs(artifact)}>{expandedLogIds.has(artifact.id) ? 'Hide task logs' : 'Show task logs'}</button>{#if expandedLogIds.has(artifact.id)}{@const logs = logsByJobId[artifact.job_id]}{@const visibleLogs = logs?.entries.filter((entry) => entry.level?.toLowerCase() !== 'debug') ?? []}<div class="task-log-entries" aria-label="Export task logs">{#if logs?.loading}<span>Loading task logs…</span>{:else if logs?.error}<span class="failure">{logs.error}</span>{:else if visibleLogs.length}{#each visibleLogs as entry (entry.id)}<p><time>{formatDate(entry.created_at)}</time><b>{entry.level ?? 'info'}</b><span>{entry.message ?? entry.event_type ?? 'Log entry'}</span></p>{/each}{:else}<span>No non-debug task logs recorded.</span>{/if}</div>{/if}</div>{/if}</div><div class="export-action">{#if artifact.download_url}<button type="button" disabled={downloading.has(artifact.id)} on:click={() => download(artifact)}>{downloading.has(artifact.id) ? 'Downloading…' : 'Download ZIP'}</button>{:else}{#if progressValue(artifact) !== null}<div class="progress-detail"><span>Estimated progress · {progress(artifact)}</span><div class="progress-track" role="progressbar" aria-label="Estimated export progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progressValue(artifact) ?? undefined}><i style={`width:${progressValue(artifact)}%`}></i></div><small>{artifact.job?.progress?.message ?? 'Preparing bundle'} · {eta(artifact) ? `Estimated ETA ${eta(artifact)}` : 'Calculating estimated ETA'}</small></div>{:else}<span>{artifact.job?.progress?.message ?? 'Waiting for an export worker…'}</span>{/if}{/if}</div></article>{/each}</section>{/if}
  {#if refreshing}<small class="refreshing">Refreshing…</small>{/if}
</div>

{#if modalOpen}<ExportBundleModal on:close={() => modalOpen = false} on:created={() => { modalOpen = false; void load(); }} />{/if}

<style>
  .exports-page{max-width:1050px;margin:0 auto;padding:1.5rem clamp(1rem,3vw,2.5rem) 3rem}.page-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;margin-bottom:1.25rem}h1,h2,p{margin:0}h1{margin-top:.15rem}.page-heading p:last-child{max-width:46rem;margin-top:.35rem;color:var(--muted,#66777b)}.estimate-note{font-size:.8rem}.eyebrow{color:var(--accent,#197997);font-size:.7rem;font-weight:750;letter-spacing:.09em;text-transform:uppercase}button{border:0;border-radius:7px;padding:.6rem .85rem;background:var(--accent,#197997);color:#fff;cursor:pointer;font:inherit;font-weight:750;white-space:nowrap}button:disabled{cursor:not-allowed;opacity:.5}.card{border:1px solid var(--border,#d9e1e3);border-radius:11px;background:var(--surface,#fff);box-shadow:0 .25rem 1rem rgb(20 40 45 / 4%)}.empty{padding:2rem;color:var(--muted,#66777b);text-align:center}.empty h2{color:inherit;margin-bottom:.4rem}.export-list,.export-skeletons{display:grid;gap:.65rem}.export-row{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem}.export-main{display:grid;min-width:0;gap:.35rem}.export-title{display:flex;flex-wrap:wrap;align-items:center;gap:.55rem}.export-main>p{color:var(--muted,#66777b);font-size:.85rem}.export-main small{color:var(--muted,#66777b);font-size:.72rem}.export-main code{font-size:.68rem}.status{border-radius:999px;padding:.22rem .5rem;font-size:.68rem;font-weight:750;text-transform:capitalize}.status.good{background:color-mix(in srgb,#23865e 14%,transparent);color:#23865e}.status.warn{background:color-mix(in srgb,#bf8515 16%,transparent);color:#885d0b}.status.bad{background:color-mix(in srgb,#b44343 12%,transparent);color:#9d3333}.status.idle{background:var(--surface-soft,#eef3f3);color:var(--muted,#66777b)}.export-action{display:grid;justify-items:end;min-width:12rem;color:var(--muted,#66777b);font-size:.8rem}.progress-detail{display:grid;gap:.35rem;width:100%}.progress-detail>span{font-weight:750;text-align:right}.progress-detail small{font-size:.7rem;text-align:right}.progress-track{height:.42rem;overflow:hidden;border-radius:99px;background:color-mix(in srgb,var(--border,#d9e1e3) 75%,transparent)}.progress-track i{display:block;height:100%;border-radius:inherit;background:var(--accent,#197997);transition:width .3s ease}.task-log{display:grid;justify-items:start;gap:.35rem;margin-top:.25rem}.log-toggle{padding:.28rem .5rem;background:var(--surface-soft,#eef3f3);color:var(--accent,#197997);font-size:.72rem}.task-log-entries{display:grid;gap:.25rem;width:min(100%,42rem);padding:.55rem;border-left:2px solid var(--accent,#197997);background:var(--surface-soft,#eef3f3);font-size:.72rem}.task-log-entries p{display:grid;grid-template-columns:auto auto 1fr;gap:.45rem;align-items:baseline}.task-log-entries time{color:var(--muted,#66777b);white-space:nowrap}.task-log-entries b{text-transform:uppercase;font-size:.65rem}.export-skeleton{pointer-events:none}.skeleton-line{display:block;height:.75rem;width:min(22rem,58vw);border-radius:99px;background:linear-gradient(100deg,var(--surface-soft,#eef3f3) 30%,color-mix(in srgb,var(--surface-soft,#eef3f3) 45%,#fff) 50%,var(--surface-soft,#eef3f3) 70%);background-size:200% 100%;animation:loading-shimmer 1.25s ease-in-out infinite}.skeleton-line.title{height:1rem;width:min(16rem,45vw)}.skeleton-line.short{width:min(10rem,35vw)}.skeleton-line.action{width:8rem;height:2.25rem}.loading-label{color:var(--muted,#66777b);font-size:.8rem;text-align:center}@keyframes loading-shimmer{to{background-position:-200% 0}}@media(prefers-reduced-motion:reduce){.skeleton-line{animation:none}}.failure,.notice.error{padding:.55rem;border-radius:6px;background:color-mix(in srgb,#b44343 10%,transparent);color:#9d3333}.notice{margin:0 0 1rem}.refreshing{display:block;margin-top:.65rem;color:var(--muted,#66777b)}@media(max-width:620px){.page-heading,.export-row{align-items:flex-start;flex-direction:column}.export-action{justify-items:start}.progress-detail>span,.progress-detail small{text-align:left}.task-log-entries p{grid-template-columns:1fr}}
</style>
