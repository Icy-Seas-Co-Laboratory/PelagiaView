<script lang="ts">
  import { onMount } from 'svelte';
  import Dashboard from '$lib/components/Dashboard.svelte';
  import EndpointLanding from '$lib/components/EndpointLanding.svelte';
  import { restoreSession, session, skipSessionRestore } from '$lib/stores/session';
  import { hasSessionLoginPrefill, sessionLoginPrefillFromUrl } from '$lib/utils/sessionLoginPrefill';

  onMount(() => {
    const url = new URL(window.location.href);
    if (hasSessionLoginPrefill(url)) {
      skipSessionRestore(sessionLoginPrefillFromUrl(url).endpoint);
      return;
    }
    void restoreSession();
  });
</script>

{#if $session.connected}
  <Dashboard />
{:else}
  <EndpointLanding />
{/if}
