<script lang="ts">
  import Dashboard from '$lib/components/Dashboard.svelte';
  import EndpointLanding from '$lib/components/EndpointLanding.svelte';
  import { session } from '$lib/stores/session';
</script>

{#if $session.connected}
  <Dashboard />
{:else}
  <EndpointLanding />
{/if}
