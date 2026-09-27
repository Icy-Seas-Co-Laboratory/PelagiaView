<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { DirectoryEntry, DirectoryListing } from '$lib/api/types';
  import { formatBytes, formatDate } from '$lib/utils/format';

  type FileSelectorMode = 'regular' | 'wizard';
  type SelectableKind = DirectoryEntry['kind'];
  type SortKey = 'name' | 'size' | 'date';
  type SortDirection = 'asc' | 'desc';
  type BrowserEntry = DirectoryEntry & {
    inferred?: boolean;
    unavailable?: boolean;
  };

  export let mode: FileSelectorMode = 'regular';
  export let multiSelect = true;
  export let selectableKinds: SelectableKind[] = ['file', 'directory'];
  export let initialPath = '.';
  export let knownPaths: string[] = [];
  export let selectedPaths: string[] = [];
  export let disabled = false;
  export let loadDirectory: (path: string) => Promise<DirectoryListing>;
  export let onSelectionChange: ((paths: string[]) => void) | null = null;
  export let onPathChange: ((path: string) => void) | null = null;
  export let label = 'Server files';

  let currentPath = initialPath || '.';
  let pathInput = currentPath;
  let loading = false;
  let error: string | null = null;
  let listings = new Map<string, DirectoryListing>();
  let unavailableDirectories = new Set<string>();
  let knownPathCache = new Set<string>();
  let selected = new Set<string>();
  let lastSelectedIndex: number | null = null;
  let lastSelectionScope: string | null = null;
  let sortKey: SortKey = 'name';
  let sortDirection: SortDirection = 'asc';
  let folderPanelScroller: HTMLElement;
  let lastFolderPanelScrollKey = '';

  $: if (initialPath && initialPath !== currentPath && !loading) void openDirectory(initialPath, { clearSelection: false });
  $: rememberPaths([initialPath, currentPath, ...knownPaths, ...selectedPaths]);
  $: syncSelected(selectedPaths);
  $: currentListing = listingForPath(currentPath, sortKey, sortDirection, listings, unavailableDirectories, knownPathCache);
  $: sortedEntries = sortEntries(currentListing?.entries ?? [], sortKey, sortDirection);
  $: folderColumns = directoryColumns(currentPath, sortKey, sortDirection, listings, unavailableDirectories, knownPathCache);
  $: folderPanelScrollKey = folderColumns
    .map((column) => `${column.path}:${column.entries.length}:${column.unavailable ? 'unavailable' : 'available'}`)
    .join('|');
  $: if (mode === 'regular') void scrollFolderPanelsToCurrent(folderPanelScrollKey);
  $: selectedCount = selected.size;

  onMount(() => {
    selected = new Set(selectedPaths);
    void openDirectory(currentPath, { clearSelection: false });
  });

  async function openDirectory(path = currentPath, options: { clearSelection?: boolean } = {}) {
    if (disabled || !loadDirectory) return;
    loading = true;
    error = null;
    rememberPaths([path]);
    try {
      const listing = await ensureListing(path);
      currentPath = listing.path;
      pathInput = listing.path;
      if (options.clearSelection === true) {
        selected = new Set();
        emitSelection();
      }
      onPathChange?.(listing.path);
      lastSelectedIndex = null;
      await ensureAncestorListings(listing.path);
    } catch (err) {
      const normalizedPath = normalizePath(path);
      const nextUnavailable = new Set(unavailableDirectories).add(normalizedPath);
      unavailableDirectories = nextUnavailable;
      if (inferredDirectoryEntries(normalizedPath, knownPathCache).length > 0) {
        currentPath = normalizedPath;
        pathInput = normalizedPath;
        if (options.clearSelection === true) {
          selected = new Set();
          emitSelection();
        }
        onPathChange?.(normalizedPath);
        lastSelectedIndex = null;
      } else if (normalizedPath !== '.') {
        try {
          const rootListing = await ensureListing('.');
          currentPath = rootListing.path;
          pathInput = rootListing.path;
          onPathChange?.(rootListing.path);
          lastSelectedIndex = null;
        } catch {
          error = err instanceof Error ? err.message : String(err);
        }
      } else {
        error = err instanceof Error ? err.message : String(err);
      }
    } finally {
      loading = false;
    }
  }

  function canOpenParent(path: string) {
    const normalizedPath = normalizePath(path);
    if (!normalizedPath || normalizedPath === '.') return false;
    const rootPath = listings.get(normalizedPath)?.rootPath;
    return !rootPath || normalizedPath !== normalizePath(rootPath);
  }

  async function ensureListing(path: string) {
    const normalizedPath = normalizePath(path);
    if (listings.has(normalizedPath)) return listings.get(normalizedPath) as DirectoryListing;
    if (listings.has(path)) return listings.get(path) as DirectoryListing;
    const listing = await loadDirectory(path);
    const listingPath = normalizePath(listing.path);
    rememberPaths([normalizedPath, listingPath]);
    rememberEntries(listing.entries);
    const normalizedListing = { ...listing, path: listingPath };
    const nextListings = new Map(listings).set(listingPath, normalizedListing);
    if (listingPath !== normalizedPath) nextListings.set(normalizedPath, normalizedListing);
    if (listing.path !== path) nextListings.set(path, normalizedListing);
    listings = nextListings;
    if (unavailableDirectories.has(path) || unavailableDirectories.has(normalizedPath) || unavailableDirectories.has(listingPath)) {
      const nextUnavailable = new Set(unavailableDirectories);
      nextUnavailable.delete(path);
      nextUnavailable.delete(normalizedPath);
      nextUnavailable.delete(listingPath);
      unavailableDirectories = nextUnavailable;
    }
    return normalizedListing;
  }

  async function ensureAncestorListings(path: string) {
    const nextUnavailable = new Set(unavailableDirectories);
    for (const ancestor of ancestors(path).slice(0, -1).reverse()) {
      if (!listings.has(ancestor)) {
        try {
          await ensureListing(ancestor);
          nextUnavailable.delete(ancestor);
        } catch {
          nextUnavailable.add(ancestor);
        }
      }
    }
    unavailableDirectories = nextUnavailable;
  }

  function syncSelected(paths: string[]) {
    rememberPaths(paths);
    const nextKey = paths.join('\u001f');
    const currentKey = [...selected].join('\u001f');
    if (nextKey !== currentKey) selected = new Set(paths);
  }

  function emitSelection() {
    selectedPaths = [...selected];
    onSelectionChange?.(selectedPaths);
  }

  function isSelectable(entry: DirectoryEntry) {
    return selectableKinds.includes(entry.kind);
  }

  function selectEntry(entry: BrowserEntry, event?: MouseEvent, index = -1, entries: BrowserEntry[] = sortedEntries, scope = currentPath) {
    if (disabled || !isSelectable(entry) || isEntrySelectionDisabled(entry)) return;
    if (!multiSelect) {
      selected = new Set([entry.path]);
      lastSelectedIndex = index;
      lastSelectionScope = scope;
      emitSelection();
      return;
    }
    const next = new Set(selected);
    if (event?.shiftKey && lastSelectedIndex !== null && lastSelectionScope === scope && index >= 0) {
      const [start, end] = [lastSelectedIndex, index].sort((a, b) => a - b);
      for (const candidate of entries.slice(start, end + 1)) {
        if (isSelectable(candidate)) next.add(candidate.path);
      }
    } else if (event?.metaKey || event?.ctrlKey || mode === 'wizard') {
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      lastSelectedIndex = index;
      lastSelectionScope = scope;
    } else {
      next.clear();
      next.add(entry.path);
      lastSelectedIndex = index;
      lastSelectionScope = scope;
    }
    selected = next;
    emitSelection();
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    else {
      sortKey = key;
      sortDirection = 'asc';
    }
  }

  function sortEntries<T extends DirectoryEntry>(entries: T[], key: SortKey, sortOrder: SortDirection) {
    const direction = sortOrder === 'asc' ? 1 : -1;
    return [...entries].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
      if (key === 'size') return direction * ((a.size_bytes ?? -1) - (b.size_bytes ?? -1));
      if (key === 'date') return direction * (timeValue(entryCreatedAt(a)) - timeValue(entryCreatedAt(b)));
      return direction * a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
  }

  function directoryColumns(
    path: string,
    key: SortKey,
    sortOrder: SortDirection,
    listingMap: Map<string, DirectoryListing>,
    unavailableSet: Set<string>,
    knownPathsSnapshot: Set<string>
  ) {
    const pathAncestors = ancestors(path);
    const columnPaths = pathAncestors.length > 1 ? pathAncestors.slice(0, -1) : pathAncestors;
    return columnPaths.map((columnPath) => ({
      path: columnPath,
      entries: entriesForPath(columnPath, key, sortOrder, listingMap, unavailableSet, knownPathsSnapshot).filter((entry) => entry.kind === 'directory'),
      unavailable: unavailableSet.has(columnPath)
    }));
  }

  function listingForPath(
    path: string,
    key: SortKey,
    sortOrder: SortDirection,
    listingMap: Map<string, DirectoryListing>,
    unavailableSet: Set<string>,
    knownPathsSnapshot: Set<string>
  ): { path: string; entries: BrowserEntry[] } | null {
    const listing = listingMap.get(path);
    if (listing) return { path: listing.path, entries: entriesForPath(listing.path, key, sortOrder, listingMap, unavailableSet, knownPathsSnapshot) };
    const entries = entriesForPath(path, key, sortOrder, listingMap, unavailableSet, knownPathsSnapshot);
    return entries.length > 0 ? { path, entries } : null;
  }

  function entriesForPath(
    path: string,
    key: SortKey,
    sortOrder: SortDirection,
    listingMap: Map<string, DirectoryListing>,
    unavailableSet: Set<string>,
    knownPathsSnapshot: Set<string>
  ): BrowserEntry[] {
    const entries = new Map<string, BrowserEntry>();
    for (const entry of listingMap.get(path)?.entries ?? []) {
      entries.set(entry.path, withAvailability(entry, listingMap, unavailableSet));
    }
    for (const entry of inferredDirectoryEntries(path, knownPathsSnapshot)) {
      if (!entries.has(entry.path)) entries.set(entry.path, withAvailability(entry, listingMap, unavailableSet));
    }
    return sortEntries([...entries.values()], key, sortOrder);
  }

  function inferredDirectoryEntries(path: string, knownPathsSnapshot: Set<string>): BrowserEntry[] {
    const normalized = normalizePath(path);
    const entries = new Map<string, BrowserEntry>();
    for (const knownPath of knownPathsSnapshot) {
      const childPath = immediateChildPath(normalized, knownPath);
      if (!childPath || childPath === normalized) continue;
      entries.set(childPath, {
        name: displayPath(childPath),
        path: childPath,
        kind: 'directory',
        inferred: true
      });
    }
    return [...entries.values()];
  }

  function withAvailability<T extends DirectoryEntry>(entry: T, listingMap: Map<string, DirectoryListing>, unavailableSet: Set<string>): T & BrowserEntry {
    return {
      ...entry,
      unavailable: entry.kind === 'directory' && unavailableSet.has(entry.path) && !listingMap.has(entry.path)
    };
  }

  function rememberEntries(entries: DirectoryEntry[]) {
    const paths = entries.map((entry) => (entry.kind === 'directory' ? entry.path : parentPath(entry.path)));
    rememberPaths(paths);
  }

  function rememberPaths(paths: string[]) {
    let changed = false;
    const next = new Set(knownPathCache);
    for (const path of paths) {
      if (!path) continue;
      for (const knownPath of ancestors(path)) {
        if (!next.has(knownPath)) {
          next.add(knownPath);
          changed = true;
        }
      }
    }
    if (changed) knownPathCache = next;
  }

  function immediateChildPath(parent: string, child: string): string | null {
    const normalizedParent = normalizePath(parent);
    const normalizedChild = normalizePath(child);
    if (normalizedParent === normalizedChild) return null;
    const parentParts = pathParts(normalizedParent);
    const childParts = pathParts(normalizedChild);
    if (parentParts.absolute !== childParts.absolute || childParts.parts.length <= parentParts.parts.length) return null;
    if (!parentParts.parts.every((part, index) => childParts.parts[index] === part)) return null;
    const nextParts = childParts.parts.slice(0, parentParts.parts.length + 1);
    return formatPath(nextParts, parentParts.absolute);
  }

  function ancestors(path: string) {
    const normalized = normalizePath(path);
    if (normalized === '.' || normalized === '/') return [normalized];
    const absolute = normalized.startsWith('/');
    const parts = normalized.split('/').filter(Boolean);
    const values = absolute ? ['/'] : ['.'];
    let cursor = absolute ? '' : '';
    for (const part of parts) {
      cursor = absolute ? `${cursor}/${part}` : cursor ? `${cursor}/${part}` : part;
      values.push(absolute ? cursor : cursor);
    }
    return [...new Set(values)];
  }

  function parentPath(path: string) {
    const normalized = normalizePath(path);
    if (!normalized || normalized === '.' || normalized === '/') return '.';
    const absolute = normalized.startsWith('/');
    const parts = normalized.split('/').filter(Boolean);
    parts.pop();
    if (!parts.length) return absolute ? '/' : '.';
    return `${absolute ? '/' : ''}${parts.join('/')}`;
  }

  function pathParts(path: string) {
    const normalized = normalizePath(path);
    return {
      absolute: normalized.startsWith('/'),
      parts: normalized === '.' || normalized === '/' ? [] : normalized.split('/').filter(Boolean)
    };
  }

  function formatPath(parts: string[], absolute: boolean) {
    if (!parts.length) return absolute ? '/' : '.';
    return `${absolute ? '/' : ''}${parts.join('/')}`;
  }

  function normalizePath(path: string) {
    const trimmed = path.trim();
    if (!trimmed) return '.';
    return trimmed.replace(/\/+$/, '') || (trimmed.startsWith('/') ? '/' : '.');
  }

  function displayPath(path: string) {
    if (path === '.') return 'Root';
    return path.split('/').filter(Boolean).at(-1) ?? path;
  }

  function entryCreatedAt(entry: DirectoryEntry) {
    return entry.created_at ?? entry.modified_at;
  }

  function timeValue(value: DirectoryEntry['created_at'] | DirectoryEntry['modified_at']) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  function dateLabel(value: DirectoryEntry['created_at'] | DirectoryEntry['modified_at']) {
    if (!value) return 'Unknown';
    return typeof value === 'number' ? formatDate(new Date(value).toISOString()) : formatDate(value);
  }

  function sizeLabel(entry: BrowserEntry) {
    if (entry.kind === 'directory') return entry.inferred ? 'Inferred folder' : 'Folder';
    return formatBytes(entry.size_bytes);
  }

  async function scrollFolderPanelsToCurrent(key: string) {
    if (!folderPanelScroller || !key || key === lastFolderPanelScrollKey) return;
    lastFolderPanelScrollKey = key;
    await tick();
    folderPanelScroller.scrollLeft = Math.max(0, folderPanelScroller.scrollWidth - folderPanelScroller.clientWidth);
  }

  function isEntrySelectionDisabled(entry: BrowserEntry) {
    return Boolean(entry.kind === 'directory' && entry.inferred && entry.unavailable);
  }

  function canOpenDirectoryEntry(entry: BrowserEntry) {
    return entry.kind === 'directory' && (!entry.unavailable || inferredDirectoryEntries(entry.path, knownPathCache).length > 0);
  }
</script>

<div class:file-selector-regular={mode === 'regular'} class:file-selector-wizard={mode === 'wizard'} class="file-selector">
  <div class="file-selector-pathbar">
    <input bind:value={pathInput} placeholder="Server folder path" disabled={disabled || loading} />
    <button type="button" on:click={() => openDirectory(pathInput)} disabled={disabled || loading}>
      {loading ? 'Opening' : 'Open'}
    </button>
  </div>

  <div class="file-selector-breadcrumbs" aria-label="Folder breadcrumbs">
    {#each ancestors(currentPath) as crumb, index}
      <button type="button" class:active={crumb === currentPath} on:click={() => openDirectory(crumb)} disabled={disabled || loading}>
        {displayPath(crumb)}
      </button>
      {#if index < ancestors(currentPath).length - 1}<span>/</span>{/if}
    {/each}
  </div>

  {#if error}<p class="form-error">{error}</p>{/if}

  {#if mode === 'regular'}
    <div class="file-selector-regular-layout">
      <div class="file-selector-tree-panels" bind:this={folderPanelScroller} aria-label={`${label} folders`}>
        {#each folderColumns as column}
          <section class="file-selector-folder-panel">
            <p class="eyebrow">{displayPath(column.path)}</p>
            <div>
              {#if canOpenParent(column.path)}
                <button type="button" class="file-selector-folder-row" on:click={() => openDirectory(parentPath(column.path))} disabled={disabled || loading}>..</button>
              {/if}
              {#each column.entries as entry, index}
                <button
                  type="button"
                  class="file-selector-folder-row"
                  class:active={entry.path === currentPath}
                  class:selected={selected.has(entry.path)}
                  class:inferred={entry.inferred}
                  class:unavailable={entry.unavailable}
                  class:selection-disabled={isEntrySelectionDisabled(entry)}
                  on:click={(event) => selectEntry(entry, event, index, column.entries, column.path)}
                  on:dblclick={() => canOpenDirectoryEntry(entry) && openDirectory(entry.path)}
                  disabled={disabled || loading || !canOpenDirectoryEntry(entry)}
                >
                  {entry.name}
                </button>
              {:else}
                {#if column.unavailable}
                  <span class="file-selector-empty">Unavailable</span>
                {:else}
                  <span class="file-selector-empty">No folders</span>
                {/if}
              {/each}
            </div>
          </section>
        {/each}
      </div>

      <div class="file-selector-details" aria-label={label}>
        <div class="file-selector-table-head">
          <button
            type="button"
            class:sort-asc={sortKey === 'name' && sortDirection === 'asc'}
            class:sort-desc={sortKey === 'name' && sortDirection === 'desc'}
            aria-label={`Sort by name, ${
              sortKey === 'name' ? `sorted ${sortDirection === 'asc' ? 'ascending' : 'descending'}` : 'not sorted'
            }`}
            on:click={() => toggleSort('name')}
          >
            Name
          </button>
          <button
            type="button"
            class:sort-asc={sortKey === 'size' && sortDirection === 'asc'}
            class:sort-desc={sortKey === 'size' && sortDirection === 'desc'}
            aria-label={`Sort by size, ${
              sortKey === 'size' ? `sorted ${sortDirection === 'asc' ? 'ascending' : 'descending'}` : 'not sorted'
            }`}
            on:click={() => toggleSort('size')}
          >
            Size
          </button>
          <button
            type="button"
            class:sort-asc={sortKey === 'date' && sortDirection === 'asc'}
            class:sort-desc={sortKey === 'date' && sortDirection === 'desc'}
            aria-label={`Sort by date, ${
              sortKey === 'date' ? `sorted ${sortDirection === 'asc' ? 'ascending' : 'descending'}` : 'not sorted'
            }`}
            on:click={() => toggleSort('date')}
          >
            Date
          </button>
        </div>
        <div class="file-selector-rows">
          {#each sortedEntries as entry, index}
            <button
              type="button"
              class="file-selector-row"
              class:selected={selected.has(entry.path)}
              class:disabled-row={!isSelectable(entry)}
              class:inferred={entry.inferred}
              class:unavailable={entry.unavailable}
              class:selection-disabled={isEntrySelectionDisabled(entry)}
              on:click={(event) => selectEntry(entry, event, index)}
              on:dblclick={() => canOpenDirectoryEntry(entry) && openDirectory(entry.path)}
              disabled={disabled}
            >
              <span class="file-selector-name">
                <strong>{entry.name}</strong>
              </span>
              <span>{sizeLabel(entry)}</span>
              <span>{dateLabel(entryCreatedAt(entry))}</span>
            </button>
          {:else}
            <p class="empty">No files or folders are visible here.</p>
          {/each}
        </div>
      </div>
    </div>
  {:else}
    <div class="file-selector-wizard-menu" aria-label={label}>
      {#if canOpenParent(currentPath)}
        <button class="file-selector-wizard-parent" type="button" on:click={() => openDirectory(parentPath(currentPath))} disabled={disabled || loading}>
          Parent folder
        </button>
      {/if}
      {#each sortedEntries as entry, index}
        <div class="file-selector-wizard-row" class:selected={selected.has(entry.path)}>
          <label>
            <input
              type="checkbox"
              checked={selected.has(entry.path)}
              disabled={disabled || !isSelectable(entry)}
              on:change={() => selectEntry(entry, undefined, index)}
            />
            <span class="file-selector-name">
              <strong>{entry.name}</strong>
              <small>{sizeLabel(entry)} · {dateLabel(entryCreatedAt(entry))}</small>
            </span>
          </label>
          {#if entry.kind === 'directory'}
            <button type="button" class="ghost compact-action" on:click={() => openDirectory(entry.path)} disabled={disabled || loading}>Open</button>
          {/if}
        </div>
      {:else}
        <p class="empty">No files or folders are visible here.</p>
      {/each}
    </div>
  {/if}

  <p class="soft">{selectedCount} selected</p>
</div>
