<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { getClient } from '$lib/stores/session';
  import { listProcessingPresets } from '$lib/api/processingPresets';
  import type {
    CollectionSummary,
    JobSeriesEligibility,
    JobSeriesFailurePolicy,
    JobSeriesRequest,
    RawAsset
  } from '$lib/api/types';
  import type { ProcessingPreset } from '$lib/processing/settings';
  import { formatCount, numericValue } from '$lib/utils/format';
  import { dashboardViewHref } from '$lib/utils/dashboardNavigation';

  const availableStages = [
    { stage: 'preprocess_frames', label: 'Preprocess frames' },
    { stage: 'segment', label: 'Detect candidate ROIs' },
    { stage: 'roi_refinement', label: 'Refine ROIs' }
  ];

  let assets: RawAsset[] = [];
  let collections: CollectionSummary[] = [];
  let presets: ProcessingPreset[] = [];
  let selectedAssetIds = new Set<string>();
  let selectedCollections = new Set<string>();
  let targetMode: 'assets' | 'collections' | 'frames' = 'assets';
  let enabledStages = new Set(availableStages.map(({ stage }) => stage));
  let assetSearch = '';
  let collectionSearch = '';
  let frameIdsText = '';
  let startFrame: number | null = null;
  let endFrame: number | null = null;
  let selectedPresetKey = '';
  let priority = 0;
  let failurePolicy: JobSeriesFailurePolicy = 'fail_fast';
  let dryRun = false;
  let eligibility: JobSeriesEligibility | null = null;
  let loading = true;
  let previewing = false;
  let submitting = false;
  let error: string | null = null;
  let message: string | null = null;

  $: selectedPreset = presets.find((preset) => `${preset.source}:${preset.id}` === selectedPresetKey) ?? null;
  $: selectedFrameIds = uniqueValues(frameIdsText);
  $: request = buildRequest();
  $: filteredAssets = filterAssets(assets, assetSearch);
  $: filteredCollections = collections.filter((item) => item.collection.toLowerCase().includes(collectionSearch.trim().toLowerCase()));
  $: hasExplicitTarget = targetMode === 'assets'
    ? selectedAssetIds.size > 0
    : targetMode === 'collections'
      ? selectedCollections.size > 0
      : selectedFrameIds.length > 0;
  $: selectedTargetCount = targetMode === 'assets' ? selectedAssetIds.size : targetMode === 'collections' ? selectedCollections.size : selectedFrameIds.length;
  $: selectedStageList = availableStages.filter(({ stage }) => enabledStages.has(stage));

  onMount(() => {
    void loadBuilderData();
  });

  async function loadBuilderData() {
    const client = getClient();
    if (!client) {
      loading = false;
      error = 'Connect to Pelagia before building a job series.';
      return;
    }
    loading = true;
    error = null;
    try {
      const [nextAssets, nextCollections, nextPresets] = await Promise.all([
        client.listAssets(undefined, 10000),
        client.listCollections(500),
        listProcessingPresets().catch(() => [])
      ]);
      assets = nextAssets;
      collections = nextCollections;
      presets = nextPresets;
    } catch (err) {
      error = errorMessage(err);
    } finally {
      loading = false;
    }
  }

  function buildRequest(): JobSeriesRequest {
    return {
      targets: {
        asset_ids: targetMode === 'assets' ? [...selectedAssetIds] : [],
        collections: targetMode === 'collections' ? [...selectedCollections] : [],
        frame_ids: targetMode === 'frames' ? selectedFrameIds : [],
        start_frame: targetMode === 'frames' ? null : startFrame,
        end_frame: targetMode === 'frames' ? null : endFrame
      },
      preset_snapshot: selectedPreset
        ? {
            preset_id: selectedPreset.id,
            preset_name: selectedPreset.name,
            source: selectedPreset.source,
            captured_at: new Date().toISOString(),
            settings: selectedPreset.settings
          }
        : {},
      steps: availableStages.map(({ stage }) => ({ stage, enabled: enabledStages.has(stage) })),
      priority,
      failure_policy: failurePolicy,
      dry_run: dryRun
    };
  }

  function toggleAsset(assetId: string) {
    selectedAssetIds = toggleSet(selectedAssetIds, assetId);
    eligibility = null;
  }

  function toggleCollection(collection: string) {
    selectedCollections = toggleSet(selectedCollections, collection);
    eligibility = null;
  }

  function filterAssets(values: RawAsset[], query: string): RawAsset[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return values;
    return values.filter((asset) => [assetLabel(asset), asset.kind, ...(asset.collections ?? [])].filter(Boolean).join(' ').toLowerCase().includes(normalized));
  }

  function selectTargetMode(mode: 'assets' | 'collections' | 'frames') {
    targetMode = mode;
    eligibility = null;
  }

  function toggleStage(stage: string) {
    const next = toggleSet(enabledStages, stage);
    if (next.size) enabledStages = next;
    eligibility = null;
  }

  function clearTargets() {
    selectedAssetIds = new Set();
    selectedCollections = new Set();
    frameIdsText = '';
    startFrame = null;
    endFrame = null;
    eligibility = null;
  }

  async function preview() {
    const client = getClient();
    if (!client || previewing || !canSubmit()) return;
    previewing = true;
    error = null;
    message = null;
    try {
      eligibility = await client.previewJobSeries({ ...request, dry_run: true });
      message = 'Eligibility preview refreshed. No jobs were submitted.';
    } catch (err) {
      error = errorMessage(err);
    } finally {
      previewing = false;
    }
  }

  async function submit() {
    const client = getClient();
    if (!client || submitting || !canSubmit()) return;
    submitting = true;
    error = null;
    message = null;
    try {
      const response = await client.submitJobSeries(request);
      eligibility = response.eligibility ?? eligibility;
      if (response.dry_run || dryRun) {
        message = 'Dry run completed. No jobs were submitted.';
      } else if (response.series?.id) {
        const monitorUrl = new URL(dashboardViewHref('job_series_monitor', $page.url), $page.url.origin);
        monitorUrl.searchParams.set('series', response.series.id);
        await goto(`${monitorUrl.pathname}${monitorUrl.search}${monitorUrl.hash}`);
      } else {
        message = 'Series submitted. Open Series Monitor to follow its progress.';
      }
    } catch (err) {
      error = errorMessage(err);
    } finally {
      submitting = false;
    }
  }

  function uniqueValues(value: string): string[] {
    return [...new Set(value.split(/[\n,\s]+/).map((item) => item.trim()).filter(Boolean))];
  }

  function canSubmit(): boolean {
    return Boolean(selectedPreset && hasExplicitTarget && selectedStageList.length);
  }

  function toggleSet(values: Set<string>, value: string): Set<string> {
    const next = new Set(values);
    next.has(value) ? next.delete(value) : next.add(value);
    return next;
  }

  function assetLabel(asset: RawAsset): string {
    return asset.filename ?? asset.path ?? asset.id;
  }

  function errorMessage(value: unknown): string {
    return value instanceof Error ? value.message : String(value);
  }
</script>

<section class="job-series-page">
  <header class="series-hero">
    <div>
      <p class="eyebrow">Workflow / Job series</p>
      <h1>Build processing series</h1>
      <p class="hero-copy">Run the established processing path without shepherding data between stages. Pelagia advances each selected stage in canonical order.</p>
    </div>
    <div class="hero-status"><span class="status-dot"></span><span>Draft</span><small>{selectedTargetCount} target{selectedTargetCount === 1 ? '' : 's'}</small></div>
  </header>

  <nav class="builder-progress" aria-label="Job series builder steps">
    <a class="active" href="#targets"><span>01</span><strong>Source</strong><small>Choose one scope</small></a>
    <a href="#stages"><span>02</span><strong>Pipeline</strong><small>Choose ordered stages</small></a>
    <a href="#submit"><span>03</span><strong>Review & submit</strong><small>Validate before queueing</small></a>
  </nav>

  {#if error}<p class="form-error" role="alert">{error}</p>{/if}
  {#if message}<p class="form-success" role="status">{message}</p>{/if}

  <div class="series-summary" aria-label="Current series summary">
    <div><span>Source scope</span><strong>{selectedTargetCount || 'Required'}</strong><small>{targetMode === 'assets' ? 'specific assets' : targetMode === 'collections' ? 'server-resolved collections' : 'explicit frame IDs'}</small></div>
    <div><span>Preset</span><strong>{selectedPreset?.name ?? 'Required'}</strong><small>{selectedPreset ? `${Object.keys(selectedPreset.settings).length} settings captured` : 'Select a preset to continue'}</small></div>
    <div><span>Pipeline</span><strong>{selectedStageList.length} stage{selectedStageList.length === 1 ? '' : 's'}</strong><small>{selectedStageList.map((step) => step.label).join(' → ') || 'Select at least one stage'}</small></div>
  </div>

  <div class="builder-layout" aria-busy={loading}>
    <main class="builder-main">
      <section id="targets" class="panel workflow-panel">
        <header class="panel-heading series-panel-heading">
          <div class="section-number">01</div>
          <div><p class="eyebrow">Source selection</p><h2>Choose one source scope</h2><p class="soft">Use assets, collections, or explicit frames. Collections stay server-resolved, so large collections are never limited by this page.</p></div>
          <button class="ghost compact-action" type="button" on:click={clearTargets} disabled={!selectedTargetCount}>Clear</button>
        </header>

        <fieldset class="scope-picker">
          <legend>Source scope <span class="required-label">Required</span></legend>
          <label class:chosen={targetMode === 'assets'}><input type="radio" name="target-mode" checked={targetMode === 'assets'} on:change={() => selectTargetMode('assets')} /> Specific assets</label>
          <label class:chosen={targetMode === 'collections'}><input type="radio" name="target-mode" checked={targetMode === 'collections'} on:change={() => selectTargetMode('collections')} /> Collection(s)</label>
          <label class:chosen={targetMode === 'frames'}><input type="radio" name="target-mode" checked={targetMode === 'frames'} on:change={() => selectTargetMode('frames')} /> Explicit frame IDs</label>
        </fieldset>

        {#if targetMode === 'assets'}
        <div class="target-toolbar">
          <label class="search-field"><span>Find assets</span><input bind:value={assetSearch} placeholder="Name, kind, or collection" /></label>
        </div>
          <section class="target-group">
            <div class="group-heading"><h3>Assets</h3><span>{filteredAssets.length} shown</span></div>
            <div class="selection-list asset-list">
              {#each filteredAssets as asset}
                <label class:selected={selectedAssetIds.has(asset.id)} class="selection-row"><input type="checkbox" checked={selectedAssetIds.has(asset.id)} on:change={() => toggleAsset(asset.id)} /><span><strong>{assetLabel(asset)}</strong><small>{asset.kind ?? 'source'} · {formatCount(asset.frame_count ?? 0)} frames</small></span></label>
              {:else}<p class="empty-selection">{assets.length ? 'No assets match this search.' : 'No assets available.'}</p>{/each}
            </div>
          </section>
        {:else if targetMode === 'collections'}
          <div class="target-toolbar">
            <label class="search-field"><span>Find collections</span><input bind:value={collectionSearch} placeholder="Collection name" /></label>
          </div>
          <section class="target-group">
            <div class="group-heading"><h3>Collections</h3><span>{filteredCollections.length} shown</span></div>
            <div class="selection-list collection-list">
              {#each filteredCollections as collection}
                <label class:selected={selectedCollections.has(collection.collection)} class="selection-row"><input type="checkbox" checked={selectedCollections.has(collection.collection)} on:change={() => toggleCollection(collection.collection)} /><span><strong>{collection.collection}</strong><small>{formatCount(collection.asset_count ?? 0)} assets</small></span></label>
              {:else}<p class="empty-selection">{collections.length ? 'No collections match this search.' : 'No collections available.'}</p>{/each}
            </div>
          </section>
        {:else}
        <section class="frame-targets">
          <div class="group-heading"><div><h3>Frame-level targeting</h3><p class="soft">Supply one or more stored frame IDs. This is a precise scope; ranges cannot be used by themselves.</p></div><span class="required-label">Required</span></div>
          <div class="frame-target-grid">
            <label class="wide-field">Explicit frame IDs<textarea bind:value={frameIdsText} on:input={() => eligibility = null} placeholder="One frame ID per line or comma separated"></textarea></label>
          </div>
        </section>
        {/if}

        {#if targetMode !== 'frames'}
          <div class="frame-range"><label>Start frame <span class="optional-label">optional</span><input type="number" bind:value={startFrame} on:input={() => eligibility = null} min="0" placeholder="Any" /></label><label>End frame <span class="optional-label">optional</span><input type="number" bind:value={endFrame} on:input={() => eligibility = null} min="0" placeholder="Any" /></label><p class="soft">Range narrows the selected {targetMode === 'assets' ? 'assets' : 'collections'}; it never creates a project-wide run.</p></div>
        {/if}
        {#if !hasExplicitTarget}<p class="callout required-callout">Choose at least one {targetMode === 'assets' ? 'asset' : targetMode === 'collections' ? 'collection' : 'frame ID'} before checking or submitting this series.</p>{/if}
      </section>

      <section id="stages" class="panel workflow-panel">
        <header class="panel-heading series-panel-heading"><div class="section-number">02</div><div><p class="eyebrow">Ordered execution</p><h2>Choose pipeline stages</h2><p class="soft">Stages are always submitted in Pelagia’s canonical order. Later stages use outputs created by earlier ones where eligible.</p></div></header>
        <div class="stage-picker">{#each availableStages as item, index}<label class:chosen={enabledStages.has(item.stage)}><input type="checkbox" checked={enabledStages.has(item.stage)} on:change={() => toggleStage(item.stage)} disabled={enabledStages.has(item.stage) && enabledStages.size === 1} /><span><strong>{index + 1}. {item.label}</strong><small>{item.stage === 'preprocess_frames' ? 'Prepare selected source frames' : item.stage === 'segment' ? 'Create candidate ROIs from eligible frames' : 'Refine eligible candidate ROIs'}</small></span></label>{/each}</div>
      </section>

    </main>

    <aside class="builder-rail">
      <section id="snapshot" class="panel rail-panel">
        <header class="rail-heading"><div class="section-number">03</div><div><p class="eyebrow">Reproducibility</p><h2>Preset snapshot</h2></div></header>
          <label>Processing preset <span class="required-label">Required</span>
          <select bind:value={selectedPresetKey} on:change={() => eligibility = null}>
            <option value="" disabled>Select a preset…</option>
            {#each presets as preset}<option value={`${preset.source}:${preset.id}`}>{preset.name} · {preset.source}</option>{/each}
          </select>
        </label>
        {#if selectedPreset}
          <details open class="snapshot-details">
            <summary><strong>{Object.keys(selectedPreset.settings).length}</strong> captured setting{Object.keys(selectedPreset.settings).length === 1 ? '' : 's'}<span>View values</span></summary>
            <dl>{#each Object.entries(selectedPreset.settings) as [key, value]}<div><dt>{key}</dt><dd>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd></div>{/each}</dl>
          </details>
        {:else}<p class="callout required-callout">Select a preset to freeze the settings used by this series. A series cannot be checked or submitted without one.</p>{/if}
      </section>

      <section id="submit" class="panel submit-panel">
        <header class="rail-heading"><div class="section-number">04</div><div><p class="eyebrow">Final review</p><h2>Submission policy</h2></div></header>
        <div class="policy-grid">
          <label>Priority<input type="number" bind:value={priority} min="-100" max="100" /></label>
          <label>On failure<select bind:value={failurePolicy}><option value="fail_fast">Stop remaining stages</option><option value="continue">Continue eligible work</option></select></label>
        </div>
        <p class="soft">Failed work is not retried automatically. You can retry failed work from the monitor after reviewing its error.</p>
        <label class="checkbox policy-toggle"><input type="checkbox" bind:checked={dryRun} /><span><strong>Dry run</strong><small>Validate and plan without submitting jobs.</small></span></label>
        <div class="submit-actions"><button class="ghost" type="button" on:click={preview} disabled={loading || previewing || submitting || !canSubmit()}>{previewing ? 'Checking…' : 'Check eligibility'}</button><button type="button" on:click={submit} disabled={loading || previewing || submitting || !canSubmit()}>{submitting ? 'Submitting…' : dryRun ? 'Run dry check' : 'Submit & monitor'}</button></div>
        {#if eligibility}
          <div class="eligibility" aria-live="polite">
            <div class="eligibility-head"><h3>Eligibility</h3><span class="status-pill">Ready to review</span></div>
            <div class="eligibility-counts"><strong>{formatCount(numericValue(eligibility.eligible_count) ?? 0)}</strong><span>eligible units</span><strong>{formatCount(numericValue(eligibility.ineligible_count) ?? 0)}</strong><span>ineligible</span></div>
            {#if eligibility.selected_asset_count !== undefined}<p class="soft">{formatCount(numericValue(eligibility.selected_asset_count) ?? 0)} assets · {formatCount(numericValue(eligibility.selected_frame_count) ?? 0)} frames selected</p>{/if}
            {#each eligibility.by_step ?? [] as row}<p class="soft">{row.stage ?? 'step'}: {formatCount(numericValue(row.eligible_count) ?? 0)} eligible</p>{/each}
          </div>
        {/if}
      </section>
    </aside>
  </div>
</section>

<style>
  .job-series-page { display: grid; gap: 1rem; max-width: 1500px; padding-bottom: 2rem; }
  h1, h2, h3, p { margin: 0; } h1 { font-size: clamp(1.45rem, 2vw, 2rem); letter-spacing: -.025em; } h2 { font-size: 1rem; } h3 { font-size: .84rem; } .soft, small { color: var(--app-muted, #60746c); }
  .series-hero { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; padding: .45rem .25rem .15rem; } .hero-copy { max-width: 46rem; margin-top: .35rem; color: var(--app-muted, #60746c); font-size: .9rem; line-height: 1.45; } .hero-status { display: flex; align-items: center; gap: .45rem; white-space: nowrap; color: var(--app-accent-strong, #115345); font-size: .78rem; font-weight: 850; } .hero-status small { padding-left: .35rem; border-left: 1px solid var(--app-border, #cedbd6); font-weight: 650; }
  .status-dot { width: .5rem; height: .5rem; border-radius: 999px; background: var(--app-accent, #176b58); box-shadow: 0 0 0 .22rem var(--app-accent-soft, #dceee8); }
  .builder-progress { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .35rem; padding: .4rem; border: 1px solid var(--app-border, #cedbd6); border-radius: .7rem; background: var(--app-surface-soft, #f1f6f4); } .builder-progress a { display: grid; grid-template-columns: auto 1fr; column-gap: .55rem; align-items: center; min-width: 0; border-radius: .45rem; padding: .58rem .7rem; color: var(--app-muted, #60746c); text-decoration: none; } .builder-progress a:hover, .builder-progress a.active { color: var(--app-accent-strong, #115345); background: var(--app-surface-raised, #fff); box-shadow: 0 .2rem .7rem rgba(24, 49, 41, .06); } .builder-progress span { grid-row: span 2; color: var(--app-accent, #176b58); font-size: .68rem; font-weight: 900; } .builder-progress strong { font-size: .78rem; } .builder-progress small { font-size: .68rem; }
  .series-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: .65rem; } .series-summary > div { display: grid; gap: .15rem; min-width: 0; padding: .7rem .8rem; border: 1px solid var(--app-border-soft, #dde7e3); border-radius: .55rem; background: var(--app-surface-raised, #fff); } .series-summary span { color: var(--app-muted, #60746c); font-size: .68rem; font-weight: 850; text-transform: uppercase; letter-spacing: .055em; } .series-summary strong { overflow: hidden; color: var(--app-text, #17201b); font-size: 1.15rem; text-overflow: ellipsis; white-space: nowrap; } .series-summary > div > small { overflow: hidden; font-size: .7rem; text-overflow: ellipsis; white-space: nowrap; }
  .builder-layout { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(20rem, .72fr); gap: 1rem; align-items: start; } .builder-main, .builder-rail { display: grid; gap: 1rem; min-width: 0; } .builder-rail { position: sticky; top: .5rem; } .panel { display: grid; gap: 1rem; padding: 1rem; border: 1px solid var(--app-border, #cedbd6); border-radius: .7rem; background: var(--app-surface-raised, #fff); box-shadow: 0 .25rem 1rem rgba(24, 49, 41, .045); } .workflow-panel { gap: 1.15rem; }
  .panel-heading, .series-panel-heading, .rail-heading { display: grid; grid-template-columns: 2rem minmax(0, 1fr) auto; gap: .7rem; align-items: start; } .rail-heading { grid-template-columns: 2rem minmax(0, 1fr); } .series-panel-heading .soft { margin-top: .25rem; font-size: .77rem; line-height: 1.35; } .section-number { display: grid; width: 1.85rem; height: 1.85rem; place-items: center; border: 1px solid var(--app-border, #cedbd6); border-radius: .5rem; color: var(--app-accent-strong, #115345); background: var(--app-accent-soft, #dceee8); font-size: .68rem; font-weight: 900; }
  .target-toolbar { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .65rem; padding: .7rem; border: 1px solid var(--app-border-soft, #dde7e3); border-radius: .55rem; background: var(--app-surface-soft, #f1f6f4); } label { display: grid; gap: .35rem; color: var(--app-text, #17201b); font-size: .76rem; font-weight: 750; } label > span:first-child { color: var(--app-muted, #60746c); font-size: .68rem; font-weight: 850; text-transform: uppercase; letter-spacing: .045em; } input, select, textarea { width: 100%; box-sizing: border-box; border: 1px solid var(--app-border, #cedbd6); border-radius: .42rem; padding: .55rem .6rem; color: var(--app-text, #17201b); background: var(--app-surface-raised, #fff); font: inherit; } input:focus, select:focus, textarea:focus { outline: 2px solid color-mix(in srgb, var(--app-accent, #176b58) 28%, transparent); outline-offset: 1px; } textarea { min-height: 4.6rem; resize: vertical; }
  .scope-picker, .stage-picker { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .55rem; margin: 0; padding: .7rem; border: 1px solid var(--app-border-soft, #dde7e3); border-radius: .55rem; } .scope-picker legend { padding: 0 .25rem; color: var(--app-muted, #60746c); font-size: .68rem; font-weight: 850; text-transform: uppercase; letter-spacing: .045em; } .scope-picker label, .stage-picker label { display: flex; align-items: flex-start; gap: .5rem; padding: .65rem; border: 1px solid var(--app-border-soft, #dde7e3); border-radius: .45rem; background: var(--app-surface-soft, #f1f6f4); cursor: pointer; } .scope-picker label.chosen, .stage-picker label.chosen { border-color: var(--app-accent, #176b58); background: var(--app-accent-soft, #dceee8); } .scope-picker input, .stage-picker input { width: auto; margin-top: .1rem; } .stage-picker { grid-template-columns: 1fr; } .stage-picker label span { display: grid; gap: .15rem; } .stage-picker small { font-weight: 500; }
  .target-group { display: grid; gap: .55rem; min-width: 0; } .group-heading { display: flex; justify-content: space-between; align-items: baseline; gap: .5rem; } .group-heading > span, .optional-label { color: var(--app-muted, #60746c); font-size: .68rem; font-weight: 750; } .selection-list { display: grid; gap: .3rem; max-height: 19rem; overflow: auto; padding-right: .2rem; } .selection-row { display: flex; align-items: center; gap: .6rem; min-width: 0; border: 1px solid transparent; border-radius: .45rem; padding: .48rem .55rem; background: var(--app-surface-soft, #f1f6f4); cursor: pointer; } .selection-row:hover, .selection-row.selected { border-color: color-mix(in srgb, var(--app-accent, #176b58) 28%, var(--app-border, #cedbd6)); background: var(--app-accent-soft, #dceee8); } .selection-row input { flex: 0 0 auto; width: 1rem; height: 1rem; padding: 0; accent-color: var(--app-accent, #176b58); } .selection-row > span { display: grid; min-width: 0; gap: .12rem; } .selection-row strong, .selection-row small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .selection-row strong { font-size: .76rem; } .selection-row small { font-size: .67rem; } .empty-selection { display: grid; min-height: 4rem; place-items: center; border: 1px dashed var(--app-border, #cedbd6); border-radius: .45rem; color: var(--app-muted, #60746c); font-size: .75rem; text-align: center; }
  .frame-targets { display: grid; gap: .7rem; border-top: 1px solid var(--app-border-soft, #dde7e3); padding-top: 1rem; } .frame-target-grid { display: grid; grid-template-columns: 1fr 8rem 8rem; gap: .65rem; align-items: end; } .wide-field { min-width: 0; }
  .frame-range { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .65rem; padding-top: .2rem; } .frame-range .soft { grid-column: 1 / -1; font-size: .72rem; }
  .compact-action { min-height: 1.8rem; padding: .25rem .45rem; font-size: .75rem; }
  .snapshot-details { border-top: 1px solid var(--app-border-soft, #dde7e3); padding-top: .75rem; } .snapshot-details summary { display: flex; justify-content: space-between; cursor: pointer; color: var(--app-text, #17201b); font-size: .75rem; } .snapshot-details summary span { color: var(--app-accent-strong, #115345); font-size: .68rem; } dl { display: grid; gap: .35rem; margin: .7rem 0 0; max-height: 12rem; overflow: auto; } dl div { display: grid; grid-template-columns: minmax(0, .85fr) minmax(0, 1.15fr); gap: .6rem; padding-bottom: .3rem; border-bottom: 1px solid var(--app-border-soft, #dde7e3); font-size: .7rem; } dt { overflow-wrap: anywhere; color: var(--app-muted, #60746c); font-weight: 750; } dd { margin: 0; overflow-wrap: anywhere; } .callout { padding: .7rem; border-left: 3px solid var(--app-accent, #176b58); border-radius: .3rem; color: var(--app-muted, #60746c); background: var(--app-surface-soft, #f1f6f4); font-size: .75rem; line-height: 1.4; } .required-label { margin-left: auto; color: var(--app-danger, #a23c34); font-size: .65rem; font-weight: 850; text-transform: uppercase; } .required-callout { border-left-color: var(--app-danger, #a23c34); }
  .submit-panel { border-color: color-mix(in srgb, var(--app-accent, #176b58) 25%, var(--app-border, #cedbd6)); } .policy-grid { display: grid; grid-template-columns: 6rem minmax(0, 1fr); gap: .65rem; } .policy-toggle { display: flex; align-items: flex-start; gap: .55rem; padding: .7rem; border: 1px solid var(--app-border-soft, #dde7e3); border-radius: .45rem; background: var(--app-surface-soft, #f1f6f4); } .policy-toggle input { flex: 0 0 auto; width: 1rem; height: 1rem; padding: 0; accent-color: var(--app-accent, #176b58); } .policy-toggle span { display: grid; gap: .15rem; } .policy-toggle small { font-size: .68rem; font-weight: 500; } .submit-actions { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; } .submit-actions button { min-height: 2.35rem; }
  .eligibility { display: grid; gap: .55rem; border-top: 1px solid var(--app-border-soft, #dde7e3); padding-top: .85rem; } .eligibility-head { display: flex; justify-content: space-between; align-items: center; gap: .5rem; } .eligibility-head h3 { font-size: .82rem; } .status-pill { border-radius: 999px; padding: .24rem .5rem; color: var(--app-accent-strong, #115345); background: var(--app-accent-soft, #dceee8); font-size: .64rem; font-weight: 850; } .eligibility-counts { display: grid; grid-template-columns: auto 1fr auto 1fr; gap: .2rem .45rem; align-items: baseline; } .eligibility-counts strong { color: var(--app-accent-strong, #115345); font-size: 1.25rem; } .eligibility-counts span { color: var(--app-muted, #60746c); font-size: .65rem; } .eligibility p { margin: 0; font-size: .7rem; }
  @media (max-width: 1050px) { .builder-layout { grid-template-columns: 1fr; } .builder-rail { position: static; grid-template-columns: 1fr 1fr; align-items: start; } }
  @media (max-width: 760px) { .series-hero { flex-direction: column; } .builder-progress { grid-template-columns: 1fr 1fr; } .series-summary, .target-toolbar, .scope-picker, .frame-range { grid-template-columns: 1fr; } .builder-rail { grid-template-columns: 1fr; } .frame-target-grid { grid-template-columns: 1fr 1fr; } .wide-field { grid-column: 1 / -1; } }
  @media (max-width: 480px) { .builder-progress { grid-template-columns: 1fr; } .frame-target-grid, .policy-grid, .submit-actions { grid-template-columns: 1fr; } }
</style>
