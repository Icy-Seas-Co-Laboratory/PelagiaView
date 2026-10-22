<script lang="ts">
  import { queueStatus } from '$lib/stores/queueStatus';
  import type { Job } from '$lib/api/types';
  import { formatCount, formatDate, formatPercent, numericValue, statusTone } from '$lib/utils/format';
  import { jobStatusCategory, jobStatusLabel, runningJobStatuses } from '$lib/utils/jobStatus';

  export let title = 'Now running';
  export let limit = 12;

  // Select from the default project snapshot so adjacent widgets agree atomically.
  const status = queueStatus();
  $: jobs = ($status.snapshot?.jobs.items ?? []).filter((job) => ['leased', 'working'].includes(job.status ?? '')).slice(0, limit);
  $: loading = $status.loading || $status.refreshing;
  $: error = $status.error;
  $: matchingCount = $status.snapshot?.jobs.matching_count ?? 0;
  $: truncated = Boolean($status.snapshot?.jobs.truncated) || matchingCount > jobs.length;

  $: sortedJobs = [...jobs].sort((a, b) => statusRank(a) - statusRank(b) || dateValue(b.updated_at ?? b.created_at) - dateValue(a.updated_at ?? a.created_at));


  function statusRank(job: Job): number {
    return jobStatusCategory(job) === 'running' ? 0 : 1;
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
  {:else if $status.stale}
    <p class="soft">Showing the last snapshot; status is stale.</p>
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
            <span>{jobStatusLabel(job)}</span>
            <span>{formatDate(job.updated_at ?? job.created_at)}</span>
          </div>
        </article>
      {/each}
    </div>
    {#if truncated}<p class="soft">Showing {formatCount(sortedJobs.length)} of {formatCount(matchingCount)} active jobs.</p>{/if}
  {:else}
    <p class="empty">No jobs are running right now.</p>
  {/if}
</section>
