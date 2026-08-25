<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { getClient } from '$lib/stores/session';
  import type { JobSeries } from '$lib/api/types';
  import { formatCount, formatDate, formatPercent, numericValue, statusTone } from '$lib/utils/format';

  export let seriesId: string | null = null;

  let series: JobSeries[] = [];
  let selected: JobSeries | null = null;
  let loading = true;
  let actionPending: 'pause' | 'resume' | 'cancel' | 'retry' | null = null;
  let error: string | null = null;
  let pollTimer: number | null = null;
  let loadSequence = 0;

  $: if (seriesId && selected?.id !== seriesId) void selectSeries(seriesId);
  $: total = numericValue(selected?.progress?.total);
  $: completed = numericValue(selected?.progress?.completed) ?? 0;
  $: failed = numericValue(selected?.progress?.failed) ?? 0;
  $: skipped = numericValue(selected?.progress?.skipped) ?? 0;
  $: percent = numericValue(selected?.progress?.percent) ?? (total && total > 0 ? (completed / total) * 100 : null);
  $: lineage = selected?.progress?.unit_lineage ?? lineageFromProgress(selected?.progress?.current);

  onMount(() => {
    void loadSeries();
    pollTimer = window.setInterval(() => void loadSeries(true), 5000);
  });

  onDestroy(() => {
    loadSequence += 1;
    if (pollTimer !== null) window.clearInterval(pollTimer);
  });

  async function loadSeries(quiet = false) {
    const client = getClient();
    if (!client) {
      loading = false;
      error = 'Connect to Pelagia to monitor job series.';
      return;
    }
    const sequence = ++loadSequence;
    if (!quiet) loading = true;
    if (!quiet) error = null;
    try {
      const next = await client.listJobSeries({ limit: 100, include_details: true });
      if (sequence !== loadSequence) return;
      series = next;
      const wantedId = seriesId ?? selected?.id;
      selected = (wantedId ? next.find((item) => item.id === wantedId) : next[0]) ?? next[0] ?? null;
    } catch (err) {
      if (sequence === loadSequence) error = errorMessage(err);
    } finally {
      if (sequence === loadSequence) loading = false;
    }
  }

  async function selectSeries(id: string) {
    const client = getClient();
    if (!client || selected?.id === id) return;
    error = null;
    try {
      selected = await client.getJobSeries(id);
    } catch (err) {
      error = errorMessage(err);
    }
  }

  async function control(action: 'pause' | 'resume' | 'cancel' | 'retry') {
    const client = getClient();
    if (!client || !selected || actionPending) return;
    if (action === 'cancel' && !window.confirm('Cancel this series and all work that has not completed?')) return;
    actionPending = action;
    error = null;
    try {
      const updated = await client.controlJobSeries(selected.id, action);
      selected = updated;
      series = series.map((item) => item.id === updated.id ? updated : item);
      await loadSeries(true);
    } catch (err) {
      error = errorMessage(err);
    } finally {
      actionPending = null;
    }
  }

  function lineageFromProgress(current: Record<string, unknown> | undefined): Array<Record<string, unknown>> {
    if (!current) return [];
    const values = current.lineage ?? current.unit_lineage;
    return Array.isArray(values) ? values.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object') : [];
  }

  function lineageLabel(item: Record<string, unknown>): string {
    return String(item.frame_id ?? item.asset_id ?? item.roi_id ?? item.id ?? item.unit ?? JSON.stringify(item));
  }

  function errorMessage(value: unknown): string {
    return value instanceof Error ? value.message : String(value);
  }
</script>

<section class="job-series-monitor">
  <header>
    <p class="eyebrow">Job series</p>
    <h1>Monitor processing series</h1>
    <p class="soft">Progress refreshes every five seconds. A completed series can still contain failed or skipped units.</p>
  </header>
  {#if error}<p class="form-error" role="alert">{error}</p>{/if}

  <div class="monitor-grid" aria-busy={loading}>
    <aside class="series-list" aria-label="Job series">
      <div class="list-heading"><h2>Recent series</h2><button class="ghost" type="button" on:click={() => loadSeries()} disabled={loading}>Refresh</button></div>
      {#each series as item}
        <button class:selected={selected?.id === item.id} class="series-row" type="button" on:click={() => selectSeries(item.id)}>
          <span><strong>{item.id}</strong><small>{item.steps?.map((step) => step.stage).join(' → ') || 'No steps recorded'}</small></span>
          <span class="status"><i class="status-dot {statusTone(item.status)}"></i>{item.status ?? 'unknown'}</span>
        </button>
      {:else}<p class="soft">No job series found.</p>{/each}
    </aside>

    <main class="detail-panel">
      {#if selected}
        <div class="detail-heading">
          <div><h2>{selected.id}</h2><p class="soft">Created {formatDate(selected.created_at ?? undefined)} · updated {formatDate(selected.updated_at ?? undefined)}</p></div>
          <span class="status"><i class="status-dot {statusTone(selected.status)}"></i>{selected.status ?? 'unknown'}</span>
        </div>
        {#if selected.error_message}<p class="form-error">{selected.error_message}</p>{/if}
        <div class="action-row">
          <button type="button" class="ghost" on:click={() => control('pause')} disabled={actionPending !== null}>Pause</button>
          <button type="button" class="ghost" on:click={() => control('resume')} disabled={actionPending !== null}>Resume</button>
          <button type="button" class="danger" on:click={() => control('cancel')} disabled={actionPending !== null}>Cancel</button>
          <button type="button" class="ghost" on:click={() => control('retry')} disabled={actionPending !== null}>Retry failed</button>
          {#if actionPending}<span class="soft">{actionPending} requested…</span>{/if}
        </div>

        <section class="progress-card" aria-live="polite">
          <div><h3>Overall progress</h3><strong>{percent === null ? 'Waiting for units' : formatPercent(percent)}</strong></div>
          <progress max="100" value={percent ?? 0}>{percent ?? 0}%</progress>
          <p>{total === null ? 'Total units are not known yet.' : `${formatCount(completed)} / ${formatCount(total)} ${selected.progress?.unit ?? 'units'}`} {failed ? `· ${formatCount(failed)} failed` : ''}{skipped ? ` · ${formatCount(skipped)} skipped` : ''}</p>
          {#if selected.progress?.message}<p class="soft">{selected.progress.message}</p>{/if}
        </section>

        <section><h3>Stage progress</h3><div class="stage-list">{#each selected.steps ?? [] as step}<article><div><strong>{step.stage}</strong><span class="status"><i class="status-dot {statusTone(step.status)}"></i>{step.status ?? 'pending'}</span></div>{#if step.progress}<progress max="100" value={numericValue(step.progress.percent) ?? 0}></progress><small>{formatCount(numericValue(step.progress.completed) ?? 0)} / {formatCount(numericValue(step.progress.total) ?? 0)} {step.progress.unit ?? 'units'}</small>{/if}{#if step.error_message}<p class="form-error">{step.error_message}</p>{/if}</article>{:else}<p class="soft">Stage records will appear after submission.</p>{/each}</div></section>

        <section><h3>Current unit lineage</h3>{#if lineage.length}<ol class="lineage">{#each lineage as item}<li><code>{lineageLabel(item)}</code>{#if Object.keys(item).length > 1}<small>{JSON.stringify(item)}</small>{/if}</li>{/each}</ol>{:else}<p class="soft">No active unit lineage has been reported.</p>{/if}</section>
        <section><h3>Submission record</h3><p class="soft">Priority {selected.priority ?? 0} · failure policy {selected.failure_policy ?? 'not recorded'}{selected.dry_run ? ' · dry run' : ''}</p>{#if selected.preset_snapshot}<details><summary>Preset snapshot: {selected.preset_snapshot.preset_name ?? selected.preset_snapshot.preset_id ?? 'unnamed'}</summary><pre>{JSON.stringify(selected.preset_snapshot.settings ?? {}, null, 2)}</pre></details>{/if}</section>
      {:else}<p class="soft">Select a series to inspect its submitted stages and unit lineage.</p>{/if}
    </main>
  </div>
</section>

<style>
  .job-series-monitor, header, .detail-panel, .series-list, .stage-list { display: grid; gap: 1rem; } .job-series-monitor { max-width: 1500px; } header { gap: .35rem; } h1, h2, h3, p { margin: 0; } h2 { font-size: 1.05rem; } h3 { font-size: .95rem; }
  .monitor-grid { display: grid; grid-template-columns: minmax(16rem, .55fr) minmax(26rem, 1.45fr); gap: 1rem; align-items: start; } .series-list, .detail-panel { padding: 1rem; border: 1px solid var(--border-color, #d6dbe4); border-radius: .65rem; background: var(--panel-bg, #fff); }
  .list-heading, .detail-heading, .detail-heading > div, .stage-list article > div, .action-row, .status { display: flex; align-items: center; gap: .55rem; } .list-heading, .detail-heading { justify-content: space-between; } .detail-heading > div { display: grid; gap: .25rem; align-items: start; } .series-row { width: 100%; display: flex; justify-content: space-between; align-items: start; gap: .75rem; padding: .7rem; text-align: left; border: 1px solid var(--border-color, #d6dbe4); border-radius: .45rem; background: transparent; } .series-row.selected { border-color: var(--accent, #2563eb); background: color-mix(in srgb, var(--accent, #2563eb) 8%, transparent); } .series-row span:first-child { display: grid; gap: .2rem; min-width: 0; } .series-row strong, small { overflow-wrap: anywhere; } small, .soft { color: var(--muted-text, #64748b); }
  .action-row { flex-wrap: wrap; } .danger { color: #991b1b; border-color: #dc2626; } .progress-card, .stage-list article { display: grid; gap: .6rem; padding: .85rem; border: 1px solid var(--border-color, #d6dbe4); border-radius: .5rem; } .progress-card > div { display: flex; justify-content: space-between; align-items: baseline; } progress { width: 100%; } .stage-list article > div { justify-content: space-between; } .lineage { display: grid; gap: .5rem; padding-left: 1.5rem; } .lineage li { display: grid; gap: .2rem; } pre { max-height: 18rem; overflow: auto; white-space: pre-wrap; }
  @media (max-width: 780px) { .monitor-grid { grid-template-columns: 1fr; } }
</style>
