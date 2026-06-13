<script lang="ts">
  import { onMount } from 'svelte';
  import { getClient } from '$lib/stores/session';
  import type { Job, WorkerSession } from '$lib/api/types';
  import { formatDate, formatRelativeTime, statusTone } from '$lib/utils/format';

  export let workers: WorkerSession[] = [];
  export let poll = true;
  export let limit = 15;

  let jobs: Job[] = [];
  let loading = true;
  let error: string | null = null;

  $: staleWorkers = workers.filter(isWorkerStale);
  $: hasAttention = jobs.length > 0 || staleWorkers.length > 0;

  onMount(() => {
    let cancelled = false;
    async function load() {
      const client = getClient();
      if (!client) return;
      loading = true;
      error = null;
      try {
        const nextJobs = await client.listJobs({
          status: ['failed', 'dead_lettered', 'cancelled', 'paused'],
          include_progress: true,
          limit,
          sort: 'updated_at',
          direction: 'desc'
        });
        if (!cancelled) jobs = nextJobs;
      } catch (err) {
        if (!cancelled) error = err instanceof Error ? err.message : String(err);
      } finally {
        if (!cancelled) loading = false;
      }
    }
    void load();
    if (!poll) return;
    const timer = window.setInterval(load, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  });

  function workerLabel(worker: WorkerSession): string {
    return worker.worker_id ?? worker.id ?? 'unknown';
  }

  function isWorkerStale(worker: WorkerSession): boolean {
    const heartbeat = worker.last_heartbeat_at ?? worker.last_heartbeat;
    if (!heartbeat) return false;
    const parsed = Date.parse(heartbeat);
    if (!Number.isFinite(parsed)) return false;
    return Date.now() - parsed > 60_000;
  }
</script>

<section class="panel attention-panel">
  <div class="panel-heading">
    <div>
      <p class="eyebrow">Attention</p>
      <h2>Needs review</h2>
    </div>
    {#if loading}<span class="soft">Refreshing</span>{/if}
  </div>

  {#if error}
    <p class="form-error">{error}</p>
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
  {:else}
    <p class="empty">Nothing needs attention right now.</p>
  {/if}
</section>
