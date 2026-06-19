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
