<script lang="ts">
  import { onMount } from 'svelte';
  import { getClient, session } from '$lib/stores/session';
  import type { Job, SystemStatus, WorkerSession } from '$lib/api/types';
  import { formatCount, formatDate, statusTone } from '$lib/utils/format';

  let status: SystemStatus | null = $session.systemStatus;
  let jobs: Job[] = [];
  let workers: WorkerSession[] = [];
  let loading = true;
  let actionError: string | null = null;
  let spawnCapability = 'segment';

  onMount(() => {
    let cancelled = false;
    async function load() {
      const client = getClient();
      if (!client) return;
      try {
        const [nextStatus, nextJobs, nextWorkers] = await Promise.all([
          client.systemStatus(),
          client.listJobs(),
          client.listWorkers()
        ]);
        if (!cancelled) {
          status = nextStatus;
          jobs = nextJobs;
          workers = nextWorkers;
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

  async function spawnWorker() {
    const client = getClient();
    if (!client) return;
    actionError = null;
    try {
      await client.spawnWorker(spawnCapability);
      workers = await client.listWorkers();
    } catch (error) {
      actionError =
        error instanceof Error
          ? `${error.message}. Suggested backend endpoint: POST /workers with a capability payload to spawn a managed worker.`
          : String(error);
    }
  }
</script>

<div class="page-grid">
  <section class="panel">
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
        <strong>{formatCount(status?.queue?.queued)}</strong>
      </div>
      <div class="metric">
        <span>Running workers</span>
        <strong>{formatCount(status?.workers?.running)}</strong>
      </div>
    </div>

    {#if actionError}
      <p class="form-error">{actionError}</p>
    {/if}
  </section>

  <section class="panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Workers</p>
        <h2>Sessions</h2>
      </div>
      <div class="inline-controls">
        <select bind:value={spawnCapability} aria-label="Worker capability">
          <option value="segment">segment</option>
          <option value="extract_frames">extract frames</option>
          <option value="all">all</option>
        </select>
        <button type="button" on:click={spawnWorker}>Spawn</button>
      </div>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Worker</th>
            <th>Status</th>
            <th>Capability</th>
            <th>Heartbeat</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each workers as worker}
            <tr>
              <td>{worker.worker_id ?? worker.id}</td>
              <td><span class="status-dot {statusTone(worker.status)}"></span>{worker.status ?? 'unknown'}</td>
              <td>{worker.capability ?? 'any'}</td>
              <td>{formatDate(worker.last_heartbeat_at)}</td>
              <td class="actions">
                <button class="ghost" type="button" on:click={() => shutdownWorker(worker)} disabled={worker.shutdown_requested}>
                  {worker.shutdown_requested ? 'Requested' : 'Shutdown'}
                </button>
              </td>
            </tr>
          {:else}
            <tr><td colspan="5" class="empty">No worker sessions reported.</td></tr>
          {/each}
        </tbody>
      </table>
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
          {#each jobs as job}
            <tr>
              <td>{job.stage ?? 'unknown'}</td>
              <td><span class="status-dot {statusTone(job.status)}"></span>{job.status ?? 'unknown'}</td>
              <td>{job.summary ?? job.id}</td>
              <td>{job.priority ?? '-'}</td>
              <td>{formatDate(job.updated_at ?? job.created_at)}</td>
              <td class="actions">
                <button class="ghost" type="button" on:click={() => runJobAction(job, 'pause')}>Pause</button>
                <button class="ghost" type="button" on:click={() => runJobAction(job, 'resume')}>Resume</button>
                <button class="ghost" type="button" on:click={() => runJobAction(job, 'retry')}>Retry</button>
              </td>
            </tr>
          {:else}
            <tr><td colspan="6" class="empty">No jobs found.</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
</div>
