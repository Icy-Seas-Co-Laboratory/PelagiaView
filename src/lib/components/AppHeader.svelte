<script lang="ts">
  import { browser } from '$app/environment';
  import { base } from '$app/paths';
  import HeaderImageInversionToggle from './HeaderImageInversionToggle.svelte';
  import {
    dashboardSections,
    dashboardSectionViews,
    dashboardViewDefinition,
    dashboardViewHref,
    type DashboardSection,
    type DashboardView
  } from '$lib/utils/dashboardNavigation';
  import type { AuthUserSummary, ProjectSummary } from '$lib/api/types';

  export let activeView: DashboardView;
  export let currentUrl: URL;
  export let user: AuthUserSummary | null = null;
  export let project: ProjectSummary | null = null;
  export let projects: ProjectSummary[] = [];
  export let switchingProject = false;
  export let projectSwitchError: string | null = null;
  export let onProjectChange: ((event: Event) => void | Promise<void>) | null = null;
  export let onPreferences: (() => void) | null = null;
  export let onDisconnect: (() => void | Promise<void>) | null = null;

  $: activeDefinition = dashboardViewDefinition(activeView);
  $: activeSection = activeDefinition.group;
  $: secondaryViews = activeSection === 'workflow' || activeSection === 'explorer' ? [] : dashboardSectionViews(activeSection);
  const lastViewKey = 'pelagia-view:last-section-views';
  let lastViews: Partial<Record<DashboardSection, DashboardView>> = browser ? readLastViews() : {};
  $: if (browser && activeView) {
    lastViews = { ...lastViews, [activeSection]: activeView };
    localStorage.setItem(lastViewKey, JSON.stringify(lastViews));
  }

  function projectLabel(value: ProjectSummary): string {
    const label = value.project_name ?? value.name ?? value.project_key ?? value.id;
    return value.project_key && label !== value.project_key ? `${label} (${value.project_key})` : label;
  }

  function sectionHref(section: DashboardSection): string {
    const preferredId = lastViews[section];
    const preferred = dashboardSectionViews(section).find((view) => view.id === preferredId) ?? dashboardSectionViews(section)[0];
    return dashboardViewHref(preferred.id, currentUrl);
  }

  function readLastViews(): Partial<Record<DashboardSection, DashboardView>> {
    try { return JSON.parse(localStorage.getItem(lastViewKey) ?? '{}'); } catch { return {}; }
  }
</script>

<header class="app-header">
  <div class="app-header-main">
    <a class="app-brand" href={dashboardViewHref('rois', currentUrl)} aria-label="Pelagia analysis home">
      <img src={`${base}/brand/pelagia_icon.png`} alt="" aria-hidden="true" />
      <span><strong>Pelagia</strong><small>Scientific image workspace</small></span>
    </a>

    <nav class="primary-navigation" aria-label="Primary navigation">
      {#each dashboardSections as section}
        <a href={sectionHref(section.id)} class:active={activeSection === section.id} aria-current={activeSection === section.id ? 'page' : undefined}>
          <strong>{section.label}</strong>
          <small>{section.detail}</small>
        </a>
      {/each}
      <a href={`${base}/registry/`}>
        <strong>Registry</strong>
        <small>Curate portable datasets</small>
      </a>
    </nav>

    <div class="global-tools">
      <label class="project-switcher" title={projectSwitchError ?? 'Active scientific project'}>
        <span>Project</span>
        <select value={project?.id ?? ''} on:change={(event) => onProjectChange?.(event)} disabled={switchingProject || projects.length < 1}>
          {#if !project}<option value="">No project</option>{/if}
          {#each projects as option}<option value={option.id}>{projectLabel(option)}</option>{/each}
        </select>
      </label>
      {#if activeSection === 'analysis' || activeSection === 'explorer'}<HeaderImageInversionToggle />{/if}
      <details class="account-menu">
        <summary title={user?.username ?? 'Account'}><span>{(user?.display_name ?? user?.username ?? 'U').slice(0, 1).toUpperCase()}</span></summary>
        <div>
          <p>Signed in as</p><strong>{user?.display_name ?? user?.username ?? 'User'}</strong>
          <button class="ghost" type="button" on:click={() => { onPreferences?.(); }}>Preferences</button>
          <button class="ghost" type="button" on:click={() => onDisconnect?.()}>Disconnect</button>
        </div>
      </details>
    </div>
  </div>

  <div class="context-navigation">
    <div class="page-identity">
      <strong>{activeDefinition.label}</strong>
      <small>{activeDefinition.detail}</small>
    </div>
    {#if secondaryViews.length}
      <nav class="secondary-navigation" aria-label={`${activeDefinition.group} pages`}>
        {#each secondaryViews as view}
          <a href={dashboardViewHref(view.id, currentUrl)} class:active={activeView === view.id} aria-current={activeView === view.id ? 'page' : undefined}>{view.label}</a>
        {/each}
      </nav>
    {:else if activeSection === 'workflow'}
      <p class="workflow-context">Follow the processing sequence from source assets to refined ROIs.</p>
    {/if}
  </div>
  {#if projectSwitchError}<p class="header-error">{projectSwitchError}</p>{/if}
</header>
