<script lang="ts">
  import { queueStatus } from '$lib/stores/queueStatus';
  import { formatCount, formatPercent, numericValue, statusTone } from '$lib/utils/format';

  export let title: string;
  export let eyebrow = 'Pipeline';
  export let detail = '';
  export let stage: string;
  export let href = '';
  export let clearing = false;
  export let onClearQueue: ((stage: string) => Promise<number | void> | number | void) | null = null;

  const status = queueStatus();
  $: snapshot = $status.snapshot;
  $: summary = snapshot ? { total: snapshot.by_stage.find((row) => row.stage === stage), by_stage: snapshot.by_stage, recent_jobs: snapshot.jobs.items.filter((job) => job.stage === stage) } : null;
  $: loading = $status.loading || $status.refreshing;
  $: error = $status.error;
  let localClearing = false;
  let clearedCount: number | null = null;

  $: total = summary?.total;
  $: groups = snapshot?.work_groups.filter((group) => group.stage === stage) ?? [];
  $: progress = groups.length === 1 ? groups[0].active_progress : null;
  $: percent = numericValue(progress?.percent);
  $: progressWidth = `${Math.max(0, Math.min(100, percent ?? 0))}%`;
  $: queued = numericValue(total?.queued) ?? 0;
  $: running = (numericValue(total?.leased) ?? 0) + (numericValue(total?.working) ?? 0);
  $: failed = (numericValue(total?.failed) ?? 0) + (numericValue(total?.cancelled) ?? 0) + (numericValue(total?.dead_lettered) ?? 0);
  $: paused = numericValue(total?.paused) ?? 0;
  $: queueCount = queued + running + paused;
  $: recent = summary?.recent_jobs?.[0] ?? null;
  $: tone = failed > 0 ? 'bad' : running > 0 || queued > 0 || paused > 0 ? 'warn' : 'good';
  $: isClearing = clearing || localClearing;

  async function clearQueue() {
    if (!onClearQueue || isClearing || queueCount <= 0) return;
    localClearing = true;
    error = null;
    clearedCount = null;
    try {
      const result = await onClearQueue(stage);
      await status.refresh(true);
      clearedCount = typeof result === 'number' ? result : null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      localClearing = false;
    }
  }

</script>

<section class="panel stage-status-card">
  <div class="stage-card-head">
    <div>
      <p class="eyebrow">{eyebrow}</p>
      <h3>{title}</h3>
    </div>
    <span class="status-pill {tone}">{tone === 'bad' ? 'Attention' : tone === 'warn' ? 'Active' : 'Quiet'}</span>
  </div>

  {#if detail}<p class="stage-card-detail">{detail}</p>{/if}

  <div class="stage-card-metrics">
    <div>
      <span>Queued</span>
      <strong>{formatCount(queued)}</strong>
    </div>
    <div>
      <span>Running</span>
      <strong>{formatCount(running)}</strong>
    </div>
    <div>
      <span>Failed</span>
      <strong class:tone-bad={failed > 0}>{formatCount(failed)}</strong>
    </div>
    <div>
      <span>Done</span>
      <strong>{formatCount(total?.succeeded)}</strong>
    </div>
  </div>

  <div class="stage-progress-row">
    <div class="stage-progress-track" aria-label={`${title} progress`}>
      <span style={`width: ${progressWidth}`}></span>
    </div>
    <strong>{percent === null ? '—' : formatPercent(percent)}</strong>
  </div>

  <div class="stage-card-foot">
    {#if error}
      <span class="form-error">{error}</span>
    {:else if clearedCount !== null}
      <span class="soft" role="status">Cleared {clearedCount} job{clearedCount === 1 ? '' : 's'}</span>
    {:else if $status.stale}
      <span class="soft">Status is stale</span>
    {:else if loading}
      <span class="soft">Refreshing</span>
    {:else if groups.length > 1}
      <span class="soft">Multiple work units; progress shown per unit in status.</span>
    {:else if recent}
      <span><span class="status-dot {statusTone(recent.status)}"></span>{recent.status ?? 'unknown'} · {recent.summary ?? recent.id}</span>
    {:else}
      <span class="soft">No recent jobs</span>
    {/if}
    <div class="stage-card-actions">
      {#if href}<a href={href}>Open</a>{/if}
      {#if onClearQueue}
        <button class="ghost danger compact-action" type="button" on:click={clearQueue} disabled={isClearing || queueCount <= 0}>
          {isClearing ? 'Clearing' : 'Clear queue'}
        </button>
      {/if}
    </div>
  </div>
</section>
