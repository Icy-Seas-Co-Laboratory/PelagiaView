<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import type { Job } from '$lib/api/types';
  import { jobSeriesLive } from '$lib/stores/jobLive';
  import { formatCount, formatDate, formatPercent, numericValue, statusTone } from '$lib/utils/format';
  import { jobActions, jobStatusLabel, type JobAction } from '$lib/utils/jobStatus';
  import { getClient } from '$lib/stores/session';

  let actionPending: 'pause' | 'resume' | 'cancel' | 'retry' | null = null;
  let lastRequestedId: string | null = null;
  $: requestedSeriesId = $page.url.searchParams.get('series');
  $: if (requestedSeriesId !== lastRequestedId) { lastRequestedId = requestedSeriesId; void jobSeriesLive.select(requestedSeriesId); }
  $: selected = $jobSeriesLive.selected;
  $: total = numericValue(selected?.progress?.total);
  $: completed = numericValue(selected?.progress?.completed) ?? 0;
  $: failed = numericValue(selected?.progress?.failed) ?? 0;
  $: skipped = numericValue(selected?.progress?.skipped) ?? 0;
  $: percent = numericValue(selected?.progress?.percent) ?? (total && total > 0 ? (completed / total) * 100 : null);
  $: lineage = selected?.progress?.unit_lineage ?? lineageFromProgress(selected?.progress?.current);
  $: jobsById = new Map($jobSeriesLive.jobs.map((job) => [job.id, job]));

  onMount(() => jobSeriesLive.start());

  async function selectSeries(id: string, updateUrl = false) {
    if (updateUrl) { const url = new URL($page.url); url.searchParams.set('series', id); await goto(`${url.pathname}${url.search}${url.hash}`, { keepFocus: true, noScroll: true }); }
    await jobSeriesLive.select(id);
  }
  async function control(action: 'pause' | 'resume' | 'cancel' | 'retry') {
    if (!selected || actionPending || (action === 'cancel' && !window.confirm('Cancel this series and all incomplete work?'))) return;
    actionPending = action;
    try { await jobSeriesLive.control(action); }
    catch (error) { jobSeriesLive.reportError(error); }
    finally { actionPending = null; }
  }
  async function controlJob(job: Job, action: JobAction) {
    const client = getClient(); if (!client) return;
    try {
      if (action === 'pause') await client.pauseJob(job.id); else if (action === 'resume') await client.resumeJob(job.id); else await client.retryJob(job.id);
      await jobSeriesLive.refresh(true);
    } catch (error) { jobSeriesLive.reportError(error); }
  }
  function stageJobs(ids: string[] | undefined): Job[] { return (ids ?? []).map((id) => jobsById.get(id)).filter((job): job is Job => Boolean(job)); }
  function lineageFromProgress(current: Record<string, unknown> | undefined): Array<Record<string, unknown>> { const values = current?.lineage ?? current?.unit_lineage; return Array.isArray(values) ? values.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : []; }
  function lineageLabel(item: Record<string, unknown>): string { return String(item.frame_id ?? item.asset_id ?? item.roi_id ?? item.id ?? item.unit ?? JSON.stringify(item)); }
  function canControl(action: 'pause' | 'resume' | 'cancel' | 'retry'): boolean { const status = selected?.status ?? 'unknown'; return action === 'pause' ? status === 'queued' || status === 'active' : action === 'resume' ? status === 'paused' : action === 'cancel' ? ['queued', 'active', 'paused'].includes(status) : ['failed', 'cancelled'].includes(status); }
</script>

<section class="job-series-monitor">
  <header><p class="eyebrow">Job series</p><h1>Monitor processing series</h1><p class="soft">Live status refreshes every 4 seconds while active, less often when complete or in a background tab.</p></header>
  {#if $jobSeriesLive.error}<p class="form-error" role="alert">{$jobSeriesLive.error}</p>{/if}
  <div class="monitor-grid" aria-busy={$jobSeriesLive.loading}>
    <aside class="series-list" aria-label="Job series"><div class="list-heading"><h2>Recent series</h2><button class="ghost" type="button" on:click={() => jobSeriesLive.refresh()} disabled={$jobSeriesLive.refreshing}>Refresh</button></div>
      {#each $jobSeriesLive.series as item}<button class:selected={selected?.id === item.id} class="series-row" type="button" on:click={() => selectSeries(item.id, true)}><span><strong>{item.id}</strong><small>{item.steps?.map((step) => step.stage).join(' → ') || 'No steps recorded'}</small></span><span class="status"><i class="status-dot {statusTone(item.status)}"></i>{item.status ?? 'unknown'}</span></button>{:else}<p class="soft">No job series found.</p>{/each}
    </aside>
    <main class="detail-panel">
      {#if selected}
        <div class="detail-heading"><div><h2>{selected.id}</h2><p class="soft">Created {formatDate(selected.created_at ?? undefined)} · updated {formatDate(selected.updated_at ?? undefined)}</p></div><span class="status"><i class="status-dot {statusTone(selected.status)}"></i>{selected.status ?? 'unknown'}</span></div>
        {#if selected.error_message}<p class="form-error">{selected.error_message}</p>{/if}
        <div class="action-row" aria-label="Series controls">{#if canControl('pause')}<button class="ghost" type="button" on:click={() => control('pause')} disabled={actionPending !== null}>Pause at checkpoint</button>{/if}{#if canControl('resume')}<button class="ghost" type="button" on:click={() => control('resume')} disabled={actionPending !== null}>Resume</button>{/if}{#if canControl('cancel')}<button class="danger" type="button" on:click={() => control('cancel')} disabled={actionPending !== null}>Cancel remaining work</button>{/if}{#if canControl('retry')}<button class="ghost" type="button" on:click={() => control('retry')} disabled={actionPending !== null}>Retry failed work</button>{/if}{#if actionPending}<span class="soft" aria-live="polite">{actionPending} requested…</span>{/if}</div>
        <section class="progress-card" aria-live="polite"><div><h3>Overall progress</h3><strong>{percent === null ? 'Waiting for units' : formatPercent(percent)}</strong></div><progress max="100" value={percent ?? 0}>{percent ?? 0}%</progress><p>{total === null ? 'Total units are not known yet.' : `${formatCount(completed)} / ${formatCount(total)} ${selected.progress?.unit ?? 'units'}`} {failed ? `· ${formatCount(failed)} failed` : ''}{skipped ? ` · ${formatCount(skipped)} skipped` : ''}</p>{#if selected.progress?.message}<p class="soft">{selected.progress.message}</p>{/if}</section>
        <section><h3>Workflow timeline</h3><div class="stage-list">{#each selected.steps ?? [] as step, index}<article><div><strong><span class="stage-index">{index + 1}</span>{step.stage}</strong><span class="status"><i class="status-dot {statusTone(step.status)}"></i>{step.status ?? 'pending'}</span></div>{#if step.progress}<progress max="100" value={numericValue(step.progress.percent) ?? 0}></progress><small>{formatCount(numericValue(step.progress.completed) ?? 0)} / {formatCount(numericValue(step.progress.total) ?? 0)} {step.progress.unit ?? 'units'}</small>{/if}{#if step.skip_reason}<p class="soft"><strong>Skipped:</strong> {step.skip_reason}</p>{/if}{#if step.error_message}<p class="form-error"><strong>Stage error:</strong> {step.error_message}</p>{/if}{#if step.job_ids?.length}<details><summary>{formatCount(step.job_ids.length)} unit job{step.job_ids.length === 1 ? '' : 's'}{stageJobs(step.job_ids).length < step.job_ids.length ? ` · ${stageJobs(step.job_ids).length} loaded` : ''}</summary><ul class="job-list">{#each stageJobs(step.job_ids) as job}<li><code>{job.id}</code><span class="status"><i class="status-dot {statusTone(job.status)}"></i>{jobStatusLabel(job)}</span><small>{job.worker_id ? `worker ${job.worker_id}` : job.summary ?? 'No worker assigned'} · attempt {job.attempt_count ?? job.attempts ?? 0}/{job.max_attempts ?? '—'}</small>{#if job.error_message}<p class="form-error">{job.error_message}</p>{/if}<span class="job-controls">{#each jobActions(job) as action}<button class="ghost small" type="button" on:click={() => controlJob(job, action)}>{action}</button>{/each}</span></li>{:else}<li class="soft">Job details are not available yet.</li>{/each}</ul></details>{/if}</article>{:else}<p class="soft">Stage records will appear after submission.</p>{/each}</div></section>
        <section class="two-column"><div><h3>Recent events</h3>{#if $jobSeriesLive.events.length}<ol class="activity-list">{#each $jobSeriesLive.events.slice(0, 30) as event}<li><strong>{event.event_type ?? 'job event'}</strong><small>{formatDate(event.created_at)} · {event.job_id ?? 'workflow'}</small>{#if event.message}<span>{event.message}</span>{/if}</li>{/each}</ol>{:else}<p class="soft">No events are available for the loaded units.</p>{/if}</div><div><h3>Recent worker logs</h3>{#if $jobSeriesLive.logs.length}<ol class="activity-list">{#each $jobSeriesLive.logs.slice(0, 30) as log}<li><strong>{log.level ?? 'log'} · {log.event_type ?? 'event'}</strong><small>{formatDate(log.created_at)} · {log.worker_id ?? log.job_id ?? 'system'}</small>{#if log.message}<span>{log.message}</span>{/if}</li>{/each}</ol>{:else}<p class="soft">No worker logs are available for the loaded units.</p>{/if}</div></section>
        <section><h3>Current unit lineage and provenance</h3>{#if lineage.length}<ol class="lineage">{#each lineage as item}<li><code>{lineageLabel(item)}</code>{#if Object.keys(item).length > 1}<small>{JSON.stringify(item)}</small>{/if}</li>{/each}</ol>{:else}<p class="soft">No active unit lineage has been reported.</p>{/if}</section>
        <section><h3>Submission record</h3><p class="soft">Priority {selected.priority ?? 0} · failure policy {selected.failure_policy ?? 'not recorded'}{selected.dry_run ? ' · dry run' : ''}</p>{#if selected.targets ?? selected.selection}<p class="soft">Frozen scope: {(selected.targets ?? selected.selection)?.asset_ids?.length ?? 0} assets · {(selected.targets ?? selected.selection)?.collections?.length ?? 0} collections · {(selected.targets ?? selected.selection)?.frame_ids?.length ?? 0} frame IDs</p>{/if}{#if selected.preset_snapshot}<details><summary>Preset snapshot: {selected.preset_snapshot.preset_name ?? selected.preset_snapshot.preset_id ?? 'unnamed'}</summary><pre>{JSON.stringify(selected.preset_snapshot.settings ?? {}, null, 2)}</pre></details>{/if}</section>
      {:else}<p class="soft">Select a series to inspect its submitted stages, attempts, events, and provenance.</p>{/if}
    </main>
  </div>
</section>

<style>
  .job-series-monitor, header, .detail-panel, .series-list, .stage-list, .two-column { display: grid; gap: 1rem; } .job-series-monitor { max-width: 1500px; } header { gap: .35rem; } h1, h2, h3, p { margin: 0; } h2 { font-size: 1.05rem; } h3 { font-size: .95rem; }.monitor-grid { display: grid; grid-template-columns: minmax(16rem, .55fr) minmax(26rem, 1.45fr); gap: 1rem; align-items: start; } .series-list, .detail-panel { padding: 1rem; border: 1px solid var(--border-color, #d6dbe4); border-radius: .65rem; background: var(--panel-bg, #fff); }.list-heading, .detail-heading, .detail-heading > div, .stage-list article > div, .action-row, .status, .job-list li { display: flex; align-items: center; gap: .55rem; } .list-heading, .detail-heading { justify-content: space-between; } .detail-heading > div { display: grid; gap: .25rem; align-items: start; } .series-row { width: 100%; display: flex; justify-content: space-between; align-items: start; gap: .75rem; padding: .7rem; text-align: left; border: 1px solid var(--border-color, #d6dbe4); border-radius: .45rem; background: transparent; } .series-row.selected { border-color: var(--accent, #2563eb); background: color-mix(in srgb, var(--accent, #2563eb) 8%, transparent); } .series-row span:first-child { display: grid; gap: .2rem; min-width: 0; } .series-row strong, small { overflow-wrap: anywhere; } small, .soft { color: var(--muted-text, #64748b); }.action-row { flex-wrap: wrap; } .danger { color: #991b1b; border-color: #dc2626; } .progress-card, .stage-list article, .two-column > div { display: grid; gap: .6rem; padding: .85rem; border: 1px solid var(--border-color, #d6dbe4); border-radius: .5rem; } .progress-card > div { display: flex; justify-content: space-between; align-items: baseline; } progress { width: 100%; } .stage-list article > div { justify-content: space-between; } .stage-index { display: inline-grid; place-items: center; width: 1.4rem; height: 1.4rem; margin-right: .4rem; border-radius: 99px; background: var(--border-color, #d6dbe4); font-size: .75rem; } .job-list, .activity-list, .lineage { display: grid; gap: .5rem; padding-left: 1.5rem; } .job-list li, .activity-list li, .lineage li { flex-wrap: wrap; align-items: baseline; } .job-list li small { flex: 1 1 15rem; } .job-controls { display: inline-flex; gap: .3rem; } .small { font-size: .75rem; padding: .2rem .45rem; } .activity-list li { display: grid; gap: .15rem; } .two-column { grid-template-columns: repeat(2, minmax(0, 1fr)); } pre { max-height: 18rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }@media (max-width: 780px) { .monitor-grid, .two-column { grid-template-columns: 1fr; } }
</style>
