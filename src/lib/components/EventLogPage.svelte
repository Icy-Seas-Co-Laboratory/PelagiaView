<script lang="ts">
  import { onMount } from 'svelte';
  import { getClient } from '$lib/stores/session';
  import type { JobEvent, LogEntry } from '$lib/api/types';
  import { formatCount, formatDate } from '$lib/utils/format';

  type EventSource = 'all' | 'logs' | 'queue';
  type NormalizedLogEvent = {
    key: string;
    source: 'logs' | 'queue';
    id: number;
    eventType: string;
    level: string;
    message: string;
    createdAt: string | null;
    logger: string | null;
    runId: string | null;
    assetId: string | null;
    jobId: string | null;
    workerId: string | null;
    requestId: string | null;
    stage: string | null;
    status: string | null;
    durationMs: number | null;
    payload: Record<string, unknown> | null;
  };

  let events: NormalizedLogEvent[] = [];
  let paused = false;
  let loading = true;
  let error: string | null = null;
  let sourceFilter: EventSource = 'all';
  let levelFilter = 'any';
  let eventTypeFilter = 'any';
  let stageFilter = 'any';
  let statusFilter = 'any';
  let searchText = '';
  let runIdFilter = '';
  let jobIdFilter = '';
  let workerIdFilter = '';
  let showPayloads = false;
  let showWorkerTouched = false;
  let lastFilterKey = '';
  let loadedLogMaxId = 0;
  let loadedQueueMaxId = 0;

  const pageLimit = 250;
  const pollLimit = 150;

  $: filterKey = JSON.stringify({
    sourceFilter,
    levelFilter,
    eventTypeFilter,
    stageFilter,
    statusFilter,
    searchText,
    runIdFilter,
    jobIdFilter,
    workerIdFilter
  });
  $: if (lastFilterKey && filterKey !== lastFilterKey) {
    lastFilterKey = filterKey;
    void resetAndLoad();
  } else if (!lastFilterKey) {
    lastFilterKey = filterKey;
  }
  $: filteredEvents = events.filter(matchesFilters);
  $: eventTypes = uniqueOptions(events.map((event) => event.eventType));
  $: stages = uniqueOptions(events.map((event) => event.stage));
  $: statuses = uniqueOptions(events.map((event) => event.status));
  $: levelCounts = countBy(events, (event) => event.level || 'info');
  $: queueCount = events.filter((event) => event.source === 'queue').length;
  $: logCount = events.filter((event) => event.source === 'logs').length;
  $: visibleEvents = filteredEvents.slice(0, pageLimit);

  onMount(() => {
    let cancelled = false;

    async function tick() {
      if (cancelled || paused) return;
      await loadEvents();
    }

    void tick();
    const timer = window.setInterval(tick, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  });

  async function resetAndLoad() {
    events = [];
    loadedLogMaxId = 0;
    loadedQueueMaxId = 0;
    await loadEvents({ reset: true });
  }

  async function loadEvents(options: { reset?: boolean } = {}) {
    const client = getClient();
    if (!client) return;
    loading = true;
    try {
      const runId = emptyToNull(runIdFilter);
      const jobId = emptyToNull(jobIdFilter);
      const workerId = emptyToNull(workerIdFilter);
      const requests: Array<Promise<NormalizedLogEvent[]>> = [];

      if (sourceFilter !== 'queue') {
        requests.push(
          client
            .listLogs({
              after_id: options.reset ? null : loadedLogMaxId || null,
              limit: pollLimit,
              level: levelFilter === 'any' ? null : levelFilter,
              event_type: eventTypeFilter === 'any' ? null : eventTypeFilter,
              run_id: runId,
              job_id: jobId,
              worker_id: workerId
            })
            .then((logs) => logs.map(normalizeLogEntry))
        );
      }

      if (sourceFilter !== 'logs') {
        requests.push(
          client
            .listJobEvents({
              after_id: options.reset ? null : loadedQueueMaxId || null,
              limit: pollLimit,
              run_id: runId,
              job_id: jobId
            })
            .then((jobEvents) => jobEvents.map(normalizeJobEvent))
        );
      }

      const nextEvents = (await Promise.all(requests)).flat();
      mergeEvents(nextEvents);
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  function mergeEvents(nextEvents: NormalizedLogEvent[]) {
    if (!nextEvents.length) return;
    const byKey = new Map(events.map((event) => [event.key, event]));
    for (const event of nextEvents) {
      byKey.set(event.key, event);
      if (event.source === 'logs') loadedLogMaxId = Math.max(loadedLogMaxId, event.id);
      if (event.source === 'queue') loadedQueueMaxId = Math.max(loadedQueueMaxId, event.id);
    }
    events = [...byKey.values()].sort(compareEvents).slice(0, 600);
  }

  function normalizeLogEntry(entry: LogEntry): NormalizedLogEvent {
    return {
      key: `logs:${entry.id}`,
      source: 'logs',
      id: Number(entry.id ?? 0),
      eventType: entry.event_type ?? 'log.event',
      level: (entry.level ?? eventLevel(entry.event_type)).toLowerCase(),
      message: entry.message ?? entry.logger ?? entry.job_id ?? 'No message payload',
      createdAt: entry.created_at ?? null,
      logger: entry.logger ?? null,
      runId: entry.run_id ?? null,
      assetId: entry.asset_id ?? null,
      jobId: entry.job_id ?? null,
      workerId: entry.worker_id ?? null,
      requestId: entry.request_id ?? null,
      stage: payloadString(entry.payload, 'stage'),
      status: payloadString(entry.payload, 'status'),
      durationMs: entry.duration_ms ?? null,
      payload: entry.payload ?? null
    };
  }

  function normalizeJobEvent(entry: JobEvent): NormalizedLogEvent {
    return {
      key: `queue:${entry.id}`,
      source: 'queue',
      id: Number(entry.id ?? 0),
      eventType: entry.event_type ?? 'job.event',
      level: eventLevel(entry.event_type),
      message: entry.message ?? jobEventMessage(entry),
      createdAt: entry.created_at ?? null,
      logger: 'job_queue',
      runId: entry.run_id ?? payloadString(entry.payload, 'run_id'),
      assetId: payloadString(entry.payload, 'asset_id'),
      jobId: entry.job_id ?? null,
      workerId: payloadString(entry.payload, 'worker_id'),
      requestId: null,
      stage: payloadString(entry.payload, 'stage'),
      status: payloadString(entry.payload, 'status'),
      durationMs: null,
      payload: entry.payload ?? null
    };
  }

  function matchesFilters(event: NormalizedLogEvent): boolean {
    const needle = searchText.trim().toLowerCase();
    if (!showWorkerTouched && event.eventType === 'worker.touched' && eventTypeFilter !== 'worker.touched') return false;
    if (sourceFilter !== 'all' && event.source !== sourceFilter) return false;
    if (levelFilter !== 'any' && event.level !== levelFilter) return false;
    if (eventTypeFilter !== 'any' && event.eventType !== eventTypeFilter) return false;
    if (stageFilter !== 'any' && event.stage !== stageFilter) return false;
    if (statusFilter !== 'any' && event.status !== statusFilter) return false;
    if (!matchesText(event.runId, runIdFilter)) return false;
    if (!matchesText(event.jobId, jobIdFilter)) return false;
    if (!matchesText(event.workerId, workerIdFilter)) return false;
    if (!needle) return true;
    return searchableText(event).includes(needle);
  }

  function clearFilters() {
    sourceFilter = 'all';
    levelFilter = 'any';
    eventTypeFilter = 'any';
    stageFilter = 'any';
    statusFilter = 'any';
    searchText = '';
    runIdFilter = '';
    jobIdFilter = '';
    workerIdFilter = '';
  }

  function uniqueOptions(values: Array<string | null | undefined>): string[] {
    return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b));
  }

  function countBy<T>(items: T[], accessor: (item: T) => string): Record<string, number> {
    return items.reduce<Record<string, number>>((counts, item) => {
      const key = accessor(item);
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {});
  }

  function compareEvents(a: NormalizedLogEvent, b: NormalizedLogEvent): number {
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (timeA !== timeB) return timeB - timeA;
    return b.id - a.id;
  }

  function payloadString(payload: Record<string, unknown> | undefined | null, key: string): string | null {
    const value = payload?.[key];
    if (value === undefined || value === null || value === '') return null;
    return String(value);
  }

  function eventLevel(eventType?: string): string {
    const value = String(eventType ?? '').toLowerCase();
    if (value.includes('failed') || value.includes('error') || value.includes('dead_letter')) return 'error';
    if (value.includes('warning') || value.includes('retry') || value.includes('paused')) return 'warning';
    if (value.includes('debug')) return 'debug';
    return 'info';
  }

  function jobEventMessage(event: JobEvent): string {
    const suffix = event.job_id ? ` for ${event.job_id}` : '';
    return `Queue event ${event.event_type ?? 'job.event'}${suffix}`;
  }

  function searchableText(event: NormalizedLogEvent): string {
    return [
      event.source,
      event.level,
      event.eventType,
      event.message,
      event.logger,
      event.runId,
      event.assetId,
      event.jobId,
      event.workerId,
      event.requestId,
      event.stage,
      event.status,
      event.payload ? JSON.stringify(event.payload) : ''
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  }

  function matchesText(value: string | null, filter: string): boolean {
    const needle = filter.trim().toLowerCase();
    if (!needle) return true;
    return String(value ?? '').toLowerCase().includes(needle);
  }

  function emptyToNull(value: string): string | null {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  function sourceLabel(source: NormalizedLogEvent['source']): string {
    return source === 'queue' ? 'Queue' : 'Logs';
  }

  function formatDuration(value: number | null): string {
    if (value === null || Number.isNaN(value)) return '';
    if (value < 1000) return `${value.toFixed(0)} ms`;
    return `${(value / 1000).toFixed(2)} s`;
  }
</script>

<section class="panel log-panel">
  <div class="panel-heading">
    <div>
      <p class="eyebrow">Events</p>
      <h2>Event stream</h2>
    </div>
    <div class="inline-controls">
      <button class="ghost" type="button" on:click={() => loadEvents({ reset: true })} disabled={loading}>Refresh</button>
      <button class="ghost" type="button" on:click={() => (paused = !paused)}>{paused ? 'Resume' : 'Pause'}</button>
    </div>
  </div>

  <div class="log-summary-grid">
    <div>
      <span>Total loaded</span>
      <strong>{formatCount(events.length)}</strong>
    </div>
    <div>
      <span>Visible</span>
      <strong>{formatCount(filteredEvents.length)}</strong>
    </div>
    <div>
      <span>Queue events</span>
      <strong>{formatCount(queueCount)}</strong>
    </div>
    <div>
      <span>System logs</span>
      <strong>{formatCount(logCount)}</strong>
    </div>
    <div>
      <span>Warnings</span>
      <strong>{formatCount(levelCounts.warning ?? 0)}</strong>
    </div>
    <div>
      <span>Errors</span>
      <strong>{formatCount(levelCounts.error ?? 0)}</strong>
    </div>
  </div>

  <div class="log-filter-panel">
    <label>
      Source
      <select bind:value={sourceFilter}>
        <option value="all">All sources</option>
        <option value="queue">Job queue</option>
        <option value="logs">/logs</option>
      </select>
    </label>
    <label>
      Level
      <select bind:value={levelFilter}>
        <option value="any">Any level</option>
        <option value="debug">Debug</option>
        <option value="info">Info</option>
        <option value="warning">Warning</option>
        <option value="error">Error</option>
      </select>
    </label>
    <label>
      Event type
      <select bind:value={eventTypeFilter}>
        <option value="any">Any event</option>
        {#each eventTypes as eventType}
          <option value={eventType}>{eventType}</option>
        {/each}
      </select>
    </label>
    <label>
      Stage
      <select bind:value={stageFilter}>
        <option value="any">Any stage</option>
        {#each stages as stage}
          <option value={stage}>{stage}</option>
        {/each}
      </select>
    </label>
    <label>
      Status
      <select bind:value={statusFilter}>
        <option value="any">Any status</option>
        {#each statuses as status}
          <option value={status}>{status}</option>
        {/each}
      </select>
    </label>
    <label>
      Search
      <input bind:value={searchText} placeholder="message, id, payload..." />
    </label>
    <label>
      Run ID
      <input bind:value={runIdFilter} placeholder="optional" />
    </label>
    <label>
      Job ID
      <input bind:value={jobIdFilter} placeholder="optional" />
    </label>
    <label>
      Worker ID
      <input bind:value={workerIdFilter} placeholder="optional" />
    </label>
  </div>

  <div class="log-toolbar">
    <label class="check-row">
      <input type="checkbox" bind:checked={showPayloads} />
      <span>Show payloads</span>
    </label>
    <label class="check-row">
      <input type="checkbox" bind:checked={showWorkerTouched} />
      <span>Show worker touch events</span>
    </label>
    <button class="ghost" type="button" on:click={clearFilters}>Clear filters</button>
    <p>{paused ? 'Live polling paused.' : 'Polling every 3 seconds.'}</p>
  </div>

  {#if error}<p class="form-error">{error}</p>{/if}

  <div class="timeline" aria-live="polite">
    {#each visibleEvents as event}
      <article class="log-entry {event.level}" class:queue-event={event.source === 'queue'}>
        <div class="log-meta">
          <div class="log-title-stack">
            <span class="log-source-pill">{sourceLabel(event.source)}</span>
            <strong>{event.eventType}</strong>
            <span class="log-level-pill">{event.level}</span>
          </div>
          <span>{formatDate(event.createdAt)}</span>
        </div>
        <p>{event.message}</p>
        <dl class="log-context">
          {#if event.stage}<div><dt>Stage</dt><dd>{event.stage}</dd></div>{/if}
          {#if event.status}<div><dt>Status</dt><dd>{event.status}</dd></div>{/if}
          {#if event.jobId}<div><dt>Job</dt><dd>{event.jobId}</dd></div>{/if}
          {#if event.runId}<div><dt>Run</dt><dd>{event.runId}</dd></div>{/if}
          {#if event.workerId}<div><dt>Worker</dt><dd>{event.workerId}</dd></div>{/if}
          {#if event.logger}<div><dt>Logger</dt><dd>{event.logger}</dd></div>{/if}
          {#if event.durationMs !== null}<div><dt>Duration</dt><dd>{formatDuration(event.durationMs)}</dd></div>{/if}
        </dl>
        {#if showPayloads && event.payload}
          <pre>{JSON.stringify(event.payload, null, 2)}</pre>
        {/if}
      </article>
    {:else}
      <p class="empty">{loading ? 'Loading events.' : 'No events match the current filters.'}</p>
    {/each}
  </div>
</section>
