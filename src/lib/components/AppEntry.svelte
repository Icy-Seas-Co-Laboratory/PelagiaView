<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import Dashboard from './Dashboard.svelte';
  import EndpointLanding from './EndpointLanding.svelte';
  import { restoreSession, session, skipSessionRestore } from '$lib/stores/session';
  import { hasSessionLoginPrefill, sessionLoginPrefillFromUrl } from '$lib/utils/sessionLoginPrefill';

  const initialUrl = browser ? new URL(window.location.href) : null;
  const initialLoginPrefill = initialUrl ? sessionLoginPrefillFromUrl(initialUrl) : {};
  const hasInitialLoginPrefill = initialUrl ? hasSessionLoginPrefill(initialUrl) : false;

  if (hasInitialLoginPrefill) skipSessionRestore(initialLoginPrefill.endpoint);
  let registryPage: Promise<typeof import('$lib/registry/RegistryPage.svelte')> | null = null;
  $: if ($page.route.id === '/registry' && registryPage === null) {
    registryPage = import('$lib/registry/RegistryPage.svelte');
  }

  onMount(() => {
    if (!hasInitialLoginPrefill) void restoreSession();
  });
</script>

{#if $session.connected}
  {#if $page.route.id === '/registry'}
    {#if registryPage}{#await registryPage}<p class="registry-loading">Loading Registry…</p>{:then module}<svelte:component this={module.default} />{/await}{/if}
  {:else}<Dashboard />{/if}
{:else}
  <EndpointLanding />
{/if}

<style>
  .registry-loading { padding: 2rem; color: var(--text-muted, #52616a); }
</style>
