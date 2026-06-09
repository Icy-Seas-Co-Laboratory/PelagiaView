<script lang="ts">
  import { onMount } from 'svelte';
  import { getClient, session } from '$lib/stores/session';
  import type { Job, KvStoreOverview, SystemStatus, WorkerSession } from '$lib/api/types';
  import { formatCount, formatDate, statusTone } from '$lib/utils/format';

  let status: SystemStatus | null = $session.systemStatus;
  let jobs: Job[] = [];
  let workers: WorkerSession[] = [];
  let kvstore: KvStoreOverview | null = null;
  let loading = true;
  let actionError: string | null = null;
  let workerSortColumn: WorkerSortColumn = 'worker';
  let workerSortDirection: SortDirection = 'asc';
  let workerPage = 1;
  let jobPage = 1;
  let workerPreferencesReady = false;
  const workerPageSize = 5;
  const jobPageSize = 20;
  const statusPreferenceKey = 'pelagia-view:status:v1';

  type WorkerSortColumn = 'worker' | 'status' | 'capability' | 'current_job' | 'heartbeat' | 'started';
  type SortDirection = 'asc' | 'desc';
  type JobAction = 'pause' | 'resume' | 'retry';

  $: sortedWorkers = sortedWorkerSessions(workers, workerSortColumn, workerSortDirection);
  $: workerPageCount = Math.max(1, Math.ceil(sortedWorkers.length / workerPageSize));
  $: if (workerPage > workerPageCount) workerPage = workerPageCount;
  $: pagedWorkers = sortedWorkers.slice((workerPage - 1) * workerPageSize, workerPage * workerPageSize);
  $: workerPageStart = sortedWorkers.length ? (workerPage - 1) * workerPageSize + 1 : 0;
  $: workerPageEnd = Math.min(workerPage * workerPageSize, sortedWorkers.length);
  $: jobPageCount = Math.max(1, Math.ceil(jobs.length / jobPageSize));
  $: if (jobPage > jobPageCount) jobPage = jobPageCount;
  $: pagedJobs = jobs.slice((jobPage - 1) * jobPageSize, jobPage * jobPageSize);
  $: jobPageStart = jobs.length ? (jobPage - 1) * jobPageSize + 1 : 0;
  $: jobPageEnd = Math.min(jobPage * jobPageSize, jobs.length);
  $: workerPreferenceSnapshot = {
    workerSortColumn,
    workerSortDirection,
    workerPage
  };
  $: if (workerPreferencesReady) persistWorkerPreferences(workerPreferenceSnapshot);

  onMount(() => {
    let cancelled = false;
    restoreWorkerPreferences();
    workerPreferencesReady = true;
    async function load() {
      const client = getClient();
      if (!client) return;
      try {
        const [nextStatus, nextJobs, nextWorkers, nextKvstore] = await Promise.all([
          client.systemStatus(),
          client.listJobs(),
          client.listWorkers(),
          client.kvStoreOverview().catch(() => null)
        ]);
        if (!cancelled) {
          status = nextStatus;
          jobs = nextJobs;
          workers = nextWorkers;
          kvstore = nextKvstore;
          loading = false;
        }
      } catch (error) {
        if (!cancelled) {
          actionError = error instanceof Error ? error.message : String(error);
          loading = false;
        }
      }
    }
    load();
    const timer = window.setInterval(load, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  });

  async function runJobAction(job: Job, action: 'pause' | 'resume' | 'retry') {
    if (!job.id) return;
    const client = getClient();
    if (!client) return;
    actionError = null;
    try {
      if (action === 'pause') await client.pauseJob(job.id);
      if (action === 'resume') await client.resumeJob(job.id);
      if (action === 'retry') await client.retryJob(job.id);
      jobs = await client.listJobs();
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
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

  function kvstoreTotalFileBytes(): number | null {
    return firstFiniteNumber(
      kvstore?.status?.total_sqlite_file_bytes,
      kvstore?.total_sqlite_file_bytes,
      status?.kvstore?.total_sqlite_file_bytes
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

  function formatGigabytes(value: number | null): string {
    if (value === null) return 'Unknown';
    return `${(value / 1024 ** 3).toFixed(2)} GB`;
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

  function currentJobLabel(worker: WorkerSession): string {
    return worker.current_job_id ?? '-';
  }

  function previousWorkerPage() {
    workerPage = Math.max(1, workerPage - 1);
  }

  function nextWorkerPage() {
    workerPage = Math.min(workerPageCount, workerPage + 1);
  }

  function previousJobPage() {
    jobPage = Math.max(1, jobPage - 1);
  }

  function nextJobPage() {
    jobPage = Math.min(jobPageCount, jobPage + 1);
  }

  type WorkerPreferences = typeof workerPreferenceSnapshot;

  function restoreWorkerPreferences() {
    if (typeof localStorage === 'undefined') return;
    const saved = localStorage.getItem(statusPreferenceKey);
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
    localStorage.setItem(statusPreferenceKey, JSON.stringify(preferences));
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

  function jobActions(job: Job): JobAction[] {
    const status = normalizedJobStatus(job);
    if (status === 'succeeded' || status === 'success' || status === 'completed' || status === 'complete') {
      return ['retry'];
    }
    if (status === 'queued' || status === 'leased') {
      return ['pause', 'retry'];
    }
    if (status === 'paused' || status === 'pause') {
      return ['resume', 'retry'];
    }
    if (status === 'failed' || status === 'error' || status === 'cancelled' || status === 'canceled') {
      return ['retry'];
    }
    return ['pause', 'resume', 'retry'];
  }

  function normalizedJobStatus(job: Job): string {
    return String(job.status ?? '').trim().toLowerCase();
  }

  function jobActionClass(job: Job, action: JobAction): string {
    const status = normalizedJobStatus(job);
    return [
      'ghost',
      'job-action',
      (status === 'succeeded' || status === 'success' || status === 'completed' || status === 'complete') && action === 'retry'
        ? 'job-action-muted'
        : '',
      (status === 'queued' || status === 'leased') && (action === 'pause' || action === 'retry')
        ? 'job-action-muted'
        : ''
    ]
      .filter(Boolean)
      .join(' ');
  }

  function jobActionLabel(action: JobAction): string {
    if (action === 'pause') return 'Pause';
    if (action === 'resume') return 'Resume';
    return 'Retry';
  }
</script>

<div class="page-grid">
  <section class="panel panel-compact">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">System</p>
        <h2>Health and queue state</h2>
      </div>
      {#if loading}<span class="soft">Refreshing</span>{/if}
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
        <span>Queued</span>
        <strong>{formatCount(status?.queue?.leased)} <small>/ {formatCount(status?.queue?.queued)}</small></strong>
      </div>
      <div class="metric">
        <span>Running workers</span>
        <strong>{formatCount(status?.workers?.busy)} <small>/ {formatCount(status?.workers?.online)}</small></strong>
      </div>
      <div class="metric">
        <span>KVStore size</span>
        <strong>{formatGigabytes(kvstoreTotalFileBytes())}</strong>
      </div>
    </div>

    {#if actionError}
      <p class="form-error">{actionError}</p>
    {/if}
  </section>

  <section class="panel panel-compact">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Workers</p>
        <h2>Sessions</h2>
      </div>
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
            <tr>
              <td>{workerLabel(worker)}</td>
              <td><span class="status-dot {statusTone(worker.status)}"></span>{worker.status ?? 'unknown'}</td>
              <td class="soft">{capabilityLabel(worker)}</td>
              <td><code>{currentJobLabel(worker)}</code></td>
              <td>{workerHeartbeatLabel(worker)}</td>
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

  <section class="panel wide">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Tasks</p>
        <h2>Recent jobs</h2>
      </div>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Stage</th>
            <th>Status</th>
            <th>Summary</th>
            <th>Priority</th>
            <th>Updated</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each pagedJobs as job}
            <tr>
              <td>{job.stage ?? 'unknown'}</td>
              <td><span class="status-dot {statusTone(job.status)}"></span>{job.status ?? 'unknown'}</td>
              <td>{job.summary ?? job.id}</td>
              <td>{job.priority ?? '-'}</td>
              <td>{formatDate(job.updated_at ?? job.created_at)}</td>
              <td class="actions">
                {#each jobActions(job) as action}
                  <button class={jobActionClass(job, action)} type="button" on:click={() => runJobAction(job, action)}>
                    {jobActionLabel(action)}
                  </button>
                {/each}
              </td>
            </tr>
          {:else}
            <tr><td colspan="6" class="empty">No jobs found.</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="table-pager" aria-label="Recent jobs pagination">
      <span class="soft">
        {#if jobs.length}
          Showing {jobPageStart}-{jobPageEnd} of {jobs.length}
        {:else}
          Showing 0 of 0
        {/if}
      </span>
      <div class="pager-actions">
        <button class="ghost" type="button" on:click={previousJobPage} disabled={jobPage <= 1}>Previous</button>
        <span class="soft">Page {jobPage} / {jobPageCount}</span>
        <button class="ghost" type="button" on:click={nextJobPage} disabled={jobPage >= jobPageCount}>Next</button>
      </div>
    </div>
  </section>
</div>
