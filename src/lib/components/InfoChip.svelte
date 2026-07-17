<script lang="ts">
  export let text: string;
  export let label = 'Help';
</script>

<button
  type="button"
  class="field-help-icon"
  aria-label={label}
  data-help={text}
  on:click|preventDefault
>
  i
</button>
