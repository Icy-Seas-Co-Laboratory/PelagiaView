<script lang="ts">
  import { onMount } from 'svelte';
  import { getClient } from '$lib/stores/session';
  import type { JobsSummaryResponse } from '$lib/api/types';
  import { formatCount, formatPercent, numericValue, statusTone } from '$lib/utils/format';

  export let title: string;
  export let eyebrow = 'Pipeline';
  export let detail = '';
  export let stage: string;
  export let href = '';
  export let poll = true;
  export let clearing = false;
  export let onClearQueue: ((stage: string) => Promise<number | void> | number | void) | null = null;

  let summary: JobsSummaryResponse | null = null;
  let loading = true;
  let error: string | null = null;
  let localClearing = false;
  let clearedCount: number | null = null;
  let cancelled = false;

  $: total = summary?.total;
  $: progress = total?.progress;
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

  async function load() {
    const client = getClient();
    if (!client) return;
    loading = true;
    error = null;
    try {
      const nextSummary = await client.jobsSummary({
        stage,
        include_recent: true,
        recent_limit: 3
      });
      if (!cancelled) summary = nextSummary;
    } catch (err) {
      if (!cancelled) error = err instanceof Error ? err.message : String(err);
    } finally {
      if (!cancelled) loading = false;
    }
  }

  async function clearQueue() {
    if (!onClearQueue || isClearing || queueCount <= 0) return;
    localClearing = true;
    error = null;
    clearedCount = null;
    try {
      const result = await onClearQueue(stage);
      await load();
      clearedCount = typeof result === 'number' ? result : null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      localClearing = false;
    }
  }

  onMount(() => {
    cancelled = false;
    void load();
    if (!poll) return;
    const timer = window.setInterval(load, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  });
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
    <strong>{formatPercent(progress?.percent)}</strong>
  </div>

  <div class="stage-card-foot">
    {#if error}
      <span class="form-error">{error}</span>
    {:else if clearedCount !== null}
      <span class="soft" role="status">Cleared {clearedCount} job{clearedCount === 1 ? '' : 's'}</span>
    {:else if loading}
      <span class="soft">Refreshing</span>
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
