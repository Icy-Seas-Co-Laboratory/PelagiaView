<script lang="ts">
  import { onMount } from 'svelte';
  import { getClient } from '$lib/stores/session';
  import type { DirectoryEntry, DirectoryListing } from '$lib/api/types';
  import { formatBytes } from '$lib/utils/format';

  let listing: DirectoryListing | null = null;
  let selected = new Set<string>();
  let manualPaths = '';
  let currentPath = '.';
  let loading = true;
  let message: string | null = null;
  let error: string | null = null;
  let enqueueSegment = false;
  let nTile = 2;
  let collections = '';

  onMount(loadDirectory);

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
    let queued = 0;
    for (const path of paths) {
      try {
        await client.queueVideo(path, {
          enqueue_segment: enqueueSegment,
          n_tile: nTile,
          collections: collections || undefined
        });
        queued += 1;
      } catch (err) {
        error = `Queued ${queued}/${paths.length}. ${err instanceof Error ? err.message : String(err)}`;
        return;
      }
    }
    message = `Queued ${queued} ingestion job${queued === 1 ? '' : 's'}.`;
    await loadDirectory(currentPath);
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
        <p class="eyebrow">Batch operation</p>
        <h2>Queue ingestion</h2>
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

    <label class="check-row">
      <input type="checkbox" bind:checked={enqueueSegment} />
      Queue segmentation after frame extraction
    </label>

    <button type="button" on:click={queueIngestion}>Queue selected paths</button>
    <p class="soft">{selected.size} selected from browser, {selectedPaths().length} total path{selectedPaths().length === 1 ? '' : 's'} ready.</p>
    {#if message}<p class="success">{message}</p>{/if}
    {#if error}<p class="form-error">{error}</p>{/if}
  </section>
</div>
