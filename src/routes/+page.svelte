<script lang="ts">
  import { onMount } from 'svelte';
  import Dashboard from '$lib/components/Dashboard.svelte';
  import EndpointLanding from '$lib/components/EndpointLanding.svelte';
  import { restoreSession, session } from '$lib/stores/session';

  onMount(() => {
    void restoreSession();
  });
</script>

{#if $session.connected}
  <Dashboard />
{:else}
  <EndpointLanding />
{/if}
