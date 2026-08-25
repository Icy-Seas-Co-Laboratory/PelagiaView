<script lang="ts">
  import { explorerStageFromUrl, explorerStageHref, explorerStages } from '$lib/utils/dashboardNavigation';

  export let currentUrl: URL;
  export let compact = false;

  $: activeStage = explorerStageFromUrl(currentUrl);
</script>

<nav class:compact class="explorer-stage-navigation" aria-label="Explorer stages">
  {#each explorerStages as stage, index}
    <a href={explorerStageHref(stage.id, currentUrl)} class:active={activeStage === stage.id} aria-current={activeStage === stage.id ? 'step' : undefined} title={`${stage.label}: ${stage.detail}`}>
      <span class="stage-number">{index + 1}</span>
      <span><strong>{stage.label}</strong>{#if !compact}<small>{stage.detail}</small>{/if}</span>
    </a>
  {/each}
</nav>

<style>
  .explorer-stage-navigation { display: grid; gap: .25rem; }
  .explorer-stage-navigation a { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: .55rem; align-items: center; padding: .55rem .65rem; color: inherit; text-decoration: none; border-radius: .4rem; }
  .explorer-stage-navigation a:hover, .explorer-stage-navigation a:focus-visible, .explorer-stage-navigation a.active { background: var(--wb-accent-soft, #e7f2ed); }
  .explorer-stage-navigation a > span:last-child { display: grid; gap: .1rem; min-width: 0; }
  .explorer-stage-navigation small { color: var(--wb-text-muted, #60746c); font-size: .75rem; }
  .stage-number { display: grid; place-items: center; width: 1.5rem; height: 1.5rem; border: 1px solid var(--wb-divider, #d9e4e0); border-radius: 50%; font-size: .76rem; font-weight: 800; }
  .compact { display: flex; flex-wrap: wrap; }
  .compact a { grid-template-columns: auto auto; }
</style>
