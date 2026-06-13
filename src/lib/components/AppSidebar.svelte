<script lang="ts">
  import {
    dashboardViewHref,
    dashboardViews,
    type DashboardView
  } from '$lib/utils/dashboardNavigation';

  export let activeView: DashboardView;
  export let currentUrl: URL;
  export let collapsed = false;
  export let onToggle: (() => void) | null = null;

  const groups = [
    { id: 'workflow', label: 'Workflow' },
    { id: 'analysis', label: 'Analysis' },
    { id: 'system', label: 'System' }
  ] as const;
</script>

<aside class="app-sidebar" class:collapsed-sidebar={collapsed} aria-label="Dashboard navigation">
  <div class="sidebar-head">
    <img class="sidebar-logo" src="/brand/pelagia_icon.png" alt="" aria-hidden="true" />
    <div class="sidebar-title">
      <strong>Pelagia</strong>
      <span>View</span>
    </div>
    <button class="sidebar-toggle" type="button" aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} on:click={() => onToggle?.()}>
      {collapsed ? '›' : '‹'}
    </button>
  </div>

  <nav class="sidebar-nav">
    {#each groups as group}
      <section class="sidebar-group" aria-label={group.label}>
        <p>{group.label}</p>
        {#each dashboardViews.filter((view) => view.group === group.id) as view}
          <a href={dashboardViewHref(view.id, currentUrl)} class:active={activeView === view.id} title={`${view.label}: ${view.detail}`}>
            <span>{view.label}</span>
            <small>{view.detail}</small>
          </a>
        {/each}
      </section>
    {/each}
  </nav>
</aside>
