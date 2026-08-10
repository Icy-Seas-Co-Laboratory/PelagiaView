<script lang="ts">
  import { formatCount } from '$lib/utils/format';
  import type { LiveFilterOption } from '$lib/types/liveFilters';

  export let title: string;
  export let eyebrow = 'Filter';
  export let options: LiveFilterOption[] = [];
  export let selected: Set<string> = new Set();
  export let allLabel = 'All items';
  export let allDetail = 'No restriction';
  export let allCount: number | null = null;
  export let allCountLabel = '';
  export let searchPlaceholder = 'Search options';
  export let searchable = true;
  export let maxVisible = 300;
  export let emptyMessage = 'No options are available.';
  export let disabled = false;
  export let open = true;
  export let onChange: ((value: Set<string>) => void) | null = null;

  let query = '';

  $: normalizedQuery = query.trim().toLocaleLowerCase();
  $: matchingOptions = normalizedQuery
    ? options.filter((option) => optionSearchText(option).includes(normalizedQuery))
    : options;
  $: visibleOptions = matchingOptions.slice(0, maxVisible);
  $: hiddenMatchCount = Math.max(0, matchingOptions.length - visibleOptions.length);
  $: unavailableSelectedCount = [...selected].filter((id) => !options.some((option) => option.id === id)).length;
  $: selectionLabel = selected.size === 0
    ? allLabel
    : `${formatCount(selected.size)} selected`;

  function optionSearchText(option: LiveFilterOption): string {
    return [option.label, option.detail, ...(option.keywords ?? [])]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase();
  }

  function toggleOption(id: string) {
    if (disabled) return;
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange?.(next);
  }

  function chooseAll() {
    if (!disabled) onChange?.(new Set());
  }

  function selectMatches() {
    if (disabled || !normalizedQuery) return;
    const next = new Set(selected);
    for (const option of matchingOptions) {
      if (!option.disabled) next.add(option.id);
    }
    onChange?.(next);
  }

  function optionCount(option: LiveFilterOption): string {
    if (option.count === null || option.count === undefined) return '';
    return `${formatCount(option.count)}${option.countLabel ? ` ${option.countLabel}` : ''}`;
  }

  function allCountText(): string {
    if (allCount === null || allCount === undefined) return allDetail;
    return `${formatCount(allCount)}${allCountLabel ? ` ${allCountLabel}` : ''}`;
  }
</script>

<details class="live-filter" {open}>
  <summary>
    <span class="live-filter-heading"><small>{eyebrow}</small><strong>{title}</strong></span>
    <span class:active={selected.size > 0} class="selection-badge">{selectionLabel}</span>
    <span class="disclosure" aria-hidden="true">⌄</span>
  </summary>

  <div class="live-filter-body">
    {#if searchable && options.length > 5}
      <div class="filter-search">
        <span aria-hidden="true">⌕</span>
        <input bind:value={query} type="search" placeholder={searchPlaceholder} aria-label={`${title}: ${searchPlaceholder}`} disabled={disabled} />
        {#if query}<button type="button" aria-label={`Clear ${title} search`} on:click={() => (query = '')}>×</button>{/if}
      </div>
    {/if}

    <div class="filter-actions">
      <span>{normalizedQuery ? `${formatCount(matchingOptions.length)} matches` : `${formatCount(options.length)} options`}</span>
      {#if normalizedQuery}<button type="button" on:click={selectMatches} disabled={disabled || matchingOptions.length === 0}>Select matching</button>{/if}
      {#if selected.size}<button type="button" on:click={chooseAll} disabled={disabled}>Clear selection</button>{/if}
    </div>

    <div class="filter-option-list" aria-label={`${title} options`}>
      <button class="all-option" class:active={selected.size === 0} type="button" aria-pressed={selected.size === 0} on:click={chooseAll} disabled={disabled}>
        <span class="option-control" aria-hidden="true">{selected.size === 0 ? '✓' : '○'}</span>
        <span class="option-copy"><strong>{allLabel}</strong><small>{allCountText()}</small></span>
      </button>

      {#each visibleOptions as option (option.id)}
        <label class:active={selected.has(option.id)} class:disabled={disabled || option.disabled}>
          <input type="checkbox" checked={selected.has(option.id)} disabled={disabled || option.disabled} on:change={() => toggleOption(option.id)} />
          <span class="option-copy"><strong title={option.label}>{option.label}</strong>{#if option.detail}<small title={option.detail}>{option.detail}</small>{/if}</span>
          {#if option.count !== null && option.count !== undefined}<span class="option-count">{optionCount(option)}</span>{/if}
        </label>
      {/each}

      {#if !visibleOptions.length}<p class="filter-empty">{normalizedQuery ? 'No options match this search.' : emptyMessage}</p>{/if}
    </div>

    {#if hiddenMatchCount}<p class="filter-footnote">Showing the first {formatCount(maxVisible)} results. Refine the search to see the remaining {formatCount(hiddenMatchCount)}.</p>{/if}
    {#if unavailableSelectedCount}<p class="filter-footnote warning">{formatCount(unavailableSelectedCount)} saved selection{unavailableSelectedCount === 1 ? ' is' : 's are'} not currently available.</p>{/if}
  </div>
</details>

<style>
  .live-filter{min-width:0;border:1px solid var(--wb-divider,var(--border,#d7e1de));border-radius:6px;background:var(--wb-surface,var(--surface,#fff));overflow:hidden}.live-filter>summary{display:grid;grid-template-columns:minmax(0,1fr)auto auto;gap:8px;align-items:center;min-height:48px;padding:8px 10px;cursor:pointer;list-style:none;user-select:none}.live-filter>summary::-webkit-details-marker{display:none}.live-filter>summary:hover{background:var(--wb-surface-subtle,#f5f8f7)}.live-filter>summary:focus-visible{outline:2px solid var(--wb-accent,var(--accent,#176f62));outline-offset:-2px}.live-filter-heading{display:grid;min-width:0}.live-filter-heading small{color:var(--wb-text-tertiary,var(--muted,#667));font-size:.59rem;font-weight:800;letter-spacing:.07em;text-transform:uppercase}.live-filter-heading strong{overflow:hidden;color:var(--wb-text-primary,#24332f);font-size:.78rem;text-overflow:ellipsis;white-space:nowrap}.selection-badge{max-width:12rem;overflow:hidden;border:1px solid var(--wb-divider,var(--border,#d7e1de));border-radius:999px;padding:3px 7px;color:var(--wb-text-secondary,var(--muted,#667));background:var(--wb-surface-subtle,#f5f8f7);font-size:.62rem;font-weight:800;text-overflow:ellipsis;white-space:nowrap}.selection-badge.active{border-color:color-mix(in srgb,var(--wb-accent,var(--accent,#176f62)) 40%,var(--wb-divider,#d7e1de));color:var(--wb-accent-strong,var(--accent,#176f62));background:var(--wb-accent-soft,#e8f3ef)}.disclosure{color:var(--wb-text-tertiary,var(--muted,#667));font-size:.9rem;transition:transform .15s ease}.live-filter:not([open]) .disclosure{transform:rotate(-90deg)}.live-filter-body{display:grid;gap:7px;border-top:1px solid var(--wb-divider,var(--border,#d7e1de));padding:8px;background:var(--wb-surface-subtle,#f7f9f8)}.filter-search{display:grid;grid-template-columns:auto minmax(0,1fr)auto;align-items:center;border:1px solid var(--wb-divider,var(--border,#d7e1de));border-radius:5px;background:var(--wb-surface,#fff)}.filter-search>span{padding-left:8px;color:var(--wb-text-tertiary,var(--muted,#667))}.filter-search input{min-width:0;border:0!important;background:transparent!important;box-shadow:none!important}.filter-search button{border:0;background:transparent;padding:4px 8px;color:var(--wb-text-tertiary,var(--muted,#667));font-size:1rem}.filter-actions{display:flex;flex-wrap:wrap;gap:4px;align-items:center;min-height:22px}.filter-actions>span{margin-right:auto;color:var(--wb-text-tertiary,var(--muted,#667));font-size:.61rem}.filter-actions button{border:0;padding:2px 4px;color:var(--wb-accent-strong,var(--accent,#176f62));background:transparent;font-size:.61rem;font-weight:800}.filter-option-list{display:grid;gap:2px;max-height:250px;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable}.filter-option-list label,.all-option{display:grid;grid-template-columns:18px minmax(0,1fr)auto;gap:6px;align-items:center;min-height:38px;margin:0;border:1px solid transparent;border-radius:4px;padding:4px 6px;color:var(--wb-text-primary,#24332f);background:var(--wb-surface,#fff);text-align:left}.filter-option-list label:hover,.all-option:hover{border-color:var(--wb-divider-strong,#bdccc7);background:var(--wb-surface-raised,#fff)}.filter-option-list label.active,.all-option.active{border-color:color-mix(in srgb,var(--wb-accent,var(--accent,#176f62)) 42%,var(--wb-divider,#d7e1de));background:var(--wb-accent-soft,#e8f3ef)}.filter-option-list label.disabled{opacity:.55}.filter-option-list input{width:14px;height:14px;margin:0;accent-color:var(--wb-accent,var(--accent,#176f62))}.option-control{display:grid;width:15px;height:15px;place-items:center;border:1px solid var(--wb-divider-strong,#bdccc7);border-radius:50%;color:var(--wb-accent-strong,var(--accent,#176f62));font-size:.62rem}.all-option.active .option-control{border-color:var(--wb-accent,var(--accent,#176f62));color:#fff;background:var(--wb-accent,var(--accent,#176f62))}.option-copy{display:grid;min-width:0}.option-copy strong,.option-copy small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.option-copy strong{font-size:.69rem}.option-copy small{color:var(--wb-text-tertiary,var(--muted,#667));font-size:.59rem}.option-count{justify-self:end;color:var(--wb-text-secondary,var(--muted,#667));font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.58rem;white-space:nowrap}.filter-empty,.filter-footnote{margin:0;padding:8px;color:var(--wb-text-tertiary,var(--muted,#667));font-size:.62rem;text-align:center}.filter-footnote{padding:2px 5px}.filter-footnote.warning{color:#936123}@media(max-width:640px){.live-filter>summary{grid-template-columns:minmax(0,1fr)auto}.selection-badge{max-width:9rem}.disclosure{display:none}.filter-option-list{max-height:220px}.option-count{font-size:.55rem}}
  .live-filter-heading small,.selection-badge,.filter-actions>span,.filter-actions button,
  .option-control,.option-copy small,.option-count,.filter-empty,.filter-footnote{
    font-size:var(--wb-font-micro,.7rem)
  }
  .live-filter-heading strong,.option-copy strong{font-size:var(--wb-font-small,.8125rem)}
  .option-copy small,.filter-footnote{line-height:var(--wb-line-compact,1.3)}
  @media(max-width:640px){.option-count{font-size:var(--wb-font-micro,.7rem)}}
</style>
