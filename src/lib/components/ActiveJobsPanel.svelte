<script lang="ts">
  import { onMount } from 'svelte';
  import { getClient } from '$lib/stores/session';
  import type { Job } from '$lib/api/types';
  import { formatCount, formatDate, formatPercent, numericValue, statusTone } from '$lib/utils/format';

  export let title = 'Now running';
  export let poll = true;
  export let limit = 12;

  let jobs: Job[] = [];
  let loading = true;
  let error: string | null = null;

  $: sortedJobs = [...jobs].sort((a, b) => statusRank(a) - statusRank(b) || dateValue(b.updated_at ?? b.created_at) - dateValue(a.updated_at ?? a.created_at));

  onMount(() => {
    let cancelled = false;
    async function load() {
      const client = getClient();
      if (!client) return;
      loading = true;
      error = null;
      try {
        const nextJobs = await client.listJobs({
          status: ['leased', 'queued', 'paused'],
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

  function statusRank(job: Job): number {
    const status = String(job.status ?? '').toLowerCase();
    if (status === 'leased') return 0;
    if (status === 'queued') return 1;
    if (status === 'paused') return 2;
    return 3;
  }

  function dateValue(value: string | undefined): number {
    if (!value) return 0;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function progressPercent(job: Job): number | null {
    return numericValue(job.progress?.percent);
  }

  function progressText(job: Job): string {
    const completed = numericValue(job.progress?.completed);
    const total = numericValue(job.progress?.total);
    const unit = job.progress?.unit ?? 'units';
    if (completed !== null && total !== null && total > 0) {
      return `${formatCount(completed)} / ${formatCount(total)} ${unit}`;
    }
    return job.progress?.message ?? 'Progress unavailable';
  }
</script>

<section class="panel active-jobs-panel">
  <div class="panel-heading">
    <div>
      <p class="eyebrow">Live queue</p>
      <h2>{title}</h2>
    </div>
    {#if loading}<span class="soft">Refreshing</span>{/if}
  </div>

  {#if error}
    <p class="form-error">{error}</p>
  {:else if sortedJobs.length}
    <div class="active-job-list">
      {#each sortedJobs as job}
        <article class="active-job-row">
          <div class="active-job-main">
            <span class="status-dot {statusTone(job.status)}"></span>
            <div>
              <strong>{job.stage ?? 'unknown stage'}</strong>
              <span>{job.summary ?? job.id}</span>
            </div>
          </div>
          <div class="active-job-progress">
            <div class="stage-progress-track">
              <span style={`width: ${Math.max(0, Math.min(100, progressPercent(job) ?? 0))}%`}></span>
            </div>
            <span>{formatPercent(job.progress?.percent)} · {progressText(job)}</span>
          </div>
          <div class="active-job-meta">
            <span>{job.status ?? 'unknown'}</span>
            <span>{formatDate(job.updated_at ?? job.created_at)}</span>
          </div>
        </article>
      {/each}
    </div>
  {:else}
    <p class="empty">No active, queued, or paused jobs right now.</p>
  {/if}
</section>
