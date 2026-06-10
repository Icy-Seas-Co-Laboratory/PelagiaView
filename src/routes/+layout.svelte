<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import { onMount } from 'svelte';
  import { initClientAnalytics, recordRouteChange } from '$lib/utils/analytics';
  import '../app.css';

  afterNavigate(({ to }) => {
    if (!to) return;
    recordRouteChange(to.url.pathname + to.url.search);
  });

  onMount(() => initClientAnalytics());
</script>

<slot />
