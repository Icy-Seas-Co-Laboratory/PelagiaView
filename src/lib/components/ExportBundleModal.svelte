<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { getClient } from '$lib/stores/session';
  import { dashboardViewHref } from '$lib/utils/dashboardNavigation';
  import type { ExportFormat, ExportOptions, ExportProduct, ExportRequest, ExportScope, RawAsset, RegistryTag } from '$lib/api/types';

  export let scope: ExportScope = {};
  export let initialProducts: ExportProduct[] = [];

  const dispatch = createEventDispatcher<{ close: void; created: { id: string } }>();
  const products: Array<{ id: ExportProduct; label: string; description: string; format: boolean }> = [
    { id: 'raw_roi_statistics', label: 'ROI measurements', description: 'One documented measurement row per refined ROI.', format: true },
    { id: 'binned_roi_statistics', label: 'ROI size-bin summary', description: 'Counts and mean measurements grouped by bounding-box area.', format: true },
    { id: 'roi_evidence', label: 'ROI images & metadata', description: 'Portable ROI images with metadata and evidence sidecars.', format: false },
    { id: 'telemetry', label: 'Telemetry archive', description: 'Original source bytes, import profile, catalog, observations, and timeline context.', format: true }
  ];

  let options: ExportOptions | null = null;
  let selected = new Set<ExportProduct>(initialProducts);
  let formats: Partial<Record<ExportProduct, ExportFormat>> = {};
  let loading = true;
  let creating = false;
  let error: string | null = null;
  let createdId: string | null = null;
  let assets: RawAsset[] = [];
  let tags: RegistryTag[] = [];
  let assetSearch = '';
  let tagSearch = '';
  let selectedAssetIds = new Set(scope.assetIds ?? []);
  let selectedTagIds = new Set<string>(
    Array.isArray(scope.filters?.tag_ids) ? scope.filters.tag_ids.map(String) : []
  );

  $: visibleAssets = assets.filter((asset) => {
    const search = assetSearch.trim().toLowerCase();
    return !search || [asset.filename, asset.path, asset.id].filter(Boolean).join(' ').toLowerCase().includes(search);
  });
  $: visibleTags = tags.filter((tag) => {
    const search = tagSearch.trim().toLowerCase();
    return !search || `${tag.name} ${tag.scope ?? ''}`.toLowerCase().includes(search);
  });

  onMount(async () => {
    const client = getClient();
    if (!client) {
      error = 'Connect to a Pelagia server before creating an export.';
      loading = false;
      return;
    }
    try {
      const [exportOptions, availableAssets, availableTags] = await Promise.all([
        client.exportOptions(),
        client.listAssets(undefined, 500),
        client.listRegistryTags().catch(() => []),
      ]);
      options = exportOptions;
      assets = availableAssets;
      tags = availableTags.filter((tag) => tag.selectable !== false && !tag.deprecated_at);
      const allowed = new Set(options.products);
      selected = new Set([...selected].filter((product) => allowed.has(product)));
      for (const product of products) {
        if (product.format && allowed.has(product.id)) formats[product.id] = 'json';
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  });

  function toggle(product: ExportProduct) {
    const next = new Set(selected);
    next.has(product) ? next.delete(product) : next.add(product);
    selected = next;
  }

  function toggleAsset(assetId: string) {
    const next = new Set(selectedAssetIds);
    next.has(assetId) ? next.delete(assetId) : next.add(assetId);
    selectedAssetIds = next;
  }

  function toggleTag(tagId: string) {
    const next = new Set(selectedTagIds);
    next.has(tagId) ? next.delete(tagId) : next.add(tagId);
    selectedTagIds = next;
  }

  function exportScope(): ExportRequest {
    const requestedProducts = [...selected];
    const selectedFormats = Object.fromEntries(
      requestedProducts.filter((product) => products.find((item) => item.id === product)?.format)
        .map((product) => [product, formats[product] ?? 'json'])
    ) as Partial<Record<ExportProduct, ExportFormat>>;
    return {
      products: requestedProducts,
      formats: selectedFormats,
      asset_ids: [...selectedAssetIds],
      run_ids: scope.runIds ?? [],
      telemetry_source_ids: scope.telemetrySourceIds ?? [],
      roi_stage: 'refined',
      filters: {
        ...Object.fromEntries(Object.entries(scope.filters ?? {}).filter(([key]) => key !== 'tag_ids')),
        ...(selectedTagIds.size ? { tag_ids: [...selectedTagIds] } : {})
      }
    };
  }

  async function createExport() {
    const client = getClient();
    if (!client || creating || !selected.size) return;
    creating = true;
    error = null;
    try {
      const response = await client.createExport(exportScope());
      createdId = response.export.id;
      dispatch('created', { id: response.export.id });
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      creating = false;
    }
  }
</script>

<div class="export-backdrop" role="presentation" on:click={() => !creating && dispatch('close')}>
  <div class="export-dialog" role="dialog" aria-modal="true" aria-labelledby="bundle-export-title" tabindex="-1" on:click|stopPropagation on:keydown|stopPropagation>
    <header>
      <div><p class="eyebrow">Reproducible data bundle</p><h2 id="bundle-export-title">Create export</h2><p>Pelagia creates a provenance-rich ZIP asynchronously. Download it from Exports when it is ready.</p></div>
      <button class="close" type="button" aria-label="Close export dialog" disabled={creating} on:click={() => dispatch('close')}>×</button>
    </header>

    <div class="dialog-body">
      {#if loading}<p>Loading export options…</p>
      {:else if createdId}
        <section class="created" aria-live="polite"><h3>Export queued</h3><p>Your bundle is being prepared. Its manifest, README, data dictionary, and checksums will be included when processing completes.</p><button type="button" on:click={() => goto(dashboardViewHref('exports'))}>View exports</button></section>
      {:else}
        <section class="scope"><h3>Scope</h3><p>{scope.description ?? 'All data in the active project.'}</p>{#if scope.runIds?.length}<small>{scope.runIds.length} run{scope.runIds.length === 1 ? '' : 's'} selected</small>{/if}</section>
        <fieldset class="filters"><legend>General filters</legend><label class="filter-search">Assets <input type="search" bind:value={assetSearch} placeholder="Search assets" /></label><div class="filter-options">{#if !visibleAssets.length}<small>No matching assets. Leave unselected to include all assets.</small>{:else}{#each visibleAssets as asset (asset.id)}<label><input type="checkbox" checked={selectedAssetIds.has(asset.id)} on:change={() => toggleAsset(asset.id)} /><span>{asset.filename ?? asset.path ?? asset.id}</span></label>{/each}{/if}</div><small>{selectedAssetIds.size ? `${selectedAssetIds.size} asset${selectedAssetIds.size === 1 ? '' : 's'} selected` : 'All project assets'}</small><label class="filter-search">Registry tags <input type="search" bind:value={tagSearch} placeholder="Search tags" /></label><div class="filter-options">{#if !visibleTags.length}<small>No Registry tags are available.</small>{:else}{#each visibleTags as tag (tag.tag_id)}<label><input type="checkbox" checked={selectedTagIds.has(tag.tag_id)} on:change={() => toggleTag(tag.tag_id)} /><span>{tag.name}<small>{tag.scope === 'target_tags' ? 'Target tag' : 'Image tag'}{#if tag.item_count !== undefined} · {tag.item_count} item{tag.item_count === 1 ? '' : 's'}{/if}</small></span></label>{/each}{/if}</div><small>{selectedTagIds.size ? `${selectedTagIds.size} tag${selectedTagIds.size === 1 ? '' : 's'} selected; matching any selected tag` : 'No tag filter'} Tags filter ROI products; telemetry selection is unchanged.</small></fieldset>
        <fieldset class="products"><legend>Products</legend>{#each products as product}<label class:disabled={!options?.products.includes(product.id)}><input type="checkbox" checked={selected.has(product.id)} disabled={!options?.products.includes(product.id)} on:change={() => toggle(product.id)} /><span><strong>{product.label}</strong><small>{product.description}</small></span>{#if product.format && selected.has(product.id)}<select aria-label={`${product.label} format`} value={formats[product.id] ?? 'json'} on:change={(event) => formats = { ...formats, [product.id]: (event.currentTarget as HTMLSelectElement).value as ExportFormat }}>{#each options?.formats ?? [] as format}<option value={format}>{format.toUpperCase()}</option>{/each}</select>{/if}</label>{/each}</fieldset>
      {/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
    </div>

    <footer><button class="secondary" type="button" on:click={() => dispatch('close')} disabled={creating}>{createdId ? 'Close' : 'Cancel'}</button>{#if !createdId}<button type="button" disabled={loading || creating || !selected.size} on:click={createExport}>{creating ? 'Queueing…' : 'Create export'}</button>{/if}</footer>
  </div>
</div>

<style>
  .export-backdrop{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:1rem;background:rgb(8 17 20 / .68);backdrop-filter:blur(3px)}.export-dialog{width:min(700px,calc(100vw - 2rem));max-height:calc(100vh - 2rem);overflow:auto;border:1px solid var(--border,#ccd9dc);border-radius:14px;background:var(--surface,#fff);box-shadow:0 24px 80px rgb(0 0 0 / .3)}header,footer{display:flex;justify-content:space-between;gap:1rem;padding:1.1rem 1.3rem;border-bottom:1px solid var(--border,#d9e1e3)}footer{align-items:center;border:0;border-top:1px solid var(--border,#d9e1e3)}h2,h3,p{margin:0}.eyebrow{color:var(--accent,#197997);font-size:.7rem;font-weight:750;letter-spacing:.09em;text-transform:uppercase}header p:last-child{margin-top:.35rem;color:var(--muted,#66777b)}.close{border:0;background:transparent;color:inherit;font-size:1.5rem}.dialog-body{display:grid;gap:1rem;padding:1.3rem}.scope,.products,.filters,.created{border:1px solid var(--border,#d9e1e3);border-radius:9px;padding:1rem}.scope{display:grid;gap:.3rem}.scope small,.filters>small{color:var(--muted,#66777b)}fieldset{margin:0}legend{padding:0 .25rem;font-weight:750}.products{display:grid;gap:.2rem}.products label{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:.7rem;align-items:center;padding:.7rem .35rem;border-bottom:1px solid var(--border,#e6ecee);cursor:pointer}.products label:last-child{border:0}.products label.disabled{opacity:.5;cursor:not-allowed}.products input,.filters input[type=checkbox]{width:1rem;height:1rem}.products span,.filters label span{display:grid;gap:.18rem}.products small,.filters small{color:var(--muted,#66777b);font-weight:400}.products select{min-width:5.5rem;padding:.35rem}.filters{display:grid;gap:.45rem}.filter-search{display:grid;gap:.25rem;font-size:.82rem;font-weight:750}.filter-search input{padding:.45rem;border:1px solid var(--border,#ccd9dc);border-radius:6px;font:inherit}.filter-options{display:grid;max-height:9rem;overflow:auto;border:1px solid var(--border,#e6ecee);border-radius:6px}.filter-options label{display:flex;gap:.5rem;align-items:start;padding:.4rem .5rem;cursor:pointer}.filter-options label+label{border-top:1px solid var(--border,#eef2f3)}.created{display:grid;gap:.55rem}.error{padding:.7rem;border-radius:7px;background:color-mix(in srgb,#b44343 10%,transparent);color:#9d3333}.secondary{border:1px solid var(--border,#ccd9dc);background:transparent;color:inherit}button{border:0;border-radius:7px;padding:.6rem .85rem;background:var(--accent,#197997);color:#fff;cursor:pointer;font:inherit;font-weight:750}button:disabled{cursor:not-allowed;opacity:.5}@media(max-width:560px){.products label{grid-template-columns:auto 1fr}.products select{grid-column:2}}
</style>
