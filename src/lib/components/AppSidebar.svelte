<script lang="ts">
  import {
    dashboardSectionViews,
    dashboardViewHref,
    explorerStageFromUrl,
    explorerStageHref,
    explorerStages,
    type DashboardView
  } from '$lib/utils/dashboardNavigation';
  import HeaderProcessingPresetSelect from './HeaderProcessingPresetSelect.svelte';

  export let activeView: DashboardView;
  export let currentUrl: URL;
  export let mode: 'workflow' | 'explorer' = 'workflow';
  export let collapsed = false;
  export let onToggle: (() => void) | null = null;

  const steps = dashboardSectionViews('workflow');
  $: activeExplorerStage = explorerStageFromUrl(currentUrl);
</script>

<aside class="workflow-sidebar" class:collapsed-sidebar={collapsed} aria-label={mode === 'explorer' ? 'Explorer sequence' : 'Processing workflow'}>
  <div class="workflow-sidebar-heading">
    <div><p class="eyebrow">Processing sequence</p><h2>{mode === 'explorer' ? 'Explorer' : 'Workflow'}</h2></div>
    <button class="sidebar-toggle" type="button" aria-label={collapsed ? 'Expand sequence navigation' : 'Collapse sequence navigation'} on:click={() => onToggle?.()}>{collapsed ? '›' : '‹'}</button>
  </div>
  <nav>
    {#if mode === 'explorer'}
      {#each explorerStages as step, index}
        <a href={explorerStageHref(step.id, currentUrl)} class:active={activeExplorerStage === step.id} aria-current={activeExplorerStage === step.id ? 'step' : undefined} title={`${step.label}: ${step.detail}`}>
          <span class="workflow-step-number">{index + 1}</span>
          <span class="workflow-step-copy"><strong>{step.label}</strong><small>{step.detail}</small></span>
        </a>
      {/each}
    {:else}
      {#each steps as step, index}
        <a href={dashboardViewHref(step.id, currentUrl)} class:active={activeView === step.id} aria-current={activeView === step.id ? 'step' : undefined} title={`${step.label}: ${step.detail}`}>
          <span class="workflow-step-number">{index + 1}</span>
          <span class="workflow-step-copy"><strong>{step.label}</strong><small>{step.detail}</small></span>
        </a>
      {/each}
    {/if}
  </nav>
  <div class="workflow-sidebar-footer">
    <div class="sidebar-preset"><HeaderProcessingPresetSelect /></div>
    {#if mode === 'workflow'}<div class="workflow-handoff"><span>Output</span><a href={dashboardViewHref('rois', currentUrl)}>Inspect refined ROIs →</a></div>{/if}
  </div>
</aside>
