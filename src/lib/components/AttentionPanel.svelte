<script lang="ts">
  import { queueStatus } from '$lib/stores/queueStatus';
  import type { Job, WorkerSession } from '$lib/api/types';
  import { formatDate, formatRelativeTime, statusTone } from '$lib/utils/format';

  export let workers: WorkerSession[] = [];
  export let limit = 15;
  export let clearing = false;
  export let onClearReview: (() => Promise<void> | void) | null = null;

  const status = queueStatus();
  $: jobs = [...($status.snapshot?.recent_failures ?? []), ...($status.snapshot?.jobs.items ?? []).filter((job) => job.status === 'paused')]
    .filter((job, index, rows) => rows.findIndex((row) => row.id === job.id) === index).slice(0, limit);
  $: loading = $status.loading || $status.refreshing;
  $: error = $status.error;
  $: failureCount = $status.snapshot?.recent_failures.length ?? 0;
  $: failuresTruncated = Boolean($status.snapshot?.jobs.truncated) || failureCount >= limit;
  let localClearing = false;
  const staleWorkerThresholdMs = 5 * 60 * 1000;

  $: staleWorkers = workers.filter(isWorkerStale);
  $: hasAttention = jobs.length > 0 || staleWorkers.length > 0;
  $: isClearing = clearing || localClearing;

  async function clearReview() {
    if (!onClearReview || isClearing || jobs.length <= 0) return;
    localClearing = true;
    error = null;
    try {
      await onClearReview();
      await status.refresh(true);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      localClearing = false;
    }
  }


  function workerLabel(worker: WorkerSession): string {
    return worker.worker_id ?? worker.id ?? 'unknown';
  }

  function isWorkerStale(worker: WorkerSession): boolean {
    const heartbeat = worker.last_heartbeat_at ?? worker.last_heartbeat;
    if (!heartbeat) return false;
    const parsed = Date.parse(heartbeat);
    if (!Number.isFinite(parsed)) return false;
    return Date.now() - parsed > staleWorkerThresholdMs;
  }
</script>

<section class="panel attention-panel">
  <div class="panel-heading">
    <div>
      <p class="eyebrow">Attention</p>
      <h2>Needs review</h2>
    </div>
    <div class="panel-heading-actions">
      {#if loading}<span class="soft">Refreshing</span>{/if}
      {#if onClearReview}
        <button class="ghost danger compact-action" type="button" on:click={clearReview} disabled={isClearing || jobs.length <= 0}>
          {isClearing ? 'Clearing' : 'Clear'}
        </button>
      {/if}
    </div>
  </div>

  {#if error}
    <p class="form-error">{error}</p>
  {:else if $status.stale}
    <p class="soft">Showing the last snapshot; status is stale.</p>
  {:else if hasAttention}
    <div class="attention-list">
      {#each jobs as job}
        <article class="attention-item">
          <span class="status-dot {statusTone(job.status)}"></span>
          <div>
            <strong>{job.stage ?? 'unknown stage'} · {job.status ?? 'unknown'}</strong>
            <span>{job.error_message ?? job.control_reason ?? job.summary ?? job.id}</span>
            <small>{formatDate(job.updated_at ?? job.created_at)}</small>
          </div>
        </article>
      {/each}
      {#each staleWorkers as worker}
        <article class="attention-item">
          <span class="status-dot warn"></span>
          <div>
            <strong>Stale worker heartbeat</strong>
            <span>{workerLabel(worker)} last checked in {formatRelativeTime(worker.last_heartbeat_at ?? worker.last_heartbeat)}</span>
            <small>{worker.status ?? 'unknown status'}</small>
          </div>
        </article>
      {/each}
    </div>
    {#if failuresTruncated}<p class="soft">The attention list is bounded; open Status for the full queue.</p>{/if}
  {:else}
    <p class="empty">Nothing needs attention right now.</p>
  {/if}
</section>
