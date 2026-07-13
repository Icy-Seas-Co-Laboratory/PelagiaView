<script lang="ts">
  import { createEventDispatcher, tick } from 'svelte';

  export let value = '';
  export let suggestions: string[] = [];
  export let placeholder = 'Add collection';
  export let multi = true;
  export let disabled = false;
  export let ariaLabel = 'Collections';
  export let onChange: (value: string) => void = () => {};

  const dispatch = createEventDispatcher<{ input: string; change: string }>();

  let draft = '';
  let focused = false;
  let inputElement: HTMLInputElement | null = null;
  let closeTimer: number | null = null;

  $: tokens = parseCollectionList(value);
  $: normalizedSuggestions = uniqueStrings(suggestions);
  $: filteredSuggestions = suggestionMatches(normalizedSuggestions, tokens, draft);

  function parseCollectionList(input: string): string[] {
    return uniqueStrings(
      input
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    );
  }

  function uniqueStrings(values: Array<string | null | undefined>): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of values) {
      const value = raw?.trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(value);
    }
    return result;
  }

  function suggestionMatches(options: string[], selected: string[], query: string): string[] {
    const normalizedQuery = query.trim().toLowerCase();
    const selectedKeys = new Set(selected.map((item) => item.toLowerCase()));
    return options
      .filter((option) => !selectedKeys.has(option.toLowerCase()))
      .filter((option) => !normalizedQuery || option.toLowerCase().includes(normalizedQuery))
      .slice(0, 8);
  }

  function setTokens(nextTokens: string[]) {
    const nextValue = uniqueStrings(multi ? nextTokens : nextTokens.slice(-1)).join(',');
    value = nextValue;
    onChange(nextValue);
    dispatch('input', nextValue);
    dispatch('change', nextValue);
  }

  function addToken(token: string) {
    const trimmed = token.trim();
    if (!trimmed) return;
    setTokens(multi ? [...tokens, trimmed] : [trimmed]);
    draft = '';
  }

  function commitDraft(raw = draft) {
    const entries = parseCollectionList(raw);
    if (!entries.length) return;
    setTokens(multi ? [...tokens, ...entries] : [entries[entries.length - 1]]);
    draft = '';
  }

  function removeToken(token: string) {
    setTokens(tokens.filter((item) => item !== token));
  }

  function handleInput(event: Event) {
    const nextValue = (event.currentTarget as HTMLInputElement).value;
    if (nextValue.includes(',')) {
      commitDraft(nextValue);
      return;
    }
    draft = nextValue;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === 'Tab') {
      if (!draft.trim()) return;
      event.preventDefault();
      commitDraft();
    } else if (event.key === 'Backspace' && !draft && tokens.length) {
      removeToken(tokens[tokens.length - 1]);
    }
  }

  function handleFocus() {
    focused = true;
    if (closeTimer !== null) {
      window.clearTimeout(closeTimer);
      closeTimer = null;
    }
  }

  function handleBlur() {
    commitDraft();
    closeTimer = window.setTimeout(() => {
      focused = false;
      closeTimer = null;
    }, 120);
  }

  async function chooseSuggestion(option: string) {
    addToken(option);
    focused = true;
    await tick();
    inputElement?.focus();
  }
</script>

<div class="collection-token-input" class:disabled>
  <div class="collection-token-list">
    {#each tokens as token}
      <span class="collection-token">
        <span class="collection-token-icon" aria-hidden="true"></span>
        <span>{token}</span>
        <button type="button" aria-label={`Remove ${token}`} disabled={disabled} on:click={() => removeToken(token)}>x</button>
      </span>
    {/each}
    <input
      bind:this={inputElement}
      value={draft}
      {placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      autocomplete="off"
      on:focus={handleFocus}
      on:blur={handleBlur}
      on:input={handleInput}
      on:keydown={handleKeydown}
    />
  </div>
  {#if focused && filteredSuggestions.length}
    <div class="collection-token-suggestions">
      {#each filteredSuggestions as option}
        <button type="button" on:mousedown|preventDefault={() => chooseSuggestion(option)}>
          <span class="collection-token-icon" aria-hidden="true"></span>
          <span>{option}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>
