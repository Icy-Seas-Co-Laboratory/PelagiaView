<script lang="ts">
  import { queueStatus } from '$lib/stores/queueStatus';
  import { session } from '$lib/stores/session';
  import { dashboardViewHref } from '$lib/utils/dashboardNavigation';
  import SystemPressureIndicator from './SystemPressureIndicator.svelte';

  export let currentUrl: URL;
  // Default project scope is shared with dashboard queue widgets.
  const status = queueStatus();
  $: snapshot = $status.snapshot;
  $: running = snapshot ? Number(snapshot.total?.leased ?? 0) + Number(snapshot.total?.working ?? 0) : null;
  $: queued = snapshot ? Number(snapshot.total?.queued ?? 0) : null;
  $: failure = snapshot?.recent_failures?.[0];
  $: latestFailure = failure?.summary ?? failure?.error_message ?? '';
  $: updatedAt = snapshot?.as_of ? new Date(snapshot.as_of).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  $: projectLabel = $session.project?.project_name ?? $session.project?.name ?? $session.project?.project_key ?? 'No project';
</script>

<footer class="app-status-bar" aria-label="Application status">
  <div><span class="connection-dot" class:online={$session.connected}></span><strong>{$session.connected ? 'Connected' : 'Offline'}</strong><span>{$session.baseUrl}</span></div>
  <div class="status-project"><span>Project</span><strong>{projectLabel}</strong></div>
  <a href={dashboardViewHref('status', currentUrl)} class:attention={Boolean(latestFailure) || $status.stale || Boolean($status.error)} title={$status.error ?? (latestFailure || 'Open job and worker status')}>
    <span>{running === null ? 'Queue unavailable' : `${running} running`}</span>{#if queued !== null}<span>{queued} queued</span>{/if}{#if latestFailure}<strong>Recent failure</strong>{/if}{#if $status.stale}<strong>Stale</strong>{/if}
  </a>
  <a class="status-system-health" href={dashboardViewHref('status', currentUrl)} title="Open server and worker status"><span>Server</span><SystemPressureIndicator /></a>
  <div class="status-clock"><span>Updated</span><strong>{updatedAt || '—'}</strong></div>
</footer>
