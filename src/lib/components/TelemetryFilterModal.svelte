<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import { getClient } from '$lib/stores/session';
  import type { TelemetryCatalogResponse, TelemetryRangeFilter } from '$lib/api/types';

  export let initialFilters: TelemetryRangeFilter[] = [];

  type CatalogParameter = { key: string; label: string; unit: string };
  type DraftFilter = { parameter_key: string; min_value: string; max_value: string };

  const dispatch = createEventDispatcher<{ apply: TelemetryRangeFilter[]; close: void }>();
  let catalog: CatalogParameter[] = [];
  let drafts: DraftFilter[] = [];
  let loading = true;
  let error: string | null = null;

  function toDraft(filter: TelemetryRangeFilter): DraftFilter {
    return {
      parameter_key: filter.parameter_key,
      min_value: filter.min_value == null ? '' : String(filter.min_value),
      max_value: filter.max_value == null ? '' : String(filter.max_value)
    };
  }

  function catalogParameters(response: TelemetryCatalogResponse): CatalogParameter[] {
    return (response.parameters ?? []).map((parameter) => {
      const key = String(parameter.parameter_key ?? parameter.key ?? parameter.name ?? '');
      const unit = String(parameter.canonical_unit ?? parameter.unit ?? '');
      return { key, unit, label: String(parameter.display_name ?? parameter.name ?? key) };
    }).filter((parameter) => parameter.key);
  }

  onMount(async () => {
    drafts = initialFilters.length ? initialFilters.map(toDraft) : [{ parameter_key: '', min_value: '', max_value: '' }];
    const client = getClient();
    if (!client) {
      error = 'Connect to a Pelagia server to load telemetry parameters.';
      loading = false;
      return;
    }
    try {
      catalog = catalogParameters(await client.telemetryCatalog());
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Telemetry catalog could not be loaded.';
    } finally {
      loading = false;
    }
    window.addEventListener('keydown', handleKeydown);
  });

  onDestroy(() => window.removeEventListener('keydown', handleKeydown));

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') dispatch('close');
  }

  function updateDraft(index: number, field: keyof DraftFilter, value: string) {
    drafts = drafts.map((draft, draftIndex) => draftIndex === index ? { ...draft, [field]: value } : draft);
    error = null;
  }

  function addDraft() {
    drafts = [...drafts, { parameter_key: '', min_value: '', max_value: '' }];
  }

  function removeDraft(index: number) {
    drafts = drafts.filter((_, draftIndex) => draftIndex !== index);
  }

  function apply() {
    const result: TelemetryRangeFilter[] = [];
    for (const draft of drafts) {
      const hasAnyValue = draft.parameter_key || draft.min_value.trim() || draft.max_value.trim();
      if (!hasAnyValue) continue;
      if (!draft.parameter_key || (!draft.min_value.trim() && !draft.max_value.trim())) {
        error = 'Choose a parameter and enter a minimum or maximum for each filter.';
        return;
      }
      const min = draft.min_value.trim() ? Number(draft.min_value) : null;
      const max = draft.max_value.trim() ? Number(draft.max_value) : null;
      if ((min !== null && !Number.isFinite(min)) || (max !== null && !Number.isFinite(max))) {
        error = 'Telemetry bounds must be finite numbers.';
        return;
      }
      if (min !== null && max !== null && min > max) {
        error = 'A filter minimum cannot be greater than its maximum.';
        return;
      }
      result.push({ parameter_key: draft.parameter_key, min_value: min, max_value: max });
    }
    dispatch('apply', result);
  }
</script>

<div class="modal-backdrop telemetry-filter-backdrop" role="presentation" on:click={() => dispatch('close')}>
  <div class="telemetry-filter-dialog" role="dialog" aria-modal="true" aria-labelledby="telemetry-filter-title" tabindex="-1" on:click|stopPropagation on:keydown|stopPropagation>
    <header>
      <div>
        <p class="eyebrow">Selection filter</p>
        <h2 id="telemetry-filter-title">Add telemetry filters</h2>
        <p>Values are compared in the catalog’s canonical units at each frame timestamp.</p>
      </div>
      <button class="close ghost" type="button" aria-label="Close telemetry filters" on:click={() => dispatch('close')}>×</button>
    </header>

    <div class="telemetry-filter-body">
      {#if loading}
        <p class="muted">Loading telemetry parameters…</p>
      {:else if catalog.length === 0}
        <p class="muted">No telemetry parameters are available yet.</p>
      {:else}
        {#each drafts as draft, index}
          <div class="filter-row">
            <label>
              <span>Parameter</span>
              <select value={draft.parameter_key} on:change={(event) => updateDraft(index, 'parameter_key', event.currentTarget.value)}>
                <option value="">Choose parameter</option>
                {#each catalog as parameter}
                  <option value={parameter.key}>{parameter.label}{parameter.unit ? ` (${parameter.unit})` : ''}</option>
                {/each}
              </select>
            </label>
            <label>
              <span>Minimum</span>
              <input type="number" step="any" value={draft.min_value} on:input={(event) => updateDraft(index, 'min_value', event.currentTarget.value)} placeholder="No minimum" />
            </label>
            <label>
              <span>Maximum</span>
              <input type="number" step="any" value={draft.max_value} on:input={(event) => updateDraft(index, 'max_value', event.currentTarget.value)} placeholder="No maximum" />
            </label>
            <button class="remove-filter" type="button" aria-label={`Remove filter ${index + 1}`} on:click={() => removeDraft(index)}>×</button>
          </div>
        {/each}
        <button class="add-filter" type="button" on:click={addDraft}>+ Add another telemetry filter</button>
      {/if}
      {#if error}<p class="error">{error}</p>{/if}
    </div>

    <footer>
      <button class="secondary" type="button" on:click={() => dispatch('close')}>Cancel</button>
      <button class="primary" type="button" disabled={loading} on:click={apply}>Apply filters</button>
    </footer>
  </div>
</div>

<style>
  .telemetry-filter-backdrop { align-items: center; display: flex; justify-content: center; padding: 1rem; z-index: 30; }
  .telemetry-filter-dialog { background: var(--surface, #fff); border: 1px solid var(--border-subtle, #d9dee7); border-radius: 0.8rem; box-shadow: 0 1rem 3rem rgb(15 23 42 / 22%); max-width: 760px; width: min(100%, 760px); }
  header, footer { align-items: flex-start; display: flex; gap: 1rem; justify-content: space-between; padding: 1.1rem 1.25rem; }
  header { border-bottom: 1px solid var(--border-subtle, #d9dee7); }
  header h2 { margin: 0.1rem 0 0.35rem; }
  header p:last-child { color: var(--text-muted, #667085); font-size: 0.85rem; margin: 0; }
  .eyebrow { color: var(--text-muted, #667085); font-size: 0.72rem; letter-spacing: 0.05em; margin: 0; text-transform: uppercase; }
  .close { font-size: 1.4rem; }
  .telemetry-filter-body { padding: 1.25rem; }
  .filter-row { align-items: end; display: grid; gap: 0.65rem; grid-template-columns: minmax(0, 1.6fr) minmax(100px, 1fr) minmax(100px, 1fr) auto; margin-bottom: 0.7rem; }
  label { display: grid; gap: 0.3rem; }
  label span { color: var(--text-muted, #667085); font-size: 0.72rem; }
  select, input { min-width: 0; }
  .remove-filter { align-self: center; border: 0; color: var(--text-muted, #667085); font-size: 1.2rem; padding: 0.3rem; }
  .add-filter { background: transparent; border: 0; color: var(--accent, #2563eb); padding: 0.35rem 0; }
  footer { border-top: 1px solid var(--border-subtle, #d9dee7); justify-content: flex-end; }
  .primary, .secondary { border-radius: 0.4rem; padding: 0.55rem 0.9rem; }
  .primary { background: var(--accent, #2563eb); border: 1px solid var(--accent, #2563eb); color: #fff; }
  .secondary { background: transparent; border: 1px solid var(--border-subtle, #d9dee7); }
  .muted, .error { font-size: 0.85rem; }
  .error { color: var(--danger, #b42318); margin-bottom: 0; }
  @media (max-width: 620px) { .filter-row { grid-template-columns: 1fr 1fr; } .filter-row label:first-child { grid-column: 1 / -1; } .remove-filter { justify-self: end; } }
</style>
