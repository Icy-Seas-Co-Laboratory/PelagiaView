<script lang="ts">
  export let showScaleBar = false;
  export let applyMask = false;
  export let showExcludedMask = false;
  export let includeMaskControls = false;
</script>

<div class="inspector-image-controls" role="group" aria-label="Image view options">
  <button
    type="button"
    class:active={showScaleBar}
    aria-pressed={showScaleBar}
    on:click={() => (showScaleBar = !showScaleBar)}
  >
    Scale bar
  </button>
  {#if includeMaskControls}
    <button
      type="button"
      class:active={applyMask}
      aria-pressed={applyMask}
      on:click={() => (applyMask = !applyMask)}
    >
      Apply mask
    </button>
    <button
      type="button"
      class:active={showExcludedMask}
      aria-pressed={showExcludedMask}
      on:click={() => (showExcludedMask = !showExcludedMask)}
    >
      Excluded mask
    </button>
  {/if}
</div>

<style>
  .inspector-image-controls {
    display: flex;
    width: 100%;
    overflow-x: auto;
    border: 1px solid var(--app-border-soft, #cbd5d9);
    border-radius: 0.35rem;
    background: var(--app-surface-soft, #f4f7f6);
    scrollbar-width: thin;
  }

  button {
    flex: 1 0 auto;
    min-height: 1.85rem;
    border: 0;
    border-right: 1px solid var(--app-border-soft, #cbd5d9);
    border-radius: 0;
    padding: 0.28rem 0.5rem;
    color: var(--app-muted, #62746f);
    background: transparent;
    font-size: var(--wb-font-caption, 0.75rem);
    font-weight: 750;
    line-height: 1;
    white-space: nowrap;
  }

  button:last-child { border-right: 0; }

  button:hover { background: var(--app-accent-soft, #e0f0ec); }

  button.active {
    color: var(--app-accent-strong, #115e55);
    background: var(--app-accent-soft, #dcefeb);
    box-shadow: inset 0 -2px 0 var(--app-accent, #16806f);
  }
</style>
