<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import LiveFilterSelect from '$lib/components/LiveFilterSelect.svelte';
  import QueueStatusSummary from '$lib/components/QueueStatusSummary.svelte';
  import { ApiError, type PelagiaApiClient } from '$lib/api/client';
  import { getClient, session } from '$lib/stores/session';
  import { buildCurationTaxonomy } from '$lib/utils/curationTaxonomy';
  import { formatCount } from '$lib/utils/format';
  import { projectPreferenceKey } from '$lib/utils/preferences';
  import type { LiveFilterOption } from '$lib/types/liveFilters';
  import type {
    ClassificationTargetPreview,
    ClassificationTargetSelection,
    CollectionSummary,
    CurationLabel,
    CurationOptions,
    OracleModelSummary,
    RawAsset
  } from '$lib/api/types';

  type AnnotationState = NonNullable<ClassificationTargetSelection['annotation_state']>;
  type ReviewState = NonNullable<ClassificationTargetSelection['review_state']>;
  type EvidenceState = NonNullable<ClassificationTargetSelection['evidence_state']>;
  type LabelSource = NonNullable<ClassificationTargetSelection['label_source']>;

  let options: CurationOptions | null = null;
  let assets: RawAsset[] = [];
  let collections: CollectionSummary[] = [];
  let modelRef = '';
  let selectedAssetIds = new Set<string>();
  let selectedCollections = new Set<string>();
  let annotationState: AnnotationState = 'all';
  let reviewState: ReviewState = 'all';
  let evidenceState: EvidenceState = 'missing_model';
  let labelId = '';
  let labelSource: LabelSource = 'any';
  let minArea: number | null = null;
  let maxArea: number | null = null;
  let search = '';
  let assetFilterOptions: LiveFilterOption[] = [];
  let collectionFilterOptions: LiveFilterOption[] = [];
  let preview: ClassificationTargetPreview | null = null;
  let loading = true;
  let previewing = false;
  let queueing = false;
  let error: string | null = null;
  let previewError: string | null = null;
  let notice: string | null = null;
  let submittedJobIds: string[] = [];
  let ready = false;
  let previewTimer: number | null = null;
  let previewSerial = 0;
  let scheduledSignature = '';

  $: models = options?.models ?? [];
  $: availableModels = models.filter((model) => model.available !== false);
  $: selectedModel = availableModels.find((model) => model.alias === modelRef) ?? null;
  $: labels = options?.labels ?? [];
  $: taxonomy = buildCurationTaxonomy(labels);
  $: assetFilterOptions = assets.map((asset) => ({
    id: asset.id,
    label: asset.filename || asset.id,
    detail: (asset.collections ?? []).join(', ') || 'No collection tags',
    count: asset.frame_count ?? asset.media_count ?? 0,
    countLabel: 'frames',
    keywords: [asset.path ?? '', asset.id]
  }));
  $: collectionFilterOptions = collections.map((collection) => ({
    id: collection.collection,
    label: collection.collection,
    count: collection.asset_count ?? 0,
    countLabel: 'assets'
  }));
  // Keep every request field visible to Svelte's compile-time dependency tracking.
  // Hiding these reads in a zero-argument helper leaves `selection` frozen at its
  // initial value even while the filter controls visibly change.
  $: selection = {
    asset_ids: [...selectedAssetIds],
    collections: [...selectedCollections],
    annotation_state: annotationState,
    review_state: reviewState,
    evidence_state: evidenceState,
    label_id: labelId || null,
    label_source: labelSource,
    min_area: minArea,
    max_area: maxArea,
    search: search.trim() || null
  } satisfies ClassificationTargetSelection;
  $: selectionSignature = JSON.stringify({ modelRef, selection });
  $: if (ready && modelRef && selectionSignature !== scheduledSignature) {
    scheduledSignature = selectionSignature;
    schedulePreview();
    persistPreferences();
  }

  onMount(async () => {
    await initialize();
    ready = true;
  });

  onDestroy(() => {
    if (previewTimer !== null) window.clearTimeout(previewTimer);
    previewSerial += 1;
  });

  async function initialize() {
    const client = getClient();
    if (!client) return;
    loading = true;
    error = null;
    try {
      const [nextOptions, nextAssets, nextCollections] = await Promise.all([
        client.getCurationOptions(),
        loadAllAssets(client),
        loadAllCollections(client)
      ]);
      options = nextOptions;
      assets = nextAssets;
      collections = nextCollections;
      restorePreferences();
      const usableModels = nextOptions.models.filter((model) => model.available !== false);
      modelRef = usableModels.some((model) => model.alias === modelRef)
        ? modelRef
        : usableModels.find((model) => model.alias === nextOptions.default_model_ref)?.alias ?? usableModels[0]?.alias ?? '';
      if (!modelRef && nextOptions.oracle.error) error = nextOptions.oracle.error;
    } catch (cause) {
      error = `Unable to load ML Evidence options: ${errorMessage(cause)}`;
    } finally {
      loading = false;
    }
  }

  async function loadAllAssets(client: PelagiaApiClient): Promise<RawAsset[]> {
    const result: RawAsset[] = [];
    const pageSize = 500;
    while (true) {
      const batch = await client.listAssets(undefined, pageSize, result.length);
      result.push(...batch);
      if (batch.length < pageSize) return result;
    }
  }

  async function loadAllCollections(client: PelagiaApiClient): Promise<CollectionSummary[]> {
    const result: CollectionSummary[] = [];
    const pageSize = 500;
    while (true) {
      const batch = await client.listCollections(pageSize, result.length);
      result.push(...batch);
      if (batch.length < pageSize) return result;
    }
  }

  function schedulePreview() {
    if (previewTimer !== null) window.clearTimeout(previewTimer);
    preview = null;
    previewError = null;
    previewing = true;
    previewTimer = window.setTimeout(() => void loadPreview(), 250);
  }

  async function loadPreview() {
    const client = getClient();
    if (!client || !modelRef) return;
    const serial = ++previewSerial;
    previewing = true;
    previewError = null;
    try {
      const next = await client.previewClassificationTargets({ model_ref: modelRef, selection });
      if (serial === previewSerial) preview = next;
    } catch (cause) {
      if (serial === previewSerial) {
        preview = null;
        previewError = previewFailureMessage(cause);
      }
    } finally {
      if (serial === previewSerial) previewing = false;
    }
  }

  async function queueEvidence() {
    const client = getClient();
    if (!client || !modelRef || !preview?.target_count || queueing) return;
    queueing = true;
    error = null;
    notice = null;
    try {
      const result = await client.queueClassificationJob({ model_ref: modelRef, selection });
      submittedJobIds = [result.job.id, ...submittedJobIds.filter((id) => id !== result.job.id)];
      notice = `Queued ML evidence for ${formatCount(result.target_count)} refined ROIs using ${result.model_ref}.`;
    } catch (cause) {
      error = `Unable to queue ML evidence: ${errorMessage(cause)}`;
    } finally {
      queueing = false;
    }
  }

  function labelName(label: CurationLabel): string {
    return label.display_name || label.name;
  }

  function taxonomyOption(depth: number, label: CurationLabel): string {
    return `${depth ? `${'— '.repeat(depth)}` : ''}${labelName(label)}`;
  }

  function modelArchitecture(model: OracleModelSummary | null): string {
    return model?.architecture || model?.model?.architecture || 'Architecture not reported';
  }

  function modelFeatures(model: OracleModelSummary | null): string[] {
    if (!model) return [];
    const features: string[] = [];
    if (model.capabilities?.embedding?.available) features.push('embeddings');
    if (model.capabilities?.evidence?.prototype) features.push('prototype similarity');
    if (model.capabilities?.evidence?.knn) features.push('KNN context');
    return features;
  }

  function preferenceKey(): string {
    return projectPreferenceKey('ml-evidence-workflow', $session);
  }

  function restorePreferences() {
    if (typeof localStorage === 'undefined') return;
    try {
      const stored = JSON.parse(localStorage.getItem(preferenceKey()) ?? '{}') as Record<string, unknown>;
      modelRef = typeof stored.modelRef === 'string' ? stored.modelRef : '';
      selectedAssetIds = new Set(Array.isArray(stored.assetIds) ? stored.assetIds.map(String) : []);
      selectedCollections = new Set(Array.isArray(stored.collections) ? stored.collections.map(String) : []);
      annotationState = stateValue<AnnotationState>(stored.annotationState, ['all', 'labeled', 'unlabeled'], 'all');
      reviewState = stateValue<ReviewState>(stored.reviewState, ['all', 'unreviewed', 'verified', 'rejected', 'needs_review'], 'all');
      evidenceState = stateValue<EvidenceState>(stored.evidenceState, ['all', 'missing_model', 'available_model', 'missing_any', 'available_any', 'disagreement'], 'missing_model');
      labelId = typeof stored.labelId === 'string' ? stored.labelId : '';
      labelSource = stateValue<LabelSource>(stored.labelSource, ['any', 'human', 'prediction'], 'any');
      minArea = finiteOrNull(stored.minArea);
      maxArea = finiteOrNull(stored.maxArea);
      search = typeof stored.search === 'string' ? stored.search : '';
    } catch {
      // Ignore malformed project-local preferences.
    }
  }

  function persistPreferences() {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(preferenceKey(), JSON.stringify({
      modelRef,
      assetIds: [...selectedAssetIds],
      collections: [...selectedCollections],
      annotationState,
      reviewState,
      evidenceState,
      labelId,
      labelSource,
      minArea,
      maxArea,
      search
    }));
  }

  function stateValue<T extends string>(value: unknown, allowed: T[], fallback: T): T {
    return allowed.includes(value as T) ? value as T : fallback;
  }

  function finiteOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function errorMessage(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
  }

  function previewFailureMessage(cause: unknown): string {
    if (cause instanceof ApiError && cause.status === 404) {
      return 'The connected Pelagia API does not provide ML Evidence workload previews. Restart the Pelagia API with the current backend code.';
    }
    return `Pelagia could not resolve this ROI workload: ${errorMessage(cause)}`;
  }
</script>

<div class="ml-evidence-page">
  <section class="workflow-page-intro">
    <div><h1>Generate ML evidence</h1><p>Select refined ROIs and an Oracle Builder model. Pelagia owns the query, job, evidence records, and provenance; Oracle Builder owns inference.</p></div>
    <span class:ready={availableModels.length > 0}>{availableModels.length ? `${availableModels.length} model${availableModels.length === 1 ? '' : 's'} ready` : 'Oracle unavailable'}</span>
  </section>

  {#if error}<p class="form-error" role="alert">{error}</p>{/if}
  {#if notice}<p class="form-success" role="status">{notice}</p>{/if}

  <div class="evidence-workspace">
    <section class="panel target-panel">
      <header><div><p class="eyebrow">Target query</p><h2>Refined ROI subset</h2></div><small>Empty asset and collection selections include all.</small></header>

      <div class="filter-selector-grid">
        <LiveFilterSelect eyebrow="Asset" title="Source assets" options={assetFilterOptions} selected={selectedAssetIds} allLabel="Any asset" allDetail="No asset restriction" searchPlaceholder="Search filenames or collections" emptyMessage="No source assets are available." onChange={(next) => (selectedAssetIds = next)} />
        <LiveFilterSelect eyebrow="Collection" title="Collection tags" options={collectionFilterOptions} selected={selectedCollections} allLabel="Any collection" allDetail="No collection restriction" searchPlaceholder="Search collections" emptyMessage="No collections are available." onChange={(next) => (selectedCollections = next)} />
      </div>

      <div class="filter-grid">
        <label>Evidence state<select bind:value={evidenceState}><option value="missing_model">Missing for selected model</option><option value="all">All eligible ROIs (rerun)</option><option value="available_model">Already has selected-model evidence</option><option value="missing_any">No model evidence</option><option value="available_any">Any model evidence</option><option value="disagreement">Selected-model disagreement</option></select></label>
        <label>Human annotation<select bind:value={annotationState}><option value="all">All human states</option><option value="unlabeled">Unlabeled</option><option value="labeled">Labeled</option></select></label>
        <label>Human review<select bind:value={reviewState}><option value="all">All review states</option><option value="unreviewed">Unreviewed annotations</option><option value="verified">Verified</option><option value="needs_review">Needs review</option><option value="rejected">Rejected</option></select></label>
        <label>Taxonomy label<select bind:value={labelId}><option value="">All labels</option>{#each taxonomy as row}<option value={row.label.id}>{taxonomyOption(row.depth, row.label)}</option>{/each}</select></label>
        <label>Taxonomy match<select bind:value={labelSource} disabled={!labelId}><option value="any">Human or selected-model prediction</option><option value="prediction">Selected-model prediction</option><option value="human">Human annotation</option></select></label>
        <label>ROI or asset search<input bind:value={search} placeholder="ID or filename" /></label>
        <label>Minimum area (px²)<input type="number" min="0" bind:value={minArea} /></label>
        <label>Maximum area (px²)<input type="number" min="0" bind:value={maxArea} /></label>
      </div>
    </section>

    <aside class="evidence-control-column">
      <section class="panel model-panel">
        <p class="eyebrow">Inference</p><h2>Oracle Builder model</h2>
        <label>Classification model<select bind:value={modelRef} disabled={!availableModels.length}>{#if !availableModels.length}<option value="">No available model</option>{/if}{#each availableModels as model}<option value={model.alias}>{model.alias}</option>{/each}</select></label>
        {#if selectedModel}
          <article class="model-summary"><header><strong>{selectedModel.alias}</strong><span>Ready</span></header><p>{modelArchitecture(selectedModel)}</p><dl><dt>Classes</dt><dd>{formatCount(selectedModel.capabilities?.labels?.length ?? 0)}</dd><dt>Evidence</dt><dd>{modelFeatures(selectedModel).join(', ') || 'probabilities only'}</dd></dl></article>
        {:else if !loading}<p class="empty">Start Oracle Builder with a classification model to queue evidence.</p>{/if}
      </section>

      <section class="panel queue-panel">
        <p class="eyebrow">Resolved workload</p><h2>{previewing ? 'Counting refined ROIs…' : preview ? formatCount(preview.target_count) : '—'}</h2><p>{preview?.target_count === 1 ? 'refined ROI matches this query' : 'refined ROIs match this query'}</p>
        {#if previewError}<p class="preview-error" role="alert">{previewError}</p>{/if}
        {#if evidenceState === 'all'}<p class="rerun-warning">This intentionally includes ROIs that already have evidence from this model. New evidence will be retained as another inference run.</p>{/if}
        <button class="primary queue-action" type="button" disabled={loading || previewing || queueing || !selectedModel || !preview?.target_count} on:click={queueEvidence}>{queueing ? 'Queueing…' : 'Queue ML evidence'}</button>
        <small>The worker loads bbox-only crops in bounded batches and records model identity, progress, embeddings, similarities, and inference provenance.</small>
      </section>
    </aside>
  </div>

  <QueueStatusSummary title="ML evidence jobs" eyebrow="Classification" stage="classification" jobIds={submittedJobIds} mode="detailed" />
</div>

<style>
  .ml-evidence-page{display:grid;gap:14px;max-width:1500px;margin:0 auto}.workflow-page-intro{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;border-bottom:1px solid var(--border,#dce4e2);padding:2px 0 14px}.workflow-page-intro h1{margin:0 0 4px;font-size:1.45rem}.workflow-page-intro p{max-width:850px;margin:0;color:var(--muted,#667);font-size:.83rem;line-height:1.5}.workflow-page-intro>span{border:1px solid var(--border,#ccd);border-radius:999px;padding:5px 9px;color:var(--muted,#667);font-size:.7rem;font-weight:800;white-space:nowrap}.workflow-page-intro>span.ready{border-color:color-mix(in srgb,var(--accent,#176f62) 45%,var(--border,#ccd));color:var(--accent,#176f62);background:color-mix(in srgb,var(--accent,#176f62) 8%,transparent)}.evidence-workspace{display:grid;grid-template-columns:minmax(0,1fr)minmax(280px,340px);gap:12px;align-items:start}.target-panel,.model-panel,.queue-panel{padding:14px}.target-panel>header{display:flex;justify-content:space-between;gap:15px;align-items:start;border-bottom:1px solid var(--border,#dde4e3);padding-bottom:10px}.target-panel h2,.model-panel h2{margin:0;font-size:1.05rem}.target-panel>header small{color:var(--muted,#667)}.filter-selector-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:12px 0;border-bottom:1px solid var(--border,#dde4e3)}.filter-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px 12px;padding-top:12px}.filter-grid label,.model-panel>label{display:grid;gap:4px;margin:0;color:var(--muted,#667);font-size:.68rem;font-weight:750}.evidence-control-column{display:grid;gap:12px;position:sticky;top:8px}.model-panel>.eyebrow,.queue-panel>.eyebrow{margin:0 0 3px}.model-summary{margin-top:10px;border-top:1px solid var(--border,#dde4e3);padding-top:10px}.model-summary header{display:flex;justify-content:space-between}.model-summary header span{color:var(--accent,#176f62);font-size:.68rem;font-weight:800}.model-summary p{color:var(--muted,#667);font-size:.72rem}.model-summary dl{display:grid;grid-template-columns:60px 1fr;gap:5px;margin:0;font-size:.68rem}.model-summary dt{color:var(--muted,#667)}.model-summary dd{margin:0}.queue-panel h2{margin:0;font-size:1.75rem}.queue-panel>p:not(.eyebrow){margin:2px 0 12px;color:var(--muted,#667);font-size:.75rem}.queue-panel .preview-error{border-left:3px solid var(--danger,#a23c34);padding:8px;color:var(--danger,#a23c34)!important;background:color-mix(in srgb,var(--danger,#a23c34) 8%,transparent)}.queue-panel .rerun-warning{border-left:3px solid #b77a35;padding:7px;color:#87551e!important;background:color-mix(in srgb,#b77a35 8%,transparent)}.queue-action{width:100%;margin:4px 0 9px}.queue-panel>small{display:block;color:var(--muted,#667);font-size:.65rem;line-height:1.45}.empty{color:var(--muted,#667);font-size:.75rem}.form-success{margin:0;border-left:3px solid var(--accent,#176f62);padding:8px 10px;background:color-mix(in srgb,var(--accent,#176f62) 8%,transparent)}@media(max-width:1050px){.evidence-workspace{grid-template-columns:minmax(0,1fr)}.evidence-control-column{grid-template-columns:repeat(2,minmax(0,1fr));position:static}}@media(max-width:720px){.workflow-page-intro{display:grid}.filter-selector-grid,.filter-grid,.evidence-control-column{grid-template-columns:minmax(0,1fr)}}
</style>
