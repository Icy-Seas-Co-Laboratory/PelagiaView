<script lang="ts">
  import { onMount, tick } from 'svelte';
  import ExplorerPage from './ExplorerPage.svelte';
  import ExplorerStageNavigation from './ExplorerStageNavigation.svelte';

  export let currentUrl: URL;
  export let onClose: (() => void) | null = null;

  let closeButton: HTMLButtonElement;
  let previouslyFocused: HTMLElement | null = null;

  onMount(() => {
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    void tick().then(() => closeButton?.focus());
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKeydown);
    return () => {
      window.removeEventListener('keydown', onKeydown);
      previouslyFocused?.focus();
    };
  });
</script>

<div class="explorer-modal-scrim" role="presentation" on:click={() => onClose?.()} on:keydown={(event) => event.key === 'Escape' && onClose?.()}>
  <div class="explorer-modal" role="dialog" aria-modal="true" aria-labelledby="explorer-modal-title" tabindex="-1" on:click|stopPropagation on:keydown|stopPropagation>
    <header>
      <div><p class="eyebrow">Interactive processing</p><h2 id="explorer-modal-title">Explorer</h2></div>
      <div class="explorer-modal-actions"><ExplorerStageNavigation {currentUrl} compact /><button bind:this={closeButton} class="ghost" type="button" on:click={() => onClose?.()}>Close Explorer</button></div>
    </header>
    <div class="explorer-modal-content"><ExplorerPage /></div>
  </div>
</div>

<style>
  .explorer-modal-scrim { position: fixed; inset: 0; z-index: 75; display: grid; place-items: center; padding: 2.5vh 2.5vw; box-sizing: border-box; background: rgb(8 18 15 / 42%); }
  .explorer-modal { width: min(95vw, 110rem); height: min(95vh, 70rem); display: grid; grid-template-rows: auto minmax(0, 1fr); overflow: hidden; border: 1px solid var(--wb-divider, #c4d4ce); border-radius: .75rem; background: var(--wb-surface, #fff); box-shadow: 0 1.5rem 4rem rgb(5 8 7 / 35%); }
  header { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: .6rem 1rem; border-bottom: 1px solid var(--wb-divider, #d9e4e0); } h2, p { margin: 0; } .explorer-modal-actions { display: flex; align-items: center; gap: .75rem; } .explorer-modal-content { min-height: 0; overflow: hidden; }
  @media (max-width: 800px) { .explorer-modal-scrim { padding: 1.5vh 1.5vw; } .explorer-modal { width: 97vw; height: 97vh; } header, .explorer-modal-actions { align-items: stretch; flex-direction: column; } .explorer-modal-content { overflow: auto; } }
</style>
