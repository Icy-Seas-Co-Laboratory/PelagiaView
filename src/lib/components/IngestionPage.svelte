<script lang="ts">
  import { onMount } from 'svelte';
  import QueueStatusSummary from '$lib/components/QueueStatusSummary.svelte';
  import { getClient } from '$lib/stores/session';
  import type { DirectoryEntry, DirectoryListing, SystemConfigResponse } from '$lib/api/types';
  import type { ProcessingPreset, ProcessingSettings } from '$lib/processing/settings';
  import { PROCESSING_PRESET_APPLIED_EVENT, pruneProcessingSettings } from '$lib/processing/settings';
  import {
    currentLiveProcessingPreset,
    setLiveProcessingPresetFromSettings
  } from '$lib/stores/processingPresetSession';
  import { numberDefault, processingSection } from '$lib/utils/configDefaults';
  import { formatBytes } from '$lib/utils/format';
  import {
    numberPreference,
    preferenceKey,
    readPreferences,
    stringPreference,
    writePreferences
  } from '$lib/utils/preferences';

  let listing: DirectoryListing | null = null;
  let selected = new Set<string>();
  let manualPaths = '';
  let currentPath = '.';
  let loading = true;
  let message: string | null = null;
  let error: string | null = null;
  let nTile = 2;
  let collections = '';
  let metadataText = '';
  let preferencesReady = false;
  let submittedJobIds: string[] = [];
  const metadataPlaceholder = '{"cruise":"SKQ2026","station":"A01"}';
  const ingestionPreferenceKey = preferenceKey('ingestion');

  type IngestionPreferences = {
    currentPath: string;
    manualPaths: string;
    nTile: number;
    collections: string;
    metadataText: string;
  };

  $: ingestionPreferenceSnapshot = {
    currentPath,
    manualPaths,
    nTile,
    collections,
    metadataText
  };
  $: if (preferencesReady) writePreferences(ingestionPreferenceKey, ingestionPreferenceSnapshot);
  $: if (preferencesReady) {
    ingestionPreferenceSnapshot;
    setLiveProcessingPresetFromSettings(captureProcessingSettings());
  }

  onMount(() => {
    window.addEventListener(PROCESSING_PRESET_APPLIED_EVENT, handleHeaderProcessingPresetApplied);
    void initializeIngestion();
    return () => {
      window.removeEventListener(PROCESSING_PRESET_APPLIED_EVENT, handleHeaderProcessingPresetApplied);
    };
  });

  async function initializeIngestion() {
    const client = getClient();
    if (client) {
      const config = await client.systemConfig().catch(() => null);
      applyConfigDefaults(config);
    }
    restorePreferences();
    applyStoredLiveProcessingPreset();
    preferencesReady = true;
    await loadDirectory();
  }

  function applyConfigDefaults(config: SystemConfigResponse | null) {
    const videoIngest = processingSection(config, 'video_ingest');
    nTile = numberDefault(videoIngest, 'n_tile', nTile);
  }

  function restorePreferences() {
    const preferences = readPreferences<IngestionPreferences>(ingestionPreferenceKey);
    if (!preferences) return;
    currentPath = stringPreference(preferences.currentPath, currentPath);
    manualPaths = stringPreference(preferences.manualPaths, manualPaths);
    nTile = numberPreference(preferences.nTile, nTile);
    collections = stringPreference(preferences.collections, collections);
    metadataText = stringPreference(preferences.metadataText, metadataText);
  }

  function captureProcessingSettings(): ProcessingSettings {
    return pruneProcessingSettings({
      ...currentLiveProcessingPreset().settings,
      ingestionTileCount: Math.max(1, Math.round(numberPreference(nTile, 1)))
    });
  }

  function applyProcessingSettings(settings: ProcessingSettings) {
    if ('ingestionTileCount' in settings) {
      nTile = Math.max(1, Math.round(numberPreference(settings.ingestionTileCount, nTile)));
    }
  }

  function applyStoredLiveProcessingPreset() {
    const preset = currentLiveProcessingPreset();
    if (preset?.source === 'live' && preset.settings) {
      applyProcessingSettings(preset.settings);
    }
  }

  function handleHeaderProcessingPresetApplied(event: Event) {
    const preset = (event as CustomEvent<ProcessingPreset>).detail;
    if (!preset?.settings) return;
    applyProcessingSettings(preset.settings);
  }

  async function loadDirectory(path = currentPath) {
    const client = getClient();
    if (!client) return;
    loading = true;
    error = null;
    try {
      listing = await client.listRawDirectory(path);
      currentPath = listing.path;
      selected = new Set();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  function toggle(entry: DirectoryEntry) {
    const next = new Set(selected);
    if (next.has(entry.path)) next.delete(entry.path);
    else next.add(entry.path);
    selected = next;
  }

  function selectedPaths(): string[] {
    const explicit = manualPaths
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return [...selected, ...explicit];
  }

  async function queueIngestion() {
    const client = getClient();
    if (!client) return;
    const paths = selectedPaths();
    if (paths.length === 0) {
      error = 'Select files or enter server-side video paths first.';
      return;
    }
    message = null;
    error = null;
    let metadata: Record<string, unknown>;
    try {
      metadata = parseMetadata();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      return;
    }
    let queued = 0;
    const nextJobIds: string[] = [];
    for (const path of paths) {
      try {
        const response = await client.queueVideo(path, {
          n_tile: nTile,
          collections: collections || undefined,
          metadata
        });
        const jobId = queuedJobId(response);
        if (jobId) nextJobIds.push(jobId);
        queued += 1;
      } catch (err) {
        error = `Queued ${queued}/${paths.length}. ${err instanceof Error ? err.message : String(err)}`;
        return;
      }
    }
    submittedJobIds = [...nextJobIds, ...submittedJobIds].slice(0, 100);
    message = `Queued ${queued} ingestion job${queued === 1 ? '' : 's'}.`;
    await loadDirectory(currentPath);
  }

  function queuedJobId(response: Record<string, unknown>): string | null {
    const direct = response.job_id ?? response.id;
    if (typeof direct === 'string' && direct) return direct;
    const job = response.job;
    if (job && typeof job === 'object' && typeof (job as { id?: unknown }).id === 'string') {
      return (job as { id: string }).id;
    }
    return null;
  }

  function parseMetadata(): Record<string, unknown> {
    const trimmed = metadataText.trim();
    if (!trimmed) return {};
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Metadata must be a JSON object, for example {"cruise":"SKQ2026"}.');
    }
    return parsed as Record<string, unknown>;
  }
</script>

<div class="split-layout">
  <section class="panel browser-panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Server storage</p>
        <h2>Raw asset browser</h2>
      </div>
      {#if loading}<span class="soft">Loading</span>{/if}
    </div>

    <div class="pathbar">
      <input bind:value={currentPath} placeholder="Server folder path" />
      <button type="button" on:click={() => loadDirectory(currentPath)}>Open</button>
    </div>

    {#if listing?.source === 'registered-assets'}
      <p class="callout">The live file endpoint was not available, so this view is reconstructed from registered assets.</p>
    {/if}

    <div class="file-list" role="list" aria-label="Server files">
      {#if currentPath}
        <button class="file-row" type="button" on:click={() => loadDirectory(currentPath.split('/').slice(0, -1).join('/'))}>
          <span class="file-icon">..</span>
          <span class="file-main">Parent folder</span>
        </button>
      {/if}
      {#each listing?.entries ?? [] as entry}
        <button
          class="file-row"
          class:selected={selected.has(entry.path)}
          type="button"
          on:dblclick={() => entry.kind === 'directory' && loadDirectory(entry.path)}
          on:click={() => (entry.kind === 'directory' ? loadDirectory(entry.path) : toggle(entry))}
        >
          <span class="file-icon">{entry.kind === 'directory' ? 'DIR' : 'FILE'}</span>
          <span class="file-main">
            <strong>{entry.name}</strong>
            <small>{entry.path}</small>
          </span>
          <span>{entry.kind === 'file' ? formatBytes(entry.size_bytes) : 'Folder'}</span>
        </button>
      {:else}
        <p class="empty">No assets are visible here yet. Enter server-side paths manually to queue ingestion.</p>
      {/each}
    </div>
  </section>

  <section class="panel controls-panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">File ingestion</p>
        <h2>Queue frame extraction</h2>
      </div>
    </div>

    <label>
      Manual server paths
      <textarea bind:value={manualPaths} rows="8" placeholder="/data/raw/video_001.avi&#10;/data/raw/video_002.avi"></textarea>
    </label>

    <div class="form-grid">
      <label>
        Tile count
        <input type="number" min="1" bind:value={nTile} />
      </label>
      <label>
        Collections
        <input bind:value={collections} placeholder="cruise-2026,station-a" />
      </label>
    </div>

    <label>
      Metadata JSON
      <textarea bind:value={metadataText} rows="5" placeholder={metadataPlaceholder}></textarea>
    </label>

    <button type="button" on:click={queueIngestion}>Queue selected paths</button>
    <p class="soft">{selected.size} selected from browser, {selectedPaths().length} total path{selectedPaths().length === 1 ? '' : 's'} ready.</p>
    {#if message}<p class="success">{message}</p>{/if}
    {#if error}<p class="form-error">{error}</p>{/if}

    <QueueStatusSummary
      title="Ingestion queue"
      eyebrow="Live status"
      stage="ingestion"
      jobIds={submittedJobIds}
      mode="compact"
    />
  </section>
</div>
