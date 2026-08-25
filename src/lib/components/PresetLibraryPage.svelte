<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { listProcessingPresets, saveProcessingPreset } from '$lib/api/processingPresets';
  import type { ProcessingPreset } from '$lib/processing/settings';
  import { processingPresetKey } from '$lib/processing/settings';
  import { formatDate } from '$lib/utils/format';
  import { presetSettingGroups } from '$lib/processing/presetDisplay';
  import { applyProcessingPresetToSession, currentLiveProcessingPreset, processingPresetSession } from '$lib/stores/processingPresetSession';
  import { closeExplorerModalHref, explorerModalFromUrl, explorerModalHref, presetLibraryHref } from '$lib/utils/dashboardNavigation';
  import ExplorerModal from './ExplorerModal.svelte';
  import PresetDetailModal from './PresetDetailModal.svelte';

  let presets: ProcessingPreset[] = [];
  let loading = true;
  let error: string | null = null;
  let message: string | null = null;
  let saveName = '';
  let saveDescription = '';
  $: availablePresets = [$processingPresetSession.livePreset, ...presets];
  $: selectedKey = $page.url.searchParams.get('preset') ?? '';
  $: selectedPreset = availablePresets.find((preset) => processingPresetKey(preset) === selectedKey) ?? null;
  $: explorerOpen = explorerModalFromUrl($page.url);

  onMount(() => { void loadPresets(); });
  async function loadPresets() { loading = true; error = null; try { presets = await listProcessingPresets(); } catch (err) { error = err instanceof Error ? err.message : String(err); } finally { loading = false; } }
  async function applyPreset(preset: ProcessingPreset) { applyProcessingPresetToSession(preset); message = `Applied ${preset.name}.`; }
  async function saveCurrentSettings() { const name = saveName.trim(); if (!name) { error = 'Enter a preset name before saving.'; return; } error = null; try { const preset = await saveProcessingPreset({ name, description: saveDescription, settings: currentLiveProcessingPreset().settings }); await loadPresets(); saveName = ''; saveDescription = ''; message = `Saved ${preset.name}.`; } catch (err) { error = err instanceof Error ? err.message : String(err); } }
  function showPreset(preset: ProcessingPreset) { void goto(presetLibraryHref({ preset: processingPresetKey(preset) }, $page.url)); }
  function closeDetail() { void goto(presetLibraryHref({}, $page.url)); }
  function stageCoverage(preset: ProcessingPreset): string {
    return presetSettingGroups(preset).map((group) => group.label).join(' · ') || 'No stage-specific settings';
  }
</script>

<section class="preset-library-page">
  <header class="panel-heading"><div><p class="eyebrow">Processing workflow</p><h2>Preset Library</h2><p class="soft">Apply known settings, inspect their values, or capture the current session as a reusable preset.</p></div><div class="button-row"><button class="ghost" type="button" on:click={loadPresets} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button><a class="button-link" href={explorerModalHref($page.url)}>Open Explorer</a></div></header>
  {#if message}<p class="success">{message}</p>{/if}{#if error}<p class="form-error">{error}</p>{/if}
  <div class="preset-library-grid">
    {#each availablePresets as preset}
      <article><div><p class="eyebrow">{preset.source === 'builtin' ? 'Built in' : preset.source === 'user' ? 'Saved' : 'Current session'}</p><h3>{preset.name}</h3><p>{preset.description ?? 'No description provided.'}</p><p class="meta">Updated {preset.source === 'live' ? 'during this session' : formatDate(preset.updatedAt)}</p><p class="coverage"><strong>Stages:</strong> {stageCoverage(preset)}</p></div><div class="button-row"><button class="ghost" type="button" on:click={() => showPreset(preset)}>Inspect</button><button type="button" on:click={() => applyPreset(preset)}>Apply</button></div></article>
    {/each}
  </div>
  <section class="panel save-preset"><h3>Save current session settings</h3><div class="form-grid compact-grid"><label>Preset name<input bind:value={saveName} placeholder="My cruise settings" /></label><label>Description<input bind:value={saveDescription} placeholder="Optional note" /></label></div><button type="button" on:click={saveCurrentSettings}>Save preset</button></section>
</section>

{#if selectedPreset}<PresetDetailModal preset={selectedPreset} onApply={applyPreset} onClose={closeDetail} />{/if}
{#if explorerOpen}<ExplorerModal currentUrl={$page.url} onClose={() => void goto(closeExplorerModalHref($page.url))} />{/if}

<style>
  .preset-library-page { display: grid; gap: 1rem; max-width: 78rem; margin: 0 auto; padding: 1rem; } .panel-heading { display: flex; justify-content: space-between; gap: 1rem; } .panel-heading h2, .panel-heading p, article h3, article p, .save-preset h3 { margin: 0; } .button-row { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; } .button-link { display: inline-flex; align-items: center; min-height: 2.2rem; padding: 0 .7rem; color: #fff; border-radius: .35rem; background: var(--wb-accent, #28765c); text-decoration: none; font-weight: 700; } .preset-library-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr)); gap: .75rem; } article, .save-preset { display: grid; gap: .85rem; padding: 1rem; border: 1px solid var(--wb-divider, #d9e4e0); border-radius: .5rem; background: var(--wb-surface, #fff); } article { grid-template-rows: 1fr auto; } article p:not(.eyebrow) { color: var(--wb-text-muted, #60746c); } .save-preset { max-width: 46rem; } @media (max-width: 650px) { .panel-heading { flex-direction: column; } }
</style>
