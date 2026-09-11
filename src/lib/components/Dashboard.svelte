<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import AdministrationPage from './AdministrationPage.svelte';
  import AppHeader from './AppHeader.svelte';
  import AppSidebar from './AppSidebar.svelte';
  import AppStatusBar from './AppStatusBar.svelte';
  import AssetsPage from './AssetsPage.svelte';
  import EventLogPage from './EventLogPage.svelte';
  import DatasetQueuePage from './DatasetQueuePage.svelte';
  import CurationPage from './CurationPage.svelte';
  import ClustersPage from './ClustersPage.svelte';
  import IngestionPage from './IngestionPage.svelte';
  import TelemetryImportPage from './TelemetryImportPage.svelte';
  import MlEvidencePage from './MlEvidencePage.svelte';
  import JobSeriesBuilderPage from './JobSeriesBuilderPage.svelte';
  import JobSeriesMonitorPage from './JobSeriesMonitorPage.svelte';
  import FrameBrowserPage from './FrameBrowserPage.svelte';
  import PreferencesModal from './PreferencesModal.svelte';
  import RoiBrowserPage from './RoiBrowserPage.svelte';
  import ExplorerPage from './ExplorerPage.svelte';
  import PresetLibraryPage from './PresetLibraryPage.svelte';
  import StatusPage from './StatusPage.svelte';
  import DeadLetterQueuePage from './DeadLetterQueuePage.svelte';
  import ExportsPage from './ExportsPage.svelte';
  import { disconnectSession, session, switchSessionProject } from '$lib/stores/session';
  import {
    dashboardViewDefinition,
    dashboardViewFromUrl,
    defaultDashboardView,
    type DashboardView
  } from '$lib/utils/dashboardNavigation';

  let activeTab: DashboardView = defaultDashboardView;
  let sidebarCollapsed = false;
  let preferencesOpen = false;
  let preferencesReady = false;
  let projectSwitchError: string | null = null;
  const sidebarPreferenceKey = 'pelagia-view:process-sidebar-collapsed';
  $: activeTab = dashboardViewFromUrl($page.url);
  $: activeDefinition = dashboardViewDefinition(activeTab);
  $: hasProcessSidebar = activeDefinition.group === 'workflow' || activeDefinition.group === 'explorer';
  $: if (preferencesReady && typeof localStorage !== 'undefined') {
    localStorage.setItem(sidebarPreferenceKey, sidebarCollapsed ? 'true' : 'false');
  }

  onMount(() => {
    sidebarCollapsed = localStorage.getItem(sidebarPreferenceKey) === 'true';
    preferencesReady = true;
  });

  async function selectProject(event: Event) {
    const projectId = (event.currentTarget as HTMLSelectElement).value;
    const previousProjectId = $session.project?.id ?? '';
    projectSwitchError = null;
    try {
      await switchSessionProject(projectId);
      if (projectId && projectId !== previousProjectId && typeof window !== 'undefined') window.location.reload();
    } catch (error) {
      projectSwitchError = error instanceof Error ? error.message : String(error);
    }
  }
</script>

<main class="app-shell-v2" class:workflow-active={hasProcessSidebar} class:workflow-collapsed={hasProcessSidebar && sidebarCollapsed}>
  <AppHeader
    activeView={activeTab}
    currentUrl={$page.url}
    user={$session.user}
    project={$session.project}
    projects={$session.projects}
    switchingProject={$session.switchingProject}
    {projectSwitchError}
    onProjectChange={selectProject}
    onPreferences={() => (preferencesOpen = true)}
    onDisconnect={disconnectSession}
  />

  <div class="section-workspace" class:workflow-layout={hasProcessSidebar} class:system-layout={activeDefinition.group === 'system'} class:analysis-layout={activeDefinition.group === 'analysis'}>
    {#if hasProcessSidebar}
      <AppSidebar mode={activeDefinition.group === 'explorer' ? 'explorer' : 'workflow'} activeView={activeTab} currentUrl={$page.url} collapsed={sidebarCollapsed} onToggle={() => (sidebarCollapsed = !sidebarCollapsed)} />
    {/if}
    <section class="dashboard-surface section-surface">
      <div class="page-scroll-content" data-dashboard-view={activeTab} class:browser-page={['rois', 'frames', 'curation', 'clusters'].includes(activeTab)} class:workbench-page={activeTab === 'explorer'}>
        {#key activeTab}
          {#if activeTab === 'status'}
            <StatusPage />
          {:else if activeTab === 'dead_letters'}
            <DeadLetterQueuePage />
          {:else if activeTab === 'assets'}
            <AssetsPage />
          {:else if activeTab === 'ingestion'}
            <IngestionPage />
          {:else if activeTab === 'telemetry'}
            <TelemetryImportPage />
          {:else if activeTab === 'preprocessing'}
            <DatasetQueuePage mode="preprocessing" />
          {:else if activeTab === 'segmentation'}
            <DatasetQueuePage mode="segmentation" />
          {:else if activeTab === 'roi_refinement'}
            <DatasetQueuePage mode="roi_refinement" />
          {:else if activeTab === 'ml_evidence'}
            <MlEvidencePage />
          {:else if activeTab === 'job_series'}
            <JobSeriesBuilderPage />
          {:else if activeTab === 'job_series_monitor'}
            <JobSeriesMonitorPage />
          {:else if activeTab === 'preset_library'}
            <PresetLibraryPage />
          {:else if activeTab === 'explorer'}
            <ExplorerPage />
          {:else if activeTab === 'rois'}
            <RoiBrowserPage />
          {:else if activeTab === 'curation'}
            <CurationPage />
          {:else if activeTab === 'clusters'}
            <ClustersPage />
          {:else if activeTab === 'exports'}
            <ExportsPage />
          {:else if activeTab === 'frames'}
            <FrameBrowserPage />
          {:else if activeTab === 'admin'}
            <AdministrationPage />
          {:else}
            <EventLogPage />
          {/if}
        {/key}
      </div>
    </section>
  </div>

  <AppStatusBar currentUrl={$page.url} />
  <PreferencesModal open={preferencesOpen} onClose={() => (preferencesOpen = false)} />
</main>
