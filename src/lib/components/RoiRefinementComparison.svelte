<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { getClient } from '$lib/stores/session';
  import type { DetectionSummary } from '$lib/api/types';
  import type { ImageRenderSpec } from '$lib/utils/imageRenderSpec';
  import KonvaImageCanvas from './KonvaImageCanvas.svelte';

  export let refined: DetectionSummary;
  export let renderSpec: (detection: DetectionSummary, mode: 'candidate' | 'refined', masked: boolean) => ImageRenderSpec;
  export let bboxLabel: (detection: DetectionSummary) => string;

  let candidateId = '';
  let candidate: DetectionSummary | null = null;
  let masked = false;
  let mounted = false;
  let loadedId = '';
  let serial = 0;
  let loading = false;
  let error = '';

  $: candidateIds = [...new Set([
    refined.primary_candidate_detection_id,
    refined.candidate_detection_id,
    ...(refined.candidate_detection_ids ?? [])
  ].filter((id): id is string => Boolean(id)))];
  $: if (!candidateIds.includes(candidateId)) candidateId = candidateIds[0] ?? '';
  $: if (mounted && candidateId !== loadedId) void loadCandidate(candidateId);
  $: before = candidate ? renderSpec(candidate, 'candidate', masked) : null;
  $: after = renderSpec(refined, 'refined', masked);

  onMount(() => { mounted = true; });
  onDestroy(() => { serial++; });

  async function loadCandidate(id: string) {
    loadedId = id;
    const request = ++serial;
    candidate = null; error = ''; loading = Boolean(id);
    if (!id) return;
    try {
      const client = getClient();
      if (!client) throw new Error('Connect to Pelagia to load the source ROI.');
      const result = await client.getDetection(id);
      if (request === serial) candidate = result;
    } catch (err) {
      if (request === serial) error = err instanceof Error ? err.message : String(err);
    } finally {
      if (request === serial) loading = false;
    }
  }

  function dimensions(spec: ImageRenderSpec) {
    const { sourceWidth, sourceHeight } = spec.image;
    return sourceWidth && sourceHeight ? `${sourceWidth} × ${sourceHeight} px` : 'Dimensions unavailable';
  }
</script>

<section class="comparison" aria-label="Before and after ROI refinement">
  <div class="controls">
    <label><input type="checkbox" bind:checked={masked} /> Apply masks to both images</label>
    {#if candidateIds.length > 1}
      <label>Source candidate
        <select bind:value={candidateId}>
          {#each candidateIds as id}<option value={id}>{id}</option>{/each}
        </select>
      </label>
    {/if}
  </div>
  {#if refined.refinement_relationship || refined.refinement_method}
    <p class="relationship">{refined.refinement_relationship?.replaceAll('_', ' ')}{refined.refinement_method ? ` · ${refined.refinement_method}` : ''}</p>
  {/if}
  <div class="images">
    <figure>
      <figcaption><strong>Before</strong><span>Source candidate</span></figcaption>
      {#if loading}<p role="status">Loading source ROI…</p>
      {:else if error}<p role="alert">{error}</p><button type="button" on:click={() => loadCandidate(candidateId)}>Retry source ROI</button>
      {:else if candidate && before}
        <KonvaImageCanvas spec={before} mode="static" />
        <small>{dimensions(before)}</small>
        <small>Bbox: {bboxLabel(candidate)}</small>
      {:else}<p>No source candidate link is recorded for this refinement.</p>{/if}
      {#if candidateId}<code>{candidateId}</code>{/if}
    </figure>
    <figure>
      <figcaption><strong>After</strong><span>Selected refined ROI</span></figcaption>
      <KonvaImageCanvas spec={after} mode="static" />
      <small>{dimensions(after)}</small>
      <small>Bbox: {bboxLabel(refined)}</small>
      <code>{refined.id}</code>
    </figure>
  </div>
  <p class="scale-note">Crops are fitted independently. Dimensions and scale bars are in pixels. The after image is the selected refinement record.</p>
</section>

<style>
  .comparison { width:100%; min-width:0; color:#e4ece8; }
  .controls { display:flex; flex-wrap:wrap; align-items:center; gap:.7rem; font-size:.8rem; }
  .controls label { display:flex; align-items:center; flex-wrap:wrap; gap:.35rem; min-width:0; }
  .controls select { min-width:0; max-width:100%; }
  .images { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr)); gap:1rem; }
  figure { margin:0; min-width:0; display:flex; flex-direction:column; align-items:stretch; gap:.35rem; }
  figcaption { display:flex; flex-wrap:wrap; align-items:baseline; gap:.5rem; margin:.75rem 0 .25rem; }
  figcaption span, .scale-note, .relationship { color:#b5c8be; font-size:.78rem; }
  small { font-size:.75rem; }
  code { font-size:.65rem; overflow-wrap:anywhere; }
  .scale-note { margin:.8rem 0 0; }
</style>
