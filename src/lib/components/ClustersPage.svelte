<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import AuthenticatedImage from '$lib/components/AuthenticatedImage.svelte';
  import { imageInversionEnabled } from '$lib/stores/displayPreferences';
  import { getClient, session } from '$lib/stores/session';
  import { projectPreferenceKey, readPreferences, writePreferences } from '$lib/utils/preferences';
  import type { CurationRoi, FeatureSpaceCluster, FeatureSpaceRoi, FeatureSpaceSimilarityResult, FeatureSpaceSource, FeatureSpaceUmapResult, FeatureSpaceUmapRoi, Job } from '$lib/api/types';

  type BrowseMode = 'clusters' | 'similarity' | 'pca';
  type PcaAxisKey = `umap:${number}` | 'bbox_area' | 'bbox_aspect_ratio' | 'roi_image_area' | 'roi_image_aspect_ratio' | 'segmented_area';
  type PcaAxisOption = { key: PcaAxisKey; label: string; detail?: string };
  type ClusterBrowserPreferences = {
    sourceKey?: string;
    mode?: BrowseMode;
  };

  let sources: FeatureSpaceSource[] = [];
  let sourceKey = '';
  let mode: BrowseMode = 'clusters';
  let clusters: FeatureSpaceCluster[] = [];
  let members: FeatureSpaceRoi[] = [];
  let similar: FeatureSpaceRoi[] = [];
  let similaritySearch: FeatureSpaceSimilarityResult | null = null;
  let sourceRois: FeatureSpaceRoi[] = [];
  let selectedClusterId = '';
  let selectedRoi: FeatureSpaceRoi | null = null;
  let referenceRoiId = '';
  let detail: CurationRoi | null = null;
  let similarityMinimum = 0.25;
  let pca: FeatureSpaceUmapResult | null = null;
  let groupSizeUnit: 'percent' | 'count' = 'percent';
  let groupSizeValue = 0.5;
  let clusterDetail: 'broadest' | 'broad' | 'balanced' | 'detailed' | 'fine' = 'balanced';
  let clusterStrictness: 'permissive' | 'relaxed' | 'moderate' | 'balanced' | 'strict' | 'very_strict' | 'conservative' = 'conservative';
  let advancedHdbscanOverride = false;
  let hdbscanMinClusterSize = 5;
  let hdbscanMinSamples: number | null = null;
  let hdbscanEpsilon = 0;
  let hdbscanSelectionMethod: 'eom' | 'leaf' = 'eom';
  let pcaRanges: Record<string, [number, number]> = {};
  let pcaAxes: Array<[PcaAxisKey, PcaAxisKey]> = [['umap:0', 'umap:1'], ['umap:0', 'umap:2'], ['umap:0', 'umap:3'], ['umap:1', 'umap:2']];
  let analysisJob: Job | null = null;
  let analysisDisposition: string | null = null;
  let analysisEphemeral = false;
  let analysisPollTimer: number | null = null;
  let analysisRequestKey = '';
  let loadedAnalysisKey = '';
  let analysisRequestSerial = 0;
  const pageSize = 120;
  let page = 0;
  let tileSize = 150;
  let sort = 'original';
  let sourceTotal = 0;
  let loading = false;
  let detailLoading = false;
  let error = '';

  $: selectedSource = sources.find((source) => source.source_key === sourceKey) ?? null;
  $: estimatedMinimumGroupSize = semanticMinimumGroupSize();
  $: activePcaAxes = [...new Set(pcaAxes.flat())];
  $: pcaAxisOptions = availablePcaAxes(pca);
  // Keep the UMAP inputs in this reactive expression. Svelte cannot infer
  // dependencies hidden inside a no-argument helper, which previously left
  // the gallery stuck with the empty result calculated before UMAP loaded.
  $: visibleRois = mode === 'clusters'
    ? members
    : mode === 'pca'
      ? filteredPcaRois(pca, pcaRanges, activePcaAxes)
      : (referenceRoiId ? similar : sourceRois);
  $: filteredPcaIds = new Set(mode === 'pca' ? visibleRois.map((roi) => roi.id) : []);
  $: galleryTotal = mode === 'clusters' || mode === 'pca'
    ? visibleRois.length
    : mode === 'similarity'
      ? (similaritySearch?.total ?? 0)
      : sourceTotal;
  $: galleryRois = mode === 'clusters' || mode === 'pca'
    ? sortRois(visibleRois).slice(page * pageSize, (page + 1) * pageSize)
    : visibleRois;
  $: organizationTitle = 'HDBSCAN clusters';
  $: workspaceTitle = mode === 'clusters'
    ? (selectedClusterId ? `${selectedCluster?.cluster_name || selectedClusterId} members` : 'Choose an HDBSCAN cluster')
    : mode === 'pca' ? 'UMAP projection' : (referenceRoiId ? 'Similar ROIs' : 'Choose a reference ROI');
  $: clusteringSimilarity = selectedSource?.source_kind === 'clustering';
  $: similarityTitle = clusteringSimilarity ? 'Cluster-local centroid similarity' : 'Exact cosine similarity';
  $: similarityMinimumLabel = clusteringSimilarity ? 'Minimum centroid similarity' : 'Minimum cosine similarity';

  onMount(() => {
    restorePreferences();
    void loadSources();
  });

  onDestroy(() => {
    stopAnalysisPolling();
  });

  async function loadSources() {
    const client = getClient();
    if (!client) return;
    loading = true;
    error = '';
    try {
      sources = await client.featureSpaceSources();
      if (!sourceKey || !sources.some((source) => source.source_key === sourceKey)) sourceKey = sources[0]?.source_key ?? '';
      syncSemanticHdbscanParameters();
      persistPreferences();
      await refresh();
    } catch (cause) {
      error = message(cause);
    } finally {
      loading = false;
    }
  }

  async function changeSource() {
    invalidateAnalysisRequest();
    selectedClusterId = '';
    members = [];
    similar = [];
    similaritySearch = null;
    sourceRois = [];
    pca = null;
    loadedAnalysisKey = '';
    pcaRanges = {};
    referenceRoiId = '';
    page = 0;
    selectedRoi = null;
    detail = null;
    syncSemanticHdbscanParameters();
    persistPreferences();
    await refresh();
  }

  async function changeMode(next: BrowseMode) {
    mode = next;
    if (next === 'similarity' && sort === 'label') sort = 'original';
    selectedClusterId = '';
    members = [];
    similar = [];
    similaritySearch = null;
    page = 0;
    persistPreferences();
    await refresh();
  }

  async function refresh() {
    if (mode === 'clusters') await loadClusters();
    else if (mode === 'pca') await loadPca();
    else if (referenceRoiId) await loadSimilarity();
    else await loadSourceRois();
  }

  async function loadPca(force = false) {
    const client = getClient();
    if (!client || !sourceKey) { pca = null; return; }
    loading = true;
    error = '';
    const requestKey = featureSpaceAnalysisKey();
    if (!force && pca && loadedAnalysisKey === requestKey) return;
    const requestSerial = ++analysisRequestSerial;
    analysisRequestKey = requestKey;
    stopAnalysisPolling();
    try {
      const response = await client.queueFeatureSpaceUmapAnalysis({
        source_key: sourceKey,
        min_cluster_size: hdbscanMinClusterSize,
        min_samples: hdbscanMinSamples,
        cluster_selection_epsilon: hdbscanEpsilon,
        cluster_selection_method: hdbscanSelectionMethod,
        force
      });
      if (requestSerial !== analysisRequestSerial) return;
      analysisJob = response.job;
      analysisDisposition = response.disposition ?? null;
      analysisEphemeral = response.ephemeral ?? false;
      if (isTerminalAnalysisJob(analysisJob)) applyAnalysisJob(analysisJob, requestKey, requestSerial);
      else startAnalysisPolling(analysisJob.id, requestKey, requestSerial);
    } catch (cause) {
      pca = null;
      analysisJob = null;
      error = message(cause);
    } finally {
      loading = false;
    }
  }

  function applyAnalysisResult(result: FeatureSpaceUmapResult, requestKey: string) {
      pca = result;
      loadedAnalysisKey = requestKey;
      pcaRanges = Object.fromEntries((result.component_ranges ?? []).map((range) => [`umap:${range.component - 1}`, [range.minimum, range.maximum]]));
      const max = Math.max(0, result.component_count - 1);
      pcaAxes = [
        ['umap:0', `umap:${Math.min(1, max)}`],
        ['umap:0', `umap:${Math.min(2, max)}`],
        ['umap:0', `umap:${Math.min(3, max)}`],
        [`umap:${Math.min(1, max)}`, `umap:${Math.min(2, max)}`]
      ];
      if (mode === 'clusters') clusters = hdbscanClusters(result.items ?? []);
  }

  function featureSpaceAnalysisKey(): string {
    return JSON.stringify({ sourceKey, hdbscanMinClusterSize, hdbscanMinSamples, hdbscanEpsilon, hdbscanSelectionMethod });
  }

  function semanticMinimumGroupSize(): number {
    const cohortSize = Math.min(selectedSource?.embedding_count ?? 0, 5000);
    const requested = groupSizeUnit === 'percent'
      ? Math.round(cohortSize * Math.max(0, Number(groupSizeValue) || 0) / 100)
      : Math.round(Number(groupSizeValue) || 0);
    return Math.min(1000, Math.max(5, requested));
  }

  function semanticMinimumSamples(minimumGroupSize = semanticMinimumGroupSize()): number {
    const multiplier = {
      permissive: 0.1,
      relaxed: 0.15,
      moderate: 0.2,
      balanced: 0.3,
      strict: 0.45,
      very_strict: 0.7,
      conservative: 1.0
    }[clusterStrictness];
    return Math.max(2, Math.round(minimumGroupSize * multiplier));
  }

  function semanticSelectionEpsilon(): number {
    return clusterDetail === 'broadest' ? 0.2 : clusterDetail === 'broad' ? 0.1 : clusterDetail === 'balanced' ? 0.025 : 0;
  }

  async function applySemanticHdbscanControls() {
    advancedHdbscanOverride = false;
    syncSemanticHdbscanParameters();
    await changeHdbscanParameters();
  }

  function syncSemanticHdbscanParameters() {
    if (advancedHdbscanOverride) return;
    hdbscanMinClusterSize = semanticMinimumGroupSize();
    hdbscanMinSamples = semanticMinimumSamples(hdbscanMinClusterSize);
    hdbscanEpsilon = semanticSelectionEpsilon();
    hdbscanSelectionMethod = clusterDetail === 'fine' ? 'leaf' : 'eom';
  }

  async function applyAdvancedHdbscanControls() {
    advancedHdbscanOverride = true;
    await changeHdbscanParameters();
  }

  function isTerminalAnalysisJob(job: Job | null): boolean {
    return Boolean(job && !['queued', 'leased', 'working', 'paused'].includes(job.status ?? ''));
  }

  function analysisResult(job: Job): FeatureSpaceUmapResult | null {
    const result = job.result as unknown;
    const candidate = result && typeof result === 'object' && 'analysis' in result
      ? (result as { analysis: unknown }).analysis
      : result;
    return candidate && typeof candidate === 'object' && Array.isArray((candidate as FeatureSpaceUmapResult).items)
      ? candidate as FeatureSpaceUmapResult
      : null;
  }

  function applyAnalysisJob(job: Job, requestKey: string, requestSerial: number) {
    stopAnalysisPolling();
    if (requestSerial !== analysisRequestSerial || requestKey !== analysisRequestKey) return;
    if (job.status !== 'succeeded') {
      pca = null;
      error = job.error_message || 'Feature-space analysis did not complete.';
      return;
    }
    const result = analysisResult(job);
    if (!result) {
      pca = null;
      error = 'Feature-space analysis completed without a readable result.';
      return;
    }
    applyAnalysisResult(result, requestKey);
  }

  function startAnalysisPolling(jobId: string, requestKey: string, requestSerial: number) {
    stopAnalysisPolling();
    analysisPollTimer = window.setInterval(() => void pollAnalysisJob(jobId, requestKey, requestSerial), 750);
    void pollAnalysisJob(jobId, requestKey, requestSerial);
  }

  function stopAnalysisPolling() {
    if (analysisPollTimer !== null) window.clearInterval(analysisPollTimer);
    analysisPollTimer = null;
  }

  async function pollAnalysisJob(jobId: string, requestKey: string, requestSerial: number) {
    const client = getClient();
    if (!client || requestSerial !== analysisRequestSerial) return;
    try {
      const job = await client.getJob(jobId);
      if (requestSerial !== analysisRequestSerial) return;
      analysisJob = job;
      if (isTerminalAnalysisJob(job)) applyAnalysisJob(job, requestKey, requestSerial);
    } catch (cause) {
      if (requestSerial !== analysisRequestSerial) return;
      stopAnalysisPolling();
      error = message(cause);
    }
  }

  function invalidateAnalysisRequest() {
    analysisRequestSerial += 1;
    analysisRequestKey = '';
    analysisJob = null;
    analysisDisposition = null;
    analysisEphemeral = false;
    stopAnalysisPolling();
  }

  function filteredPcaRois(
    result: FeatureSpaceUmapResult | null,
    ranges: Record<string, [number, number]>,
    axes: PcaAxisKey[]
  ): FeatureSpaceUmapRoi[] {
    if (!result) return [];
    return result.items.filter((roi) => axes.every((axis) => {
      const value = pcaAxisValue(roi, axis);
      const range = ranges[axis];
      return Number.isFinite(value) && (!range || (value >= range[0] && value <= range[1]));
    }));
  }

  function setPcaAxis(plot: number, axis: 0 | 1, value: PcaAxisKey) {
    pcaAxes = pcaAxes.map((pair, index) => index === plot
      ? (axis === 0 ? [value, pair[1]] : [pair[0], value]) as [PcaAxisKey, PcaAxisKey]
      : pair);
  }

  function setPcaRange(axis: PcaAxisKey, bound: 0 | 1, value: number) {
    const current = pcaRange(axis);
    const next: [number, number] = bound === 0
      ? [Math.min(value, current[1]), current[1]]
      : [current[0], Math.max(value, current[0])];
    pcaRanges = { ...pcaRanges, [axis]: next };
  }

  function resetPcaRange(axis: PcaAxisKey) {
    const full = pcaRangeExtent(axis);
    if (full) pcaRanges = { ...pcaRanges, [axis]: full };
  }

  function pcaValuePosition(axis: PcaAxisKey, value: number): number {
    const full = pcaRangeExtent(axis);
    if (!full || !Number.isFinite(value) || full[0] === full[1]) return 50;
    return 8 + ((value - full[0]) / (full[1] - full[0])) * 84;
  }

  function pcaPosition(roi: FeatureSpaceUmapRoi, axis: PcaAxisKey): number {
    return pcaValuePosition(axis, pcaAxisValue(roi, axis));
  }

  function pcaAxisValue(roi: FeatureSpaceUmapRoi, axis: PcaAxisKey): number {
    if (axis.startsWith('umap:')) return roi.umap_coordinates?.[Number(axis.slice(5))] ?? Number.NaN;
    const width = Number(roi.roi_shape?.[1]);
    const height = Number(roi.roi_shape?.[0]);
    const bboxWidth = Number(roi.bbox_w);
    const bboxHeight = Number(roi.bbox_h);
    const logArea = (value: number): number => value > 0 ? Math.log10(value) : Number.NaN;
    if (axis === 'bbox_area') return logArea(bboxWidth * bboxHeight);
    if (axis === 'bbox_aspect_ratio') return bboxHeight > 0 ? bboxWidth / bboxHeight : Number.NaN;
    if (axis === 'roi_image_area') return logArea(width * height);
    if (axis === 'roi_image_aspect_ratio') return height > 0 ? width / height : Number.NaN;
    return logArea(Number(roi.area));
  }
  function pcaRangeExtent(axis: PcaAxisKey): [number, number] | null {
    if (axis.startsWith('umap:')) {
      const range = pca?.component_ranges?.find((candidate) => candidate.component === Number(axis.slice(5)) + 1);
      return range ? [range.minimum, range.maximum] : null;
    }
    const values = (pca?.items ?? []).map((roi) => pcaAxisValue(roi, axis)).filter(Number.isFinite);
    return values.length ? [Math.min(...values), Math.max(...values)] : null;
  }
  function availablePcaAxes(result: FeatureSpaceUmapResult | null): PcaAxisOption[] {
    if (!result) return [];
    const pcs = Array.from({ length: result.component_count }, (_, component) => ({ key: `umap:${component}` as PcaAxisKey, label: `UMAP ${component + 1}` }));
    const metadata: PcaAxisOption[] = [
      { key: 'bbox_area', label: 'log10 BBox area' }, { key: 'bbox_aspect_ratio', label: 'BBox aspect ratio' },
      { key: 'roi_image_area', label: 'log10 ROI image area' }, { key: 'roi_image_aspect_ratio', label: 'ROI image aspect ratio' },
      { key: 'segmented_area', label: 'log10 Segmented area' }
    ];
    return [...pcs, ...metadata.filter((axis) => pcaRangeExtent(axis.key) !== null)];
  }
  function pcaRange(
    axis: PcaAxisKey,
    ranges: Record<string, [number, number]> = pcaRanges
  ): [number, number] { return ranges[axis] ?? pcaRangeExtent(axis) ?? [0, 0]; }
  function pcaRangePercentage(axis: PcaAxisKey, value: number): number {
    const extent = pcaRangeExtent(axis);
    if (!extent || extent[0] === extent[1]) return 0;
    return Math.max(0, Math.min(100, ((value - extent[0]) / (extent[1] - extent[0])) * 100));
  }
  function pcaAxisLabel(axis: PcaAxisKey): string { return pcaAxisOptions.find((option) => option.key === axis)?.label ?? axis; }
  function pcaAxisDetail(axis: PcaAxisKey): string { return pcaAxisOptions.find((option) => option.key === axis)?.detail ?? ''; }
  function hdbscanClusterId(roi: FeatureSpaceRoi | null): string {
    const hdbscan = roi as Partial<FeatureSpaceUmapRoi> | null;
    if (hdbscan?.hdbscan_cluster_id) return hdbscan.hdbscan_cluster_id;
    return hdbscan?.hdbscan_label === -1 ? 'Noise' : 'Not assigned';
  }

  async function loadSourceRois() {
    const client = getClient();
    if (!client || !sourceKey) {
      sourceRois = [];
      return;
    }
    loading = true;
    error = '';
    try {
      const result = await client.featureSpaceRois(sourceKey, {
        limit: pageSize,
        offset: page * pageSize,
        sort_by: sort === 'label' ? 'original' : sort as 'original' | 'image_area_asc' | 'image_area_desc' | 'longest_side_asc' | 'longest_side_desc'
      });
      sourceRois = result.items ?? [];
      sourceTotal = result.total ?? 0;
    } catch (cause) {
      sourceRois = [];
      error = message(cause);
    } finally {
      loading = false;
    }
  }

  async function loadClusters() {
    if (!sourceKey) {
      clusters = [];
      return;
    }
    await loadPca();
    if (pca) clusters = hdbscanClusters(pca.items);
  }

  async function selectCluster(cluster: FeatureSpaceCluster) {
    if (!pca) return;
    selectedClusterId = cluster.cluster_id;
    members = cluster.cluster_id === 'hdbscan:noise'
      ? pca.items.filter((roi) => roi.hdbscan_label < 0)
      : pca.items.filter((roi) => roi.hdbscan_cluster_id === cluster.cluster_id);
    page = 0;
    if (members[0]) await selectRoi(members[0]);
  }

  async function changeHdbscanParameters() {
    selectedClusterId = '';
    members = [];
    page = 0;
    pca = null;
    loadedAnalysisKey = '';
    pcaRanges = {};
    invalidateAnalysisRequest();
    await refresh();
  }

  async function recomputeHdbscan() {
    selectedClusterId = '';
    members = [];
    page = 0;
    pca = null;
    loadedAnalysisKey = '';
    pcaRanges = {};
    invalidateAnalysisRequest();
    await loadPca(true);
  }

  function hdbscanClusters(items: FeatureSpaceUmapRoi[]): FeatureSpaceCluster[] {
    const groups = new Map<string, FeatureSpaceUmapRoi[]>();
    for (const roi of items) {
      if (!roi.hdbscan_cluster_id) continue;
      const group = groups.get(roi.hdbscan_cluster_id) ?? [];
      group.push(roi);
      groups.set(roi.hdbscan_cluster_id, group);
    }
    const clustered = [...groups.entries()].map(([clusterId, members]) => {
      const representative = [...members].sort((left, right) => right.hdbscan_membership_strength - left.hdbscan_membership_strength || left.id.localeCompare(right.id))[0];
      const strengths = members.map((item) => item.hdbscan_membership_strength);
      return {
        cluster_id: clusterId,
        cluster_name: `Cluster ${representative.hdbscan_label}`,
        roi_count: members.length,
        mean_similarity: strengths.reduce((sum, value) => sum + value, 0) / strengths.length,
        min_similarity: Math.min(...strengths),
        max_similarity: Math.max(...strengths),
        novelty_count: 0,
        representative_detection_id: representative.id,
        representative_similarity: representative.hdbscan_membership_strength
      };
    }).sort((left, right) => right.roi_count - left.roi_count || left.cluster_id.localeCompare(right.cluster_id));
    const noise = items.filter((item) => item.hdbscan_label < 0);
    if (!noise.length) return clustered;
    const representative = [...noise].sort((left, right) => left.id.localeCompare(right.id))[0];
    return [
      ...clustered,
      {
        cluster_id: 'hdbscan:noise',
        cluster_name: 'Unclustered / noise',
        roi_count: noise.length,
        mean_similarity: 0,
        min_similarity: 0,
        max_similarity: 0,
        novelty_count: 0,
        representative_detection_id: representative.id,
        representative_similarity: 0
      }
    ];
  }

  async function loadSimilarity() {
    const client = getClient();
    if (!client || !sourceKey || !referenceRoiId) {
      similar = [];
      similaritySearch = null;
      return;
    }
    loading = true;
    error = '';
    try {
      const result = await client.similarCurationRois(referenceRoiId, sourceKey, {
        limit: pageSize,
        minimum: similarityMinimum,
        offset: page * pageSize
      });
      similar = result.items ?? [];
      similaritySearch = result;
    } catch (cause) {
      similar = [];
      similaritySearch = null;
      error = message(cause);
    } finally {
      loading = false;
    }
  }

  async function selectRoi(roi: FeatureSpaceRoi) {
    const client = getClient();
    if (!client) return;
    selectedRoi = roi;
    detail = null;
    detailLoading = true;
    try {
      detail = await client.getCurationRoi(roi.id);
    } catch (cause) {
      error = message(cause);
    } finally {
      detailLoading = false;
    }
  }

  async function useSelectedAsReference() {
    if (!selectedRoi) return;
    referenceRoiId = selectedRoi.id;
    page = 0;
    await changeMode('similarity');
  }

  async function chooseReference(roi: FeatureSpaceRoi) {
    referenceRoiId = roi.id;
    page = 0;
    await Promise.all([selectRoi(roi), loadSimilarity()]);
  }

  function score(value: number | null | undefined): string {
    return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : '—';
  }

  function sortRois(rois: FeatureSpaceRoi[]): FeatureSpaceRoi[] {
    if (sort === 'original') return rois;
    const area = (roi: FeatureSpaceRoi) => Number(roi.roi_shape?.[0] ?? 0) * Number(roi.roi_shape?.[1] ?? 0);
    const longestSide = (roi: FeatureSpaceRoi) => Math.max(Number(roi.roi_shape?.[0] ?? 0), Number(roi.roi_shape?.[1] ?? 0));
    const compare = (left: FeatureSpaceRoi, right: FeatureSpaceRoi) => {
      if (sort === 'label') return (left.label_display_name ?? '').localeCompare(right.label_display_name ?? '') || left.id.localeCompare(right.id);
      if (sort === 'image_area_asc') return area(left) - area(right) || left.id.localeCompare(right.id);
      if (sort === 'image_area_desc') return area(right) - area(left) || left.id.localeCompare(right.id);
      if (sort === 'longest_side_asc') return longestSide(left) - longestSide(right) || left.id.localeCompare(right.id);
      if (sort === 'longest_side_desc') return longestSide(right) - longestSide(left) || left.id.localeCompare(right.id);
      return left.id.localeCompare(right.id);
    };
    return [...rois].sort(compare);
  }

  async function changePage(next: number) {
    page = Math.max(0, next);
    if (mode === 'similarity') await loadSimilarity();
    else if (mode !== 'clusters' && mode !== 'pca') await loadSourceRois();
  }

  async function changeSort() {
    page = 0;
    if (mode === 'similarity') return;
    if (mode !== 'clusters' && mode !== 'pca') await loadSourceRois();
  }

  function whole(value: number | string | null | undefined): string {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed).toLocaleString() : '—';
  }

  function bboxSummary(roi: CurationRoi): string {
    return `x ${whole(roi.bbox_x)}, y ${whole(roi.bbox_y)}, ${whole(roi.bbox_w)} × ${whole(roi.bbox_h)} px`;
  }

  function imageSize(roi: CurationRoi): string {
    const shape = roi.roi_shape;
    if (!shape || shape.length < 2) return '—';
    const [height, width, channels] = shape;
    if (!Number.isFinite(height) || !Number.isFinite(width)) return '—';
    return `${width} × ${height}px${channels && channels > 1 ? ` · ${channels} channels` : ''}`;
  }

  function frameSize(roi: CurationRoi): string {
    if (!Number.isFinite(roi.frame_width) || !Number.isFinite(roi.frame_height)) return '—';
    return `${roi.frame_width} × ${roi.frame_height}px`;
  }

  function capturedAt(value: string | null | undefined): string {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  function sourceLabel(source: FeatureSpaceSource): string {
    const dimension = embeddingDimension(source);
    const vectorLabel = `${source.embedding_count.toLocaleString()} ROI vector${source.embedding_count === 1 ? '' : 's'}`;
    return `${source.source_kind} · ${source.model_selector || source.inference_run_id.slice(0, 8)} · ${dimension ? `${dimension}-D` : 'dimension unavailable'} · ${vectorLabel}`;
  }

  function embeddingDimension(source: FeatureSpaceSource): number | null {
    const shape = source.embedding_shape;
    if (!shape?.length || !shape.every((value) => Number.isInteger(value) && value > 0)) return null;
    return shape.reduce((size, value) => size * value, 1);
  }

  function preferenceKey(): string {
    return projectPreferenceKey('cluster-browser', $session);
  }

  function restorePreferences() {
    const saved = readPreferences<ClusterBrowserPreferences>(preferenceKey());
    if (!saved) return;
    if (saved.mode === 'clusters' || saved.mode === 'similarity' || saved.mode === 'pca') mode = saved.mode;
    if (typeof saved.sourceKey === 'string') sourceKey = saved.sourceKey;
  }

  function persistPreferences() {
    writePreferences(preferenceKey(), { sourceKey, mode });
  }

  function sourceForKey(key: string): FeatureSpaceSource | undefined {
    return sources.find((source) => source.source_key === key);
  }

  function imageUrl(path: string | null | undefined): string {
    const client = getClient();
    return client && path ? client.resolveApiUrl(path) : '';
  }

  function representativeUrl(cluster: FeatureSpaceCluster): string {
    return imageUrl(`/refined-detections/${encodeURIComponent(cluster.representative_detection_id)}/roi?format=jpg&width=120`);
  }

  $: selectedCluster = clusters.find((cluster) => cluster.cluster_id === selectedClusterId) ?? null;

  function message(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
  }
</script>

<div class="cluster-workspace">
  <aside class="cluster-rail panel">
    <p class="eyebrow">Feature-space browser</p>
    <h2>Clusters</h2>
    <p class="rail-intro">Navigate only within one recorded model run. Self-supervised clusters and classification label prototypes are evidence, never human taxonomy labels.</p>

    <label>Evidence source
      <select bind:value={sourceKey} on:change={changeSource} disabled={!sources.length}>
        {#each sources as source}
          <option value={source.source_key}>{sourceLabel(source)}</option>
        {/each}
      </select>
    </label>

    {#if selectedSource}
      <dl class="source-details">
        <dt>Evidence</dt><dd>{selectedSource.source_kind}</dd>
        <dt>Model</dt><dd>{selectedSource.model_selector || 'Recorded model run'}</dd>
        <dt>Dimension</dt><dd>{embeddingDimension(selectedSource) ? `${embeddingDimension(selectedSource)}-D` : 'Unavailable'}</dd>
        <dt>ROI vectors</dt><dd>{selectedSource.embedding_count.toLocaleString()}</dd>
        <dt>Run</dt><dd title={selectedSource.inference_run_id}>{selectedSource.inference_run_id.slice(0, 12)}</dd>
      </dl>
    {/if}

    <div class="mode-tabs" role="tablist" aria-label="Feature-space browse mode">
      <button class:active={mode === 'clusters'} on:click={() => changeMode('clusters')}>{organizationTitle}</button>
      <button class:active={mode === 'similarity'} on:click={() => changeMode('similarity')}>Similarity</button>
      <button class:active={mode === 'pca'} on:click={() => changeMode('pca')}>UMAP</button>
    </div>

    {#if mode === 'clusters' || mode === 'pca'}
      <section class="hdbscan-controls" aria-label="HDBSCAN clustering controls">
        <div class="control-heading">
          <div><p class="eyebrow">Exploratory organization</p><h3>Group the current embedding set</h3></div>
          <span>HDBSCAN</span>
        </div>
        <p class="control-intro">Tune how the stored ROI embeddings are organized. Unclustered ROIs remain available in the gallery and UMAP.</p>
        <div class="semantic-control">
          <label for="minimum-group-size">Minimum group size</label>
          <div class="group-size-input">
            <input id="minimum-group-size" type="number" min={groupSizeUnit === 'percent' ? 0.01 : 2} max={groupSizeUnit === 'percent' ? 100 : 1000} step={groupSizeUnit === 'percent' ? 0.05 : 1} bind:value={groupSizeValue} on:change={applySemanticHdbscanControls} />
            <select aria-label="Minimum group size unit" bind:value={groupSizeUnit} on:change={applySemanticHdbscanControls}><option value="percent">% of ROIs</option><option value="count">ROIs</option></select>
          </div>
          <small>About {estimatedMinimumGroupSize.toLocaleString()} ROI{estimatedMinimumGroupSize === 1 ? '' : 's'} in the analyzed cohort (up to 5,000 ROIs). Groups smaller than five ROIs are not created.</small>
        </div>
        <div class="semantic-control">
          <label for="cluster-detail">Cluster detail <output>{clusterDetail === 'broadest' ? 'Broadest families' : clusterDetail === 'broad' ? 'Broad families' : clusterDetail === 'balanced' ? 'Balanced' : clusterDetail === 'detailed' ? 'Detailed groups' : 'Fine groups'}</output></label>
          <input id="cluster-detail" class="semantic-range" type="range" min="0" max="4" step="1" value={['broadest', 'broad', 'balanced', 'detailed', 'fine'].indexOf(clusterDetail)} aria-valuetext={clusterDetail} on:change={(event) => { clusterDetail = ['broadest', 'broad', 'balanced', 'detailed', 'fine'][Number(event.currentTarget.value)] as typeof clusterDetail; applySemanticHdbscanControls(); }} />
          <div class="range-ends"><span>Broad</span><span>Fine</span></div>
        </div>
        <div class="semantic-control">
          <label for="cluster-strictness">Cluster strictness <output>{clusterStrictness[0].toUpperCase() + clusterStrictness.slice(1).replace('_', ' ')}</output></label>
          <input id="cluster-strictness" class="semantic-range" type="range" min="0" max="6" step="1" value={['permissive', 'relaxed', 'moderate', 'balanced', 'strict', 'very_strict', 'conservative'].indexOf(clusterStrictness)} aria-valuetext={clusterStrictness.replace('_', ' ')} on:change={(event) => { clusterStrictness = ['permissive', 'relaxed', 'moderate', 'balanced', 'strict', 'very_strict', 'conservative'][Number(event.currentTarget.value)] as typeof clusterStrictness; applySemanticHdbscanControls(); }} />
          <div class="range-ends"><span>Include unusual ROIs</span><span>Strong groups only</span></div>
        </div>
        <details class="hdbscan-advanced">
          <summary>Advanced HDBSCAN settings</summary>
          <p>For expert use. Changing a value here overrides the semantic settings until you adjust one of the controls above.</p>
          <div class="advanced-grid">
            <label>Minimum cluster size<input type="number" min="2" max="1000" bind:value={hdbscanMinClusterSize} on:change={applyAdvancedHdbscanControls} /></label>
            <label>Minimum samples<input type="number" min="1" max="1000" placeholder="same as cluster size" bind:value={hdbscanMinSamples} on:change={applyAdvancedHdbscanControls} /></label>
            <label>Cluster selection<select bind:value={hdbscanSelectionMethod} on:change={applyAdvancedHdbscanControls}><option value="eom">EOM</option><option value="leaf">Leaf</option></select></label>
            <label>Selection epsilon<input type="number" min="0" max="10" step="0.01" bind:value={hdbscanEpsilon} on:change={applyAdvancedHdbscanControls} /></label>
          </div>
        </details>
        <p class="control-footnote">All models contribute through persisted embeddings; these settings only change this run’s exploratory grouping.</p>
        {#if analysisJob}
          <p class="analysis-status" class:failed={analysisJob.status !== 'succeeded' && isTerminalAnalysisJob(analysisJob)}>
            Analysis {analysisJob.status ?? 'queued'}{#if analysisJob.progress?.message} · {analysisJob.progress.message}{/if}
            {#if analysisDisposition} · {analysisDisposition}{/if}
            {#if analysisEphemeral} · temporary cache{/if}
          </p>
        {/if}
        <button class="refresh analysis-recompute" on:click={recomputeHdbscan} disabled={loading || Boolean(analysisJob && !isTerminalAnalysisJob(analysisJob))}>Recompute analysis</button>
      </section>
    {/if}

    {#if mode === 'similarity'}
      <section class="similarity-control">
        <label>{similarityMinimumLabel} <input type="range" min="-1" max="1" step="0.05" bind:value={similarityMinimum} on:change={() => { page = 0; loadSimilarity(); }} /><output>{Number(similarityMinimum).toFixed(2)}</output></label>
        <p>{referenceRoiId ? `${clusteringSimilarity ? 'Reference cluster member' : 'Reference ROI'} ${referenceRoiId.slice(0, 12)}${clusteringSimilarity ? ' · ranked by recorded fit to the shared cluster centroid' : ''}` : 'Select an ROI, then use it as the reference.'}</p>
        {#if similaritySearch?.search_scope === 'deterministic_prefix'}<p class="provenance-note">Exact cosine search ranked the first {similaritySearch.scanned_vector_count.toLocaleString()} of {similaritySearch.total_vector_count.toLocaleString()} ROI vectors in stable ID order. A materialized run index is required for full-source search at this scale.</p>{/if}
        {#if similaritySearch?.search_scope === 'full_source'}<p class="provenance-note">Exact cosine search covered all {similaritySearch.total_vector_count.toLocaleString()} ROI vectors in this run.</p>{/if}
      </section>
    {/if}
    {#if (mode === 'pca' || mode === 'clusters') && pca}
      <section class="pca-summary">
        <p>{pca.readable_embedding_count.toLocaleString()} readable vectors{#if pca.unreadable_embedding_count}, {pca.unreadable_embedding_count.toLocaleString()} unreadable{/if}. HDBSCAN identified {pca.cluster_count} groups and {pca.noise_count} noise vectors.</p>
        <p class="provenance-note">10-D UMAP uses fixed seed {pca.random_seed}; HDBSCAN groups are exploratory and repeatable for the same stored-vector cohort.</p>
        {#if pca.projection_scope}<p class="provenance-note">Projection scope: {pca.projection_scope.replaceAll('_', ' ')}.</p>{/if}
      </section>
    {/if}

    <button class="refresh" on:click={loadSources} disabled={loading}>Refresh evidence sources</button>
  </aside>

  <main class:clusters-mode={mode === 'clusters'} class:pca-mode={mode === 'pca'} class="cluster-gallery panel">
    <header>
      <div><p class="eyebrow">{mode === 'clusters' ? 'Run-local organization' : mode === 'pca' ? 'Run-local UMAP and HDBSCAN exploration' : similarityTitle}</p><h2>{workspaceTitle}</h2></div>
      {#if mode === 'clusters'}<span>{pca?.cluster_count.toLocaleString() ?? 0} HDBSCAN clusters{#if pca?.noise_count} · {pca.noise_count.toLocaleString()} unclustered{/if}</span>{:else if mode === 'pca'}<span>{galleryTotal.toLocaleString()} of {pca?.items.length.toLocaleString() ?? 0} ROIs</span>{:else if referenceRoiId}<span>{galleryTotal.toLocaleString()} results</span>{:else}<span>{galleryTotal.toLocaleString()} reference candidates</span>{/if}
    </header>

    {#if !sources.length && !loading}
      <p class="empty">Run classification or embedding evidence before browsing this project’s feature spaces. Legacy clustering evidence remains available for historical runs.</p>
    {:else if mode === 'clusters'}
      <section class="cluster-list" data-image-scroll-root aria-label={`HDBSCAN clusters in selected evidence run`}>
        {#each clusters as cluster (cluster.cluster_id)}
          <button class:selected={selectedClusterId === cluster.cluster_id} class="cluster-card" on:click={() => selectCluster(cluster)}>
            <span class="cluster-prototype">
              {#if representativeUrl(cluster)}<AuthenticatedImage src={representativeUrl(cluster)} alt={`Representative ROI for ${cluster.cluster_id}`} imageClass="cluster-prototype-image" invert={$imageInversionEnabled} />{/if}
            </span>
            <span class="cluster-card-copy"><strong>{cluster.cluster_name || cluster.cluster_id}</strong><small>{cluster.cluster_id === 'hdbscan:noise' ? `${cluster.roi_count.toLocaleString()} valid ROIs not assigned by HDBSCAN` : `${cluster.roi_count.toLocaleString()} ROIs · mean membership ${score(cluster.mean_similarity)}`}</small></span>
          </button>
        {/each}
      </section>
      {#if !clusters.length && !loading}<p class="empty">HDBSCAN found no non-noise cluster for these parameters.</p>{/if}
    {/if}

    {#if mode === 'pca' && pca}
      <section class="pca-plots" aria-label="Linked UMAP scatter plots">
        {#each pcaAxes as axes, plotIndex (plotIndex)}
          {@const xRange = pcaRange(axes[0], pcaRanges)}
          {@const yRange = pcaRange(axes[1], pcaRanges)}
          {@const xExtent = pcaRangeExtent(axes[0]) ?? [0, 0]}
          {@const yExtent = pcaRangeExtent(axes[1]) ?? [0, 0]}
          <article class="pca-plot">
            <div class="pca-plot-title">
              <label>Horizontal
                <select value={axes[0]} on:change={(event) => setPcaAxis(plotIndex, 0, event.currentTarget.value as PcaAxisKey)}>
                  {#each pcaAxisOptions as option}<option value={option.key}>{option.label}</option>{/each}
                </select>
              </label>
              <label>Vertical
                <select value={axes[1]} on:change={(event) => setPcaAxis(plotIndex, 1, event.currentTarget.value as PcaAxisKey)}>
                  {#each pcaAxisOptions as option}<option value={option.key}>{option.label}</option>{/each}
                </select>
              </label>
            </div>
            <div class="pca-plot-body">
              <div class="pca-range pca-range-y">
                <div class="pca-range-y-heading"><strong>{pcaAxisLabel(axes[1])}</strong><button class="pca-reset" on:click={() => resetPcaRange(axes[1])} aria-label={`Reset ${pcaAxisLabel(axes[1])} filter`} title={`Reset ${pcaAxisLabel(axes[1])} filter`}>↺</button></div>
                <div class="pca-dual-range">
                  <span class="pca-range-fill" style={`bottom:${pcaRangePercentage(axes[1], yRange[0])}%;height:${pcaRangePercentage(axes[1], yRange[1]) - pcaRangePercentage(axes[1], yRange[0])}%`}></span>
                  <input aria-label={`Minimum ${pcaAxisLabel(axes[1])}`} type="range" min={yExtent[0]} max={yExtent[1]} step="any" value={yRange[0]} on:input={(event) => setPcaRange(axes[1], 0, Number(event.currentTarget.value))} />
                  <input aria-label={`Maximum ${pcaAxisLabel(axes[1])}`} type="range" min={yExtent[0]} max={yExtent[1]} step="any" value={yRange[1]} on:input={(event) => setPcaRange(axes[1], 1, Number(event.currentTarget.value))} />
                </div>
                <small>{yRange[0].toFixed(2)} to {yRange[1].toFixed(2)}{#if pcaAxisDetail(axes[1])} · {pcaAxisDetail(axes[1])}{/if}</small>
              </div>
              <svg viewBox="0 0 100 100" role="img" aria-label={`Scatter plot of ${pcaAxisLabel(axes[0])} and ${pcaAxisLabel(axes[1])}`}>
                <line x1="8" y1="92" x2="92" y2="92" /><line x1="8" y1="8" x2="8" y2="92" />
                <rect
                  class="pca-filter-region"
                  x={pcaValuePosition(axes[0], xRange[0])}
                  y={100 - pcaValuePosition(axes[1], yRange[1])}
                  width={pcaValuePosition(axes[0], xRange[1]) - pcaValuePosition(axes[0], xRange[0])}
                  height={pcaValuePosition(axes[1], yRange[1]) - pcaValuePosition(axes[1], yRange[0])}
                />
                <line class="pca-filter-line" x1={pcaValuePosition(axes[0], xRange[0])} y1="8" x2={pcaValuePosition(axes[0], xRange[0])} y2="92" />
                <line class="pca-filter-line" x1={pcaValuePosition(axes[0], xRange[1])} y1="8" x2={pcaValuePosition(axes[0], xRange[1])} y2="92" />
                <line class="pca-filter-line" x1="8" y1={100 - pcaValuePosition(axes[1], yRange[0])} x2="92" y2={100 - pcaValuePosition(axes[1], yRange[0])} />
                <line class="pca-filter-line" x1="8" y1={100 - pcaValuePosition(axes[1], yRange[1])} x2="92" y2={100 - pcaValuePosition(axes[1], yRange[1])} />
                {#each pca.items as roi (roi.id)}
                  <circle class:filtered={!filteredPcaIds.has(roi.id)} class:selected={selectedRoi?.id === roi.id} class:noise={roi.hdbscan_label < 0} style={roi.hdbscan_label < 0 ? undefined : `--hdbscan-hue:${(roi.hdbscan_label * 47) % 360}`} cx={pcaPosition(roi, axes[0])} cy={100 - pcaPosition(roi, axes[1])} r="1.35" role="button" tabindex="0" aria-label={`Inspect ROI ${roi.id}; ${roi.hdbscan_label < 0 ? 'HDBSCAN noise' : `HDBSCAN cluster ${roi.hdbscan_label}`}`} on:click={() => selectRoi(roi)} on:keydown={(event) => (event.key === 'Enter' || event.key === ' ') && (event.preventDefault(), selectRoi(roi))} />
                {/each}
              </svg>
            </div>
            <div class="pca-range pca-range-x">
              <div><strong>{pcaAxisLabel(axes[0])}</strong>{#if pcaAxisDetail(axes[0])}<span>{pcaAxisDetail(axes[0])}</span>{/if}<button class="pca-reset" on:click={() => resetPcaRange(axes[0])} aria-label={`Reset ${pcaAxisLabel(axes[0])} filter`} title={`Reset ${pcaAxisLabel(axes[0])} filter`}>↺</button></div>
              <div class="pca-dual-range">
                <span class="pca-range-fill" style={`left:${pcaRangePercentage(axes[0], xRange[0])}%;width:${pcaRangePercentage(axes[0], xRange[1]) - pcaRangePercentage(axes[0], xRange[0])}%`}></span>
                <input aria-label={`Minimum ${pcaAxisLabel(axes[0])}`} type="range" min={xExtent[0]} max={xExtent[1]} step="any" value={xRange[0]} on:input={(event) => setPcaRange(axes[0], 0, Number(event.currentTarget.value))} />
                <input aria-label={`Maximum ${pcaAxisLabel(axes[0])}`} type="range" min={xExtent[0]} max={xExtent[1]} step="any" value={xRange[1]} on:input={(event) => setPcaRange(axes[0], 1, Number(event.currentTarget.value))} />
              </div>
              <small>{xRange[0].toFixed(2)} to {xRange[1].toFixed(2)}</small>
            </div>
          </article>
        {/each}
      </section>
    {:else if mode === 'pca' && !loading && !error}
      <p class="empty">UMAP and HDBSCAN require at least five compatible vectors in this evidence run.</p>
    {/if}

    {#if visibleRois.length}
      <section class="gallery-tools">
        {#if mode === 'similarity'}<span class="similarity-sort">Ranked by similarity</span>{:else}<label>Sort <select bind:value={sort} on:change={changeSort}><option value="original">Source order</option>{#if mode === 'clusters' || mode === 'pca'}<option value="label">Label</option>{/if}<option value="image_area_asc">Image area · smallest</option><option value="image_area_desc">Image area · largest</option><option value="longest_side_asc">Longest side · shortest</option><option value="longest_side_desc">Longest side · longest</option></select></label>{/if}
        <label class="scale-control">Scale <input aria-label="ROI gallery scale" type="range" min="64" max="256" step="16" bind:value={tileSize} /><output>{(tileSize / 128).toFixed(1)}×</output></label>
      </section>
      <section class="roi-grid" data-image-scroll-root aria-label={`${workspaceTitle} ROI results`} style={`--cluster-tile-size:${tileSize}px`}>
        {#each galleryRois as roi (roi.id)}
          <button class:selected={selectedRoi?.id === roi.id} class:reference={referenceRoiId === roi.id} class="roi-card" on:click={() => mode === 'similarity' && !referenceRoiId ? chooseReference(roi) : selectRoi(roi)} title={mode === 'similarity' && !referenceRoiId ? `Use ROI ${roi.id} as the similarity reference` : `Inspect ROI ${roi.id}`}>
            {#if imageUrl(roi.thumbnail_url)}<AuthenticatedImage src={imageUrl(roi.thumbnail_url)} alt="Feature-space ROI" imageClass="cluster-roi-image" invert={$imageInversionEnabled} />{/if}
            <span class="roi-score">{score(roi.similarity)}</span>
            <strong>{roi.label_display_name || 'Unlabeled'}</strong>
            <small>{roi.asset_filename || roi.id.slice(0, 8)}</small>
          </button>
        {/each}
      </section>
      {#if galleryTotal > pageSize}
        <div class="pager"><button disabled={page === 0 || loading} on:click={() => changePage(page - 1)}>← Previous</button><span>{(page * pageSize + 1).toLocaleString()}–{Math.min(galleryTotal, (page + 1) * pageSize).toLocaleString()} of {galleryTotal.toLocaleString()}</span><button disabled={loading || (page + 1) * pageSize >= galleryTotal} on:click={() => changePage(page + 1)}>Next →</button></div>
      {/if}
    {:else if mode === 'similarity' && referenceRoiId && !loading && !error}
      <p class="empty">No ROIs meet this similarity threshold.</p>
    {:else if mode === 'similarity' && !loading && !error}
      <p class="empty">No ROIs with stored vectors are available in this evidence run.</p>
    {:else if mode === 'pca' && pca && !loading && !error}
      <p class="empty">No ROIs fall within the selected UMAP ranges.</p>
    {/if}
  </main>

  <aside class="cluster-inspector panel">
    <p class="eyebrow">ROI evidence</p>
    <h2>{selectedRoi?.label_display_name || 'Inspect ROI'}</h2>
    {#if detailLoading}<p class="empty">Loading ROI evidence…</p>
    {:else if detail}
      {#if imageUrl(detail.roi_url)}<AuthenticatedImage src={imageUrl(detail.roi_url)} alt="Selected ROI" imageClass="cluster-inspect-image" eager invert={$imageInversionEnabled} />{/if}
      <dl>
        <dt>Asset</dt><dd>{detail.asset_filename || detail.asset_id || '—'}</dd>
        <dt>ROI</dt><dd title={detail.id}>{detail.id.slice(0, 12)}{detail.roi_index !== null && detail.roi_index !== undefined ? ` · #${detail.roi_index}` : ''}</dd>
        <dt>BBox</dt><dd>{bboxSummary(detail)}</dd>
        <dt>Frame size</dt><dd>{frameSize(detail)}</dd>
        <dt>ROI image</dt><dd>{imageSize(detail)}</dd>
        <dt>Segmented area</dt><dd>{detail.area === null || detail.area === undefined ? '—' : `${whole(detail.area)} px²`}</dd>
        <dt>Frame</dt><dd>{detail.frame_index === null || detail.frame_index === undefined ? '—' : `#${detail.frame_index}`}</dd>
        <dt>Captured</dt><dd title={detail.captured_at || undefined}>{capturedAt(detail.captured_at)}</dd>
        <dt>Label</dt><dd>{detail.label_display_name || 'Unlabeled'}</dd>
        <dt>Review</dt><dd>{detail.review_decision ? detail.review_decision.replace('_', ' ') : 'Not reviewed'}</dd>
        <dt>{mode === 'clusters' || mode === 'pca' ? 'HDBSCAN cluster' : 'Recorded cluster'}</dt><dd>{mode === 'clusters' || mode === 'pca' ? hdbscanClusterId(selectedRoi) : (selectedRoi?.cluster_name || selectedRoi?.cluster_id || detail.cluster_id || 'Not assigned')}</dd>
        <dt>{clusteringSimilarity ? 'Centroid fit' : 'Similarity'}</dt><dd>{score(selectedRoi?.similarity)}</dd>
      </dl>
      <button class="primary" on:click={useSelectedAsReference}>Explore similar ROIs</button>
      {#if referenceRoiId === detail.id}<p class="reference-note">This ROI is the current similarity reference.</p>{/if}
      {#if selectedSource?.source_kind === 'clustering' && detail.clustering_evidence?.length}<p class="provenance-note">Cluster evidence remains scoped to the selected run and model artifact.</p>{:else if selectedSource?.source_kind === 'embedding' && detail.embedding_evidence?.length}<p class="provenance-note">Embedding evidence remains scoped to the selected run and model artifact.</p>{/if}
    {:else}
      <p class="empty">Choose an ROI to inspect its evidence. In Similarity mode, the first ROI you choose becomes the reference.</p>
    {/if}
  </aside>

  {#if loading}<div class="loading-line" aria-label="Loading feature-space evidence"></div>{/if}
  {#if error}<div class="toast error">{error}<button on:click={() => (error = '')}>×</button></div>{/if}
</div>

<style>
  .cluster-workspace{display:grid;grid-template-columns:280px minmax(420px,1fr)330px;gap:12px;min-height:calc(100vh - 128px)}.panel{background:var(--surface,#fff);border:1px solid var(--border,#cbd5d9);border-radius:10px;min-width:0}.cluster-rail,.cluster-inspector{padding:14px;overflow:auto;max-height:calc(100vh - 128px)}.eyebrow{margin:0;color:var(--muted,#667);font-size:10px;text-transform:uppercase;letter-spacing:.08em}.cluster-rail h2,.cluster-inspector h2,.cluster-gallery h2{margin:0 0 10px}.rail-intro,.similarity-control p,.provenance-note,.reference-note,.pca-summary p,.hdbscan-controls p{color:var(--muted,#667);font-size:.76rem;line-height:1.45}.cluster-rail label{display:grid;gap:4px;margin:12px 0;color:var(--muted,#667);font-size:.72rem;font-weight:700}.cluster-rail select,.cluster-rail input{min-width:0;padding:7px;border:1px solid var(--border,#bac5ca);border-radius:5px;background:var(--surface,#fff);color:inherit}.mode-tabs{display:flex;gap:5px;margin:12px 0}.mode-tabs button,.refresh,.cluster-card,.roi-card,.primary,.toast button,.pca-range button{font:inherit;border:1px solid var(--border,#bac5ca);border-radius:5px;background:var(--surface,#fff);color:inherit;padding:6px 8px;cursor:pointer}.mode-tabs button{flex:1}.mode-tabs button.active,.primary{background:var(--accent,#197997);border-color:var(--accent,#197997);color:#fff}.source-details,.cluster-inspector dl{display:grid;grid-template-columns:80px minmax(0,1fr);gap:6px;margin:16px 0;font-size:.72rem}.source-details dt,.cluster-inspector dt{color:var(--muted,#667)}.source-details dd,.cluster-inspector dd{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.similarity-control,.pca-summary,.hdbscan-controls{border-top:1px solid var(--border,#dce4e2);padding-top:10px}.hdbscan-controls{display:grid;gap:13px;margin-top:14px}.hdbscan-controls label,.hdbscan-advanced label{margin:0}.control-heading{display:flex;justify-content:space-between;gap:10px}.control-heading h3{margin:3px 0 0;font-size:.91rem}.semantic-control{display:grid;gap:6px;padding:9px;border:1px solid var(--border,#dce4e2);border-radius:7px;background:color-mix(in srgb,var(--surface,#fff) 92%,var(--accent,#197997) 8%)}.semantic-control>label{display:flex;justify-content:space-between;gap:8px;font-size:.74rem}.semantic-control output{color:var(--accent,#197997)}.group-size-input{display:grid;grid-template-columns:minmax(0,1fr) 104px;gap:5px}.semantic-control small,.range-ends{color:var(--muted,#667);font-size:.66rem}.semantic-range{width:100%;padding:0!important}.range-ends{display:flex;justify-content:space-between}.hdbscan-advanced{border-top:1px solid var(--border,#dce4e2);padding-top:9px}.hdbscan-advanced summary{cursor:pointer;font-size:.72rem;font-weight:700;color:var(--muted,#667)}.hdbscan-advanced[open]{display:grid;gap:7px}.hdbscan-advanced p{font-size:.68rem}.advanced-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.hdbscan-advanced .advanced-grid label{gap:3px;font-size:.65rem}.hdbscan-advanced .advanced-grid input,.hdbscan-advanced .advanced-grid select{padding:4px 5px;font-size:.72rem}.similarity-control label{grid-template-columns:1fr 92px 32px;align-items:center}.refresh{width:100%;margin-top:8px;font-size:.72rem}.cluster-gallery{display:grid;grid-template-rows:auto minmax(0,1fr);min-height:0}.cluster-gallery.clusters-mode,.cluster-gallery.pca-mode{grid-template-rows:auto auto minmax(0,1fr)}.cluster-gallery>header{display:flex;justify-content:space-between;gap:10px;padding:12px;border-bottom:1px solid var(--border,#ccd)}.cluster-gallery>header span{color:var(--muted,#667);font-size:.74rem}.cluster-list{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(180px,1fr);grid-template-rows:repeat(2,68px);gap:7px;max-height:155px;overflow:auto;padding:10px 12px;border-bottom:1px solid var(--border,#dce4e2)}.cluster-card{display:grid;grid-template-columns:52px minmax(0,1fr);gap:8px;align-items:center;text-align:left;padding:6px}.cluster-card.selected,.roi-card.selected{border-color:var(--accent,#197997);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent,#197997) 18%,transparent)}.cluster-prototype{display:grid;width:52px;height:52px;place-items:center;overflow:hidden;border-radius:4px;background:#162329}.cluster-card-copy{display:grid;gap:2px;min-width:0}.cluster-card-copy strong,.cluster-card-copy small,.roi-card strong,.roi-card small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cluster-card-copy small,.roi-card small{color:var(--muted,#667);font-size:.65rem}:global(.cluster-prototype-image){width:52px;height:52px;object-fit:contain}.pca-plots{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;padding:8px;overflow:auto}.pca-plot{min-width:190px;border:1px solid var(--border,#dce4e2);border-radius:6px;padding:7px}.pca-plot-title{display:grid;grid-template-columns:1fr 1fr;gap:5px;font-size:.65rem}.pca-plot svg{display:block;width:100%;aspect-ratio:1;margin:5px 0}.pca-plot circle{fill:hsl(var(--hdbscan-hue,196) 70% 40%);cursor:pointer}.pca-plot circle.noise{fill:var(--muted,#667)}.roi-grid{--cluster-tile-size:150px;display:grid;grid-template-columns:repeat(auto-fill,var(--cluster-tile-size));grid-auto-rows:calc(var(--cluster-tile-size) + 52px);gap:8px 10px;overflow:auto;padding:8px}.roi-card{position:relative;display:grid;grid-template-rows:var(--cluster-tile-size) minmax(0,1fr) auto;gap:2px;height:calc(var(--cluster-tile-size) + 52px);padding:3px;text-align:left}.roi-score{position:absolute;right:9px;top:9px;padding:2px 4px;border-radius:3px;background:#162329d9;color:#fff;font-size:.65rem}:global(.cluster-roi-image){width:100%;height:var(--cluster-tile-size);object-fit:contain;background:#162329;border-radius:4px}:global(.cluster-inspect-image){width:100%;max-height:280px;object-fit:contain;background:#162329;border-radius:6px}.empty{padding:24px;color:var(--muted,#667);font-size:.78rem;text-align:center}.loading-line{position:fixed;left:0;right:0;top:0;height:3px;background:var(--accent,#197997);z-index:20}.toast{position:fixed;right:20px;bottom:20px;padding:10px 12px;border-radius:6px;color:#fff;background:#9b3d37}
  .analysis-status{font-variant-numeric:tabular-nums}
  .analysis-status.failed{color:#9b3d37}
  .analysis-recompute{margin-top:3px}
  .gallery-tools{display:flex;justify-content:flex-end;gap:10px;padding:8px 12px;border-bottom:1px solid var(--border,#dce4e2)}.gallery-tools label{display:flex;align-items:center;gap:5px;color:var(--muted,#667);font-size:.7rem;font-weight:700}.gallery-tools select{padding:4px;border:1px solid var(--border,#bac5ca);border-radius:4px;background:var(--surface,#fff);color:inherit}.gallery-tools .scale-control input{width:94px}.gallery-tools output{min-width:31px;color:var(--accent,#197997);font:700 .68rem ui-monospace,monospace}.pager{display:flex;align-items:center;justify-content:center;gap:10px;padding:10px 12px;border-top:1px solid var(--border,#dce4e2);font-size:.72rem;color:var(--muted,#667)}.pager button{font:inherit;border:1px solid var(--border,#bac5ca);border-radius:5px;background:var(--surface,#fff);color:inherit;padding:6px 8px;cursor:pointer}.pager button:disabled{cursor:not-allowed;opacity:.45}
</style>
