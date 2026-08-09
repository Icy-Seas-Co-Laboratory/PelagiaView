<script lang="ts">
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import Dashboard from './Dashboard.svelte';
  import EndpointLanding from './EndpointLanding.svelte';
  import { restoreSession, session, skipSessionRestore } from '$lib/stores/session';
  import { hasSessionLoginPrefill, sessionLoginPrefillFromUrl } from '$lib/utils/sessionLoginPrefill';

  const initialUrl = browser ? new URL(window.location.href) : null;
  const initialLoginPrefill = initialUrl ? sessionLoginPrefillFromUrl(initialUrl) : {};
  const hasInitialLoginPrefill = initialUrl ? hasSessionLoginPrefill(initialUrl) : false;

  if (hasInitialLoginPrefill) skipSessionRestore(initialLoginPrefill.endpoint);

  onMount(() => {
    if (!hasInitialLoginPrefill) void restoreSession();
  });
</script>

{#if $session.connected}<Dashboard />{:else}<EndpointLanding />{/if}
