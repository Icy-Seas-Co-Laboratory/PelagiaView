<script lang="ts">
  import EventLogPage from './EventLogPage.svelte';
  import IngestionPage from './IngestionPage.svelte';
  import SegmentationPage from './SegmentationPage.svelte';
  import StatusPage from './StatusPage.svelte';
  import { disconnectSession, session } from '$lib/stores/session';

  type Tab = 'status' | 'ingestion' | 'segmentation' | 'logs';

  let activeTab: Tab = 'status';

  const tabs: { id: Tab; label: string; detail: string }[] = [
    { id: 'status', label: 'Status', detail: 'queue and workers' },
    { id: 'ingestion', label: 'Ingestion', detail: 'server assets' },
    { id: 'segmentation', label: 'Segmentation', detail: 'frames and ROIs' },
    { id: 'logs', label: 'Event Log', detail: 'job events' }
  ];
</script>

<main class="app-shell">
  <header class="topbar">
    <div>
      <p class="eyebrow">PelagiaView session</p>
      <h1>Pelagia Dashboard</h1>
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
    {:else if activeTab === 'segmentation'}
      <SegmentationPage />
    {:else}
      <EventLogPage />
    {/if}
  </section>
</main>
