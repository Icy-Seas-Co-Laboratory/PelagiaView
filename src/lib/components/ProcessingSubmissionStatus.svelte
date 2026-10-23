<script lang="ts">
  import type { JobSeriesRequest, ProcessingQueueRequest, ProcessingSubmission } from '$lib/api/types';
  import { formatCount, formatDate, numericValue } from '$lib/utils/format';
  import { getClient } from '$lib/stores/session';
  import { processingSubmissions } from '$lib/stores/processingSubmissions';
  import { hasNoEligibleWork, submissionPhaseCopy } from '$lib/processing/submissionProgress';

  export let submission: ProcessingSubmission;
  export let seriesHref: string | null = null;
  let stopping = false;
  let stopError: string | null = null;

  $: queueRequest = submission.kind === 'queue' ? submission.request as ProcessingQueueRequest | undefined : undefined;
  $: seriesRequest = submission.kind === 'series' ? submission.request as JobSeriesRequest | undefined : undefined;
  $: queueResult = submission.kind === 'queue' && submission.result && 'job_count' in submission.result ? submission.result : null;
  $: seriesId = submission.kind === 'series' && submission.result && 'series' in submission.result ? submission.result.series?.id : null;
  $: seriesScope = seriesRequest?.selection ?? seriesRequest?.targets;
  $: scope = queueRequest
    ? [queueRequest.stage?.replaceAll('_', ' '), ...(queueRequest.filters?.asset_ids?.length ? [`${queueRequest.filters.asset_ids.length} asset${queueRequest.filters.asset_ids.length === 1 ? '' : 's'}`] : []), ...(queueRequest.filters?.collection?.length ? [queueRequest.filters.collection.join(', ')] : [])].filter(Boolean).join(' · ')
    : [seriesRequest?.steps?.filter((step) => step.enabled !== false).map((step) => step.stage.replaceAll('_', ' ')).join(' → '), ...(seriesScope?.asset_ids?.length ? [`${seriesScope.asset_ids.length} asset${seriesScope.asset_ids.length === 1 ? '' : 's'}`] : []), ...(seriesScope?.collections?.length ? [seriesScope.collections.join(', ')] : [])].filter(Boolean).join(' · ');
  $: queued = numericValue(queueResult?.job_count);
  $: matched = numericValue(queueResult?.matched_count);
  $: progress = submission.progress;
  $: scheduled = numericValue(progress?.scheduled_count);
  $: createdJobs = numericValue(progress?.job_count);
  $: queuedJobs = numericValue(progress?.queued_count);
  $: runningJobs = numericValue(progress?.running_count);
  $: pausedJobs = numericValue(progress?.paused_count);
  $: completedJobs = numericValue(progress?.completed_count);
  $: failedJobs = numericValue(progress?.failed_count);
  $: cancelledJobs = numericValue(progress?.cancelled_count);
  $: isActive = submission.status === 'accepted' || submission.status === 'planning' || submission.status === 'processing';
  $: noEligibleWork = submission.status === 'succeeded' && hasNoEligibleWork(progress);
  $: scheduledUnit = submission.kind === 'series'
    ? 'units'
    : queueRequest?.stage === 'roi_refinement'
      ? 'detections'
      : 'frames';
  $: phaseCopy = submissionPhaseCopy(progress, scheduledUnit);
  $: activeProgress = [
    scheduled !== null ? `${formatCount(scheduled)} ${scheduledUnit} scheduled` : null,
    createdJobs !== null ? `${formatCount(createdJobs)} jobs created` : null,
    runningJobs !== null ? `${formatCount(runningJobs)} running` : null,
    queuedJobs !== null ? `${formatCount(queuedJobs)} queued` : null,
    pausedJobs !== null && pausedJobs > 0 ? `${formatCount(pausedJobs)} paused` : null
  ].filter((value): value is string => value !== null).join(' · ');
  $: completedProgress = [
    completedJobs !== null ? `${formatCount(completedJobs)} completed` : null,
    failedJobs !== null && failedJobs > 0 ? `${formatCount(failedJobs)} failed` : null,
    cancelledJobs !== null && cancelledJobs > 0 ? `${formatCount(cancelledJobs)} cancelled` : null
  ].filter((value): value is string => value !== null).join(' · ');

  async function stopPlanning() {
    const client = getClient();
    if (!client || stopping || !isActive) return;
    if (!window.confirm('Stop this submission? Planning will stop, and work already created for this submission will be asked to stop at a checkpoint.')) return;
    stopping = true;
    stopError = null;
    try {
      const cancelled = await client.cancelProcessingSubmission(
        submission.id,
        'Stopped from PelagiaView processing submission status.'
      );
      processingSubmissions.observe(cancelled);
      void processingSubmissions.refresh(true);
    } catch (error) {
      stopError = error instanceof Error ? error.message : String(error);
    } finally {
      stopping = false;
    }
  }
</script>

<article class:failed={submission.status === 'failed'} class:cancelled={submission.status === 'cancelled'} class="submission-status" aria-live="polite">
  <div class="heading"><strong>{submission.kind === 'series' ? 'Processing series' : 'Planning and processing'}</strong><small>{submission.status === 'accepted' ? 'Accepted' : submission.status === 'planning' ? 'Planning jobs' : submission.status === 'processing' ? 'Processing' : submission.status === 'succeeded' ? 'Complete' : submission.status === 'cancelled' ? 'Cancelled' : 'Failed'} · {formatDate(submission.updated_at ?? submission.created_at)}</small></div>
  <small class="identity">Request {submission.request_id.slice(0, 8)}</small>
  <p class="scope">{scope || 'Saved processing criteria'}</p>
  {#if submission.status === 'failed'}
    <p class="outcome">{submission.error ?? 'Processing failed without a reported error.'}</p>
  {:else if submission.status === 'cancelled'}
    <p class="outcome">Planning and work for this submission were cancelled.</p>
  {:else if noEligibleWork}
    <p class="outcome">No eligible work matched the saved criteria.</p>
  {:else if progress}
    <p class="outcome phase">{phaseCopy}{#if seriesId && seriesHref} <a href={seriesHref}>Open Series Monitor</a>{/if}</p>
  {:else if submission.status === 'succeeded' && queueResult}
    {#if queued === 0}<p class="outcome">No eligible work matched the saved criteria.</p>{:else if matched === null}<p class="outcome">Created {formatCount(queued)} job{queued === 1 ? '' : 's'}.</p>{:else}<p class="outcome">Created {formatCount(queued)} job{queued === 1 ? '' : 's'} from {formatCount(matched)} matched {queueResult.unit ?? 'unit'}{matched === 1 ? '' : 's'}.</p>{/if}
  {:else if submission.status === 'succeeded'}
    <p class="outcome">Series planning completed.{#if seriesId && seriesHref} <a href={seriesHref}>Open Series Monitor</a>{/if}</p>
  {:else}<p class="outcome">Finding eligible {scheduledUnit}.</p>{/if}
  {#if progress && (submission.status === 'failed' || submission.status === 'cancelled') && seriesId && seriesHref}
    <p class="outcome"><a href={seriesHref}>Open Series Monitor</a></p>
  {/if}
  {#if progress && !noEligibleWork}
    {#if activeProgress}<p class="progress-line">{activeProgress}</p>{/if}
    {#if completedProgress}<p class="progress-line">{completedProgress}</p>{/if}
    {#if progress.more_jobs_being_prepared}<p class="preparing">More jobs are being prepared.</p>{/if}
  {/if}
  {#if isActive}<button type="button" class="stop" on:click={stopPlanning} disabled={stopping}>{stopping ? 'Stopping…' : 'Stop this submission'}</button>{/if}
  {#if stopError}<p class="stop-error">{stopError}</p>{/if}
</article>

<style>
  .submission-status{display:grid;gap:.25rem;padding:.65rem;border:1px solid var(--app-border-soft,#dde7e3);border-radius:.5rem;background:var(--app-surface-soft,#f1f6f4)}.submission-status.failed,.submission-status.cancelled{border-color:var(--app-danger,#a23c34)}.heading{display:flex;justify-content:space-between;gap:.5rem}.heading small,.identity,.scope,.outcome,.progress-line,.preparing,.stop-error{margin:0;color:var(--app-muted,#60746c);font-size:.72rem}.identity{font-family:ui-monospace,monospace}.scope{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.failed .outcome,.cancelled .outcome,.stop-error{color:var(--app-danger,#a23c34)}.phase{font-weight:700;color:var(--app-text,#16342b)}.progress-line{font-variant-numeric:tabular-nums}.preparing{font-weight:700;color:var(--app-accent-strong,#115345)}.stop{justify-self:start;margin-top:.25rem;border:1px solid var(--app-danger,#a23c34);border-radius:.35rem;background:transparent;color:var(--app-danger,#a23c34);font:inherit;font-size:.72rem;font-weight:700;padding:.25rem .45rem}.stop:focus-visible{outline:2px solid var(--app-accent-strong,#115345);outline-offset:2px}a{color:var(--app-accent-strong,#115345);font-weight:750}
</style>
