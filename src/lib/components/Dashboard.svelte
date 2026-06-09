<script lang="ts">
  import { page } from '$app/stores';
  import EventLogPage from './EventLogPage.svelte';
  import DatasetQueuePage from './DatasetQueuePage.svelte';
  import IngestionPage from './IngestionPage.svelte';
  import RoiBrowserPage from './RoiBrowserPage.svelte';
  import ExplorerPage from './ExplorerPage.svelte';
  import StatusPage from './StatusPage.svelte';
  import { disconnectSession, session } from '$lib/stores/session';
  import {
    dashboardViewDefinition,
    dashboardViewFromParam,
    dashboardViewHref,
    dashboardViews,
    type DashboardView
  } from '$lib/utils/dashboardNavigation';

  let activeTab: DashboardView = 'status';
  $: activeTab = dashboardViewFromParam($page.url.searchParams.get('view'));
  $: activeTabMeta = dashboardViewDefinition(activeTab);
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

  <nav class="breadcrumbs" aria-label="Breadcrumb">
    <a href={dashboardViewHref('status', $page.url)}>Dashboard</a>
    <span aria-hidden="true">/</span>
    <span aria-current="page">{activeTabMeta.label}</span>
  </nav>

  <nav class="tabbar" aria-label="Dashboard sections">
    {#each dashboardViews as tab}
      <a
        href={dashboardViewHref(tab.id, $page.url)}
        class:active={activeTab === tab.id}
      >
        <span>{tab.label}</span>
        <small>{tab.detail}</small>
      </a>
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
