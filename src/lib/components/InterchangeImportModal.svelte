<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import CollectionTokenInput from '$lib/components/CollectionTokenInput.svelte';
  import FileSelector from '$lib/components/FileSelector.svelte';
  import { getClient } from '$lib/stores/session';
  import { formatBytes, formatCount } from '$lib/utils/format';
  import type {
    AnalyzedIngestionAsset,
    DirectoryListing,
    QueueAssetsResponse,
    QueueIngestionAssetRequest
  } from '$lib/api/types';

  export let initialPath = '.';
  export let collectionSuggestions: string[] = [];

  const dispatch = createEventDispatcher<{
    close: void;
    imported: { response: QueueAssetsResponse; asset: AnalyzedIngestionAsset };
  }>();

  let currentPath = initialPath || '.';
  let selectedPaths: string[] = [];
  let asset: AnalyzedIngestionAsset | null = null;
  let collection = '';
  let analyzing = false;
  let importing = false;
  let imported = false;
  let error: string | null = null;

  onMount(() => window.addEventListener('keydown', handleKeydown));
  onDestroy(() => window.removeEventListener('keydown', handleKeydown));

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && !importing) dispatch('close');
  }

  async function loadDirectory(path: string): Promise<DirectoryListing> {
    const client = getClient();
    if (!client) throw new Error('Connect to a Pelagia server before browsing datasets.');
    return client.listRawDirectory(path);
  }

  function selectDataset(paths: string[]) {
    selectedPaths = paths.slice(-1);
    asset = null;
    imported = false;
    error = null;
  }

  async function inspectDataset() {
    const client = getClient();
    const path = selectedPaths[0];
    if (!client || !path || analyzing) return;
    analyzing = true;
    asset = null;
    imported = false;
    error = null;
    try {
      const response = await client.analyzeIngestionSource({
        source_path: path,
        kind: 'interchange',
        generate_backgrounds: false,
        generate_flatfield_profiles: false
      });
      const candidate = response.assets?.[0];
      if (!candidate || candidate.kind !== 'interchange') {
        throw new Error('Pelagia did not recognize this directory as a complete interchange dataset.');
      }
      asset = candidate;
      collection = candidate.collections?.[0] ?? datasetTitle(candidate) ?? candidate.filename ?? '';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      analyzing = false;
    }
  }

  async function importDataset() {
    const client = getClient();
    if (!client || !asset || importing || !collection.trim()) return;
    importing = true;
    error = null;
    try {
      const requestAsset: QueueIngestionAssetRequest = {
        ...asset,
        collections: collection.trim(),
        metadata: asset.metadata ?? {},
        generate_backgrounds: false,
        generate_flatfield_profiles: false
      };
      const response = await client.queueAnalyzedAssets({
        assets: [requestAsset],
        source_path: asset.path,
        source_type: 'interchange',
        generate_backgrounds: false,
        generate_flatfield_profiles: false
      });
      imported = true;
      dispatch('imported', {
        response,
        asset: { ...asset, collections: [collection.trim()] }
      });
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      importing = false;
    }
  }

  function interchangeMetadata(value: AnalyzedIngestionAsset): Record<string, unknown> {
    const metadata = value.metadata?.pelagia_interchange;
    return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? metadata as Record<string, unknown>
      : {};
  }

  function datasetTitle(value: AnalyzedIngestionAsset): string | null {
    const interchange = interchangeMetadata(value);
    const metadata = interchange.metadata;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
    const dataset = (metadata as Record<string, unknown>).dataset;
    if (!dataset || typeof dataset !== 'object' || Array.isArray(dataset)) return null;
    const title = (dataset as Record<string, unknown>).title;
    return typeof title === 'string' && title.trim() ? title : null;
  }

  function interchangeValue(key: string): string | null {
    if (!asset) return null;
    const value = interchangeMetadata(asset)[key];
    return value === null || value === undefined || value === '' ? null : String(value);
  }
</script>

<div class="modal-backdrop interchange-backdrop" role="presentation" on:click={() => !importing && dispatch('close')}>
  <div
    class="interchange-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="interchange-import-title"
    tabindex="-1"
    on:click|stopPropagation
    on:keydown|stopPropagation
  >
    <header>
      <div>
        <p class="eyebrow">Portable scientific dataset</p>
        <h2 id="interchange-import-title">Import interchange collection</h2>
        <p>Select a complete <code>pelagia_interchange</code> directory. Pelagia will preserve compatible encoded frames and available scientific metadata.</p>
      </div>
      <button class="close ghost" type="button" aria-label="Close interchange import" disabled={importing} on:click={() => dispatch('close')}>×</button>
    </header>

    <div class="dialog-body">
      <section class="dataset-selection">
        <div class="step-heading">
          <span>1</span>
          <div><strong>Select dataset directory</strong><small>The directory must contain manifest.json, metadata.toml, history.jsonl, checksums.sha256, and data/.</small></div>
        </div>
        <FileSelector
          mode="wizard"
          multiSelect={false}
          selectableKinds={['directory']}
          {initialPath}
          {selectedPaths}
          {loadDirectory}
          onSelectionChange={selectDataset}
          onPathChange={(path) => currentPath = path}
          label="Interchange datasets"
        />
        <div class="selection-actions">
          <small>{selectedPaths[0] ?? 'No dataset selected'}</small>
          <button type="button" disabled={!selectedPaths[0] || analyzing || importing} on:click={inspectDataset}>
            {analyzing ? 'Inspecting…' : 'Inspect dataset'}
          </button>
        </div>
      </section>

      <section class="dataset-review" class:pending={!asset}>
        <div class="step-heading">
          <span>2</span>
          <div><strong>Review collection</strong><small>Manifest and metadata values are read without decoding every frame.</small></div>
        </div>
        {#if asset}
          <div class="dataset-title">
            <div><p class="eyebrow">{interchangeValue('state') ?? 'Interchange dataset'}</p><h3>{datasetTitle(asset) ?? asset.filename ?? 'Untitled dataset'}</h3></div>
            <span class="status-pill good">Validated</span>
          </div>
          <dl>
            <div><dt>Frames</dt><dd>{formatCount(asset.media_count ?? 0)}</dd></div>
            <div><dt>Package size</dt><dd>{formatBytes(asset.size_bytes ?? 0)}</dd></div>
            <div><dt>Format version</dt><dd>{interchangeValue('format_version') ?? 'Unknown'}</dd></div>
            <div><dt>Schema version</dt><dd>{interchangeValue('schema_version') ?? 'Unknown'}</dd></div>
          </dl>
          <label>
            Collection
            <CollectionTokenInput
              value={collection}
              suggestions={collectionSuggestions}
              placeholder="Collection name"
              onChange={(value) => collection = value}
            />
            <small>The dataset title is used by default. You may override it before import.</small>
          </label>
          <div class="fast-path-note">
            <strong>Optimized import</strong>
            <span>Compatible JPEG, PNG, JPEG XL, and JPEG XS frames are copied without transcoding. Background and flatfield generation remain off.</span>
          </div>
        {:else}
          <p class="empty-review">Inspect a selected directory to preview its collection metadata and frame count.</p>
        {/if}
      </section>

      {#if imported}
        <p class="success-message">Import queued. Progress is now available in the ingestion queue.</p>
      {/if}
      {#if error}<p class="error-message">{error}</p>{/if}
    </div>

    <footer>
      <button class="ghost" type="button" disabled={importing} on:click={() => dispatch('close')}>{imported ? 'Done' : 'Cancel'}</button>
      <button type="button" disabled={!asset || !collection.trim() || importing || imported} on:click={importDataset}>
        {importing ? 'Queueing import…' : imported ? 'Import queued' : 'Import collection'}
      </button>
    </footer>
  </div>
</div>

<style>
  .interchange-backdrop { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 1.5rem; background: rgb(5 14 18 / 70%); backdrop-filter: blur(3px); }
  .interchange-dialog { width: min(68rem, calc(100vw - 2rem)); max-height: calc(100vh - 2.5rem); overflow: auto; border: 1px solid var(--border, #ccd9dc); border-radius: 14px; background: var(--surface, #fff); box-shadow: 0 1.5rem 5rem rgb(0 0 0 / 35%); }
  header, footer { display: flex; justify-content: space-between; gap: 1rem; padding: 1.1rem 1.3rem; }
  header { align-items: flex-start; border-bottom: 1px solid var(--border, #d9e1e3); }
  footer { justify-content: flex-end; border-top: 1px solid var(--border, #d9e1e3); }
  header h2, header p, h3 { margin: 0; }
  header > div > p:last-child { max-width: 48rem; margin-top: .35rem; color: var(--muted, #66777b); }
  code { font-size: .9em; }
  .eyebrow { color: var(--accent, #197997); font-size: .7rem; letter-spacing: .09em; text-transform: uppercase; }
  .close { min-width: 2.2rem; padding: .2rem; font-size: 1.5rem; }
  .dialog-body { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(18rem, .65fr); gap: 1rem; padding: 1.1rem 1.3rem; }
  .dataset-selection, .dataset-review { min-width: 0; padding: 1rem; border: 1px solid var(--border, #d9e1e3); border-radius: 10px; }
  .dataset-review.pending { background: color-mix(in srgb, var(--surface, #fff) 96%, var(--border, #d9e1e3)); }
  .step-heading { display: flex; align-items: flex-start; gap: .65rem; margin-bottom: .85rem; }
  .step-heading > span { display: grid; flex: 0 0 1.65rem; height: 1.65rem; place-items: center; border-radius: 50%; background: var(--accent, #197997); color: #fff; font-weight: 750; }
  .step-heading div { display: grid; gap: .15rem; }
  .step-heading small, label small, .selection-actions small { color: var(--muted, #66777b); font-weight: 400; }
  .selection-actions { display: flex; align-items: center; justify-content: space-between; gap: .8rem; margin-top: .8rem; }
  .selection-actions small { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dataset-title { display: flex; align-items: flex-start; justify-content: space-between; gap: .7rem; margin-bottom: 1rem; }
  .dataset-title h3 { margin-top: .15rem; font-size: 1.2rem; }
  .status-pill { padding: .25rem .5rem; border-radius: 999px; font-size: .72rem; font-weight: 700; }
  .status-pill.good { background: color-mix(in srgb, #23865e 14%, transparent); color: #23865e; }
  dl { display: grid; grid-template-columns: 1fr 1fr; gap: .55rem; margin: 0 0 1rem; }
  dl div { display: grid; gap: .1rem; padding: .65rem; border-radius: 7px; background: color-mix(in srgb, var(--surface, #fff) 92%, var(--border, #d9e1e3)); }
  dt { color: var(--muted, #66777b); font-size: .7rem; text-transform: uppercase; letter-spacing: .05em; }
  dd { margin: 0; font-weight: 700; }
  label { display: grid; gap: .35rem; font-size: .8rem; font-weight: 700; }
  .fast-path-note { display: grid; gap: .25rem; margin-top: 1rem; padding: .75rem; border-left: 3px solid var(--accent, #197997); background: color-mix(in srgb, var(--accent, #197997) 7%, transparent); font-size: .8rem; }
  .fast-path-note span, .empty-review { color: var(--muted, #66777b); }
  .empty-review { margin: 1.5rem 0; text-align: center; }
  .success-message, .error-message { grid-column: 1 / -1; margin: 0; padding: .75rem .9rem; border-radius: 8px; }
  .success-message { background: color-mix(in srgb, #23865e 12%, transparent); color: #23865e; }
  .error-message { background: color-mix(in srgb, #b44343 10%, transparent); color: #b44343; }
  @media (max-width: 800px) { .dialog-body { grid-template-columns: 1fr; } .interchange-backdrop { padding: .5rem; } .interchange-dialog { width: calc(100vw - 1rem); max-height: calc(100vh - 1rem); } }
</style>
