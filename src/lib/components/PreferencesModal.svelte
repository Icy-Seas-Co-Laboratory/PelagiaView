<script lang="ts">
  import { onMount } from 'svelte';
  import { session } from '$lib/stores/session';
  import {
    clearPreference,
    clearPreferences,
    exportPreferences,
    importPreferences,
    listPreferenceEntries,
    uiStatePreferenceKeys,
    type PreferenceCategory,
    type PreferenceEntry
  } from '$lib/utils/preferenceRegistry';

  export let open = false;
  export let onClose: () => void = () => undefined;

  const categories: { id: PreferenceCategory; label: string }[] = [
    { id: 'connection', label: 'Connection' },
    { id: 'interface', label: 'Interface' },
    { id: 'workflow', label: 'Workflow Defaults' },
    { id: 'image', label: 'Image Viewing' },
    { id: 'diagnostics', label: 'Diagnostics' }
  ];

  let entries: PreferenceEntry[] = [];
  let importText = '';
  let statusMessage = '';
  let needsReload = false;
  const importPlaceholder = '{"format":"pelagia-view-preferences","entries":{...}}';

  $: if (open) refreshEntries();
  $: presentCount = entries.filter((entry) => entry.present).length;
  $: totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);

  onMount(() => {
    refreshEntries();
  });

  function refreshEntries() {
    entries = listPreferenceEntries();
  }

  function entriesForCategory(category: PreferenceCategory) {
    return entries.filter((entry) => entry.category === category);
  }

  function resetOne(entry: PreferenceEntry) {
    clearPreference(entry.key);
    statusMessage = `Reset ${entry.label}.`;
    needsReload = true;
    refreshEntries();
  }

  function resetUiState() {
    if (!window.confirm('Reset saved page state and workflow defaults? Connection and analytics state will be kept.')) return;
    clearPreferences(uiStatePreferenceKeys());
    statusMessage = 'Reset saved page state and workflow defaults.';
    needsReload = true;
    refreshEntries();
  }

  function resetAll() {
    if (!window.confirm('Reset all PelagiaView preferences, including the saved backend connection?')) return;
    clearPreferences(entries.map((entry) => entry.key));
    statusMessage = 'Reset all PelagiaView preferences.';
    needsReload = true;
    refreshEntries();
  }

  async function copyExport() {
    const payload = JSON.stringify(exportPreferences(), null, 2);
    importText = payload;
    try {
      await navigator.clipboard.writeText(payload);
      statusMessage = 'Preferences export copied to the clipboard.';
    } catch {
      statusMessage = 'Preferences export prepared below.';
    }
  }

  function downloadExport() {
    const payload = JSON.stringify(exportPreferences(), null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `pelagia-view-preferences-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    statusMessage = 'Preferences export downloaded.';
  }

  function importFromText() {
    try {
      const result = importPreferences(importText);
      statusMessage = `Imported ${result.imported} preference entr${result.imported === 1 ? 'y' : 'ies'}${result.skipped ? ` and skipped ${result.skipped}` : ''}.`;
      needsReload = true;
      refreshEntries();
    } catch (error) {
      statusMessage = error instanceof Error ? error.message : 'Unable to import preferences.';
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
</script>

{#if open}
  <div class="modal-backdrop preferences-backdrop" role="presentation" on:click={onClose}>
    <div class="preferences-modal" role="dialog" aria-modal="true" aria-labelledby="preferences-title" tabindex="-1" on:click|stopPropagation on:keydown|stopPropagation>
      <header class="panel-heading">
        <div>
          <p class="eyebrow">PelagiaView</p>
          <h2 id="preferences-title">Preferences</h2>
        </div>
        <button class="ghost" type="button" on:click={onClose}>Close</button>
      </header>

      <div class="preferences-summary">
        <div>
          <span>Current endpoint</span>
          <strong>{$session.baseUrl}</strong>
        </div>
        <div>
          <span>Saved entries</span>
          <strong>{presentCount}</strong>
        </div>
        <div>
          <span>Local storage</span>
          <strong>{formatBytes(totalBytes)}</strong>
        </div>
      </div>

      {#if statusMessage}
        <p class="preferences-status" class:requires-reload={needsReload}>
          {statusMessage}
          {#if needsReload}
            <span>Refresh the page to apply changes everywhere.</span>
          {/if}
        </p>
      {/if}

      <div class="preferences-actions">
        <button class="ghost" type="button" on:click={copyExport}>Copy export</button>
        <button class="ghost" type="button" on:click={downloadExport}>Download export</button>
        <button class="ghost" type="button" on:click={resetUiState}>Reset page state</button>
        <button class="ghost danger" type="button" on:click={resetAll}>Reset all</button>
      </div>

      <div class="preferences-grid">
        {#each categories as category}
          <section class="preferences-section">
            <h3>{category.label}</h3>
            {#each entriesForCategory(category.id) as entry}
              <article class="preference-card" class:missing={!entry.present}>
                <div>
                  <strong>{entry.label}</strong>
                  <p>{entry.description}</p>
                  <small>{entry.key}</small>
                </div>
                <div class="preference-card-meta">
                  <span>{entry.present ? formatBytes(entry.bytes) : 'Not saved'}</span>
                  {#if entry.updatedAt}
                    <span>{entry.updatedAt}</span>
                  {:else if entry.valuePreview}
                    <span>{entry.valuePreview}</span>
                  {/if}
                  <button class="ghost" type="button" disabled={!entry.present} on:click={() => resetOne(entry)}>Reset</button>
                </div>
              </article>
            {/each}
          </section>
        {/each}
      </div>

      <section class="preferences-import">
        <div class="panel-heading">
          <div>
            <h3>Import Preferences</h3>
            <p>Paste a PelagiaView preference export to restore saved UI state on this browser.</p>
          </div>
          <button class="ghost" type="button" disabled={!importText.trim()} on:click={importFromText}>Import</button>
        </div>
        <textarea bind:value={importText} rows="7" placeholder={importPlaceholder}></textarea>
      </section>
    </div>
  </div>
{/if}
