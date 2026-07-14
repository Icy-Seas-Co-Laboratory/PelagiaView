<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import CollectionTokenInput from '$lib/components/CollectionTokenInput.svelte';
  import { getClient } from '$lib/stores/session';
  import type { AssetProcessingState, CollectionSummary, Job, RawAsset } from '$lib/api/types';
  import { formatBytes, formatCount, formatDate, numericValue } from '$lib/utils/format';

  type AssetProcessingRow = NonNullable<AssetProcessingState['assets']>[number];

  type AssetRow = {
    asset: RawAsset;
    processing: AssetProcessingRow | null;
    job: Job | null;
    collectionsText: string;
    savingCollections: boolean;
    deleting: boolean;
  };

  type AssetSortField = 'name' | 'stage' | 'frames' | 'rois' | 'size' | 'created';
  type SortDirection = 'asc' | 'desc';
  type BulkCollectionMode = 'add' | 'replace' | 'remove';

  let rows: AssetRow[] = [];
  let collections: CollectionSummary[] = [];
  let searchText = '';
  let collectionFilter = '';
  let stageFilter = '';
  let sortBy: AssetSortField = 'created';
  let sortDir: SortDirection = 'desc';
  let selectedAssetIds = new Set<string>();
  let bulkCollectionsText = '';
  let bulkCollectionMode: BulkCollectionMode = 'add';
  let bulkWorking = false;
  let loading = false;
  let error: string | null = null;
  let message: string | null = null;
  let pollTimer: number | null = null;

  const assetLimit = 10000;
  const activeJobStatuses = new Set(['queued', 'leased', 'working', 'running', 'paused']);

  $: collectionSuggestions = uniqueStrings([
    ...collections.map((collection) => collection.collection),
    ...rows.flatMap((row) => row.asset.collections ?? [])
  ]);
  $: totalAssets = rows.length;
  $: totalFrames = rows.reduce((total, row) => total + rowFrameCount(row), 0);
  $: totalRois = rows.reduce((total, row) => total + rowDetectionCount(row), 0);
  $: activeIngestionCount = rows.filter((row) => row.job && activeJobStatuses.has(normalizedStatus(row.job.status))).length;
  $: filteredRows = sortRows(filterRows(rows));
  $: visibleSelectedRows = filteredRows.filter((row) => selectedAssetIds.has(row.asset.id));
  $: visibleSelectedCount = visibleSelectedRows.length;
  $: allVisibleSelected = filteredRows.length > 0 && filteredRows.every((row) => selectedAssetIds.has(row.asset.id));

  onMount(() => {
    void loadAssets();
    pollTimer = window.setInterval(() => void loadAssets({ quiet: true }), 5000);
  });

  onDestroy(() => {
    if (pollTimer !== null) window.clearInterval(pollTimer);
  });

  async function loadAssets(options: { quiet?: boolean } = {}) {
    const client = getClient();
    if (!client || loading) return;
    loading = true;
    if (!options.quiet) {
      error = null;
      message = null;
    }
    try {
      const [assets, processingState, collectionRows, ingestionJobs] = await Promise.all([
        client.listAssets(undefined, assetLimit),
        client.assetProcessingState(undefined, assetLimit).catch(() => ({ assets: [] }) as AssetProcessingState),
        client.listCollections(500).catch(() => []),
        client.listJobs({
          stage: ['extract_frames', 'ingest_run'],
          status: ['queued', 'leased', 'working', 'running', 'paused'],
          include_progress: true,
          limit: 500,
          sort: 'updated_at',
          direction: 'desc'
        }).catch(() => [])
      ]);
      const processingByAsset = new Map((processingState.assets ?? []).map((row) => [row.asset_id, row]));
      const jobsByAsset = latestJobsByAsset(ingestionJobs);
      rows = assets.map((asset) => {
        const existing = rows.find((row) => row.asset.id === asset.id);
        const processing = processingByAsset.get(asset.id) ?? null;
        return {
          asset,
          processing,
          job: jobsByAsset.get(asset.id) ?? existing?.job ?? null,
          collectionsText: existing?.savingCollections ? existing.collectionsText : (asset.collections ?? []).join(','),
          savingCollections: existing?.savingCollections ?? false,
          deleting: existing?.deleting ?? false
        };
      });
      collections = collectionRows;
      selectedAssetIds = new Set([...selectedAssetIds].filter((assetId) => assets.some((asset) => asset.id === assetId)));
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  async function saveCollections(row: AssetRow) {
    const client = getClient();
    if (!client || row.savingCollections) return;
    setRowState(row.asset.id, { savingCollections: true });
    error = null;
    message = null;
    try {
      const updated = await client.updateAsset(row.asset.id, {
        collections: collectionValues(row.collectionsText)
      });
      rows = rows.map((candidate) =>
        candidate.asset.id === row.asset.id
          ? {
              ...candidate,
              asset: updated,
              collectionsText: (updated.collections ?? []).join(','),
              savingCollections: false
            }
          : candidate
      );
      message = `Updated collections for ${assetLabel(updated)}.`;
      await loadAssets({ quiet: true });
    } catch (err) {
      setRowState(row.asset.id, { savingCollections: false });
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function deleteAsset(row: AssetRow) {
    await deleteRows([row]);
  }

  async function deleteSelectedAssets() {
    await deleteRows(visibleSelectedRows);
  }

  async function deleteRows(targetRows: AssetRow[]) {
    const client = getClient();
    const deletableRows = targetRows.filter((row) => !row.deleting);
    if (!client || bulkWorking || !deletableRows.length) return;
    const label = deletableRows.length === 1 ? assetLabel(deletableRows[0].asset) : `${deletableRows.length} selected assets`;
    const confirmed = window.confirm(
      `Delete ${label}?\n\nDeleting an asset will delete all of its derived data, including preprocessing data, raw frames, candidate ROIs, refined ROIs, and related processing state. This cannot be undone.`
    );
    if (!confirmed) return;
    bulkWorking = deletableRows.length > 1;
    for (const row of deletableRows) setRowState(row.asset.id, { deleting: true });
    error = null;
    message = null;
    try {
      let frameRowsDeleted = 0;
      let payloadsDeleted = 0;
      for (const row of deletableRows) {
        const result = await client.deleteAsset(row.asset.id);
        frameRowsDeleted += numericValue(result.frame_count) ?? 0;
        payloadsDeleted += result.deleted_kvstore_keys?.filter((entry) => entry.deleted).length ?? 0;
      }
      const deletedIds = new Set(deletableRows.map((row) => row.asset.id));
      rows = rows.filter((candidate) => !deletedIds.has(candidate.asset.id));
      selectedAssetIds = new Set([...selectedAssetIds].filter((assetId) => !deletedIds.has(assetId)));
      message = `Deleted ${formatCount(deletableRows.length)} asset${deletableRows.length === 1 ? '' : 's'}; removed ${formatCount(frameRowsDeleted)} frame rows and ${formatCount(payloadsDeleted)} unreferenced payloads.`;
      await loadAssets({ quiet: true });
    } catch (err) {
      for (const row of deletableRows) setRowState(row.asset.id, { deleting: false });
      error = err instanceof Error ? err.message : String(err);
    } finally {
      bulkWorking = false;
    }
  }

  async function applyBulkCollections() {
    const client = getClient();
    const tags = collectionValues(bulkCollectionsText);
    if (!client || bulkWorking || !visibleSelectedRows.length || !tags.length) return;
    bulkWorking = true;
    error = null;
    message = null;
    try {
      const selectedIds = new Set(visibleSelectedRows.map((row) => row.asset.id));
      for (const row of visibleSelectedRows) {
        setRowState(row.asset.id, { savingCollections: true });
        const updated = await client.updateAsset(row.asset.id, {
          collections: bulkCollectionsFor(row, tags)
        });
        rows = rows.map((candidate) =>
          candidate.asset.id === row.asset.id
            ? {
                ...candidate,
                asset: updated,
                collectionsText: (updated.collections ?? []).join(','),
                savingCollections: false
              }
            : candidate
        );
      }
      message = `Updated collection tags for ${formatCount(selectedIds.size)} asset${selectedIds.size === 1 ? '' : 's'}.`;
      bulkCollectionsText = '';
      await loadAssets({ quiet: true });
    } catch (err) {
      for (const row of visibleSelectedRows) setRowState(row.asset.id, { savingCollections: false });
      error = err instanceof Error ? err.message : String(err);
    } finally {
      bulkWorking = false;
    }
  }

  function bulkCollectionsFor(row: AssetRow, tags: string[]): string[] {
    const current = row.asset.collections ?? [];
    if (bulkCollectionMode === 'replace') return tags;
    if (bulkCollectionMode === 'remove') {
      const removeKeys = new Set(tags.map((tag) => tag.toLowerCase()));
      return current.filter((collection) => !removeKeys.has(collection.toLowerCase()));
    }
    return uniqueStrings([...current, ...tags]);
  }

  function setCollectionsText(assetId: string, value: string) {
    rows = rows.map((row) => row.asset.id === assetId ? { ...row, collectionsText: value } : row);
  }

  function toggleAssetSelection(assetId: string, selected: boolean) {
    const next = new Set(selectedAssetIds);
    if (selected) next.add(assetId);
    else next.delete(assetId);
    selectedAssetIds = next;
  }

  function toggleVisibleSelection(selected: boolean) {
    const next = new Set(selectedAssetIds);
    for (const row of filteredRows) {
      if (selected) next.add(row.asset.id);
      else next.delete(row.asset.id);
    }
    selectedAssetIds = next;
  }

  function setRowState(assetId: string, patch: Partial<AssetRow>) {
    rows = rows.map((row) => row.asset.id === assetId ? { ...row, ...patch } : row);
  }

  function latestJobsByAsset(jobs: Job[]): Map<string, Job> {
    const result = new Map<string, Job>();
    const sorted = [...jobs].sort((a, b) => dateValue(b.updated_at ?? b.created_at) - dateValue(a.updated_at ?? a.created_at));
    for (const job of sorted) {
      if (!job.asset_id || result.has(job.asset_id)) continue;
      result.set(job.asset_id, job);
    }
    return result;
  }

  function collectionValues(value: string): string[] {
    return uniqueStrings(value.split(',').map((item) => item.trim()));
  }

  function uniqueStrings(values: Array<string | null | undefined>): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of values) {
      const value = raw?.trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(value);
    }
    return result;
  }

  function rowFrameCount(row: AssetRow): number {
    return numericValue(row.processing?.frame_count) ?? numericValue(row.asset.frame_count) ?? numericValue(row.asset.media_count) ?? 0;
  }

  function rowDetectionCount(row: AssetRow): number {
    return numericValue(row.processing?.detection_count) ?? 0;
  }

  function rowPreprocessedCount(row: AssetRow): number {
    return numericValue(row.processing?.preprocessed_frame_count) ?? 0;
  }

  function rowDetectedFrameCount(row: AssetRow): number {
    return numericValue(row.processing?.detected_frame_count) ?? 0;
  }

  function rowRefinedCount(row: AssetRow): number | null {
    const source = row.processing as (AssetProcessingRow & Record<string, unknown>) | null;
    return (
      numericValue(source?.refined_detection_count) ??
      numericValue(source?.refined_roi_count) ??
      numericValue(source?.roi_refinement_count)
    );
  }

  function assetLabel(asset: RawAsset): string {
    return asset.filename || asset.path || asset.id;
  }

  function currentStage(row: AssetRow): { label: string; status: string; rank: number } {
    const jobStatus = normalizedStatus(row.job?.status);
    if (row.job && activeJobStatuses.has(jobStatus)) {
      return { label: 'Ingestion', status: row.job.status ?? 'queued', rank: 0 };
    }
    const frames = rowFrameCount(row);
    const preprocessed = rowPreprocessedCount(row);
    const detected = rowDetectedFrameCount(row);
    const detections = rowDetectionCount(row);
    const refined = rowRefinedCount(row);
    if (frames < 1) return { label: 'Ingestion', status: 'unknown', rank: 0 };
    if (preprocessed < frames) return { label: 'Preprocessing', status: row.processing?.preprocessing_state ?? 'unknown', rank: 1 };
    if (detected < frames) return { label: 'Candidate Detection', status: row.processing?.detection_state ?? 'unknown', rank: 2 };
    if (refined !== null && detections > 0 && refined >= detections) return { label: 'Complete', status: 'succeeded', rank: 4 };
    return { label: 'ROI Refinement', status: 'unknown', rank: 3 };
  }

  function statsLines(row: AssetRow): string[] {
    const frames = rowFrameCount(row);
    const ingestedTotal = numericValue(row.asset.media_count) ?? frames;
    const refined = rowRefinedCount(row);
    return [
      `Ingested: ${formatCount(frames)}/${formatCount(ingestedTotal || frames)}`,
      `Preprocessing: ${formatCount(rowPreprocessedCount(row))}/${formatCount(frames)}`,
      `Candidate Detection: ${formatCount(rowDetectedFrameCount(row))}/${formatCount(frames)}`,
      `ROI Refinement: ${refined === null ? '0' : formatCount(refined)}/Unk`,
      `ROIs: ${formatCount(rowDetectionCount(row))}`
    ];
  }

  function filterRows(sourceRows: AssetRow[]): AssetRow[] {
    const query = searchText.trim().toLowerCase();
    return sourceRows.filter((row) => {
      if (query) {
        const haystack = [
          row.asset.filename,
          row.asset.id,
          row.asset.kind,
          ...(row.asset.collections ?? [])
        ].join(' ').toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (collectionFilter && !(row.asset.collections ?? []).some((collection) => collection === collectionFilter)) return false;
      if (stageFilter && currentStage(row).label !== stageFilter) return false;
      return true;
    });
  }

  function sortRows(sourceRows: AssetRow[]): AssetRow[] {
    return [...sourceRows].sort((a, b) => {
      const direction = sortDir === 'asc' ? 1 : -1;
      const result = compareRows(a, b, sortBy);
      return result * direction;
    });
  }

  function compareRows(a: AssetRow, b: AssetRow, field: AssetSortField): number {
    if (field === 'stage') return currentStage(a).rank - currentStage(b).rank || assetLabel(a.asset).localeCompare(assetLabel(b.asset));
    if (field === 'frames') return rowFrameCount(a) - rowFrameCount(b) || assetLabel(a.asset).localeCompare(assetLabel(b.asset));
    if (field === 'rois') return rowDetectionCount(a) - rowDetectionCount(b) || assetLabel(a.asset).localeCompare(assetLabel(b.asset));
    if (field === 'size') return (a.asset.size_bytes ?? 0) - (b.asset.size_bytes ?? 0) || assetLabel(a.asset).localeCompare(assetLabel(b.asset));
    if (field === 'created') return dateValue(a.asset.created_at) - dateValue(b.asset.created_at) || assetLabel(a.asset).localeCompare(assetLabel(b.asset));
    return assetLabel(a.asset).localeCompare(assetLabel(b.asset));
  }

  function setSort(field: AssetSortField) {
    if (sortBy === field) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortBy = field;
      sortDir = field === 'name' || field === 'stage' ? 'asc' : 'desc';
    }
  }

  function sortLabel(field: AssetSortField): string {
    if (sortBy !== field) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  }

  function normalizedStatus(value?: string | null): string {
    return String(value ?? '').trim().toLowerCase();
  }

  function statusClass(value?: string | null): string {
    const status = normalizedStatus(value);
    if (status === 'succeeded' || status === 'complete' || status === 'completed') return 'good';
    if (status === 'failed' || status === 'cancelled' || status === 'dead_lettered') return 'bad';
    if (status === 'queued' || status === 'leased' || status === 'working' || status === 'running' || status === 'paused') return 'warn';
    return '';
  }

  function dateValue(value: string | undefined): number {
    if (!value) return 0;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function jobProgress(job: Job | null): string {
    if (!job?.progress) return '';
    const completed = numericValue(job.progress.completed);
    const total = numericValue(job.progress.total);
    if (completed !== null && total !== null && total > 0) return `${formatCount(completed)} / ${formatCount(total)}`;
    return job.progress.message ?? '';
  }

  function collectionsChanged(row: AssetRow): boolean {
    return collectionValues(row.collectionsText).join(',') !== collectionValues((row.asset.collections ?? []).join(',')).join(',');
  }
</script>

<div class="assets-page">
  <section class="panel assets-overview-panel">
    <div class="metric-grid metric-grid-dense">
      <div class="metric metric-compact">
        <span>Assets</span>
        <strong>{formatCount(totalAssets)}</strong>
      </div>
      <div class="metric metric-compact">
        <span>Frames</span>
        <strong>{formatCount(totalFrames)}</strong>
      </div>
      <div class="metric metric-compact">
        <span>ROIs</span>
        <strong>{formatCount(totalRois)}</strong>
      </div>
      <div class="metric metric-compact">
        <span>Ingesting</span>
        <strong>{formatCount(activeIngestionCount)}</strong>
      </div>
    </div>
    <div class="button-row assets-toolbar">
      <button class="ghost compact-action" type="button" on:click={() => loadAssets()} disabled={loading}>
        {loading ? 'Refreshing' : 'Refresh'}
      </button>
      <p class="soft">Collection edits update asset tags and frame-level status filters for this project.</p>
    </div>
    <div class="assets-filter-grid">
      <label>
        Search
        <input bind:value={searchText} placeholder="Asset name, id, kind, collection" />
      </label>
      <label>
        Collection
        <select bind:value={collectionFilter}>
          <option value="">Any collection</option>
          {#each collectionSuggestions as collection}
            <option value={collection}>{collection}</option>
          {/each}
        </select>
      </label>
      <label>
        Current stage
        <select bind:value={stageFilter}>
          <option value="">Any stage</option>
          <option value="Ingestion">Ingestion</option>
          <option value="Preprocessing">Preprocessing</option>
          <option value="Candidate Detection">Candidate Detection</option>
          <option value="ROI Refinement">ROI Refinement</option>
          <option value="Complete">Complete</option>
        </select>
      </label>
      <label>
        Sort
        <select bind:value={sortBy}>
          <option value="created">Created</option>
          <option value="name">Name</option>
          <option value="stage">Current stage</option>
          <option value="frames">Frames</option>
          <option value="rois">ROIs</option>
          <option value="size">Size</option>
        </select>
      </label>
      <label>
        Direction
        <select bind:value={sortDir}>
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
      </label>
    </div>
    <div class="assets-bulk-bar" class:active={visibleSelectedCount > 0}>
      <span>{formatCount(visibleSelectedCount)} selected · {formatCount(filteredRows.length)} visible</span>
      <select bind:value={bulkCollectionMode} aria-label="Bulk collection mode">
        <option value="add">Add tags</option>
        <option value="replace">Replace tags</option>
        <option value="remove">Remove tags</option>
      </select>
      <CollectionTokenInput
        value={bulkCollectionsText}
        suggestions={collectionSuggestions}
        placeholder="Collection tags"
        disabled={bulkWorking || visibleSelectedCount === 0}
        onChange={(value) => bulkCollectionsText = value}
      />
      <button
        class="ghost compact-action"
        type="button"
        disabled={bulkWorking || visibleSelectedCount === 0 || collectionValues(bulkCollectionsText).length === 0}
        on:click={applyBulkCollections}
      >
        Apply tags
      </button>
      <button
        class="ghost compact-action danger-action"
        type="button"
        disabled={bulkWorking || visibleSelectedCount === 0}
        on:click={deleteSelectedAssets}
      >
        Delete selected
      </button>
    </div>
    {#if message}<p class="success">{message}</p>{/if}
    {#if error}<p class="form-error">{error}</p>{/if}
  </section>

  <section class="panel">
    <div class="analysis-table-wrap assets-table-wrap">
      <table class="analysis-table assets-table">
        <thead>
          <tr>
            <th class="assets-select-cell">
              <input
                type="checkbox"
                aria-label="Select visible assets"
                checked={allVisibleSelected}
                disabled={filteredRows.length === 0}
                on:change={(event) => toggleVisibleSelection(event.currentTarget.checked)}
              />
            </th>
            <th><button class="table-sort" type="button" on:click={() => setSort('name')}>Asset{sortLabel('name')}</button></th>
            <th>Collections</th>
            <th><button class="table-sort" type="button" on:click={() => setSort('stage')}>Current Stage{sortLabel('stage')}</button></th>
            <th>Stats</th>
            <th><button class="table-sort" type="button" on:click={() => setSort('size')}>Size{sortLabel('size')}</button></th>
            <th><button class="table-sort" type="button" on:click={() => setSort('created')}>Created{sortLabel('created')}</button></th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#if filteredRows.length === 0}
            <tr>
              <td colspan="8" class="empty">No assets found for the current project.</td>
            </tr>
          {/if}
          {#each filteredRows as row}
            {@const stage = currentStage(row)}
            <tr>
              <td class="assets-select-cell">
                <input
                  type="checkbox"
                  aria-label={`Select ${assetLabel(row.asset)}`}
                  checked={selectedAssetIds.has(row.asset.id)}
                  on:change={(event) => toggleAssetSelection(row.asset.id, event.currentTarget.checked)}
                />
              </td>
              <td class="assets-primary-cell">
                <strong>{assetLabel(row.asset)}</strong>
                <small>{row.asset.kind ?? 'asset'} · {row.asset.id}</small>
              </td>
              <td class="assets-collections-cell">
                <CollectionTokenInput
                  value={row.collectionsText}
                  suggestions={collectionSuggestions}
                  placeholder="Add collection"
                  disabled={row.savingCollections || row.deleting}
                  onChange={(value) => setCollectionsText(row.asset.id, value)}
                />
                <div class="assets-row-actions">
                  <button
                    class="ghost compact-action"
                    type="button"
                    disabled={!collectionsChanged(row) || row.savingCollections || row.deleting}
                    on:click={() => saveCollections(row)}
                  >
                    {row.savingCollections ? 'Saving' : 'Save tags'}
                  </button>
                </div>
              </td>
              <td class="assets-stage-cell">
                <span class={`status-pill ${statusClass(stage.status)}`}>{stage.label}</span>
                <small>{stage.status}</small>
                {#if row.job && jobProgress(row.job)}<small>{jobProgress(row.job)}</small>{/if}
              </td>
              <td class="assets-stats-cell">
                {#each statsLines(row) as line}
                  <span>{line}</span>
                {/each}
              </td>
              <td>{formatBytes(row.asset.size_bytes)}</td>
              <td>{formatDate(row.asset.created_at)}</td>
              <td class="analysis-action-cell">
                <button
                  class="ghost compact-action danger-action"
                  type="button"
                  disabled={row.deleting}
                  on:click={() => deleteAsset(row)}
                >
                  {row.deleting ? 'Deleting' : 'Delete'}
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
</div>
