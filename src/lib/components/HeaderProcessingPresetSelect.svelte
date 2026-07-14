<script lang="ts">
  import { onMount } from 'svelte';
  import { listProcessingPresets } from '$lib/api/processingPresets';
  import type { ProcessingPreset } from '$lib/processing/settings';
  import {
    PROCESSING_PRESET_APPLIED_EVENT,
    processingPresetByKey,
    processingPresetKey
  } from '$lib/processing/settings';
  import {
    applyProcessingPresetToSession,
    processingPresetSession,
    setSelectedProcessingPresetKey
  } from '$lib/stores/processingPresetSession';

  let presets: ProcessingPreset[] = [];
  let loading = true;
  let error: string | null = null;

  $: livePreset = $processingPresetSession.livePreset;
  $: availablePresets = [livePreset, ...presets];
  $: if (!loading && !error && !processingPresetByKey(availablePresets, $processingPresetSession.selectedKey)) {
    setSelectedProcessingPresetKey('live:live');
  }
  $: if (
    !loading &&
    !error &&
    $processingPresetSession.selectedKey !== 'live:live' &&
    !$processingPresetSession.selectedPreset
  ) {
    const persistedPreset = processingPresetByKey(presets, $processingPresetSession.selectedKey);
    if (persistedPreset) applyProcessingPresetToSession(persistedPreset);
  }

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

  function applySelectedPreset(event: Event) {
    const selectedKey = (event.currentTarget as HTMLSelectElement).value;
    const preset = processingPresetByKey(availablePresets, selectedKey);
    if (!preset) return;
    const appliedPreset = applyProcessingPresetToSession(preset);
    window.dispatchEvent(
      new CustomEvent<ProcessingPreset>(PROCESSING_PRESET_APPLIED_EVENT, {
        detail: appliedPreset
      })
    );
  }
</script>

<label class="header-preset-select" title={error ?? 'Apply processing settings preset'}>
  <span>Preset</span>
  <select value={$processingPresetSession.selectedKey} on:change={applySelectedPreset} disabled={loading || Boolean(error)}>
    {#each availablePresets as preset}
      <option value={processingPresetKey(preset)}>
        {preset.name}{preset.source === 'builtin' ? ' · built in' : preset.source === 'user' ? ' · saved' : ' · live'}
      </option>
    {/each}
  </select>
</label>
