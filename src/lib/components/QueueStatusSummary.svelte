<script lang="ts">
  import { onMount } from 'svelte';
  import JobStatusTable from '$lib/components/JobStatusTable.svelte';
  import { getClient } from '$lib/stores/session';
  import type { Job, JobAggregateSummary, JobsSummaryResponse } from '$lib/api/types';
  import { formatCount, formatPercent, numericValue } from '$lib/utils/format';
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
  let loadSequence = 0;
  let lastFilterKey = '';
  let mounted = false;

  type QueueProgressSummary = {
    percent: number;
    completed: number;
    total: number;
    failed: number;
    skipped: number;
    unitLabel: string;
    detail: string;
  };

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
  $: progressSummary = summary ? aggregateProgress(summary.total) : jobsProgressSummary(visibleJobs);
  $: recentJobs = [...visibleJobs].sort(compareJobUpdated).slice(0, mode === 'compact' ? 5 : visibleJobs.length);
  $: filterKey = JSON.stringify({ stage, stages, jobIds });
  $: if (filterKey !== lastFilterKey) {
    lastFilterKey = filterKey;
    summary = null;
    polledJobs = [];
    if (mounted && poll && !jobs) void loadStatus();
  }

  async function loadStatus() {
    const client = getClient();
    if (!client || jobs || !poll) return;
    const sequence = ++loadSequence;
    loading = true;
    error = null;
    try {
      if (summaryStage && jobIds.length === 0) {
        const nextSummary = await client.jobsSummary({
          stage: summaryStage,
          include_recent: true,
          recent_limit: limit
        });
        if (sequence === loadSequence) summary = nextSummary;
      } else {
        const nextJobs = await client.listJobs({
          ids: jobIds.length ? jobIds : undefined,
          include_progress: true,
          limit: Math.max(limit, jobIds.length),
          sort: 'updated_at',
          direction: 'desc'
        });
        if (sequence === loadSequence) polledJobs = nextJobs;
      }
    } catch (err) {
      if (sequence === loadSequence) error = err instanceof Error ? err.message : String(err);
    } finally {
      if (sequence === loadSequence) loading = false;
    }
  }

  onMount(() => {
    mounted = true;
    if (jobs || !poll) return;
    void loadStatus();
    const timer = window.setInterval(loadStatus, 5000);
    return () => {
      mounted = false;
      loadSequence += 1;
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

  function aggregateProgress(row: JobAggregateSummary | null | undefined): QueueProgressSummary | null {
    const progress = row?.progress;
    const completed = numericValue(progress?.completed_units);
    const total = numericValue(progress?.known_total_units);
    const failed = numericValue(progress?.failed_units) ?? 0;
    const skipped = numericValue(progress?.skipped_units) ?? 0;
    const percent = numericValue(progress?.percent);
    if (completed !== null && total !== null && total > 0) {
      return buildProgressSummary(
        completed,
        total,
        failed,
        skipped,
        percent ?? (completed / total) * 100,
        'work units'
      );
    }

    const counts = aggregateCounts(row);
    const finished = counts.succeeded + counts.failed;
    if (counts.total < 1) return null;
    return buildProgressSummary(
      finished,
      counts.total,
      counts.failed,
      0,
      (finished / counts.total) * 100,
      'jobs'
    );
  }

  function jobsProgressSummary(jobs: Job[]): QueueProgressSummary | null {
    if (!jobs.length) return null;
    let completedUnits = 0;
    let totalUnits = 0;
    let failedUnits = 0;
    let skippedUnits = 0;
    let unit = '';

    for (const job of jobs) {
      const completed = numericValue(job.progress?.completed);
      const total = numericValue(job.progress?.total);
      if (completed !== null && total !== null && total > 0) {
        completedUnits += Math.min(completed, total);
        totalUnits += total;
        failedUnits += numericValue(job.progress?.failed) ?? 0;
        skippedUnits += numericValue(job.progress?.skipped) ?? 0;
        unit ||= job.progress?.unit ?? '';
      }
    }

    if (totalUnits > 0) {
      return buildProgressSummary(
        completedUnits,
        totalUnits,
        failedUnits,
        skippedUnits,
        (completedUnits / totalUnits) * 100,
        unit || 'work units'
      );
    }

    const counts = countJobs(jobs);
    const finished = counts.succeeded + counts.failed;
    return buildProgressSummary(
      finished,
      counts.total,
      counts.failed,
      0,
      counts.total > 0 ? (finished / counts.total) * 100 : 0,
      'jobs'
    );
  }

  function buildProgressSummary(
    completed: number,
    total: number,
    failed: number,
    skipped: number,
    percent: number,
    unitLabel: string
  ): QueueProgressSummary {
    const details = [
      `${formatCount(completed)} / ${formatCount(total)} ${unitLabel}`,
      failed > 0 ? `${formatCount(failed)} failed` : null,
      skipped > 0 ? `${formatCount(skipped)} skipped` : null
    ].filter(Boolean).join(' · ');
    return {
      percent: Math.max(0, Math.min(100, percent)),
      completed,
      total,
      failed,
      skipped,
      unitLabel,
      detail: details
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
      <span>Queued</span>
      <strong>{formatCount(counts.queued)}</strong>
    </div>
    <div class="metric metric-compact">
      <span>Running</span>
      <strong>{formatCount(counts.running)}</strong>
    </div>
    <div class="metric metric-compact">
      <span>Done (Failed)</span>
      <span>
        <strong class:tone-good={counts.succeeded > 0}>{formatCount(counts.succeeded)}</strong>  
        <strong class:tone-bad={counts.failed > 0}>({formatCount(counts.failed)})</strong>
      </span>
    </div>
  </div>

  {#if progressSummary}
    <div class="queue-progress-summary" class:warn={progressSummary.failed > 0}>
      <div class="queue-progress-heading">
        <span>Overall progress</span>
        <strong>{formatPercent(progressSummary.percent)}</strong>
      </div>
      <div class="stage-progress-track" aria-label={`Overall progress ${formatPercent(progressSummary.percent)}`}>
        <span style={`width: ${progressSummary.percent}%`}></span>
      </div>
      <p>{progressSummary.detail}</p>
    </div>
  {/if}

  {#if error}<p class="form-error">{error}</p>{/if}

</section>
