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

  let summary: JobsSummaryResponse | null = null;
  let loading = true;
  let error: string | null = null;

  $: total = summary?.total;
  $: progress = total?.progress;
  $: percent = numericValue(progress?.percent);
  $: progressWidth = `${Math.max(0, Math.min(100, percent ?? 0))}%`;
  $: queued = numericValue(total?.queued) ?? 0;
  $: running = numericValue(total?.leased) ?? 0;
  $: failed = (numericValue(total?.failed) ?? 0) + (numericValue(total?.cancelled) ?? 0) + (numericValue(total?.dead_lettered) ?? 0);
  $: paused = numericValue(total?.paused) ?? 0;
  $: recent = summary?.recent_jobs?.[0] ?? null;
  $: tone = failed > 0 ? 'bad' : running > 0 || queued > 0 || paused > 0 ? 'warn' : 'good';

  onMount(() => {
    let cancelled = false;
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
    {:else if loading}
      <span class="soft">Refreshing</span>
    {:else if recent}
      <span><span class="status-dot {statusTone(recent.status)}"></span>{recent.status ?? 'unknown'} · {recent.summary ?? recent.id}</span>
    {:else}
      <span class="soft">No recent jobs</span>
    {/if}
    {#if href}<a href={href}>Open</a>{/if}
  </div>
</section>
