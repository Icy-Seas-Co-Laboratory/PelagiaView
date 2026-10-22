<script lang="ts">
  import type { JobSeriesRequest, ProcessingQueueRequest, ProcessingSubmission } from '$lib/api/types';
  import { formatCount, formatDate, numericValue } from '$lib/utils/format';

  export let submission: ProcessingSubmission;
  export let seriesHref: string | null = null;

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
</script>

<article class:failed={submission.status === 'failed'} class="submission-status">
  <div class="heading"><strong>{submission.kind === 'series' ? 'Processing series' : 'Processing queue'}</strong><small>{submission.status === 'accepted' ? 'Accepted' : submission.status === 'planning' ? 'Planning jobs' : submission.status === 'succeeded' ? 'Planned' : 'Failed'} · {formatDate(submission.updated_at ?? submission.created_at)}</small></div>
  <small class="identity">Request {submission.request_id.slice(0, 8)}</small>
  <p class="scope">{scope || 'Saved processing criteria'}</p>
  {#if submission.status === 'failed'}
    <p class="outcome">{submission.error ?? 'Planning failed without a reported error.'}</p>
  {:else if submission.status === 'succeeded' && queueResult}
    {#if queued === 0}<p class="outcome">No eligible work matched the saved criteria.</p>{:else if matched === null}<p class="outcome">Created {formatCount(queued)} job{queued === 1 ? '' : 's'}.</p>{:else}<p class="outcome">Created {formatCount(queued)} job{queued === 1 ? '' : 's'} from {formatCount(matched)} matched {queueResult.unit ?? 'unit'}{matched === 1 ? '' : 's'}.</p>{/if}
  {:else if submission.status === 'succeeded'}
    <p class="outcome">Series planning completed.{#if seriesId && seriesHref} <a href={seriesHref}>Open Series Monitor</a>{/if}</p>
  {:else}<p class="outcome">The server is resolving this saved selection into jobs.</p>{/if}
</article>

<style>
  .submission-status{display:grid;gap:.25rem;padding:.65rem;border:1px solid var(--app-border-soft,#dde7e3);border-radius:.5rem;background:var(--app-surface-soft,#f1f6f4)}.submission-status.failed{border-color:var(--app-danger,#a23c34)}.heading{display:flex;justify-content:space-between;gap:.5rem}.heading small,.identity,.scope,.outcome{margin:0;color:var(--app-muted,#60746c);font-size:.72rem}.identity{font-family:ui-monospace,monospace}.scope{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.failed .outcome{color:var(--app-danger,#a23c34)}a{color:var(--app-accent-strong,#115345);font-weight:750}
</style>
