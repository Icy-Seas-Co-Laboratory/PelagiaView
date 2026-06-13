<script lang="ts">
  import { onMount } from 'svelte';
  import JobStatusTable from '$lib/components/JobStatusTable.svelte';
  import { getClient } from '$lib/stores/session';
  import type { Job, JobAggregateSummary, JobsSummaryResponse } from '$lib/api/types';
  import { formatCount, numericValue } from '$lib/utils/format';
  import { countJobs, filterJobs, jobStageAliases, type JobStageKey, type JobStatusCounts } from '$lib/utils/jobStatus';

  export let title = 'Queue status';
  export let eyebrow = 'Tasks';
  export let stage: JobStageKey | null = null;
  export let stages: string[] | null = null;
  export let jobIds: string[] = [];
  export let jobs: Job[] | null = null;
  export let mode: 'compact' | 'detailed' = 'compact';
  export let poll = true;
  export let limit = 100;

  let polledJobs: Job[] = [];
  let summary: JobsSummaryResponse | null = null;
  let loading = false;
  let error: string | null = null;

  const canonicalStages: Record<JobStageKey, string> = {
    ingestion: 'extract_frames',
    preprocessing: 'preprocess_frames',
    segmentation: 'segment',
    roi_refinement: 'roi_refinement'
  };

  $: stageAliases = stages ?? (stage ? jobStageAliases[stage] : null);
  $: summaryStage = stage && !stages ? canonicalStages[stage] : null;
  $: sourceJobs = jobs ?? summary?.recent_jobs ?? polledJobs;
  $: visibleJobs = filterJobs(sourceJobs, { stages: stageAliases, jobIds });
  $: counts = summary ? aggregateCounts(summary.total) : countJobs(visibleJobs);
  $: recentJobs = [...visibleJobs].sort(compareJobUpdated).slice(0, mode === 'compact' ? 5 : visibleJobs.length);

  onMount(() => {
    if (jobs || !poll) return;
    let cancelled = false;
    async function load() {
      const client = getClient();
      if (!client) return;
      loading = true;
      error = null;
      try {
        if (summaryStage && jobIds.length === 0) {
          const nextSummary = await client.jobsSummary({
            stage: summaryStage,
            include_recent: true,
            recent_limit: limit
          });
          if (!cancelled) summary = nextSummary;
        } else {
          const nextJobs = await client.listJobs(limit);
          if (!cancelled) polledJobs = nextJobs;
        }
      } catch (err) {
        if (!cancelled) error = err instanceof Error ? err.message : String(err);
      } finally {
        if (!cancelled) loading = false;
      }
    }
    void load();
    const timer = window.setInterval(load, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  });

  function compareJobUpdated(a: Job, b: Job): number {
    return dateValue(b.updated_at ?? b.created_at) - dateValue(a.updated_at ?? a.created_at);
  }

  function dateValue(value: string | undefined): number {
    if (!value) return 0;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function replaceJobs(nextJobs: Job[]) {
    if (jobs) jobs = nextJobs;
    else {
      summary = null;
      polledJobs = nextJobs;
    }
  }

  function aggregateCounts(row: JobAggregateSummary | null | undefined): JobStatusCounts {
    const failed =
      (numericValue(row?.failed) ?? 0) +
      (numericValue(row?.cancelled) ?? 0) +
      (numericValue(row?.dead_lettered) ?? 0);
    const queued = numericValue(row?.queued) ?? 0;
    const running = numericValue(row?.leased) ?? 0;
    const succeeded = numericValue(row?.succeeded) ?? 0;
    const paused = numericValue(row?.paused) ?? 0;
    return {
      total: numericValue(row?.job_count) ?? queued + running + succeeded + failed + paused,
      queued,
      running,
      succeeded,
      failed,
      paused,
      other: 0
    };
  }
</script>

<section class="panel queue-status-panel" class:panel-compact={mode === 'compact'}>
  <div class="panel-heading">
    <div>
      <p class="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
    </div>
    {#if loading}<span class="soft">Refreshing</span>{/if}
  </div>

  <div class="metric-grid metric-grid-dense queue-status-metrics">
    <div class="metric metric-compact">
      <span>Total</span>
      <strong>{formatCount(counts.total)}</strong>
    </div>
    <div class="metric metric-compact">
      <span>Queued</span>
      <strong>{formatCount(counts.queued)}</strong>
    </div>
    <div class="metric metric-compact">
      <span>Running</span>
      <strong>{formatCount(counts.running)}</strong>
    </div>
    <div class="metric metric-compact">
      <span>Done</span>
      <strong class:tone-good={counts.succeeded > 0}>{formatCount(counts.succeeded)}</strong>
    </div>
    <div class="metric metric-compact">
      <span>Failed</span>
      <strong class:tone-bad={counts.failed > 0}>{formatCount(counts.failed)}</strong>
    </div>
  </div>

  {#if error}<p class="form-error">{error}</p>{/if}

  {#if mode === 'detailed' || recentJobs.length > 0}
    <JobStatusTable
      jobs={recentJobs}
      pageSize={mode === 'compact' ? 5 : 20}
      compact={mode === 'compact'}
      emptyLabel="No matching jobs yet."
      onJobsRefresh={replaceJobs}
    />
  {:else}
    <p class="empty compact-empty">No matching jobs yet.</p>
  {/if}
</section>
