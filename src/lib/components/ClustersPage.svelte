<script lang="ts">
  import { onMount } from 'svelte';
  import AuthenticatedImage from '$lib/components/AuthenticatedImage.svelte';
  import { imageInversionEnabled } from '$lib/stores/displayPreferences';
  import { getClient, session } from '$lib/stores/session';
  import { projectPreferenceKey, readPreferences, writePreferences } from '$lib/utils/preferences';
  import type { CurationRoi, FeatureSpaceCluster, FeatureSpaceRoi, FeatureSpaceSimilarityResult, FeatureSpaceSource } from '$lib/api/types';

  type BrowseMode = 'clusters' | 'similarity';
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
  let loading = false;
  let detailLoading = false;
  let error = '';

  $: selectedSource = sources.find((source) => source.source_key === sourceKey) ?? null;
  $: visibleRois = mode === 'clusters' ? members : (referenceRoiId ? similar : sourceRois);
  $: labelPrototypeSource = selectedSource?.source_kind === 'classification';
  $: organizationTitle = labelPrototypeSource ? 'Label prototypes' : 'Clusters';
  $: workspaceTitle = mode === 'clusters'
    ? (selectedClusterId ? `${selectedCluster?.cluster_name || selectedClusterId} members` : `Choose a ${labelPrototypeSource ? 'label prototype' : 'cluster'}`)
    : (referenceRoiId ? 'Similar ROIs' : 'Choose a reference ROI');
  $: clusteringSimilarity = selectedSource?.source_kind === 'clustering';
  $: similarityTitle = clusteringSimilarity ? 'Cluster-local centroid similarity' : 'Exact cosine similarity';
  $: similarityMinimumLabel = clusteringSimilarity ? 'Minimum centroid similarity' : 'Minimum cosine similarity';

  onMount(() => {
    restorePreferences();
    void loadSources();
  });

  async function loadSources() {
    const client = getClient();
    if (!client) return;
    loading = true;
    error = '';
    try {
      sources = await client.featureSpaceSources();
      if (!sourceKey || !sources.some((source) => source.source_key === sourceKey)) sourceKey = sources[0]?.source_key ?? '';
      persistPreferences();
      await refresh();
    } catch (cause) {
      error = message(cause);
    } finally {
      loading = false;
    }
  }

  async function changeSource() {
    selectedClusterId = '';
    members = [];
    similar = [];
    similaritySearch = null;
    sourceRois = [];
    referenceRoiId = '';
    selectedRoi = null;
    detail = null;
    persistPreferences();
    await refresh();
  }

  async function changeMode(next: BrowseMode) {
    mode = next;
    selectedClusterId = '';
    members = [];
    similar = [];
    similaritySearch = null;
    persistPreferences();
    await refresh();
  }

  async function refresh() {
    if (mode === 'clusters') await loadClusters();
    else if (referenceRoiId) await loadSimilarity();
    else await loadSourceRois();
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
      const result = await client.featureSpaceRois(sourceKey, { limit: 120 });
      sourceRois = result.items ?? [];
    } catch (cause) {
      sourceRois = [];
      error = message(cause);
    } finally {
      loading = false;
    }
  }

  async function loadClusters() {
    const client = getClient();
    if (!client || !sourceKey) {
      clusters = [];
      return;
    }
    loading = true;
    error = '';
    try {
      const result = await client.featureSpaceClusters(sourceKey);
      clusters = result.items ?? [];
    } catch (cause) {
      clusters = [];
      error = message(cause);
    } finally {
      loading = false;
    }
  }

  async function selectCluster(cluster: FeatureSpaceCluster) {
    const client = getClient();
    if (!client || !sourceKey) return;
    selectedClusterId = cluster.cluster_id;
    members = [];
    loading = true;
    error = '';
    try {
      const result = await client.featureSpaceClusterMembers(sourceKey, cluster.cluster_id, { limit: 120 });
      members = result.items ?? [];
      if (members[0]) await selectRoi(members[0]);
    } catch (cause) {
      error = message(cause);
    } finally {
      loading = false;
    }
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
        limit: 120,
        minimum: similarityMinimum
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
    await changeMode('similarity');
  }

  async function chooseReference(roi: FeatureSpaceRoi) {
    referenceRoiId = roi.id;
    await Promise.all([selectRoi(roi), loadSimilarity()]);
  }

  function score(value: number | null | undefined): string {
    return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : '—';
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
    if (saved.mode === 'clusters' || saved.mode === 'similarity') mode = saved.mode;
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

    <div class="mode-tabs" role="tablist" aria-label="Feature-space browse mode">
      <button class:active={mode === 'clusters'} on:click={() => changeMode('clusters')}>{organizationTitle}</button>
      <button class:active={mode === 'similarity'} on:click={() => changeMode('similarity')}>Similarity</button>
    </div>

    {#if selectedSource}
      <dl class="source-details">
        <dt>Evidence</dt><dd>{selectedSource.source_kind}</dd>
        <dt>Model</dt><dd>{selectedSource.model_selector || 'Recorded model run'}</dd>
        <dt>Dimension</dt><dd>{embeddingDimension(selectedSource) ? `${embeddingDimension(selectedSource)}-D` : 'Unavailable'}</dd>
        <dt>ROI vectors</dt><dd>{selectedSource.embedding_count.toLocaleString()}</dd>
        <dt>Run</dt><dd title={selectedSource.inference_run_id}>{selectedSource.inference_run_id.slice(0, 12)}</dd>
      </dl>
    {/if}

    {#if mode === 'similarity'}
      <section class="similarity-control">
        <label>{similarityMinimumLabel} <input type="range" min="-1" max="1" step="0.05" bind:value={similarityMinimum} on:change={loadSimilarity} /><output>{Number(similarityMinimum).toFixed(2)}</output></label>
        <p>{referenceRoiId ? `${clusteringSimilarity ? 'Reference cluster member' : 'Reference ROI'} ${referenceRoiId.slice(0, 12)}${clusteringSimilarity ? ' · ranked by recorded fit to the shared cluster centroid' : ''}` : 'Select an ROI, then use it as the reference.'}</p>
        {#if similaritySearch?.search_scope === 'deterministic_prefix'}<p class="provenance-note">Exact cosine search ranked the first {similaritySearch.scanned_vector_count.toLocaleString()} of {similaritySearch.total_vector_count.toLocaleString()} ROI vectors in stable ID order. A materialized run index is required for full-source search at this scale.</p>{/if}
        {#if similaritySearch?.search_scope === 'full_source'}<p class="provenance-note">Exact cosine search covered all {similaritySearch.total_vector_count.toLocaleString()} ROI vectors in this run.</p>{/if}
      </section>
    {/if}

    <button class="refresh" on:click={loadSources} disabled={loading}>Refresh evidence sources</button>
  </aside>

  <main class:clusters-mode={mode === 'clusters'} class="cluster-gallery panel">
    <header>
      <div><p class="eyebrow">{mode === 'clusters' ? 'Run-local organization' : similarityTitle}</p><h2>{workspaceTitle}</h2></div>
      {#if mode === 'clusters'}<span>{clusters.length.toLocaleString()} {labelPrototypeSource ? 'label prototypes' : 'clusters'}</span>{:else if referenceRoiId}<span>{similar.length.toLocaleString()} results</span>{:else}<span>{sourceRois.length.toLocaleString()} reference candidates</span>{/if}
    </header>

    {#if !sources.length && !loading}
      <p class="empty">Run classification or clustering evidence before browsing this project’s feature spaces.</p>
    {:else if mode === 'clusters'}
      <section class="cluster-list" data-image-scroll-root aria-label={`${organizationTitle} in selected evidence run`}>
        {#each clusters as cluster (cluster.cluster_id)}
          <button class:selected={selectedClusterId === cluster.cluster_id} class="cluster-card" on:click={() => selectCluster(cluster)}>
            <span class="cluster-prototype">
              {#if representativeUrl(cluster)}<AuthenticatedImage src={representativeUrl(cluster)} alt={`Representative ROI for ${cluster.cluster_id}`} imageClass="cluster-prototype-image" invert={$imageInversionEnabled} />{/if}
            </span>
            <span class="cluster-card-copy"><strong>{cluster.cluster_name || cluster.cluster_id}</strong><small>{cluster.roi_count.toLocaleString()} ROIs · {labelPrototypeSource ? 'prototype' : 'centroid'} {score(cluster.mean_similarity)}</small>{#if cluster.novelty_count}<small>{cluster.novelty_count} novel or abstained</small>{/if}</span>
          </button>
        {/each}
      </section>
      {#if !clusters.length && !loading}<p class="empty">{labelPrototypeSource ? 'No recorded label-prototype assignments are available in this run.' : 'No assigned clusters are available in this run.'}</p>{/if}
    {/if}

    {#if visibleRois.length}
      <section class="roi-grid" data-image-scroll-root aria-label={`${workspaceTitle} ROI results`}>
        {#each visibleRois as roi (roi.id)}
          <button class:selected={selectedRoi?.id === roi.id} class:reference={referenceRoiId === roi.id} class="roi-card" on:click={() => mode === 'similarity' && !referenceRoiId ? chooseReference(roi) : selectRoi(roi)} title={mode === 'similarity' && !referenceRoiId ? `Use ROI ${roi.id} as the similarity reference` : `Inspect ROI ${roi.id}`}>
            {#if imageUrl(roi.thumbnail_url)}<AuthenticatedImage src={imageUrl(roi.thumbnail_url)} alt="Feature-space ROI" imageClass="cluster-roi-image" invert={$imageInversionEnabled} />{/if}
            <span class="roi-score">{score(roi.similarity)}</span>
            <strong>{roi.label_display_name || 'Unlabeled'}</strong>
            <small>{roi.asset_filename || roi.id.slice(0, 8)}</small>
          </button>
        {/each}
      </section>
    {:else if mode === 'similarity' && referenceRoiId && !loading && !error}
      <p class="empty">No ROIs meet this similarity threshold.</p>
    {:else if mode === 'similarity' && !loading && !error}
      <p class="empty">No ROIs with stored vectors are available in this evidence run.</p>
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
        <dt>ROI</dt><dd title={detail.id}>{detail.id.slice(0, 12)}</dd>
        <dt>Label</dt><dd>{detail.label_display_name || 'Unlabeled'}</dd>
        <dt>{labelPrototypeSource ? 'Label prototype' : 'Cluster'}</dt><dd>{selectedRoi?.cluster_name || selectedRoi?.cluster_id || detail.cluster_id || 'Not assigned'}</dd>
        <dt>{clusteringSimilarity ? 'Centroid fit' : 'Similarity'}</dt><dd>{score(selectedRoi?.similarity)}</dd>
      </dl>
      <button class="primary" on:click={useSelectedAsReference}>Explore similar ROIs</button>
      {#if referenceRoiId === detail.id}<p class="reference-note">This ROI is the current similarity reference.</p>{/if}
      {#if detail.clustering_evidence?.length}<p class="provenance-note">Cluster evidence remains scoped to the selected run and model artifact.</p>{/if}
    {:else}
      <p class="empty">Choose an ROI to inspect its evidence. In Similarity mode, the first ROI you choose becomes the reference.</p>
    {/if}
  </aside>

  {#if loading}<div class="loading-line" aria-label="Loading feature-space evidence"></div>{/if}
  {#if error}<div class="toast error">{error}<button on:click={() => (error = '')}>×</button></div>{/if}
</div>

<style>
  .cluster-workspace{display:grid;grid-template-columns:250px minmax(420px,1fr)330px;gap:12px;min-height:calc(100vh - 128px)}.panel{background:var(--surface,#fff);border:1px solid var(--border,#cbd5d9);border-radius:10px;min-width:0}.cluster-rail,.cluster-inspector{padding:14px;overflow:auto;max-height:calc(100vh - 128px)}.eyebrow{margin:0;color:var(--muted,#667);font-size:10px;text-transform:uppercase;letter-spacing:.08em}.cluster-rail h2,.cluster-inspector h2,.cluster-gallery h2{margin:0 0 10px}.rail-intro,.similarity-control p,.provenance-note,.reference-note{color:var(--muted,#667);font-size:.76rem;line-height:1.45}.cluster-rail label{display:grid;gap:4px;margin:12px 0;color:var(--muted,#667);font-size:.72rem;font-weight:700}.cluster-rail select,.cluster-rail input{min-width:0;padding:7px;border:1px solid var(--border,#bac5ca);border-radius:5px;background:var(--surface,#fff);color:inherit}.mode-tabs{display:flex;gap:5px;margin:12px 0}.mode-tabs button,.refresh,.cluster-card,.roi-card,.primary,.toast button{font:inherit;border:1px solid var(--border,#bac5ca);border-radius:5px;background:var(--surface,#fff);color:inherit;padding:6px 8px;cursor:pointer}.mode-tabs button{flex:1}.mode-tabs button.active,.primary{background:var(--accent,#197997);border-color:var(--accent,#197997);color:#fff}.mode-tabs button:disabled{cursor:not-allowed;opacity:.45}.source-details{display:grid;grid-template-columns:80px minmax(0,1fr);gap:6px;margin:16px 0;font-size:.72rem}.source-details dt,.cluster-inspector dt{color:var(--muted,#667)}.source-details dd,.cluster-inspector dd{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.similarity-control{border-top:1px solid var(--border,#dce4e2);padding-top:10px}.similarity-control label{grid-template-columns:1fr 92px 32px;align-items:center}.similarity-control output{font-variant-numeric:tabular-nums}.refresh{width:100%;margin-top:8px;font-size:.72rem}.cluster-gallery{display:grid;grid-template-rows:auto minmax(0,1fr);min-height:0}.cluster-gallery.clusters-mode{grid-template-rows:auto auto minmax(0,1fr)}.cluster-gallery>header{display:flex;justify-content:space-between;gap:10px;align-items:start;padding:12px;border-bottom:1px solid var(--border,#ccd)}.cluster-gallery>header span{color:var(--muted,#667);font-size:.74rem;white-space:nowrap}.cluster-list{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(180px,1fr);grid-template-rows:repeat(2,68px);gap:7px;max-height:155px;overflow:auto;padding:10px 12px;border-bottom:1px solid var(--border,#dce4e2)}.cluster-card{display:grid;grid-template-columns:52px minmax(0,1fr);gap:8px;align-items:center;text-align:left;padding:6px}.cluster-card.selected{border-color:var(--accent,#197997);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent,#197997) 20%,transparent)}.cluster-prototype{display:grid;width:52px;height:52px;place-items:center;overflow:hidden;border-radius:4px;background:#162329}.cluster-card-copy{display:grid;gap:2px;min-width:0}.cluster-card-copy strong,.cluster-card-copy small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cluster-card-copy strong{font-size:.73rem}.cluster-card-copy small{color:var(--muted,#667);font-size:.62rem}:global(.cluster-prototype-image){width:52px;height:52px;object-fit:contain}.roi-grid{--cluster-tile-size:150px;display:grid;grid-template-columns:repeat(auto-fill,var(--cluster-tile-size));grid-auto-rows:calc(var(--cluster-tile-size) + 52px);align-content:start;gap:8px 10px;min-height:0;overflow:auto;padding:8px}.roi-card{position:relative;display:grid;grid-template-rows:var(--cluster-tile-size) minmax(0,1fr) auto;gap:2px;height:calc(var(--cluster-tile-size) + 52px);padding:3px;text-align:left;min-width:0}.roi-card.selected{border-color:var(--accent,#197997);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent,#197997) 18%,transparent)}.roi-card.reference{outline:2px solid #c38b37}.roi-score{position:absolute;right:9px;top:9px;padding:2px 4px;border-radius:3px;background:rgba(15,32,36,.82);color:#fff;font-size:.65rem}.roi-card strong,.roi-card small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.roi-card strong{font-size:.72rem}.roi-card small{color:var(--muted,#667);font-size:.65rem}:global(.cluster-roi-image){width:100%;height:var(--cluster-tile-size);object-fit:contain;background:#162329;border-radius:4px}:global(.cluster-inspect-image){width:100%;max-height:280px;object-fit:contain;background:#162329;border-radius:6px}.cluster-inspector dl{display:grid;grid-template-columns:75px minmax(0,1fr);gap:7px;margin:12px 0;font-size:.74rem}.cluster-inspector .primary{width:100%}.empty{padding:24px;color:var(--muted,#667);font-size:.78rem;text-align:center}.loading-line{position:fixed;left:0;right:0;top:0;height:3px;background:var(--accent,#197997);z-index:20}.toast{position:fixed;right:20px;bottom:20px;z-index:10;padding:10px 12px;border-radius:6px;color:#fff;box-shadow:0 5px 20px #0004}.toast.error{background:#9b3d37}.toast button{border:0;background:transparent;color:inherit;padding:0 0 0 8px}@media(max-width:1050px){.cluster-workspace{grid-template-columns:220px 1fr}.cluster-inspector{grid-column:1/-1;max-height:none}}@media(max-width:700px){.cluster-workspace{display:block}.cluster-rail,.cluster-gallery,.cluster-inspector{margin-bottom:10px;max-height:none}}
</style>
