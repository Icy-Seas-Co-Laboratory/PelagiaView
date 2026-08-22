<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import FileSelector from '$lib/components/FileSelector.svelte';
  import { getClient } from '$lib/stores/session';
  import type {
    DirectoryListing,
    Job,
    RunSummary,
    TelemetryAnalyzeResponse,
    TelemetryCatalogResponse,
    TelemetryImportRequest
  } from '$lib/api/types';

  type StreamMapping = {
    column: string;
    parameterKey: string;
    nativeUnit: string;
    canonicalUnit: string;
    sensorKey: string;
    streamKey: string;
    displayName: string;
    sensorDisplayName: string;
    manufacturer: string;
    model: string;
    serialNumber: string;
    qcColumn: string;
    excludedQcFlags: string;
    interpolation: string;
    maxGapSeconds: string;
    samplingRateHz: string;
    priority: string;
    isDefault: boolean;
  };

  const builtInParameters = [
    { key: 'temperature', label: 'Temperature', unit: 'degC' },
    { key: 'conductivity', label: 'Conductivity', unit: 'mS/cm' },
    { key: 'pressure', label: 'Pressure', unit: 'dbar' },
    { key: 'depth', label: 'Depth', unit: 'm' },
    { key: 'salinity', label: 'Practical salinity', unit: 'PSU' },
    { key: 'sound_velocity', label: 'Sound velocity', unit: 'm/s' }
  ];

  let selectedPaths: string[] = [];
  let currentPath = '.';
  let analysis: TelemetryAnalyzeResponse | null = null;
  let catalog: TelemetryCatalogResponse | null = null;
  let runs: RunSummary[] = [];
  let runId = '';
  let runKey = '';
  let instrument = 'telemetry';
  let creatingRun = false;
  let timestampColumn = '';
  let timestampFormat = 'auto';
  let sourceTimezone = 'UTC';
  let delimiter = ',';
  let parserName = 'pelagia.delimited';
  let parserVersion = '1';
  let collection = '';
  let sensorKey = 'sensor-1';
  let mappings: StreamMapping[] = [];
  let selectedChartColumn = '';
  let analyzing = false;
  let importing = false;
  let loading = true;
  let error: string | null = null;
  let message: string | null = null;
  let queuedJob: Job | null = null;
  let jobTimer: number | null = null;
  let jobError: string | null = null;

  $: parameterOptions = [
    ...builtInParameters,
    ...(catalog?.parameters ?? [])
      .map((parameter) => ({
        key: String(parameter.parameter_key ?? ''),
        label: String(parameter.display_name ?? parameter.parameter_key ?? ''),
        unit: String(parameter.canonical_unit ?? '')
      }))
      .filter((parameter) => parameter.key && !builtInParameters.some((item) => item.key === parameter.key))
  ];
  $: units = catalog?.unit_registry?.units ?? [];
  $: diagnostics = analysis?.timestamp_diagnostics;
  $: numericColumns = (analysis?.column_stats ?? [])
    .filter((stat) => stat.column && stat.column !== (analysis?.timestamp_column ?? timestampColumn) && (stat.numeric ?? 0) > 0)
    .map((stat) => stat.column as string);
  $: chartColumn = selectedChartColumn && numericColumns.includes(selectedChartColumn) ? selectedChartColumn : numericColumns[0] ?? '';
  $: chartRows = (analysis?.preview_rows ?? [])
    .map((row) => ({
      timestamp: row.timestamp ?? '',
      value: Number(row.values?.[chartColumn])
    }))
    .filter((row) => row.timestamp && Number.isFinite(row.value));
  $: chartMin = chartRows.length ? Math.min(...chartRows.map((row) => row.value)) : 0;
  $: chartMax = chartRows.length ? Math.max(...chartRows.map((row) => row.value)) : 1;
  $: chartSpan = chartMax - chartMin || 1;
  $: chartPoints = chartRows.map((row, index) => `${(index / Math.max(1, chartRows.length - 1)) * 100},${92 - ((row.value - chartMin) / chartSpan) * 82}`).join(' ');
  $: columnQuality = analysis?.column_stats ?? [];
  $: canImport = Boolean(
    analysis && diagnostics?.valid && runId.trim() && mappings.length > 0 && mappings.every(isValidMapping)
  );
  $: importStatus = String(queuedJob?.status ?? 'unknown').toLowerCase();
  $: importIsActive = ['queued', 'leased', 'working', 'paused'].includes(importStatus);
  $: importPercent = jobProgressPercent(queuedJob);
  $: importStatusLabel = jobStatusLabel(importStatus);
  $: importProgressMessage = queuedJob?.progress?.message ?? queuedJob?.summary ?? importStatusLabel;
  $: importCompleted = numericProgressValue(queuedJob?.progress?.completed);
  $: importTotal = numericProgressValue(queuedJob?.progress?.total);
  $: importRate = numericProgressValue(queuedJob?.progress?.rates?.units_per_second);

  onMount(() => {
    void initialize();
  });

  onDestroy(() => {
    if (jobTimer !== null) window.clearInterval(jobTimer);
  });

  async function initialize() {
    const client = getClient();
    if (!client) {
      error = 'Connect to a Pelagia server before importing telemetry.';
      loading = false;
      return;
    }
    try {
      [catalog, runs] = await Promise.all([client.telemetryCatalog(), client.listRuns(100)]);
      runId = runs[0]?.id ?? runs[0]?.run_id ?? '';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  async function loadDirectory(path: string): Promise<DirectoryListing> {
    const client = getClient();
    if (!client) throw new Error('Connect to a Pelagia server before browsing files.');
    return client.listRawDirectory(path);
  }

  function selectFile(paths: string[]) {
    selectedPaths = paths.slice(-1);
    analysis = null;
    mappings = [];
    message = null;
    error = null;
  }

  async function analyze() {
    const client = getClient();
    const path = selectedPaths[0];
    if (!client || !path || analyzing) return;
    analyzing = true;
    error = null;
    message = null;
    try {
      analysis = await client.analyzeTelemetry({
        path,
        timestamp_column: timestampColumn.trim() || null,
        timestamp_format: timestampFormat,
        source_timezone: sourceTimezone,
        delimiter,
        sample_limit: 240
      });
      timestampColumn = analysis.timestamp_column ?? timestampColumn;
      if (!collection.trim()) collection = analysis.filename?.replace(/\.csv$/i, '') ?? '';
      mappings = numericColumnsFor(analysis).map((column, index) => makeMapping(column, index));
      selectedChartColumn = mappings[0]?.column ?? '';
    } catch (cause) {
      analysis = null;
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      analyzing = false;
    }
  }

  function numericColumnsFor(value: TelemetryAnalyzeResponse): string[] {
    return (value.column_stats ?? [])
      .filter((stat) => stat.column && stat.column !== (value.timestamp_column ?? timestampColumn) && (stat.numeric ?? 0) > 0)
      .map((stat) => stat.column as string);
  }

  function guessParameter(column: string) {
    const normalized = column.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    return parameterOptions.find((parameter) => normalized.includes(parameter.key.replace('_', ''))) ??
      parameterOptions.find((parameter) => normalized.includes(parameter.key)) ??
      { key: normalized || 'measurement', label: column, unit: units[0]?.canonical_unit ?? '' };
  }

  function makeMapping(column: string, index: number): StreamMapping {
    const parameter = guessParameter(column);
    return {
      column,
      parameterKey: parameter.key,
      nativeUnit: parameter.unit,
      canonicalUnit: parameter.unit,
      sensorKey,
      streamKey: `${sensorKey}.${parameter.key}`,
      displayName: parameter.label,
      sensorDisplayName: '',
      manufacturer: '',
      model: '',
      serialNumber: '',
      qcColumn: '',
      excludedQcFlags: '',
      interpolation: 'none',
      maxGapSeconds: '',
      samplingRateHz: '',
      priority: '100',
      isDefault: index === 0
    };
  }

  function updateMapping(index: number, patch: Partial<StreamMapping>) {
    mappings = mappings.map((mapping, mappingIndex) => mappingIndex === index ? { ...mapping, ...patch } : mapping);
  }

  function unitConversion(mapping: StreamMapping): { scale: number; offset: number } {
    const native = units.find((unit) => unit.canonical_unit === mapping.nativeUnit);
    const canonical = units.find((unit) => unit.canonical_unit === mapping.canonicalUnit);
    if (!native || !canonical || native.dimension !== canonical.dimension) return { scale: 1, offset: 0 };
    const targetScale = canonical.scale_to_reference ?? 1;
    return {
      scale: (native.scale_to_reference ?? 1) / targetScale,
      offset: ((native.offset_to_reference ?? 0) - (canonical.offset_to_reference ?? 0)) / targetScale
    };
  }

  function unitCompatible(mapping: StreamMapping): boolean {
    const native = units.find((unit) => unit.canonical_unit === mapping.nativeUnit);
    const canonical = units.find((unit) => unit.canonical_unit === mapping.canonicalUnit);
    return Boolean(native && canonical && native.dimension === canonical.dimension);
  }

  function isValidMapping(mapping: StreamMapping): boolean {
    const gap = Number(mapping.maxGapSeconds);
    const rate = Number(mapping.samplingRateHz);
    return Boolean(
      mapping.parameterKey && mapping.nativeUnit && mapping.canonicalUnit && unitCompatible(mapping) &&
      mapping.sensorKey.trim() && mapping.streamKey.trim() && mapping.priority.trim() &&
      (mapping.interpolation === 'none' || (Number.isFinite(gap) && gap > 0)) &&
      (!mapping.samplingRateHz || (Number.isFinite(rate) && rate > 0))
    );
  }

  function applyParameter(index: number, key: string) {
    const parameter = parameterOptions.find((item) => item.key === key);
    updateMapping(index, {
      parameterKey: key,
      nativeUnit: parameter?.unit ?? mappings[index].nativeUnit,
      canonicalUnit: parameter?.unit ?? mappings[index].canonicalUnit,
      displayName: parameter?.label ?? mappings[index].displayName,
      streamKey: `${mappings[index].sensorKey}.${key}`
    });
  }

  async function importData() {
    const client = getClient();
    if (!client || !analysis || !canImport || importing) return;
    importing = true;
    error = null;
    message = null;
    try {
      const request: TelemetryImportRequest = {
        path: analysis.path ?? selectedPaths[0],
        timestamp_column: analysis.timestamp_column ?? timestampColumn,
        timestamp_format: analysis.timestamp_format ?? timestampFormat,
        source_timezone: sourceTimezone,
        delimiter,
        parser_name: parserName,
        parser_version: parserVersion,
        collections: collection.trim() ? [collection.trim()] : null,
        metadata: { source_file: analysis.filename, ui: 'PelagiaView telemetry import' },
        streams: mappings.map((mapping) => ({
          ...unitConversion(mapping),
          column: mapping.column,
          stream_key: mapping.streamKey,
          sensor_key: mapping.sensorKey,
          parameter_key: mapping.parameterKey,
          native_unit: mapping.nativeUnit,
          canonical_unit: mapping.canonicalUnit,
          display_name: mapping.displayName || null,
          sensor_display_name: mapping.sensorDisplayName || null,
          manufacturer: mapping.manufacturer || null,
          model: mapping.model || null,
          serial_number: mapping.serialNumber || null,
          qc_column: mapping.qcColumn || null,
          metadata: mapping.excludedQcFlags.trim() ? { excluded_qc_flags: mapping.excludedQcFlags.split(',').map((value) => Number(value.trim())).filter((value) => Number.isInteger(value)) } : {},
          interpolation: mapping.interpolation,
          max_gap_seconds: mapping.maxGapSeconds ? Number(mapping.maxGapSeconds) : null,
          sampling_rate_hz: mapping.samplingRateHz ? Number(mapping.samplingRateHz) : null,
          priority: Number(mapping.priority),
          is_default: mapping.isDefault,
        }))
      };
      const response = await client.importTelemetry(runId.trim(), request);
      queuedJob = response.job;
      jobError = null;
      message = 'Telemetry import queued. Pelagia is validating and publishing the source asynchronously.';
      watchJob(response.job.id);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      importing = false;
    }
  }

  async function createRun() {
    const client = getClient();
    if (!client || !runKey.trim() || creatingRun) return;
    creatingRun = true;
    error = null;
    try {
      const run = await client.createRun({
        run_key: runKey.trim(),
        instrument: instrument.trim() || 'telemetry',
        source_path: selectedPaths[0] ?? '',
        source_type: 'telemetry',
        metadata: { created_from: 'PelagiaView telemetry import' }
      });
      runs = [run, ...runs];
      runId = run.id ?? run.run_id ?? '';
      runKey = '';
      message = `Created run ${run.run_key ?? run.id ?? run.run_id ?? runId}.`;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      creatingRun = false;
    }
  }

  function watchJob(jobId: string) {
    if (jobTimer !== null) window.clearInterval(jobTimer);
    void refreshJob(jobId);
    jobTimer = window.setInterval(() => void refreshJob(jobId), 2500);
  }

  async function refreshJob(jobId: string) {
    const client = getClient();
    if (!client) return;
    try {
      queuedJob = await client.getJob(jobId);
      const status = queuedJob.status ?? 'unknown';
      if (status === 'succeeded') {
        message = 'Telemetry import completed successfully.';
        if (jobTimer !== null) window.clearInterval(jobTimer);
        jobTimer = null;
      } else if (['failed', 'dead_lettered', 'cancelled'].includes(status)) {
        jobError = queuedJob.error_message ?? 'Telemetry import did not complete successfully.';
        message = null;
        if (jobTimer !== null) window.clearInterval(jobTimer);
        jobTimer = null;
      }
    } catch (cause) {
      jobError = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function retryImport() {
    const client = getClient();
    if (!client || !queuedJob) return;
    try {
      importing = true;
      jobError = null;
      queuedJob = await client.retryJob(queuedJob.id);
      message = 'Telemetry import retry queued.';
      watchJob(queuedJob.id);
    } catch (cause) {
      jobError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      importing = false;
    }
  }

  function formatNumber(value: number | null | undefined): string {
    return value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: 3 });
  }

  function numericProgressValue(value: number | string | null | undefined): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function jobProgressPercent(job: Job | null): number | null {
    if (!job) return null;
    if (job.status === 'succeeded') return 100;
    const percent = numericProgressValue(job.progress?.percent);
    return percent === null ? null : Math.max(0, Math.min(100, percent));
  }

  function jobStatusLabel(status: string): string {
    return {
      queued: 'Awaiting worker',
      leased: 'Starting import',
      working: 'Import in progress',
      paused: 'Import paused',
      succeeded: 'Import complete',
      failed: 'Import failed',
      dead_lettered: 'Import stopped after retries',
      cancelled: 'Import cancelled'
    }[status] ?? 'Import status unavailable';
  }
</script>

<div class="telemetry-page">
  <header class="page-heading">
    <div>
      <p class="eyebrow">Workflow · Sensor data</p>
      <h1>Import telemetry</h1>
      <p>Select a server-side sensor file, verify its time base, map columns to Pelagia vocabulary, and queue a traceable import.</p>
    </div>
    <span class="stage-pill">telemetry_import</span>
  </header>

  {#if loading}<p class="notice">Loading telemetry vocabulary and available runs…</p>{/if}
  {#if error}<p class="notice error" role="alert">{error}</p>{/if}
  {#if message}<p class="notice success" role="status">{message}{#if queuedJob} <span>Job: {queuedJob.id}</span>{/if}</p>{/if}
  {#if jobError}<p class="notice error" role="alert">{jobError} {#if queuedJob}<button class="inline-button" type="button" on:click={retryImport} disabled={importing}>{importing ? 'Retrying…' : 'Retry import'}</button>{/if}</p>{/if}

  {#if queuedJob}
    <section class="card ingestion-status" class:status-failed={['failed', 'dead_lettered', 'cancelled'].includes(importStatus)} class:status-success={importStatus === 'succeeded'} aria-live="polite" aria-label="Telemetry ingestion status">
      <div class="status-header">
        <div>
          <p class="eyebrow">Ingestion status</p>
          <h2>{importStatusLabel}</h2>
          <p class="status-message">{importProgressMessage}</p>
        </div>
        <span class:good={importStatus === 'succeeded'} class:bad={['failed', 'dead_lettered', 'cancelled'].includes(importStatus)} class="status-pill">{queuedJob.status ?? 'unknown'}</span>
      </div>
      <div class="progress-row">
        <div class:indeterminate={importPercent === null && importIsActive} class="progress-track" role="progressbar" aria-label="Telemetry ingestion progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={importPercent ?? undefined}><i style={`width:${importPercent ?? (importIsActive ? 32 : 0)}%`}></i></div>
        <strong>{importPercent === null ? (importIsActive ? 'Working' : '—') : `${Math.round(importPercent)}%`}</strong>
      </div>
      <div class="status-metadata">
        {#if importCompleted !== null || importTotal !== null}<span><small>Progress</small><b>{formatNumber(importCompleted)} / {formatNumber(importTotal)} {queuedJob.progress?.unit ?? 'units'}</b></span>{/if}
        {#if importRate !== null}<span><small>Rate</small><b>{formatNumber(importRate)} {queuedJob.progress?.unit ?? 'units'} / s</b></span>{/if}
        <span><small>Job</small><b title={queuedJob.id}>{queuedJob.id}</b></span>
        {#if queuedJob.worker_id}<span><small>Worker</small><b>{queuedJob.worker_id}</b></span>{/if}
      </div>
    </section>
  {/if}

  <section class="card step-card">
    <div class="step-title"><span>1</span><div><h2>Select and analyze a file</h2><p>Pelagia reads the server file and returns a bounded preview; the browser never reads backend storage directly.</p></div></div>
    <FileSelector mode="wizard" multiSelect={false} selectableKinds={['file']} initialPath={currentPath} {selectedPaths} {loadDirectory} onSelectionChange={selectFile} onPathChange={(path) => currentPath = path} label="Sensor files" />
    <div class="form-grid compact-grid">
      <label>Timestamp column<input bind:value={timestampColumn} placeholder="Auto-detect (Time, timestamp…)" /></label>
      <label>Timestamp format<select bind:value={timestampFormat}><option value="auto">Auto-detect</option><option value="unix_seconds">Unix seconds</option><option value="unix_milliseconds">Unix milliseconds</option><option value="iso8601">ISO 8601</option></select></label>
      <label>Source timezone<input bind:value={sourceTimezone} /></label>
      <label>Delimiter<input maxlength="1" bind:value={delimiter} /></label>
    </div>
    <div class="action-row"><span class="path-label">{selectedPaths[0] ?? 'No file selected'}</span><button type="button" disabled={!selectedPaths[0] || analyzing} on:click={analyze}>{analyzing ? 'Analyzing…' : 'Analyze file'}</button></div>
  </section>

  {#if analysis}
    <section class="card step-card">
      <div class="step-title"><span>2</span><div><h2>Verify timestamps and preview values</h2><p>{analysis.filename} · {formatNumber(analysis.row_count)} rows · parsed as {analysis.timestamp_format ?? timestampFormat}</p></div><span class:good={diagnostics?.valid} class:bad={!diagnostics?.valid} class="status-pill">{diagnostics?.valid ? 'Timestamp valid' : 'Review required'}</span></div>
      <div class="metrics"><div><small>UTC start</small><strong>{analysis.time_range?.start ?? '—'}</strong></div><div><small>UTC end</small><strong>{analysis.time_range?.end ?? '—'}</strong></div><div><small>Median interval</small><strong>{formatNumber(analysis.sampling?.median_interval_seconds)} s</strong></div><div><small>Duplicates / order</small><strong>{diagnostics?.duplicate_count ?? 0} / {diagnostics?.non_monotonic_count ?? 0}</strong></div></div>
      {#if !diagnostics?.valid}<p class="warning">Fix the timestamp format, timezone, or source file before importing. Invalid rows: {diagnostics?.invalid_count ?? 0}; duplicate timestamps: {diagnostics?.duplicate_count ?? 0}; out-of-order timestamps: {diagnostics?.non_monotonic_count ?? 0}.</p>{/if}
      <div class="quality-grid">{#each columnQuality as stat}<div><strong>{stat.column}</strong><span>{stat.missing ?? 0} missing · {stat.invalid_numeric ?? 0} invalid</span></div>{/each}</div>
      <div class="preview-grid">
        <div class="chart-panel"><div class="panel-heading"><h3>Value preview</h3><select bind:value={selectedChartColumn} aria-label="Preview column">{#each numericColumns as column}<option value={column}>{column}</option>{/each}</select></div>{#if chartPoints}<svg viewBox="0 0 100 100" role="img" aria-label={`Preview of ${chartColumn}`}><line x1="0" y1="92" x2="100" y2="92" /><polyline points={chartPoints} /></svg><div class="chart-caption">{chartColumn}: {formatNumber(chartMin)}–{formatNumber(chartMax)}</div>{:else}<p class="empty">No numeric preview values available.</p>{/if}</div>
        <div class="table-wrap"><table><thead><tr><th>Row</th><th>UTC timestamp</th><th>Values</th></tr></thead><tbody>{#each (analysis.preview_rows ?? []).slice(0, 8) as row}<tr><td>{row.row}</td><td>{row.timestamp ?? 'Invalid'}</td><td>{Object.entries(row.values ?? {}).slice(0, 3).map(([key, value]) => `${key}: ${value ?? '—'}`).join(' · ')}</td></tr>{/each}</tbody></table></div>
      </div>
    </section>

    <section class="card step-card">
      <div class="step-title"><span>3</span><div><h2>Map columns and configure lookup</h2><p>Suggestions are based on column names only. Confirm units explicitly because this CSV does not declare them.</p></div></div>
      <div class="form-grid compact-grid"><label>Target run<select bind:value={runId}><option value="">Select a run</option>{#each runs as run}<option value={run.id ?? run.run_id ?? ''}>{run.run_key ?? run.id ?? run.run_id} · {run.source_type ?? 'run'}</option>{/each}</select></label><label>Or enter run ID<input bind:value={runId} placeholder="Existing run UUID" /></label><label>Collection<input bind:value={collection} /></label><label>Sensor key<input bind:value={sensorKey} on:change={() => mappings = mappings.map((mapping) => ({ ...mapping, sensorKey, streamKey: `${sensorKey}.${mapping.parameterKey}` }))} /></label></div>
      <div class="new-run-row"><label>New run key<input bind:value={runKey} placeholder="survey-2026-telemetry" /></label><label>Instrument<input bind:value={instrument} /></label><button type="button" disabled={!runKey.trim() || creatingRun} on:click={createRun}>{creatingRun ? 'Creating run…' : 'Create telemetry run'}</button><p>Creates a project-scoped empty run for this sensor source.</p></div>
      <div class="mapping-table"><div class="mapping-row mapping-head"><span>Source column</span><span>Parameter</span><span>Native unit</span><span>Canonical unit</span><span>Stream key</span><span>Interpolation</span></div>{#each mappings as mapping, index}<div class="mapping-row" class:invalid-row={!isValidMapping(mapping)}><strong>{mapping.column}</strong><select value={mapping.parameterKey} on:change={(event) => applyParameter(index, (event.currentTarget as HTMLSelectElement).value)}>{#each parameterOptions as parameter}<option value={parameter.key}>{parameter.label} · {parameter.key}</option>{/each}</select><select value={mapping.nativeUnit} on:change={(event) => updateMapping(index, { nativeUnit: (event.currentTarget as HTMLSelectElement).value })}><option value="">Select</option>{#each units as unit}<option value={unit.canonical_unit}>{unit.canonical_unit}</option>{/each}</select><select value={mapping.canonicalUnit} on:change={(event) => updateMapping(index, { canonicalUnit: (event.currentTarget as HTMLSelectElement).value })}><option value="">Select</option>{#each units as unit}<option value={unit.canonical_unit}>{unit.canonical_unit}</option>{/each}</select><input value={mapping.streamKey} on:input={(event) => updateMapping(index, { streamKey: (event.currentTarget as HTMLInputElement).value })} /><select value={mapping.interpolation} on:change={(event) => updateMapping(index, { interpolation: (event.currentTarget as HTMLSelectElement).value })}>{#each (catalog?.interpolation_methods ?? ['none', 'linear', 'nearest', 'previous']) as method}<option value={method}>{method}</option>{/each}</select></div><div class="mapping-detail"><label>Display name<input value={mapping.displayName} on:input={(event) => updateMapping(index, { displayName: (event.currentTarget as HTMLInputElement).value })} /></label><label>QC column<select value={mapping.qcColumn} on:change={(event) => updateMapping(index, { qcColumn: (event.currentTarget as HTMLSelectElement).value })}><option value="">None</option>{#each (analysis.columns ?? []).filter((column) => column !== analysis?.timestamp_column) as column}<option value={column}>{column}</option>{/each}</select></label><label>Excluded QC flags<input value={mapping.excludedQcFlags} placeholder="3, 4" on:input={(event) => updateMapping(index, { excludedQcFlags: (event.currentTarget as HTMLInputElement).value })} /></label><label>Max gap seconds<input type="number" min="0" value={mapping.maxGapSeconds} placeholder={mapping.interpolation === 'none' ? 'Not needed' : 'Required'} on:input={(event) => updateMapping(index, { maxGapSeconds: (event.currentTarget as HTMLInputElement).value })} /></label><label>Sampling rate Hz<input type="number" min="0" value={mapping.samplingRateHz} on:input={(event) => updateMapping(index, { samplingRateHz: (event.currentTarget as HTMLInputElement).value })} /></label><label>Priority<input type="number" min="0" value={mapping.priority} on:input={(event) => updateMapping(index, { priority: (event.currentTarget as HTMLInputElement).value })} /></label><label class="checkbox-label"><input type="checkbox" checked={mapping.isDefault} on:change={(event) => updateMapping(index, { isDefault: (event.currentTarget as HTMLInputElement).checked })} /> Default stream for parameter</label><label>Sensor display name<input value={mapping.sensorDisplayName} on:input={(event) => updateMapping(index, { sensorDisplayName: (event.currentTarget as HTMLInputElement).value })} /></label><label>Manufacturer<input value={mapping.manufacturer} on:input={(event) => updateMapping(index, { manufacturer: (event.currentTarget as HTMLInputElement).value })} /></label><label>Model<input value={mapping.model} on:input={(event) => updateMapping(index, { model: (event.currentTarget as HTMLInputElement).value })} /></label><label>Serial number<input value={mapping.serialNumber} on:input={(event) => updateMapping(index, { serialNumber: (event.currentTarget as HTMLInputElement).value })} /></label>{#if !unitCompatible(mapping)}<p class="field-error">Native and canonical units must share a dimension.</p>{/if}{#if mapping.interpolation !== 'none' && !mapping.maxGapSeconds}<p class="field-error">A positive maximum gap is required for interpolation.</p>{/if}</div>{/each}</div>
      <div class="advanced-grid"><label>Parser name<input bind:value={parserName} /></label><label>Parser version<input bind:value={parserVersion} /></label><p>Unit registry: {catalog?.unit_registry?.name ?? 'Pelagia'} v{catalog?.unit_registry?.version ?? '—'}. Ingestion remains blocked until timestamps and required mappings are valid.</p></div>
    </section>

    <section class="card review-card"><div><p class="eyebrow">Final review</p><h2>Queue telemetry import</h2><p>{mappings.length} stream{mappings.length === 1 ? '' : 's'} will be imported into run <strong>{runId || 'not selected'}</strong>. The raw source and mapping provenance will be preserved.</p></div><button type="button" disabled={!canImport || importing || Boolean(queuedJob)} on:click={importData}>{importing ? 'Queueing…' : queuedJob ? `Import ${queuedJob.status ?? 'queued'}` : 'Queue import'}</button></section>
  {/if}
</div>

<style>
  .telemetry-page { max-width: 1180px; margin: 0 auto; padding: 1.5rem clamp(1rem, 3vw, 2.5rem) 3rem; }
  .page-heading, .step-title, .action-row, .panel-heading, .review-card { display: flex; justify-content: space-between; gap: 1rem; }
  .page-heading { align-items: flex-start; margin-bottom: 1.25rem; } h1, h2, h3, p { margin: 0; } h1 { margin-top: .15rem; } h2 { font-size: 1.05rem; } h3 { font-size: .9rem; }
  .page-heading p:last-child, .step-title p, .review-card p:last-child { margin-top: .35rem; color: var(--muted, #66777b); }
  .eyebrow { color: var(--accent, #197997); font-size: .7rem; font-weight: 750; letter-spacing: .09em; text-transform: uppercase; }
  .stage-pill, .status-pill { padding: .3rem .55rem; border-radius: 999px; background: color-mix(in srgb, var(--accent, #197997) 12%, transparent); color: var(--accent, #197997); font-size: .72rem; font-weight: 750; white-space: nowrap; }
  .status-pill.good { background: color-mix(in srgb, #23865e 14%, transparent); color: #23865e; } .status-pill.bad { background: color-mix(in srgb, #b44343 12%, transparent); color: #b44343; }
  .card { margin-top: 1rem; padding: 1rem; border: 1px solid var(--border, #d9e1e3); border-radius: 12px; background: var(--surface, #fff); box-shadow: 0 .25rem 1rem rgb(20 40 45 / 4%); }
  .step-title { align-items: flex-start; margin-bottom: 1rem; } .step-title > span:first-child { display: grid; flex: 0 0 1.7rem; height: 1.7rem; place-items: center; border-radius: 50%; background: var(--accent, #197997); color: #fff; font-weight: 750; }
  .step-title > div { flex: 1; } .notice { margin: 1rem 0; padding: .75rem .9rem; border-radius: 8px; background: color-mix(in srgb, var(--accent, #197997) 8%, transparent); } .notice.error, .warning { background: color-mix(in srgb, #b44343 10%, transparent); color: #9d3333; } .notice.success { background: color-mix(in srgb, #23865e 10%, transparent); color: #1f704e; } .inline-button { margin-left: .5rem; padding: .3rem .5rem; font-size: .75rem; }
  .form-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .75rem; } label { display: grid; gap: .3rem; color: var(--muted, #66777b); font-size: .75rem; font-weight: 700; } input, select { min-width: 0; width: 100%; box-sizing: border-box; padding: .55rem .6rem; border: 1px solid var(--border, #cbd7da); border-radius: 6px; background: var(--surface, #fff); color: inherit; font: inherit; font-weight: 500; }
  .action-row { align-items: center; margin-top: .9rem; } .path-label { min-width: 0; overflow: hidden; color: var(--muted, #66777b); text-overflow: ellipsis; white-space: nowrap; } button { padding: .6rem .85rem; border: 0; border-radius: 7px; background: var(--accent, #197997); color: #fff; cursor: pointer; font: inherit; font-weight: 750; } button:disabled { cursor: not-allowed; opacity: .5; }
  .ingestion-status { display: grid; gap: .8rem; border-left: 4px solid var(--accent, #197997); } .ingestion-status.status-success { border-left-color: #23865e; } .ingestion-status.status-failed { border-left-color: #b44343; } .status-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; } .status-message { margin-top: .3rem; color: var(--muted, #66777b); font-size: .82rem; } .progress-row { display: grid; grid-template-columns: minmax(0, 1fr) 4.5rem; gap: .75rem; align-items: center; } .progress-row > strong { font-size: .8rem; text-align: right; } .progress-track { height: .55rem; overflow: hidden; border-radius: 99px; background: color-mix(in srgb, var(--border, #d9e1e3) 75%, transparent); } .progress-track i { display: block; height: 100%; border-radius: inherit; background: var(--accent, #197997); transition: width .3s ease; } .status-success .progress-track i { background: #23865e; } .status-failed .progress-track i { background: #b44343; } .progress-track.indeterminate i { width: 35% !important; animation: telemetry-progress 1.35s ease-in-out infinite; } .status-metadata { display: flex; flex-wrap: wrap; gap: .8rem 1.5rem; } .status-metadata span { display: grid; min-width: 0; gap: .15rem; } .status-metadata small { color: var(--muted, #66777b); font-size: .66rem; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; } .status-metadata b { max-width: 22rem; overflow: hidden; font-size: .76rem; text-overflow: ellipsis; white-space: nowrap; } @keyframes telemetry-progress { 0% { transform: translateX(-110%); } 100% { transform: translateX(310%); } }
  .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: .6rem; } .metrics div { display: grid; gap: .2rem; padding: .65rem; border-radius: 7px; background: color-mix(in srgb, var(--surface, #fff) 92%, var(--border, #d9e1e3)); } small { color: var(--muted, #66777b); } .metrics strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .quality-grid { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: .8rem; } .quality-grid div { display: grid; gap: .15rem; padding: .45rem .6rem; border-radius: 6px; background: color-mix(in srgb, var(--surface, #fff) 92%, var(--border, #d9e1e3)); font-size: .72rem; } .quality-grid span { color: var(--muted, #66777b); }
  .warning { margin: .8rem 0 0; padding: .65rem; border-radius: 7px; font-size: .8rem; } .preview-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 1rem; margin-top: 1rem; } .chart-panel, .table-wrap { min-width: 0; padding: .75rem; border: 1px solid var(--border, #d9e1e3); border-radius: 8px; } svg { display: block; width: 100%; height: 190px; margin-top: .7rem; background: linear-gradient(to bottom, transparent 49%, color-mix(in srgb, var(--border, #ccd9dc) 60%, transparent) 50%, transparent 51%); } svg line { stroke: var(--border, #ccd9dc); } polyline { fill: none; stroke: var(--accent, #197997); stroke-width: 1.5; vector-effect: non-scaling-stroke; } .chart-caption { color: var(--muted, #66777b); font-size: .75rem; }
  .table-wrap { overflow: auto; } table { width: 100%; border-collapse: collapse; font-size: .75rem; } th, td { padding: .45rem; border-bottom: 1px solid var(--border, #e1e8e9); text-align: left; vertical-align: top; } th { color: var(--muted, #66777b); font-size: .68rem; text-transform: uppercase; }
  .mapping-table { overflow-x: auto; border: 1px solid var(--border, #d9e1e3); border-radius: 8px; } .mapping-row { display: grid; grid-template-columns: 1.1fr 1.2fr .8fr .8fr 1.2fr .8fr; min-width: 850px; gap: .5rem; align-items: center; padding: .5rem .6rem; border-bottom: 1px solid var(--border, #e1e8e9); } .mapping-row:last-child { border-bottom: 0; } .mapping-head { color: var(--muted, #66777b); font-size: .68rem; font-weight: 750; text-transform: uppercase; } .mapping-row strong { overflow: hidden; text-overflow: ellipsis; } .invalid-row { background: color-mix(in srgb, #b44343 5%, transparent); } .mapping-detail { display: grid; grid-template-columns: repeat(4, minmax(150px, 1fr)); gap: .6rem; min-width: 850px; padding: .7rem .6rem .85rem; border-bottom: 1px solid var(--border, #e1e8e9); } .mapping-detail label { font-size: .7rem; } .checkbox-label { display: flex; align-items: center; gap: .4rem; } .checkbox-label input { width: auto; } .field-error { grid-column: 1 / -1; color: #9d3333; font-size: .75rem; }
  .advanced-grid { display: grid; grid-template-columns: 1fr 1fr 2fr; gap: .75rem; align-items: end; margin-top: .8rem; } .advanced-grid p { color: var(--muted, #66777b); font-size: .78rem; } .review-card { align-items: center; } .empty { padding: 4rem 1rem; color: var(--muted, #66777b); text-align: center; }
  .new-run-row { display: grid; grid-template-columns: 1.3fr .8fr auto 2fr; gap: .75rem; align-items: end; margin: .8rem 0; padding: .75rem; border: 1px dashed var(--border, #cbd7da); border-radius: 8px; } .new-run-row p { color: var(--muted, #66777b); font-size: .75rem; }
  @media (max-width: 820px) { .form-grid, .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } .preview-grid, .advanced-grid, .new-run-row { grid-template-columns: 1fr; } .page-heading, .review-card, .status-header { align-items: flex-start; flex-direction: column; } }
  @media (max-width: 520px) { .form-grid, .metrics { grid-template-columns: 1fr; } .telemetry-page { padding-inline: .75rem; } }
</style>
