<script lang="ts">
  import HelpModal from '$lib/components/HelpModal.svelte';
  import { helpTopics, type HelpTopicId } from '$lib/help/topics';

  export let topic: HelpTopicId;
  export let label = 'Open help';
  export let eyebrow = 'Help';

  let open = false;
  $: helpTopic = helpTopics[topic];
</script>

<button
  type="button"
  class="field-help-icon help-modal-chip"
  aria-label={label}
  title={label}
  on:click|preventDefault={() => (open = true)}
>
  ?
</button>

{#if open}
  <HelpModal title={helpTopic.title} markdown={helpTopic.markdown} {eyebrow} on:close={() => (open = false)} />
{/if}
