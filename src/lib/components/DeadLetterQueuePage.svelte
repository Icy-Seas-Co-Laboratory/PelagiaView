<script lang="ts">
  import { onMount } from 'svelte';
  import type { Job, JobEvent, LogEntry } from '$lib/api/types';
  import { getClient } from '$lib/stores/session';
  import { formatDate, formatRelativeTime } from '$lib/utils/format';

  const DEAD_LETTER = 'dead_lettered';
  let jobs: Job[] = [];
  let selected: Job | null = null;
  let events: JobEvent[] = [];
  let logs: LogEntry[] = [];
  let loading = true;
  let loadingDetail = false;
  let refreshing = false;
  let error: string | null = null;
  let notice: string | null = null;
  let category = '';
  let query = '';
  let replayReason = '';
  let replaying = false;

  $: categories = [...new Set(jobs.map((job) => job.failure_category).filter((value): value is string => Boolean(value)))].sort();
  $: visibleJobs = jobs.filter((job) => {
    const text = `${job.id} ${job.stage ?? ''} ${job.summary ?? ''} ${job.error_message ?? ''} ${job.failure_category ?? ''}`.toLowerCase();
    return (!category || job.failure_category === category) && (!query.trim() || text.includes(query.trim().toLowerCase()));
  });

  onMount(() => { void refresh(); });

  async function refresh() {
    const client = getClient(); if (!client) return;
    refreshing = true; error = null;
    try {
      jobs = await client.listJobs({ status: DEAD_LETTER, limit: 250, include_details: true, include_progress: true, sort: 'updated_at', direction: 'desc' });
      if (selected) {
        const refreshed = jobs.find((job) => job.id === selected?.id);
        if (!refreshed) { selected = null; events = []; logs = []; }
        else selected = refreshed;
      }
    } catch (cause) { error = message(cause); }
    finally { loading = false; refreshing = false; }
  }

  async function choose(job: Job) {
    const client = getClient(); if (!client) return;
    selected = job; replayReason = ''; events = []; logs = []; loadingDetail = true; error = null;
    try {
      const [detail, nextEvents, nextLogs] = await Promise.all([
        client.getJob(job.id),
        client.listJobEvents({ job_id: job.id, limit: 100 }),
        client.listLogs({ job_id: job.id, limit: 100 })
      ]);
      if (selected?.id === job.id) { selected = detail; events = nextEvents; logs = nextLogs; }
    } catch (cause) { error = message(cause); }
    finally { loadingDetail = false; }
  }

  async function replay() {
    const client = getClient();
    if (!client || !selected || !replayReason.trim() || replaying) return;
    replaying = true; error = null; notice = null;
    try {
      await client.retryJob(selected.id, replayReason.trim());
      notice = `Replay requested for ${shortId(selected.id)}.`;
      selected = null; events = []; logs = []; replayReason = '';
      await refresh();
    } catch (cause) { error = message(cause); }
    finally { replaying = false; }
  }

  function message(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
  function shortId(id: string): string { return id.length > 13 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id; }
  function attempt(job: Job): string { const current = job.attempt_count ?? job.attempts; return current === undefined ? 'Not recorded' : `${current} / ${job.max_attempts ?? '—'}`; }
</script>

<section class="dlq-page" aria-busy={loading}>
  <header>
    <div><p class="eyebrow">Operations</p><h1>Dead-letter queue</h1><p class="soft">Inspect jobs that exhausted retries. Replays require an operator reason for the audit trail.</p></div>
    <button class="ghost" type="button" on:click={refresh} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>
  </header>
  {#if error}<p class="form-error" role="alert">{error}</p>{/if}
  {#if notice}<p class="notice" role="status">{notice}</p>{/if}
  <div class="filters" aria-label="Dead letter filters">
    <label>Failure category<select bind:value={category}><option value="">All categories</option>{#each categories as item}<option value={item}>{item}</option>{/each}</select></label>
    <label>Search<input bind:value={query} placeholder="Job ID, stage, or error" /></label>
    <p class="soft">{visibleJobs.length} of {jobs.length} dead-lettered job{jobs.length === 1 ? '' : 's'}</p>
  </div>
  <div class="layout">
    <section class="job-list" aria-label="Dead-lettered jobs">
      {#each visibleJobs as job}
        <button class:selected={selected?.id === job.id} class="job-row" type="button" on:click={() => choose(job)}>
          <span class="job-heading"><strong>{job.stage ?? 'Unstaged job'}</strong><code>{shortId(job.id)}</code></span>
          <span class="bad badge">Dead letter</span>
          <small>{job.failure_category ?? 'Unclassified failure'} · attempt {attempt(job)} · {formatRelativeTime(job.updated_at)}</small>
          {#if job.error_message}<span class="error-preview">{job.error_message}</span>{/if}
        </button>
      {:else}<p class="empty">{loading ? 'Loading dead-lettered jobs…' : 'No dead-lettered jobs match these filters.'}</p>{/each}
    </section>
    <aside class="detail" aria-live="polite">
      {#if selected}
        <div class="detail-heading"><div><h2>{selected.stage ?? 'Unstaged job'}</h2><code>{selected.id}</code></div><span class="bad badge">Dead letter</span></div>
        {#if loadingDetail}<p class="soft">Loading job details…</p>{/if}
        <dl><div><dt>Failure category</dt><dd>{selected.failure_category ?? 'Not classified'}</dd></div><div><dt>Attempts</dt><dd>{attempt(selected)}</dd></div><div><dt>Last updated</dt><dd>{formatDate(selected.updated_at)}</dd></div><div><dt>Worker</dt><dd>{selected.worker_id ?? 'Not recorded'}</dd></div></dl>
        {#if selected.error_message}<section><h3>Error</h3><pre class="error-box">{selected.error_message}</pre></section>{/if}
        <section><h3>Replay with an operator reason</h3><label>Reason<textarea bind:value={replayReason} rows="3" placeholder="Why is this work safe and appropriate to replay?"></textarea></label><button class="primary" type="button" on:click={replay} disabled={!replayReason.trim() || replaying}>{replaying ? 'Requesting replay…' : 'Replay job'}</button><p class="soft">The job is returned to the queue and the reason should be recorded in its event history.</p></section>
        <section><h3>Job events</h3>{#if events.length}<ol>{#each events as event}<li><strong>{event.event_type ?? 'event'}</strong><small>{formatDate(event.created_at)}{event.message ? ` · ${event.message}` : ''}</small></li>{/each}</ol>{:else}<p class="soft">No job events are available.</p>{/if}</section>
        <section><h3>Worker logs</h3>{#if logs.length}<ol>{#each logs as log}<li><strong>{log.level ?? 'log'} · {log.event_type ?? 'event'}</strong><small>{formatDate(log.created_at)}{log.message ? ` · ${log.message}` : ''}</small></li>{/each}</ol>{:else}<p class="soft">No worker logs are available.</p>{/if}</section>
      {:else}<div class="empty"><h2>Select a dead-lettered job</h2><p>Review its failure, attempts, events, and logs before requesting a replay.</p></div>{/if}
    </aside>
  </div>
</section>

<style>
  .dlq-page, header, .filters, .layout, .job-list, .detail, .detail section { display:grid; gap:1rem; } .dlq-page{max-width:1450px}.dlq-page h1,.dlq-page h2,.dlq-page h3,.dlq-page p{margin:0}header{grid-template-columns:1fr auto;align-items:start}.soft,small{color:var(--muted-text,#64748b)}.filters{grid-template-columns:minmax(12rem,.45fr) minmax(16rem,1fr) auto;align-items:end;padding:1rem;border:1px solid var(--border-color,#d6dbe4);border-radius:.65rem}.filters p{padding-bottom:.35rem}.filters label,.detail label{display:grid;gap:.35rem;font-size:.82rem;font-weight:700}.filters select,.filters input,textarea{width:100%;box-sizing:border-box;padding:.55rem;border:1px solid var(--border-color,#d6dbe4);border-radius:.4rem;background:var(--panel-bg,#fff);color:inherit;font:inherit}.layout{grid-template-columns:minmax(20rem,.8fr) minmax(28rem,1.2fr);align-items:start}.job-list,.detail{padding:1rem;border:1px solid var(--border-color,#d6dbe4);border-radius:.65rem;background:var(--panel-bg,#fff)}.job-row{display:grid;grid-template-columns:1fr auto;gap:.4rem;text-align:left;padding:.8rem;border:1px solid var(--border-color,#d6dbe4);border-radius:.5rem;background:transparent;color:inherit}.job-row.selected{border-color:var(--accent,#2563eb);background:color-mix(in srgb,var(--accent,#2563eb) 8%,transparent)}.job-heading,.detail-heading{display:flex;gap:.55rem;align-items:baseline;min-width:0}.job-heading code,.detail-heading code{overflow:hidden;text-overflow:ellipsis}.job-row small,.error-preview{grid-column:1/-1}.error-preview{color:var(--bad,#b91c1c);font-size:.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.detail-heading{justify-content:space-between}.detail-heading>div{display:grid;gap:.3rem;min-width:0}.badge{border-radius:99px;padding:.25rem .5rem;font-size:.7rem;font-weight:800;text-transform:uppercase}.bad{color:var(--bad,#b91c1c);background:color-mix(in srgb,var(--bad,#b91c1c) 10%,transparent)}dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.7rem;margin:0}dl div{padding:.65rem;border:1px solid var(--border-color,#d6dbe4);border-radius:.4rem}dt{color:var(--muted-text,#64748b);font-size:.72rem;font-weight:800;text-transform:uppercase}dd{margin:.2rem 0 0;overflow-wrap:anywhere}.error-box{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;padding:.7rem;border-left:3px solid var(--bad,#b91c1c);background:color-mix(in srgb,var(--bad,#b91c1c) 5%,transparent);color:var(--bad,#b91c1c)}.primary,.ghost{width:max-content;padding:.5rem .75rem;border:1px solid var(--accent,#2563eb);border-radius:.4rem;background:var(--accent,#2563eb);color:white;font:inherit}.ghost{background:transparent;color:inherit;border-color:var(--border-color,#d6dbe4)}.detail ol{display:grid;gap:.5rem;margin:0;padding-left:1.25rem}.detail li{display:grid;gap:.15rem}.notice{padding:.7rem;border-left:3px solid var(--accent,#2563eb);background:color-mix(in srgb,var(--accent,#2563eb) 6%,transparent)}.empty{padding:1rem;color:var(--muted-text,#64748b)}@media(max-width:800px){header,.layout,.filters,dl{grid-template-columns:1fr}.filters p{padding:0}}
</style>
