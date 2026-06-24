<script lang="ts">
  import {
    dashboardViewDefinition,
    dashboardViewHref,
    defaultDashboardView,
    type DashboardView
  } from '$lib/utils/dashboardNavigation';

  export let view: DashboardView;
  export let currentUrl: URL;

  $: definition = dashboardViewDefinition(view);
  $: nextDefinition = definition.nextView ? dashboardViewDefinition(definition.nextView) : null;
</script>

<header class="page-header">
  <div>
    <nav class="breadcrumbs" aria-label="Breadcrumb">
      <a href={dashboardViewHref(defaultDashboardView, currentUrl)}>Dashboard</a>
      <span aria-hidden="true">/</span>
      <span aria-current="page">{definition.label}</span>
    </nav>
    <p class="eyebrow">{definition.group}</p>
    <h1>{definition.label}</h1>
    <p class="page-subtitle">{definition.detail}</p>
  </div>
  {#if definition.nextView && nextDefinition}
    <a class="next-step-button" href={dashboardViewHref(definition.nextView, currentUrl)}>
      <span>Next Step</span>
      <strong>{nextDefinition.label}</strong>
    </a>
  {/if}
</header>
