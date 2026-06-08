<script lang="ts">
  import EventLogPage from './EventLogPage.svelte';
  import DatasetQueuePage from './DatasetQueuePage.svelte';
  import IngestionPage from './IngestionPage.svelte';
  import RoiBrowserPage from './RoiBrowserPage.svelte';
  import ExplorerPage from './SegmentationPage.svelte';
  import StatusPage from './StatusPage.svelte';
  import { disconnectSession, session } from '$lib/stores/session';

  type Tab = 'status' | 'ingestion' | 'preprocessing' | 'segmentation' | 'explorer' | 'rois' | 'logs';

  let activeTab: Tab = 'status';

  const tabs: { id: Tab; label: string; detail: string }[] = [
    { id: 'status', label: 'Status', detail: 'queue and workers' },
    { id: 'ingestion', label: 'Ingestion', detail: 'server assets' },
    { id: 'preprocessing', label: 'Preprocessing', detail: 'queue frame prep' },
    { id: 'segmentation', label: 'Segmentation', detail: 'queue ROI jobs' },
    { id: 'explorer', label: 'Explorer', detail: 'live preview' },
    { id: 'rois', label: 'ROI Browser', detail: 'detections gallery' },
    { id: 'logs', label: 'Event Log', detail: 'job events' }
  ];
</script>

<main class="app-shell">
  <header class="topbar">
    <div class="dashboard-brand">
      <img class="brand-icon" src="/brand/pelagia_icon.png" alt="" aria-hidden="true" />
      <div>
        <p class="eyebrow">PelagiaView session</p>
        <h1>Pelagia Dashboard</h1>
      </div>
    </div>
    <div class="session-controls">
      <span class="endpoint-pill">{$session.baseUrl}</span>
      <button class="ghost" type="button" on:click={disconnectSession}>Disconnect</button>
    </div>
  </header>

  <nav class="tabbar" aria-label="Dashboard sections">
    {#each tabs as tab}
      <button
        type="button"
        class:active={activeTab === tab.id}
        on:click={() => (activeTab = tab.id)}
      >
        <span>{tab.label}</span>
        <small>{tab.detail}</small>
      </button>
    {/each}
  </nav>

  <section class="dashboard-surface">
    {#if activeTab === 'status'}
      <StatusPage />
    {:else if activeTab === 'ingestion'}
      <IngestionPage />
    {:else if activeTab === 'preprocessing'}
      <DatasetQueuePage mode="preprocessing" />
    {:else if activeTab === 'segmentation'}
      <DatasetQueuePage mode="segmentation" />
    {:else if activeTab === 'explorer'}
      <ExplorerPage />
    {:else if activeTab === 'rois'}
      <RoiBrowserPage />
    {:else}
      <EventLogPage />
    {/if}
  </section>
</main>
