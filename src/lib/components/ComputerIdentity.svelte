<script lang="ts">
  export let name: string | null | undefined = null;
  $: label = name?.trim() || 'Unavailable';
</script>

<span class="computer-identity" title={`Computer: ${label}`} aria-label={`Computer: ${label}`}>
  <span>Computer</span>
  <strong>{label}</strong>
</span>
