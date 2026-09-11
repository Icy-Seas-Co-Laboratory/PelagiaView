<script lang="ts">
  import { getClient } from '$lib/stores/session';
  import type { Job } from '$lib/api/types';
  import { formatDate, statusTone } from '$lib/utils/format';
  import { jobActionClass, jobActionLabel, jobActions, jobStatusLabel, type JobAction } from '$lib/utils/jobStatus';

  export let jobs: Job[] = [];
  export let pageSize = 20;
  export let compact = false;
  export let emptyLabel = 'No jobs found.';
  /** Re-fetches the parent's current query after a control action. */
  export let refreshJobs: (() => Promise<void> | void) | null = null;
  /** @deprecated Prefer refreshJobs so query filters and pagination stay intact. */
  export let onJobsRefresh: ((jobs: Job[]) => void) | null = null;

  let page = 1;
  let actionError: string | null = null;

  $: pageCount = Math.max(1, Math.ceil(jobs.length / pageSize));
  $: if (page > pageCount) page = pageCount;
  $: pagedJobs = jobs.slice((page - 1) * pageSize, page * pageSize);
  $: pageStart = jobs.length ? (page - 1) * pageSize + 1 : 0;
  $: pageEnd = Math.min(page * pageSize, jobs.length);

  async function runJobAction(job: Job, action: JobAction) {
    if (!job.id) return;
    const client = getClient();
    if (!client) return;
    actionError = null;
    try {
      const updatedJob = action === 'pause'
        ? await client.pauseJob(job.id)
        : action === 'resume'
          ? await client.resumeJob(job.id)
          : await client.retryJob(job.id);
      if (refreshJobs) {
        await refreshJobs();
      } else {
        // Preserve the current input scope when no parent refresh callback is supplied.
        onJobsRefresh?.(jobs.map((current) => current.id === updatedJob.id ? updatedJob : current));
      }
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
    }
  }

  function previousPage() {
    page = Math.max(1, page - 1);
  }

  function nextPage() {
    page = Math.min(pageCount, page + 1);
  }
</script>

{#if actionError}
  <p class="form-error">{actionError}</p>
{/if}

<div class="table-wrap" class:compact-job-table={compact}>
  <table>
    <thead>
      <tr>
        <th>Stage</th>
        <th>Status</th>
        <th>Summary</th>
        <th>Updated</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each pagedJobs as job}
        <tr>
          <td>{job.stage ?? 'unknown'}</td>
          <td><span class="status-dot {statusTone(job.status)}"></span>{jobStatusLabel(job)}</td>
          <td>{job.summary ?? job.id}</td>
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
        <tr><td colspan="5" class="empty">{emptyLabel}</td></tr>
      {/each}
    </tbody>
  </table>
</div>

<div class="table-pager" aria-label="Job pagination">
  <span class="soft">
    {#if jobs.length}
      Showing {pageStart}-{pageEnd} of {jobs.length}
    {:else}
      Showing 0 of 0
    {/if}
  </span>
  <div class="pager-actions">
    <button class="ghost" type="button" on:click={previousPage} disabled={page <= 1}>Previous</button>
    <span class="soft">Page {page} / {pageCount}</span>
    <button class="ghost" type="button" on:click={nextPage} disabled={page >= pageCount}>Next</button>
  </div>
</div>
