<script lang="ts">
  import { queueStatus } from '$lib/stores/queueStatus';
  import { formatCount, formatPercent, numericValue } from '$lib/utils/format';
  import type { JobStageKey } from '$lib/utils/jobStatus';

  export let title = 'Queue status';
  export let eyebrow = 'Tasks';
  export let stage: JobStageKey | null = null;
  export let stages: string[] | null = null;
  export let jobIds: string[] = [];
  export let mode: 'compact' | 'detailed' = 'compact';
  export let limit = 100;

  const canonicalStages: Record<JobStageKey, string> = {
    ingestion: 'extract_frames', preprocessing: 'preprocess_frames', segmentation: 'segment',
    roi_refinement: 'roi_refinement', classification: 'classify', export: 'export_bundle'
  };
  let status = queueStatus();
  let statusKey = '';
  $: selectedStages = stages ?? (stage ? [canonicalStages[stage]] : []);
  $: {
    // Single-stage cards select the shared project snapshot. Submitted jobs
    // have a distinct, explicitly labelled scope, independent of their stage.
    const options = jobIds.length
      ? { ids: jobIds.slice(0, 250), job_limit: Math.min(250, Math.max(limit, jobIds.length)) }
      : selectedStages.length > 1 ? { stage: selectedStages } : {};
    const key = JSON.stringify(options);
    if (key !== statusKey) { statusKey = key; status = queueStatus(options); }
  }
  $: snapshot = $status.snapshot;
  $: counts = !jobIds.length && selectedStages.length === 1
    ? snapshot?.by_stage.find((item) => item.stage === selectedStages[0])
    : snapshot?.total;
  $: groups = (snapshot?.work_groups ?? []).filter((group) =>
    (jobIds.length || !selectedStages.length || selectedStages.includes(group.stage ?? '')) &&
    Number(jobIds.length ? group.job_count ?? 0 : group.active ?? 0) > 0
  );

  function reasonLabel(reason?: string | null): string {
    return ({ unknown_total: 'Total not yet known', paused: 'Paused', finalizing: 'Finalizing',
      blocked: 'Waiting on dependencies', expired_lease: 'Worker lease expired', stale_progress: 'Waiting for fresh progress',
      insufficient_progress_samples: 'Estimating', no_active_jobs: 'No active work', awaiting_attempt_progress: 'Waiting for attempt progress'
    } as Record<string, string>)[reason ?? ''] ?? 'Unavailable';
  }
  function formatDuration(value: number | string | null | undefined): string {
    const seconds = numericValue(value);
    if (seconds === null) return 'Unavailable';
    const rounded = Math.max(0, Math.round(seconds));
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    return hours ? `${hours}h ${minutes}m` : minutes ? `${minutes}m ${rounded % 60}s` : `${rounded}s`;
  }
  function formatRate(value: number | string | null | undefined, unit: string | null | undefined): string {
    const rate = numericValue(value);
    return rate === null ? 'Unavailable' : `${rate.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit ?? 'units'}/s`;
  }
</script>

<section class="panel queue-status-panel" class:panel-compact={mode === 'compact'}>
  <div class="panel-heading">
    <div><p class="eyebrow">{eyebrow}</p><h2>{title}</h2></div>
    {#if $status.loading || $status.refreshing}<span class="soft">Refreshing</span>{/if}
  </div>
  {#if jobIds.length}<p class="soft">Submitted jobs{jobIds.length > 250 ? ` · first 250 of ${formatCount(jobIds.length)}` : ''}</p>{/if}
  {#if snapshot}
    <p class="queue-job-state">{formatCount(counts?.queued ?? 0)} queued · {formatCount(Number(counts?.leased ?? 0) + Number(counts?.working ?? 0))} running · {formatCount(counts?.paused ?? 0)} paused · {formatCount(counts?.succeeded ?? 0)} done · {formatCount(Number(counts?.failed ?? 0) + Number(counts?.dead_lettered ?? 0) + Number(counts?.cancelled ?? 0))} stopped</p>
    {#each groups as group (`${group.stage}:${group.unit}`)}
      {@const progress = jobIds.length ? group.progress : group.active_progress}
      {@const percent = numericValue(progress?.percent)}
      <div class="queue-progress-summary" class:warn={Number(progress?.failed_units ?? 0) > 0}>
        <div class="queue-progress-heading">
          <span>{(group.stage ?? '').replaceAll('_', ' ')} · {group.unit ?? 'unknown units'} · {jobIds.length ? 'submitted work' : 'active work'}</span>
          <strong>{percent === null ? reasonLabel(progress?.reason) : formatPercent(percent)}</strong>
        </div>
        <div class="stage-progress-track" role="progressbar" aria-label={`${group.stage} active progress`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent ?? undefined}>
          <span style={`width: ${percent ?? 0}%`}></span>
        </div>
        <div class="queue-progress-metrics">
          <div><span>Processed</span><strong>{formatCount(progress?.completed_units)}</strong></div>
          <div><span>{Number(progress?.unknown_total_jobs ?? 0) > 0 ? 'Known portion of total' : 'Total'}</span><strong>{formatCount(progress?.known_total_units)}</strong></div>
          <div><span>Rate</span><strong>{group.rate?.available ? formatRate(group.rate.units_per_second, group.unit) : reasonLabel(group.rate?.reason)}</strong></div>
          <div><span>Estimated ETA</span><strong>{group.eta?.available ? formatDuration(group.eta.seconds) : reasonLabel(group.eta?.reason)}</strong></div>
        </div>
      </div>
    {:else}<p class="soft">No active work in this scope.</p>{/each}
  {:else}<p class="soft">{$status.error ? 'Queue status unavailable.' : 'Loading queue status…'}</p>{/if}
  {#if $status.stale}<p class="soft" role="status">Updates delayed. Showing the last received snapshot.</p>{/if}
  {#if $status.error}<p class="form-error">{$status.error}</p>{/if}
</section>
