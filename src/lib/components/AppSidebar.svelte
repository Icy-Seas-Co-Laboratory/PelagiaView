<script lang="ts">
  import {
    dashboardSectionViews,
    dashboardViewHref,
    type DashboardView
  } from '$lib/utils/dashboardNavigation';
  import HeaderProcessingPresetSelect from './HeaderProcessingPresetSelect.svelte';
  import ExplorerStageNavigation from './ExplorerStageNavigation.svelte';

  export let activeView: DashboardView;
  export let currentUrl: URL;
  export let mode: 'workflow' | 'explorer' = 'workflow';
  export let collapsed = false;
  export let onToggle: (() => void) | null = null;

  const steps = dashboardSectionViews('workflow');
</script>

<aside class="workflow-sidebar" class:collapsed-sidebar={collapsed} aria-label={mode === 'explorer' ? 'Explorer sequence' : 'Processing workflow'}>
  <div class="workflow-sidebar-heading">
    <div><p class="eyebrow">Processing sequence</p><h2>{mode === 'explorer' ? 'Explorer' : 'Workflow'}</h2></div>
    <button class="sidebar-toggle" type="button" aria-label={collapsed ? 'Expand sequence navigation' : 'Collapse sequence navigation'} on:click={() => onToggle?.()}>{collapsed ? '›' : '‹'}</button>
  </div>
  {#if mode === 'explorer'}
    <ExplorerStageNavigation {currentUrl} />
  {:else}
    <nav>
      {#each steps as step, index}
        <a href={dashboardViewHref(step.id, currentUrl)} class:active={activeView === step.id} aria-current={activeView === step.id ? 'step' : undefined} title={`${step.label}: ${step.detail}`}>
          <span class="workflow-step-number">{index + 1}</span>
          <span class="workflow-step-copy"><strong>{step.label}</strong><small>{step.detail}</small></span>
        </a>
      {/each}
    </nav>
  {/if}
  <div class="workflow-sidebar-footer">
    <div class="sidebar-preset"><HeaderProcessingPresetSelect /></div>
    {#if mode === 'workflow'}<div class="workflow-handoff"><span>Output</span><a href={dashboardViewHref('rois', currentUrl)}>Inspect refined ROIs →</a></div>{/if}
  </div>
</aside>
