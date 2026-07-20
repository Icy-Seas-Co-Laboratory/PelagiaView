<script lang="ts">
  import {
    dashboardViewHref,
    dashboardViews,
    type DashboardView
  } from '$lib/utils/dashboardNavigation';
  import type { AuthUserSummary, ProjectSummary } from '$lib/api/types';

  export let activeView: DashboardView;
  export let currentUrl: URL;
  export let collapsed = false;
  export let user: AuthUserSummary | null = null;
  export let project: ProjectSummary | null = null;
  export let projects: ProjectSummary[] = [];
  export let switchingProject = false;
  export let projectSwitchError: string | null = null;
  export let onToggle: (() => void) | null = null;
  export let onProjectChange: ((event: Event) => void | Promise<void>) | null = null;
  export let onPreferences: (() => void) | null = null;
  export let onDisconnect: (() => void | Promise<void>) | null = null;

  const groups = [
    { id: 'analysis', label: 'Analysis' },
    { id: 'workflow', label: 'Workflow' },
    { id: 'system', label: 'System' }
  ] as const;

  type SidebarGroupId = (typeof groups)[number]['id'];

  $: activeGroup = dashboardViews.find((view) => view.id === activeView)?.group ?? 'analysis';

  function groupViews(groupId: SidebarGroupId) {
    return dashboardViews.filter((view) => view.group === groupId);
  }

  function projectLabel(project: ProjectSummary): string {
    const label = project.project_name ?? project.name ?? project.project_key ?? project.id;
    return project.project_key && label !== project.project_key ? `${label} (${project.project_key})` : label;
  }
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
      {@const views = groupViews(group.id)}
      <details class="sidebar-group" class:active-sidebar-group={group.id === activeGroup} open={group.id === activeGroup}>
        <summary title={`${group.label} pages`}>
          <span class="sidebar-section-label">
            <span class="sidebar-section-eyebrow">Section</span>
            <span>{group.label}</span>
          </span>
          <span class="sidebar-section-caret" aria-hidden="true">▾</span>
        </summary>
        <div class="sidebar-group-items">
          {#each views as view}
            <a href={dashboardViewHref(view.id, currentUrl)} class:active={activeView === view.id} title={`${view.label}: ${view.detail}`}>
              <span>{collapsed ? (view.shortLabel ?? view.label) : view.label}</span>
              <small>{view.detail}</small>
            </a>
          {/each}
        </div>
      </details>
    {/each}
  </nav>

  <div class="sidebar-session" aria-label="Session controls">
    <div class="sidebar-user" title={user?.username ?? 'Authenticated user'}>
      <span>Signed in</span>
      <strong>{user?.display_name ?? user?.username ?? 'Signed in'}</strong>
    </div>

    <label class="sidebar-project-select" title={projectSwitchError ?? 'Active project'}>
      <span>Project</span>
      <select
        value={project?.id ?? ''}
        on:change={(event) => onProjectChange?.(event)}
        disabled={switchingProject || projects.length < 1}
      >
        {#if !project}
          <option value="">No project</option>
        {/if}
        {#each projects as option}
          <option value={option.id}>{projectLabel(option)}</option>
        {/each}
      </select>
    </label>

    {#if projectSwitchError}
      <p class="sidebar-session-error">{projectSwitchError}</p>
    {/if}

    <div class="sidebar-session-actions">
      <button class="ghost" type="button" on:click={() => onPreferences?.()}>Preferences</button>
      <button class="ghost" type="button" on:click={() => onDisconnect?.()}>Disconnect</button>
    </div>
  </div>
</aside>
