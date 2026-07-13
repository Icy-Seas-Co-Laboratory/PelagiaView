<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import AdministrationPage from './AdministrationPage.svelte';
  import AppSidebar from './AppSidebar.svelte';
  import EventLogPage from './EventLogPage.svelte';
  import DatasetQueuePage from './DatasetQueuePage.svelte';
  import HeaderImageInversionToggle from './HeaderImageInversionToggle.svelte';
  import HeaderProcessingPresetSelect from './HeaderProcessingPresetSelect.svelte';
  import IngestionPage from './IngestionPage.svelte';
  import FrameBrowserPage from './FrameBrowserPage.svelte';
  import PreferencesModal from './PreferencesModal.svelte';
  import RoiBrowserPage from './RoiBrowserPage.svelte';
  import ExplorerPage from './ExplorerPage.svelte';
  import StatusPage from './StatusPage.svelte';
  import { disconnectSession, session, switchSessionProject } from '$lib/stores/session';
  import {
    dashboardViewDefinition,
    dashboardViewHref,
    dashboardViewFromParam,
    defaultDashboardView,
    type DashboardView
  } from '$lib/utils/dashboardNavigation';

  let activeTab: DashboardView = defaultDashboardView;
  let sidebarCollapsed = false;
  let preferencesOpen = false;
  let preferencesReady = false;
  let projectSwitchError: string | null = null;
  const sidebarPreferenceKey = 'pelagia-view:sidebar-collapsed';
  $: activeTab = dashboardViewFromParam($page.url.searchParams.get('view'));
  $: activeDefinition = dashboardViewDefinition(activeTab);
  $: nextDefinition = activeDefinition.nextView ? dashboardViewDefinition(activeDefinition.nextView) : null;
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

  async function selectProject(event: Event) {
    const projectId = (event.currentTarget as HTMLSelectElement).value;
    const previousProjectId = $session.project?.id ?? '';
    projectSwitchError = null;
    try {
      await switchSessionProject(projectId);
      if (projectId && projectId !== previousProjectId && typeof window !== 'undefined') {
        window.location.reload();
      }
    } catch (error) {
      projectSwitchError = error instanceof Error ? error.message : String(error);
    }
  }
</script>

<main class="app-shell" class:sidebar-is-collapsed={sidebarCollapsed}>
  <AppSidebar
    activeView={activeTab}
    currentUrl={$page.url}
    collapsed={sidebarCollapsed}
    user={$session.user}
    project={$session.project}
    projects={$session.projects}
    switchingProject={$session.switchingProject}
    {projectSwitchError}
    onToggle={toggleSidebar}
    onProjectChange={selectProject}
    onPreferences={() => (preferencesOpen = true)}
    onDisconnect={disconnectSession}
  />

  <div class="app-workspace">
    <header class="topbar">
      <div class="dashboard-brand">
        <div>
          <p class="eyebrow">{activeDefinition.group} · {activeDefinition.detail}</p>
          <h1>{activeDefinition.label}</h1>
        </div>
      </div>
      <div class="session-controls">
        {#if activeDefinition.nextView && nextDefinition}
          <a class="next-step-button topbar-next-step" href={dashboardViewHref(activeDefinition.nextView, $page.url)}>
            <span>Next</span>
            <strong>{nextDefinition.label}</strong>
          </a>
        {/if}
        <HeaderProcessingPresetSelect />
        <HeaderImageInversionToggle />
      </div>
    </header>

    <section class="dashboard-surface">
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
        {:else if activeTab === 'frames'}
          <FrameBrowserPage />
        {:else if activeTab === 'admin'}
          <AdministrationPage />
        {:else}
          <EventLogPage />
        {/if}
      </div>
    </section>
  </div>

  <PreferencesModal open={preferencesOpen} onClose={() => (preferencesOpen = false)} />
</main>
