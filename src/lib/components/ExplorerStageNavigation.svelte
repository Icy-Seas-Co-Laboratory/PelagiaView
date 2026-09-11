<script lang="ts">
  import { goto } from '$app/navigation';
  import { explorerStageFromUrl, explorerStageHref, explorerStages } from '$lib/utils/dashboardNavigation';
  import { explorerWorkflow } from '$lib/stores/explorerWorkflow';

  export let currentUrl: URL;
  export let compact = false;

  $: activeStage = explorerStageFromUrl(currentUrl);

  function followStage(event: MouseEvent, stage: (typeof explorerStages)[number]['id']) {
    if ($explorerWorkflow[stage] === 'locked') {
      event.preventDefault();
      return;
    }
    // Keep normal browser affordances for modified clicks, but make an ordinary stage
    // change a client-side URL update. This keeps the modal and its loaded Explorer
    // state mounted rather than presenting a page-style navigation.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void goto(explorerStageHref(stage, currentUrl), { keepFocus: true, noScroll: true });
  }
</script>

<nav class:compact class="explorer-stage-navigation" aria-label="Explorer stages">
  {#each explorerStages as stage, index}
    <a href={explorerStageHref(stage.id, currentUrl)} class:active={activeStage === stage.id} class:locked={$explorerWorkflow[stage.id] === 'locked'} class:complete={$explorerWorkflow[stage.id] === 'complete'} aria-current={activeStage === stage.id ? 'step' : undefined} aria-disabled={$explorerWorkflow[stage.id] === 'locked' ? 'true' : undefined} on:click={(event) => followStage(event, stage.id)} title={$explorerWorkflow[stage.id] === 'locked' ? `Complete the previous stage to unlock ${stage.label}.` : `${stage.label}: ${stage.detail}`}>
      <span class="stage-number">{index + 1}</span>
      <span><strong>{stage.label}</strong>{#if !compact}<small>{stage.detail}</small>{/if}</span>
    </a>
  {/each}
</nav>

<style>
  .explorer-stage-navigation { display: grid; gap: .25rem; }
  .explorer-stage-navigation a { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: .55rem; align-items: center; padding: .55rem .65rem; color: inherit; text-decoration: none; border-radius: .4rem; }
  .explorer-stage-navigation a:hover, .explorer-stage-navigation a:focus-visible, .explorer-stage-navigation a.active { background: var(--wb-accent-soft, #e7f2ed); }
  .explorer-stage-navigation a.locked { cursor: not-allowed; opacity: .46; }
  .explorer-stage-navigation a.complete .stage-number { border-color: var(--wb-accent, #237f63); background: var(--wb-accent, #237f63); color: #fff; }
  .explorer-stage-navigation a > span:last-child { display: grid; gap: .1rem; min-width: 0; }
  .explorer-stage-navigation small { color: var(--wb-text-muted, #60746c); font-size: .75rem; }
  .stage-number { display: grid; place-items: center; width: 1.5rem; height: 1.5rem; border: 1px solid var(--wb-divider, #d9e4e0); border-radius: 50%; font-size: .76rem; font-weight: 800; }
  .compact { display: flex; flex-wrap: wrap; }
  .compact a { grid-template-columns: auto auto; }
</style>
