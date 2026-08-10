<script lang="ts">
  import { onMount } from 'svelte';
  import { getClient, session } from '$lib/stores/session';
  import { startSystemUsagePolling, systemUsageState } from '$lib/stores/systemUsage';
  import type {
    Job,
    JobAggregateSummary,
    JobsSummaryResponse,
    SystemStatus,
    SystemUsageFilesystem,
    WorkerSession
  } from '$lib/api/types';
  import { formatBytes, formatCount, formatDate, numericValue } from '$lib/utils/format';

  type StageDefinition = {
    stage: string;
    label: string;
    short: string;
  };

  const stages: StageDefinition[] = [
    { stage: 'extract_frames', label: 'Ingestion', short: 'Source imagery to frames' },
    { stage: 'background_frames', label: 'Backgrounds', short: 'Background reference generation' },
    { stage: 'preprocess_frames', label: 'Preprocessing', short: 'Frame correction and normalization' },
    { stage: 'segment', label: 'Candidate ROIs', short: 'Thresholding and candidate detection' },
    { stage: 'roi_refinement', label: 'ROI refinement', short: 'Candidate-to-refined ROI promotion' },
    { stage: 'classify', label: 'ML evidence', short: 'Oracle classification and similarity evidence' }
  ];
  const activeStatuses = ['queued', 'leased', 'working', 'paused'];
  const stoppedStatuses = ['failed', 'dead_lettered', 'cancelled'];
  const staleWorkerThresholdMs = 5 * 60 * 1000;

  let status: SystemStatus | null = $session.systemStatus;
  let summary: JobsSummaryResponse | null = null;
  let attentionSummary: JobsSummaryResponse | null = null;
  let activeJobs: Job[] = [];
  let attentionJobs: Job[] = [];
  let workers: WorkerSession[] = [];
  let loading = true;
  let refreshing = false;
  let actionError: string | null = null;
  let actionMessage: string | null = null;
  let actionKeys: Record<string, boolean> = {};
  let lastRefreshedAt: Date | null = null;
  let refreshSequence = 0;
  let lastProjectKey = '';

  $: total = summary?.total;
  $: queuedCount = number(total?.queued);
  $: runningCount = number(total?.leased) + number(total?.working);
  $: pausedCount = number(total?.paused);
  $: stoppedCount =
    number(attentionSummary?.total?.failed) +
    number(attentionSummary?.total?.dead_lettered) +
    number(attentionSummary?.total?.cancelled);
  $: activeCount = queuedCount + runningCount + pausedCount;
  $: onlineWorkers = number(status?.workers?.online) || workers.filter((worker) => !isWorkerStale(worker)).length;
  $: busyWorkers = number(status?.workers?.busy) || workers.filter((worker) => Boolean(worker.current_job_id)).length;
  $: workerUtilization = onlineWorkers > 0 ? Math.min(100, (busyWorkers / onlineWorkers) * 100) : 0;
  $: queuePressure = pressureLevel(queuedCount, onlineWorkers, workerUtilization);
  $: stageSummaries = new Map((summary?.by_stage ?? []).map((item) => [item.stage ?? '', item]));
  $: stoppedStageSummaries = new Map((attentionSummary?.by_stage ?? []).map((item) => [item.stage ?? '', item]));
  $: visibleJobs = [...attentionJobs].sort(compareJobs);
  $: availableWorkers = Math.max(0, onlineWorkers - busyWorkers);
  $: backlogPerWorker = onlineWorkers > 0 ? queuedCount / onlineWorkers : null;
  $: oldestQueuedSeconds = oldestQueuedAgeSeconds();
  $: stalledJobCount = activeJobs.filter(isPossiblyStalled).length;
  $: progressCoverage = activeJobs.length
    ? activeJobs.filter((job) => numericValue(job.progress?.total) !== null).length / activeJobs.length * 100
    : 100;
  $: projectKey = $session.project?.id ?? $session.project?.project_key ?? '';
  $: if (projectKey !== lastProjectKey) {
    lastProjectKey = projectKey;
    if (lastRefreshedAt) void refresh({ showLoading: true });
  }

  onMount(() => {
    let cancelled = false;
    const stopUsagePolling = startSystemUsagePolling();
    void refresh({ showLoading: true, cancelled: () => cancelled });
    const timer = window.setInterval(() => refresh({ cancelled: () => cancelled }), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      stopUsagePolling();
    };
  });

  async function refresh(options: { showLoading?: boolean; cancelled?: () => boolean } = {}) {
    const client = getClient();
    if (!client) return;
    const sequence = ++refreshSequence;
    if (options.showLoading || !lastRefreshedAt) loading = true;
    refreshing = true;
    try {
      const [nextStatus, nextSummary, nextAttentionSummary, nextActive, nextAttention, nextWorkers] = await Promise.all([
        client.systemStatus(projectKey || undefined),
        client.jobsSummary({ status: activeStatuses }),
        client.jobsSummary({ status: stoppedStatuses }),
        client.listJobs({
          status: activeStatuses,
          limit: 1000,
          include_progress: true,
          sort: 'updated_at',
          direction: 'desc'
        }),
        client.listJobs({
          status: stoppedStatuses,
          limit: 30,
          include_progress: true,
          sort: 'updated_at',
          direction: 'desc'
        }),
        client.listWorkers(200)
      ]);
      if (options.cancelled?.() || sequence !== refreshSequence) return;
      status = nextStatus;
      summary = nextSummary;
      attentionSummary = nextAttentionSummary;
      activeJobs = nextActive;
      attentionJobs = nextAttention;
      workers = nextWorkers;
      lastRefreshedAt = new Date();
      actionError = null;
    } catch (error) {
      if (!options.cancelled?.() && sequence === refreshSequence) {
        actionError = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (!options.cancelled?.() && sequence === refreshSequence) {
        loading = false;
        refreshing = false;
      }
    }
  }

  async function controlQueue(action: 'pause' | 'resume', stage?: string, jobId?: string) {
    const client = getClient();
    if (!client) return;
    const key = `${action}:${jobId ?? stage ?? 'all'}`;
    setAction(key, true);
    actionError = null;
    actionMessage = null;
    try {
      const result = jobId
        ? action === 'pause'
          ? { matched_count: 1, paused_count: 1, jobs: [await client.pauseJob(jobId)] }
          : { matched_count: 1, resumed_count: 1, jobs: [await client.resumeJob(jobId)] }
        : await client.controlJobs({
            action,
            stage: stage ? [stage] : undefined,
            reason: `${action === 'pause' ? 'Paused' : 'Resumed'} from PelagiaView system status.`
          });
      const count = number(result.matched_count);
      actionMessage = count
        ? `${action === 'pause' ? 'Pause applied to' : 'Resumed'} ${count} job${count === 1 ? '' : 's'}${stage ? ` in ${stageLabel(stage)}` : ''}.`
        : `No eligible jobs were available to ${action}.`;
      await refresh();
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
    } finally {
      setAction(key, false);
    }
  }

  async function cancelQueue(stage?: string, jobId?: string) {
    const client = getClient();
    if (!client) return;
    const target = jobId ? `job ${shortId(jobId)}` : stage ? `${stageLabel(stage)} queue` : 'entire active queue';
    if (!window.confirm(`Cancel ${target}? Running work will stop at its next cooperative checkpoint.`)) return;
    const key = `cancel:${jobId ?? stage ?? 'all'}`;
    setAction(key, true);
    actionError = null;
    actionMessage = null;
    try {
      const result = await client.clearJobs({
        ids: jobId ? [jobId] : undefined,
        stage: stage ? [stage] : undefined,
        mode: 'cancel',
        reason: `Cancelled ${target} from PelagiaView system status.`
      });
      const count = number(result.cancelled_count);
      actionMessage = count ? `Cancelled ${count} job${count === 1 ? '' : 's'}.` : 'No active jobs matched that selection.';
      await refresh();
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
    } finally {
      setAction(key, false);
    }
  }

  async function retryJob(job: Job) {
    const client = getClient();
    if (!client) return;
    const key = `retry:${job.id}`;
    setAction(key, true);
    try {
      await client.retryJob(job.id);
      actionMessage = `Queued ${shortId(job.id)} for retry.`;
      await refresh();
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
    } finally {
      setAction(key, false);
    }
  }

  async function clearStoppedJobs(stage?: string, jobId?: string) {
    const client = getClient();
    if (!client) return;
    const target = jobId
      ? `stopped job ${shortId(jobId)}`
      : stage
        ? `stopped ${stageLabel(stage)} jobs`
        : 'all failed, dead-lettered, and cancelled jobs';
    if (!window.confirm(`Permanently clear ${target}? Job history and associated events will be removed.`)) return;
    const key = `clear-stopped:${jobId ?? stage ?? 'all'}`;
    setAction(key, true);
    actionError = null;
    actionMessage = null;
    try {
      const result = await client.clearJobs({
        ids: jobId ? [jobId] : undefined,
        stage: stage ? [stage] : undefined,
        status: stoppedStatuses,
        mode: 'delete',
        reason: `Cleared ${target} from PelagiaView system status.`
      });
      const count = number(result.deleted_count);
      actionMessage = count
        ? `Cleared ${count} stopped job${count === 1 ? '' : 's'}.`
        : 'No stopped jobs matched that selection.';
      await refresh();
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
    } finally {
      setAction(key, false);
    }
  }

  async function shutdownWorker(worker: WorkerSession) {
    const client = getClient();
    const workerId = worker.worker_id ?? worker.id;
    if (!client || !workerId) return;
    const key = `worker:${workerId}`;
    setAction(key, true);
    try {
      await client.requestWorkerShutdown(workerId);
      actionMessage = `Shutdown requested for ${workerId}.`;
      await refresh();
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
    } finally {
      setAction(key, false);
    }
  }

  function setAction(key: string, active: boolean) {
    const next = { ...actionKeys };
    if (active) next[key] = true;
    else delete next[key];
    actionKeys = next;
  }

  function number(value: unknown): number {
    return numericValue(value) ?? 0;
  }

  function compareJobs(a: Job, b: Job): number {
    const rank = (job: Job) => job.status === 'leased' || job.status === 'working' ? 0 : job.status === 'queued' ? 1 : job.status === 'paused' ? 2 : 3;
    return rank(a) - rank(b) || Date.parse(b.updated_at ?? b.created_at ?? '') - Date.parse(a.updated_at ?? a.created_at ?? '');
  }

  function stageLabel(stage: string | null | undefined): string {
    return stages.find((item) => item.stage === stage)?.label ?? (stage ? stage.replaceAll('_', ' ') : 'Unknown job');
  }

  function stageSummary(stage: string): JobAggregateSummary {
    return stageSummaries.get(stage) ?? { stage, job_count: 0 };
  }

  function stageStoppedCount(stage: string): number {
    const item = stoppedStageSummaries.get(stage);
    return number(item?.failed) + number(item?.dead_lettered) + number(item?.cancelled);
  }

  function jobsForStage(stage: string): Job[] {
    return activeJobs.filter((job) => job.stage === stage).sort(compareJobs);
  }

  function oldestQueuedAgeSeconds(): number | null {
    const timestamps = activeJobs
      .filter((job) => job.status === 'queued')
      .map((job) => Date.parse(job.created_at ?? ''))
      .filter((value) => Number.isFinite(value));
    return timestamps.length ? Math.max(0, (Date.now() - Math.min(...timestamps)) / 1000) : null;
  }

  function isPossiblyStalled(job: Job): boolean {
    if (!['leased', 'working'].includes(job.status ?? '')) return false;
    const updatedAt = Date.parse(job.updated_at ?? '');
    return Number.isFinite(updatedAt) && Date.now() - updatedAt > 2 * 60 * 1000;
  }

  function ageLabel(seconds: number | null): string {
    if (seconds === null) return 'No backlog';
    if (seconds < 60) return `${Math.floor(seconds)} sec`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
  }

  function stageRunning(item: JobAggregateSummary): number {
    return number(item.leased) + number(item.working);
  }

  function stageActive(item: JobAggregateSummary): number {
    return number(item.queued) + stageRunning(item);
  }

  function progressPercent(job: Job): number | null {
    const explicit = numericValue(job.progress?.percent);
    if (explicit !== null) return Math.max(0, Math.min(100, explicit));
    const total = numericValue(job.progress?.total);
    const completed = numericValue(job.progress?.completed);
    return total && completed !== null ? Math.max(0, Math.min(100, completed / total * 100)) : null;
  }

  function summaryPercent(item: JobAggregateSummary): number | null {
    const value = numericValue(item.progress?.percent);
    return value === null ? null : Math.max(0, Math.min(100, value));
  }

  function jobRate(job: Job): number | null {
    return numericValue(job.progress?.rates?.units_per_second);
  }

  function stageRate(stage: string): number | null {
    const rates = activeJobs.filter((job) => job.stage === stage && ['leased', 'working'].includes(job.status ?? '')).map(jobRate).filter((value): value is number => value !== null && value > 0);
    return rates.length ? rates.reduce((sum, value) => sum + value, 0) : null;
  }

  function rateLabel(rate: number | null, unit = 'units'): string {
    if (rate === null || rate <= 0) return '—';
    const value = rate >= 100 ? rate.toFixed(0) : rate >= 10 ? rate.toFixed(1) : rate.toFixed(2);
    return `${value} ${singularUnit(unit)}/s`;
  }

  function singularUnit(unit: string | null | undefined): string {
    const value = unit || 'unit';
    return value.endsWith('s') ? value.slice(0, -1) : value;
  }

  function etaLabel(job: Job): string {
    if (job.status === 'queued') return 'Awaiting worker';
    if (job.status === 'paused') return 'Paused';
    if (job.status === 'failed' || job.status === 'dead_lettered') return 'Stopped';
    const total = numericValue(job.progress?.total);
    const completed = numericValue(job.progress?.completed);
    const rate = jobRate(job);
    if (total === null || completed === null || rate === null || rate <= 0) return 'Calculating';
    return formatDuration(Math.max(0, (total - completed) / rate));
  }

  function formatDuration(seconds: number): string {
    if (seconds < 60) return `${Math.ceil(seconds)} sec`;
    if (seconds < 3600) return `${Math.ceil(seconds / 60)} min`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.ceil((seconds % 3600) / 60)}m`;
    return `${Math.floor(seconds / 86400)}d ${Math.ceil((seconds % 86400) / 3600)}h`;
  }

  function jobProgressLabel(job: Job): string {
    const completed = numericValue(job.progress?.completed);
    const total = numericValue(job.progress?.total);
    const unit = job.progress?.unit ?? 'units';
    if (completed !== null && total !== null) return `${formatCount(completed)} / ${formatCount(total)} ${unit}`;
    return job.progress?.message ?? job.summary ?? 'Progress not reported';
  }

  function displayStatus(job: Job): string {
    if ((job.control_reason ?? '').startsWith('pause_requested:')) return 'pausing';
    return job.status ?? 'unknown';
  }

  function userLabel(job: Job): string {
    return job.submitted_by_username ?? 'System / legacy';
  }

  function shortId(value: string | null | undefined): string {
    return value ? value.slice(0, 8) : '—';
  }

  function isWorkerStale(worker: WorkerSession): boolean {
    const value = worker.last_heartbeat_at ?? worker.last_heartbeat;
    if (!value) return false;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && Date.now() - parsed > staleWorkerThresholdMs;
  }

  function workerCapabilities(worker: WorkerSession): string {
    const value = worker.capabilities ?? worker.capability;
    return Array.isArray(value) ? value.join(', ') || 'Any stage' : value || 'Any stage';
  }

  function pressureLevel(queued: number, online: number, utilization: number): 'low' | 'moderate' | 'high' {
    if (!online || queued > online * 4 || utilization >= 90) return queued || utilization ? 'high' : 'low';
    if (queued > online || utilization >= 70) return 'moderate';
    return 'low';
  }

  function cpuPercent(): number | null {
    const utilization = numericValue($systemUsageState.usage?.cpu?.utilization_percent);
    if (utilization !== null) return utilization;
    const load = numericValue($systemUsageState.usage?.cpu?.load_average?.one_minute);
    const cpus = numericValue($systemUsageState.usage?.cpu?.logical_cpus);
    return load !== null && cpus ? load * 100 / cpus : null;
  }

  function memoryPercent(): number | null {
    return numericValue($systemUsageState.usage?.memory?.used_percent);
  }

  function diskUsage(): SystemUsageFilesystem | null {
    const storage = $systemUsageState.usage?.storage;
    return storage?.kvstore_directory ?? storage?.raw_assets_default ?? storage?.database?.storage?.filesystem ?? null;
  }

  function percentLabel(value: number | null): string {
    return value === null ? '—' : `${Math.round(value)}%`;
  }

  function refreshedLabel(): string {
    return lastRefreshedAt ? lastRefreshedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Not yet';
  }
</script>

<div class="operations-page" aria-busy={loading}>
  <header class="operations-header">
    <div>
      <h1>System status</h1>
      <p>Live processing pressure, queue progress, and worker capacity for the active project.</p>
    </div>
    <div class="header-actions">
      <span class="refresh-state"><i class:active={refreshing}></i> Updated {refreshedLabel()}</span>
      <button type="button" class="quiet" on:click={() => refresh({ showLoading: true })} disabled={refreshing}>Refresh</button>
    </div>
  </header>

  {#if actionError}<div class="notice error" role="alert">{actionError}</div>{/if}
  {#if actionMessage}<div class="notice success" role="status">{actionMessage}</div>{/if}

  <section class="pressure-strip" aria-label="System pressure summary">
    <article class="pressure-primary {queuePressure}">
      <span>Processing pressure</span>
      <strong>{queuePressure}</strong>
      <small>{queuedCount} queued · {busyWorkers}/{onlineWorkers} workers busy</small>
    </article>
    <article><span>Active jobs</span><strong>{formatCount(activeCount)}</strong><small>{runningCount} running · {pausedCount} paused</small></article>
    <article><span>Workers</span><strong>{formatCount(onlineWorkers)}</strong><small>{Math.round(workerUtilization)}% utilized · {workers.filter(isWorkerStale).length} stale</small></article>
    <article><span>Stopped jobs</span><strong class:bad={stoppedCount > 0}>{formatCount(stoppedCount)}</strong><small>failed, dead-lettered, or cancelled</small></article>
    <article><span>Host</span><strong>{percentLabel(cpuPercent())} CPU</strong><small>{percentLabel(memoryPercent())} memory · {diskUsage()?.free_bytes ? formatBytes(number(diskUsage()?.free_bytes)) : '—'} free</small></article>
    <article><span>Services</span><strong class:bad={!status?.postgres?.healthy}>{status?.postgres?.healthy ? 'Operational' : 'Degraded'}</strong><small>Database {status?.postgres?.healthy ? 'online' : 'offline'} · store {status?.kvstore?.initialized ? 'ready' : 'not ready'}</small></article>
  </section>

  <div class="operations-main-grid">
    <section class="section-shell stages-section">
      <div class="section-heading">
        <div><h2>Pipeline queues</h2><p>Expand a stage to inspect and control its active jobs.</p></div>
        <div class="queue-controls" aria-label="Global queue controls">
          <button class="quiet" type="button" on:click={() => controlQueue('pause')} disabled={runningCount + queuedCount === 0 || actionKeys['pause:all']}>Pause all</button>
          <button class="quiet" type="button" on:click={() => controlQueue('resume')} disabled={pausedCount === 0 || actionKeys['resume:all']}>Resume all</button>
          <button class="danger" type="button" on:click={() => cancelQueue()} disabled={activeCount === 0 || actionKeys['cancel:all']}>Cancel all</button>
        </div>
      </div>
      <div class="stage-menus" aria-label="Pipeline queue status">
        {#each stages as definition}
          {@const item = stageSummary(definition.stage)}
          {@const percent = summaryPercent(item)}
          {@const stageJobs = jobsForStage(definition.stage)}
          <details class="stage-menu">
            <summary>
              <div class="stage-name"><strong>{definition.label}</strong><small>{definition.short}</small></div>
              <div class="stage-counts"><strong>{stageJobs.length} active</strong><small><b>{stageRunning(item)}</b> running · {number(item.queued)} queued · {number(item.paused)} paused</small></div>
              <div class="aggregate-progress">
                <div class="progress-track" class:indeterminate={percent === null && stageActive(item) > 0}><i style={`width:${percent ?? 32}%`}></i></div>
                <small>{percent === null ? (stageActive(item) ? 'Waiting for unit totals' : 'No active work') : `${Math.round(percent)}% · ${formatCount(item.progress?.completed_units)} / ${formatCount(item.progress?.known_total_units)}`}</small>
              </div>
              <div class="throughput"><strong>{rateLabel(stageRate(definition.stage), stageJobs[0]?.progress?.unit)}</strong><small>observed now</small></div>
              <span class="stage-chevron" aria-hidden="true">⌄</span>
            </summary>
            <div class="stage-menu-body">
              <div class="stage-toolbar">
                <span>{stageStoppedCount(definition.stage)} stopped job{stageStoppedCount(definition.stage) === 1 ? '' : 's'}</span>
                <div class="row-actions">
                  {#if stageActive(item) > 0}<button class="quiet" type="button" on:click={() => controlQueue('pause', definition.stage)} disabled={actionKeys[`pause:${definition.stage}`]}>Pause stage</button>{/if}
                  {#if number(item.paused) > 0}<button class="quiet" type="button" on:click={() => controlQueue('resume', definition.stage)} disabled={actionKeys[`resume:${definition.stage}`]}>Resume stage</button>{/if}
                  <button class="danger-text" type="button" on:click={() => cancelQueue(definition.stage)} disabled={stageJobs.length === 0 || actionKeys[`cancel:${definition.stage}`]}>Cancel stage</button>
                  {#if stageStoppedCount(definition.stage) > 0}<button class="danger-text" type="button" on:click={() => clearStoppedJobs(definition.stage)} disabled={actionKeys[`clear-stopped:${definition.stage}`]}>Clear stopped</button>{/if}
                </div>
              </div>
              <div class="stage-job-list">
                {#each stageJobs as job (job.id)}
                  {@const jobPercent = progressPercent(job)}
                  <article class="stage-job {displayStatus(job)}">
                    <header>
                      <div class="job-identity"><span class="status-badge">{displayStatus(job)}</span><strong>{job.progress?.message ?? job.summary ?? `Job ${shortId(job.id)}`}</strong><code title={job.id}>{shortId(job.id)}</code></div>
                      <div class="job-actions">
                        {#if job.status === 'queued' || job.status === 'leased' || job.status === 'working'}<button class="quiet" type="button" on:click={() => controlQueue('pause', undefined, job.id)} disabled={actionKeys[`pause:${job.id}`]}>Pause</button>{/if}
                        {#if job.status === 'paused'}<button class="quiet" type="button" on:click={() => controlQueue('resume', undefined, job.id)} disabled={actionKeys[`resume:${job.id}`]}>Resume</button>{/if}
                        <button class="danger-text" type="button" on:click={() => cancelQueue(undefined, job.id)} disabled={actionKeys[`cancel:${job.id}`]}>Cancel</button>
                      </div>
                    </header>
                    <div class="stage-job-progress">
                      <div class="progress-track" class:indeterminate={jobPercent === null && ['leased', 'working'].includes(job.status ?? '')}><i style={`width:${jobPercent ?? 32}%`}></i></div>
                      <strong>{jobPercent === null ? '—' : `${Math.round(jobPercent)}%`}</strong>
                    </div>
                    <div class="stage-job-metadata">
                      <span><small>ETA</small><b>{etaLabel(job)}</b></span>
                      <span><small>User</small><b>{userLabel(job)}</b></span>
                      <span><small>Worker</small><b>{job.worker_id ? shortId(job.worker_id) : 'Unassigned'}</b></span>
                      <span><small>Rate</small><b>{rateLabel(jobRate(job), job.progress?.unit)}</b></span>
                    </div>
                  </article>
                {:else}
                  <div class="stage-empty">No active jobs in this stage.</div>
                {/each}
              </div>
            </div>
          </details>
        {/each}
      </div>
    </section>

    <aside class="section-shell indicators-panel">
      <div class="section-heading"><div><h2>Live indicators</h2><p>Derived from the current queue and worker snapshot.</p></div></div>
      <div class="indicator-list">
        <article><span>Capacity headroom</span><strong>{availableWorkers}</strong><small>online workers not currently busy</small></article>
        <article><span>Backlog per worker</span><strong>{backlogPerWorker === null ? '—' : backlogPerWorker.toFixed(backlogPerWorker >= 10 ? 0 : 1)}</strong><small>queued jobs / online workers</small></article>
        <article><span>Oldest queued</span><strong>{ageLabel(oldestQueuedSeconds)}</strong><small>time since the oldest queued submission</small></article>
        <article class:warning={stalledJobCount > 0}><span>Possible stalls</span><strong>{stalledJobCount}</strong><small>running jobs without an update for 2 minutes</small></article>
        <article><span>Progress coverage</span><strong>{Math.round(progressCoverage)}%</strong><small>active jobs reporting a unit total</small></article>
      </div>
      <div class="rate-list">
        <h3>Observed throughput</h3>
        {#each stages.filter((definition) => stageRate(definition.stage) !== null) as definition}
          <div><span>{definition.label}</span><strong>{rateLabel(stageRate(definition.stage), jobsForStage(definition.stage)[0]?.progress?.unit)}</strong></div>
        {:else}<p>No running job has reported throughput yet.</p>{/each}
      </div>
      <p class="indicator-note">These are live operational signals, not historical performance guarantees.</p>
    </aside>
  </div>

  <section class="section-shell jobs-section">
    <div class="section-heading">
      <div><h2>Stopped jobs</h2><p>Recent failed, dead-lettered, and cancelled work retained for review.</p></div>
      <div class="jobs-heading-actions">
        <span class="section-count">{visibleJobs.length} shown</span>
        <button class="danger" type="button" on:click={() => clearStoppedJobs()} disabled={stoppedCount === 0 || actionKeys['clear-stopped:all']}>Clear stopped ({stoppedCount})</button>
      </div>
    </div>
    <div class="job-list">
      {#each visibleJobs as job (job.id)}
        {@const percent = progressPercent(job)}
        <article class="job-card {displayStatus(job)}">
          <header>
            <div class="job-identity"><span class="status-badge">{displayStatus(job)}</span><strong>{stageLabel(job.stage)}</strong><code title={job.id}>{shortId(job.id)}</code></div>
            <div class="job-actions">
              {#if job.status === 'queued' || job.status === 'leased' || job.status === 'working'}<button class="quiet" type="button" on:click={() => controlQueue('pause', undefined, job.id)} disabled={actionKeys[`pause:${job.id}`]}>Pause</button>{/if}
              {#if job.status === 'paused'}<button class="quiet" type="button" on:click={() => controlQueue('resume', undefined, job.id)} disabled={actionKeys[`resume:${job.id}`]}>Resume</button>{/if}
              {#if job.status === 'failed' || job.status === 'dead_lettered'}<button class="quiet" type="button" on:click={() => retryJob(job)} disabled={actionKeys[`retry:${job.id}`]}>Retry</button>{/if}
              {#if activeStatuses.includes(job.status ?? '')}<button class="danger-text" type="button" on:click={() => cancelQueue(undefined, job.id)} disabled={actionKeys[`cancel:${job.id}`]}>Cancel</button>{/if}
              {#if stoppedStatuses.includes(job.status ?? '')}<button class="danger-text" type="button" on:click={() => clearStoppedJobs(undefined, job.id)} disabled={actionKeys[`clear-stopped:${job.id}`]}>Clear</button>{/if}
            </div>
          </header>
          <p class="job-summary">{job.progress?.message ?? job.summary ?? 'No job summary provided.'}</p>
          <div class="job-progress-line">
            <div class="progress-track" class:indeterminate={percent === null && ['leased', 'working'].includes(job.status ?? '')}><i style={`width:${percent ?? 32}%`}></i></div>
            <strong>{percent === null ? '—' : `${Math.round(percent)}%`}</strong>
          </div>
          <div class="job-metadata">
            <span><small>Status</small><b>{displayStatus(job)}</b></span>
            <span><small>ETA</small><b>{etaLabel(job)}</b></span>
            <span><small>User</small><b>{userLabel(job)}</b></span>
            <span><small>Job type</small><b>{stageLabel(job.stage)}</b></span>
            <span><small>Progress</small><b>{jobProgressLabel(job)}</b></span>
            <span><small>Throughput</small><b>{rateLabel(jobRate(job), job.progress?.unit)}</b></span>
            <span><small>Worker</small><b title={job.worker_id ?? ''}>{job.worker_id ? shortId(job.worker_id) : 'Unassigned'}</b></span>
            <span><small>Updated</small><b>{formatDate(job.updated_at ?? job.created_at)}</b></span>
          </div>
          {#if job.error_message}<p class="job-error">{job.error_message}</p>{/if}
        </article>
      {:else}
        <div class="empty-state"><strong>No active or stopped jobs</strong><p>The pipeline is idle and no failed, dead-lettered, or cancelled jobs remain.</p></div>
      {/each}
    </div>
  </section>

  <details class="section-shell workers-section">
    <summary><span><strong>Worker sessions</strong><small>{busyWorkers} busy · {onlineWorkers} online · {workers.length} registered</small></span><span>Inspect workers</span></summary>
    <div class="worker-table">
      <div class="worker-row worker-head"><span>Worker</span><span>Status</span><span>Capability</span><span>Current job</span><span>Heartbeat</span><span></span></div>
      {#each workers as worker}
        {@const workerId = worker.worker_id ?? worker.id}
        <div class="worker-row" class:stale={isWorkerStale(worker)}>
          <code title={workerId}>{workerId}</code>
          <span><i class="worker-dot"></i>{isWorkerStale(worker) ? 'stale' : worker.status ?? 'unknown'}</span>
          <span>{workerCapabilities(worker)}</span>
          <code>{shortId(worker.current_job_id)}</code>
          <span>{formatDate(worker.last_heartbeat_at ?? worker.last_heartbeat)}</span>
          <button class="quiet" type="button" on:click={() => shutdownWorker(worker)} disabled={worker.shutdown_requested || actionKeys[`worker:${workerId}`]}>{worker.shutdown_requested ? 'Requested' : 'Shutdown'}</button>
        </div>
      {:else}<div class="empty-state"><p>No worker sessions reported.</p></div>{/each}
    </div>
  </details>
</div>

<style>
  .operations-page{display:grid;gap:12px;max-width:1800px;margin:0 auto;padding:2px 0 18px;color:var(--wb-text);font-size:16px}
  .operations-header,.section-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.operations-header{padding:2px 2px 7px;border-bottom:1px solid var(--wb-divider)}
  h1,h2,p{margin:0}.operations-header h1{font-size:1.6rem;letter-spacing:-.025em}.operations-header p,.section-heading p{margin-top:4px;color:var(--wb-text-secondary);font-size:.9rem;line-height:1.5}
  button{min-height:34px;border:1px solid var(--wb-divider-strong);border-radius:4px;padding:6px 11px;color:var(--wb-text);background:var(--wb-surface);font:inherit;font-size:.82rem;font-weight:750;cursor:pointer}button:hover:not(:disabled){border-color:var(--wb-accent);color:var(--wb-accent-strong)}button:disabled{opacity:.42;cursor:not-allowed}.quiet{background:transparent}.danger{border-color:color-mix(in srgb,var(--wb-bad) 45%,var(--wb-divider));color:var(--wb-bad)}.danger-text{border-color:transparent;color:var(--wb-bad);background:transparent}
  .header-actions,.queue-controls,.row-actions,.job-actions,.jobs-heading-actions{display:flex;align-items:center;flex-wrap:wrap;gap:6px}.refresh-state{display:flex;align-items:center;gap:6px;color:var(--wb-text-muted);font-size:.8rem}.refresh-state i{width:8px;height:8px;border-radius:50%;background:var(--wb-good)}.refresh-state i.active{animation:pulse 1s ease-in-out infinite}
  .notice{border-left:3px solid var(--wb-good);padding:10px 12px;background:color-mix(in srgb,var(--wb-good) 8%,var(--wb-surface));font-size:.86rem}.notice.error{border-color:var(--wb-bad);color:var(--wb-bad);background:color-mix(in srgb,var(--wb-bad) 8%,var(--wb-surface))}
  .pressure-strip{display:grid;grid-template-columns:1.25fr repeat(5,minmax(125px,1fr));border:1px solid var(--wb-divider);background:var(--wb-surface)}.pressure-strip article{display:grid;align-content:center;min-height:88px;border-left:1px solid var(--wb-divider);padding:11px 13px}.pressure-strip article:first-child{border-left:0}.pressure-strip span{color:var(--wb-text-muted);font-size:.72rem;font-weight:850;letter-spacing:.065em;text-transform:uppercase}.pressure-strip strong{margin-top:3px;font-size:1.18rem}.pressure-strip small{margin-top:4px;color:var(--wb-text-secondary);font-size:.76rem;line-height:1.4}.pressure-primary{border-top:3px solid var(--wb-good)}.pressure-primary.moderate{border-top-color:var(--wb-warn)}.pressure-primary.high{border-top-color:var(--wb-bad)}.pressure-primary strong{text-transform:capitalize}.bad{color:var(--wb-bad)!important}
  .section-shell{min-width:0;border:1px solid var(--wb-divider);background:var(--wb-surface)}.section-heading{align-items:center;padding:12px 13px;border-bottom:1px solid var(--wb-divider)}.section-heading h2{font-size:1.14rem}.section-count{color:var(--wb-text-muted);font-size:.8rem}
  .operations-main-grid{display:grid;grid-template-columns:minmax(0,1.8fr)minmax(300px,.7fr);gap:12px;align-items:start}.stage-menus{display:grid}.stage-menu{border-bottom:1px solid var(--wb-divider)}.stage-menu:last-child{border-bottom:0}.stage-menu>summary{display:grid;grid-template-columns:minmax(155px,.9fr)minmax(165px,.9fr)minmax(190px,1.25fr)minmax(115px,.65fr)18px;gap:14px;align-items:center;min-height:72px;padding:10px 12px}.stage-menu>summary:hover{background:var(--wb-surface-subtle)}.stage-menu[open]>summary{background:color-mix(in srgb,var(--wb-accent) 5%,var(--wb-surface))}.stage-name,.stage-counts,.throughput{display:grid;min-width:0}.stage-name strong{font-size:.92rem}.stage-name small,.stage-counts small,.throughput small,.aggregate-progress small{overflow:hidden;margin-top:3px;color:var(--wb-text-muted);font-size:.74rem;line-height:1.4;text-overflow:ellipsis;white-space:nowrap}.stage-counts strong,.throughput strong{font-size:.9rem}.stage-counts b{color:var(--wb-accent-strong)}.stage-chevron{color:var(--wb-text-muted);font-size:1rem;transition:transform .15s ease}.stage-menu[open] .stage-chevron{transform:rotate(180deg)}.stage-menu-body{border-top:1px solid var(--wb-divider);background:var(--wb-surface-subtle)}.stage-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;border-bottom:1px solid var(--wb-divider);color:var(--wb-text-muted);font-size:.75rem}.stage-job-list{display:grid;gap:1px}.stage-job{display:grid;gap:8px;padding:11px 12px;border-left:3px solid var(--wb-accent);background:var(--wb-surface)}.stage-job.queued{border-left-color:var(--wb-text-muted)}.stage-job.paused,.stage-job.pausing{border-left-color:var(--wb-warn)}.stage-job>header{display:flex;align-items:center;justify-content:space-between;gap:10px}.stage-job-progress{display:grid;grid-template-columns:minmax(0,1fr)48px;gap:10px;align-items:center}.stage-job-progress>strong{font-size:.78rem;text-align:right}.stage-job-metadata{display:grid;grid-template-columns:repeat(4,minmax(90px,1fr));gap:10px}.stage-job-metadata span{display:grid;min-width:0}.stage-job-metadata small{color:var(--wb-text-muted);font-size:.66rem;font-weight:800;letter-spacing:.045em;text-transform:uppercase}.stage-job-metadata b{overflow:hidden;margin-top:2px;font-size:.78rem;text-overflow:ellipsis;white-space:nowrap}.stage-empty{padding:18px 12px;color:var(--wb-text-muted);font-size:.78rem;text-align:center}
  .indicators-panel{position:sticky;top:8px}.indicator-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.indicator-list article{display:grid;align-content:start;min-height:110px;padding:13px;border-right:1px solid var(--wb-divider);border-bottom:1px solid var(--wb-divider)}.indicator-list article:nth-child(even){border-right:0}.indicator-list article.warning{border-left:3px solid var(--wb-warn);background:color-mix(in srgb,var(--wb-warn) 6%,var(--wb-surface))}.indicator-list span{color:var(--wb-text-muted);font-size:.75rem;font-weight:850;letter-spacing:.05em;text-transform:uppercase}.indicator-list strong{margin-top:5px;font-size:1.3rem}.indicator-list small{margin-top:4px;color:var(--wb-text-secondary);font-size:.8rem;line-height:1.45}.rate-list{padding:13px}.rate-list h3{margin:0 0 7px;font-size:.94rem}.rate-list>div{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--wb-divider);font-size:.84rem}.rate-list>div:last-of-type{border-bottom:0}.rate-list p,.indicator-note{color:var(--wb-text-muted);font-size:.8rem;line-height:1.5}.indicator-note{margin:0;padding:0 13px 13px}
  .progress-track{height:7px;overflow:hidden;border-radius:99px;background:var(--wb-divider)}.progress-track i{display:block;height:100%;border-radius:inherit;background:var(--wb-accent);transition:width .3s ease}.progress-track.indeterminate i{animation:indeterminate 1.35s ease-in-out infinite}.row-actions{justify-content:flex-end}
  .job-list{display:grid}.job-card{display:grid;gap:9px;padding:13px;border-bottom:1px solid var(--wb-divider);border-left:3px solid var(--wb-accent)}.job-card:last-child{border-bottom:0}.job-card.queued{border-left-color:var(--wb-text-muted)}.job-card.paused,.job-card.pausing{border-left-color:var(--wb-warn)}.job-card.failed,.job-card.dead_lettered,.job-card.cancelled{border-left-color:var(--wb-bad);background:color-mix(in srgb,var(--wb-bad) 3%,var(--wb-surface))}.job-card>header{display:flex;align-items:center;justify-content:space-between;gap:10px}.job-identity{display:flex;align-items:center;gap:8px;min-width:0}.job-identity strong{overflow:hidden;font-size:.94rem;text-overflow:ellipsis;white-space:nowrap}.job-identity code{color:var(--wb-text-muted);font-size:.75rem}.status-badge{border-radius:99px;padding:4px 7px;color:var(--wb-accent-strong);background:var(--wb-accent-soft);font-size:.68rem;font-weight:850;letter-spacing:.05em;text-transform:uppercase}.paused .status-badge,.pausing .status-badge{color:var(--wb-warn);background:color-mix(in srgb,var(--wb-warn) 13%,transparent)}.failed .status-badge,.dead_lettered .status-badge,.cancelled .status-badge{color:var(--wb-bad);background:color-mix(in srgb,var(--wb-bad) 12%,transparent)}.job-summary{overflow:hidden;color:var(--wb-text-secondary);font-size:.85rem;line-height:1.45;text-overflow:ellipsis;white-space:nowrap}.job-progress-line{display:grid;grid-template-columns:minmax(0,1fr)48px;gap:10px;align-items:center}.job-progress-line strong{font-size:.8rem;text-align:right}.job-metadata{display:grid;grid-template-columns:repeat(8,minmax(100px,1fr));gap:10px}.job-metadata span{display:grid;min-width:0}.job-metadata small{color:var(--wb-text-muted);font-size:.68rem;font-weight:800;letter-spacing:.05em;text-transform:uppercase}.job-metadata b{overflow:hidden;margin-top:2px;font-size:.78rem;font-weight:650;text-overflow:ellipsis;white-space:nowrap}.job-error{border-left:2px solid var(--wb-bad);padding-left:8px;color:var(--wb-bad);font-size:.8rem;line-height:1.45;overflow-wrap:anywhere}
  .workers-section>summary{display:flex;align-items:center;justify-content:space-between;min-height:54px;padding:10px 13px;cursor:pointer;list-style:none}.workers-section>summary::-webkit-details-marker,.stage-menu>summary::-webkit-details-marker{display:none}.workers-section>summary span:first-child{display:grid}.workers-section>summary strong{font-size:.94rem}.workers-section>summary small,.workers-section>summary span:last-child{color:var(--wb-text-muted);font-size:.77rem}.worker-table{border-top:1px solid var(--wb-divider)}.worker-row{display:grid;grid-template-columns:minmax(160px,1.4fr)100px minmax(150px,1.2fr)100px 165px 85px;gap:10px;align-items:center;min-height:46px;padding:7px 13px;border-bottom:1px solid var(--wb-divider);font-size:.78rem}.worker-row:last-child{border-bottom:0}.worker-head{min-height:33px;color:var(--wb-text-muted);background:var(--wb-surface-subtle);font-size:.68rem;font-weight:850;text-transform:uppercase}.worker-row code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.worker-row.stale{color:var(--wb-warn)}.worker-dot{display:inline-block;width:7px;height:7px;margin-right:5px;border-radius:50%;background:var(--wb-good)}.stale .worker-dot{background:var(--wb-warn)}
  .empty-state{padding:32px;color:var(--wb-text-muted);text-align:center}.empty-state strong{color:var(--wb-text);font-size:.96rem}.empty-state p{margin-top:4px;font-size:.83rem}
  @keyframes pulse{50%{opacity:.25}}@keyframes indeterminate{0%{transform:translateX(-120%)}100%{transform:translateX(330%)}}
  @media(max-width:1250px){.pressure-strip{grid-template-columns:repeat(3,1fr)}.pressure-strip article:nth-child(4){border-left:0;border-top:1px solid var(--wb-divider)}.pressure-strip article:nth-child(n+4){border-top:1px solid var(--wb-divider)}.job-metadata{grid-template-columns:repeat(4,minmax(100px,1fr))}.stage-menu>summary{grid-template-columns:minmax(145px,.9fr)minmax(155px,.9fr)minmax(180px,1.2fr)18px}.stage-menu .throughput{display:none}.worker-row{grid-template-columns:minmax(140px,1.3fr)90px minmax(130px,1fr)90px 150px 75px}}
  @media(max-width:1050px){.operations-main-grid{grid-template-columns:minmax(0,1fr)}.indicators-panel{position:static}.indicator-list{grid-template-columns:repeat(3,minmax(0,1fr))}.indicator-list article:nth-child(even){border-right:1px solid var(--wb-divider)}.indicator-list article:nth-child(3n){border-right:0}}
  @media(max-width:850px){.operations-header,.section-heading{align-items:stretch;flex-direction:column}.header-actions,.queue-controls{justify-content:space-between}.stage-menu>summary{grid-template-columns:minmax(0,1fr)auto 18px;gap:8px}.stage-menu .stage-name{grid-column:1}.stage-menu .stage-counts{grid-column:2;text-align:right}.stage-menu .aggregate-progress{grid-column:1/3}.stage-menu .stage-chevron{grid-column:3;grid-row:1/3;align-self:center}.stage-toolbar{align-items:flex-start;flex-direction:column}.row-actions{justify-content:flex-start}.stage-job-metadata{grid-template-columns:repeat(2,minmax(100px,1fr))}.job-metadata{grid-template-columns:repeat(2,minmax(100px,1fr))}.worker-table{overflow-x:auto}.worker-row{min-width:780px}}
  @media(max-width:560px){.pressure-strip,.indicator-list{grid-template-columns:repeat(2,1fr)}.pressure-strip article:nth-child(odd),.indicator-list article:nth-child(odd){border-left:0;border-right:1px solid var(--wb-divider)}.pressure-strip article:nth-child(n+3){border-top:1px solid var(--wb-divider)}.indicator-list article:nth-child(even){border-right:0}.stage-menu>summary{grid-template-columns:minmax(0,1fr)18px}.stage-menu .stage-name{grid-column:1}.stage-menu .stage-counts{grid-column:1;text-align:left}.stage-menu .aggregate-progress{grid-column:1}.stage-menu .stage-chevron{grid-column:2;grid-row:1/4}.stage-job>header,.job-card>header{align-items:flex-start;flex-direction:column}.job-actions{width:100%}.job-actions button{flex:1}.stage-job-metadata,.job-metadata{grid-template-columns:minmax(0,1fr)}.operations-page{gap:9px}.section-heading,.job-card{padding-left:10px;padding-right:10px}}

</style>
