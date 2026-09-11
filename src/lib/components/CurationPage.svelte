<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import AuthenticatedImage from '$lib/components/AuthenticatedImage.svelte';
  import InspectorImageControls from '$lib/components/InspectorImageControls.svelte';
  import KonvaImageCanvas from '$lib/components/KonvaImageCanvas.svelte';
  import RegistryDatasetExportModal from '$lib/components/RegistryDatasetExportModal.svelte';
  import ExportBundleModal from '$lib/components/ExportBundleModal.svelte';
  import TelemetryFilterModal from '$lib/components/TelemetryFilterModal.svelte';
  import TelemetrySummary from '$lib/components/TelemetrySummary.svelte';
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
    stickyClickSelection
  } from '$lib/utils/roiGallery';
  import {
    buildCurationTaxonomy,
    expandableCurationLabelIds,
    visibleCurationTaxonomy
  } from '$lib/utils/curationTaxonomy';
  import type { CurationLabel, CurationOptions, CurationRoi, ExportScope, FrameContextResponse, TelemetryRangeFilter } from '$lib/api/types';
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
  let telemetryFilters: TelemetryRangeFilter[] = [];
  let telemetryFilterModalOpen = false;
  let labelId = '';
  let labelSource: 'any' | 'human' | 'prediction' = 'any';
  let sortBy = 'oldest';
  let search = '';
  let page = 0;
  let total = 0;
  const pageSize = 120;
  let loading = false;
  let working = false;
  let error: string | null = null;
  let notice: string | null = null;
  let newLabel = '';
  let expandedLabelIds = new Set<string>();
  type GalleryScaleMode = 'fit' | 'original';
  const fitGalleryTileBasePx = 150;
  let galleryScaleMode: GalleryScaleMode = 'fit';
  let galleryScale = 1;
  let gallery: HTMLDivElement;
  let galleryWidth = 900;
  let galleryHeight = 600;
  let selectionAnchor = '';
  let stickySelection = false;
  let stickyCandidate = '';
  let curationRailWidth = 272;
  let curationInspectorWidth = 340;
  let curationInspectorShowScaleBar = true;
  let preferencesReady = false;
  let registryExportOpen = false;
  let exportOpen = false;
  let telemetryContext: FrameContextResponse | null = null;
  let focusSerial = 0;

  $: selectedItems = items.filter((item) => selected.has(item.id));
  $: exportScope = curationExportScope();
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
  $: labelTaxonomy = buildCurationTaxonomy(labels);
  $: visibleLabelRows = visibleCurationTaxonomy(labelTaxonomy, expandedLabelIds);
  $: labelHierarchyExists = labelTaxonomy.some((row) => row.depth > 0);
  $: galleryTileSize = fitTileSize(galleryScale, fitGalleryTileBasePx);
  $: galleryColumns = Math.max(1, Math.floor((galleryWidth - 16) / (galleryTileSize + 10)));
  $: galleryRowHeight = galleryTileSize + 46;
  $: galleryTotalHeight = Math.ceil(items.length / galleryColumns) * galleryRowHeight;
  // A curation page is deliberately bounded to 120 ROIs. Keep its tiles
  // mounted so authenticated image blobs survive scrolling within the page.
  $: renderedGalleryItems = galleryScaleMode === 'fit' ? items : [];
  $: originalGalleryLayout = buildOriginalGalleryLayout(
    items.map((item) => ({ width: item.roi_shape?.[1], height: item.roi_shape?.[0] })),
    galleryWidth,
    galleryScale
  );
  $: renderedOriginalGalleryEntries = galleryScaleMode === 'original'
    ? originalGalleryLayout.entries
    : [];
  $: curationPreferenceSnapshot = {
    galleryScaleMode,
    galleryScale,
    stickySelection,
    curationRailWidth,
    curationInspectorWidth,
    telemetryFilters
  };
  $: if (preferencesReady) persistCurationPreferences(curationPreferenceSnapshot);

  onMount(async () => {
    restoreCurationPreferences();
    preferencesReady = true;
    window.addEventListener('keydown', keydown);
    await initialize();
  });

  onDestroy(() => {
    window.removeEventListener('keydown', keydown);
  });

  async function initialize() {
    const client = getClient();
    if (!client) return;
    loading = true;
    try {
      options = await client.getCurationOptions();
      labels = options.labels ?? [];
      expandedLabelIds = expandableCurationLabelIds(buildCurationTaxonomy(labels));
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
        telemetry_filters: telemetryFilters,
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
      else {
        detail = null;
        telemetryContext = null;
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  async function focus(id: string, replaceSelection = true) {
    const client = getClient();
    if (!client) return;
    const serial = ++focusSerial;
    focusedId = id;
    if (replaceSelection) selected = new Set([id]);
    telemetryContext = null;
    try {
      const nextDetail = await client.getCurationRoi(id);
      if (serial !== focusSerial) return;
      detail = nextDetail;
      if (nextDetail.frame_id) {
        try {
          const context = await client.frameContext(nextDetail.frame_id, {
            include_detections: false,
            include_telemetry: true
          });
          if (serial === focusSerial) telemetryContext = context;
        } catch {
          // Telemetry is supplemental; keep the curation detail usable when it is unavailable.
        }
      }
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

  function applyTelemetryFilters(filters: TelemetryRangeFilter[]) {
    telemetryFilters = filters;
    telemetryFilterModalOpen = false;
    updateFilters();
  }

  function removeTelemetryFilter(index: number) {
    applyTelemetryFilters(telemetryFilters.filter((_, filterIndex) => filterIndex !== index));
  }

  function telemetryFilterLabel(filter: TelemetryRangeFilter): string {
    const minimum = filter.min_value == null ? '−∞' : filter.min_value;
    const maximum = filter.max_value == null ? '+∞' : filter.max_value;
    return `${filter.parameter_key}: ${minimum}–${maximum}`;
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
      telemetryFilters = telemetryFilterPreferences(stored.telemetryFilters);
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

  function telemetryFilterPreferences(value: unknown): TelemetryRangeFilter[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const candidate = item as Record<string, unknown>;
      const parameterKey = typeof candidate.parameter_key === 'string' ? candidate.parameter_key.trim() : '';
      const minValue = candidate.min_value == null ? null : Number(candidate.min_value);
      const maxValue = candidate.max_value == null ? null : Number(candidate.max_value);
      if (!parameterKey || (minValue === null && maxValue === null) ||
          (minValue !== null && !Number.isFinite(minValue)) || (maxValue !== null && !Number.isFinite(maxValue)) ||
          (minValue !== null && maxValue !== null && minValue > maxValue)) return [];
      return [{ parameter_key: parameterKey, min_value: minValue, max_value: maxValue }];
    });
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

  function curationExportScope(): ExportScope {
    const roiIds = [...selected];
    const filters: Record<string, unknown> = roiIds.length
      ? { roi_ids: roiIds }
      : {
          annotation_state: annotationState,
          review_state: reviewState,
          evidence_state: evidenceState
        };
    return {
      filters,
      description: roiIds.length
        ? `${roiIds.length} selected refined ROI${roiIds.length === 1 ? '' : 's'} on this page.`
        : 'Refined ROIs matching the current annotation, review, and evidence filters.'
    };
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
    <section class="telemetry-filter-control">
      <div class="section-title"><h3>Telemetry criteria</h3><button class="telemetry-add-button" type="button" aria-label="Add telemetry filter" title="Add telemetry filter" on:click={() => telemetryFilterModalOpen = true}>+</button></div>
      {#if telemetryFilters.length === 0}
        <small>Filter the curation queue by sensor value ranges.</small>
      {:else}
        <div class="telemetry-filter-chips">
          {#each telemetryFilters as filter, index}
            <span class="telemetry-filter-chip">{telemetryFilterLabel(filter)}<button type="button" aria-label={`Remove ${telemetryFilterLabel(filter)}`} on:click={() => removeTelemetryFilter(index)}>×</button></span>
          {/each}
        </div>
      {/if}
    </section>

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

  </aside>

  <WorkspaceResizeHandle label="Resize curation filters" value={curationRailWidth} min={200} max={480} onResize={(value) => (curationRailWidth = value)} />

  <main class="curation-gallery panel">
    <header class="curation-gallery-toolbar">
      <div><p class="eyebrow">Refined ROI workspace</p><h2>{total.toLocaleString()} curatable ROIs</h2></div>
      <div class="curation-export-actions"><button class="registry-export-button" disabled={!options} on:click={() => (exportOpen = true)}>Export ROI data…</button><button class="registry-export-button secondary-export" disabled={!options} on:click={() => (registryExportOpen = true)}>Create Registry dataset</button></div>
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
    <div class="roi-gallery-viewport" data-image-scroll-root bind:this={gallery} use:observeGallery aria-label="Curatable ROI gallery">
      {#if galleryScaleMode === 'original'}
        <div class="roi-gallery-spacer roi-gallery-original-spacer" style={`height:${originalGalleryLayout.height}px;width:${originalGalleryLayout.width}px`}>
          {#each renderedOriginalGalleryEntries as placement (items[placement.index].id)}
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
        <div class="roi-gallery-spacer" style={`height:${galleryTotalHeight}px`}>
          <div class="native-roi-grid" style={`--gallery-tile-size:${galleryTileSize}px;--gallery-columns:${galleryColumns}`}>
            {#each renderedGalleryItems as item (item.id)}
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

      <TelemetrySummary telemetry={telemetryContext?.telemetry} />

      {#if currentEvidence}<section><h3>Neural probabilities</h3>{#each probabilityRows.slice().sort((a,b)=>b.probability-a.probability).slice(0,6) as row}<div class="evidence-bar"><span>{row.label_name || `Class ${row.class_index}`}</span><i><b style={`width:${Math.max(0,Math.min(100,row.probability*100))}%`}></b></i><em>{percent(row.probability)}</em></div>{/each}<dl><dt>Margin</dt><dd>{percent(currentEvidence.probability_margin)}</dd><dt>Entropy</dt><dd>{similarity(currentEvidence.entropy)}</dd></dl></section>
      <section><h3>Prototype similarity</h3>{#if prototypeRows.length}{#each prototypeRows.slice(0,5) as row}<div class="evidence-bar"><span>{row.label}</span><i><b style={`width:${Math.max(0,Math.min(100,(row.similarity+1)*50))}%`}></b></i><em>{similarity(row.similarity)}</em></div>{/each}<dl><dt>Margin</dt><dd>{similarity(currentEvidence.prototype_margin)}</dd></dl>{:else}<p>Prototype evidence unavailable for this model.</p>{/if}</section>
      <section><h3>KNN context</h3><dl><dt>Agreement</dt><dd>{percent(currentEvidence.knn_agreement)}</dd><dt>Weighted support</dt><dd>{percent(currentEvidence.knn_weighted_support)}</dd><dt>Margin</dt><dd>{percent(currentEvidence.knn_margin)}</dd></dl>{#if knnNeighbors.length}<div class="neighbor-list">{#each knnNeighbors as neighbor}<div><b>#{Number(neighbor.rank)+1}</b><span>{classLabel(Number(neighbor.class_index))}</span><em>{similarity(neighbor.similarity)}</em><code>{neighbor.exemplar_id}</code></div>{/each}</div><small>Oracle currently provides exemplar identity and similarity, but not deployable exemplar images.</small>{:else}<p>KNN evidence unavailable for this model.</p>{/if}</section>
      <section><h3>Provenance</h3><dl><dt>Model selector</dt><dd>{currentEvidence.model_selector}</dd><dt>Artifact</dt><dd>{currentEvidence.artifact_id || 'Unknown'}</dd><dt>Model run</dt><dd>{currentEvidence.model_run_id || 'Unknown'}</dd><dt>Inference run</dt><dd>{currentEvidence.inference_run_id}</dd></dl></section>{/if}

      {#if detail?.clustering_evidence?.length}
        {@const clusterEvidence = detail.clustering_evidence[0] as Record<string, any>}
        {@const clusterPacket = (clusterEvidence.evidence_packet ?? {}) as Record<string, any>}
        <section><h3>Feature-space organization</h3><dl><dt>Cluster</dt><dd>{clusterEvidence.cluster_id || 'Novel / unassigned'}</dd><dt>Similarity</dt><dd>{similarity(clusterEvidence.similarity)}</dd><dt>Novelty</dt><dd>{clusterEvidence.abstained ? 'Abstained' : clusterEvidence.novel ? 'Novel' : 'Assigned'}</dd></dl>{#if clusterPacket.clusters?.length}<div class="neighbor-list">{#each clusterPacket.clusters.slice(0,5) as cluster}<div><b>{cluster.cluster_id}</b><span>{cluster.size} ROIs</span><em>{similarity(cluster.similarity)}</em></div>{/each}</div>{/if}<small>Cluster IDs are run-local evidence, not taxonomy labels.</small></section>
      {/if}

      {#if detail?.embedding_evidence?.length}
        {@const embeddingEvidence = detail.embedding_evidence[0] as Record<string, any>}
        {@const embeddingShape = Array.isArray(embeddingEvidence.embedding_shape) ? embeddingEvidence.embedding_shape.join(' × ') : 'Unknown'}
        <section><h3>Embedding feature-space evidence</h3><dl><dt>Vector</dt><dd>{embeddingShape}</dd><dt>Normalized</dt><dd>{embeddingEvidence.embedding_normalized ? 'Yes' : 'No'}</dd><dt>Model selector</dt><dd>{embeddingEvidence.model_selector || 'Unknown'}</dd><dt>Artifact</dt><dd>{embeddingEvidence.artifact_id || 'Unknown'}</dd><dt>Inference run</dt><dd>{embeddingEvidence.inference_run_id || 'Unknown'}</dd></dl><small>Embedding vectors are model-scoped feature-space evidence, not taxonomy labels or recorded clusters.</small></section>
      {/if}

      <section><h3>Annotation history</h3>{#if detail.annotations?.length}{#each detail.annotations as annotation}<div class="history"><strong>{annotation.label_display_name}</strong><span>{annotation.actor_username} · {annotation.is_current ? 'current' : 'replaced'}</span></div>{/each}{:else}<p>No human annotation history.</p>{/if}</section>
    {:else}<div class="empty">Select an ROI to review its evidence and annotation history.</div>{/if}
  </aside>
</div>

{#if registryExportOpen && options}
  <RegistryDatasetExportModal {options} on:close={() => (registryExportOpen = false)} />
{/if}

{#if exportOpen}
  <ExportBundleModal scope={exportScope} initialProducts={['raw_roi_statistics', 'roi_evidence']} on:close={() => (exportOpen = false)} />
{/if}

{#if telemetryFilterModalOpen}
  <TelemetryFilterModal
    initialFilters={telemetryFilters}
    on:apply={(event) => applyTelemetryFilters(event.detail)}
    on:close={() => telemetryFilterModalOpen = false}
  />
{/if}

{#if loading}<div class="loading-line"></div>{/if}
{#if error}<div class="toast error">{error}<button on:click={()=>error=null}>×</button></div>{/if}
{#if notice}<div class="toast notice">{notice}<button on:click={()=>notice=null}>×</button></div>{/if}

<style>
  .curation-workspace{display:grid;grid-template-columns:250px minmax(420px,1fr)330px;gap:12px;min-height:calc(100vh - 128px)}
  .curation-export-actions{display:flex;gap:.35rem;align-items:center}.secondary-export{background:transparent;color:inherit}
  .panel{background:var(--surface,#fff);border:1px solid var(--border,#cbd5d9);border-radius:10px;min-width:0}
  .curation-rail,.curation-inspector{padding:14px;overflow:auto;max-height:calc(100vh - 128px)}
  .rail-heading h2,.inspector-heading h2,.curation-gallery h2{margin:0 0 12px}.eyebrow{margin:0;color:var(--muted,#667);font-size:10px;text-transform:uppercase;letter-spacing:.08em}
  label{display:grid;gap:4px;margin:9px 0;font-size:11px;font-weight:650;color:var(--muted,#667)}select,input,button{font:inherit}select,input{min-width:0;padding:7px;border:1px solid var(--border,#bac5ca);border-radius:5px;background:var(--surface,#fff);color:inherit}button{border:1px solid var(--border,#bac5ca);border-radius:5px;background:var(--surface,#fff);color:inherit;padding:6px 8px;cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}button.primary{background:var(--accent,#197997);color:#fff;border-color:var(--accent,#197997);width:100%}
  .search-row,.new-label{display:flex}.search-row input,.new-label input{flex:1}.search-row button,.new-label button{border-radius:0 5px 5px 0;margin-left:-1px}
  .telemetry-filter-control{border-top:1px solid var(--border,#ccd);margin:14px -5px 0;padding:9px 5px 0}.telemetry-filter-control .section-title h3{margin:0}.telemetry-filter-control>small{color:var(--muted,#667);display:block;font-size:10px;line-height:1.4;margin-top:5px}.telemetry-add-button{border:1px solid var(--accent,#197997);border-radius:50%;color:var(--accent,#197997);font-size:16px;height:24px;line-height:18px;padding:0;width:24px}.telemetry-filter-chips{display:grid;gap:4px;margin-top:6px}.telemetry-filter-chip{align-items:center;background:color-mix(in srgb,var(--accent,#197997) 10%,transparent);border:1px solid color-mix(in srgb,var(--accent,#197997) 30%,var(--border,#ccd));border-radius:4px;display:flex;font-size:10px;gap:4px;justify-content:space-between;padding:3px 5px}.telemetry-filter-chip button{border:0;background:transparent;padding:0 2px}
  .label-tree{margin:15px -5px}.section-title{display:flex;align-items:center;justify-content:space-between;padding:0 5px}.section-title>span{display:flex}.section-title button{padding:3px 5px}.label-tree h3,.curation-inspector h3{margin:8px 0;font-size:12px}.label-tree>.taxonomy-row{width:100%;border:0;border-bottom:1px solid var(--border,#dde4e6);border-radius:0;display:flex;justify-content:space-between;text-align:left;background:transparent;padding-left:calc(5px + var(--depth,0) * 13px)}.label-tree>.taxonomy-row.active{background:color-mix(in srgb,var(--accent,#197997) 14%,transparent)}.taxonomy-label{display:flex;align-items:center;gap:4px;min-width:0}.taxonomy-label>span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tree-toggle{width:12px;flex:0 0 12px;display:inline-grid;place-items:center;color:var(--muted,#667)}.tree-toggle[role="button"]{cursor:pointer}.label-tree em{font-style:normal;font-size:10px;white-space:nowrap}.label-tree small{color:var(--muted,#778)}kbd{font:9px ui-monospace;border:1px solid var(--border,#ccd);padding:1px 3px}
  .curation-gallery{display:grid;grid-template-rows:auto minmax(0,1fr) auto;height:100%;min-height:0}.curation-gallery header,.curation-gallery footer{padding:12px;display:flex;align-items:center;justify-content:space-between;gap:10px}.curation-gallery header{border-bottom:1px solid var(--border,#ccd)}.curation-gallery footer{border-top:1px solid var(--border,#ccd)}
  .registry-export-button{white-space:nowrap}
  :global(.inspect-image){width:100%;max-height:230px;object-fit:contain;background:#162329;border-radius:6px}.default-labels{width:100%;margin-top:6px}.curation-inspector>code{display:block;margin:5px 0 12px;overflow:hidden;text-overflow:ellipsis;font-size:9px}.curation-inspector section{border-top:1px solid var(--border,#ccd);padding:9px 0}.curation-inspector section.warning{border-left:4px solid #ba6b35;padding-left:8px}.current-label{font-size:18px}.review-actions{display:flex}.review-actions button{flex:1;padding:5px 2px}.evidence-bar{display:grid;grid-template-columns:minmax(80px,1fr)80px 45px;gap:5px;align-items:center;font-size:10px;margin:5px 0}.evidence-bar i{height:7px;background:var(--border,#d9e0e2);border-radius:4px;overflow:hidden}.evidence-bar i b{display:block;height:100%;background:var(--accent,#197997)}.evidence-bar em{text-align:right;font-style:normal}dl{display:grid;grid-template-columns:90px minmax(0,1fr);font-size:10px;margin:7px 0}dt{color:var(--muted,#667)}dd{margin:0;overflow-wrap:anywhere}.neighbor-list>div{display:grid;grid-template-columns:24px 1fr 42px;gap:4px;padding:4px 0;border-bottom:1px solid var(--border,#dde4e6);font-size:10px}.neighbor-list code{grid-column:2/4;overflow:hidden;text-overflow:ellipsis}.history{display:flex;justify-content:space-between;font-size:10px;padding:5px 0;border-bottom:1px solid var(--border,#dde4e6)}.empty{padding:25px;color:var(--muted,#667);text-align:center}
  .toast{position:fixed;right:20px;bottom:20px;z-index:10;padding:10px 12px;border-radius:6px;color:#fff;box-shadow:0 5px 20px #0004}.toast.error{background:#9b3d37}.toast.notice{background:#286f55}.toast button{border:0;background:transparent;color:inherit}.loading-line{position:fixed;left:0;right:0;top:0;height:3px;background:var(--accent,#197997);z-index:20}
  /* Typography floor: retain dense panels without reducing scientific context to fine print. */
  .eyebrow,.label-tree em,
  .evidence-bar,dl,.neighbor-list>div,.history{font-size:var(--wb-font-micro,.7rem)}
  label,
  .curation-inspector>code,kbd{font-size:var(--wb-font-caption,.75rem);line-height:var(--wb-line-compact,1.3)}
  .label-tree h3,.curation-inspector h3{font-size:var(--wb-font-small,.8125rem)}
  .label-tree small{font-size:var(--wb-font-micro,.7rem);line-height:var(--wb-line-reading,1.5)}
  @media(max-width:1050px){.curation-workspace{grid-template-columns:220px 1fr}.curation-inspector{grid-column:1/-1;max-height:none}}@media(max-width:700px){.curation-workspace{display:block}.curation-rail,.curation-gallery,.curation-inspector{margin-bottom:10px;max-height:none}}
</style>
