<script lang="ts">
  import { onMount } from 'svelte';
  import CollectionTokenInput from '$lib/components/CollectionTokenInput.svelte';
  import FileSelector from '$lib/components/FileSelector.svelte';
  import InfoChip from '$lib/components/InfoChip.svelte';
  import QueueStatusSummary from '$lib/components/QueueStatusSummary.svelte';
  import { getClient, session } from '$lib/stores/session';
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
    numberPreference,
    projectPreferenceKey,
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
  let ingestionScanMode: IngestionScanMode = 'area_scan';
  let ingestionLineScanAxis = 0;
  let ingestionBackgroundWindowWidth = 25;
  let ingestionBackgroundWindowStride = 25;
  let ingestionFlatfieldWindowWidth = 1;
  let ingestionFlatfieldWindowStride = 1;
  let collections = '';
  let collectionOptions: string[] = [];
  let globalDefaultProcessingSettings: ProcessingSettings = {};
  let browserReady = false;
  let preferencesReady = false;
  let analyzing = false;
  let queueing = false;
  let jobPolling = false;
  let jobPollError: string | null = null;
  let analyzedAssets: EditableAnalyzedAsset[] = [];
  let submittedJobIds: string[] = [];
  let submittedRunIds: string[] = [];
  let submittedAssetIds: string[] = [];
  let ingestionJobsById: Record<string, Job> = {};
  let ingestionJobIdsByAssetKey: Record<string, string> = {};

  type IngestionPreferences = {
    nTile: number;
    ingestionScanMode: IngestionScanMode;
    ingestionLineScanAxis: number;
    ingestionBackgroundWindowWidth: number;
    ingestionBackgroundWindowStride: number;
    ingestionFlatfieldWindowWidth: number;
    ingestionFlatfieldWindowStride: number;
    collections: string;
  };

  type IngestionScanMode = 'area_scan' | 'line_scan';

  type EditableAnalyzedAsset = AnalyzedIngestionAsset & {
    enabled: boolean;
    queued?: boolean;
    ingestionJobId?: string;
    collectionsText: string;
    metadataText: string;
    sourceTimestampText: string;
    nTile: number;
  };

  type IngestionProgressSummary = {
    totalJobs: number;
    completedJobs: number;
    activeJobs: number;
    failedJobs: number;
    percent: number;
    label: string;
    detail: string;
  };

  $: ingestionPreferenceSnapshot = {
    nTile,
    ingestionScanMode,
    ingestionLineScanAxis,
    ingestionBackgroundWindowWidth,
    ingestionBackgroundWindowStride,
    ingestionFlatfieldWindowWidth,
    ingestionFlatfieldWindowStride,
    collections
  };
  $: collectionSuggestions = uniqueStrings([
    ...collectionOptions,
    ...collectionValues(collections),
    ...analyzedAssets.flatMap((asset) => collectionValues(asset.collectionsText))
  ]);
  $: if (preferencesReady) writePreferences(ingestionPreferenceKey(), ingestionPreferenceSnapshot);
  $: if (preferencesReady) {
    ingestionPreferenceSnapshot;
    setLiveProcessingPresetFromSettings(captureProcessingSettings());
  }
  $: overallIngestionProgress = ingestionProgressSummary(Object.values(ingestionJobsById));

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
      const [config, collectionRows] = await Promise.all([
        client.systemConfig().catch(() => null),
        client.listCollections(500).catch(() => [])
      ]);
      applyConfigDefaults(config);
      globalDefaultProcessingSettings = currentPageProcessingSettings();
      collectionOptions = uniqueStrings(collectionRows.map((collection) => collection.collection));
    }
    restorePreferences();
    applyStoredLiveProcessingPreset();
    if (client) await initializeRawBrowserPath(client);
    browserReady = true;
    preferencesReady = true;
  }

  function ingestionPreferenceKey(): string {
    return projectPreferenceKey('ingestion', $session);
  }

  function applyConfigDefaults(config: SystemConfigResponse | null) {
    const videoIngest = processingSection(config, 'video_ingest');
    const preprocessing = processingSection(config, 'preprocessing');
    const flatfield = processingSection(config, 'flatfield');
    nTile = numberDefault(videoIngest, 'n_tile', nTile);
    ingestionBackgroundWindowWidth = numberDefault(preprocessing, 'background_window_width', ingestionBackgroundWindowWidth);
    ingestionBackgroundWindowStride = numberDefault(preprocessing, 'background_window_stride', ingestionBackgroundWindowStride);
    ingestionLineScanAxis = numberDefault(flatfield, 'flatfield_axis', ingestionLineScanAxis);
    ingestionFlatfieldWindowWidth = numberDefault(flatfield, 'background_window_width', ingestionFlatfieldWindowWidth);
    ingestionFlatfieldWindowStride = numberDefault(flatfield, 'background_window_stride', ingestionFlatfieldWindowStride);
  }

  function restorePreferences() {
    const preferences = readPreferences<IngestionPreferences>(ingestionPreferenceKey());
    if (!preferences) return;
    nTile = numberPreference(preferences.nTile, nTile);
    ingestionScanMode = normalizeIngestionScanMode(stringPreference(preferences.ingestionScanMode, ingestionScanMode));
    ingestionLineScanAxis = normalizeLineScanAxis(numberPreference(preferences.ingestionLineScanAxis, ingestionLineScanAxis));
    ingestionBackgroundWindowWidth = normalizeOddPositive(numberPreference(preferences.ingestionBackgroundWindowWidth, ingestionBackgroundWindowWidth));
    ingestionBackgroundWindowStride = normalizeOddPositive(numberPreference(preferences.ingestionBackgroundWindowStride, ingestionBackgroundWindowStride));
    ingestionFlatfieldWindowWidth = normalizeOddPositive(numberPreference(preferences.ingestionFlatfieldWindowWidth, ingestionFlatfieldWindowWidth));
    ingestionFlatfieldWindowStride = normalizeOddPositive(numberPreference(preferences.ingestionFlatfieldWindowStride, ingestionFlatfieldWindowStride));
    collections = stringPreference(preferences.collections, collections);
  }

  function captureProcessingSettings(): ProcessingSettings {
    return pruneProcessingSettings({
      ...currentLiveProcessingPreset().settings,
      ...currentPageProcessingSettings()
    });
  }

  function currentPageProcessingSettings(): ProcessingSettings {
    return {
      ingestionTileCount: Math.max(1, Math.round(numberPreference(nTile, 1))),
      ingestionScanMode,
      ingestionLineScanAxis: normalizeLineScanAxis(ingestionLineScanAxis),
      ingestionBackgroundWindowWidth: normalizeOddPositive(ingestionBackgroundWindowWidth),
      ingestionBackgroundWindowStride: normalizeOddPositive(ingestionBackgroundWindowStride),
      ingestionFlatfieldWindowWidth: normalizeOddPositive(ingestionFlatfieldWindowWidth),
      ingestionFlatfieldWindowStride: normalizeOddPositive(ingestionFlatfieldWindowStride)
    };
  }

  function processingSettingsWithDefaults(settings: ProcessingSettings): ProcessingSettings {
    return {
      ...globalDefaultProcessingSettings,
      ...settings
    };
  }

  function applyProcessingPresetSettings(preset: ProcessingPreset, options: { updateSession?: boolean } = {}) {
    applyProcessingSettings(processingSettingsWithDefaults(preset.settings));
    if (options.updateSession) {
      setLiveProcessingPresetFromSettings(captureProcessingSettings(), {
        selectedKey: preset.source === 'live' ? 'live:live' : undefined
      });
    }
  }

  function applyProcessingSettings(settings: ProcessingSettings) {
    if ('ingestionTileCount' in settings) {
      nTile = Math.max(1, Math.round(numberPreference(settings.ingestionTileCount, nTile)));
    }
    if ('ingestionScanMode' in settings) {
      ingestionScanMode = normalizeIngestionScanMode(stringPreference(settings.ingestionScanMode, ingestionScanMode));
    }
    if ('ingestionLineScanAxis' in settings) {
      ingestionLineScanAxis = normalizeLineScanAxis(numberPreference(settings.ingestionLineScanAxis, ingestionLineScanAxis));
    }
    if ('ingestionBackgroundWindowWidth' in settings) {
      ingestionBackgroundWindowWidth = normalizeOddPositive(numberPreference(settings.ingestionBackgroundWindowWidth, ingestionBackgroundWindowWidth));
    }
    if ('ingestionBackgroundWindowStride' in settings) {
      ingestionBackgroundWindowStride = normalizeOddPositive(numberPreference(settings.ingestionBackgroundWindowStride, ingestionBackgroundWindowStride));
    }
    if ('ingestionFlatfieldWindowWidth' in settings) {
      ingestionFlatfieldWindowWidth = normalizeOddPositive(numberPreference(settings.ingestionFlatfieldWindowWidth, ingestionFlatfieldWindowWidth));
    }
    if ('ingestionFlatfieldWindowStride' in settings) {
      ingestionFlatfieldWindowStride = normalizeOddPositive(numberPreference(settings.ingestionFlatfieldWindowStride, ingestionFlatfieldWindowStride));
    }
  }

  function applyStoredLiveProcessingPreset() {
    const preset = currentLiveProcessingPreset();
    if (preset?.source === 'live' && preset.settings) {
      applyProcessingPresetSettings(preset);
    }
  }

  function handleHeaderProcessingPresetApplied(event: Event) {
    const preset = (event as CustomEvent<ProcessingPreset>).detail;
    if (!preset?.settings) return;
    applyProcessingPresetSettings(preset, { updateSession: true });
  }

  async function loadBrowserDirectory(path = currentPath): Promise<DirectoryListing> {
    const client = getClient();
    if (!client) throw new Error('Connect to a Pelagia server before browsing files.');
    const listing = await client.listRawDirectory(path);
    browserSource = listing.source;
    currentPath = listing.path;
    return listing;
  }

  async function initializeRawBrowserPath(client: NonNullable<ReturnType<typeof getClient>>) {
    if (currentPath && currentPath !== '.') return;
    try {
      const roots = await client.listRawDirectory('.');
      const importRoot = roots.entries.find((entry) => entry.key === 'import' || entry.name === 'Raw Asset Import Directory');
      if (importRoot?.path) currentPath = importRoot.path;
    } catch {
      // Fall back to the server/browser default if roots are not available.
    }
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
    const optionError = validateIngestionScanOptions();
    if (optionError) {
      error = optionError;
      return;
    }
    analyzing = true;
    const nextAssets: EditableAnalyzedAsset[] = [];
    for (const path of paths) {
      try {
        const response = await client.analyzeIngestionSource({
          source_path: path,
          n_tile: nTile,
          collections: collections || undefined,
          ...ingestionScanRequestOptions()
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
    const optionError = validateIngestionScanOptions();
    if (optionError) {
      error = optionError;
      return;
    }
    queueing = true;
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
        ...ingestionScanRequestOptions()
      });
      const nextJobIds = (response.jobs ?? []).map((job) => job.id).filter((id): id is string => Boolean(id));
      submittedJobIds = uniqueStrings([...nextJobIds, ...submittedJobIds]).slice(0, 100);
      submittedRunIds = uniqueStrings([response.run_id, ...submittedRunIds]).slice(0, 50);
      submittedAssetIds = uniqueStrings([
        ...(response.assets ?? []).map((asset) => asset.id),
        ...assets.map((asset) => asset.asset_id),
        ...submittedAssetIds
      ]).slice(0, 500);
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
      nTile: Number(suggested?.n_tile ?? nTile)
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
      n_tile: Math.max(1, Math.round(Number(nTile) || 1))
    };
  }

  function ingestionScanRequestOptions(): Pick<
    QueueAssetsRequest,
    | 'generate_backgrounds'
    | 'generate_flatfield_profiles'
    | 'flatfield_axis'
    | 'background_window_width'
    | 'background_window_stride'
    | 'flatfield_window_width'
    | 'flatfield_window_stride'
  > {
    if (ingestionScanMode === 'line_scan') {
      return {
        generate_backgrounds: false,
        generate_flatfield_profiles: true,
        flatfield_axis: normalizeLineScanAxis(ingestionLineScanAxis),
        flatfield_window_width: normalizeOddPositive(ingestionFlatfieldWindowWidth),
        flatfield_window_stride: normalizeOddPositive(ingestionFlatfieldWindowStride)
      };
    }
    return {
      generate_backgrounds: true,
      generate_flatfield_profiles: false,
      background_window_width: normalizeOddPositive(ingestionBackgroundWindowWidth),
      background_window_stride: normalizeOddPositive(ingestionBackgroundWindowStride)
    };
  }

  function validateIngestionScanOptions(): string | null {
    if (ingestionScanMode === 'line_scan') {
      const axis = Number(ingestionLineScanAxis);
      if (axis !== 0 && axis !== 1) return 'Line scan axis must be 0 or 1.';
      return validateWindowPair(
        ingestionFlatfieldWindowWidth,
        ingestionFlatfieldWindowStride,
        'Flatfield Window Width',
        'Flatfield Window Stride'
      );
    }
    return validateWindowPair(
      ingestionBackgroundWindowWidth,
      ingestionBackgroundWindowStride,
      'Background Window Width',
      'Background Window Stride'
    );
  }

  function normalizeIngestionScanMode(value: string | null | undefined): IngestionScanMode {
    return value === 'line_scan' ? 'line_scan' : 'area_scan';
  }

  function normalizeLineScanAxis(value: unknown): number {
    return Number(value) === 1 ? 1 : 0;
  }

  function normalizeOddPositive(value: unknown): number {
    const rounded = Math.max(1, Math.round(Number(value) || 1));
    return rounded % 2 === 1 ? rounded : rounded + 1;
  }

  function isPositiveOdd(value: unknown): boolean {
    const number = Number(value);
    return Number.isInteger(number) && number >= 1 && number % 2 === 1;
  }

  function validateWindowPair(width: unknown, stride: unknown, widthLabel: string, strideLabel: string): string | null {
    if (!isPositiveOdd(width)) return `${widthLabel} must be a positive odd integer.`;
    if (!isPositiveOdd(stride)) return `${strideLabel} must be a positive odd integer.`;
    if (Number(stride) > Number(width)) return `${strideLabel} must be within the range [1, ${widthLabel}].`;
    return null;
  }

  function collectionValues(value: string): string[] {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function updateAsset(index: number, patch: Partial<EditableAnalyzedAsset>) {
    analyzedAssets = analyzedAssets.map((asset, assetIndex) => assetIndex === index ? { ...asset, ...patch } : asset);
  }

  function removeAnalyzedAsset(index: number) {
    analyzedAssets = analyzedAssets.filter((_, assetIndex) => assetIndex !== index);
  }

  function selectAllAnalyzedAssets() {
    analyzedAssets = analyzedAssets.map((asset) => (asset.queued ? asset : { ...asset, enabled: true }));
  }

  function selectNoAnalyzedAssets() {
    analyzedAssets = analyzedAssets.map((asset) => ({ ...asset, enabled: false }));
  }

  function clearSelectedAnalyzedAssets() {
    analyzedAssets = analyzedAssets.filter((asset) => !asset.enabled);
  }

  function assetKey(asset: Pick<EditableAnalyzedAsset, 'path' | 'asset_id'> | Pick<QueueIngestionAssetRequest, 'path' | 'asset_id'>): string {
    return asset.path || asset.asset_id || '';
  }

  async function refreshIngestionJobs() {
    const client = getClient();
    if (!client || (submittedJobIds.length === 0 && submittedRunIds.length === 0 && submittedAssetIds.length === 0) || jobPolling) return;
    jobPolling = true;
    jobPollError = null;
    try {
      const jobsById: Record<string, Job> = {};
      const addJobs = (jobs: Job[]) => {
        for (const job of jobs) jobsById[job.id] = job;
      };
      if (submittedJobIds.length) {
        addJobs(
          await client.listJobs({
            ids: submittedJobIds,
            include_progress: true,
            include_payload: true,
            limit: Math.max(100, submittedJobIds.length),
            sort: 'updated_at',
            direction: 'desc'
          })
        );
      }
      for (const runId of submittedRunIds) {
        addJobs(
          await client.listJobs({
            run_id: runId,
            stage: ['extract_frames', 'ingest_run'],
            include_progress: true,
            include_payload: true,
            limit: 500,
            sort: 'updated_at',
            direction: 'desc'
          })
        );
      }
      if (submittedJobIds.length === 0 && submittedRunIds.length === 0) {
        for (const assetId of submittedAssetIds.slice(0, 50)) {
          addJobs(
            await client.listJobs({
              asset_id: assetId,
              include_progress: true,
              include_payload: true,
              limit: 50,
              sort: 'updated_at',
              direction: 'desc'
            })
          );
        }
      }
      const jobs = Object.values(jobsById);
      mergeIngestionJobs(jobs);
      rememberAssetJobLinks(analyzedAssets, jobs);
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
      for (const key of jobAssetKeys(job)) nextIdsByAssetKey[key] = job.id;
    }
    ingestionJobsById = nextById;
    ingestionJobIdsByAssetKey = nextIdsByAssetKey;
  }

  function rememberAssetJobLinks(assets: EditableAnalyzedAsset[], jobs: Job[]) {
    if (!jobs.length) return;
    const nextIdsByAssetKey = { ...ingestionJobIdsByAssetKey };
    const jobsByAssetKey = jobsByAssetKeyFromList(jobs);
    for (const asset of assets) {
      const jobId = assetMatchKeys(asset).map((key) => jobsByAssetKey[key]?.id).find(Boolean) ?? asset.ingestionJobId;
      if (jobId) {
        for (const key of assetMatchKeys(asset)) nextIdsByAssetKey[key] = jobId;
      }
    }
    ingestionJobIdsByAssetKey = nextIdsByAssetKey;
  }

  function jobsByAssetKeyFromList(jobs: Job[]): Record<string, Job> {
    const result: Record<string, Job> = {};
    for (const job of jobs) {
      for (const key of jobAssetKeys(job)) result[key] = job;
    }
    return result;
  }

  function jobAssetKeys(job: Job): string[] {
    const payload = job.payload ?? {};
    const result = job.result ?? {};
    const payloadAsset = objectValue(payload.asset);
    const resultAsset = objectValue(result.asset);
    const candidates = [
      job.asset_id,
      stringValue(payload.asset_id),
      stringValue(payload.raw_asset_id),
      stringValue(payload.proposed_asset_id),
      stringValue(payload.source_path),
      stringValue(payload.path),
      stringValue(payloadAsset.id),
      stringValue(payloadAsset.asset_id),
      stringValue(payloadAsset.path),
      stringValue(result.asset_id),
      stringValue(result.raw_asset_id),
      stringValue(result.source_path),
      stringValue(result.path),
      stringValue(resultAsset.id),
      stringValue(resultAsset.asset_id),
      stringValue(resultAsset.path)
    ];
    return uniqueStrings(candidates);
  }

  function assetIngestionJob(asset: EditableAnalyzedAsset): Job | null {
    const linkedJobId = asset.ingestionJobId ?? assetMatchKeys(asset).map((key) => ingestionJobIdsByAssetKey[key]).find(Boolean);
    return linkedJobId ? ingestionJobsById[linkedJobId] ?? null : null;
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

  function ingestionProgressSummary(jobs: Job[]): IngestionProgressSummary | null {
    if (!jobs.length) return null;
    let completedUnits = 0;
    let totalUnits = 0;
    let completedJobs = 0;
    let activeJobs = 0;
    let failedJobs = 0;

    for (const job of jobs) {
      const status = String(job.status ?? '').toLowerCase();
      const terminal = ['succeeded', 'failed', 'cancelled', 'dead_lettered'].includes(status);
      const failed = ['failed', 'cancelled', 'dead_lettered'].includes(status);
      if (status === 'succeeded') completedJobs += 1;
      else if (failed) failedJobs += 1;
      else activeJobs += 1;

      const completed = numericValue(job.progress?.completed);
      const total = numericValue(job.progress?.total);
      if (completed !== null && total !== null && total > 0) {
        completedUnits += Math.min(completed, total);
        totalUnits += total;
      } else {
        completedUnits += terminal ? 1 : 0;
        totalUnits += 1;
      }
    }

    const percent = totalUnits > 0 ? Math.max(0, Math.min(100, (completedUnits / totalUnits) * 100)) : 0;
    const unitDetail =
      totalUnits > jobs.length
        ? `${formatCount(completedUnits)} / ${formatCount(totalUnits)} work units`
        : `${formatCount(completedJobs + failedJobs)} / ${formatCount(jobs.length)} jobs finished`;
    const statusDetail = [
      activeJobs ? `${formatCount(activeJobs)} active` : null,
      completedJobs ? `${formatCount(completedJobs)} succeeded` : null,
      failedJobs ? `${formatCount(failedJobs)} need attention` : null
    ].filter(Boolean).join(' · ');

    return {
      totalJobs: jobs.length,
      completedJobs,
      activeJobs,
      failedJobs,
      percent,
      label: `${formatPercent(percent)} complete`,
      detail: statusDetail ? `${unitDetail} · ${statusDetail}` : unitDetail
    };
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

  function assetMatchKeys(asset: Pick<EditableAnalyzedAsset, 'path' | 'asset_id'>): string[] {
    return uniqueStrings([asset.path, asset.asset_id]);
  }

  function uniqueStrings(values: Array<string | null | undefined>): string[] {
    return [...new Set(values.filter((value): value is string => Boolean(value)))];
  }

  function objectValue(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  function stringValue(value: unknown): string | null {
    return typeof value === 'string' && value ? value : null;
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

    {#if browserReady}
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
    {:else}
      <p class="empty">Loading raw asset browser.</p>
    {/if}
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
            <span class="field-label-row">
              Acquisition mode
              <InfoChip
                label="Acquisition mode help"
                text="Choose the mode that best matches the imaging sensor and acquisition pattern. Area Scan prepares mean backgrounds; Line Scan prepares flatfield profiles."
              />
            </span>
            <select bind:value={ingestionScanMode}>
              <option value="area_scan">Area Scan</option>
              <option value="line_scan">Line Scan</option>
            </select>
          </label>
          {#if ingestionScanMode === 'line_scan'}
            <label>
              <span class="field-label-row">
                Line scan axis
                <InfoChip
                  label="Line scan axis help"
                  text="Axis 0 means profiles are generated across columns; axis 1 means profiles are generated across rows. Choose the sensor dimension that receives line-wise correction."
                />
              </span>
              <select bind:value={ingestionLineScanAxis}>
                <option value={0}>0</option>
                <option value={1}>1</option>
              </select>
            </label>
          {/if}
          <label>
            Collections
            <CollectionTokenInput
              value={collections}
              suggestions={collectionSuggestions}
              placeholder="Add collection"
              onChange={(value) => collections = value}
            />
          </label>
        </div>
        <details class="advanced-search-panel ingestion-advanced-panel">
          <summary>Advanced options</summary>
          <div class="advanced-search-grid">
            <label>
              <span class="field-label-row">
                Tile count
                <InfoChip
                  label="Tile count help"
                  text="The number of frames to stitch together. Only suitable for Linescan frames that are continuously collected."
                />
              </span>
              <input type="number" min="1" bind:value={nTile} />
            </label>
            <label class:field-disabled={ingestionScanMode !== 'area_scan'}>
              <span class="field-label-row">
                Background Window Width
                <InfoChip
                  label="Background Window Width help"
                  text="Number of frames used for each area-scan mean background. Must be a positive, odd value."
                />
              </span>
              <input type="number" min="1" step="2" bind:value={ingestionBackgroundWindowWidth} disabled={ingestionScanMode !== 'area_scan'} />
            </label>
            <label class:field-disabled={ingestionScanMode !== 'area_scan'}>
              <span class="field-label-row">
                Background Window Stride
                <InfoChip
                  label="Background Window Stride help"
                  text="Number of frames to advance before calculating the next background. Must be at least 1 and no larger than the background window width (typically equal to the window width)."
                />
              </span>
              <input type="number" min="1" step="2" bind:value={ingestionBackgroundWindowStride} disabled={ingestionScanMode !== 'area_scan'} />
            </label>
            <label class:field-disabled={ingestionScanMode !== 'line_scan'}>
              <span class="field-label-row">
                Flatfield Window Width
                <InfoChip
                  label="Flatfield Window Width help"
                  text="Number of frames used for each line-scan flatfield profile. Must be a positive odd value."
                />
              </span>
              <input type="number" min="1" step="2" bind:value={ingestionFlatfieldWindowWidth} disabled={ingestionScanMode !== 'line_scan'} />
            </label>
            <label class:field-disabled={ingestionScanMode !== 'line_scan'}>
              <span class="field-label-row">
                Flatfield Window Stride
                <InfoChip
                  label="Flatfield Window Stride help"
                  text="Number of frames to advance before calculating the next line-scan profile. Must be at least 1 and no larger than the flatfield window width."
                />
              </span>
              <input type="number" min="1" step="2" bind:value={ingestionFlatfieldWindowStride} disabled={ingestionScanMode !== 'line_scan'} />
            </label>
          </div>
        </details>

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
        <div class="section-heading analysis-section-heading">
          <div>
            <p class="eyebrow">Analysis results</p>
            <strong>{enabledAssetCount()} enabled for ingestion{jobPolling ? ' · refreshing jobs' : ''}</strong>
          </div>
          <div class="analysis-selection-actions" aria-label="Analysis selection actions">
            <button class="ghost compact-action" type="button" on:click={selectAllAnalyzedAssets}>
              Select all
            </button>
            <button class="ghost compact-action" type="button" on:click={selectNoAnalyzedAssets} disabled={enabledAssetCount() === 0}>
              Select none
            </button>
            <button class="ghost compact-action" type="button" on:click={clearSelectedAnalyzedAssets} disabled={enabledAssetCount() === 0} title="Remove selected assets from the analysis list">
              Clear selection
            </button>
          </div>
        </div>
        {#if jobPollError}<p class="form-error">{jobPollError}</p>{/if}
        {#if overallIngestionProgress}
          <div class="ingestion-overall-progress" class:warn={overallIngestionProgress.failedJobs > 0}>
            <div class="ingestion-overall-progress-head">
              <div>
                <span>Overall ingestion</span>
                <strong>{overallIngestionProgress.label}</strong>
              </div>
              <small>{jobPolling ? 'Refreshing' : `${formatCount(overallIngestionProgress.totalJobs)} job${overallIngestionProgress.totalJobs === 1 ? '' : 's'}`}</small>
            </div>
            <div class="stage-progress-track">
              <span style={`width: ${Math.max(0, Math.min(100, overallIngestionProgress.percent))}%`}></span>
            </div>
            <p>{overallIngestionProgress.detail}</p>
          </div>
        {/if}
        <div class="analysis-table-wrap">
          <table class="analysis-table">
            <thead>
              <tr>
                <th>Use</th>
                <th>Asset</th>
                <th>Type</th>
                <th>Collections</th>
                <th>Source datetime</th>
                <th>Facts</th>
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
                    <span>{asset.kind.replace(/_/g, ' ')}</span>
                  </td>
                  <td>
                    <CollectionTokenInput
                      value={asset.collectionsText}
                      suggestions={collectionSuggestions}
                      placeholder="Add collection"
                      onChange={(value) => updateAsset(index, { collectionsText: value })}
                    />
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
                  <td class="analysis-facts-cell">
                    <span>{assetSummary(asset)}</span>
                    {#if assetMetadataValue(asset, 'width') && assetMetadataValue(asset, 'height')}
                      <span>{assetMetadataValue(asset, 'width')} x {assetMetadataValue(asset, 'height')}</span>
                    {/if}
                    {#if assetMetadataValue(asset, 'fps')}<span>{assetMetadataValue(asset, 'fps')} FPS</span>{/if}
                  </td>
                  <td class="analysis-status-cell">
                    {#if ingestionJob}
                      <span class={`status-pill ${statusPillClass(ingestionJob.status)}`}>{ingestionJob.status ?? 'queued'}</span>
                      <small>{jobProgressText(ingestionJob)}</small>
                    {:else if asset.queued}
                      <span class="status-pill warn">Queued</span>
                      <small>Waiting for job status</small>
                    {/if}
                    {#if asset.warnings?.length}<span class="status-pill warn">{asset.warnings.length} warning{asset.warnings.length === 1 ? '' : 's'}</span>{/if}
                    {#if asset.checksum_status}<small>Checksum {asset.checksum_status}</small>{/if}
                  </td>
                  <td class="analysis-action-cell">
                    <button class="ghost compact-action" type="button" on:click={() => removeAnalyzedAsset(index)}>Remove</button>
                  </td>
                </tr>
                <tr class:disabled={!asset.enabled && !asset.queued} class="analysis-detail-row">
                  <td colspan="9">
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
