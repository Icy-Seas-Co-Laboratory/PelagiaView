<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import ActiveJobsPanel from '$lib/components/ActiveJobsPanel.svelte';
  import AttentionPanel from '$lib/components/AttentionPanel.svelte';
  import QueueStatusSummary from '$lib/components/QueueStatusSummary.svelte';
  import StageStatusCard from '$lib/components/StageStatusCard.svelte';
  import { getClient, session } from '$lib/stores/session';
  import type { Job, JobsSummaryResponse, KvStoreOverview, SystemStatus, WorkerSession } from '$lib/api/types';
  import { formatBytes, formatCount, formatDate, numericValue, statusTone } from '$lib/utils/format';
  import { dashboardViewHref, type DashboardView } from '$lib/utils/dashboardNavigation';
  import { projectPreferenceKey } from '$lib/utils/preferences';

  let status: SystemStatus | null = $session.systemStatus;
  let jobs: Job[] = [];
  let workers: WorkerSession[] = [];
  let kvstore: KvStoreOverview | null = null;
  let globalSummary: JobsSummaryResponse | null = null;
  let loading = true;
  let refreshing = false;
  let clearingQueue = false;
  let clearingReview = false;
  let clearingStages: Record<string, boolean> = {};
  let actionError: string | null = null;
  let lastRefreshedAt: Date | null = null;
  let refreshSequence = 0;
  let lastStatusProjectKey = '';
  let workerSortColumn: WorkerSortColumn = 'worker';
  let workerSortDirection: SortDirection = 'asc';
  let workerPage = 1;
  let workerPreferencesReady = false;
  const workerPageSize = 5;
  const staleWorkerThresholdMs = 5 * 60 * 1000;
  const terminalReviewStatuses = ['failed', 'dead_lettered'];
  const pausedReviewStatuses = ['paused'];
  const stageCards: Array<{
    title: string;
    detail: string;
    stage: string;
    view: DashboardView;
  }> = [
    {
      title: 'Ingestion',
      detail: 'Raw videos and image folders become frame records.',
      stage: 'extract_frames',
      view: 'ingestion'
    },
    {
      title: 'Preprocessing',
      detail: 'Frames receive background, flatfield, crop, mask, and inversion processing.',
      stage: 'preprocess_frames',
      view: 'preprocessing'
    },
    {
      title: 'Candidate ROIs',
      detail: 'Thresholding and candidate assembly create first-pass detections.',
      stage: 'segment',
      view: 'segmentation'
    },
    {
      title: 'ROI Refinement',
      detail: 'Candidate masks are refined into final ROI detections.',
      stage: 'roi_refinement',
      view: 'roi_refinement'
    }
  ];

  type WorkerSortColumn = 'worker' | 'status' | 'capability' | 'current_job' | 'heartbeat' | 'started';
  type SortDirection = 'asc' | 'desc';

  $: sortedWorkers = sortedWorkerSessions(workers, workerSortColumn, workerSortDirection);
  $: workerPageCount = Math.max(1, Math.ceil(sortedWorkers.length / workerPageSize));
  $: if (workerPage > workerPageCount) workerPage = workerPageCount;
  $: pagedWorkers = sortedWorkers.slice((workerPage - 1) * workerPageSize, workerPage * workerPageSize);
  $: workerPageStart = sortedWorkers.length ? (workerPage - 1) * workerPageSize + 1 : 0;
  $: workerPageEnd = Math.min(workerPage * workerPageSize, sortedWorkers.length);
  $: workerPreferenceSnapshot = {
    workerSortColumn,
    workerSortDirection,
    workerPage
  };
  $: if (workerPreferencesReady) persistWorkerPreferences(workerPreferenceSnapshot);
  $: globalTotal = globalSummary?.total;
  $: queuedJobCount = numericValue(globalTotal?.queued) ?? 0;
  $: runningJobCount = numericValue(globalTotal?.leased) ?? 0;
  $: currentQueueCount = queuedJobCount + runningJobCount + pausedJobCount;
  $: failedJobCount =
    (numericValue(globalTotal?.failed) ?? 0) +
    (numericValue(globalTotal?.dead_lettered) ?? 0);
  $: pausedJobCount = numericValue(globalTotal?.paused) ?? 0;
  $: staleWorkerCount = workers.filter(isWorkerStale).length;
  $: attentionCount = failedJobCount + pausedJobCount + staleWorkerCount;
  $: statusProjectKey = $session.project?.id ?? $session.project?.project_key ?? '';
  $: if (statusProjectKey !== lastStatusProjectKey) {
    lastStatusProjectKey = statusProjectKey;
    if (lastRefreshedAt) void refreshStatus({ showLoading: true });
  }

  onMount(() => {
    let cancelled = false;
    restoreWorkerPreferences();
    workerPreferencesReady = true;
    void refreshStatus({ showLoading: true, isCancelled: () => cancelled });
    const timer = window.setInterval(
      () => refreshStatus({ isCancelled: () => cancelled }),
      5000
    );
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  });

  async function refreshStatus(options: { showLoading?: boolean; isCancelled?: () => boolean } = {}) {
    const client = getClient();
    if (!client) return;
    const sequence = ++refreshSequence;
    if (options.showLoading || !lastRefreshedAt) loading = true;
    refreshing = true;
    try {
      const [nextStatus, nextJobs, nextWorkers, nextSummary, nextKvstore] = await Promise.all([
        client.systemStatus(statusProjectKey || undefined),
        client.listJobs({ limit: 100, include_progress: true, sort: 'updated_at', direction: 'desc' }),
        client.listWorkers(),
        client.jobsSummary(),
        client.kvStoreOverview().catch(() => null)
      ]);
      if (options.isCancelled?.() || sequence !== refreshSequence) return;
      status = nextStatus;
      jobs = nextJobs;
      workers = nextWorkers;
      globalSummary = nextSummary;
      kvstore = nextKvstore;
      actionError = null;
      lastRefreshedAt = new Date();
    } catch (error) {
      if (!options.isCancelled?.() && sequence === refreshSequence) {
        actionError = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (!options.isCancelled?.() && sequence === refreshSequence) {
        loading = false;
        refreshing = false;
      }
    }
  }

  async function shutdownWorker(worker: WorkerSession) {
    const workerId = worker.id ?? worker.worker_id;
    if (!workerId) return;
    const client = getClient();
    if (!client) return;
    actionError = null;
    try {
      await client.requestWorkerShutdown(workerId);
      workers = await client.listWorkers();
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
    }
  }

  async function clearCurrentQueue() {
    if (clearingQueue || currentQueueCount <= 0) return;
    clearingQueue = true;
    actionError = null;
    try {
      await requestJobClear({
        mode: 'cancel',
        reason: 'Cleared active jobs from the status page.'
      });
      await refreshStatus();
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
    } finally {
      clearingQueue = false;
    }
  }

  async function clearStageQueue(stage: string) {
    if (clearingStages[stage]) return;
    setStageClearing(stage, true);
    actionError = null;
    try {
      await requestJobClear({
        stage,
        mode: 'cancel',
        reason: `Cleared active ${stage} jobs from the status page.`
      });
      await refreshStatus();
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      setStageClearing(stage, false);
    }
  }

  async function clearNeedsReview() {
    if (clearingReview) return;
    clearingReview = true;
    actionError = null;
    try {
      await requestJobClear({
        status: terminalReviewStatuses,
        mode: 'delete',
        reason: 'Cleared terminal review jobs from the status page.'
      });
      await requestJobClear({
        status: pausedReviewStatuses,
        mode: 'cancel',
        reason: 'Cleared paused review jobs from the status page.'
      });
      await refreshStatus();
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      clearingReview = false;
    }
  }

  async function requestJobClear(options: {
    status?: string[];
    stage?: string;
    mode: 'cancel' | 'delete';
    reason: string;
  }) {
    const client = getClient();
    if (!client) throw new Error('Connect to a Pelagia server before clearing jobs.');
    await client.clearJobs({
      status: options.status,
      stage: options.stage,
      mode: options.mode,
      reason: options.reason
    });
  }

  function setStageClearing(stage: string, value: boolean) {
    const next = { ...clearingStages };
    if (value) next[stage] = true;
    else delete next[stage];
    clearingStages = next;
  }

  function kvstoreTotalFileBytes(): number | null {
    const totalBlobFileBytes = firstFiniteNumber(
      status?.kvstore?.total_blob_file_bytes,
      kvstore?.status?.total_blob_file_bytes
    );
    const totalIndexFileBytes = firstFiniteNumber(
      status?.kvstore?.total_index_file_bytes,
      kvstore?.status?.total_index_file_bytes
    );
    return firstFiniteNumber(
      status?.kvstore?.total_file_bytes,
      status?.kvstore?.total_physical_file_bytes,
      status?.kvstore?.total_storage_file_bytes,
      status?.kvstore?.total_sqlite_file_bytes,
      kvstore?.status?.total_file_bytes,
      kvstore?.status?.total_physical_file_bytes,
      kvstore?.status?.total_storage_file_bytes,
      kvstore?.status?.total_sqlite_file_bytes,
      kvstore?.total_sqlite_file_bytes,
      totalBlobFileBytes === null ? null : totalBlobFileBytes + (totalIndexFileBytes ?? 0)
    );
  }

  function kvstoreLargestBlobFileBytes(): number | null {
    return firstFiniteNumber(
      status?.kvstore?.largest_blob_file_size,
      status?.kvstore?.largest_blob_file_bytes,
      status?.kvstore?.largest_blob_bytes,
      kvstore?.status?.largest_blob_file_size,
      kvstore?.status?.largest_blob_file_bytes,
      kvstore?.status?.largest_blob_bytes
    );
  }

  function firstFiniteNumber(...values: unknown[]): number | null {
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
    return null;
  }

  function formatByteMetric(value: number | null): string {
    return value === null ? 'Unknown' : formatBytes(value);
  }

  function lastRefreshedLabel(): string {
    if (!lastRefreshedAt) return 'Not refreshed yet';
    return `Last refreshed ${lastRefreshedAt.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })}`;
  }

  function sortedWorkerSessions(
    sessions: WorkerSession[],
    column: WorkerSortColumn,
    direction: SortDirection
  ): WorkerSession[] {
    return [...sessions].sort((a, b) => {
      const compared = compareWorkerValues(workerSortValue(a, column), workerSortValue(b, column));
      if (compared !== 0) return direction === 'asc' ? compared : -compared;
      return compareWorkerValues(workerLabel(a), workerLabel(b));
    });
  }

  function workerSortValue(worker: WorkerSession, column: WorkerSortColumn): string | number | null {
    if (column === 'worker') return workerLabel(worker);
    if (column === 'status') return worker.status ?? null;
    if (column === 'capability') return capabilityLabel(worker);
    if (column === 'current_job') return worker.current_job_id ?? null;
    if (column === 'heartbeat') return dateSortValue(worker.last_heartbeat_at ?? worker.last_heartbeat);
    return dateSortValue(worker.started_at);
  }

  function compareWorkerValues(a: string | number | null, b: string | number | null): number {
    const aMissing = a === null || a === '';
    const bMissing = b === null || b === '';
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;
    if (bMissing) return -1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }

  function dateSortValue(value: string | null | undefined): number | null {
    if (!value) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function setWorkerSort(column: WorkerSortColumn) {
    if (workerSortColumn === column) {
      workerSortDirection = workerSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      workerSortColumn = column;
      workerSortDirection = column === 'heartbeat' || column === 'started' ? 'desc' : 'asc';
    }
    workerPage = 1;
  }

  function workerSortLabel(column: WorkerSortColumn): string {
    if (workerSortColumn !== column) return '';
    return workerSortDirection === 'asc' ? ' ↑' : ' ↓';
  }

  function workerAriaSort(column: WorkerSortColumn): 'ascending' | 'descending' | 'none' {
    if (workerSortColumn !== column) return 'none';
    return workerSortDirection === 'asc' ? 'ascending' : 'descending';
  }

  function workerLabel(worker: WorkerSession): string {
    return worker.worker_id ?? worker.id ?? 'unknown';
  }

  function capabilityLabel(worker: WorkerSession): string {
    const capabilities = worker.capabilities ?? worker.capability;
    if (Array.isArray(capabilities)) return capabilities.length ? capabilities.join(', ') : 'any';
    return capabilities || 'any';
  }

  function workerHeartbeatLabel(worker: WorkerSession): string {
    return formatDate(worker.last_heartbeat_at ?? worker.last_heartbeat);
  }

  function isWorkerStale(worker: WorkerSession): boolean {
    const heartbeat = worker.last_heartbeat_at ?? worker.last_heartbeat;
    if (!heartbeat) return false;
    const parsed = Date.parse(heartbeat);
    if (!Number.isFinite(parsed)) return false;
    return Date.now() - parsed > staleWorkerThresholdMs;
  }

  function currentJobLabel(worker: WorkerSession): string {
    return worker.current_job_id ?? '-';
  }

  function previousWorkerPage() {
    workerPage = Math.max(1, workerPage - 1);
  }

  function nextWorkerPage() {
    workerPage = Math.min(workerPageCount, workerPage + 1);
  }

  type WorkerPreferences = typeof workerPreferenceSnapshot;

  function restoreWorkerPreferences() {
    if (typeof localStorage === 'undefined') return;
    const saved = localStorage.getItem(statusPreferenceKey());
    if (!saved) return;
    try {
      const preferences = JSON.parse(saved) as Partial<WorkerPreferences>;
      workerSortColumn = workerSortColumnPreference(preferences.workerSortColumn, workerSortColumn);
      workerSortDirection = sortDirectionPreference(preferences.workerSortDirection, workerSortDirection);
      workerPage = positiveIntegerPreference(preferences.workerPage, workerPage);
    } catch {
      // Ignore stale or malformed local preferences.
    }
  }

  function persistWorkerPreferences(preferences: WorkerPreferences) {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(statusPreferenceKey(), JSON.stringify(preferences));
  }

  function statusPreferenceKey(): string {
    return projectPreferenceKey('status', $session);
  }

  function workerSortColumnPreference(value: unknown, fallback: WorkerSortColumn): WorkerSortColumn {
    return value === 'worker' ||
      value === 'status' ||
      value === 'capability' ||
      value === 'current_job' ||
      value === 'heartbeat' ||
      value === 'started'
      ? value
      : fallback;
  }

  function sortDirectionPreference(value: unknown, fallback: SortDirection): SortDirection {
    return value === 'asc' || value === 'desc' ? value : fallback;
  }

  function positiveIntegerPreference(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

</script>

<div class="status-dashboard">
  <section class="panel panel-compact panel-full">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">System</p>
        <h2>Operations overview</h2>
        {#if $session.project}
          <span class="soft">Project: {$session.project.project_name ?? $session.project.name ?? $session.project.project_key ?? $session.project.id}</span>
        {/if}
      </div>
      <div class="status-refresh">
        <span class="soft">{refreshing ? 'Refreshing' : lastRefreshedLabel()}</span>
        <button class="ghost danger" type="button" on:click={clearCurrentQueue} disabled={clearingQueue || currentQueueCount <= 0}>
          {clearingQueue ? 'Clearing' : 'Clear queue'}
        </button>
        <button class="ghost" type="button" on:click={() => refreshStatus({ showLoading: true })} disabled={refreshing}>
          Refresh
        </button>
      </div>
    </div>

    <div class="metric-grid">
      <div class="metric">
        <span>Postgres</span>
        <strong class:tone-good={statusTone(Boolean(status?.postgres?.healthy)) === 'good'} class:tone-bad={statusTone(Boolean(status?.postgres?.healthy)) === 'bad'}>
          {status?.postgres?.healthy ? 'Healthy' : 'Offline'}
        </strong>
      </div>
      <div class="metric">
        <span>KVStore</span>
        <strong class:tone-good={Boolean(status?.kvstore?.initialized)} class:tone-bad={!Boolean(status?.kvstore?.initialized)}>
          {status?.kvstore?.initialized ? 'Initialized' : 'Not ready'}
        </strong>
      </div>
      <div class="metric">
        <span>Running jobs</span>
        <strong>{formatCount(globalTotal?.leased ?? status?.queue?.leased)}</strong>
      </div>
      <div class="metric">
        <span>Queued jobs</span>
        <strong>{formatCount(globalTotal?.queued ?? status?.queue?.queued)}</strong>
      </div>
      <div class="metric">
        <span>Online workers</span>
        <strong>{formatCount(status?.workers?.online)}</strong>
      </div>
      <div class="metric">
        <span>Busy workers</span>
        <strong>{formatCount(status?.workers?.busy)}</strong>
      </div>
      <div class="metric">
        <span>Failed jobs</span>
        <strong class:tone-bad={failedJobCount > 0}>{formatCount(failedJobCount)}</strong>
      </div>
      <div class="metric">
        <span>KVStore size</span>
        <strong>{formatByteMetric(kvstoreTotalFileBytes())}</strong>
        <small>Largest blob {formatByteMetric(kvstoreLargestBlobFileBytes())}</small>
      </div>
    </div>

    {#if attentionCount > 0}
      <div class="status-notices" role="status">
        {#if failedJobCount > 0}<span class="notice-bad">{formatCount(failedJobCount)} failed job{failedJobCount === 1 ? '' : 's'}</span>{/if}
        {#if pausedJobCount > 0}<span>{formatCount(pausedJobCount)} paused job{pausedJobCount === 1 ? '' : 's'}</span>{/if}
        {#if staleWorkerCount > 0}<span>{formatCount(staleWorkerCount)} stale worker heartbeat{staleWorkerCount === 1 ? '' : 's'}</span>{/if}
      </div>
    {/if}

    {#if actionError}
      <p class="form-error">{actionError}</p>
    {/if}
  </section>

  <div class="stage-card-grid">
    {#each stageCards as stageCard}
      <StageStatusCard
        title={stageCard.title}
        detail={stageCard.detail}
        stage={stageCard.stage}
        href={dashboardViewHref(stageCard.view, $page.url)}
        clearing={Boolean(clearingStages[stageCard.stage])}
        onClearQueue={clearStageQueue}
      />
    {/each}
  </div>

  <div class="status-main-grid">
    <ActiveJobsPanel />
    <AttentionPanel {workers} clearing={clearingReview} onClearReview={clearNeedsReview} />
  </div>

  <section class="panel panel-compact panel-full">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Workers</p>
        <h2>Sessions</h2>
      </div>
      <span class="soft">5 per page</span>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th aria-sort={workerAriaSort('worker')}>
              <button class="table-sort" type="button" on:click={() => setWorkerSort('worker')}>Worker{workerSortLabel('worker')}</button>
            </th>
            <th aria-sort={workerAriaSort('status')}>
              <button class="table-sort" type="button" on:click={() => setWorkerSort('status')}>Status{workerSortLabel('status')}</button>
            </th>
            <th aria-sort={workerAriaSort('capability')}>
              <button class="table-sort" type="button" on:click={() => setWorkerSort('capability')}>Capability{workerSortLabel('capability')}</button>
            </th>
            <th aria-sort={workerAriaSort('current_job')}>
              <button class="table-sort" type="button" on:click={() => setWorkerSort('current_job')}>Current job{workerSortLabel('current_job')}</button>
            </th>
            <th aria-sort={workerAriaSort('heartbeat')}>
              <button class="table-sort" type="button" on:click={() => setWorkerSort('heartbeat')}>Heartbeat{workerSortLabel('heartbeat')}</button>
            </th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each pagedWorkers as worker}
            <tr class:worker-stale={isWorkerStale(worker)}>
              <td>{workerLabel(worker)}</td>
              <td><span class="status-dot {statusTone(worker.status)}"></span>{worker.status ?? 'unknown'}</td>
              <td class="soft">{capabilityLabel(worker)}</td>
              <td><code>{currentJobLabel(worker)}</code></td>
              <td>
                {workerHeartbeatLabel(worker)}
                {#if isWorkerStale(worker)}<span class="worker-warning">Stale</span>{/if}
              </td>
              <td class="actions">
                <button class="ghost" type="button" on:click={() => shutdownWorker(worker)} disabled={worker.shutdown_requested}>
                  {worker.shutdown_requested ? 'Requested' : 'Shutdown'}
                </button>
              </td>
            </tr>
          {:else}
            <tr><td colspan="7" class="empty">No worker sessions reported.</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="table-pager" aria-label="Worker session pagination">
      <span class="soft">
        {#if sortedWorkers.length}
          Showing {workerPageStart}-{workerPageEnd} of {sortedWorkers.length}
        {:else}
          Showing 0 of 0
        {/if}
      </span>
      <div class="pager-actions">
        <button class="ghost" type="button" on:click={previousWorkerPage} disabled={workerPage <= 1}>Previous</button>
        <span class="soft">Page {workerPage} / {workerPageCount}</span>
        <button class="ghost" type="button" on:click={nextWorkerPage} disabled={workerPage >= workerPageCount}>Next</button>
      </div>
    </div>
  </section>

  <div class="panel-full">
    <QueueStatusSummary
      title="Recent jobs"
      eyebrow="Tasks"
      jobs={jobs}
      mode="detailed"
      poll={false}
    />
  </div>
</div>
