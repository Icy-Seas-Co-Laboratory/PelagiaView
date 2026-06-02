<script lang="ts">
  import { onMount } from 'svelte';
  import { getClient } from '$lib/stores/session';
  import type { JobEvent } from '$lib/api/types';
  import { formatDate } from '$lib/utils/format';

  let events: JobEvent[] = [];
  let paused = false;
  let error: string | null = null;

  onMount(() => {
    let cancelled = false;

    async function load() {
      if (paused) return;
      const client = getClient();
      if (!client) return;
      try {
        const latestId = events.reduce((max, event) => Math.max(max, Number(event.id ?? 0)), 0);
        const next = await client.listJobEvents(latestId || undefined, 150);
        if (!cancelled && next.length) {
          const merged = [...next, ...events].sort((a, b) => Number(b.id) - Number(a.id));
          events = merged.slice(0, 250);
        }
      } catch (err) {
        if (!cancelled) error = err instanceof Error ? err.message : String(err);
      }
    }

    load();
    const timer = window.setInterval(load, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  });
</script>

<section class="panel log-panel">
  <div class="panel-heading">
    <div>
      <p class="eyebrow">Events</p>
      <h2>Job event stream</h2>
    </div>
    <button class="ghost" type="button" on:click={() => (paused = !paused)}>{paused ? 'Resume' : 'Pause'}</button>
  </div>

  <p class="callout">Currently polling <code>GET /jobs/events</code>. Suggested live endpoint: <code>GET /live/logs</code> with job, worker, API, and processing messages in a single stream.</p>

  {#if error}<p class="form-error">{error}</p>{/if}

  <div class="timeline" aria-live="polite">
    {#each events as event}
      <article class="log-entry">
        <div class="log-meta">
          <strong>{event.event_type ?? 'event'}</strong>
          <span>{formatDate(event.created_at)}</span>
        </div>
        <p>{event.message ?? event.job_id ?? 'No message payload'}</p>
        {#if event.payload}
          <pre>{JSON.stringify(event.payload, null, 2)}</pre>
        {/if}
      </article>
    {:else}
      <p class="empty">No job events yet.</p>
    {/each}
  </div>
</section>
