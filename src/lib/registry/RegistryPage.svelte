<script lang="ts">
  import { onMount } from 'svelte';
  import { api, registryUrl } from '$lib/registry/api';
  import { gridMoveIndex, nextSelection, stickyClickSelection } from '$lib/registry/selection';
  import type { CoreVocabulary, Dataset, DatasetDetails, DescriptorTag, EvidenceSource, FileListing, ImportPreview, ImportResult, InferenceSourceDetail, Item, ItemEvidence, Label, VocabularyNode, VocabularySummary } from '$lib/registry/types';
  import { imageDimensions, itemCalibration, type ViewMode } from '$lib/registry/viewModes';
  import { buildOriginalLayout, originalMoveIndex, visibleOriginalEntries } from '$lib/registry/originalLayout';
  import { DIGIT_SHORTCUTS, shortcutLabel, withDefaultShortcuts } from '$lib/registry/preferences';
  import { assignmentOptions, type AssignmentOption } from '$lib/registry/assignmentOptions';
  import { clampPanelWidth, panelKeyDelta, PANEL_DEFAULT_WIDTH, PANEL_MAX_WIDTH, PANEL_MIN_WIDTH, type PanelSide } from '$lib/registry/panelSizing';
  import DescriptorPicker from '$lib/registry/DescriptorPicker.svelte';

  let dataset: Dataset | null = null;
  let labels: Label[] = [];
  let items: Item[] = [];
  let total = 0;
  let path = '';
  let loading = false;
  let error = '';
  let notice = '';
  let annotationState = 'all';
  let reviewState = 'all';
  let labelFilter = '';
  let sort = 'original';
  let randomSeed = 'registry';
  let search = '';
  let page = 0;
  const pageSize = 500;
  let tileSize = 128;
  let selected = new Set<string>();
  let anchor: string | undefined;
  let focused: string | undefined;
  let detail: Record<string, any> | null = null;
  let autoAdvance = true;
  let newLabel = '';
  let gallery: HTMLDivElement;
  let viewportWidth = 900;
  let viewportHeight = 600;
  let scrollTop = 0;
  let fileBrowserOpen = false;
  let fileBrowserPurpose: 'open' | 'import' = 'open';
  let fileListing: FileListing | null = null;
  let fileBrowserLoading = false;
  let viewMode: ViewMode = 'fit';
  let expandedTaxonomy = new Set<string>();
  let preferencesOpen = false;
  let informationOpen = false;
  let informationLoading = false;
  let datasetDetails: DatasetDetails | null = null;
  let importOpen = false;
  let importPath = '';
  let importPreview: ImportPreview | null = null;
  let importResult: ImportResult | null = null;
  let importLoading = false;
  let importIncludeLabels = true;
  let importIncludeEvidence = true;
  let importDuplicatePolicy: 'skip' | 'merge' = 'skip';
  let importDuplicateActions: Record<string,'skip'|'merge'> = {};
  let importDuplicatePage = 0;
  const importDuplicatePageSize = 100;
  let theme: 'light' | 'dark' = 'light';
  let canvasColor = '#111b1f';
  let stickySelection = false;
  let stickyCandidate: string | undefined;
  let leftPanelWidth: number = PANEL_DEFAULT_WIDTH.left;
  let rightPanelWidth: number = PANEL_DEFAULT_WIDTH.right;
  let resizingPanel: PanelSide | null = null;
  let stopPanelResize: (() => void) | undefined;
  let shortcutLabelIds: Record<string, string> = {};
  let vocabularyCatalog: VocabularySummary[] = [];
  let vocabularies: CoreVocabulary[] = [];
  let enabledVocabularyKeys: string[] = [];
  let descriptorTags: DescriptorTag[] = [];
  let assignmentQuery = '';
  let assignmentOpen = false;
  let assignmentIndex = 0;
  let reassignSource: Label | null = null;
  let reassignTarget: AssignmentOption | null = null;
  let reassignQuery = '';
  let reassignOptionsOpen = false;
  let reassignIndex = 0;
  let reassignWorking = false;
  let deprecateReassignedSource = true;
  let evidenceSources: EvidenceSource[] = [];
  let evidenceSource = '';
  let detailEvidence: ItemEvidence[] = [];
  let mlState = 'all';
  let confidenceMin = '';
  let confidenceMax = '';
  let knnSimilarityMin = '';
  let knnAgreementMin = '';
  let prototypeSimilarityMin = '';
  let mlDisagreement = false;
  let browseMode: '' | 'similarity' | 'knn' = '';
  let browseReference = '';
  let similarityMinimum = 0.7;
  let saving = false;

  $: activeLabels = labels.filter((label) => !label.deprecated_at);
  $: columns = Math.max(1, Math.floor((viewportWidth - 16) / (tileSize + 10)));
  $: rowHeight = tileSize + 38;
  $: rowCount = Math.ceil(items.length / columns);
  $: startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - 3);
  $: endRow = Math.min(rowCount, Math.ceil((scrollTop + viewportHeight) / rowHeight) + 3);
  $: visible = viewMode === 'original' ? [] : items.slice(startRow * columns, Math.min(items.length, endRow * columns));
  $: ids = items.map((item) => item.item_id);
  $: physicalReference = dataset?.physical_scale?.reference_um_per_pixel ?? null;
  $: scaleFactor = tileSize / 128;
  $: originalLayout = buildOriginalLayout(items, viewportWidth, scaleFactor);
  $: originalVisible = viewMode === 'original' ? visibleOriginalEntries(originalLayout, scrollTop, viewportHeight) : [];
  $: taxonomyRows = buildTaxonomyRows(activeLabels, vocabularies, expandedTaxonomy);
  $: currentTagIds = new Set<string>((detail?.tags || []).map((tag: DescriptorTag) => tag.tag_id));
  $: assignedTargetTags = descriptorTags.filter((tag) => tag.scope === 'target_tags' && currentTagIds.has(tag.tag_id));
  $: assignedImageTags = descriptorTags.filter((tag) => tag.scope === 'image_tags' && currentTagIds.has(tag.tag_id));
  $: availableAssignments = assignmentOptions(activeLabels, vocabularies, assignmentQuery);
  $: reassignOptions = assignmentOptions(activeLabels, vocabularies, reassignQuery)
    .filter((option) => option.label?.label_id !== reassignSource?.label_id);
  $: activeEvidence = detailEvidence.find((entry) => entry.source_key === evidenceSource);
  $: visibleImportDuplicates = importPreview?.duplicates.slice(importDuplicatePage*importDuplicatePageSize,(importDuplicatePage+1)*importDuplicatePageSize) || [];

  type TaxonomyRow = { id: string; name: string; depth: number; hasChildren: boolean; selectable: boolean; preferred: boolean; label?: Label; concept?: VocabularyNode; vocabularyKey?: string; vocabularyName?: string };

  function buildTaxonomyRows(source: Label[], catalogs: CoreVocabulary[], expanded: Set<string>): TaxonomyRow[] {
    const mapped = new Map(source.filter((label) => label.standard_concept_id).map((label) => [`${label.standard_vocabulary_key || 'pelagia-core@0.1.0'}:${label.standard_concept_id}`, label]));
    const visibleConcepts = new Set(catalogs.flatMap((catalog) => catalog.taxonomy.nodes.map((concept) => `${catalog.catalog_key}:${concept.id}`)));
    const result: TaxonomyRow[] = [];
    for (const catalog of catalogs) {
      const rootId = `vocabulary:${catalog.catalog_key}`;
      result.push({ id: rootId, name: `${catalog.vocabulary.name} v${catalog.vocabulary.version}`, depth: 0,
        hasChildren: true, selectable: false, preferred: true, vocabularyKey: catalog.catalog_key,
        vocabularyName: catalog.vocabulary.name });
      if (!expanded.has(rootId)) continue;
      const children = new Map<string, VocabularyNode[]>();
      for (const concept of catalog.taxonomy.nodes) {
        children.set(concept.parent_id || '', [...(children.get(concept.parent_id || '') || []), concept]);
      }
      const seen = new Set<string>();
      const visit = (concept: VocabularyNode, depth: number) => {
        if (seen.has(concept.id)) return;
        seen.add(concept.id);
        const descendants = children.get(concept.id) || [];
        const rowId = `${catalog.catalog_key}:${concept.id}`;
        result.push({ id: rowId, name: concept.display_name || concept.name, depth,
          hasChildren: descendants.length > 0, selectable: concept.selectable !== false,
          preferred: true, label: mapped.get(rowId), concept, vocabularyKey: catalog.catalog_key,
          vocabularyName: catalog.vocabulary.name });
        if (expanded.has(rowId)) descendants.forEach((child) => visit(child, depth + 1));
      };
      (children.get('') || []).forEach((concept) => visit(concept, 1));
    }
    const custom = source.filter((label) => !label.standard_concept_id || !visibleConcepts.has(`${label.standard_vocabulary_key || 'pelagia-core@0.1.0'}:${label.standard_concept_id}`));
    if (custom.length) {
      result.push({ id: 'dataset-labels', name: 'Dataset labels', depth: 0, hasChildren: true, selectable: false, preferred: false });
      if (expanded.has('dataset-labels')) custom.forEach((label) => result.push({
        id: `local:${label.label_id}`, name: label.display_name || label.name, depth: 1,
        hasChildren: false, selectable: true, preferred: false, label
      }));
    }
    return result;
  }

  function toggleTaxonomy(labelId: string, event: Event) {
    event.stopPropagation();
    const next = new Set(expandedTaxonomy);
    next.has(labelId) ? next.delete(labelId) : next.add(labelId);
    expandedTaxonomy = next;
  }

  function filterByLabel(labelId: string) { labelFilter = labelId; page = 0; loadItems(); }
  function chooseTaxonomy(row: TaxonomyRow) {
    if (row.label) filterByLabel(row.label.label_id);
    else if (row.hasChildren) toggleTaxonomy(row.id, new Event('toggle'));
  }

  async function assignStandardLabel(row: TaxonomyRow, event: Event) {
    event.stopPropagation();
    if (!row.concept || !row.selectable) return;
    const targetCount = selected.size || (focused ? 1 : 0);
    if (!targetCount) {
      error = 'Select an ROI before assigning a taxonomy label.';
      return;
    }
    try {
      const label = row.label || await api.useStandardLabel(row.concept.id, row.vocabularyKey);
      const assigned = await assign(label);
      if (assigned) {
        notice = `${label.display_name || label.name} assigned to ${targetCount.toLocaleString()} ROI${targetCount === 1 ? '' : 's'}.`;
      }
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
  }

  function taxonomyTitle(row: TaxonomyRow) {
    if (!row.concept) return 'Dataset-defined label';
    const identity = [row.concept.scientific_name, row.concept.rank].filter(Boolean).join(' · ');
    const mappings = (row.concept.mappings || []).map((mapping) => `${mapping.authority}: ${mapping.identifier}`).join(' · ');
    return [`${row.vocabularyName || 'Standard vocabulary'}: ${row.concept.id}`, identity, mappings].filter(Boolean).join(' · ');
  }

  function vocabularyPreferenceKey(datasetId: string) { return `pelagia.registry.taxonomies.${datasetId}`; }

  async function setVocabularyEnabled(key: string, enabled: boolean) {
    if (!dataset) return;
    try {
      if (enabled && !enabledVocabularyKeys.includes(key)) {
        const loaded = await api.installedVocabulary(key);
        vocabularies = [...vocabularies, loaded];
        enabledVocabularyKeys = [...enabledVocabularyKeys, key];
        expandedTaxonomy = new Set([...expandedTaxonomy, `vocabulary:${key}`, ...loaded.taxonomy.nodes.map((node) => `${key}:${node.id}`)]);
      } else if (!enabled) {
        enabledVocabularyKeys = enabledVocabularyKeys.filter((value) => value !== key);
        vocabularies = vocabularies.filter((value) => value.catalog_key !== key);
      }
      localStorage.setItem(vocabularyPreferenceKey(dataset.dataset_id), JSON.stringify(enabledVocabularyKeys));
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
  }

  async function reloadVocabularyCatalog() {
    try {
      vocabularyCatalog = await api.reloadVocabularies();
      const available = new Set(vocabularyCatalog.map((entry) => entry.key));
      enabledVocabularyKeys = enabledVocabularyKeys.filter((key) => available.has(key));
      vocabularies = vocabularies.filter((entry) => available.has(entry.catalog_key));
      if (dataset) localStorage.setItem(vocabularyPreferenceKey(dataset.dataset_id), JSON.stringify(enabledVocabularyKeys));
      notice = `${vocabularyCatalog.length} installed taxonom${vocabularyCatalog.length === 1 ? 'y' : 'ies'} found.`;
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
  }
  function isAssigned(item: Item) { return !!item.annotation_id && item.annotation_status !== 'deprecated'; }

  function loadPreferences() {
    try {
      const saved = JSON.parse(localStorage.getItem('pelagia.registry.preferences') || '{}');
      theme = saved.theme === 'dark' ? 'dark' : 'light';
      canvasColor = /^#[0-9a-f]{6}$/i.test(saved.canvasColor) ? saved.canvasColor : '#111b1f';
      stickySelection = saved.stickySelection === true;
      const viewport = window.innerWidth;
      const sizingViewport = viewport <= 900 ? Infinity : viewport;
      const savedLeft = Number.isFinite(saved.leftPanelWidth) ? saved.leftPanelWidth : PANEL_DEFAULT_WIDTH.left;
      const savedRight = Number.isFinite(saved.rightPanelWidth) ? saved.rightPanelWidth : PANEL_DEFAULT_WIDTH.right;
      leftPanelWidth = clampPanelWidth('left', savedLeft, sizingViewport, PANEL_DEFAULT_WIDTH.right);
      rightPanelWidth = clampPanelWidth('right', savedRight, sizingViewport, leftPanelWidth);
      shortcutLabelIds = saved.shortcutLabelIds && typeof saved.shortcutLabelIds === 'object' ? saved.shortcutLabelIds : {};
    } catch {
      shortcutLabelIds = {}; stickySelection = false;
      leftPanelWidth = PANEL_DEFAULT_WIDTH.left; rightPanelWidth = PANEL_DEFAULT_WIDTH.right;
    }
  }

  function savePreferences() {
    localStorage.setItem('pelagia.registry.preferences', JSON.stringify({ theme, canvasColor, stickySelection, leftPanelWidth, rightPanelWidth, shortcutLabelIds }));
  }

  function panelWidth(side: PanelSide) { return side === 'left' ? leftPanelWidth : rightPanelWidth; }
  function otherPanelWidth(side: PanelSide) { return side === 'left' ? rightPanelWidth : leftPanelWidth; }
  function setPanelWidth(side: PanelSide, value: number) {
    const width = clampPanelWidth(side, value, window.innerWidth, otherPanelWidth(side));
    if (side === 'left') leftPanelWidth = width;
    else rightPanelWidth = width;
  }

  function finishPanelResize() {
    stopPanelResize?.();
    stopPanelResize = undefined;
    resizingPanel = null;
    document.body.classList.remove('resizing-panels');
  }

  function startPanelResize(side: PanelSide, event: PointerEvent) {
    if (window.innerWidth <= 900) return;
    event.preventDefault();
    finishPanelResize();
    const startX = event.clientX;
    const startWidth = panelWidth(side);
    resizingPanel = side;
    document.body.classList.add('resizing-panels');
    const move = (moveEvent: PointerEvent) => {
      const movement = side === 'left' ? moveEvent.clientX - startX : startX - moveEvent.clientX;
      setPanelWidth(side, startWidth + movement);
    };
    const finish = () => { finishPanelResize(); savePreferences(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
    stopPanelResize = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }

  function resizePanelWithKeyboard(side: PanelSide, event: KeyboardEvent) {
    const delta = panelKeyDelta(side, event.key);
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    setPanelWidth(side, panelWidth(side) + delta);
    savePreferences();
  }

  function resetPanelWidth(side: PanelSide) {
    setPanelWidth(side, PANEL_DEFAULT_WIDTH[side]);
    savePreferences();
  }

  function fitPanelsToViewport() {
    if (window.innerWidth <= 900) return;
    leftPanelWidth = clampPanelWidth('left', leftPanelWidth, window.innerWidth, rightPanelWidth);
    rightPanelWidth = clampPanelWidth('right', rightPanelWidth, window.innerWidth, leftPanelWidth);
  }

  function setShortcut(digit: string, event: Event) {
    shortcutLabelIds = { ...shortcutLabelIds, [digit]: (event.currentTarget as HTMLSelectElement).value };
    savePreferences();
  }

  function setTheme(value: 'light' | 'dark') { theme = value; savePreferences(); }

  function setCanvasColor(event: Event) {
    canvasColor = (event.currentTarget as HTMLInputElement).value;
    savePreferences();
  }

  function setStickySelection(event: Event) {
    stickySelection = (event.currentTarget as HTMLInputElement).checked;
    stickyCandidate = undefined;
    savePreferences();
  }

  function params() {
    const p = new URLSearchParams({ limit: String(pageSize), offset: String(page * pageSize), annotation_state: annotationState, review: reviewState, sort, random_seed: randomSeed });
    if (labelFilter) p.append('label_id', labelFilter);
    if (search.trim()) p.set('search', search.trim());
    if (evidenceSource) p.set('evidence_source', evidenceSource);
    if (mlState !== 'all') p.set('ml_state', mlState);
    if (confidenceMin !== '') p.set('confidence_min', confidenceMin);
    if (confidenceMax !== '') p.set('confidence_max', confidenceMax);
    if (knnSimilarityMin !== '') p.set('knn_similarity_min', knnSimilarityMin);
    if (knnAgreementMin !== '') p.set('knn_agreement_min', knnAgreementMin);
    if (prototypeSimilarityMin !== '') p.set('prototype_similarity_min', prototypeSimilarityMin);
    if (mlDisagreement) p.set('ml_disagreement', 'true');
    return p;
  }

  async function openDataset() {
    if (!path.trim()) return;
    loading = true; error = ''; notice = '';
    try {
      const openedDataset = await api.open(path.trim(), (message) => notice = message);
      const [openedLabels, openedCatalog, openedTags, openedEvidence] = await Promise.all([api.labels(), api.vocabularies(), api.tags(), api.evidenceSources()]);
      let savedVocabularyKeys: string[] = [];
      try {
        const saved = JSON.parse(localStorage.getItem(vocabularyPreferenceKey(openedDataset.dataset_id)) || 'null');
        if (Array.isArray(saved)) savedVocabularyKeys = saved;
        else savedVocabularyKeys = [...new Set(openedLabels.map((label) => label.standard_vocabulary_key).filter((key): key is string => !!key))];
      } catch { savedVocabularyKeys = []; }
      savedVocabularyKeys = savedVocabularyKeys.filter((key) => openedCatalog.some((entry) => entry.key === key));
      const openedVocabularies = await Promise.all(savedVocabularyKeys.map((key) => api.installedVocabulary(key)));
      dataset = openedDataset; labels = openedLabels; vocabularyCatalog = openedCatalog; vocabularies = openedVocabularies; enabledVocabularyKeys = savedVocabularyKeys; descriptorTags = openedTags; evidenceSources = openedEvidence;
      evidenceSource = openedEvidence[0]?.source_key || '';
      path = openedDataset.path; localStorage.setItem('pelagia.registry.lastPath', path);
      if (openedDataset.thawed_from_path) notice = `Frozen source preserved. Working copy opened: ${openedDataset.path}`;
      else if (openedDataset.backup_path) notice = `Migration backup: ${openedDataset.backup_path}`;
      expandedTaxonomy = new Set(['dataset-labels', ...openedVocabularies.flatMap((catalog) => [`vocabulary:${catalog.catalog_key}`, ...catalog.taxonomy.nodes.map((node) => `${catalog.catalog_key}:${node.id}`)])]);
      shortcutLabelIds = withDefaultShortcuts(openedLabels, shortcutLabelIds); savePreferences();
      page = 0; await loadItems();
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
    finally { loading = false; }
  }

  async function saveDataset(replaceSource = false) {
    if (!dataset || saving) return;
    const suggested = dataset.path || path;
    const destination = replaceSource ? suggested : window.prompt('Save Registry dataset as:', suggested);
    if (!destination) return;
    saving = true; error = ''; notice = '';
    try {
      const result = await api.exportDataset(destination, replaceSource, (message) => notice = message);
      notice = `Saved revision ${result.revision_id} to ${result.path}${result.backup_path ? ` · backup ${result.backup_path}` : ''}`;
      dataset = await api.dataset();
      path = result.path;
      localStorage.setItem('pelagia.registry.lastPath', path);
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
    finally { saving = false; }
  }

  async function purgeDataset() {
    if (!dataset || !window.confirm('Purge this loaded PostgreSQL workspace? Save it first if you need its unsaved changes.')) return;
    error = '';
    try {
      await api.purgeDataset();
      dataset = null; items = []; labels = []; selected = new Set();
      notice = 'Loaded Registry data was purged from PostgreSQL. The source SQLite file was not changed.';
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
  }

  async function browseFiles(nextPath?: string, purpose?: 'open' | 'import') {
    if (purpose) fileBrowserPurpose = purpose;
    fileBrowserOpen = true; fileBrowserLoading = true; error = '';
    try { fileListing = await api.files(nextPath); }
    catch (e) { error = e instanceof Error ? e.message : String(e); }
    finally { fileBrowserLoading = false; }
  }

  function chooseFile(filePath: string) {
    fileBrowserOpen = false;
    if (fileBrowserPurpose === 'import') {
      importPath = filePath; inspectImport();
    } else {
      path = filePath; localStorage.setItem('pelagia.registry.lastPath', path);
    }
  }

  function formatBytes(value?: number) {
    if (value === undefined || value === null) return '';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
    return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  function humanize(value: string) {
    return value.replace(/_/g,' ').replace(/\b\w/g,(letter)=>letter.toUpperCase());
  }

  function detailValue(value: unknown) {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'number') return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined,{maximumFractionDigits:4});
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
  }

  function scalarEntries(record?: Record<string, any>, excluded: string[] = []) {
    if (!record) return [];
    return Object.entries(record).filter(([key,value]) => !excluded.includes(key) && value !== null && value !== '' && typeof value !== 'object');
  }

  function hasContent(value: unknown) {
    return !!value && typeof value === 'object' && Object.keys(value as Record<string,unknown>).length > 0;
  }

  function evidenceCoverage(source: InferenceSourceDetail) {
    const totalItems = datasetDetails?.summary.stats.total || 0;
    return totalItems ? Math.min(100, source.evidence.item_count / totalItems * 100) : 0;
  }

  function sourceRecord(source: InferenceSourceDetail) {
    if (source.legacy) return source.legacy;
    return {
      ...(source.model || {}),
      run_status: source.run?.status,
      run_created_at: source.run?.created_at,
      completed_at: source.run?.completed_at,
      software_version: source.run?.software_version,
      model_run_id: source.run?.model_run_id,
      dataset_fingerprint_sha256: source.run?.dataset_fingerprint_sha256,
    };
  }

  async function openInformation() {
    informationOpen = true; informationLoading = true; datasetDetails = null;
    try { datasetDetails = await api.datasetDetails(); }
    catch (e) { error = e instanceof Error ? e.message : String(e); informationOpen = false; }
    finally { informationLoading = false; }
  }

  function openImport() {
    informationOpen = false; importOpen = true; importPath = ''; importPreview = null; importResult = null;
    importDuplicateActions = {}; importDuplicatePolicy = 'skip'; importDuplicatePage = 0;
  }

  async function inspectImport() {
    if (!importPath.trim()) return;
    importLoading = true; importPreview = null; importResult = null; error = '';
    try {
      importPreview = await api.importPreview(importPath.trim());
      importIncludeLabels = importPreview.labels.available || importPreview.descriptors.available;
      importIncludeEvidence = importPreview.evidence.available;
      importDuplicateActions = {}; importDuplicatePolicy = 'skip'; importDuplicatePage = 0;
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
    finally { importLoading = false; }
  }

  function setImportDuplicate(itemId: string, event: Event) {
    importDuplicateActions = { ...importDuplicateActions,
      [itemId]: (event.currentTarget as HTMLSelectElement).value as 'skip'|'merge' };
  }

  function applyDuplicatePolicy(policy: 'skip'|'merge') {
    importDuplicatePolicy = policy; importDuplicateActions = {};
  }

  async function executeImport() {
    if (!importPreview) return;
    importLoading = true; error = '';
    try {
      importResult = await api.importDataset({ path: importPreview.source.path,
        include_labels: importIncludeLabels, include_evidence: importIncludeEvidence,
        duplicate_policy: importDuplicatePolicy, duplicate_actions: importDuplicateActions });
      await refresh();
      evidenceSources = await api.evidenceSources();
      if (!evidenceSources.some((source)=>source.source_key===evidenceSource)) evidenceSource = evidenceSources[0]?.source_key || '';
      datasetDetails = await api.datasetDetails();
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
    finally { importLoading = false; }
  }

  async function loadItems() {
    if (!dataset) return;
    loading = true; error = '';
    try {
      const result = browseMode === 'similarity' && browseReference && evidenceSource
        ? await api.similar(browseReference,evidenceSource,pageSize,page*pageSize,similarityMinimum)
        : browseMode === 'knn' && browseReference && evidenceSource
          ? await api.neighbors(browseReference,evidenceSource)
          : await api.items(params());
      items = result.items; total = result.total;
      const initialReference = browseMode && items.some((item)=>item.item_id===browseReference)
        ? browseReference : undefined;
      selected = initialReference ? new Set([initialReference]) : new Set();
      focused = initialReference || items[0]?.item_id; anchor = initialReference;
      stickyCandidate = undefined;
      gallery?.scrollTo({ top: 0 }); await loadDetail();
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
    finally { loading = false; }
  }

  async function refresh() {
    if (!dataset) return;
    const [summary, newLabels, newTags, result] = await Promise.all([api.dataset(), api.labels(), api.tags(), api.items(params())]);
    dataset = summary; labels = newLabels; descriptorTags = newTags; items = result.items; total = result.total; await loadDetail();
  }

  async function loadDetail() {
    if (!focused) { detail = null; detailEvidence = []; return; }
    try {
      const [itemDetail,itemEvidence] = await Promise.all([api.item(focused), evidenceSource ? api.itemEvidence(focused,evidenceSource) : Promise.resolve([])]);
      detail = itemDetail; detailEvidence = itemEvidence;
    } catch { detail = null; detailEvidence = []; }
  }

  function evidenceLabel(labelId?: string) {
    if (!labelId) return 'Unavailable';
    const label = labels.find((value) => value.label_id === labelId);
    return label?.display_name || label?.name || labelId;
  }

  function formatScore(value?: number) { return value === undefined || value === null ? '—' : value.toFixed(3); }

  async function changeEvidenceSource() {
    browseMode = ''; browseReference = ''; page = 0;
    await loadItems(); await loadDetail();
  }

  function findSimilar() {
    if (!focused || !evidenceSource) return;
    browseReference = focused; browseMode = 'similarity'; page = 0; loadItems();
  }

  function showNeighbors() {
    if (!focused || !evidenceSource) return;
    browseReference = focused; browseMode = 'knn'; page = 0; loadItems();
  }

  function clearEvidenceBrowse() { browseMode = ''; browseReference = ''; page = 0; loadItems(); }

  function select(item: Item, event: MouseEvent) {
    const modifiers = { toggle: event.metaKey || event.ctrlKey, range: event.shiftKey };
    if (stickySelection && !modifiers.toggle && !modifiers.range) {
      const result = stickyClickSelection(selected,item.item_id,stickyCandidate);
      selected = result.selected; stickyCandidate = result.armed; anchor = item.item_id;
    } else {
      const result = nextSelection(selected,ids,item.item_id,modifiers,anchor);
      selected = result.selected; anchor = result.anchor; stickyCandidate = undefined;
    }
    focused = item.item_id; loadDetail();
  }

  function advance() {
    if (!focused) return;
    const next = ids.indexOf(focused) + 1;
    if (next < ids.length) {
      focused = ids[next]; selected = new Set([focused]); anchor = focused; loadDetail();
      scrollToIndex(next);
    }
  }

  function scrollToIndex(index: number) {
    if (!gallery || index < 0) return;
    if (viewMode === 'original') {
      const entry = originalLayout.entries[index];
      if (!entry) return;
      if (entry.y < gallery.scrollTop) gallery.scrollTo({ top: Math.max(0, entry.y - 8) });
      else if (entry.y + entry.height > gallery.scrollTop + viewportHeight) gallery.scrollTo({ top: entry.y + entry.height - viewportHeight + 8 });
      return;
    }
    const row = Math.floor(index / columns);
    const top = row * rowHeight;
    if (top < gallery.scrollTop) gallery.scrollTo({ top: Math.max(0, top - 8) });
    else if (top + rowHeight > gallery.scrollTop + viewportHeight) gallery.scrollTo({ top: top + rowHeight - viewportHeight + 8 });
  }

  function moveSelection(event: KeyboardEvent) {
    if (!items.length) return;
    const currentIndex = focused ? ids.indexOf(focused) : 0;
    const nextIndex = viewMode === 'original'
      ? originalMoveIndex(originalLayout, currentIndex, event.key)
      : gridMoveIndex(currentIndex, event.key, columns, items.length);
    if (nextIndex < 0) return;
    const nextId = ids[nextIndex];
    event.preventDefault();
    stickyCandidate = undefined;
    if (event.shiftKey) {
      const rangeAnchor = anchor ?? focused ?? nextId;
      const [start, end] = [ids.indexOf(rangeAnchor), nextIndex].sort((a, b) => a - b);
      selected = new Set(ids.slice(start, end + 1));
      anchor = rangeAnchor;
    } else if (!event.metaKey && !event.ctrlKey) {
      selected = new Set([nextId]);
      anchor = nextId;
    }
    focused = nextId; loadDetail(); scrollToIndex(nextIndex);
  }

  function imageStyle(item: Item): string {
    const dimensions = imageDimensions(item, viewMode, tileSize, physicalReference);
    const width = dimensions.width === null ? 'auto' : `${dimensions.width}px`;
    const height = dimensions.height === null ? 'auto' : `${dimensions.height}px`;
    return `width:${width};height:${height};object-fit:${dimensions.objectFit ?? 'fill'}`;
  }

  function imageSource(item: Item): string {
    return viewMode === 'original'
      ? registryUrl(`/api/items/${item.item_id}/image`)
      : registryUrl(`/api/items/${item.item_id}/thumbnail?size=${Math.max(192,tileSize*2)}`);
  }

  function descriptorSummary(item: Item) {
    return (item.descriptor_indicators || []).map((descriptor) =>
      `${descriptor.name} (${descriptor.scope === 'target_tags' ? 'target' : 'image'} descriptor)`).join(', ');
  }

  async function assign(label: Label): Promise<boolean> {
    const targets = selected.size ? [...selected] : focused ? [focused] : [];
    if (!targets.length) return false;
    const snapshot = items;
    items = items.map((item) => targets.includes(item.item_id) ? { ...item, label_id: label.label_id, label_name: label.name, label_display_name: label.display_name || label.name, annotation_id: 'pending' } : item);
    try {
      await api.annotate(targets, label.label_id); await refresh();
      if (autoAdvance && targets.length === 1) advance();
      return true;
    } catch (e) {
      items = snapshot; error = e instanceof Error ? e.message : String(e);
      return false;
    }
  }

  async function selectAssignment(option: AssignmentOption) {
    assignmentOpen = false; assignmentQuery = ''; assignmentIndex = 0;
    try {
      const label = option.label || (option.concept ? await api.useStandardLabel(option.concept.id, option.vocabularyKey) : undefined);
      if (!label) return;
      if (!option.label) labels = await api.labels();
      await assign(label);
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
  }

  function openReassign(label: Label) {
    preferencesOpen = false;
    reassignSource = label; reassignTarget = null; reassignQuery = '';
    reassignIndex = 0; reassignOptionsOpen = false; deprecateReassignedSource = true;
  }

  function selectReassignTarget(option: AssignmentOption) {
    reassignTarget = option; reassignQuery = option.name; reassignOptionsOpen = false;
  }

  function reassignKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault(); reassignOptionsOpen = true;
      reassignIndex = Math.min(Math.max(0,reassignOptions.length-1),reassignIndex+1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault(); reassignIndex = Math.max(0,reassignIndex-1);
    } else if (event.key === 'Enter' && reassignOptionsOpen && reassignOptions[reassignIndex]) {
      event.preventDefault(); selectReassignTarget(reassignOptions[reassignIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault(); reassignOptionsOpen = false;
    }
  }

  async function confirmReassign() {
    if (!reassignSource || !reassignTarget) return;
    reassignWorking = true; error = '';
    try {
      const target = reassignTarget.label || (reassignTarget.concept ? await api.useStandardLabel(reassignTarget.concept.id, reassignTarget.vocabularyKey) : undefined);
      if (!target) return;
      if (target.label_id === reassignSource.label_id) {
        notice = `${target.display_name || target.name} is now linked to the preferred standardized concept.`;
      } else {
        const result = await api.reassignLabel(reassignSource.label_id,target.label_id,deprecateReassignedSource);
        notice = `${result.reassigned_count.toLocaleString()} ROIs reassigned to ${target.display_name || target.name}.`;
      }
      reassignSource = null; reassignTarget = null; await refresh();
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
    finally { reassignWorking = false; }
  }

  function assignmentKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault(); assignmentOpen = true;
      assignmentIndex = Math.min(availableAssignments.length - 1, assignmentIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault(); assignmentIndex = Math.max(0, assignmentIndex - 1);
    } else if (event.key === 'Enter' && assignmentOpen && availableAssignments[assignmentIndex]) {
      event.preventDefault(); selectAssignment(availableAssignments[assignmentIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault(); assignmentOpen = false;
    }
  }

  async function review(decision: string) {
    const targets = selected.size ? [...selected] : focused ? [focused] : [];
    if (!targets.length) return;
    try { await api.review(targets, decision); await refresh(); }
    catch (e) { error = e instanceof Error ? e.message : String(e); }
  }

  async function removeLabels() {
    const targets = selected.size ? [...selected] : focused ? [focused] : [];
    if (!targets.length) return;
    try { await api.removeLabels(targets); await refresh(); if (autoAdvance && targets.length === 1) advance(); }
    catch (e) { error = e instanceof Error ? e.message : String(e); }
  }

  async function toggleDescriptor(tag: DescriptorTag, assigned: boolean) {
    const targets = selected.size ? [...selected] : focused ? [focused] : [];
    if (!targets.length) return;
    try { await api.setTag(targets, tag.tag_id, assigned); await refresh(); }
    catch (e) { error = e instanceof Error ? e.message : String(e); }
  }

  async function createCustomTag(scope: 'target_tags' | 'image_tags', name: string) {
    if (!name.trim()) return;
    try {
      const tag = await api.addTag({ name: name.trim(), scope });
      descriptorTags = await api.tags();
      await toggleDescriptor(tag, true);
    }
    catch (e) { error = e instanceof Error ? e.message : String(e); }
  }

  async function undo() {
    try { await api.undo(); notice = 'Last operation undone with compensating provenance.'; await refresh(); }
    catch (e) { error = e instanceof Error ? e.message : String(e); }
  }

  async function createLabel() {
    if (!newLabel.trim()) return;
    try { await api.addLabel({ name: newLabel.trim(), display_name: newLabel.trim() }); newLabel = ''; labels = await api.labels(); }
    catch (e) { error = e instanceof Error ? e.message : String(e); }
  }

  async function deprecate(label: Label) {
    try { await api.updateLabel(label.label_id, { deprecated: !label.deprecated_at }); labels = await api.labels(); await refresh(); }
    catch (e) { error = e instanceof Error ? e.message : String(e); }
  }

  async function renameLabel(label: Label) {
    const value = window.prompt('Display name', label.display_name || label.name);
    if (!value?.trim()) return;
    try { await api.updateLabel(label.label_id, { display_name: value.trim() }); labels = await api.labels(); await refresh(); }
    catch (e) { error = e instanceof Error ? e.message : String(e); }
  }

  function keydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (importOpen) {
      if (event.key === 'Escape' && !importLoading) { event.preventDefault(); importOpen = false; }
      return;
    }
    if (reassignSource) {
      if (event.key === 'Escape') { event.preventDefault(); reassignSource = null; }
      return;
    }
    if (preferencesOpen) {
      if (event.key === 'Escape') { event.preventDefault(); preferencesOpen = false; }
      return;
    }
    if (informationOpen) {
      if (event.key === 'Escape') { event.preventDefault(); informationOpen = false; }
      return;
    }
    if (['INPUT','TEXTAREA','SELECT'].includes(target.tagName) || target.isContentEditable) return;
    if (event.key.startsWith('Arrow')) { moveSelection(event); return; }
    if (event.key === 'Escape') { selected = new Set(); stickyCandidate = undefined; return; }
    if (event.key.toLowerCase() === 'u') { event.preventDefault(); undo(); return; }
    if (event.key.toLowerCase() === 'f') { event.preventDefault(); review('needs_review'); return; }
    if (event.code === 'Space') { event.preventDefault(); review('verified'); return; }
    if (/^[0-9]$/.test(event.key)) {
      const label = shortcutLabel(activeLabels, shortcutLabelIds, event.key);
      if (label) { event.preventDefault(); assign(label); }
    }
  }

  onMount(() => {
    loadPreferences();
    window.addEventListener('keydown', keydown);
    window.addEventListener('resize', fitPanelsToViewport);
    const stored = localStorage.getItem('pelagia.registry.lastPath');
    if (stored) path = stored;
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('resize', fitPanelsToViewport);
      finishPanelResize();
    };
  });

  function resize(node: HTMLElement) {
    const observer = new ResizeObserver(([entry]) => { viewportWidth = entry.contentRect.width; viewportHeight = entry.contentRect.height; });
    observer.observe(node); return { destroy: () => observer.disconnect() };
  }
</script>

<svelte:head><title>Registry · Scientific image curation</title><meta name="description" content="Scientific image curation" /><meta property="og:image" content="/brand/pelagia_logo.png" /></svelte:head>

{#if !dataset}
  <main class="open-screen">
    <section class="open-panel">
      <img class="brand-logo" src="/brand/pelagia_logo.png" alt="Registry" />
      <p>Load an Oracle Dataset SQLite revision into a project-scoped PostgreSQL curation workspace.</p>
      <label for="dataset-path">Dataset path</label>
      <div class="open-row">
        <input id="dataset-path" bind:value={path} on:keydown={(e) => e.key === 'Enter' && openDataset()} placeholder="/path/to/dataset.sqlite" spellcheck="false" />
        <button on:click={() => browseFiles(undefined,'open')}>Browse…</button>
        <button class="primary" on:click={() => { localStorage.setItem('pelagia.registry.lastPath', path); openDataset(); }} disabled={loading}>{loading ? 'Opening…' : 'Open dataset'}</button>
      </div>
      <small>The source remains unchanged until you explicitly save a new revision back to SQLite.</small>
      {#if error}<div class="message error">{error}</div>{/if}
    </section>
    {#if fileBrowserOpen}
      <div class="browser-backdrop" role="presentation" on:click={(event) => event.currentTarget === event.target && (fileBrowserOpen = false)}>
        <div class="file-browser" role="dialog" aria-modal="true" aria-labelledby="file-browser-title" tabindex="-1">
          <div class="browser-header"><div><span>SERVER FILES</span><h2 id="file-browser-title">Choose a SQLite dataset</h2></div><button aria-label="Close file browser" on:click={() => fileBrowserOpen = false}>×</button></div>
          {#if fileListing}
            <div class="locations">{#each fileListing.roots as root}<button class:active={root === fileListing.root_path} on:click={() => browseFiles(root)} title={root}>{root}</button>{/each}</div>
            <div class="browser-path"><button disabled={!fileListing.parent_path} on:click={() => fileListing?.parent_path && browseFiles(fileListing.parent_path)}>↑ Up</button><code>{fileListing.current_path}</code></div>
            <div class="file-list" aria-busy={fileBrowserLoading}>
              {#each fileListing.entries as entry}
                <button class:directory={entry.is_directory} class="file-row" on:click={() => entry.is_directory ? browseFiles(entry.path) : chooseFile(entry.path)}>
                  <span class="file-icon">{entry.is_directory ? '▸' : 'DB'}</span><span class="file-name">{entry.name}</span><span class="file-size">{formatBytes(entry.size)}</span>
                </button>
              {/each}
              {#if !fileBrowserLoading && !fileListing.entries.length}<div class="empty">No folders or SQLite files in this location.</div>{/if}
            </div>
          {:else if fileBrowserLoading}<div class="empty">Loading server files…</div>{/if}
          <div class="browser-footer"><span>Directories and SQLite database files only</span><button on:click={() => fileBrowserOpen = false}>Cancel</button></div>
        </div>
      </div>
    {/if}
  </main>
{:else}
  <main class:dark={theme==='dark'} class="workspace" style={`--canvas-color:${canvasColor};--left-panel-width:${leftPanelWidth}px;--right-panel-width:${rightPanelWidth}px`}>
    <header>
      <div class="wordmark"><img src="/brand/pelagia_icon.png" alt="" /><div><span>PELAGIA</span><strong>Registry</strong></div></div>
      <div class="dataset-title"><strong>{dataset.title || dataset.name}</strong><span>{dataset.dataset_type.replace('_',' ')} · {dataset.lifecycle}</span></div>
      <div class="header-stats" aria-label="Dataset counts">
        <div title="Total ROIs"><strong>{dataset.stats.total.toLocaleString()}</strong><span>Total</span></div>
        <div title="Labeled ROIs"><strong>{dataset.stats.labeled.toLocaleString()}</strong><span>Labeled</span></div>
        <div title="Unlabeled ROIs"><strong>{dataset.stats.unlabeled.toLocaleString()}</strong><span>Unlabeled</span></div>
        <div title="Verified ROIs"><strong>{dataset.stats.verified.toLocaleString()}</strong><span>Verified</span></div>
        <div title="ROIs needing review"><strong>{dataset.stats.needs_review.toLocaleString()}</strong><span>Review</span></div>
        <div title="Active labels"><strong>{dataset.stats.active_labels.toLocaleString()}</strong><span>Labels</span></div>
      </div>
      <div class="search"><input aria-label="Search items" bind:value={search} on:keydown={(e) => e.key === 'Enter' && (page=0,loadItems())} placeholder="Search source key or ID" /><button on:click={() => {page=0;loadItems()}}>Search</button></div>
      <button class="quiet information-button" on:click={openInformation}>ⓘ Details</button>
      <button class="quiet preferences-button" on:click={() => preferencesOpen = true}>⚙ Preferences</button>
      <button class="quiet" disabled={saving} on:click={() => saveDataset(false)}>{saving ? 'Saving…' : 'Save as…'}</button>
      <button class="quiet" disabled={saving} on:click={() => saveDataset(true)}>Save source</button>
      <button class="quiet" on:click={purgeDataset}>Purge</button>
      <button class="quiet" on:click={() => dataset = null}>Close</button>
    </header>

    <aside class="filters">
      <section>
        <h2>Annotation state</h2>
        <div class="segmented">{#each ['all','unlabeled','labeled'] as state}<button class:active={annotationState===state} on:click={() => {annotationState=state;page=0;loadItems()}}>{state}</button>{/each}</div>
      </section>
      <section>
        <h2>Review</h2>
        <select bind:value={reviewState} on:change={() => {page=0;loadItems()}}><option value="all">All review states</option><option value="unreviewed">Unreviewed</option><option value="verified">Verified</option><option value="needs_review">Needs review</option><option value="rejected">Rejected</option></select>
      </section>
      {#if evidenceSources.length}<section class="ml-filters">
        <h2>ML evidence</h2>
        <label>Evidence source<select bind:value={evidenceSource} on:change={changeEvidenceSource}>{#each evidenceSources as source}<option value={source.source_key}>{source.source_name}</option>{/each}</select></label>
        <label>Coverage<select bind:value={mlState}><option value="all">All ROIs</option><option value="with">With evidence</option><option value="without">Without evidence</option></select></label>
        <div class="metric-pair"><label>Confidence ≥<input type="number" min="0" max="1" step="0.05" bind:value={confidenceMin} placeholder="any" /></label><label>Confidence ≤<input type="number" min="0" max="1" step="0.05" bind:value={confidenceMax} placeholder="any" /></label></div>
        {#if evidenceSources.find((source)=>source.source_key===evidenceSource)?.capabilities.knn}<div class="metric-pair"><label>KNN similarity ≥<input type="number" min="-1" max="1" step="0.05" bind:value={knnSimilarityMin} placeholder="any" /></label><label>KNN agreement ≥<input type="number" min="0" max="1" step="0.05" bind:value={knnAgreementMin} placeholder="any" /></label></div>{/if}
        {#if evidenceSources.find((source)=>source.source_key===evidenceSource)?.capabilities.prototype}<label>Prototype similarity ≥<input type="number" min="-1" max="1" step="0.05" bind:value={prototypeSimilarityMin} placeholder="any" /></label>{/if}
        <label class="ml-check"><input type="checkbox" bind:checked={mlDisagreement} /> Prediction differs from assigned label</label>
        <div class="ml-actions"><button on:click={() => {page=0;loadItems()}}>Apply</button><button on:click={() => {mlState='all';confidenceMin='';confidenceMax='';knnSimilarityMin='';knnAgreementMin='';prototypeSimilarityMin='';mlDisagreement=false;page=0;loadItems()}}>Clear</button></div>
      </section>{/if}
      <section class="taxonomy">
        <div class="taxonomy-title"><h2>Taxonomy</h2></div>
        <div class="taxonomy-columns"><span>Label</span><span title="Verified">V</span><span title="Unverified">U</span><span title="ML predictions">ML</span></div>
        <button class:active={!labelFilter} class="taxonomy-row taxonomy-all" on:click={() => filterByLabel('')}><span>All labels</span><em>{dataset.stats.labeled.toLocaleString()}</em></button>
        <div class="taxonomy-list">
          {#each taxonomyRows as row (row.id)}
            <button class:active={!!row.label && labelFilter===row.label.label_id} class:unmaterialized={row.preferred&&!row.label} class="taxonomy-row" style={`--depth:${row.depth}`} title={taxonomyTitle(row)} on:click={() => chooseTaxonomy(row)}>
              {#if row.hasChildren}<span class="tree-toggle" role="button" tabindex="0" on:click={(event) => toggleTaxonomy(row.id,event)} on:keydown={(event) => event.key === 'Enter' && toggleTaxonomy(row.id,event)}>{expandedTaxonomy.has(row.id)?'▾':'▸'}</span>{:else}<span class="tree-toggle">·</span>{/if}
              <span class="taxonomy-name">{row.name}{#if row.preferred}<sup title="Enabled standardized concept">◆</sup>{/if}{#if row.preferred && row.selectable}<span class="use-standard" role="button" tabindex="0" title="Assign selected ROI(s) to this standardized label" on:click={(event)=>assignStandardLabel(row,event)} on:keydown={(event)=>event.key==='Enter'&&assignStandardLabel(row,event)}>＋</span>{/if}</span>
              <em class="count-verified" title="Verified">{row.label?.verified_count||0}</em><em class="count-unverified" title="Unverified">{row.label?.unverified_count||0}</em><em class="count-ml" title="ML predictions">{row.label?.ml_count||0}</em>
            </button>
          {/each}
          {#if !taxonomyRows.length}<div class="taxonomy-empty">No dataset labels or optional taxonomies to display.</div>{/if}
        </div>
        <small>◆ enabled standardized concept · ＋ assign selected ROI(s)<br />V verified · U unverified · ML prediction evidence</small>
      </section>
    </aside>

    <!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_noninteractive_element_interactions (ARIA separator is keyboard-adjustable) -->
    <div class:active={resizingPanel==='left'} class="panel-resizer left-panel-resizer" role="separator" aria-orientation="vertical" aria-label="Resize filters and taxonomy panel" aria-valuemin={PANEL_MIN_WIDTH.left} aria-valuemax={PANEL_MAX_WIDTH.left} aria-valuenow={leftPanelWidth} tabindex="0" title="Drag to resize · Arrow keys adjust · Double-click resets" on:pointerdown={(event)=>startPanelResize('left',event)} on:keydown={(event)=>resizePanelWithKeyboard('left',event)} on:dblclick={()=>resetPanelWidth('left')}><span></span></div>

    <section class="gallery-region">
      <div class="gallery-tools">
        <div>{#if browseMode}<button class="browse-mode" on:click={clearEvidenceBrowse}>× {browseMode==='knn'?'Recorded KNN':'Embedding similarity'}</button>{/if}{#if stickySelection}<span class="sticky-indicator" title="First click focuses; second click selects">Sticky selection</span>{/if}<strong>{total.toLocaleString()}</strong> matching <span class="divider">·</span> page {page+1} of {Math.max(1,Math.ceil(total/pageSize))}</div>
        <fieldset class="view-modes" aria-label="Image view mode"><label><input type="radio" bind:group={viewMode} value="fit" />Fit tile</label><label><input type="radio" bind:group={viewMode} value="original" />Original pixels</label><label title={physicalReference ? `Relative physical scale; dataset median calibration ${physicalReference.toFixed(3)} µm/pixel (${dataset.physical_scale.calibrated_items}/${dataset.physical_scale.total_items} calibrated)` : 'Unavailable: this dataset has no pixel-to-length calibration metadata'}><input type="radio" bind:group={viewMode} value="physical" disabled={!physicalReference} />Physical scale</label><label><input type="radio" bind:group={viewMode} value="normalize-height" />Normalize height</label></fieldset>
        <div class="tool-group">{#if browseMode==='similarity'}<label>Minimum <input class="metric-input" type="number" min="-1" max="1" step="0.05" bind:value={similarityMinimum} on:change={() => {page=0;loadItems()}} /></label>{:else}<label>Sort <select bind:value={sort} on:change={loadItems}><option value="original">Dataset order</option><option value="annotation">Annotation state</option><option value="label">Label</option><optgroup label="ROI canvas size"><option value="image_area_asc">Pixel area · smallest</option><option value="image_area_desc">Pixel area · largest</option><option value="longest_side_asc">Longest side · shortest</option><option value="longest_side_desc">Longest side · longest</option></optgroup>{#if evidenceSource}<optgroup label="ML evidence"><option value="ml_confidence_desc">Confidence · highest</option><option value="ml_confidence_asc">Confidence · lowest</option><option value="ml_knn_desc">KNN similarity · highest</option><option value="ml_knn_asc">KNN similarity · lowest</option><option value="ml_agreement_asc">KNN agreement · lowest</option><option value="ml_prototype_desc">Prototype similarity · highest</option><option value="ml_prototype_margin_asc">Prototype margin · lowest</option></optgroup>{/if}<option value="random">Random</option></select></label>{/if}{#if sort==='random'&&!browseMode}<input class="seed" aria-label="Random seed" bind:value={randomSeed} on:change={loadItems} />{/if}<label class="scale-control">Scale <input aria-label="Relative gallery scale" type="range" min="64" max="256" step="16" bind:value={tileSize} /><output>{scaleFactor.toFixed(1)}×</output></label></div>
      </div>
      <div class="gallery" bind:this={gallery} use:resize on:scroll={() => scrollTop=gallery.scrollTop} aria-label="ROI gallery">
        {#if viewMode === 'original'}
          <div class="gallery-spacer original-spacer" style={`height:${originalLayout.height}px;width:${originalLayout.width}px`}>
            {#each originalVisible as placement (items[placement.index].item_id)}
              {@const item = items[placement.index]}
              <button class:selected={selected.has(item.item_id)} class:focused={focused===item.item_id} class:reference-roi={!!browseMode&&item.item_id===browseReference} class:verified={item.review_decision==='verified'} class:needs-review={item.review_decision==='needs_review'} class:rejected={item.review_decision==='rejected'} class:labeled={isAssigned(item)} class:compact={!placement.showLabel} class="tile original-tile" style={`left:${placement.x}px;top:${placement.y}px;width:${placement.width}px;height:${placement.height}px`} on:click={(event)=>select(item,event)} title={`${item.label_display_name||'Unlabeled'} · ${item.source_key||item.item_id} · ${item.shape?.[1]||'?'}×${item.shape?.[0]||'?'} px`}>
                <span class="image-wrap original-stage" style={`width:${placement.imageWidth}px;height:${placement.imageHeight}px`}><img class="original" style={`width:${placement.imageWidth}px;height:${placement.imageHeight}px`} loading="lazy" src={imageSource(item)} alt={item.label_display_name ? `ROI labeled ${item.label_display_name}` : 'Unlabeled ROI'} />{#if item.descriptor_indicators?.length}<span class="descriptor-leds" role="img" aria-label={descriptorSummary(item)}>{#each item.descriptor_indicators as descriptor}<i class:target-descriptor={descriptor.scope==='target_tags'} class:image-descriptor={descriptor.scope==='image_tags'} title={`${descriptor.name} · ${descriptor.scope==='target_tags'?'target':'image'} descriptor`}></i>{/each}</span>{/if}{#if item.similarity!==undefined}<small class:reference-score={item.item_id===browseReference} class="ml-score">{item.item_id===browseReference?'target':'sim'} {item.similarity.toFixed(3)}</small>{:else if item.prediction_confidence!==undefined&&item.prediction_confidence!==null}<small class="ml-score">ML {item.prediction_confidence.toFixed(2)}</small>{/if}</span>
                {#if placement.showLabel}<span class="tile-meta"><span>{isAssigned(item) ? item.label_display_name : 'Unlabeled'}</span>{#if item.label_origin==='classification' && isAssigned(item)}<b title={`Classification source: ${item.annotation_source || 'dataset'}`}>data</b>{/if}{#if item.review_decision}<i title={item.review_decision}>{item.review_decision==='verified'?'✓':'!'}</i>{/if}</span>{/if}
              </button>
            {/each}
          </div>
        {:else}
          <div class="gallery-spacer" style={`height:${rowCount*rowHeight}px`}>
            <div class="tile-grid" style={`--tile:${tileSize}px;--columns:${columns};transform:translateY(${startRow*rowHeight}px)`}>
              {#each visible as item (item.item_id)}
                <button class:selected={selected.has(item.item_id)} class:focused={focused===item.item_id} class:reference-roi={!!browseMode&&item.item_id===browseReference} class:verified={item.review_decision==='verified'} class:needs-review={item.review_decision==='needs_review'} class:rejected={item.review_decision==='rejected'} class:labeled={isAssigned(item)} class="tile" on:click={(event)=>select(item,event)} title={item.source_key||item.item_id}>
                  <span class="image-wrap"><img class={viewMode} style={imageStyle(item)} loading="lazy" src={imageSource(item)} alt={item.label_display_name ? `ROI labeled ${item.label_display_name}` : 'Unlabeled ROI'} />{#if viewMode === 'physical' && !itemCalibration(item)}<small class="no-calibration">no scale</small>{/if}{#if item.descriptor_indicators?.length}<span class="descriptor-leds" role="img" aria-label={descriptorSummary(item)}>{#each item.descriptor_indicators as descriptor}<i class:target-descriptor={descriptor.scope==='target_tags'} class:image-descriptor={descriptor.scope==='image_tags'} title={`${descriptor.name} · ${descriptor.scope==='target_tags'?'target':'image'} descriptor`}></i>{/each}</span>{/if}{#if item.similarity!==undefined}<small class:reference-score={item.item_id===browseReference} class="ml-score">{item.item_id===browseReference?'target':'sim'} {item.similarity.toFixed(3)}</small>{:else if item.prediction_confidence!==undefined&&item.prediction_confidence!==null}<small class="ml-score">ML {item.prediction_confidence.toFixed(2)}</small>{/if}</span>
                  <span class="tile-meta"><span>{isAssigned(item) ? item.label_display_name : 'Unlabeled'}</span>{#if item.label_origin==='classification' && isAssigned(item)}<b title={`Classification source: ${item.annotation_source || 'dataset'}`}>data</b>{/if}{#if item.review_decision}<i title={item.review_decision}>{item.review_decision==='verified'?'✓':'!'}</i>{/if}</span>
                </button>
              {/each}
            </div>
          </div>
        {/if}
        {#if !loading && !items.length}<div class="empty">No ROIs match these filters.</div>{/if}
      </div>
      <div class="pager"><button disabled={page===0||browseMode==='knn'} on:click={() => {page--;loadItems()}}>← Previous</button><button disabled={browseMode==='knn'||(page+1)*pageSize>=total} on:click={() => {page++;loadItems()}}>Next →</button></div>
    </section>

    <!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_noninteractive_element_interactions (ARIA separator is keyboard-adjustable) -->
    <div class:active={resizingPanel==='right'} class="panel-resizer right-panel-resizer" role="separator" aria-orientation="vertical" aria-label="Resize inspector panel" aria-valuemin={PANEL_MIN_WIDTH.right} aria-valuemax={PANEL_MAX_WIDTH.right} aria-valuenow={rightPanelWidth} tabindex="0" title="Drag to resize · Arrow keys adjust · Double-click resets" on:pointerdown={(event)=>startPanelResize('right',event)} on:keydown={(event)=>resizePanelWithKeyboard('right',event)} on:dblclick={()=>resetPanelWidth('right')}><span></span></div>

    <aside class="inspector">
      <h2>Inspector</h2>
      {#if detail}
        <img class="inspect-image" src={registryUrl(`/api/items/${detail.item_id}/image`)} alt="Focused ROI" />
        <div class="inspect-id"><strong>{detail.source_key||'ROI'}</strong><button title="Copy item ID" on:click={()=>detail?.item_id && navigator.clipboard.writeText(detail.item_id)}>Copy ID</button></div>
        {#if activeEvidence}<section class="evidence-card"><h3>ML evidence</h3><div class="evidence-source">{activeEvidence.source_name}<span>{activeEvidence.source_kind}</span></div><dl><dt>Prediction</dt><dd>{evidenceLabel(activeEvidence.predicted_label_id)}</dd><dt>Confidence</dt><dd>{formatScore(activeEvidence.prediction_confidence)}</dd>{#if activeEvidence.prototype_similarity!==null&&activeEvidence.prototype_similarity!==undefined}<dt>Prototype label</dt><dd>{evidenceLabel(activeEvidence.prototype_label_id)}</dd><dt>Prototype</dt><dd>{formatScore(activeEvidence.prototype_similarity)} <small>margin {formatScore(activeEvidence.prototype_margin)}</small></dd>{/if}{#if activeEvidence.nearest_neighbor_similarity!==null&&activeEvidence.nearest_neighbor_similarity!==undefined}<dt>KNN label</dt><dd>{evidenceLabel(activeEvidence.knn_label_id)}</dd><dt>KNN nearest</dt><dd>{formatScore(activeEvidence.nearest_neighbor_similarity)}</dd><dt>KNN agreement</dt><dd>{formatScore(activeEvidence.top_k_label_agreement)}</dd><dt>KNN support</dt><dd>{formatScore(activeEvidence.weighted_label_support)}</dd>{/if}</dl><div class="evidence-actions">{#if activeEvidence.neighbors?.length}<button on:click={showNeighbors}>Show {activeEvidence.neighbors.length} recorded neighbors</button>{/if}{#if activeEvidence.embedding_available}<button class="primary" on:click={findSimilar}>Find similar ROIs</button>{/if}</div><p>Model evidence supports review; it is not a verified annotation.</p></section>{/if}
        <section class="classification-picker"><h3>Assign classification</h3><p>{selected.size > 1 ? `Apply a label to ${selected.size} selected ROIs` : 'Search dataset labels and enabled taxonomies'}</p><div class="combobox"><input aria-label="Find a classification label" aria-autocomplete="list" aria-expanded={assignmentOpen} aria-controls="classification-options" role="combobox" value={assignmentQuery} placeholder="Type a label, taxon, ID, or mapping…" autocomplete="off" on:focus={() => {assignmentOpen=true;assignmentIndex=0}} on:input={(event)=>{assignmentQuery=(event.currentTarget as HTMLInputElement).value;assignmentOpen=true;assignmentIndex=0}} on:keydown={assignmentKeydown} on:blur={()=>setTimeout(()=>assignmentOpen=false,120)} />{#if assignmentOpen}<div id="classification-options" class="assignment-options" role="listbox">{#each availableAssignments as option,index (option.key)}<button class:highlighted={index===assignmentIndex} role="option" aria-selected={index===assignmentIndex} on:mousedown={(event)=>event.preventDefault()} on:click={()=>selectAssignment(option)}><span><strong>{option.name}</strong><small>{option.detail}</small></span>{#if option.preferred}<em title="Enabled standardized taxonomy">◆</em>{/if}</button>{/each}{#if !availableAssignments.length}<div class="no-options">No matching labels</div>{/if}</div>{/if}</div></section>
        <section><h3>Current classification</h3>{#if detail.annotations?.[0]?.is_current && detail.annotations[0].status!=='deprecated'}<strong class="current-label">{detail.annotations[0].label_display_name}</strong>{#if detail.annotations[0].label_metadata?.registry?.standard_concept_id}<span class="preferred-badge" title="Mapped to a standardized taxonomy">◆ Preferred standard</span>{/if}<dl><dt>Source</dt><dd>{detail.annotations[0].source||detail.annotations[0].method||'Unknown'}</dd><dt>Annotator</dt><dd>{detail.annotations[0].annotator||'Unknown'}</dd><dt>Time</dt><dd>{new Date(detail.annotations[0].created_at).toLocaleString()}</dd><dt>Review</dt><dd>{detail.annotations[0].reviews?.[0]?.decision||'Unverified'}</dd>{#if detail.annotations[0].label_metadata?.registry?.standard_concept?.mappings?.length}<dt>Mappings</dt><dd>{detail.annotations[0].label_metadata.registry.standard_concept.mappings.map((mapping:any)=>`${mapping.authority}:${mapping.identifier}`).join(' · ')}</dd>{/if}</dl>{:else}<p class="muted">No current label</p>{/if}</section>
        {#if detail.annotations?.[0]?.is_current && detail.annotations[0].status!=='deprecated'}<section><h3>Classification workflow</h3><div class="review-buttons"><button on:click={()=>review('verified')}>✓ Verify</button><button on:click={()=>review('needs_review')}>⚑ Flag</button><button on:click={removeLabels}>× Remove</button></div><p class="workflow-help">Assign another class to modify this label.</p></section>{/if}
        <section><DescriptorPicker title="Target descriptors" scope="target_tags" tags={descriptorTags} assigned={assignedTargetTags} targetCount={selected.size||1} on:assign={(event)=>toggleDescriptor(event.detail.tag,true)} on:remove={(event)=>toggleDescriptor(event.detail.tag,false)} on:create={(event)=>createCustomTag(event.detail.scope,event.detail.name)} /></section>
        <section><DescriptorPicker title="Image descriptors" scope="image_tags" tags={descriptorTags} assigned={assignedImageTags} targetCount={selected.size||1} on:assign={(event)=>toggleDescriptor(event.detail.tag,true)} on:remove={(event)=>toggleDescriptor(event.detail.tag,false)} on:create={(event)=>createCustomTag(event.detail.scope,event.detail.name)} /></section>
        <section><h3>Annotation history</h3>{#if detail.annotations?.length}{#each detail.annotations as ann}<div class="history"><span class="history-dot"></span><div><strong>{ann.label_display_name}</strong><span>{ann.annotator||'Unknown'} · {new Date(ann.created_at).toLocaleString()}</span><em>{ann.status==='deprecated'?'removed':ann.is_current?'current':'replaced'}</em></div></div>{/each}{:else}<p class="muted">No annotation history</p>{/if}</section>
        <section><h3>Metadata</h3><dl><dt>Shape</dt><dd>{detail.shape?.join(' × ')||'Unknown'}</dd><dt>Encoding</dt><dd>{detail.encoding}</dd>{#each Object.entries(detail.metadata||{}).slice(0,8) as [key,value]}<dt>{key.replaceAll('_',' ')}</dt><dd>{typeof value==='object'?JSON.stringify(value):String(value)}</dd>{/each}</dl></section>
      {:else}<div class="empty inspector-empty">Select an ROI to inspect its classification and history.</div>{/if}
    </aside>

    <footer>
      <div><strong>{selected.size}</strong> selected <button on:click={()=>selected=new Set(items.map(i=>i.item_id))}>Select page</button><button on:click={()=>selected=new Set()}>Clear</button></div>
      <div class="annotation-bar"><span>Assign / modify</span>{#each DIGIT_SHORTCUTS as digit}{@const label = shortcutLabel(activeLabels,shortcutLabelIds,digit)}{#if label}<button on:click={()=>assign(label)}><kbd>{digit}</kbd>{label.display_name||label.name}</button>{/if}{/each}</div>
      <label class="auto"><input type="checkbox" bind:checked={autoAdvance} /> Auto-advance</label><button on:click={undo}>↶ Undo</button>
    </footer>
    {#if loading}<div class="loading-line"></div>{/if}
    {#if error}<div class="toast error">{error}<button on:click={()=>error=''}>×</button></div>{/if}
    {#if notice}<div class="toast notice">{notice}<button on:click={()=>notice=''}>×</button></div>{/if}
    {#if reassignSource}
      <div class="preferences-backdrop" role="presentation" on:click={(event)=>event.currentTarget===event.target&&(reassignSource=null)}>
        <div class="reassign-modal" role="dialog" aria-modal="true" aria-labelledby="reassign-title">
          <div class="preferences-header"><div><span>BULK CLASSIFICATION</span><h2 id="reassign-title">Reassign “{reassignSource.display_name||reassignSource.name}”</h2></div><button aria-label="Close bulk reassignment" on:click={()=>reassignSource=null}>×</button></div>
          <div class="reassign-body">
            <div class="reassign-summary"><strong>{reassignSource.item_count.toLocaleString()}</strong><span>currently assigned ROIs will receive a new, unverified classification with linked provenance.</span></div>
            <label for="reassign-target">Target label</label>
            <div class="combobox reassign-combobox"><input id="reassign-target" role="combobox" aria-label="Find target label" aria-autocomplete="list" aria-expanded={reassignOptionsOpen} aria-controls="reassign-options" value={reassignQuery} placeholder="Search dataset labels or enabled taxonomies…" autocomplete="off" on:focus={()=>{reassignOptionsOpen=true;reassignIndex=0}} on:input={(event)=>{reassignQuery=(event.currentTarget as HTMLInputElement).value;reassignTarget=null;reassignOptionsOpen=true;reassignIndex=0}} on:keydown={reassignKeydown} on:blur={()=>setTimeout(()=>reassignOptionsOpen=false,120)} />{#if reassignOptionsOpen}<div id="reassign-options" class="assignment-options" role="listbox">{#each reassignOptions as option,index (option.key)}<button class:highlighted={index===reassignIndex} role="option" aria-selected={index===reassignIndex} on:mousedown={(event)=>event.preventDefault()} on:click={()=>selectReassignTarget(option)}><span><strong>{option.name}</strong><small>{option.detail}</small></span>{#if option.preferred}<em>◆</em>{/if}</button>{/each}{#if !reassignOptions.length}<div class="no-options">No matching target labels</div>{/if}</div>{/if}</div>
            {#if reassignTarget}<div class="reassign-target"><span>Target</span><strong>{reassignTarget.name}</strong><em>{reassignTarget.detail}</em></div>{/if}
            <label class="deprecate-source"><input type="checkbox" bind:checked={deprecateReassignedSource} /><span><strong>Deactivate the source label afterward</strong><small>Recommended when normalizing a legacy dataset class.</small></span></label>
          </div>
          <div class="preferences-footer"><button on:click={()=>reassignSource=null}>Cancel</button><button class="primary" disabled={!reassignTarget||reassignWorking} on:click={confirmReassign}>{reassignWorking?'Reassigning…':`Reassign ${reassignSource.item_count.toLocaleString()} ROIs`}</button></div>
        </div>
      </div>
    {/if}
    {#if informationOpen}
      <div class="preferences-backdrop" role="presentation" on:click={(event)=>event.currentTarget===event.target&&(informationOpen=false)}>
        <div class="information-modal" role="dialog" aria-modal="true" aria-labelledby="information-title">
          <div class="preferences-header"><div><span>DATASET PROVENANCE</span><h2 id="information-title">Dataset & inference models</h2></div><button aria-label="Close dataset details" on:click={()=>informationOpen=false}>×</button></div>
          {#if informationLoading}<div class="information-loading">Loading dataset and model metadata…</div>
          {:else if datasetDetails}
            <div class="information-body">
              <section class="dataset-information">
                <div class="information-heading"><div><span>DATASET</span><h3>{datasetDetails.dataset.title||datasetDetails.dataset.name}</h3></div><div class="information-actions"><em>{datasetDetails.dataset.lifecycle}</em><button disabled title="Cross-dataset merge will move to Pelagia in a later migration step">⇥ Merge SQLite…</button></div></div>
                <div class="information-stats"><div><strong>{datasetDetails.summary.stats.total.toLocaleString()}</strong><span>ROIs</span></div><div><strong>{datasetDetails.database.counts.assets?.toLocaleString()||'0'}</strong><span>Assets</span></div><div><strong>{datasetDetails.summary.stats.active_labels.toLocaleString()}</strong><span>Labels</span></div><div><strong>{formatBytes(datasetDetails.database.size_bytes)}</strong><span>Database</span></div></div>
                {#if datasetDetails.dataset.description}<p class="dataset-description">{datasetDetails.dataset.description}</p>{/if}
                <dl class="detail-grid">
                  {#each scalarEntries(datasetDetails.dataset,['singleton','title','name','description','lifecycle']) as [key,value]}<dt>{humanize(key)}</dt><dd title={String(value)}>{detailValue(value)}</dd>{/each}
                  <dt>Database path</dt><dd title={datasetDetails.database.path}>{datasetDetails.database.path}</dd>
                  {#each scalarEntries(datasetDetails.database.schema) as [key,value]}<dt>{humanize(key)}</dt><dd>{detailValue(value)}</dd>{/each}
                  <dt>Tables</dt><dd>{datasetDetails.database.table_count.toLocaleString()}</dd>
                </dl>
                {#if datasetDetails.summary.physical_scale.available}<div class="calibration-summary"><strong>Physical calibration</strong><span>{detailValue(datasetDetails.summary.physical_scale.reference_um_per_pixel)} µm/pixel reference · {datasetDetails.summary.physical_scale.calibrated_items.toLocaleString()} calibrated ROIs</span></div>{/if}
                {#if datasetDetails.asset_formats.length}<h4>Asset formats</h4><div class="format-list">{#each datasetDetails.asset_formats as format}<div><strong>{format.media_type}</strong><span>{format.encoding}</span><em>{format.count.toLocaleString()}</em></div>{/each}</div>{/if}
                {#if hasContent(datasetDetails.dataset.metadata)}<details class="metadata-disclosure"><summary>Dataset metadata</summary><pre>{JSON.stringify(datasetDetails.dataset.metadata,null,2)}</pre></details>{/if}
                {#if datasetDetails.recent_events.length}<details class="metadata-disclosure"><summary>Recent provenance events ({datasetDetails.recent_events.length})</summary><div class="event-list">{#each datasetDetails.recent_events as event}<div><strong>{event.event_type}</strong><time>{event.created_at}</time>{#if event.actor}<span>{event.actor}</span>{/if}</div>{/each}</div></details>{/if}
              </section>
              <section class="model-information">
                <div class="model-title"><div><span>INFERENCE</span><h3>Models and prediction runs</h3></div><strong>{datasetDetails.inference_sources.length}</strong></div>
                {#if !datasetDetails.inference_sources.length}<div class="no-models"><strong>No inference records found</strong><span>This dataset can still be curated normally. Model information will appear when Registry finds a prediction set or inference run.</span></div>{/if}
                <div class="model-list">{#each datasetDetails.inference_sources as source}
                  <article class="model-card">
                    <div class="model-card-header"><div><span>{source.source_kind==='oracle'?'LEGACY ORACLE EVIDENCE':'REGISTRY INFERENCE RUN'}</span><h4>{source.name}</h4><code>{source.source_key}</code></div><em>{source.evidence.item_count.toLocaleString()} ROIs</em></div>
                    <div class="coverage"><span style={`width:${evidenceCoverage(source)}%`}></span></div><div class="coverage-label"><span>Evidence coverage</span><strong>{evidenceCoverage(source).toFixed(1)}%</strong></div>
                    <div class="capability-list"><span class:available={source.evidence.capabilities.confidence}>Confidence</span><span class:available={source.evidence.capabilities.knn}>KNN</span><span class:available={source.evidence.capabilities.prototype}>Prototypes</span><span class:available={source.evidence.capabilities.embedding}>Embeddings</span></div>
                    <dl class="model-identity">{#each scalarEntries(sourceRecord(source),['metadata','singleton']) as [key,value]}<dt>{humanize(key)}</dt><dd title={String(value)}>{detailValue(value)}</dd>{/each}</dl>
                    {#if Object.keys(source.performance_metrics).length}<div class="metric-section"><h5>Reported performance metrics</h5><div class="metric-grid">{#each Object.entries(source.performance_metrics) as [key,value]}<div><span>{key.split(' · ').at(-1)?.replace(/_/g,' ')}</span><strong>{detailValue(value)}</strong><small>{key}</small></div>{/each}</div></div>{/if}
                    {#if source.evidence.aggregates && Object.values(source.evidence.aggregates).some((value)=>value!==null)}<div class="metric-section"><h5>Evidence summary</h5><div class="metric-grid compact">{#each Object.entries(source.evidence.aggregates).filter(([,value])=>value!==null) as [key,value]}<div><span>{humanize(key)}</span><strong>{detailValue(value)}</strong></div>{/each}</div></div>{/if}
                    {#if source.run}<details class="metadata-disclosure"><summary>Run provenance and configuration</summary><pre>{JSON.stringify(source.run,null,2)}</pre></details>{/if}
                    {#if source.model && hasContent(source.model.metadata)}<details class="metadata-disclosure"><summary>Model metadata</summary><pre>{JSON.stringify(source.model.metadata,null,2)}</pre></details>{/if}
                    {#if source.legacy}<details class="metadata-disclosure"><summary>Legacy prediction-set record</summary><pre>{JSON.stringify(source.legacy,null,2)}</pre></details>{/if}
                  </article>
                {/each}</div>
              </section>
            </div>
          {/if}
          <div class="preferences-footer"><span>Only metadata present in the loaded database is shown.</span><button class="primary" on:click={()=>informationOpen=false}>Done</button></div>
        </div>
      </div>
    {/if}
    {#if importOpen}
      <div class="preferences-backdrop import-backdrop" role="presentation" on:click={(event)=>event.currentTarget===event.target&&!importLoading&&(importOpen=false)}>
        <div class="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
          <div class="preferences-header"><div><span>DATA TRANSFER</span><h2 id="import-title">Import ROIs from SQLite</h2></div><button aria-label="Close import" disabled={importLoading} on:click={()=>importOpen=false}>×</button></div>
          <div class="import-body">
            <section class="import-source">
              <h3>Source database</h3>
              <p>Registry inspects the source read-only before making changes. Source and destination dataset types must match.</p>
              <div class="import-path"><input bind:value={importPath} placeholder="/path/to/source.sqlite" spellcheck="false" on:keydown={(event)=>event.key==='Enter'&&inspectImport()} /><button on:click={()=>browseFiles(undefined,'import')}>Browse…</button><button class="primary" disabled={importLoading||!importPath.trim()} on:click={inspectImport}>{importLoading&&!importPreview?'Inspecting…':'Inspect'}</button></div>
            </section>
            {#if importPreview}
              <section class="import-summary">
                <div class="import-source-title"><div><span>READY TO IMPORT</span><strong>{importPreview.source.name}</strong><code>{importPreview.source.path}</code></div><em>{importPreview.source.dataset_type.replace('_',' ')} · schema {importPreview.source.schema_version}</em></div>
                <div class="import-counts"><div><strong>{importPreview.total_items.toLocaleString()}</strong><span>Source ROIs</span></div><div><strong>{importPreview.new_items.toLocaleString()}</strong><span>New</span></div><div><strong>{importPreview.duplicate_count.toLocaleString()}</strong><span>Duplicates</span></div><div><strong>{formatBytes(importPreview.source.size_bytes)}</strong><span>Source size</span></div></div>
              </section>
              <section class="import-options">
                <h3>Content to retain</h3>
                <div class="import-option-grid">
                  {#if importPreview.labels.available||importPreview.descriptors.available}<label><input type="checkbox" bind:checked={importIncludeLabels} /><span><strong>Labels and descriptors</strong><small>{importPreview.labels.annotation_count.toLocaleString()} label assignments · {importPreview.descriptors.annotation_count.toLocaleString()} descriptors. Imported labels remain unverified.</small></span></label>{:else}<div class="unavailable-option"><strong>No annotations found</strong><span>Label retention does not apply to this source.</span></div>{/if}
                  {#if importPreview.evidence.available}<label><input type="checkbox" bind:checked={importIncludeEvidence} /><span><strong>Retain model evidence</strong><small>{importPreview.evidence.registry_count.toLocaleString()} Registry records · {importPreview.evidence.legacy_count.toLocaleString()} legacy predictions. Uncheck to reject source evidence.</small></span></label>{:else}<div class="unavailable-option"><strong>No model evidence found</strong><span>Evidence retention does not apply to this source.</span></div>{/if}
                </div>
              </section>
              {#if importPreview.duplicate_count}
                <section class="duplicate-options">
                  <div class="duplicate-heading"><div><h3>Duplicate decisions</h3><p>Matches use ROI UUID and/or the image asset SHA-256 hash. Merge fills compatible missing metadata and retains destination values when fields conflict.</p></div><div class="duplicate-all"><span>Apply to all</span><button class:active={importDuplicatePolicy==='skip'&&!Object.keys(importDuplicateActions).length} on:click={()=>applyDuplicatePolicy('skip')}>Skip</button><button class:active={importDuplicatePolicy==='merge'&&!Object.keys(importDuplicateActions).length} on:click={()=>applyDuplicatePolicy('merge')}>Merge compatible</button></div></div>
                  <div class="duplicate-list">{#each visibleImportDuplicates as duplicate}<div class="duplicate-row"><div><strong>{duplicate.source_key||duplicate.source_item_id}</strong><code>{duplicate.source_item_id}</code><span>{#each duplicate.reasons as reason}<em>{reason==='roi_hash'?'HASH':'UUID'}</em>{/each}{#if duplicate.metadata_conflicts.length}<b title={duplicate.metadata_conflicts.join(', ')}>{duplicate.metadata_conflicts.length} metadata conflict{duplicate.metadata_conflicts.length===1?'':'s'}</b>{/if}</span></div><span class="duplicate-arrow">→</span><code title={duplicate.target_item_id}>{duplicate.target_item_id}</code><select aria-label={`Duplicate action for ${duplicate.source_item_id}`} value={importDuplicateActions[duplicate.source_item_id]||importDuplicatePolicy} on:change={(event)=>setImportDuplicate(duplicate.source_item_id,event)}><option value="skip">Skip</option><option value="merge">Merge compatible</option></select></div>{/each}</div>
                  {#if importPreview.duplicate_count>importDuplicatePageSize}<div class="duplicate-pager"><button disabled={importDuplicatePage===0} on:click={()=>importDuplicatePage--}>← Previous</button><span>{(importDuplicatePage*importDuplicatePageSize+1).toLocaleString()}–{Math.min(importPreview.duplicate_count,(importDuplicatePage+1)*importDuplicatePageSize).toLocaleString()} of {importPreview.duplicate_count.toLocaleString()}</span><button disabled={(importDuplicatePage+1)*importDuplicatePageSize>=importPreview.duplicate_count} on:click={()=>importDuplicatePage++}>Next →</button></div>{/if}
                </section>
              {/if}
              <section class="import-safety"><strong>Automatic recovery point</strong><span>Registry creates a complete pre-import SQLite backup before writing and records the import in dataset provenance.</span></section>
            {/if}
            {#if importResult}<section class="import-result"><h3>Import complete</h3><div><span><strong>{importResult.imported_items.toLocaleString()}</strong> new ROIs</span><span><strong>{importResult.merged_items.toLocaleString()}</strong> merged</span><span><strong>{importResult.skipped_items.toLocaleString()}</strong> skipped</span><span><strong>{importResult.imported_labels.toLocaleString()}</strong> labels</span><span><strong>{importResult.imported_descriptors.toLocaleString()}</strong> descriptors</span><span><strong>{importResult.imported_evidence.toLocaleString()}</strong> evidence records</span></div><code>Backup: {importResult.backup_path}</code>{#if importResult.label_conflicts}<p>{importResult.label_conflicts.toLocaleString()} conflicting duplicate labels were left unchanged in the destination.</p>{/if}</section>{/if}
          </div>
          <div class="preferences-footer"><span>{importPreview&&!importResult?`${importPreview.new_items.toLocaleString()} new and ${importPreview.duplicate_count.toLocaleString()} duplicate ROIs reviewed`:importResult?'The open dataset and evidence indexes have been refreshed.':'Choose a source database to begin.'}</span>{#if importResult}<button class="primary" on:click={()=>importOpen=false}>Done</button>{:else}<button class="primary" disabled={!importPreview||importLoading} on:click={executeImport}>{importLoading?'Importing…':'Create backup & import'}</button>{/if}</div>
        </div>
      </div>
    {/if}
    {#if fileBrowserOpen && fileBrowserPurpose==='import'}
      <div class="browser-backdrop import-browser" role="presentation" on:click={(event)=>event.currentTarget===event.target&&(fileBrowserOpen=false)}>
        <div class="file-browser" role="dialog" aria-modal="true" aria-labelledby="import-file-browser-title" tabindex="-1">
          <div class="browser-header"><div><span>SERVER FILES</span><h2 id="import-file-browser-title">Choose an import source</h2></div><button aria-label="Close file browser" on:click={()=>fileBrowserOpen=false}>×</button></div>
          {#if fileListing}<div class="locations">{#each fileListing.roots as root}<button class:active={root===fileListing.root_path} on:click={()=>browseFiles(root)} title={root}>{root}</button>{/each}</div><div class="browser-path"><button disabled={!fileListing.parent_path} on:click={()=>fileListing?.parent_path&&browseFiles(fileListing.parent_path)}>↑ Up</button><code>{fileListing.current_path}</code></div><div class="file-list" aria-busy={fileBrowserLoading}>{#each fileListing.entries as entry}<button class:directory={entry.is_directory} class="file-row" on:click={()=>entry.is_directory?browseFiles(entry.path):chooseFile(entry.path)}><span class="file-icon">{entry.is_directory?'▸':'DB'}</span><span class="file-name">{entry.name}</span><span class="file-size">{formatBytes(entry.size)}</span></button>{/each}{#if !fileBrowserLoading&&!fileListing.entries.length}<div class="empty">No folders or SQLite files in this location.</div>{/if}</div>{:else if fileBrowserLoading}<div class="empty">Loading server files…</div>{/if}
          <div class="browser-footer"><span>Source is opened read-only for inspection</span><button on:click={()=>fileBrowserOpen=false}>Cancel</button></div>
        </div>
      </div>
    {/if}
    {#if preferencesOpen}
      <div class="preferences-backdrop" role="presentation" on:click={(event) => event.currentTarget === event.target && (preferencesOpen=false)}>
        <div class="preferences-modal" role="dialog" aria-modal="true" aria-labelledby="preferences-title">
          <div class="preferences-header"><div><span>REGISTRY WORKSPACE</span><h2 id="preferences-title">Preferences & vocabulary</h2></div><button aria-label="Close preferences" on:click={() => preferencesOpen=false}>×</button></div>
          <div class="preferences-body">
            <section class="appearance-settings"><h3>Appearance & selection</h3><div class="preference-row"><span>View</span><div class="segmented"><button class:active={theme==='light'} on:click={() => setTheme('light')}>Light</button><button class:active={theme==='dark'} on:click={() => setTheme('dark')}>Dark</button></div></div><label class="preference-row"><span>Canvas color</span><span class="color-control"><input type="color" value={canvasColor} on:input={setCanvasColor} /><code>{canvasColor.toUpperCase()}</code></span></label><div class="preference-row panel-size-preference"><span><strong>Side panel widths</strong><small>Drag either gallery edge or focus it and use the arrow keys.</small></span><button on:click={()=>{resetPanelWidth('left');resetPanelWidth('right')}}>Reset</button></div><label class="preference-row sticky-preference"><span><strong>Sticky selection</strong><small>First click focuses an ROI; second click selects it. Selected ROIs remain until clicked again.</small></span><input type="checkbox" checked={stickySelection} on:change={setStickySelection} /></label></section>
            <section class="shortcut-settings"><h3>Label shortcuts</h3><p>Choose which classification each number key assigns.</p><div class="shortcut-grid">{#each DIGIT_SHORTCUTS as digit}<label><kbd>{digit}</kbd><select value={shortcutLabelIds[digit]||''} on:change={(event)=>setShortcut(digit,event)}><option value="">Unassigned</option>{#each activeLabels as label}<option value={label.label_id}>{label.display_name||label.name}</option>{/each}</select></label>{/each}</div></section>
            <section class="cheatsheet-settings"><h3>Keyboard cheatsheet</h3><dl class="cheatsheet"><dt><kbd>← ↑ ↓ →</kbd></dt><dd>Move focused ROI</dd><dt><kbd>Shift</kbd> + arrows</dt><dd>Extend selection</dd><dt><kbd>Cmd/Ctrl</kbd> + click</dt><dd>Toggle selection</dd><dt><kbd>Shift</kbd> + click</dt><dd>Select range</dd><dt><kbd>0–9</kbd></dt><dd>Assign configured label</dd><dt><kbd>Space</kbd></dt><dd>Verify selection</dd><dt><kbd>F</kbd></dt><dd>Flag as needs review</dd><dt><kbd>U</kbd></dt><dd>Undo last operation</dd><dt><kbd>Esc</kbd></dt><dd>Clear selection</dd></dl></section>
            <section class="vocabulary-settings">
              <div class="vocabulary-heading"><h3>Optional taxonomies</h3><button on:click={reloadVocabularyCatalog}>Rescan installed files</button></div>
              <p>Enable only the installed catalogs useful for this dataset. Enabled taxonomies appear in the browser and classification search; they do not add labels until a concept is assigned.</p>
              <div class="vocabulary-list">{#each vocabularyCatalog as entry}<label class="vocabulary-id"><input type="checkbox" checked={enabledVocabularyKeys.includes(entry.key)} on:change={(event)=>setVocabularyEnabled(entry.key,(event.currentTarget as HTMLInputElement).checked)} /><span><strong>{entry.vocabulary.name}</strong><small>v{entry.vocabulary.version} · {entry.taxonomy_count.toLocaleString()} labels · {entry.vocabulary.status}</small><code>{entry.filename}</code></span></label>{/each}</div>
              <div class="label-manager"><h3>Dataset labels</h3><div class="new-label"><input bind:value={newLabel} on:keydown={(e)=>e.key==='Enter'&&createLabel()} placeholder="New dataset label" /><button on:click={createLabel}>Add</button></div><div class="manage-list">{#each labels as label}<div class:muted={label.deprecated_at} class="manage-row"><span title={label.name}>{label.display_name||label.name}<small>{label.item_count.toLocaleString()} ROIs</small></span>{#if !label.deprecated_at}<button on:click={()=>openReassign(label)}>Reassign all</button>{/if}<button on:click={()=>renameLabel(label)}>Rename</button><button on:click={()=>deprecate(label)}>{label.deprecated_at?'Restore':'Deactivate'}</button></div>{/each}</div></div>
            </section>
          </div>
          <div class="preferences-footer"><span>Preferences are saved in this browser.</span><button class="primary" on:click={() => preferencesOpen=false}>Done</button></div>
        </div>
      </div>
    {/if}
  </main>
{/if}

<style>
  :global(*) { box-sizing: border-box; }
  :global(html, body) { margin: 0; height: 100%; overflow: hidden; font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; color: #17252b; background: #edf2f4; font-size: 13px; }
  :global(button), :global(input), :global(select) { font: inherit; }
  button { cursor: pointer; color: inherit; background: #fff; border: 1px solid #b7c5cb; }
  button:hover:not(:disabled) { border-color: #197997; background: #f1f9fa; }
  button:disabled { opacity: .45; cursor: default; }
  input, select { border: 1px solid #afbec5; background: #fff; color: #17252b; padding: 7px 8px; outline: none; }
  input:focus, select:focus { border-color: #197997; box-shadow: 0 0 0 2px #19799722; }
  .primary { background: #197997; color: white; border-color: #197997; font-weight: 650; padding: 8px 15px; }
  .primary:hover:not(:disabled) { background: #146981; }

  .open-screen { height: 100vh; display: grid; place-items: center; background: #e9f0f2; }
  .open-panel { width: min(680px, calc(100vw - 40px)); background: #f7fafc; border: 1px solid #b7c7ce; box-shadow: 0 14px 40px #17343e18; padding: 38px; }
  .wordmark span, .browser-header span { font-size: 10px; letter-spacing: .22em; color: #197997; font-weight: 800; }
  .brand-logo { display:block; width:min(430px, 82%); height:auto; margin:0 0 24px; }
  .open-panel p { color: #53656d; margin-bottom: 28px; }
  .open-panel label { display: block; font-weight: 650; margin-bottom: 6px; }
  .open-row { display: flex; }
  .open-row input { flex: 1; min-width: 0; }
  .open-row button { border-left: 0; white-space: nowrap; }
  .open-panel small { display: block; color: #687a82; margin-top: 10px; }
  .message { margin-top: 20px; padding: 10px; border-left: 3px solid; }
  .error { background: #fff0ed; color: #8a2f24; border-color: #bd4a3b; }

  .browser-backdrop { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 24px; background: #071b22a6; }
  .file-browser { width: min(780px, 100%); height: min(620px, calc(100vh - 48px)); display: grid; grid-template-rows: auto auto auto minmax(0, 1fr) auto; background: #f7fafc; border: 1px solid #8ea4ad; box-shadow: 0 24px 70px #06171e66; }
  .browser-header { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px 14px; border-bottom: 1px solid #c1cdd2; }
  .browser-header h2 { margin: 2px 0 0; font-size: 19px; }
  .browser-header button { border: 0; background: transparent; font-size: 22px; }
  .locations { display: flex; gap: 5px; overflow-x: auto; padding: 8px 12px; border-bottom: 1px solid #d1dade; background: #edf3f5; }
  .locations button { max-width: 260px; padding: 5px 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .locations button.active { border-color: #197997; background: #d9eff1; }
  .browser-path { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid #c1cdd2; }
  .browser-path button { padding: 5px 10px; }
  .browser-path code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #52666e; }
  .file-list { overflow: auto; padding: 6px; background: #eef3f5; }
  .file-row { width: 100%; display: grid; grid-template-columns: 30px minmax(0, 1fr) 90px; align-items: center; min-height: 37px; padding: 4px 9px; border: 0; border-bottom: 1px solid #d4dde0; text-align: left; background: #fff; }
  .file-row:hover { background: #e3f2f4 !important; }
  .file-row.directory { font-weight: 600; }
  .file-icon { color: #197997; font: 700 10px ui-monospace, monospace; }
  .file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file-size { text-align: right; color: #708187; font-size: 11px; }
  .browser-footer { display: flex; align-items: center; justify-content: space-between; padding: 9px 12px; border-top: 1px solid #b8c6cb; color: #687a82; font-size: 11px; }
  .browser-footer button { padding: 5px 12px; }

  .workspace { --app-bg:#e5ecef; --surface:#f3f6f7; --raised:#fff; --text:#17252b; --muted:#61757d; --line:#afbdc3; --accent:#197997; --status-unlabeled:#84949b; --status-unverified:#4e91a4; --status-verified:#3f8b6c; --status-needs:#ba7b35; --status-rejected:#ad5753; height: 100vh; display: grid; grid-template-columns: var(--left-panel-width) 7px minmax(320px, 1fr) 7px var(--right-panel-width); grid-template-rows: 54px minmax(0, 1fr) 50px; grid-template-areas: 'header header header header header' 'filters left-resizer gallery right-resizer inspector' 'footer footer footer footer footer'; background: var(--app-bg); color:var(--text); }
  .workspace.dark { --app-bg:#15252b; --surface:#1d3037; --raised:#263b43; --text:#e1ecef; --muted:#9bb0b8; --line:#486069; --accent:#65bdc5; --status-unlabeled:#82949b; --status-unverified:#62aabc; --status-verified:#62a985; --status-needs:#d09a55; --status-rejected:#cf7771; }
  header { grid-area: header; display: flex; align-items: center; border-bottom: 1px solid #91a5ae; background: #102c36; color: #edf7f8; padding: 0 12px; gap: 12px; }
  .wordmark { width: 150px; flex:none; display: flex; align-items:center; gap:8px; }
  .wordmark img { width:31px; height:32px; object-fit:contain; flex:none; }
  .wordmark > div { display:flex; flex-direction:column; min-width:0; }
  .wordmark span { color: #6fcbd0; }
  .wordmark strong { font-size: 18px; letter-spacing: -.03em; }
  .dataset-title { display: flex; flex-direction: column; min-width: 135px; max-width:190px; }
  .dataset-title strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .dataset-title span { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #9fb6be; margin-top: 2px; }
  .header-stats { display:flex; align-self:stretch; margin-left:auto; border-left:1px solid #36525c; }
  .header-stats div { min-width:49px; display:flex; flex-direction:column; justify-content:center; padding:0 7px; border-right:1px solid #36525c; }
  .header-stats strong { font:700 12px ui-monospace,monospace; color:#edf7f8; }
  .header-stats span { margin-top:2px; color:#8facb5; font-size:8px; text-transform:uppercase; letter-spacing:.04em; }
  .search { display: flex; width: min(320px, 24vw); }
  .search input { width: 100%; background: #f4f8f9; }
  .search button { border-left: 0; }
  .quiet { background: transparent; color: #d4e2e6; border-color: #53717b; }
  .filters { grid-area: filters; min-height:0; overflow: hidden; display:flex; flex-direction:column; background: var(--surface); border-right: 1px solid var(--line); }
  .left-panel-resizer { grid-area:left-resizer; }
  .right-panel-resizer { grid-area:right-resizer; }
  .panel-resizer { position:relative; z-index:4; min-width:7px; cursor:col-resize; touch-action:none; background:color-mix(in srgb,var(--line) 35%,var(--app-bg)); outline:none; }
  .panel-resizer span { position:absolute; inset:0 2px; background:var(--line); opacity:.55; transition:background .12s, opacity .12s; }
  .panel-resizer:hover span,.panel-resizer:focus-visible span,.panel-resizer.active span { background:var(--accent); opacity:1; }
  .panel-resizer:focus-visible { box-shadow:inset 0 0 0 2px var(--accent); }
  :global(body.resizing-panels) { cursor:col-resize; user-select:none; }
  .filters section, .inspector section { padding: 14px; border-bottom: 1px solid #c7d1d5; }
  .filters h2, .inspector h2, .inspector h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; margin: 0 0 10px; color: #50656e; }
  .segmented { display: flex; }
  .segmented button { flex: 1; text-transform: capitalize; padding: 6px 3px; margin-right: -1px; }
  .segmented .active { background: #d9eff1; border-color: #197997; color: #105d72; }
  .filters select { width: 100%; }
  .ml-filters { display:grid; gap:7px; }
  .ml-filters > h2 { margin-bottom:2px; }
  .ml-filters label { display:flex; flex-direction:column; gap:3px; color:var(--muted); font-size:9px; }
  .ml-filters input,.ml-filters select { min-width:0; padding:5px 6px; font-size:10px; }
  .metric-pair { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
  .ml-filters .ml-check { flex-direction:row; align-items:flex-start; color:var(--text); }
  .ml-check input { margin:1px 0 0; accent-color:var(--accent); }
  .ml-actions { display:flex; }
  .ml-actions button { flex:1; padding:4px; font-size:9px; }
  .icon { border: 0; background: transparent; font-size: 18px; padding: 0; }
  .annotation-bar kbd { font: 600 10px ui-monospace, monospace; display: inline-grid; place-items: center; width: 19px; height: 19px; border: 1px solid #aebdc3; background: #fff; color: #40545c; }
  .new-label { display: flex; }
  .new-label input { width: 100%; min-width: 0; }
  .new-label button { border-left: 0; }
  .manage-row { display: flex; flex-wrap:wrap; align-items: center; gap: 3px; padding: 6px 0; border-bottom: 1px solid #d6dee1; }
  .manage-row > span { flex:1 0 100%; display:flex; justify-content:space-between; gap:5px; overflow: hidden; white-space:nowrap; text-overflow:ellipsis; }
  .manage-row span small { margin-left:auto; color:var(--muted); font-size:9px; font-weight:400; }
  .manage-row button { flex:1; font-size:9px; padding:3px 2px; }
  .muted { opacity: .57; }

  .gallery-region { grid-area: gallery; min-width: 0; display: grid; grid-template-rows: 52px minmax(0, 1fr) 35px; background: #cfdadd; }
  .gallery-tools { display: flex; align-items: center; justify-content: space-between; gap: 12px; overflow-x: auto; padding: 0 10px; background: #f6f8f9; border-bottom: 1px solid #aebcc2; color: #52666e; }
  .gallery-tools > div:first-child { white-space: nowrap; }
  .browse-mode { margin-right:7px; padding:3px 6px; border-color:var(--accent); color:var(--accent); font-size:9px; }
  .sticky-indicator { display:inline-block; margin-right:7px; padding:3px 6px; border:1px solid #8d5ab7; color:#74429d; background:#f2eafb; font-size:8px; text-transform:uppercase; letter-spacing:.05em; }
  .view-modes { display: flex; align-items: center; gap: 9px; margin: 0; padding: 0; border: 0; white-space: nowrap; }
  .view-modes label { display: flex; align-items: center; gap: 3px; font-size: 11px; }
  .view-modes label:has(input:disabled) { opacity: .45; cursor: help; }
  .view-modes input { margin: 0; accent-color: #197997; }
  .tool-group { display: flex; align-items: center; gap: 10px; }
  .tool-group label { display: flex; align-items: center; gap: 5px; }
  .tool-group select { padding: 4px; }
  .tool-group input[type=range] { width: 90px; }
  .scale-control output { min-width: 31px; color: #197997; font: 700 11px ui-monospace, monospace; }
  .seed { width: 70px; padding: 4px; }
  .metric-input { width:60px; padding:4px; }
  .divider { color: #95a5ab; }
  .gallery { overflow: auto; position: relative; background:var(--canvas-color); }
  .gallery-spacer { position: relative; }
  .original-spacer { min-width: 100%; }
  .tile-grid { position: absolute; left: 8px; top: 8px; display: grid; grid-template-columns: repeat(var(--columns), var(--tile)); grid-auto-rows: calc(var(--tile) + 30px); gap: 8px 10px; }
  .tile { --tile-status:var(--status-unlabeled); position: relative; width: var(--tile); height: calc(var(--tile) + 30px); padding: 3px; background: color-mix(in srgb,var(--tile-status) 8%,var(--raised)); color:var(--text); border: 1px solid color-mix(in srgb,var(--tile-status) 65%,var(--line)); display: flex; flex-direction: column; text-align: left; }
  .tile.labeled { --tile-status:var(--status-unverified); }
  .tile.verified { --tile-status:var(--status-verified); }
  .tile.needs-review { --tile-status:var(--status-needs); }
  .tile.rejected { --tile-status:var(--status-rejected); }
  .tile.compact { padding:3px; }
  .tile.original-tile { position: absolute; }
  .tile:hover { background: #f6fbfc; }
  .tile.selected { border-color: #197997; box-shadow: 0 0 0 2px #197997; }
  .tile.focused::after { content: ''; position: absolute; inset: -4px; border: 1px solid #102c36; pointer-events: none; }
  .tile.reference-roi { z-index:2; border-color:#b23ac7; box-shadow:0 0 0 2px #b23ac7,0 0 0 4px color-mix(in srgb,#b23ac7 20%,transparent); }
  .tile.reference-roi.focused::after { inset:-5px; border:1px solid #ef9cff; }
  .tile .tile-meta i { background:var(--tile-status); }
  .image-wrap { position:relative; height: var(--tile); width: 100%; display: grid; place-items: center; background: var(--canvas-color); overflow: hidden; }
  .original-stage { align-self: center; flex: none; }
  .image-wrap img { display: block; flex: none; }
  .image-wrap img.fit { max-width: 100%; max-height: 100%; }
  .image-wrap img.original, .image-wrap img.physical, .image-wrap img.normalize-height { max-width: none; max-height: none; }
  .no-calibration { position: absolute; right: 5px; top: 5px; padding: 2px 4px; background: #111b1fcc; color: #d8e4e7; font-size: 9px; text-transform: uppercase; letter-spacing: .05em; }
  .ml-score { position:absolute; left:5px; top:5px; padding:2px 4px; background:#071b22d9; color:#bdebf0; font:700 9px ui-monospace,monospace; }
  .ml-score.reference-score { background:#7d168eeb; color:#fff; text-transform:uppercase; }
  .descriptor-leds { position:absolute; z-index:3; right:4px; top:4px; max-width:calc(100% - 8px); display:flex; flex-wrap:wrap; justify-content:flex-end; gap:3px; }
  .descriptor-leds i { width:7px; height:7px; flex:none; border:1px solid #f8fcfd; border-radius:50%; box-shadow:0 0 0 1px #071b2299,0 0 4px currentColor; }
  .descriptor-leds .target-descriptor { color:#f0a43c; background:#f0a43c; }
  .descriptor-leds .image-descriptor { color:#54c3dc; background:#54c3dc; }
  .tile.compact .descriptor-leds { right:2px; top:2px; gap:1px; }
  .tile.compact .descriptor-leds i { width:4px; height:4px; border:0; box-shadow:0 0 0 1px #071b2299; }
  .tile-meta { height: 25px; display: flex; align-items: center; padding: 4px 2px 0; font-size: 11px; min-width: 0; }
  .tile-meta > span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile-meta b { margin-left: auto; padding: 1px 3px; border: 1px solid #92a7ae; color: #587079; font-size: 8px; text-transform: uppercase; letter-spacing: .04em; }
  .tile-meta b + i { margin-left: 3px; }
  .tile-meta i { margin-left: auto; border-radius: 50%; background: #78909a; color: white; width: 17px; height: 17px; display: grid; place-items: center; font-style: normal; font-weight: bold; }
  .pager { display: flex; justify-content: center; align-items: center; gap: 5px; border-top: 1px solid #aebcc2; background: #edf2f4; }
  .pager button { padding: 4px 10px; }
  .empty { color: #667980; text-align: center; padding: 30px; }

  .inspector { grid-area: inspector; overflow: auto; background: var(--surface); border-left: 1px solid var(--line); }
  .inspector > h2 { padding: 14px; margin: 0; border-bottom: 1px solid #c7d1d5; }
  .inspect-image { width: 100%; height: 230px; object-fit: contain; background: var(--canvas-color); border-bottom: 1px solid #aab9bf; }
  .inspect-id { display: flex; align-items: center; padding: 9px 12px; border-bottom: 1px solid #c7d1d5; gap: 5px; }
  .inspect-id strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .inspect-id button { margin-left: auto; font-size: 10px; padding: 3px 5px; }
  .current-label { font-size: 18px; }
  .evidence-card { background:color-mix(in srgb,var(--accent) 5%,var(--surface)); border-left:3px solid var(--accent); }
  .evidence-source { display:flex; justify-content:space-between; gap:8px; margin-bottom:7px; font-weight:650; }
  .evidence-source span { color:var(--muted); font-size:8px; text-transform:uppercase; }
  .evidence-card dl { margin-bottom:9px; }
  .evidence-card dd small { color:var(--muted); }
  .evidence-actions { display:grid; gap:5px; }
  .evidence-actions button { padding:6px; font-size:9px; }
  .evidence-card > p { margin:7px 0 0; color:var(--muted); font-size:9px; line-height:1.35; }
  .classification-picker { position:relative; z-index:3; }
  .classification-picker > p { margin:-3px 0 8px; color:var(--muted); font-size:10px; line-height:1.35; }
  .combobox { position:relative; }
  .combobox > input { width:100%; padding:8px 9px; }
  .assignment-options { position:absolute; z-index:12; top:calc(100% + 2px); left:0; right:0; max-height:285px; overflow:auto; background:var(--raised); border:1px solid var(--line); box-shadow:0 8px 22px #071b2238; }
  .assignment-options button { width:100%; min-height:43px; display:flex; align-items:center; gap:7px; padding:6px 8px; border:0; border-bottom:1px solid color-mix(in srgb,var(--line) 60%,transparent); background:var(--raised); text-align:left; }
  .assignment-options button.highlighted { background:color-mix(in srgb,var(--accent) 14%,var(--raised)); }
  .assignment-options button > span { min-width:0; display:flex; flex:1; flex-direction:column; }
  .assignment-options strong,.assignment-options small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .assignment-options strong { font-size:11px; }
  .assignment-options small { color:var(--muted); font-size:9px; }
  .assignment-options em { color:var(--accent); font-size:8px; font-style:normal; }
  .no-options { padding:13px; color:var(--muted); text-align:center; font-size:10px; }
  .inspector dl { display: grid; grid-template-columns: 86px minmax(0, 1fr); margin: 8px 0 0; font-size: 11px; gap: 4px; }
  .inspector dt { text-transform: capitalize; color: #667a82; }
  .inspector dd { margin: 0; overflow-wrap: anywhere; }
  .review-buttons { display: flex; }
  .review-buttons button { flex: 1; padding: 6px 2px; margin-right: -1px; }
  .history { display: flex; gap: 8px; margin: 9px 0; }
  .history-dot { width: 7px; height: 7px; margin-top: 4px; border: 2px solid #197997; border-radius: 50%; }
  .history > div { display: flex; flex-direction: column; }
  .history span, .history em { font-size: 10px; color: #697b82; font-style: normal; }
  .history em { color: #197997; }
  .inspector-empty { margin-top: 100px; }
  .inspector section h3 { margin-bottom: 7px; }
  .taxonomy { min-height:0; flex:1; display:flex; flex-direction:column; padding: 10px 8px !important; }
  .taxonomy-title { display: flex; align-items: center; justify-content: space-between; padding: 0 5px; }
  .taxonomy-title h2 { margin: 0; }
  .taxonomy-columns { display:grid; grid-template-columns:minmax(0,1fr) 28px 28px 28px; padding:6px 2px 3px 20px; color:var(--muted); font:600 9px ui-monospace,monospace; }
  .taxonomy-columns span:not(:first-child) { text-align:right; }
  .taxonomy-list { min-height:0; flex:1; overflow: auto; border-top: 1px solid var(--line); }
  .taxonomy-row { width: 100%; min-height: 25px; display: grid; grid-template-columns: 13px minmax(0,1fr) 28px 28px 28px; align-items: center; border: 0; border-bottom: 1px solid #d9e0e2; padding: 2px 2px 2px calc(2px + var(--depth,0) * 7px); background: transparent; text-align: left; }
  .taxonomy-row.active { background: color-mix(in srgb,var(--accent) 16%,var(--surface)); color: var(--accent); }
  .taxonomy-row.unmaterialized { opacity:.68; }
  .taxonomy-all { grid-template-columns: minmax(0,1fr) auto; margin-top: 7px; padding: 5px; }
  .tree-toggle { text-align: center; color: #647a82; }
  .taxonomy-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .taxonomy-name sup { margin-left:4px; color:var(--accent); font-size:7px; }
  .use-standard { float:right; display:inline-grid; place-items:center; width:17px; height:17px; margin-left:4px; border:1px solid var(--accent); color:var(--accent); font-size:12px; line-height:1; }
  .taxonomy-row em { text-align: right; color: #61757d; font: 9px ui-monospace, monospace; font-style: normal; }
  .taxonomy-row .count-verified { color:var(--status-verified); }
  .taxonomy-row .count-unverified { color:var(--status-unverified); }
  .taxonomy-row .count-ml { color:var(--muted); }
  .taxonomy-empty { padding:18px 8px; color:var(--muted); font-size:10px; line-height:1.4; }
  .taxonomy > small { display: block; margin: 7px 5px 0; color: #718188; font-size: 9px; line-height: 1.35; }
  .workflow-help { margin: 7px 0 0; color: #697b82; font-size: 10px; }
  .preferred-badge { display:inline-block; margin:5px 0 0; padding:2px 5px; color:var(--accent); background:color-mix(in srgb,var(--accent) 10%,transparent); border:1px solid color-mix(in srgb,var(--accent) 50%,var(--line)); font-size:9px; text-transform:uppercase; letter-spacing:.04em; }
  .preferences-backdrop { position:fixed; inset:0; z-index:60; display:grid; place-items:center; padding:24px; background:#071b22b8; }
  .preferences-modal { width:min(900px,100%); max-height:min(820px,calc(100vh - 48px)); display:grid; grid-template-rows:auto minmax(0,1fr) auto; background:var(--surface); color:var(--text); border:1px solid var(--line); box-shadow:0 24px 70px #06171e66; }
  .information-modal { width:min(1120px,100%); height:min(850px,calc(100vh - 48px)); display:grid; grid-template-rows:auto minmax(0,1fr) auto; background:var(--surface); color:var(--text); border:1px solid var(--line); box-shadow:0 24px 70px #06171e66; }
  .information-loading { display:grid; place-items:center; min-height:300px; color:var(--muted); }
  .information-body { min-height:0; overflow:auto; display:grid; grid-template-columns:minmax(330px,.85fr) minmax(430px,1.35fr); }
  .information-body > section { min-width:0; padding:20px; }
  .dataset-information { border-right:1px solid var(--line); }
  .information-heading,.model-title { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
  .information-actions { display:flex; align-items:center; gap:6px; }
  .information-actions button { padding:4px 7px; border-color:var(--accent); color:var(--accent); font-size:9px; white-space:nowrap; }
  .information-heading span,.model-title span,.model-card-header span { color:var(--accent); font-size:8px; font-weight:800; letter-spacing:.14em; }
  .information-heading h3,.model-title h3 { margin:2px 0 0; font-size:17px; }
  .information-heading em { padding:3px 7px; border:1px solid var(--status-verified); color:var(--status-verified); font-size:9px; font-style:normal; text-transform:uppercase; }
  .information-stats { display:grid; grid-template-columns:repeat(4,1fr); margin:17px 0; border:1px solid var(--line); background:var(--raised); }
  .information-stats div { min-width:0; padding:9px; border-right:1px solid var(--line); }
  .information-stats div:last-child { border:0; }
  .information-stats strong,.information-stats span { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .information-stats strong { font:700 12px ui-monospace,monospace; }
  .information-stats span { margin-top:3px; color:var(--muted); font-size:8px; text-transform:uppercase; }
  .dataset-description { color:var(--muted); font-size:11px; line-height:1.45; }
  .detail-grid,.model-identity { display:grid; grid-template-columns:125px minmax(0,1fr); gap:0; margin:12px 0 18px; border-top:1px solid var(--line); font-size:9px; }
  .detail-grid dt,.detail-grid dd,.model-identity dt,.model-identity dd { min-width:0; margin:0; padding:5px 4px; border-bottom:1px solid color-mix(in srgb,var(--line) 55%,transparent); }
  .detail-grid dt,.model-identity dt { color:var(--muted); }
  .detail-grid dd,.model-identity dd { overflow:hidden; font-family:ui-monospace,monospace; text-overflow:ellipsis; white-space:nowrap; }
  .calibration-summary { display:flex; flex-direction:column; gap:2px; margin:12px 0; padding:9px; border-left:3px solid var(--accent); background:color-mix(in srgb,var(--accent) 8%,var(--raised)); }
  .calibration-summary span { color:var(--muted); font-size:9px; }
  .dataset-information h4 { margin:18px 0 7px; color:var(--muted); font-size:9px; text-transform:uppercase; letter-spacing:.08em; }
  .format-list { border-top:1px solid var(--line); }
  .format-list div { display:grid; grid-template-columns:minmax(0,1fr) 75px 55px; gap:7px; padding:5px 3px; border-bottom:1px solid color-mix(in srgb,var(--line) 55%,transparent); font-size:9px; }
  .format-list span { color:var(--muted); }
  .format-list em { text-align:right; font-style:normal; }
  .model-title { margin-bottom:13px; }
  .model-title > strong { display:grid; place-items:center; width:29px; height:29px; border:1px solid var(--line); background:var(--raised); font:700 12px ui-monospace,monospace; }
  .no-models { display:flex; flex-direction:column; gap:4px; padding:20px; border:1px dashed var(--line); color:var(--muted); }
  .no-models strong { color:var(--text); }
  .model-list { display:grid; gap:12px; }
  .model-card { padding:14px; border:1px solid var(--line); background:var(--raised); }
  .model-card-header { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
  .model-card-header h4 { margin:2px 0 1px; font-size:14px; }
  .model-card-header code { color:var(--muted); font-size:8px; }
  .model-card-header > em { flex:none; padding:3px 6px; color:var(--accent); border:1px solid var(--accent); font-size:9px; font-style:normal; }
  .coverage { height:5px; margin-top:12px; overflow:hidden; background:color-mix(in srgb,var(--line) 40%,transparent); }
  .coverage span { display:block; height:100%; background:var(--accent); }
  .coverage-label { display:flex; justify-content:space-between; margin-top:3px; color:var(--muted); font-size:8px; }
  .capability-list { display:flex; flex-wrap:wrap; gap:4px; margin:10px 0; }
  .capability-list span { padding:2px 5px; border:1px solid var(--line); color:var(--muted); font-size:8px; opacity:.55; }
  .capability-list span.available { border-color:var(--status-verified); color:var(--status-verified); opacity:1; }
  .model-identity { grid-template-columns:130px minmax(0,1fr); margin:8px 0 12px; }
  .metric-section { margin:13px 0 4px; }
  .metric-section h5 { margin:0 0 6px; color:var(--muted); font-size:9px; text-transform:uppercase; letter-spacing:.06em; }
  .metric-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:5px; }
  .metric-grid div { min-width:0; padding:7px; border-left:2px solid var(--accent); background:color-mix(in srgb,var(--accent) 7%,var(--surface)); }
  .metric-grid span,.metric-grid strong,.metric-grid small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .metric-grid span { color:var(--muted); font-size:8px; text-transform:capitalize; }
  .metric-grid strong { margin-top:2px; font:700 13px ui-monospace,monospace; }
  .metric-grid small { margin-top:3px; color:var(--muted); font-size:7px; }
  .metric-grid.compact strong { font-size:11px; }
  .metadata-disclosure { margin-top:9px; border:1px solid var(--line); background:color-mix(in srgb,var(--line) 8%,transparent); }
  .metadata-disclosure summary { cursor:pointer; padding:6px 8px; color:var(--muted); font-size:9px; font-weight:650; }
  .metadata-disclosure pre { max-height:260px; overflow:auto; margin:0; padding:9px; border-top:1px solid var(--line); background:var(--surface); color:var(--text); font:8px/1.5 ui-monospace,monospace; white-space:pre-wrap; word-break:break-word; }
  .event-list { border-top:1px solid var(--line); }
  .event-list div { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:2px 8px; padding:6px 8px; border-bottom:1px solid color-mix(in srgb,var(--line) 55%,transparent); font-size:8px; }
  .event-list time,.event-list span { color:var(--muted); }
  .event-list span { grid-column:1 / -1; }
  .import-backdrop { z-index:70; }
  .import-browser { z-index:80; }
  .import-modal { width:min(1060px,100%); height:min(850px,calc(100vh - 48px)); display:grid; grid-template-rows:auto minmax(0,1fr) auto; background:var(--surface); color:var(--text); border:1px solid var(--line); box-shadow:0 24px 70px #06171e66; }
  .import-body { min-height:0; overflow:auto; }
  .import-body > section { padding:16px 20px; border-bottom:1px solid var(--line); }
  .import-body h3 { margin:0 0 6px; font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }
  .import-body p { margin:0 0 10px; color:var(--muted); font-size:10px; line-height:1.4; }
  .import-path { display:flex; }
  .import-path input { min-width:0; flex:1; }
  .import-path button { border-left:0; white-space:nowrap; }
  .import-source-title { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
  .import-source-title > div { min-width:0; display:flex; flex-direction:column; }
  .import-source-title span { color:var(--status-verified); font-size:8px; font-weight:800; letter-spacing:.1em; }
  .import-source-title strong { margin-top:2px; font-size:14px; }
  .import-source-title code { margin-top:3px; overflow:hidden; color:var(--muted); font-size:8px; text-overflow:ellipsis; white-space:nowrap; }
  .import-source-title em { flex:none; padding:3px 6px; border:1px solid var(--line); color:var(--muted); font-size:8px; font-style:normal; text-transform:uppercase; }
  .import-counts { display:grid; grid-template-columns:repeat(4,1fr); margin-top:12px; border:1px solid var(--line); background:var(--raised); }
  .import-counts div { padding:8px 10px; border-right:1px solid var(--line); }
  .import-counts div:last-child { border:0; }
  .import-counts strong,.import-counts span { display:block; }
  .import-counts strong { font:700 13px ui-monospace,monospace; }
  .import-counts span { margin-top:2px; color:var(--muted); font-size:8px; text-transform:uppercase; }
  .import-option-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .import-option-grid label,.unavailable-option { min-height:58px; display:flex; align-items:flex-start; gap:8px; padding:10px; border:1px solid var(--line); background:var(--raised); }
  .import-option-grid input { margin:2px 0 0; accent-color:var(--accent); }
  .import-option-grid label span,.unavailable-option { flex-direction:column; }
  .import-option-grid label span { display:flex; }
  .import-option-grid strong { font-size:10px; }
  .import-option-grid small,.unavailable-option span { margin-top:3px; color:var(--muted); font-size:9px; line-height:1.35; }
  .unavailable-option { opacity:.65; }
  .duplicate-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; }
  .duplicate-heading > div:first-child { max-width:620px; }
  .duplicate-all { flex:none; display:flex; align-items:center; }
  .duplicate-all span { margin-right:6px; color:var(--muted); font-size:8px; text-transform:uppercase; }
  .duplicate-all button { padding:4px 7px; margin-left:-1px; font-size:9px; }
  .duplicate-all button.active { z-index:1; border-color:var(--accent); background:color-mix(in srgb,var(--accent) 15%,var(--raised)); color:var(--accent); }
  .duplicate-list { border:1px solid var(--line); }
  .duplicate-row { min-height:45px; display:grid; grid-template-columns:minmax(220px,1.35fr) 20px minmax(130px,.75fr) 125px; align-items:center; gap:7px; padding:5px 8px; border-bottom:1px solid color-mix(in srgb,var(--line) 60%,transparent); background:var(--raised); }
  .duplicate-row:last-child { border-bottom:0; }
  .duplicate-row > div { min-width:0; display:grid; grid-template-columns:minmax(0,1fr) auto; gap:2px 6px; }
  .duplicate-row > div strong,.duplicate-row > div code { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .duplicate-row > div strong { font-size:9px; }
  .duplicate-row > div code { grid-row:2; color:var(--muted); font-size:7px; }
  .duplicate-row > div > span { grid-column:2; grid-row:1 / span 2; display:flex; align-items:center; flex-wrap:wrap; justify-content:flex-end; gap:3px; }
  .duplicate-row em { padding:2px 3px; color:var(--accent); border:1px solid var(--accent); font-size:7px; font-style:normal; }
  .duplicate-row b { color:var(--status-needs); font-size:7px; font-weight:600; }
  .duplicate-row > code { overflow:hidden; color:var(--muted); font-size:8px; text-overflow:ellipsis; white-space:nowrap; }
  .duplicate-arrow { color:var(--muted); text-align:center; }
  .duplicate-row select { min-width:0; padding:5px; font-size:9px; }
  .duplicate-pager { display:flex; align-items:center; justify-content:flex-end; gap:10px; margin-top:7px; color:var(--muted); font-size:9px; }
  .duplicate-pager button { padding:4px 7px; }
  .import-safety { display:flex; flex-direction:column; gap:3px; border-left:4px solid var(--status-verified); background:color-mix(in srgb,var(--status-verified) 8%,var(--surface)); }
  .import-safety strong { font-size:10px; }
  .import-safety span { color:var(--muted); font-size:9px; }
  .import-result { border-left:4px solid var(--status-verified); background:color-mix(in srgb,var(--status-verified) 9%,var(--surface)); }
  .import-result > div { display:flex; flex-wrap:wrap; gap:6px; margin:10px 0; }
  .import-result > div span { padding:5px 7px; border:1px solid var(--line); background:var(--raised); font-size:9px; }
  .import-result code { display:block; overflow:hidden; color:var(--muted); font-size:8px; text-overflow:ellipsis; white-space:nowrap; }
  .import-result p { margin:8px 0 0; color:var(--status-needs); }
  .reassign-modal { width:min(560px,100%); display:grid; grid-template-rows:auto auto auto; background:var(--surface); color:var(--text); border:1px solid var(--line); box-shadow:0 24px 70px #06171e66; }
  .reassign-body { padding:18px 20px 22px; }
  .reassign-body > label:not(.deprecate-source) { display:block; margin:15px 0 6px; color:var(--muted); font-size:10px; font-weight:650; text-transform:uppercase; letter-spacing:.05em; }
  .reassign-summary { display:flex; align-items:center; gap:11px; padding:10px; background:color-mix(in srgb,var(--accent) 8%,var(--raised)); border-left:3px solid var(--accent); }
  .reassign-summary strong { font-size:22px; }
  .reassign-summary span { color:var(--muted); font-size:10px; line-height:1.4; }
  .reassign-combobox > input { width:100%; }
  .reassign-target { display:grid; grid-template-columns:52px minmax(0,1fr); gap:2px 7px; margin-top:9px; padding:7px 8px; border:1px solid var(--line); background:var(--raised); }
  .reassign-target > span { grid-row:span 2; color:var(--muted); font-size:9px; text-transform:uppercase; }
  .reassign-target strong { font-size:11px; }
  .reassign-target em { color:var(--muted); font-size:9px; font-style:normal; }
  .deprecate-source { display:flex; align-items:flex-start; gap:7px; margin-top:16px; }
  .deprecate-source input { margin:2px 0 0; accent-color:var(--accent); }
  .deprecate-source span { display:flex; flex-direction:column; }
  .deprecate-source strong { font-size:10px; }
  .deprecate-source small { color:var(--muted); font-size:9px; }
  .preferences-header { display:flex; justify-content:space-between; align-items:center; padding:18px 20px 14px; border-bottom:1px solid var(--line); }
  .preferences-header span { font-size:10px; letter-spacing:.22em; color:var(--accent); font-weight:800; }
  .preferences-header h2 { margin:2px 0 0; font-size:19px; }
  .preferences-header button { border:0; background:transparent; color:var(--text); font-size:22px; }
  .preferences-body { overflow:auto; display:grid; grid-template-columns:1fr 1.4fr; }
  .preferences-body > section { padding:18px 20px; border-right:1px solid var(--line); border-bottom:1px solid var(--line); }
  .preferences-body > .shortcut-settings { grid-row:span 2; border-right:0; }
  .preferences-body > .vocabulary-settings { grid-column:1 / -1; border-right:0; }
  .preferences-body h3 { margin:0 0 12px; font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }
  .preferences-body p { margin:-4px 0 12px; color:var(--muted); font-size:11px; }
  .preference-row { min-height:40px; display:flex; align-items:center; justify-content:space-between; gap:15px; }
  .preference-row .segmented button { min-width:65px; }
  .sticky-preference { align-items:flex-start; margin-top:5px; padding-top:10px; border-top:1px solid var(--line); }
  .sticky-preference > span { display:flex; flex-direction:column; gap:2px; }
  .sticky-preference small { max-width:230px; color:var(--muted); font-size:9px; font-weight:400; line-height:1.35; }
  .sticky-preference input { margin-top:2px; accent-color:var(--accent); }
  .color-control { display:flex; align-items:center; gap:7px; }
  .color-control input { width:40px; height:28px; padding:2px; }
  .color-control code { color:var(--muted); }
  .shortcut-grid { display:grid; grid-template-columns:1fr 1fr; gap:7px 10px; }
  .shortcut-grid label { display:grid; grid-template-columns:25px minmax(0,1fr); align-items:center; gap:5px; }
  .shortcut-grid kbd,.cheatsheet kbd { font:600 10px ui-monospace,monospace; }
  .shortcut-grid select { min-width:0; width:100%; }
  .cheatsheet { display:grid; grid-template-columns:110px minmax(0,1fr); gap:7px 10px; margin:0; font-size:11px; }
  .cheatsheet dt,.cheatsheet dd { margin:0; }
  .cheatsheet dd { color:var(--muted); }
  .vocabulary-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; }
  .vocabulary-heading h3 { margin:0; }
  .vocabulary-heading button { padding:4px 7px; font-size:9px; }
  .vocabulary-settings > p { margin:8px 0 16px; }
  .vocabulary-list { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .vocabulary-id { display:flex; align-items:flex-start; gap:8px; margin:0; padding:9px 10px; background:color-mix(in srgb,var(--accent) 8%,var(--raised)); border-left:2px solid var(--accent); }
  .vocabulary-id input { margin:2px 0 0; accent-color:var(--accent); }
  .vocabulary-id > span { min-width:0; display:flex; flex:1; flex-direction:column; }
  .vocabulary-id strong { font-size:10px; }
  .vocabulary-id small { margin-top:2px; color:var(--muted); font-size:9px; text-transform:capitalize; }
  .vocabulary-id code { margin-top:4px; overflow:hidden; color:var(--muted); font-size:8px; text-overflow:ellipsis; white-space:nowrap; }
  .label-manager { margin-top:16px; }
  .label-manager > h3 { margin-bottom:7px; }
  .manage-list { max-height:240px; overflow:auto; display:grid; grid-template-columns:1fr 1fr; column-gap:18px; margin-top:8px; border-top:1px solid var(--line); }
  .preferences-footer { display:flex; justify-content:space-between; align-items:center; padding:10px 14px; border-top:1px solid var(--line); color:var(--muted); font-size:11px; }

  .workspace.dark .gallery-tools,.workspace.dark .pager { background:var(--raised); color:var(--muted); border-color:var(--line); }
  .workspace.dark input,.workspace.dark select,.workspace.dark button { background:var(--raised); color:var(--text); border-color:var(--line); }
  .workspace.dark .tile:hover { background:color-mix(in srgb,var(--tile-status) 16%,var(--raised)); }
  .workspace.dark .filters section,.workspace.dark .inspector section,.workspace.dark .inspector > h2,.workspace.dark .inspect-id { border-color:var(--line); }
  .workspace.dark .taxonomy-row,.workspace.dark .manage-row { border-color:color-mix(in srgb,var(--line) 70%,transparent); }
  .workspace.dark .filters h2,.workspace.dark .inspector h2,.workspace.dark .inspector h3,.workspace.dark .taxonomy-row em,.workspace.dark .workflow-help { color:var(--muted); }
  .workspace.dark .segmented .active { background:color-mix(in srgb,var(--accent) 20%,var(--raised)); border-color:var(--accent); color:var(--accent); }
  .workspace.dark .sticky-indicator { color:#e1b4f2; border-color:#a66ac0; background:#492853; }

  @media (max-width:900px) {
    .information-body { grid-template-columns:1fr; }
    .dataset-information { border-right:0; border-bottom:1px solid var(--line); }
    .duplicate-row { grid-template-columns:minmax(180px,1fr) 16px minmax(100px,.6fr) 105px; }
  }

  footer { grid-area: footer; display: flex; align-items: center; gap: 12px; background: #102c36; color: #e8f1f3; padding: 0 10px; border-top: 1px solid #071b22; min-width: 0; }
  footer button { padding: 5px 7px; background: #173b47; color: #e8f1f3; border-color: #54717a; }
  footer > div:first-child { white-space: nowrap; }
  .annotation-bar { display: flex; align-items: center; gap: 3px; overflow-x: auto; flex: 1; font-size:9px; }
  .annotation-bar button { display: flex; align-items: center; gap: 3px; padding:3px 5px; white-space: nowrap; font-size:9px; }
  .annotation-bar kbd { width:15px; height:15px; color: #18333d; font-size:8px; }
  .auto { display: flex; align-items: center; white-space: nowrap; }
  .loading-line { position: fixed; top: 52px; left: 0; height: 2px; width: 40%; background: #50bec5; animation: load 1.1s infinite ease-in-out; }
  .toast { position: fixed; right: 18px; bottom: 64px; max-width: 520px; padding: 10px 36px 10px 12px; border: 1px solid; box-shadow: 0 6px 22px #0e242d25; z-index: 100; }
  .toast button { position: absolute; right: 5px; top: 5px; border: 0; background: transparent; }
  .notice { background: #e5f5f2; color: #205e53; border-color: #78b4a8; }
  @keyframes load { from { transform: translateX(-100%); } to { transform: translateX(350%); } }
  @media (max-width: 900px) {
    .workspace { grid-template-columns: 190px minmax(360px, 1fr); grid-template-areas: 'header header' 'filters gallery' 'footer footer'; }
    .inspector,.panel-resizer { display: none; }
    .dataset-title { display: none; }
    .wordmark { width: 160px; }
  }
  @media (max-width: 1180px) {
    .header-stats div:nth-child(5),.header-stats div:nth-child(6) { display:none; }
    .dataset-title { display:none; }
  }
</style>
