<script lang="ts">
  import { onMount } from 'svelte';
  import FileSelector from '$lib/components/FileSelector.svelte';
  import QueueStatusSummary from '$lib/components/QueueStatusSummary.svelte';
  import { getClient } from '$lib/stores/session';
  import type {
    AnalyzedIngestionAsset,
    DirectoryListing,
    Job,
    QueueAssetsRequest,
    QueueIngestionAssetRequest,
    SystemConfigResponse
  } from '$lib/api/types';
  import type { ProcessingPreset, ProcessingSettings } from '$lib/processing/settings';
  import { PROCESSING_PRESET_APPLIED_EVENT, pruneProcessingSettings } from '$lib/processing/settings';
  import {
    currentLiveProcessingPreset,
    setLiveProcessingPresetFromSettings
  } from '$lib/stores/processingPresetSession';
  import { numberDefault, processingSection } from '$lib/utils/configDefaults';
  import { formatBytes, formatCount, formatPercent, numericValue, statusTone } from '$lib/utils/format';
  import {
    booleanPreference,
    numberPreference,
    preferenceKey,
    readPreferences,
    stringPreference,
    writePreferences
  } from '$lib/utils/preferences';

  let selected = new Set<string>();
  let selectedPathList: string[] = [];
  let currentPath = '.';
  let browserSource: DirectoryListing['source'] | null = null;
  let message: string | null = null;
  let error: string | null = null;
  let nTile = 2;
  let kind = 'auto';
  let recursive = false;
  let computeChecksum = false;
  let enqueueSegment = false;
  let collections = '';
  let metadataText = '';
  let preferencesReady = false;
  let analyzing = false;
  let queueing = false;
  let jobPolling = false;
  let jobPollError: string | null = null;
  let analyzedAssets: EditableAnalyzedAsset[] = [];
  let submittedJobIds: string[] = [];
  let ingestionJobsById: Record<string, Job> = {};
  let ingestionJobIdsByAssetKey: Record<string, string> = {};
  const metadataPlaceholder = '{"cruise":"SKQ2026","station":"A01"}';
  const ingestionPreferenceKey = preferenceKey('ingestion');

  type IngestionPreferences = {
    currentPath: string;
    nTile: number;
    kind: string;
    recursive: boolean;
    computeChecksum: boolean;
    enqueueSegment: boolean;
    collections: string;
    metadataText: string;
  };

  type EditableAnalyzedAsset = AnalyzedIngestionAsset & {
    enabled: boolean;
    queued?: boolean;
    ingestionJobId?: string;
    collectionsText: string;
    metadataText: string;
    sourceTimestampText: string;
    nTile: number;
    recursive: boolean;
    enqueueSegment: boolean;
  };

  $: ingestionPreferenceSnapshot = {
    currentPath,
    nTile,
    kind,
    recursive,
    computeChecksum,
    enqueueSegment,
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
    const jobTimer = window.setInterval(refreshIngestionJobs, 5000);
    return () => {
      window.removeEventListener(PROCESSING_PRESET_APPLIED_EVENT, handleHeaderProcessingPresetApplied);
      window.clearInterval(jobTimer);
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
  }

  function applyConfigDefaults(config: SystemConfigResponse | null) {
    const videoIngest = processingSection(config, 'video_ingest');
    nTile = numberDefault(videoIngest, 'n_tile', nTile);
  }

  function restorePreferences() {
    const preferences = readPreferences<IngestionPreferences>(ingestionPreferenceKey);
    if (!preferences) return;
    currentPath = stringPreference(preferences.currentPath, currentPath);
    nTile = numberPreference(preferences.nTile, nTile);
    kind = stringPreference(preferences.kind, kind);
    recursive = booleanPreference(preferences.recursive, recursive);
    computeChecksum = booleanPreference(preferences.computeChecksum, computeChecksum);
    enqueueSegment = booleanPreference(preferences.enqueueSegment, enqueueSegment);
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

  async function loadBrowserDirectory(path = currentPath): Promise<DirectoryListing> {
    const client = getClient();
    if (!client) throw new Error('Connect to a Pelagia server before browsing files.');
    const listing = await client.listRawDirectory(path);
    browserSource = listing.source;
    currentPath = listing.path;
    return listing;
  }

  function updateSelection(paths: string[]) {
    selectedPathList = [...paths];
    selected = new Set(paths);
  }

  function updateCurrentPath(path: string) {
    currentPath = path;
  }

  function selectedPaths(): string[] {
    return selectedPathList;
  }

  async function analyzeSelection() {
    const client = getClient();
    if (!client) return;
    const paths = selectedPaths();
    if (paths.length === 0) {
      error = 'Select files or folders to analyze first.';
      return;
    }
    message = null;
    error = null;
    analyzing = true;
    let metadata: Record<string, unknown>;
    try {
      metadata = parseMetadata();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      analyzing = false;
      return;
    }
    const nextAssets: EditableAnalyzedAsset[] = [];
    for (const path of paths) {
      try {
        const response = await client.analyzeIngestionSource({
          source_path: path,
          kind,
          recursive,
          compute_checksum: computeChecksum,
          n_tile: nTile,
          collections: collections || undefined,
          metadata
        });
        nextAssets.push(...(response.assets ?? []).map((asset) => editableAsset(asset, response.suggested_ingestion_request)));
      } catch (err) {
        error = `Analyzed ${nextAssets.length} asset${nextAssets.length === 1 ? '' : 's'} before ${path} failed. ${err instanceof Error ? err.message : String(err)}`;
        analyzing = false;
        return;
      }
    }
    const previousCount = analyzedAssets.length;
    analyzedAssets = mergeAnalyzedAssets(analyzedAssets, nextAssets);
    const addedCount = analyzedAssets.length - previousCount;
    message = `Analyzed ${nextAssets.length} asset${nextAssets.length === 1 ? '' : 's'} from ${paths.length} selected path${paths.length === 1 ? '' : 's'}; ${addedCount} new, ${analyzedAssets.length} total.`;
    analyzing = false;
  }

  async function queueIngestion() {
    const client = getClient();
    if (!client) return;
    message = null;
    error = null;
    queueing = true;
    let runMetadata: Record<string, unknown>;
    try {
      runMetadata = parseMetadata();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      queueing = false;
      return;
    }
    const enabledAssets = analyzedAssets.filter((asset) => asset.enabled);
    const timestampError = validateAnalyzedAssetTimestamps(enabledAssets);
    if (timestampError) {
      error = timestampError;
      queueing = false;
      return;
    }
    let assets: QueueIngestionAssetRequest[];
    try {
      assets = enabledAssets.map(queueAssetRequest);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      queueing = false;
      return;
    }
    if (!assets.length) {
      error = 'Enable at least one analyzed asset before queueing ingestion.';
      queueing = false;
      return;
    }
    try {
      const response = await client.queueAnalyzedAssets({
        assets,
        source_path: commonSourcePath(assets),
        source_type: sourceType(assets),
        n_tile: nTile,
        enqueue_segment: enqueueSegment,
        metadata: runMetadata
      });
      const nextJobIds = (response.jobs ?? []).map((job) => job.id).filter((id): id is string => Boolean(id));
      submittedJobIds = [...nextJobIds, ...submittedJobIds].slice(0, 100);
      mergeIngestionJobs(response.jobs ?? []);
      message = `Queued ${response.jobs?.length ?? assets.length} ingestion job${(response.jobs?.length ?? assets.length) === 1 ? '' : 's'} for ${assets.length} asset${assets.length === 1 ? '' : 's'}.`;
      const queuedKeys = new Set(assets.map((asset) => assetKey(asset)));
      const responseJobs = response.jobs ?? [];
      const jobsByAssetKey = jobsByAssetKeyFromList(responseJobs);
      let fallbackJobIndex = 0;
      analyzedAssets = analyzedAssets.map((asset) =>
        queuedKeys.has(assetKey(asset))
          ? {
              ...asset,
              enabled: false,
              queued: true,
              ingestionJobId: (jobsByAssetKey[assetKey(asset)] ?? responseJobs[fallbackJobIndex++])?.id ?? asset.ingestionJobId
            }
          : asset
      );
      rememberAssetJobLinks(analyzedAssets, responseJobs);
      void refreshIngestionJobs();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      queueing = false;
    }
  }

  function editableAsset(asset: AnalyzedIngestionAsset, suggested?: QueueAssetsRequest): EditableAnalyzedAsset {
    return {
      ...asset,
      enabled: true,
      queued: false,
      ingestionJobId: undefined,
      collectionsText: (asset.collections ?? []).join(','),
      metadataText: formatJson(asset.metadata ?? {}),
      sourceTimestampText: sourceTimestampValue(asset),
      nTile: Number(suggested?.n_tile ?? nTile),
      recursive: Boolean(asset.metadata?.recursive ?? recursive),
      enqueueSegment
    };
  }

  function mergeAnalyzedAssets(existing: EditableAnalyzedAsset[], incoming: EditableAnalyzedAsset[]): EditableAnalyzedAsset[] {
    const existingKeys = new Set(existing.map((asset) => assetKey(asset)));
    return [...existing, ...incoming.filter((asset) => !existingKeys.has(assetKey(asset)))];
  }

  function queueAssetRequest(asset: EditableAnalyzedAsset): QueueIngestionAssetRequest {
    const metadata = parseMetadataText(asset.metadataText, `Metadata for ${asset.filename ?? asset.path}`);
    const sourceTimestamp = normalizeSourceTimestamp(asset.sourceTimestampText);
    if (sourceTimestamp) {
      metadata.source_timestamp_utc = sourceTimestamp;
    } else {
      delete metadata.source_timestamp_utc;
    }
    return {
      asset_id: asset.asset_id,
      filename: asset.filename || undefined,
      path: asset.path,
      kind: asset.kind,
      size_bytes: asset.size_bytes,
      checksum: asset.checksum,
      checksum_status: asset.checksum_status,
      collections: asset.collectionsText || undefined,
      media_count: asset.media_count,
      metadata,
      n_tile: Math.max(1, Math.round(Number(asset.nTile) || nTile)),
      recursive: asset.kind === 'image_sequence' ? asset.recursive : undefined,
      enqueue_segment: enqueueSegment
    };
  }

  function updateAsset(index: number, patch: Partial<EditableAnalyzedAsset>) {
    analyzedAssets = analyzedAssets.map((asset, assetIndex) => assetIndex === index ? { ...asset, ...patch } : asset);
  }

  function removeAnalyzedAsset(index: number) {
    analyzedAssets = analyzedAssets.filter((_, assetIndex) => assetIndex !== index);
  }

  function assetKey(asset: Pick<EditableAnalyzedAsset, 'path' | 'asset_id'> | Pick<QueueIngestionAssetRequest, 'path' | 'asset_id'>): string {
    return asset.path || asset.asset_id || '';
  }

  async function refreshIngestionJobs() {
    const client = getClient();
    if (!client || submittedJobIds.length === 0 || jobPolling) return;
    jobPolling = true;
    jobPollError = null;
    try {
      const jobs = await client.listJobs({
        ids: submittedJobIds,
        include_progress: true,
        limit: Math.max(100, submittedJobIds.length),
        sort: 'updated_at',
        direction: 'desc'
      });
      mergeIngestionJobs(jobs);
    } catch (err) {
      jobPollError = err instanceof Error ? err.message : String(err);
    } finally {
      jobPolling = false;
    }
  }

  function mergeIngestionJobs(jobs: Job[]) {
    if (!jobs.length) return;
    const nextById = { ...ingestionJobsById };
    const nextIdsByAssetKey = { ...ingestionJobIdsByAssetKey };
    for (const job of jobs) {
      nextById[job.id] = job;
      const key = jobAssetKey(job);
      if (key) nextIdsByAssetKey[key] = job.id;
    }
    ingestionJobsById = nextById;
    ingestionJobIdsByAssetKey = nextIdsByAssetKey;
  }

  function rememberAssetJobLinks(assets: EditableAnalyzedAsset[], jobs: Job[]) {
    if (!jobs.length) return;
    const nextIdsByAssetKey = { ...ingestionJobIdsByAssetKey };
    const jobsByAssetKey = jobsByAssetKeyFromList(jobs);
    for (const asset of assets) {
      const key = assetKey(asset);
      const jobId = jobsByAssetKey[key]?.id ?? asset.ingestionJobId;
      if (key && jobId) nextIdsByAssetKey[key] = jobId;
    }
    ingestionJobIdsByAssetKey = nextIdsByAssetKey;
  }

  function jobsByAssetKeyFromList(jobs: Job[]): Record<string, Job> {
    const result: Record<string, Job> = {};
    for (const job of jobs) {
      const key = jobAssetKey(job);
      if (key) result[key] = job;
    }
    return result;
  }

  function jobAssetKey(job: Job): string {
    const assetId = job.asset_id ?? (typeof job.payload?.asset_id === 'string' ? job.payload.asset_id : null);
    return assetId ?? '';
  }

  function assetIngestionJob(asset: EditableAnalyzedAsset): Job | null {
    const linkedJobId = asset.ingestionJobId ?? ingestionJobIdsByAssetKey[assetKey(asset)];
    return linkedJobId ? ingestionJobsById[linkedJobId] ?? null : null;
  }

  function jobProgressPercent(job: Job | null): number | null {
    return numericValue(job?.progress?.percent);
  }

  function jobProgressWidth(job: Job | null): string {
    return `${Math.max(0, Math.min(100, jobProgressPercent(job) ?? 0))}%`;
  }

  function jobProgressText(job: Job | null): string {
    if (!job) return 'Not queued';
    const completed = numericValue(job.progress?.completed);
    const total = numericValue(job.progress?.total);
    const unit = job.progress?.unit ?? 'units';
    if (completed !== null && total !== null && total > 0) {
      return `${formatCount(completed)} / ${formatCount(total)} ${unit}`;
    }
    return job.progress?.message ?? job.status ?? 'Progress unavailable';
  }

  function statusPillClass(status?: string | null): string {
    const tone = statusTone(status);
    return tone === 'idle' ? '' : tone;
  }

  function sourceTimestampValue(asset: AnalyzedIngestionAsset): string {
    const value = asset.metadata?.source_timestamp_utc;
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  }

  function validateAnalyzedAssetTimestamps(assets: EditableAnalyzedAsset[]): string | null {
    for (const asset of assets) {
      try {
        normalizeSourceTimestamp(asset.sourceTimestampText);
      } catch (err) {
        return `${asset.filename ?? asset.path}: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    return null;
  }

  function sourceTimestampInvalid(value: string): boolean {
    try {
      normalizeSourceTimestamp(value);
      return false;
    } catch {
      return true;
    }
  }

  function normalizeSourceTimestamp(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const isoLikeWithTimezone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;
    if (!isoLikeWithTimezone.test(trimmed)) {
      throw new Error('Source timestamp must be ISO 8601 with timezone, for example 2026-07-07T14:30:00Z.');
    }
    const parsed = Date.parse(trimmed);
    if (Number.isNaN(parsed)) {
      throw new Error('Source timestamp is not a valid datetime.');
    }
    return new Date(parsed).toISOString();
  }

  function commonSourcePath(assets: QueueIngestionAssetRequest[]): string | undefined {
    if (assets.length === 1) return assets[0].path;
    const firstParent = parentPath(assets[0]?.path);
    return assets.every((asset) => parentPath(asset.path) === firstParent) ? firstParent : undefined;
  }

  function sourceType(assets: QueueIngestionAssetRequest[]): string | undefined {
    const kinds = new Set(assets.map((asset) => asset.kind));
    return kinds.size === 1 ? [...kinds][0] : 'mixed';
  }

  function parentPath(path: string | undefined): string | undefined {
    if (!path) return undefined;
    const index = path.lastIndexOf('/');
    return index > 0 ? path.slice(0, index) : path;
  }

  function formatJson(value: Record<string, unknown>): string {
    return Object.keys(value).length ? JSON.stringify(value, null, 2) : '';
  }

  function parseMetadataText(text: string, label = 'Metadata'): Record<string, unknown> {
    const trimmed = text.trim();
    if (!trimmed) return {};
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON object.`);
    }
    return parsed as Record<string, unknown>;
  }

  function assetSummary(asset: EditableAnalyzedAsset): string {
    const parts = [
      asset.kind.replace(/_/g, ' '),
      asset.media_count === undefined || asset.media_count === null ? null : `${asset.media_count} item${asset.media_count === 1 ? '' : 's'}`,
      asset.size_bytes === undefined || asset.size_bytes === null ? null : formatBytes(asset.size_bytes)
    ];
    return parts.filter(Boolean).join(' · ');
  }

  function assetMetadataValue(asset: EditableAnalyzedAsset, key: string): string | null {
    const value = asset.metadata?.[key];
    if (value === undefined || value === null || value === '') return null;
    return String(value);
  }

  function enabledAssetCount(): number {
    return analyzedAssets.filter((asset) => asset.enabled).length;
  }

  function parseMetadata(): Record<string, unknown> {
    return parseMetadataText(metadataText, 'Metadata');
  }
</script>

<div class="ingestion-layout">
  <section class="panel ingestion-file-panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Server storage</p>
        <h2>Raw asset browser</h2>
      </div>
    </div>

    {#if browserSource === 'registered-assets'}
      <p class="callout">The live file endpoint was not available, so this view is reconstructed from registered assets.</p>
    {/if}

    <FileSelector
      mode="regular"
      multiSelect={true}
      selectableKinds={['file', 'directory']}
      initialPath={currentPath}
      selectedPaths={selectedPathList}
      loadDirectory={loadBrowserDirectory}
      onSelectionChange={updateSelection}
      onPathChange={updateCurrentPath}
      label="Raw asset files"
    />
  </section>

  <section class="panel ingestion-queue-panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">File ingestion</p>
        <h2>Analyze and queue assets</h2>
      </div>
    </div>

    <div class="ingestion-queue-grid">
      <div class="ingestion-queue-controls">
        <div class="form-grid">
          <label>
            Asset type
            <select bind:value={kind}>
              <option value="auto">auto</option>
              <option value="video">video</option>
              <option value="image_sequence">image sequence</option>
            </select>
          </label>
          <label>
            Tile count
            <input type="number" min="1" bind:value={nTile} />
          </label>
          <label>
            Collections
            <input bind:value={collections} placeholder="cruise-2026,station-a" />
          </label>
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={recursive} />
            Recursive folders
          </label>
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={computeChecksum} />
            Compute checksums
          </label>
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={enqueueSegment} />
            Queue detection after ingestion
          </label>
        </div>

        <label>
          Metadata JSON
          <textarea bind:value={metadataText} rows="5" placeholder={metadataPlaceholder}></textarea>
        </label>

        <div class="button-row">
          <button type="button" on:click={analyzeSelection} disabled={analyzing || selectedPathList.length === 0}>
            {analyzing ? 'Analyzing' : 'Analyze selected paths'}
          </button>
          <p class="soft">{selectedPathList.length} selected from browser, {analyzedAssets.length} analyzed asset{analyzedAssets.length === 1 ? '' : 's'}.</p>
        </div>
        {#if message}<p class="success">{message}</p>{/if}
        {#if error}<p class="form-error">{error}</p>{/if}
      </div>

      <QueueStatusSummary
        title="Ingestion queue"
        eyebrow="Live status"
        stage="ingestion"
        jobIds={submittedJobIds}
        mode="compact"
      />
    </div>

    {#if analyzedAssets.length}
      <div class="ingestion-review-list">
        <div class="section-heading">
          <p class="eyebrow">Analysis results</p>
          <strong>{enabledAssetCount()} enabled for ingestion{jobPolling ? ' · refreshing jobs' : ''}</strong>
        </div>
        {#if jobPollError}<p class="form-error">{jobPollError}</p>{/if}
        <div class="analysis-table-wrap">
          <table class="analysis-table">
            <thead>
              <tr>
                <th>Use</th>
                <th>Asset</th>
                <th>Type</th>
                <th>Collections</th>
                <th>Tiles</th>
                <th>Source datetime</th>
                <th>Recursive</th>
                <th>Facts</th>
                <th>Progress</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {#each analyzedAssets as asset, index}
                {@const ingestionJob = assetIngestionJob(asset)}
                <tr class:disabled={!asset.enabled && !asset.queued} class="analysis-row">
                  <td class="analysis-use-cell">
                    <input
                      aria-label="Enable asset for ingestion"
                      type="checkbox"
                      checked={asset.enabled}
                      on:change={(event) => updateAsset(index, { enabled: event.currentTarget.checked, queued: false })}
                    />
                  </td>
                  <td class="analysis-asset-cell">
                    <input value={asset.filename ?? ''} on:input={(event) => updateAsset(index, { filename: event.currentTarget.value })} />
                    <small title={asset.path}>{asset.path}</small>
                  </td>
                  <td>
                    <select value={asset.kind} on:change={(event) => updateAsset(index, { kind: event.currentTarget.value })}>
                      <option value="video">video</option>
                      <option value="image_sequence">image sequence</option>
                    </select>
                  </td>
                  <td>
                    <input value={asset.collectionsText} on:input={(event) => updateAsset(index, { collectionsText: event.currentTarget.value })} />
                  </td>
                  <td class="analysis-number-cell">
                    <input type="number" min="1" value={asset.nTile} on:input={(event) => updateAsset(index, { nTile: Number(event.currentTarget.value) })} />
                  </td>
                  <td class="analysis-timestamp-cell">
                    <input
                      value={asset.sourceTimestampText}
                      placeholder="blank if unknown"
                      title="ISO 8601 datetime with timezone, for example 2026-07-07T14:30:00Z"
                      aria-invalid={asset.sourceTimestampText.trim() && sourceTimestampInvalid(asset.sourceTimestampText) ? 'true' : undefined}
                      on:input={(event) => updateAsset(index, { sourceTimestampText: event.currentTarget.value })}
                    />
                  </td>
                  <td class="analysis-use-cell">
                    {#if asset.kind === 'image_sequence'}
                      <input
                        aria-label="Scan image sequence folders recursively"
                        type="checkbox"
                        checked={asset.recursive}
                        on:change={(event) => updateAsset(index, { recursive: event.currentTarget.checked })}
                      />
                    {/if}
                  </td>
                  <td class="analysis-facts-cell">
                    <span>{assetSummary(asset)}</span>
                    {#if assetMetadataValue(asset, 'width') && assetMetadataValue(asset, 'height')}
                      <span>{assetMetadataValue(asset, 'width')} x {assetMetadataValue(asset, 'height')}</span>
                    {/if}
                    {#if assetMetadataValue(asset, 'fps')}<span>{assetMetadataValue(asset, 'fps')} FPS</span>{/if}
                  </td>
                  <td class="analysis-progress-cell">
                    {#if ingestionJob}
                      <div class="stage-progress-track">
                        <span style={`width: ${jobProgressWidth(ingestionJob)}`}></span>
                      </div>
                      <small>{formatPercent(ingestionJob.progress?.percent)} · {jobProgressText(ingestionJob)}</small>
                    {:else if asset.queued}
                      <small>Queued; waiting for job status</small>
                    {:else}
                      <small>Not queued</small>
                    {/if}
                  </td>
                  <td class="analysis-status-cell">
                    {#if ingestionJob}
                      <span class={`status-pill ${statusPillClass(ingestionJob.status)}`}>{ingestionJob.status ?? 'queued'}</span>
                    {:else if asset.queued}
                      <span class="status-pill warn">Queued</span>
                    {/if}
                    {#if asset.warnings?.length}<span class="status-pill warn">{asset.warnings.length} warning{asset.warnings.length === 1 ? '' : 's'}</span>{/if}
                    {#if asset.checksum_status}<small>Checksum {asset.checksum_status}</small>{/if}
                  </td>
                  <td class="analysis-action-cell">
                    <button class="ghost compact-action" type="button" on:click={() => removeAnalyzedAsset(index)}>Remove</button>
                  </td>
                </tr>
                <tr class:disabled={!asset.enabled && !asset.queued} class="analysis-detail-row">
                  <td colspan="11">
                    <details class="analysis-row-details">
                      <summary>Details</summary>
                      <div class="analysis-detail-grid">
                        <div>
                          <span>Path</span>
                          <strong>{asset.path}</strong>
                        </div>
                        {#if asset.asset_id}
                          <div>
                            <span>Asset ID</span>
                            <strong>{asset.asset_id}</strong>
                          </div>
                        {/if}
                        {#if ingestionJob}
                          <div>
                            <span>Ingestion job</span>
                            <strong>{ingestionJob.id}</strong>
                          </div>
                        {/if}
                        {#if asset.warnings?.length}
                          <div class="analysis-detail-wide">
                            <span>Warnings</span>
                            <div class="callout warning">
                              {#each asset.warnings as warning}
                                <div>{warning}</div>
                              {/each}
                            </div>
                          </div>
                        {/if}
                        <label class="analysis-detail-wide">
                          Metadata JSON
                          <textarea rows="4" value={asset.metadataText} on:input={(event) => updateAsset(index, { metadataText: event.currentTarget.value })}></textarea>
                        </label>
                      </div>
                    </details>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <div class="ingestion-review-actions">
          <p class="soft">{enabledAssetCount()} of {analyzedAssets.length} asset{analyzedAssets.length === 1 ? '' : 's'} selected.</p>
          <button type="button" on:click={queueIngestion} disabled={queueing || enabledAssetCount() === 0}>
            {queueing ? 'Ingesting' : 'Ingest assets'}
          </button>
        </div>
      </div>
    {:else}
      <p class="empty">Analyze selected files or folders before queueing ingestion.</p>
    {/if}
  </section>
</div>
