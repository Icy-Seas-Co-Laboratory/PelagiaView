<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { ProcessingPreset } from '$lib/processing/settings';
  import { presetSettingGroups } from '$lib/processing/presetDisplay';

  export let preset: ProcessingPreset;
  export let onApply: ((preset: ProcessingPreset) => void | Promise<void>) | null = null;
  export let onClose: (() => void) | null = null;

  let closeButton: HTMLButtonElement;
  let previouslyFocused: HTMLElement | null = null;
  $: groups = presetSettingGroups(preset);
  $: settingCount = groups.reduce((total, group) => total + group.entries.length, 0);

  onMount(() => {
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    void tick().then(() => closeButton?.focus());
    const onKeydown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose?.(); } };
    window.addEventListener('keydown', onKeydown);
    return () => { window.removeEventListener('keydown', onKeydown); previouslyFocused?.focus(); };
  });

  async function apply() { await onApply?.(preset); }
</script>

<div class="modal-backdrop preset-detail-backdrop" role="presentation" on:click={() => onClose?.()}>
  <div class="preset-detail-modal" role="dialog" aria-modal="true" aria-labelledby="preset-detail-title" aria-describedby="preset-detail-description" tabindex="-1" on:click|stopPropagation on:keydown|stopPropagation>
    <header>
      <div>
        <p class="eyebrow">{preset.source === 'builtin' ? 'Built-in preset' : preset.source === 'user' ? 'Saved preset' : 'Current session'}</p>
        <h2 id="preset-detail-title">{preset.name}</h2>
        <p id="preset-detail-description">{preset.description ?? 'No description provided.'}</p>
      </div>
      <button bind:this={closeButton} class="ghost" type="button" on:click={() => onClose?.()}>Close</button>
    </header>
    <div class="preset-detail-actions"><button type="button" on:click={apply}>Apply preset</button><span>{settingCount} setting{settingCount === 1 ? '' : 's'}</span></div>
    {#if groups.length}
      <div class="preset-detail-groups">
        {#each groups as group}
          <section>
            <h3>{group.label}</h3>
            <dl>{#each group.entries as entry}<div><dt>{entry.label}</dt><dd><code>{entry.value}</code></dd></div>{/each}</dl>
          </section>
        {/each}
      </div>
    {:else}<p class="empty">This preset does not define any settings.</p>{/if}
  </div>
</div>

<style>
  .preset-detail-backdrop { z-index: 80; }
  .preset-detail-modal { display: grid; gap: 1rem; width: min(68rem, 100%); max-height: min(92vh, 60rem); overflow: auto; padding: 1rem; border: 1px solid var(--wb-divider, #d0ddd8); border-radius: .5rem; background: var(--wb-surface, #fbfdfc); box-shadow: 0 1.5rem 4rem rgb(5 8 7 / 35%); }
  header, .preset-detail-actions { display: flex; justify-content: space-between; gap: 1rem; align-items: start; } h2, h3, p { margin: 0; } header p:last-child, .preset-detail-actions span { color: var(--wb-text-muted, #60746c); }
  .preset-detail-groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr)); gap: .75rem; } .preset-detail-groups section { overflow: hidden; border: 1px solid var(--wb-divider, #d9e4e0); border-radius: .4rem; } h3 { padding: .6rem .75rem; font-size: .9rem; background: var(--wb-surface-subtle, #f4f8f6); } dl { margin: 0; } dl div { display: grid; gap: .2rem; padding: .55rem .75rem; border-top: 1px solid var(--wb-divider, #d9e4e0); } dt { color: var(--wb-text-muted, #60746c); font-size: .8rem; } dd { margin: 0; overflow-wrap: anywhere; } code { font-size: .78rem; }
  @media (max-width: 600px) { .preset-detail-modal { max-height: 100%; } header, .preset-detail-actions { align-items: stretch; flex-direction: column; } }
</style>
