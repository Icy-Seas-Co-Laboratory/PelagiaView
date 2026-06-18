<script lang="ts">
  import { onMount } from 'svelte';
  import { listProcessingPresets } from '$lib/api/processingPresets';
  import type { ProcessingPreset } from '$lib/processing/settings';
  import {
    liveProcessingPreset,
    PROCESSING_PRESET_APPLIED_EVENT,
    processingPresetByKey,
    processingPresetKey
  } from '$lib/processing/settings';
  import { preferenceKey, readPreferences } from '$lib/utils/preferences';

  const liveProcessingPresetKey = preferenceKey('processing-preset:live');

  let presets: ProcessingPreset[] = [];
  let selectedKey = 'live:live';
  let loading = true;
  let error: string | null = null;

  $: livePreset = readLivePreset();
  $: availablePresets = [livePreset, ...presets];

  onMount(() => {
    void loadPresets();
  });

  async function loadPresets() {
    loading = true;
    error = null;
    try {
      presets = await listProcessingPresets();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  function readLivePreset(): ProcessingPreset {
    const stored = readPreferences<ProcessingPreset>(liveProcessingPresetKey);
    if (stored?.source === 'live' && stored.settings) {
      return stored as ProcessingPreset;
    }
    return liveProcessingPreset({});
  }

  function applySelectedPreset() {
    const preset = processingPresetByKey(availablePresets, selectedKey);
    if (!preset || preset.source === 'live') return;
    const nextLivePreset = liveProcessingPreset(preset.settings);
    localStorage.setItem(liveProcessingPresetKey, JSON.stringify(nextLivePreset));
    window.dispatchEvent(
      new CustomEvent<ProcessingPreset>(PROCESSING_PRESET_APPLIED_EVENT, {
        detail: nextLivePreset
      })
    );
    selectedKey = 'live:live';
  }
</script>

<label class="header-preset-select" title={error ?? 'Apply processing settings preset'}>
  <span>Preset</span>
  <select bind:value={selectedKey} on:change={applySelectedPreset} disabled={loading || Boolean(error)}>
    {#each availablePresets as preset}
      <option value={processingPresetKey(preset)}>
        {preset.name}{preset.source === 'builtin' ? ' · built in' : preset.source === 'user' ? ' · saved' : ' · live'}
      </option>
    {/each}
  </select>
</label>
