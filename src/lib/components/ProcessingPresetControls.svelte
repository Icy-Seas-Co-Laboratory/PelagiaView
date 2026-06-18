<script lang="ts">
  import type { ProcessingPreset } from '$lib/processing/settings';
  import { processingPresetByKey, processingPresetKey } from '$lib/processing/settings';

  export let presets: ProcessingPreset[] = [];
  export let selectedKey = 'live:live';
  export let loading = false;
  export let message: string | null = null;
  export let error: string | null = null;
  export let allowSave = false;
  export let onApply: ((preset: ProcessingPreset) => void | Promise<void>) | null = null;
  export let onRefresh: (() => void | Promise<void>) | null = null;
  export let onSave: ((name: string, description: string) => void | Promise<void>) | null = null;

  let saveName = '';
  let saveDescription = '';

  $: selectedPreset = processingPresetByKey(presets, selectedKey) ?? presets[0] ?? null;

  async function applyPreset() {
    if (!selectedPreset) return;
    await onApply?.(selectedPreset);
  }

  async function savePreset() {
    await onSave?.(saveName, saveDescription);
    saveName = '';
    saveDescription = '';
  }
</script>

<details class="form-section collapsible-section" open>
  <summary class="section-heading">
    <span>
      <p class="eyebrow">Settings</p>
      <strong>Presets</strong>
    </span>
  </summary>

  <div class="form-grid compact-grid">
    <label class="span-2">
      Active preset
      <select bind:value={selectedKey}>
        {#each presets as preset}
          <option value={processingPresetKey(preset)}>
            {preset.name}{preset.source === 'builtin' ? ' · built in' : preset.source === 'user' ? ' · saved' : ' · live'}
          </option>
        {/each}
      </select>
    </label>
    <button class="ghost" type="button" on:click={applyPreset} disabled={!selectedPreset}>Apply preset</button>
    <button class="ghost" type="button" on:click={() => onRefresh?.()} disabled={loading}>
      {loading ? 'Refreshing' : 'Refresh presets'}
    </button>
  </div>

  {#if selectedPreset?.description}
    <p class="soft">{selectedPreset.description}</p>
  {/if}

  {#if allowSave}
    <div class="form-grid compact-grid">
      <label>
        Preset name
        <input bind:value={saveName} placeholder="My cruise settings" />
      </label>
      <label>
        Description
        <input bind:value={saveDescription} placeholder="Optional note" />
      </label>
    </div>
    <button type="button" on:click={savePreset}>Save current settings</button>
  {/if}

  {#if message}<p class="success">{message}</p>{/if}
  {#if error}<p class="form-error">{error}</p>{/if}
</details>
