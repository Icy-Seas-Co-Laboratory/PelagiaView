<script lang="ts">
  import { onMount } from 'svelte';
  import { getClient } from '$lib/stores/session';
  import { session } from '$lib/stores/session';
  import { dashboardViewHref } from '$lib/utils/dashboardNavigation';
  import SystemPressureIndicator from './SystemPressureIndicator.svelte';

  export let currentUrl: URL;
  let running = 0;
  let queued = 0;
  let latestFailure = '';
  let updatedAt = '';

  onMount(() => {
    let stopped = false;
    async function refresh() {
      const client = getClient();
      if (!client) return;
      try {
        const [jobs, failures] = await Promise.all([
          client.listJobs({ status: ['queued', 'leased', 'working', 'paused'], limit: 1000, include_progress: false, sort: 'updated_at', direction: 'desc' }),
          client.listJobs({ status: ['failed', 'dead_lettered'], limit: 1, include_progress: false, sort: 'updated_at', direction: 'desc' })
        ]);
        if (stopped) return;
        running = jobs.filter((job) => ['leased', 'working'].includes(job.status ?? '')).length;
        queued = jobs.filter((job) => job.status === 'queued').length;
        const failure = failures[0];
        const failureAge = failure?.updated_at ? Date.now() - Date.parse(failure.updated_at) : Number.POSITIVE_INFINITY;
        latestFailure = failure && failureAge <= 24 * 60 * 60 * 1000 ? failure.summary ?? failure.error_message ?? 'Job failure' : '';
        updatedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } catch {
        // The persistent connection indicator already communicates API loss.
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, 10000);
    return () => { stopped = true; window.clearInterval(timer); };
  });

  $: projectLabel = $session.project?.project_name ?? $session.project?.name ?? $session.project?.project_key ?? 'No project';
</script>

<footer class="app-status-bar" aria-label="Application status">
  <div><span class="connection-dot" class:online={$session.connected}></span><strong>{$session.connected ? 'Connected' : 'Offline'}</strong><span>{$session.baseUrl}</span></div>
  <div class="status-project"><span>Project</span><strong>{projectLabel}</strong></div>
  <a href={dashboardViewHref('status', currentUrl)} class:attention={Boolean(latestFailure)} title={latestFailure || 'Open job and worker status'}>
    <span>{running} running</span><span>{queued} queued</span>{#if latestFailure}<strong>Recent failure</strong>{/if}
  </a>
  <a class="status-system-health" href={dashboardViewHref('status', currentUrl)} title="Open server and worker status"><span>Server</span><SystemPressureIndicator /></a>
  <div class="status-clock"><span>Updated</span><strong>{updatedAt || '—'}</strong></div>
</footer>
