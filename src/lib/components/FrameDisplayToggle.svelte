<script lang="ts">
  import type { FrameDisplayMode } from '$lib/utils/frameDisplay';

  export let value: FrameDisplayMode = 'original';
</script>

<div class="frame-type-toggle" aria-label="Frame preview source">
  <button
    type="button"
    class:active={value === 'original'}
    on:click={() => (value = 'original')}
  >
    Original
  </button>
  <button
    type="button"
    class:active={value === 'preprocessed'}
    on:click={() => (value = 'preprocessed')}
  >
    Preprocessed
  </button>
  <button
    type="button"
    class:active={value === 'preprocessed-inverted'}
    on:click={() => (value = 'preprocessed-inverted')}
  >
    Preprocessed inverted
  </button>
</div>
