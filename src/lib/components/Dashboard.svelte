<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import AppSidebar from './AppSidebar.svelte';
  import EventLogPage from './EventLogPage.svelte';
  import DatasetQueuePage from './DatasetQueuePage.svelte';
  import HeaderImageInversionToggle from './HeaderImageInversionToggle.svelte';
  import HeaderProcessingPresetSelect from './HeaderProcessingPresetSelect.svelte';
  import IngestionPage from './IngestionPage.svelte';
  import PageHeader from './PageHeader.svelte';
  import PreferencesModal from './PreferencesModal.svelte';
  import RoiBrowserPage from './RoiBrowserPage.svelte';
  import ExplorerPage from './ExplorerPage.svelte';
  import StatusPage from './StatusPage.svelte';
  import { disconnectSession, session } from '$lib/stores/session';
  import {
    dashboardViewFromParam,
    type DashboardView
  } from '$lib/utils/dashboardNavigation';

  let activeTab: DashboardView = 'status';
  let sidebarCollapsed = false;
  let preferencesOpen = false;
  let preferencesReady = false;
  const sidebarPreferenceKey = 'pelagia-view:sidebar-collapsed';
  $: activeTab = dashboardViewFromParam($page.url.searchParams.get('view'));
  $: if (preferencesReady && typeof localStorage !== 'undefined') {
    localStorage.setItem(sidebarPreferenceKey, sidebarCollapsed ? 'true' : 'false');
  }

  onMount(() => {
    sidebarCollapsed = localStorage.getItem(sidebarPreferenceKey) === 'true';
    preferencesReady = true;
  });

  function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
  }
</script>

<main class="app-shell" class:sidebar-is-collapsed={sidebarCollapsed}>
  <AppSidebar activeView={activeTab} currentUrl={$page.url} collapsed={sidebarCollapsed} onToggle={toggleSidebar} />

  <div class="app-workspace">
    <header class="topbar">
      <div class="dashboard-brand">
        <div>
          <p class="eyebrow">PelagiaView session</p>
          <h1>Pelagia Dashboard</h1>
        </div>
      </div>
      <div class="session-controls">
        <span class="endpoint-pill">{$session.baseUrl}</span>
        <HeaderProcessingPresetSelect />
        <HeaderImageInversionToggle />
        <button class="ghost" type="button" on:click={() => (preferencesOpen = true)}>Preferences</button>
        <button class="ghost" type="button" on:click={disconnectSession}>Disconnect</button>
      </div>
    </header>

    <section class="dashboard-surface">
      <PageHeader view={activeTab} currentUrl={$page.url} />
      <div class="page-scroll-content">
        {#if activeTab === 'status'}
          <StatusPage />
        {:else if activeTab === 'ingestion'}
          <IngestionPage />
        {:else if activeTab === 'preprocessing'}
          <DatasetQueuePage mode="preprocessing" />
        {:else if activeTab === 'segmentation'}
          <DatasetQueuePage mode="segmentation" />
        {:else if activeTab === 'roi_refinement'}
          <DatasetQueuePage mode="roi_refinement" />
        {:else if activeTab === 'explorer'}
          <ExplorerPage />
        {:else if activeTab === 'rois'}
          <RoiBrowserPage />
        {:else}
          <EventLogPage />
        {/if}
      </div>
    </section>
  </div>

  <PreferencesModal open={preferencesOpen} onClose={() => (preferencesOpen = false)} />
</main>
