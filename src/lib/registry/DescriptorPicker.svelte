<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { canCreateDescriptor, descriptorOptions } from './descriptorOptions';
  import type { DescriptorTag } from './types';

  export let title: string;
  export let scope: 'target_tags' | 'image_tags';
  export let tags: DescriptorTag[] = [];
  export let assigned: DescriptorTag[] = [];
  export let targetCount = 1;

  const dispatch = createEventDispatcher<{
    assign: { tag: DescriptorTag };
    remove: { tag: DescriptorTag };
    create: { name: string; scope: 'target_tags' | 'image_tags' };
  }>();
  let query = '';
  let open = false;
  let activeIndex = 0;
  $: assignedIds = new Set(assigned.map((tag) => tag.tag_id));
  $: options = descriptorOptions(tags, scope, assignedIds, query);
  $: allowCreate = canCreateDescriptor(tags, scope, query);
  $: optionCount = options.length + (allowCreate ? 1 : 0);

  function choose(tag: DescriptorTag) {
    query = ''; open = false; activeIndex = 0;
    dispatch('assign', { tag });
  }

  function create() {
    const name = query.trim();
    if (!name || !allowCreate) return;
    query = ''; open = false; activeIndex = 0;
    dispatch('create', { name, scope });
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault(); open = true; activeIndex = Math.min(Math.max(0, optionCount - 1), activeIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault(); activeIndex = Math.max(0, activeIndex - 1);
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      if (activeIndex < options.length && options[activeIndex]) choose(options[activeIndex]);
      else if (allowCreate) create();
    } else if (event.key === 'Escape') {
      event.preventDefault(); open = false;
    }
  }

  function source(tag: DescriptorTag) {
    const mapping = tag.metadata?.concept?.mappings?.[0];
    return tag.preferred ? `Pelagia Core${mapping ? ` · ${mapping.authority}:${mapping.identifier}` : ''}` : 'Dataset-defined';
  }
</script>

<div class="heading"><h3>{title}</h3><span>{targetCount > 1 ? `Apply to ${targetCount} ROIs` : 'Focused ROI'}</span></div>
{#if assigned.length}
  <div class="chips" aria-label={`Assigned ${title.toLowerCase()}`}>
    {#each assigned as tag (tag.tag_id)}
      <span class:preferred={tag.preferred} class="chip" title={source(tag)}>{tag.name}{#if tag.preferred}<sup>◆</sup>{/if}<button aria-label={`Remove ${tag.name}`} title={`Remove ${tag.name}`} on:click={()=>dispatch('remove',{tag})}>×</button></span>
    {/each}
  </div>
{/if}
<div class="picker">
  <input role="combobox" aria-label={`Add ${title.toLowerCase()}`} aria-autocomplete="list" aria-expanded={open} aria-controls={`descriptor-options-${scope}`} value={query} placeholder={`Add ${title.toLowerCase().replace(' descriptors',' descriptor')}…`} autocomplete="off" on:focus={()=>{open=true;activeIndex=0}} on:input={(event)=>{query=(event.currentTarget as HTMLInputElement).value;open=true;activeIndex=0}} on:keydown={keydown} on:blur={()=>setTimeout(()=>open=false,120)} />
  {#if open}
    <div class="options" id={`descriptor-options-${scope}`} role="listbox">
      {#each options as tag,index (tag.tag_id)}
        <button class:active={activeIndex===index} role="option" aria-selected={activeIndex===index} on:mousedown={(event)=>event.preventDefault()} on:click={()=>choose(tag)}><span><strong>{tag.name}</strong><small>{source(tag)}</small></span>{#if tag.preferred}<em>◆</em>{/if}</button>
      {/each}
      {#if allowCreate}<button class:active={activeIndex===options.length} class="create" role="option" aria-selected={activeIndex===options.length} on:mousedown={(event)=>event.preventDefault()} on:click={create}><strong>＋ Create “{query.trim()}”</strong><small>Dataset-specific {scope === 'target_tags' ? 'target' : 'image'} descriptor</small></button>{/if}
      {#if !options.length && !allowCreate}<div class="empty">No available tags</div>{/if}
    </div>
  {/if}
</div>

<style>
  .heading { display:flex; align-items:center; justify-content:space-between; }
  h3 { margin:0 !important; }
  .heading > span { color:var(--muted); font-size:9px; }
  .chips { display:flex; flex-wrap:wrap; gap:4px; margin:8px 0; }
  .chip { display:inline-flex; align-items:center; gap:3px; max-width:100%; padding:3px 4px 3px 7px; border:1px solid var(--line); border-radius:12px; background:var(--raised); font-size:10px; }
  .chip.preferred { border-color:color-mix(in srgb,var(--accent) 55%,var(--line)); background:color-mix(in srgb,var(--accent) 8%,var(--raised)); }
  .chip sup { color:var(--accent); font-size:7px; }
  .chip button { width:16px; height:16px; display:grid; place-items:center; padding:0; border:0; border-radius:50%; background:transparent; color:var(--muted); line-height:1; }
  .picker { position:relative; margin-top:7px; }
  .picker > input { width:100%; padding:7px 8px; }
  .options { position:absolute; z-index:11; top:calc(100% + 2px); left:0; right:0; max-height:245px; overflow:auto; border:1px solid var(--line); background:var(--raised); box-shadow:0 7px 20px #071b2233; }
  .options button { width:100%; min-height:39px; display:flex; align-items:center; gap:6px; padding:5px 7px; border:0; border-bottom:1px solid color-mix(in srgb,var(--line) 60%,transparent); background:var(--raised); color:var(--text); text-align:left; }
  .options button.active { background:color-mix(in srgb,var(--accent) 14%,var(--raised)); }
  .options button > span { min-width:0; display:flex; flex:1; flex-direction:column; }
  .options strong,.options small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .options strong { font-size:10px; }
  .options small { color:var(--muted); font-size:9px; }
  .options em { color:var(--accent); font-size:8px; font-style:normal; }
  .options .create { display:flex; flex-direction:column; align-items:flex-start; color:var(--accent); }
  .empty { padding:12px; color:var(--muted); text-align:center; font-size:10px; }
</style>
