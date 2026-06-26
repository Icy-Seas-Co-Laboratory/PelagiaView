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
    <p class="eyebrow">{definition.group}</p>
    <h1>{definition.label}</h1>
  </div>
  {#if definition.nextView && nextDefinition}
    <a class="next-step-button" href={dashboardViewHref(definition.nextView, currentUrl)}>
      <span>Next Step</span>
      <strong>{nextDefinition.label}</strong>
    </a>
  {/if}
</header>
