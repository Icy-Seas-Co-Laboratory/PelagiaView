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
  type EvidenceKind = 'classification' | 'clustering' | 'embedding';
  type EvidenceModel = OracleModelSummary & { evidenceKind: EvidenceKind };

  let options: CurationOptions | null = null;
  let assets: RawAsset[] = [];
  let collections: CollectionSummary[] = [];
  let selectedModelRefs = new Set<string>();
  let models: EvidenceModel[] = [];
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
  let previews: Record<string, ClassificationTargetPreview> = {};
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

  $: models = [
    ...(options?.models ?? []).map((model) => ({ ...model, evidenceKind: 'classification' as const })),
    ...(options?.embedding_models ?? []).map((model) => ({ ...model, evidenceKind: 'embedding' as const })),
    ...(options?.clustering_models ?? []).map((model) => ({ ...model, evidenceKind: 'clustering' as const }))
  ];
  // The V2 catalog only exposes eligible sealed models. Keep the status visible
  // for provenance, but do not infer runtime availability from retired fields.
  $: availableModels = models;
  $: selectedModels = availableModels.filter((model) => selectedModelRefs.has(modelKey(model)));
  $: queueableModels = selectedModels.filter((model) => (previews[modelKey(model)]?.target_count ?? 0) > 0);
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
  $: selectionSignature = JSON.stringify({ modelRefs: [...selectedModelRefs].sort(), selection });
  $: if (ready && selectedModels.length && selectionSignature !== scheduledSignature) {
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
      const usableModels = evidenceModels(nextOptions);
      const validSelection = reconcileModelRefs(selectedModelRefs, usableModels);
      if (!validSelection.size) {
        const defaultModel = usableModels.find((model) => model.artifact_id === nextOptions.default_model_ref) ?? usableModels[0];
        if (defaultModel) validSelection.add(modelKey(defaultModel));
      }
      selectedModelRefs = validSelection;
      persistPreferences();
      if (!selectedModelRefs.size && nextOptions.oracle.error) error = nextOptions.oracle.error;
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
    previews = {};
    previewError = null;
    previewing = true;
    previewTimer = window.setTimeout(() => void loadPreview(), 250);
  }

  async function loadPreview() {
    const client = getClient();
    if (!client || !selectedModels.length) return;
    const serial = ++previewSerial;
    previewing = true;
    previewError = null;
    try {
      const next = await Promise.all(selectedModels.map(async (model) => [
        modelKey(model),
        await client.previewClassificationTargets({
          model_ref: model.artifact_id,
          evidence_kind: model.evidenceKind,
          selection
        })
      ] as const));
      if (serial === previewSerial) previews = Object.fromEntries(next);
    } catch (cause) {
      if (serial === previewSerial) {
        previews = {};
        previewError = previewFailureMessage(cause);
      }
    } finally {
      if (serial === previewSerial) previewing = false;
    }
  }

  async function queueEvidence() {
    const client = getClient();
    if (!client || !queueableModels.length || queueing) return;
    queueing = true;
    error = null;
    notice = null;
    try {
      const results = await Promise.allSettled(queueableModels.map((model) => client.queueClassificationJob({
        model_ref: model.artifact_id,
        evidence_kind: model.evidenceKind,
        selection
      })));
      const queuedJobIds: string[] = [];
      let targetCount = 0;
      const failures: string[] = [];
      for (const result of results) {
        if (result.status === 'fulfilled') {
          queuedJobIds.push(result.value.job.id);
          targetCount += result.value.target_count;
        } else {
          failures.push(errorMessage(result.reason));
        }
      }
      if (queuedJobIds.length) {
        submittedJobIds = [...queuedJobIds, ...submittedJobIds.filter((id) => !queuedJobIds.includes(id))];
        notice = `Queued ${queuedJobIds.length} evidence job${queuedJobIds.length === 1 ? '' : 's'} for ${formatCount(targetCount)} model-ROI evaluations.${failures.length ? ` ${failures.length} model${failures.length === 1 ? '' : 's'} could not be queued.` : ''}`;
      }
      if (failures.length) error = `Unable to queue ${failures.length === queueableModels.length ? 'ML evidence' : 'some ML evidence'}: ${failures.join(' ')}`;
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

  function modelPurpose(kind: EvidenceKind): string {
    if (kind === 'embedding') return 'Image embeddings';
    if (kind === 'clustering') return 'Cluster evidence';
    return 'Class probabilities and decisions';
  }

  function modelName(model: OracleModelSummary): string {
    return model.name?.trim() || model.artifact_id;
  }

  function modelStatus(model: OracleModelSummary): string {
    return model.status?.trim() || 'Catalog status not reported';
  }

  function modelKey(model: Pick<EvidenceModel, 'artifact_id' | 'evidenceKind'>): string {
    return `${model.evidenceKind}:${model.artifact_id}`;
  }

  function toggleModel(model: EvidenceModel, checked: boolean) {
    const next = new Set(selectedModelRefs);
    const key = modelKey(model);
    if (checked) next.add(key);
    else next.delete(key);
    selectedModelRefs = next;
  }

  function selectedCountFor(kind: EvidenceKind): number {
    return selectedModels.filter((model) => model.evidenceKind === kind).length;
  }

  function preferenceKey(): string {
    return projectPreferenceKey('ml-evidence-workflow', $session);
  }

  function evidenceModels(source: CurationOptions): EvidenceModel[] {
    return [
      ...source.models.map((model) => ({ ...model, evidenceKind: 'classification' as const })),
      ...(source.embedding_models ?? []).map((model) => ({ ...model, evidenceKind: 'embedding' as const })),
      ...(source.clustering_models ?? []).map((model) => ({ ...model, evidenceKind: 'clustering' as const }))
    ];
  }

  function reconcileModelRefs(storedRefs: Iterable<string>, catalog: EvidenceModel[]): Set<string> {
    const catalogKeys = new Set(catalog.map(modelKey));
    const selected = new Set<string>();
    for (const ref of storedRefs) {
      if (catalogKeys.has(ref)) {
        selected.add(ref);
        continue;
      }
      // A pre-V2 preference may have stored a bare model reference. It is safe
      // to retain it only when it already equals a current sealed artifact ID.
      const separator = ref.indexOf(':');
      const kind = separator >= 0 ? ref.slice(0, separator) : 'classification';
      const candidate = separator >= 0 ? ref.slice(separator + 1) : ref;
      const match = catalog.find((model) => model.evidenceKind === kind && model.artifact_id === candidate);
      if (match) selected.add(modelKey(match));
    }
    return selected;
  }

  async function refreshModels() {
    const client = getClient();
    if (!client || loading) return;
    error = null;
    try {
      const nextOptions = await client.getCurationOptions();
      options = nextOptions;
      selectedModelRefs = reconcileModelRefs(selectedModelRefs, evidenceModels(nextOptions));
      if (!selectedModelRefs.size) {
        const defaultModel = evidenceModels(nextOptions).find((model) => model.artifact_id === nextOptions.default_model_ref)
          ?? evidenceModels(nextOptions)[0];
        if (defaultModel) selectedModelRefs = new Set([modelKey(defaultModel)]);
      }
      persistPreferences();
    } catch (cause) {
      error = `Unable to refresh Oracle Builder models: ${errorMessage(cause)}`;
    }
  }

  function restorePreferences() {
    if (typeof localStorage === 'undefined') return;
    try {
      const stored = JSON.parse(localStorage.getItem(preferenceKey()) ?? '{}') as Record<string, unknown>;
      const storedRefs = Array.isArray(stored.modelRefs)
        ? stored.modelRefs.map(String)
        : typeof stored.modelRef === 'string' && stored.modelRef
          ? [`classification:${stored.modelRef}`]
          : [];
      selectedModelRefs = new Set(storedRefs);
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
      modelRefs: [...selectedModelRefs],
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
    <div><h1>Generate ML evidence</h1><p>Select refined ROIs and one or more Oracle Builder models. Pelagia owns the query, jobs, evidence records, and provenance; Oracle Builder owns inference.</p></div>
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
        <div class="model-panel-heading"><div><p class="eyebrow">Inference</p><h2>Oracle Builder models</h2></div><button type="button" class="secondary compact" disabled={loading} on:click={refreshModels}>Refresh models</button></div>
        <p class="model-help">Each selection produces a separate, provenance-scoped evidence job. {selectedModels.length ? `${selectedModels.length} selected.` : 'Select at least one ready model.'}</p>
        {#each ['classification', 'embedding', 'clustering'] as evidenceKind (evidenceKind)}
          {@const group = availableModels.filter((model) => model.evidenceKind === evidenceKind)}
          <fieldset class="model-group">
            <legend>{evidenceKind === 'classification' ? 'Classification' : evidenceKind === 'embedding' ? 'Embedding' : 'Clustering'} <span>{selectedCountFor(evidenceKind as EvidenceKind)}/{group.length}</span></legend>
            {#if group.length}
              {#each group as model (modelKey(model))}
                <label class="model-choice">
                  <input type="checkbox" checked={selectedModelRefs.has(modelKey(model))} on:change={(event) => toggleModel(model, (event.currentTarget as HTMLInputElement).checked)} />
                  <span><strong>{modelName(model)}</strong><small>{modelPurpose(model.evidenceKind)} · {modelStatus(model)}</small><small title={model.artifact_id}>ID: {model.artifact_id}</small><small title={model.fingerprint_sha256 ?? ''}>Fingerprint: {model.fingerprint_sha256 || 'Not reported'}</small></span>
                </label>
              {/each}
            {:else if !loading}
              <p class="empty">No ready {evidenceKind} model.</p>
            {/if}
          </fieldset>
        {/each}
      </section>

      <section class="panel queue-panel">
        <p class="eyebrow">Resolved workload</p><h2>{previewing ? 'Counting refined ROIs…' : `${formatCount(queueableModels.reduce((sum, model) => sum + (previews[modelKey(model)]?.target_count ?? 0), 0))}`}</h2><p>{queueableModels.length ? `${queueableModels.length} selected model${queueableModels.length === 1 ? '' : 's'} have matching refined ROIs` : 'Select models and a target query to resolve work'}</p>
        {#if selectedModels.length && !previewing}
          <dl class="workload-list">
            {#each selectedModels as model (modelKey(model))}
              <div><dt>{modelName(model)}<small title={model.artifact_id}>{model.artifact_id}</small><small title={model.fingerprint_sha256 ?? ''}>Fingerprint: {model.fingerprint_sha256 || 'Not reported'}</small></dt><dd>{formatCount(previews[modelKey(model)]?.target_count ?? 0)} ROIs</dd></div>
            {/each}
          </dl>
        {/if}
        {#if previewError}<p class="preview-error" role="alert">{previewError}</p>{/if}
        {#if evidenceState === 'all'}<p class="rerun-warning">This intentionally includes ROIs that already have evidence from each selected model. New evidence is retained as a separate inference run.</p>{/if}
        <button class="primary queue-action" type="button" disabled={loading || previewing || queueing || !queueableModels.length} on:click={queueEvidence}>{queueing ? 'Queueing…' : `Queue ${queueableModels.length || ''} evidence job${queueableModels.length === 1 ? '' : 's'}`}</button>
        <small>The worker loads bbox-only crops in bounded batches and records each model’s identity, evidence type, progress, embeddings, similarities, and inference provenance.</small>
      </section>
    </aside>
  </div>

  <QueueStatusSummary title="ML evidence jobs" eyebrow="Classification, embedding, and clustering" stage="classification" jobIds={submittedJobIds} mode="detailed" />
</div>

<style>
  .ml-evidence-page{display:grid;gap:14px;max-width:1500px;margin:0 auto}.workflow-page-intro{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;border-bottom:1px solid var(--border,#dce4e2);padding:2px 0 14px}.workflow-page-intro h1{margin:0 0 4px;font-size:1.45rem}.workflow-page-intro p{max-width:850px;margin:0;color:var(--muted,#667);font-size:.83rem;line-height:1.5}.workflow-page-intro>span{border:1px solid var(--border,#ccd);border-radius:999px;padding:5px 9px;color:var(--muted,#667);font-size:.7rem;font-weight:800;white-space:nowrap}.workflow-page-intro>span.ready{border-color:color-mix(in srgb,var(--accent,#176f62) 45%,var(--border,#ccd));color:var(--accent,#176f62);background:color-mix(in srgb,var(--accent,#176f62) 8%,transparent)}.evidence-workspace{display:grid;grid-template-columns:minmax(0,1fr)minmax(280px,340px);gap:12px;align-items:start}.target-panel,.model-panel,.queue-panel{padding:14px}.target-panel>header,.model-panel-heading{display:flex;justify-content:space-between;gap:15px;align-items:start;border-bottom:1px solid var(--border,#dde4e3);padding-bottom:10px}.target-panel h2,.model-panel h2{margin:0;font-size:1.05rem}.target-panel>header small{color:var(--muted,#667)}.compact{padding:4px 7px;font-size:.68rem}.filter-selector-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:12px 0;border-bottom:1px solid var(--border,#dde4e3)}.filter-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px 12px;padding-top:12px}.filter-grid label{display:grid;gap:4px;margin:0;color:var(--muted,#667);font-size:.68rem;font-weight:750}.evidence-control-column{display:grid;gap:12px;position:sticky;top:8px}.queue-panel>.eyebrow{margin:0 0 3px}.model-help{margin:5px 0 10px;color:var(--muted,#667);font-size:.72rem;line-height:1.4}.model-group{display:grid;gap:5px;margin:10px 0 0;padding:9px;border:1px solid var(--border,#dde4e3);border-radius:6px}.model-group legend{padding:0 4px;color:var(--muted,#667);font-size:.68rem;font-weight:800}.model-group legend span{margin-left:5px;color:var(--accent,#176f62)}.model-choice{display:flex;gap:7px;align-items:flex-start;color:inherit;cursor:pointer}.model-choice input{margin-top:3px}.model-choice span{display:grid;gap:2px;min-width:0}.model-choice strong{font-size:.76rem}.model-choice small{color:var(--muted,#667);font-size:.65rem;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.queue-panel h2{margin:0;font-size:1.75rem}.queue-panel>p:not(.eyebrow){margin:2px 0 12px;color:var(--muted,#667);font-size:.75rem}.workload-list{display:grid;gap:4px;margin:0 0 10px;font-size:.7rem}.workload-list div{display:flex;justify-content:space-between;gap:8px}.workload-list dt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.workload-list dd{margin:0;color:var(--muted,#667);white-space:nowrap}.queue-panel .preview-error{border-left:3px solid var(--danger,#a23c34);padding:8px;color:var(--danger,#a23c34)!important;background:color-mix(in srgb,var(--danger,#a23c34) 8%,transparent)}.queue-panel .rerun-warning{border-left:3px solid #b77a35;padding:7px;color:#87551e!important;background:color-mix(in srgb,#b77a35 8%,transparent)}.queue-action{width:100%;margin:4px 0 9px}.queue-panel>small{display:block;color:var(--muted,#667);font-size:.65rem;line-height:1.45}.empty{color:var(--muted,#667);font-size:.75rem}.form-success{margin:0;border-left:3px solid var(--accent,#176f62);padding:8px 10px;background:color-mix(in srgb,var(--accent,#176f62) 8%,transparent)}@media(max-width:1050px){.evidence-workspace{grid-template-columns:minmax(0,1fr)}.evidence-control-column{grid-template-columns:repeat(2,minmax(0,1fr));position:static}}@media(max-width:720px){.workflow-page-intro{display:grid}.filter-selector-grid,.filter-grid,.evidence-control-column{grid-template-columns:minmax(0,1fr)}}
  .workload-list small{display:block;font-size:.62rem}
  .filter-grid label,.queue-panel>small{font-size:var(--wb-font-caption,.75rem)}
  .model-help,.queue-panel>p:not(.eyebrow),.empty{font-size:var(--wb-font-small,.8125rem)}
  .queue-panel>small{line-height:var(--wb-line-reading,1.5)}
</style>
