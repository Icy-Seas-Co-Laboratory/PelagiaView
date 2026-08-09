<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import AuthenticatedImage from '$lib/components/AuthenticatedImage.svelte';
  import InspectorImageControls from '$lib/components/InspectorImageControls.svelte';
  import KonvaImageCanvas from '$lib/components/KonvaImageCanvas.svelte';
  import WorkspaceResizeHandle from '$lib/components/WorkspaceResizeHandle.svelte';
  import { getClient, session } from '$lib/stores/session';
  import { imageInversionEnabled } from '$lib/stores/displayPreferences';
  import { projectPreferenceKey } from '$lib/utils/preferences';
  import {
    buildOriginalGalleryLayout,
    fitTileSize,
    gridMoveIndex,
    nextSelection,
    originalMoveIndex,
    stickyClickSelection,
    visibleGridRange,
    visibleOriginalEntries
  } from '$lib/utils/roiGallery';
  import {
    buildCurationTaxonomy,
    expandableCurationLabelIds,
    visibleCurationTaxonomy
  } from '$lib/utils/curationTaxonomy';
  import type { CurationLabel, CurationOptions, CurationRoi, Job, OracleModelSummary } from '$lib/api/types';
  import type { ImageRenderSpec } from '$lib/utils/imageRenderSpec';

  let options: CurationOptions | null = null;
  let labels: CurationLabel[] = [];
  let items: CurationRoi[] = [];
  let detail: CurationRoi | null = null;
  let selected = new Set<string>();
  let focusedId = '';
  let annotationState = 'all';
  let reviewState = 'all';
  let evidenceState = 'all';
  let labelId = '';
  let labelSource: 'any' | 'human' | 'prediction' = 'any';
  let sortBy = 'oldest';
  let search = '';
  let modelRef = '';
  let page = 0;
  let total = 0;
  const pageSize = 120;
  let loading = false;
  let working = false;
  let error: string | null = null;
  let notice: string | null = null;
  let newLabel = '';
  let expandedLabelIds = new Set<string>();
  let classificationJobs: Job[] = [];
  let classificationError: string | null = null;
  let classificationPollTimer: number | null = null;
  const observedClassificationStatuses = new Map<string, string>();
  type GalleryScaleMode = 'fit' | 'original';
  const fitGalleryTileBasePx = 150;
  let galleryScaleMode: GalleryScaleMode = 'fit';
  let galleryScale = 1;
  let gallery: HTMLDivElement;
  let galleryWidth = 900;
  let galleryHeight = 600;
  let galleryScrollTop = 0;
  let selectionAnchor = '';
  let stickySelection = false;
  let stickyCandidate = '';
  let curationRailWidth = 272;
  let curationInspectorWidth = 340;
  let curationInspectorShowScaleBar = true;
  let preferencesReady = false;

  $: selectedItems = items.filter((item) => selected.has(item.id));
  $: currentEvidence = (detail?.evidence?.[0] as Record<string, any> | undefined) ?? null;
  $: probabilityRows = (currentEvidence?.probabilities ?? []) as Array<Record<string, any>>;
  $: evidencePacket = (currentEvidence?.evidence_packet ?? {}) as Record<string, any>;
  $: prototypeRows = Object.entries(evidencePacket?.prototype?.similarities ?? {})
    .map(([classIndex, similarity]) => ({
      classIndex: Number(classIndex),
      similarity: Number(similarity),
      label: classLabel(Number(classIndex))
    }))
    .sort((a, b) => b.similarity - a.similarity);
  $: knnNeighbors = (currentEvidence?.neighbors ?? []) as Array<Record<string, any>>;
  $: consensus = consensusSummary(detail);
  $: oracleModels = options?.models ?? [];
  $: availableModels = oracleModels.filter((model) => model.available !== false);
  $: selectedModel = availableModels.find((model) => model.alias === modelRef) ?? null;
  $: labelTaxonomy = buildCurationTaxonomy(labels);
  $: visibleLabelRows = visibleCurationTaxonomy(labelTaxonomy, expandedLabelIds);
  $: labelHierarchyExists = labelTaxonomy.some((row) => row.depth > 0);
  $: activeClassificationJobs = classificationJobs.filter((job) => isActiveJob(job));
  $: visibleClassificationJobs = activeClassificationJobs.length
    ? activeClassificationJobs
    : classificationJobs.slice(0, 1);
  $: galleryTileSize = fitTileSize(galleryScale, fitGalleryTileBasePx);
  $: galleryColumns = Math.max(1, Math.floor((galleryWidth - 16) / (galleryTileSize + 10)));
  $: galleryRowHeight = galleryTileSize + 38;
  $: galleryGridRange = visibleGridRange(items.length, galleryColumns, galleryRowHeight, galleryScrollTop, galleryHeight);
  $: visibleGalleryItems = galleryScaleMode === 'fit' ? items.slice(galleryGridRange.start, galleryGridRange.end) : [];
  $: originalGalleryLayout = buildOriginalGalleryLayout(
    items.map((item) => ({ width: item.roi_shape?.[1], height: item.roi_shape?.[0] })),
    galleryWidth,
    galleryScale
  );
  $: visibleOriginalGalleryEntries = galleryScaleMode === 'original'
    ? visibleOriginalEntries(originalGalleryLayout, galleryScrollTop, galleryHeight)
    : [];
  $: curationPreferenceSnapshot = {
    galleryScaleMode,
    galleryScale,
    stickySelection,
    curationRailWidth,
    curationInspectorWidth
  };
  $: if (preferencesReady) persistCurationPreferences(curationPreferenceSnapshot);

  onMount(async () => {
    restoreCurationPreferences();
    preferencesReady = true;
    window.addEventListener('keydown', keydown);
    await initialize();
    await loadClassificationJobs(false);
    classificationPollTimer = window.setInterval(() => void loadClassificationJobs(true), 3000);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', keydown);
    if (classificationPollTimer !== null) window.clearInterval(classificationPollTimer);
  });

  async function initialize() {
    const client = getClient();
    if (!client) return;
    loading = true;
    try {
      options = await client.getCurationOptions();
      labels = options.labels ?? [];
      expandedLabelIds = expandableCurationLabelIds(buildCurationTaxonomy(labels));
      const usableModels = options.models.filter((model) => model.available !== false);
      modelRef =
        usableModels.find((model) => model.alias === options?.default_model_ref)?.alias ??
        usableModels[0]?.alias ??
        '';
      await load();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  async function load() {
    const client = getClient();
    if (!client) return;
    loading = true;
    error = null;
    try {
      const result = await client.listCurationRois({
        annotation_state: annotationState,
        review_state: reviewState,
        evidence_state: evidenceState,
        label_id: labelId || undefined,
        label_source: labelSource,
        search: search || undefined,
        sort_by: sortBy,
        limit: pageSize,
        offset: page * pageSize
      });
      items = result.items ?? [];
      total = result.total ?? 0;
      selected = new Set([...selected].filter((id) => items.some((item) => item.id === id)));
      if (focusedId && items.some((item) => item.id === focusedId)) await focus(focusedId, false);
      else if (items.length) await focus(items[0].id, false);
      else detail = null;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  async function focus(id: string, replaceSelection = true) {
    const client = getClient();
    if (!client) return;
    focusedId = id;
    if (replaceSelection) selected = new Set([id]);
    try {
      detail = await client.getCurationRoi(id);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function choose(item: CurationRoi, event: MouseEvent) {
    const modifiers = { toggle: event.metaKey || event.ctrlKey, range: event.shiftKey };
    if (stickySelection && !modifiers.toggle && !modifiers.range) {
      const next = stickyClickSelection(selected, item.id, stickyCandidate || undefined);
      selected = next.selected;
      stickyCandidate = next.armed ?? '';
      selectionAnchor = item.id;
    } else {
      const next = nextSelection(selected, items.map((candidate) => candidate.id), item.id, modifiers, selectionAnchor || undefined);
      selected = next.selected;
      selectionAnchor = next.anchor;
      stickyCandidate = '';
    }
    await focus(item.id, false);
  }

  function targets(): string[] {
    return selected.size ? [...selected] : focusedId ? [focusedId] : [];
  }

  async function assign(
    label: CurationLabel,
    evidenceId?: string | null,
    explicitTargets?: string[]
  ) {
    const ids = explicitTargets ?? targets();
    const client = getClient();
    if (!client || !ids.length || working) return;
    working = true;
    try {
      await client.annotateCurationRois(ids, label.id, evidenceId);
      notice = `Assigned ${label.display_name || label.name} to ${ids.length} ROI${ids.length === 1 ? '' : 's'}.`;
      await refreshAfterWrite();
      autoAdvance(ids);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      working = false;
    }
  }

  async function acceptPrediction() {
    if (!detail?.predicted_label_id || !detail.evidence_id) return;
    const label = labels.find((value) => value.id === detail?.predicted_label_id);
    if (label) await assign(label, detail.evidence_id, [detail.id]);
  }

  async function review(decision: 'verified' | 'rejected' | 'needs_review') {
    const ids = targets();
    const client = getClient();
    if (!client || !ids.length || working) return;
    working = true;
    try {
      await client.reviewCurationRois(ids, decision);
      notice = `Recorded ${decision.replace('_', ' ')} for ${ids.length} ROI${ids.length === 1 ? '' : 's'}.`;
      await refreshAfterWrite();
      autoAdvance(ids);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      working = false;
    }
  }

  async function clearLabel() {
    const ids = targets();
    const client = getClient();
    if (!client || !ids.length || working) return;
    working = true;
    try {
      await client.removeCurationLabels(ids);
      notice = `Cleared the current human label from ${ids.length} ROI${ids.length === 1 ? '' : 's'}; history was retained.`;
      await refreshAfterWrite();
      autoAdvance(ids);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      working = false;
    }
  }

  async function refreshAfterWrite() {
    const client = getClient();
    if (!client) return;
    const previousExpandable = expandableCurationLabelIds(labelTaxonomy);
    labels = await client.listCurationLabels();
    const expandable = expandableCurationLabelIds(buildCurationTaxonomy(labels));
    expandedLabelIds = new Set([
      ...expandedLabelIds,
      ...[...expandable].filter((id) => !previousExpandable.has(id))
    ]);
    await load();
  }

  function autoAdvance(previousTargets: string[]) {
    if (previousTargets.length !== 1) return;
    const index = items.findIndex((item) => item.id === previousTargets[0]);
    const next = items[index + 1];
    if (next) void focus(next.id);
  }

  async function createLabel() {
    const client = getClient();
    const name = newLabel.trim();
    if (!client || !name || working) return;
    working = true;
    try {
      const label = await client.createCurationLabel({ name, display_name: name });
      labels = [...labels, label].sort((a, b) => labelName(a).localeCompare(labelName(b)));
      newLabel = '';
      notice = `Created ${name}.`;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      working = false;
    }
  }

  async function importDefaultLabels() {
    const client = getClient();
    if (!client || working) return;
    working = true;
    error = null;
    try {
      const result = await client.importDefaultCurationLabels();
      labels = result.labels;
      expandedLabelIds = expandableCurationLabelIds(buildCurationTaxonomy(labels));
      notice = `Loaded ${result.created_count} new and refreshed ${result.updated_count} existing labels from ${result.dictionary_key}.`;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      working = false;
    }
  }

  async function runInference(selectedOnly: boolean) {
    const client = getClient();
    if (!client || !modelRef || working) return;
    const roiIds = selectedOnly ? targets() : [];
    if (selectedOnly && !roiIds.length) return;
    working = true;
    try {
      const response = await client.queueClassificationJob({ roi_ids: roiIds, model_ref: modelRef });
      classificationJobs = [response.job, ...classificationJobs.filter((job) => job.id !== response.job.id)];
      observedClassificationStatuses.set(response.job.id, response.job.status ?? 'queued');
      notice = `Queued classification job ${response.job.id}. Evidence will appear as the worker completes.`;
      await loadClassificationJobs(false);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      working = false;
    }
  }

  async function loadClassificationJobs(refreshEvidence: boolean) {
    const client = getClient();
    if (!client) return;
    try {
      const next = await client.listJobs({
        stage: 'classify',
        include_progress: true,
        limit: 5,
        sort: 'updated_at',
        direction: 'desc'
      });
      let completedSinceLastPoll = false;
      for (const job of next) {
        const status = job.status ?? 'unknown';
        const previous = observedClassificationStatuses.get(job.id);
        if (previous && isActiveStatus(previous) && !isActiveStatus(status)) {
          completedSinceLastPoll = true;
        }
        observedClassificationStatuses.set(job.id, status);
      }
      classificationJobs = next;
      classificationError = null;
      if (refreshEvidence && completedSinceLastPoll) await load();
    } catch (cause) {
      classificationError = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function isActiveStatus(status: string): boolean {
    return ['queued', 'leased', 'working', 'paused'].includes(status.toLowerCase());
  }

  function isActiveJob(job: Job): boolean {
    return isActiveStatus(job.status ?? '');
  }

  function jobProgressPercent(job: Job): number | null {
    const value = Number(job.progress?.percent);
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
  }

  function jobProgressCount(job: Job): string {
    const completed = Number(job.progress?.completed);
    const total = Number(job.progress?.total);
    if (Number.isFinite(completed) && Number.isFinite(total) && total > 0) {
      return `${completed.toLocaleString()} of ${total.toLocaleString()} ROIs`;
    }
    if (job.status === 'succeeded' && total === 0) return 'No eligible ROIs';
    return job.status === 'queued' ? 'Waiting for a classification worker' : 'Determining workload';
  }

  function jobPhase(job: Job): string {
    const phase = String(job.progress?.current?.phase ?? job.progress?.secondary?.phase ?? '');
    return phase ? phase.replaceAll('_', ' ') : job.status ?? 'unknown';
  }

  function keydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (target?.matches('input, select, textarea, [contenteditable="true"]')) return;
    if (event.key === 'Escape') {
      selected = new Set();
      return;
    }
    if (event.code === 'Space') {
      event.preventDefault();
      void review('verified');
      return;
    }
    if (event.key.toLowerCase() === 'f') {
      event.preventDefault();
      void review('needs_review');
      return;
    }
    if (/^[0-9]$/.test(event.key)) {
      const index = event.key === '0' ? 9 : Number(event.key) - 1;
      const label = visibleLabelRows[index]?.label;
      if (label) {
        event.preventDefault();
        void assign(label);
      }
      return;
    }
    if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) moveFocus(event);
  }

  function moveFocus(event: KeyboardEvent) {
    if (!items.length) return;
    const index = Math.max(0, items.findIndex((item) => item.id === focusedId));
    const nextIndex = galleryScaleMode === 'original'
      ? originalMoveIndex(originalGalleryLayout, index, event.key)
      : gridMoveIndex(index, event.key, galleryColumns, items.length);
    const next = items[nextIndex];
    if (!next) return;
    event.preventDefault();
    selected = new Set([next.id]);
    selectionAnchor = next.id;
    stickyCandidate = '';
    void focus(next.id, false);
    scrollToGalleryIndex(nextIndex);
  }

  function updateFilters() {
    page = 0;
    void load();
  }

  function labelName(label: CurationLabel) {
    return label.display_name || label.name;
  }

  function toggleLabelBranch(labelId: string, event: Event) {
    event.stopPropagation();
    const next = new Set(expandedLabelIds);
    next.has(labelId) ? next.delete(labelId) : next.add(labelId);
    expandedLabelIds = next;
  }

  function toggleAllLabelBranches() {
    const expandable = expandableCurationLabelIds(labelTaxonomy);
    const allExpanded = [...expandable].every((id) => expandedLabelIds.has(id));
    expandedLabelIds = allExpanded ? new Set() : expandable;
  }

  function taxonomyOptionName(depth: number, label: CurationLabel): string {
    return `${'  '.repeat(depth)}${depth ? '↳ ' : ''}${labelName(label)}`;
  }

  function classLabel(classIndex: number): string {
    const row = probabilityRows.find((value) => Number(value.class_index) === classIndex);
    return row?.label_name || `Class ${classIndex}`;
  }

  function percent(value: unknown): string {
    return typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
  }

  function similarity(value: unknown): string {
    return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : '—';
  }

  function imageUrl(item: CurationRoi, original = galleryScaleMode === 'original'): string {
    const client = getClient();
    const path = original ? item.roi_url ?? item.thumbnail_url : item.thumbnail_url ?? item.roi_url;
    return client && path ? client.resolveApiUrl(path) : '';
  }

  function curationInspectorRenderSpec(item: CurationRoi): ImageRenderSpec {
    const shape = item.roi_shape ?? [];
    const sourceHeight = Number(shape[0]);
    const sourceWidth = Number(shape[1]);
    return {
      key: `curation-inspector:${item.id}:${curationInspectorShowScaleBar ? 'scale-bar' : 'plain'}`,
      image: {
        url: imageUrl(item, true),
        alt: 'Focused ROI',
        invert: $imageInversionEnabled,
        sourceWidth: Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : null,
        sourceHeight: Number.isFinite(sourceHeight) && sourceHeight > 0 ? sourceHeight : null
      },
      scaleBar: {
        enabled: curationInspectorShowScaleBar,
        placement: 'below',
        lengths: [1000, 500, 100, 50, 10],
        maxPercent: 55
      },
      toolbar: { exportControls: 'none' },
      display: {
        maxWidth: 320,
        maxHeight: 260,
        allowUpscale: true,
        background: '#111916'
      }
    };
  }

  function curationTileStyle(item: CurationRoi): string {
    const shape = item.roi_shape ?? [];
    const sourceHeight = Number(shape[0]);
    const sourceWidth = Number(shape[1]);
    const width = galleryScaleMode === 'original' && Number.isFinite(sourceWidth) && sourceWidth > 0
      ? Math.round(sourceWidth * galleryScale)
      : galleryTileSize;
    const height = galleryScaleMode === 'original' && Number.isFinite(sourceHeight) && sourceHeight > 0
      ? Math.round(sourceHeight * galleryScale)
      : galleryTileSize;
    return `--curation-image-width:${Math.max(1, width)}px;--curation-image-height:${Math.max(1, height)}px`;
  }

  type CurationPreferences = typeof curationPreferenceSnapshot;

  function curationPreferenceKey(): string {
    return projectPreferenceKey('curation-browser', $session);
  }

  function restoreCurationPreferences() {
    if (typeof localStorage === 'undefined') return;
    try {
      const stored = JSON.parse(localStorage.getItem(curationPreferenceKey()) ?? '{}') as Partial<CurationPreferences>;
      galleryScaleMode = stored.galleryScaleMode === 'original' ? 'original' : 'fit';
      galleryScale = boundedPreference(stored.galleryScale, galleryScale, 0.5, 3);
      stickySelection = Boolean(stored.stickySelection);
      curationRailWidth = boundedPreference(stored.curationRailWidth, curationRailWidth, 200, 480);
      curationInspectorWidth = boundedPreference(stored.curationInspectorWidth, curationInspectorWidth, 260, 560);
    } catch {
      // Ignore malformed local preferences.
    }
  }

  function persistCurationPreferences(preferences: CurationPreferences) {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(curationPreferenceKey(), JSON.stringify(preferences));
    }
  }

  function boundedPreference(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  }

  function observeGallery(node: HTMLDivElement) {
    const update = () => {
      galleryWidth = Math.max(1, Math.floor(node.clientWidth));
      galleryHeight = Math.max(1, Math.floor(node.clientHeight));
    };
    const observer = new ResizeObserver(update);
    observer.observe(node);
    update();
    return { destroy: () => observer.disconnect() };
  }

  function scrollToGalleryIndex(index: number) {
    if (!gallery || index < 0) return;
    if (galleryScaleMode === 'original') {
      const entry = originalGalleryLayout.entries[index];
      if (!entry) return;
      if (entry.y < gallery.scrollTop) gallery.scrollTo({ top: Math.max(0, entry.y - 8) });
      else if (entry.y + entry.height > gallery.scrollTop + galleryHeight) gallery.scrollTo({ top: entry.y + entry.height - galleryHeight + 8 });
      return;
    }
    const top = Math.floor(index / galleryColumns) * galleryRowHeight;
    if (top < gallery.scrollTop) gallery.scrollTo({ top: Math.max(0, top - 8) });
    else if (top + galleryRowHeight > gallery.scrollTop + galleryHeight) gallery.scrollTo({ top: top + galleryRowHeight - galleryHeight + 8 });
  }

  function consensusSummary(item: CurationRoi | null): string {
    if (!item?.evidence_id) return 'No model evidence';
    const votes = [item.predicted_class_index, item.prototype_class_index, item.knn_class_index]
      .filter((value) => value !== null && value !== undefined);
    if (votes.length < 2) return 'Partial evidence';
    return votes.every((value) => value === votes[0]) ? 'All evidence agrees' : 'Evidence disagreement';
  }

  function modelArchitecture(model: OracleModelSummary): string {
    return model.architecture || model.model?.architecture || 'Unspecified architecture';
  }

  function modelClassCount(model: OracleModelSummary): number {
    return model.capabilities?.labels?.length ?? 0;
  }

  function modelFeatures(model: OracleModelSummary): string[] {
    const features: string[] = [];
    if (model.capabilities?.embedding?.available) features.push('embeddings');
    if (model.capabilities?.evidence?.prototype) features.push('prototypes');
    if (model.capabilities?.evidence?.knn) features.push('KNN');
    return features;
  }

  function shortIdentity(value: string | null | undefined): string {
    return value ? value.slice(0, 8) : 'unknown';
  }
</script>

<div
  class="curation-workspace resizable-browser-workspace"
  style={`--browser-filter-width:${curationRailWidth}px;--browser-inspector-width:${curationInspectorWidth}px`}
>
  <aside class="curation-rail panel">
    <div class="rail-heading"><p class="eyebrow">Review queue</p><h2>ROI curation</h2></div>
    <label>Human state<select bind:value={annotationState} on:change={updateFilters}><option value="all">All ROIs</option><option value="unlabeled">Unlabeled</option><option value="labeled">Labeled</option></select></label>
    <label>Review<select bind:value={reviewState} on:change={updateFilters}><option value="all">All states</option><option value="unreviewed">Unreviewed</option><option value="verified">Verified</option><option value="needs_review">Needs review</option><option value="rejected">Rejected</option></select></label>
    <label>Model evidence<select bind:value={evidenceState} on:change={updateFilters}><option value="all">All evidence states</option><option value="available">Evidence available</option><option value="missing">No evidence</option><option value="disagreement">Disagreement</option></select></label>
    <label>Sort<select bind:value={sortBy} on:change={updateFilters}><option value="oldest">Oldest first</option><option value="newest">Newest first</option><option value="confidence_asc">Lowest confidence</option><option value="confidence_desc">Highest confidence</option><option value="disagreement">Most disagreement</option><option value="area_asc">Smallest ROI</option><option value="area_desc">Largest ROI</option></select></label>
    <div class="search-row"><input bind:value={search} on:keydown={(event) => event.key === 'Enter' && updateFilters()} placeholder="Search ROI or asset" /><button on:click={updateFilters}>Go</button></div>

    <section class="label-tree">
      <div class="section-title"><h3>{labelHierarchyExists ? 'Taxonomy' : 'Labels'}</h3><span><button class:active={!labelId} on:click={() => { labelId=''; updateFilters(); }}>All</button>{#if labelHierarchyExists}<button title="Expand or collapse the taxonomy" on:click={toggleAllLabelBranches}>{visibleLabelRows.length === labelTaxonomy.length ? 'Collapse' : 'Expand'}</button>{/if}</span></div>
      <label class="taxonomy-source">Match selected label<select bind:value={labelSource} on:change={updateFilters}><option value="any">Human or ML</option><option value="prediction">ML prediction</option><option value="human">Human annotation</option></select></label>
      {#each visibleLabelRows as row,index (row.label.id)}
        <button class="taxonomy-row" class:active={labelId===row.label.id} style={`--depth:${row.depth}`} title={row.label.metadata?.label_dictionary ? `Standard concept: ${row.label.stable_concept_id || row.label.name}` : 'Project label'} on:click={() => { labelId=row.label.id; updateFilters(); }}>
          <span class="taxonomy-label">
            {#if row.hasChildren}<span class="tree-toggle" role="button" tabindex="0" aria-label={`${expandedLabelIds.has(row.label.id) ? 'Collapse' : 'Expand'} ${labelName(row.label)}`} on:click={(event)=>toggleLabelBranch(row.label.id,event)} on:keydown={(event)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleLabelBranch(row.label.id,event);}}}>{expandedLabelIds.has(row.label.id)?'▾':'▸'}</span>{:else}<span class="tree-toggle" aria-hidden="true">·</span>{/if}
            <kbd>{index < 9 ? index + 1 : index === 9 ? 0 : ''}</kbd><span>{labelName(row.label)}</span>
          </span>
          <em>{row.label.annotation_count || 0}<small>human</small> {row.label.prediction_count || 0}<small>ML</small></em>
        </button>
      {/each}
    </section>
    {#if options?.default_label_dictionary}<button class="default-labels" disabled={working} on:click={importDefaultLabels}>Load {options.default_label_dictionary.vocabulary.name} defaults</button>{/if}
    <div class="new-label"><input bind:value={newLabel} on:keydown={(event) => event.key === 'Enter' && createLabel()} placeholder="New project label" /><button disabled={!newLabel.trim() || working} on:click={createLabel}>Add</button></div>

    <section class="inference-panel">
      <div class="model-heading"><h3>Classification models</h3><span class:unavailable={!availableModels.length}>{availableModels.length}/{oracleModels.length} available</span></div>
      {#if availableModels.length}
        <label>Model to use<select bind:value={modelRef}>{#each availableModels as model}<option value={model.alias}>{model.alias}</option>{/each}</select></label>
      {:else}
        <p class="muted">No usable classification model is currently available.</p>
      {/if}
      <div class="model-catalog" aria-label="Oracle Builder classification models">
        {#each oracleModels as model (model.alias)}
          <article class:unavailable={!model.available} class:selected={model.alias === modelRef}>
            <header><strong>{model.alias}</strong><span>{model.available ? 'Ready' : 'Unavailable'}</span></header>
            <p>{modelArchitecture(model)}{#if modelClassCount(model)} · {modelClassCount(model)} classes{/if}</p>
            {#if modelFeatures(model).length}<p>{modelFeatures(model).join(' · ')}</p>{/if}
            {#if model.model?.artifact_id}<code title={model.model.artifact_id}>artifact {shortIdentity(model.model.artifact_id)}</code>{/if}
            {#if model.load_error}<small title={model.load_error}>{model.load_error}</small>{/if}
          </article>
        {/each}
      </div>
      <small class:unavailable={options?.oracle.status !== 'ready'}>Oracle: {options?.oracle.status || 'unknown'}{#if options?.oracle.error} · {options.oracle.error}{/if}</small>
      {#if selectedModel}<small>Selected: {selectedModel.alias} · artifact {shortIdentity(selectedModel.model?.artifact_id)}</small>{/if}
      <div class="inference-actions"><button disabled={working || !targets().length || !selectedModel} on:click={() => runInference(true)}>Run selected</button><button disabled={working || !selectedModel} on:click={() => runInference(false)}>Run all</button></div>
      {#if visibleClassificationJobs.length}
        <div class="classification-progress" aria-live="polite">
          {#each visibleClassificationJobs as job (job.id)}
            <article class:failed={job.status === 'failed' || job.status === 'dead_lettered'}>
              <header><strong>{jobPhase(job)}</strong><span>{jobProgressPercent(job) === null ? job.status : `${jobProgressPercent(job)?.toFixed(0)}%`}</span></header>
              <div class:indeterminate={jobProgressPercent(job) === null && isActiveJob(job)} class="classification-progress-track"><i style={`width:${jobProgressPercent(job) ?? 0}%`}></i></div>
              <p>{job.progress?.message || job.summary || 'Classification job queued'}</p>
              <small>{jobProgressCount(job)} · job {shortIdentity(job.id)}</small>
              {#if job.error_message}<small class="job-error">{job.error_message}</small>{/if}
            </article>
          {/each}
        </div>
      {/if}
      {#if classificationError}<small class="job-error">Progress unavailable: {classificationError}</small>{/if}
    </section>
  </aside>

  <WorkspaceResizeHandle label="Resize curation filters" value={curationRailWidth} min={200} max={480} onResize={(value) => (curationRailWidth = value)} />

  <main class="curation-gallery panel">
    <header class="curation-gallery-toolbar">
      <div><p class="eyebrow">Refined ROI workspace</p><h2>{total.toLocaleString()} curatable ROIs</h2></div>
      <fieldset class="gallery-scale-modes" aria-label="Curation image scaling">
        <label><input type="radio" bind:group={galleryScaleMode} value="fit" />Fit tiles</label>
        <label><input type="radio" bind:group={galleryScaleMode} value="original" />Original pixels</label>
      </fieldset>
      <label class="gallery-scale-control">
        <span>Scale</span>
        <input aria-label="Curation gallery scale" type="range" min="0.5" max="3" step="0.1" bind:value={galleryScale} />
        <output>{galleryScale.toFixed(1)}×</output>
      </label>
      <label class="gallery-sticky-selection"><input type="checkbox" bind:checked={stickySelection} /> Sticky selection</label>
      <div class="curation-selection-actions"><strong>{selected.size}</strong> selected <button on:click={() => selected=new Set(items.map((item)=>item.id))}>Select page</button><button on:click={() => selected=new Set()}>Clear</button></div>
    </header>
    <div class="roi-gallery-viewport" bind:this={gallery} use:observeGallery on:scroll={() => (galleryScrollTop = gallery.scrollTop)} aria-label="Curatable ROI gallery">
      {#if galleryScaleMode === 'original'}
        <div class="roi-gallery-spacer roi-gallery-original-spacer" style={`height:${originalGalleryLayout.height}px;width:${originalGalleryLayout.width}px`}>
          {#each visibleOriginalGalleryEntries as placement (items[placement.index].id)}
            {@const item = items[placement.index]}
            <button
              class="roi-tile native-roi-tile original-roi-tile"
              class:selected={selected.has(item.id)}
              class:focused={focusedId === item.id}
              class:verified={item.review_decision === 'verified'}
              class:needs-review={item.review_decision === 'needs_review'}
              class:disagreement={consensusSummary(item) === 'Evidence disagreement'}
              class:compact={!placement.showLabel}
              style={`left:${placement.x}px;top:${placement.y}px;width:${placement.width}px;height:${placement.height}px`}
              on:click={(event) => choose(item, event)}
            >
              <span class="native-roi-image original-roi-image" style={`width:${placement.imageWidth}px;height:${placement.imageHeight}px`}>
                {#if imageUrl(item)}<AuthenticatedImage src={imageUrl(item)} alt="ROI" imageClass="native-roi-image-element" invert={$imageInversionEnabled} />{/if}
                {#if item.evidence_id}<small class="native-roi-score">ML {percent(item.confidence)}</small>{/if}
              </span>
              {#if placement.showLabel}<span class="native-roi-meta">{item.label_display_name || 'Unlabeled'}</span>{/if}
            </button>
          {/each}
        </div>
      {:else}
        <div class="roi-gallery-spacer" style={`height:${galleryGridRange.totalHeight}px`}>
          <div class="native-roi-grid" style={`--gallery-tile-size:${galleryTileSize}px;--gallery-columns:${galleryColumns};transform:translateY(${Math.floor(galleryGridRange.start / galleryColumns) * galleryRowHeight}px)`}>
            {#each visibleGalleryItems as item (item.id)}
              <button class="roi-tile native-roi-tile" class:selected={selected.has(item.id)} class:focused={focusedId === item.id} class:verified={item.review_decision === 'verified'} class:needs-review={item.review_decision === 'needs_review'} class:disagreement={consensusSummary(item) === 'Evidence disagreement'} on:click={(event) => choose(item, event)}>
                <span class="native-roi-image">{#if imageUrl(item)}<AuthenticatedImage src={imageUrl(item)} alt="ROI" imageClass="native-roi-image-element fit-roi-image" invert={$imageInversionEnabled} />{/if}{#if item.evidence_id}<small class="native-roi-score">ML {percent(item.confidence)}</small>{/if}</span>
                <span class="native-roi-meta">{item.label_display_name || 'Unlabeled'}</span>
              </button>
            {/each}
          </div>
        </div>
      {/if}
      {#if !loading && !items.length}<div class="empty">No refined ROIs match this queue.</div>{/if}
    </div>
    <footer><button disabled={page===0 || loading} on:click={() => {page--;load();}}>Previous</button><span>{total ? `${page*pageSize+1}–${Math.min(total,(page+1)*pageSize)} of ${total}` : '0 ROIs'}</span><button disabled={(page+1)*pageSize>=total || loading} on:click={() => {page++;load();}}>Next</button></footer>
  </main>

  <WorkspaceResizeHandle label="Resize curation inspector" value={curationInspectorWidth} min={260} max={560} direction={-1} position="right" onResize={(value) => (curationInspectorWidth = value)} />

  <aside class="curation-inspector panel">
    <div class="inspector-heading"><p class="eyebrow">Focused ROI</p><h2>Inspector</h2></div>
    {#if detail}
      {#key curationInspectorRenderSpec(detail).key}
        <KonvaImageCanvas spec={curationInspectorRenderSpec(detail)} mode="static" />
      {/key}
      <InspectorImageControls bind:showScaleBar={curationInspectorShowScaleBar} />
      <code>{detail.id}</code>
      <section><h3>Human ground truth</h3><strong class="current-label">{detail.label_display_name || 'Unlabeled'}</strong><p>{detail.review_decision ? detail.review_decision.replace('_',' ') : detail.annotation_id ? 'Unverified' : 'No assertion'}</p><div class="review-actions"><button disabled={!detail.annotation_id || working} on:click={()=>review('verified')}>✓ Verify</button><button disabled={!detail.annotation_id || working} on:click={()=>review('needs_review')}>⚑ Flag</button><button disabled={!detail.annotation_id || working} on:click={()=>review('rejected')}>× Reject</button></div><label>Assign label<select value="" on:change={(event)=>{const label=labels.find((value)=>value.id===(event.currentTarget as HTMLSelectElement).value);if(label)assign(label);(event.currentTarget as HTMLSelectElement).value='';}}><option value="">Choose project label…</option>{#each labelTaxonomy as row}<option value={row.label.id}>{taxonomyOptionName(row.depth,row.label)}</option>{/each}</select></label><button class="clear-label" disabled={!detail.annotation_id || working} on:click={clearLabel}>Clear current label</button></section>

      <section class:warning={consensus==='Evidence disagreement'}><h3>Evidence consensus</h3><strong>{consensus}</strong>{#if detail.evidence_id}<p>Neural: {detail.predicted_label_name || classLabel(detail.predicted_class_index ?? -1)} · Prototype: {classLabel(detail.prototype_class_index ?? -1)} · KNN: {classLabel(detail.knn_class_index ?? -1)}</p><button class="primary" disabled={!detail.predicted_label_id || working} on:click={acceptPrediction}>Accept prediction as human label</button>{:else}<p>No classification run has produced evidence for this ROI.</p>{/if}</section>

      {#if currentEvidence}<section><h3>Neural probabilities</h3>{#each probabilityRows.slice().sort((a,b)=>b.probability-a.probability).slice(0,6) as row}<div class="evidence-bar"><span>{row.label_name || `Class ${row.class_index}`}</span><i><b style={`width:${Math.max(0,Math.min(100,row.probability*100))}%`}></b></i><em>{percent(row.probability)}</em></div>{/each}<dl><dt>Margin</dt><dd>{percent(currentEvidence.probability_margin)}</dd><dt>Entropy</dt><dd>{similarity(currentEvidence.entropy)}</dd></dl></section>
      <section><h3>Prototype similarity</h3>{#if prototypeRows.length}{#each prototypeRows.slice(0,5) as row}<div class="evidence-bar"><span>{row.label}</span><i><b style={`width:${Math.max(0,Math.min(100,(row.similarity+1)*50))}%`}></b></i><em>{similarity(row.similarity)}</em></div>{/each}<dl><dt>Margin</dt><dd>{similarity(currentEvidence.prototype_margin)}</dd></dl>{:else}<p>Prototype evidence unavailable for this model.</p>{/if}</section>
      <section><h3>KNN context</h3><dl><dt>Agreement</dt><dd>{percent(currentEvidence.knn_agreement)}</dd><dt>Weighted support</dt><dd>{percent(currentEvidence.knn_weighted_support)}</dd><dt>Margin</dt><dd>{percent(currentEvidence.knn_margin)}</dd></dl>{#if knnNeighbors.length}<div class="neighbor-list">{#each knnNeighbors as neighbor}<div><b>#{Number(neighbor.rank)+1}</b><span>{classLabel(Number(neighbor.class_index))}</span><em>{similarity(neighbor.similarity)}</em><code>{neighbor.exemplar_id}</code></div>{/each}</div><small>Oracle currently provides exemplar identity and similarity, but not deployable exemplar images.</small>{:else}<p>KNN evidence unavailable for this model.</p>{/if}</section>
      <section><h3>Provenance</h3><dl><dt>Model selector</dt><dd>{currentEvidence.model_selector}</dd><dt>Artifact</dt><dd>{currentEvidence.artifact_id || 'Unknown'}</dd><dt>Model run</dt><dd>{currentEvidence.model_run_id || 'Unknown'}</dd><dt>Inference run</dt><dd>{currentEvidence.inference_run_id}</dd></dl></section>{/if}

      <section><h3>Annotation history</h3>{#if detail.annotations?.length}{#each detail.annotations as annotation}<div class="history"><strong>{annotation.label_display_name}</strong><span>{annotation.actor_username} · {annotation.is_current ? 'current' : 'replaced'}</span></div>{/each}{:else}<p>No human annotation history.</p>{/if}</section>
    {:else}<div class="empty">Select an ROI to review its evidence and annotation history.</div>{/if}
  </aside>
</div>

{#if loading}<div class="loading-line"></div>{/if}
{#if error}<div class="toast error">{error}<button on:click={()=>error=null}>×</button></div>{/if}
{#if notice}<div class="toast notice">{notice}<button on:click={()=>notice=null}>×</button></div>{/if}

<style>
  .curation-workspace{display:grid;grid-template-columns:250px minmax(420px,1fr)330px;gap:12px;min-height:calc(100vh - 128px)}
  .panel{background:var(--surface,#fff);border:1px solid var(--border,#cbd5d9);border-radius:10px;min-width:0}
  .curation-rail,.curation-inspector{padding:14px;overflow:auto;max-height:calc(100vh - 128px)}
  .rail-heading h2,.inspector-heading h2,.curation-gallery h2{margin:0 0 12px}.eyebrow{margin:0;color:var(--muted,#667);font-size:10px;text-transform:uppercase;letter-spacing:.08em}
  label{display:grid;gap:4px;margin:9px 0;font-size:11px;font-weight:650;color:var(--muted,#667)}select,input,button{font:inherit}select,input{min-width:0;padding:7px;border:1px solid var(--border,#bac5ca);border-radius:5px;background:var(--surface,#fff);color:inherit}button{border:1px solid var(--border,#bac5ca);border-radius:5px;background:var(--surface,#fff);color:inherit;padding:6px 8px;cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}button.primary{background:var(--accent,#197997);color:#fff;border-color:var(--accent,#197997);width:100%}
  .search-row,.new-label{display:flex}.search-row input,.new-label input{flex:1}.search-row button,.new-label button{border-radius:0 5px 5px 0;margin-left:-1px}
  .label-tree{margin:15px -5px}.section-title{display:flex;align-items:center;justify-content:space-between;padding:0 5px}.section-title>span{display:flex}.section-title button{padding:3px 5px}.label-tree h3,.inference-panel h3,.curation-inspector h3{margin:8px 0;font-size:12px}.label-tree>.taxonomy-row{width:100%;border:0;border-bottom:1px solid var(--border,#dde4e6);border-radius:0;display:flex;justify-content:space-between;text-align:left;background:transparent;padding-left:calc(5px + var(--depth,0) * 13px)}.label-tree>.taxonomy-row.active{background:color-mix(in srgb,var(--accent,#197997) 14%,transparent)}.taxonomy-label{display:flex;align-items:center;gap:4px;min-width:0}.taxonomy-label>span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tree-toggle{width:12px;flex:0 0 12px;display:inline-grid;place-items:center;color:var(--muted,#667)}.tree-toggle[role="button"]{cursor:pointer}.label-tree em{font-style:normal;font-size:10px;white-space:nowrap}.label-tree small{color:var(--muted,#778)}kbd{font:9px ui-monospace;border:1px solid var(--border,#ccd);padding:1px 3px}
  .inference-panel{border-top:1px solid var(--border,#ccd);margin-top:16px;padding-top:8px}.model-heading{display:flex;align-items:center;justify-content:space-between}.model-heading span{font-size:9px;color:#28724d}.model-heading span.unavailable,.inference-panel small.unavailable{color:#a14f3d}.model-catalog{display:grid;gap:5px;max-height:230px;overflow:auto;margin:8px 0}.model-catalog article{padding:6px;border:1px solid var(--border,#ccd);border-left:3px solid #3f8b6c;border-radius:4px;background:color-mix(in srgb,var(--surface,#fff) 92%,var(--accent,#197997))}.model-catalog article.unavailable{border-left-color:#a14f3d;opacity:.82}.model-catalog article.selected{box-shadow:0 0 0 1px var(--accent,#197997)}.model-catalog header{display:flex;justify-content:space-between;gap:5px;font-size:10px}.model-catalog header span{font-size:8px;text-transform:uppercase;letter-spacing:.05em}.model-catalog p{margin:3px 0;font-size:9px;color:var(--muted,#667)}.model-catalog code{display:block;font-size:8px}.model-catalog small{display:-webkit-box;overflow:hidden;line-clamp:2;-webkit-line-clamp:2;-webkit-box-orient:vertical;color:#a14f3d}.inference-panel>small{display:block;margin:7px 0;color:#28724d}.inference-actions{display:flex}.inference-actions button{flex:1}
  .classification-progress{display:grid;gap:6px;margin-top:9px}.classification-progress article{padding:7px;border:1px solid var(--border,#ccd);border-radius:5px;background:color-mix(in srgb,var(--surface,#fff) 94%,var(--accent,#197997))}.classification-progress article.failed{border-color:#a14f3d}.classification-progress header{display:flex;justify-content:space-between;text-transform:capitalize;font-size:10px}.classification-progress p{margin:5px 0;font-size:9px;line-height:1.3}.classification-progress small{display:block;margin:2px 0;color:var(--muted,#667)}.classification-progress-track{height:6px;margin-top:5px;border-radius:4px;overflow:hidden;background:var(--border,#d9e0e2)}.classification-progress-track i{display:block;height:100%;background:var(--accent,#197997);transition:width .25s ease}.classification-progress-track.indeterminate i{width:35%!important;animation:classification-pulse 1.2s ease-in-out infinite}.job-error{color:#a14f3d!important;overflow-wrap:anywhere}@keyframes classification-pulse{0%{transform:translateX(-110%)}100%{transform:translateX(310%)}}
  .curation-gallery{display:grid;grid-template-rows:auto minmax(0,1fr) auto;height:100%;min-height:0}.curation-gallery header,.curation-gallery footer{padding:12px;display:flex;align-items:center;justify-content:space-between;gap:10px}.curation-gallery header{border-bottom:1px solid var(--border,#ccd)}.curation-gallery footer{border-top:1px solid var(--border,#ccd)}
  :global(.inspect-image){width:100%;max-height:230px;object-fit:contain;background:#162329;border-radius:6px}.default-labels{width:100%;margin-top:6px}.curation-inspector>code{display:block;margin:5px 0 12px;overflow:hidden;text-overflow:ellipsis;font-size:9px}.curation-inspector section{border-top:1px solid var(--border,#ccd);padding:9px 0}.curation-inspector section.warning{border-left:4px solid #ba6b35;padding-left:8px}.current-label{font-size:18px}.review-actions{display:flex}.review-actions button{flex:1;padding:5px 2px}.evidence-bar{display:grid;grid-template-columns:minmax(80px,1fr)80px 45px;gap:5px;align-items:center;font-size:10px;margin:5px 0}.evidence-bar i{height:7px;background:var(--border,#d9e0e2);border-radius:4px;overflow:hidden}.evidence-bar i b{display:block;height:100%;background:var(--accent,#197997)}.evidence-bar em{text-align:right;font-style:normal}dl{display:grid;grid-template-columns:90px minmax(0,1fr);font-size:10px;margin:7px 0}dt{color:var(--muted,#667)}dd{margin:0;overflow-wrap:anywhere}.neighbor-list>div{display:grid;grid-template-columns:24px 1fr 42px;gap:4px;padding:4px 0;border-bottom:1px solid var(--border,#dde4e6);font-size:10px}.neighbor-list code{grid-column:2/4;overflow:hidden;text-overflow:ellipsis}.history{display:flex;justify-content:space-between;font-size:10px;padding:5px 0;border-bottom:1px solid var(--border,#dde4e6)}.empty{padding:25px;color:var(--muted,#667);text-align:center}
  .toast{position:fixed;right:20px;bottom:20px;z-index:10;padding:10px 12px;border-radius:6px;color:#fff;box-shadow:0 5px 20px #0004}.toast.error{background:#9b3d37}.toast.notice{background:#286f55}.toast button{border:0;background:transparent;color:inherit}.loading-line{position:fixed;left:0;right:0;top:0;height:3px;background:var(--accent,#197997);z-index:20}
  @media(max-width:1050px){.curation-workspace{grid-template-columns:220px 1fr}.curation-inspector{grid-column:1/-1;max-height:none}}@media(max-width:700px){.curation-workspace{display:block}.curation-rail,.curation-gallery,.curation-inspector{margin-bottom:10px;max-height:none}}
</style>
