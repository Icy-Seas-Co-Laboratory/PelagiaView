<script lang="ts">
  import { onMount } from 'svelte';
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
  let nowMs = Date.now();

  type QueueProgressSummary = {
    percent: number;
    completed: number;
    total: number;
    remaining: number;
    failed: number;
    skipped: number;
    rate: number | null;
    elapsedSeconds: number | null;
    etaSeconds: number | null;
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
  $: progressSummary = summary ? aggregateProgress(summary.total, visibleJobs) : jobsProgressSummary(visibleJobs);
  $: jobStateSummary = buildJobStateSummary(counts);
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
    const clockTimer = window.setInterval(() => {
      nowMs = Date.now();
    }, 1000);
    let statusTimer: number | null = null;
    if (!jobs && poll) {
      void loadStatus();
      statusTimer = window.setInterval(loadStatus, 5000);
    }
    return () => {
      mounted = false;
      loadSequence += 1;
      window.clearInterval(clockTimer);
      if (statusTimer !== null) window.clearInterval(statusTimer);
    };
  });

  function dateValue(value: string | undefined): number {
    if (!value) return 0;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
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

  function aggregateProgress(
    row: JobAggregateSummary | null | undefined,
    jobs: Job[] = []
  ): QueueProgressSummary | null {
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
        'work units',
        jobs
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
      'jobs',
      jobs
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
        unit || 'work units',
        jobs
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
      'jobs',
      jobs
    );
  }

  function buildProgressSummary(
    completed: number,
    total: number,
    failed: number,
    skipped: number,
    percent: number,
    unitLabel: string,
    jobs: Job[] = []
  ): QueueProgressSummary {
    const remaining = Math.max(0, total - completed);
    const rate = estimateUnitRate(jobs);
    const elapsedSeconds = estimateElapsedSeconds(jobs);
    const etaSeconds = rate !== null && remaining > 0 ? remaining / rate : null;
    const details = [
      `${formatCount(completed)} / ${formatCount(total)} ${unitLabel}`,
      failed > 0 ? `${formatCount(failed)} failed` : null,
      skipped > 0 ? `${formatCount(skipped)} skipped` : null
    ].filter(Boolean).join(' · ');
    return {
      percent: Math.max(0, Math.min(100, percent)),
      completed,
      total,
      remaining,
      failed,
      skipped,
      rate,
      elapsedSeconds,
      etaSeconds,
      unitLabel,
      detail: details
    };
  }

  function estimateUnitRate(jobs: Job[]): number | null {
    let rate = 0;
    for (const job of jobs) {
      if (!isActiveJob(job)) continue;
      rate += numericValue(job.progress?.rates?.units_per_second) ?? 0;
    }
    return rate > 0 ? rate : null;
  }

  function estimateElapsedSeconds(jobs: Job[]): number | null {
    if (!jobs.length) return null;
    const starts = jobs
      .map((job) => dateValue(job.started_at ?? job.created_at ?? job.updated_at))
      .filter((value) => value > 0);
    if (!starts.length) return null;
    const start = Math.min(...starts);
    const active = jobs.some(isActiveJob);
    const ends = jobs
      .map((job) => dateValue(job.finished_at ?? job.updated_at ?? job.created_at))
      .filter((value) => value > 0);
    const end = active ? nowMs : ends.length ? Math.max(...ends) : nowMs;
    return Math.max(0, (end - start) / 1000);
  }

  function isActiveJob(job: Job): boolean {
    const status = (job.status ?? '').toLowerCase();
    return status === 'leased' || status === 'working' || status === 'running';
  }

  function formatDuration(seconds: number | null): string {
    if (seconds === null || !Number.isFinite(seconds)) return 'Unknown';
    const rounded = Math.max(0, Math.round(seconds));
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const secs = rounded % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
  }

  function formatRate(rate: number | null, unitLabel: string): string {
    if (rate === null || !Number.isFinite(rate) || rate <= 0) return 'Unknown';
    const formatted = rate >= 10 ? rate.toFixed(0) : rate >= 1 ? rate.toFixed(1) : rate.toFixed(2);
    return `${formatted} ${unitLabel}/s`;
  }

  function buildJobStateSummary(nextCounts: JobStatusCounts): string {
    return [
      `${formatCount(nextCounts.queued)} queued`,
      `${formatCount(nextCounts.running)} running`,
      `${formatCount(nextCounts.succeeded)} done`,
      nextCounts.failed > 0 ? `${formatCount(nextCounts.failed)} failed` : null,
      nextCounts.paused > 0 ? `${formatCount(nextCounts.paused)} paused` : null
    ].filter(Boolean).join(' · ');
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

  {#if progressSummary}
    <div class="queue-progress-summary" class:warn={progressSummary.failed > 0}>
      <div class="queue-progress-heading">
        <span>{progressSummary.detail}</span>
        <strong>{formatPercent(progressSummary.percent)}</strong>
      </div>
      <div class="stage-progress-track" aria-label={`Overall progress ${formatPercent(progressSummary.percent)}`}>
        <span style={`width: ${progressSummary.percent}%`}></span>
      </div>
      <div class="queue-progress-metrics">
        <div>
          <span>Remaining</span>
          <strong>{formatCount(progressSummary.remaining)}</strong>
        </div>
        <div>
          <span>Rate</span>
          <strong>{formatRate(progressSummary.rate, progressSummary.unitLabel)}</strong>
        </div>
        <div>
          <span>Elapsed</span>
          <strong>{formatDuration(progressSummary.elapsedSeconds)}</strong>
        </div>
        <div>
          <span>ETA</span>
          <strong>{formatDuration(progressSummary.etaSeconds)}</strong>
        </div>
      </div>
      <p class="queue-job-state">{jobStateSummary}</p>
    </div>
  {:else}
    <div class="queue-progress-summary">
      <div class="queue-progress-heading">
        <span>No countable work reported</span>
        <strong>0%</strong>
      </div>
      <div class="stage-progress-track" aria-label="Overall progress 0%">
        <span style="width: 0%"></span>
      </div>
      <p class="queue-job-state">{jobStateSummary}</p>
    </div>
  {/if}

  {#if error}<p class="form-error">{error}</p>{/if}

</section>
