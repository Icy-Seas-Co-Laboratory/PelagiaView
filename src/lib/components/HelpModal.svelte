<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { markdownToHtml } from '$lib/utils/helpMarkdown';

  export let title: string;
  export let markdown: string;

  const dispatch = createEventDispatcher<{ close: void }>();
  $: html = markdownToHtml(markdown);
</script>

<div class="help-modal-backdrop">
  <button class="help-modal-scrim" type="button" aria-label="Close help" on:click={() => dispatch('close')}></button>
  <div
    class="help-modal"
    role="dialog"
    aria-modal="true"
    aria-label={title}
  >
    <div class="help-modal-header">
      <div>
        <p class="eyebrow">Help</p>
        <h2>{title}</h2>
      </div>
      <button class="icon-button" type="button" aria-label="Close help" on:click={() => dispatch('close')}>×</button>
    </div>
    <div class="help-manual-content">
      {@html html}
    </div>
  </div>
</div>
