<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { getClient } from '$lib/stores/session';
  import type { CurationLabel, CurationOptions, CurationRoi } from '$lib/api/types';

  let options: CurationOptions | null = null;
  let labels: CurationLabel[] = [];
  let items: CurationRoi[] = [];
  let detail: CurationRoi | null = null;
  let selected = new Set<string>();
  let focusedId = '';
  let annotationState = 'all';
  let reviewState = 'all';
  let evidenceState = 'all';
  let labelId = '';
  let sortBy = 'oldest';
  let search = '';
  let modelRef = '';
  let page = 0;
  let total = 0;
  const pageSize = 120;
  let loading = false;
  let working = false;
  let error: string | null = null;
  let notice: string | null = null;
  let newLabel = '';

  $: selectedItems = items.filter((item) => selected.has(item.id));
  $: currentEvidence = (detail?.evidence?.[0] as Record<string, any> | undefined) ?? null;
  $: probabilityRows = (currentEvidence?.probabilities ?? []) as Array<Record<string, any>>;
  $: evidencePacket = (currentEvidence?.evidence_packet ?? {}) as Record<string, any>;
  $: prototypeRows = Object.entries(evidencePacket?.prototype?.similarities ?? {})
    .map(([classIndex, similarity]) => ({
      classIndex: Number(classIndex),
      similarity: Number(similarity),
      label: classLabel(Number(classIndex))
    }))
    .sort((a, b) => b.similarity - a.similarity);
  $: knnNeighbors = (currentEvidence?.neighbors ?? []) as Array<Record<string, any>>;
  $: consensus = consensusSummary(detail);

  onMount(async () => {
    window.addEventListener('keydown', keydown);
    await initialize();
  });

  onDestroy(() => window.removeEventListener('keydown', keydown));

  async function initialize() {
    const client = getClient();
    if (!client) return;
    loading = true;
    try {
      options = await client.getCurationOptions();
      labels = options.labels ?? [];
      modelRef = options.default_model_ref ?? '';
      await load();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  async function load() {
    const client = getClient();
    if (!client) return;
    loading = true;
    error = null;
    try {
      const result = await client.listCurationRois({
        annotation_state: annotationState,
        review_state: reviewState,
        evidence_state: evidenceState,
        label_id: labelId || undefined,
        search: search || undefined,
        sort_by: sortBy,
        limit: pageSize,
        offset: page * pageSize
      });
      items = result.items ?? [];
      total = result.total ?? 0;
      selected = new Set([...selected].filter((id) => items.some((item) => item.id === id)));
      if (focusedId && items.some((item) => item.id === focusedId)) await focus(focusedId, false);
      else if (items.length) await focus(items[0].id, false);
      else detail = null;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  async function focus(id: string, replaceSelection = true) {
    const client = getClient();
    if (!client) return;
    focusedId = id;
    if (replaceSelection) selected = new Set([id]);
    try {
      detail = await client.getCurationRoi(id);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function choose(item: CurationRoi, event: MouseEvent) {
    if (event.metaKey || event.ctrlKey) {
      const next = new Set(selected);
      next.has(item.id) ? next.delete(item.id) : next.add(item.id);
      selected = next;
      await focus(item.id, false);
      return;
    }
    await focus(item.id);
  }

  function targets(): string[] {
    return selected.size ? [...selected] : focusedId ? [focusedId] : [];
  }

  async function assign(
    label: CurationLabel,
    evidenceId?: string | null,
    explicitTargets?: string[]
  ) {
    const ids = explicitTargets ?? targets();
    const client = getClient();
    if (!client || !ids.length || working) return;
    working = true;
    try {
      await client.annotateCurationRois(ids, label.id, evidenceId);
      notice = `Assigned ${label.display_name || label.name} to ${ids.length} ROI${ids.length === 1 ? '' : 's'}.`;
      await refreshAfterWrite();
      autoAdvance(ids);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      working = false;
    }
  }

  async function acceptPrediction() {
    if (!detail?.predicted_label_id || !detail.evidence_id) return;
    const label = labels.find((value) => value.id === detail?.predicted_label_id);
    if (label) await assign(label, detail.evidence_id, [detail.id]);
  }

  async function review(decision: 'verified' | 'rejected' | 'needs_review') {
    const ids = targets();
    const client = getClient();
    if (!client || !ids.length || working) return;
    working = true;
    try {
      await client.reviewCurationRois(ids, decision);
      notice = `Recorded ${decision.replace('_', ' ')} for ${ids.length} ROI${ids.length === 1 ? '' : 's'}.`;
      await refreshAfterWrite();
      autoAdvance(ids);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      working = false;
    }
  }

  async function clearLabel() {
    const ids = targets();
    const client = getClient();
    if (!client || !ids.length || working) return;
    working = true;
    try {
      await client.removeCurationLabels(ids);
      notice = `Cleared the current human label from ${ids.length} ROI${ids.length === 1 ? '' : 's'}; history was retained.`;
      await refreshAfterWrite();
      autoAdvance(ids);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      working = false;
    }
  }

  async function refreshAfterWrite() {
    const client = getClient();
    if (!client) return;
    labels = await client.listCurationLabels();
    await load();
  }

  function autoAdvance(previousTargets: string[]) {
    if (previousTargets.length !== 1) return;
    const index = items.findIndex((item) => item.id === previousTargets[0]);
    const next = items[index + 1];
    if (next) void focus(next.id);
  }

  async function createLabel() {
    const client = getClient();
    const name = newLabel.trim();
    if (!client || !name || working) return;
    working = true;
    try {
      const label = await client.createCurationLabel({ name, display_name: name });
      labels = [...labels, label].sort((a, b) => labelName(a).localeCompare(labelName(b)));
      newLabel = '';
      notice = `Created ${name}.`;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      working = false;
    }
  }

  async function runInference(selectedOnly: boolean) {
    const client = getClient();
    if (!client || !modelRef || working) return;
    const roiIds = selectedOnly ? targets() : [];
    if (selectedOnly && !roiIds.length) return;
    working = true;
    try {
      const response = await client.queueClassificationJob({ roi_ids: roiIds, model_ref: modelRef });
      notice = `Queued classification job ${response.job.id}. Evidence will appear as the worker completes.`;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      working = false;
    }
  }

  function keydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (target?.matches('input, select, textarea, [contenteditable="true"]')) return;
    if (event.key === 'Escape') {
      selected = new Set();
      return;
    }
    if (event.code === 'Space') {
      event.preventDefault();
      void review('verified');
      return;
    }
    if (event.key.toLowerCase() === 'f') {
      event.preventDefault();
      void review('needs_review');
      return;
    }
    if (/^[0-9]$/.test(event.key)) {
      const index = event.key === '0' ? 9 : Number(event.key) - 1;
      const label = labels[index];
      if (label) {
        event.preventDefault();
        void assign(label);
      }
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') moveFocus(1);
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') moveFocus(-1);
  }

  function moveFocus(direction: number) {
    if (!items.length) return;
    const index = Math.max(0, items.findIndex((item) => item.id === focusedId));
    const next = items[Math.min(items.length - 1, Math.max(0, index + direction))];
    if (next) void focus(next.id);
  }

  function updateFilters() {
    page = 0;
    void load();
  }

  function labelName(label: CurationLabel) {
    return label.display_name || label.name;
  }

  function classLabel(classIndex: number): string {
    const row = probabilityRows.find((value) => Number(value.class_index) === classIndex);
    return row?.label_name || `Class ${classIndex}`;
  }

  function percent(value: unknown): string {
    return typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
  }

  function similarity(value: unknown): string {
    return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : '—';
  }

  function imageUrl(item: CurationRoi): string {
    const client = getClient();
    return client && item.thumbnail_url ? client.resolveApiUrl(item.thumbnail_url) : '';
  }

  function consensusSummary(item: CurationRoi | null): string {
    if (!item?.evidence_id) return 'No model evidence';
    const votes = [item.predicted_class_index, item.prototype_class_index, item.knn_class_index]
      .filter((value) => value !== null && value !== undefined);
    if (votes.length < 2) return 'Partial evidence';
    return votes.every((value) => value === votes[0]) ? 'All evidence agrees' : 'Evidence disagreement';
  }
</script>

<div class="curation-workspace">
  <aside class="curation-rail panel">
    <div class="rail-heading"><p class="eyebrow">Review queue</p><h2>ROI curation</h2></div>
    <label>Human state<select bind:value={annotationState} on:change={updateFilters}><option value="all">All ROIs</option><option value="unlabeled">Unlabeled</option><option value="labeled">Labeled</option></select></label>
    <label>Review<select bind:value={reviewState} on:change={updateFilters}><option value="all">All states</option><option value="unreviewed">Unreviewed</option><option value="verified">Verified</option><option value="needs_review">Needs review</option><option value="rejected">Rejected</option></select></label>
    <label>Model evidence<select bind:value={evidenceState} on:change={updateFilters}><option value="all">All evidence states</option><option value="available">Evidence available</option><option value="missing">No evidence</option><option value="disagreement">Disagreement</option></select></label>
    <label>Sort<select bind:value={sortBy} on:change={updateFilters}><option value="oldest">Oldest first</option><option value="newest">Newest first</option><option value="confidence_asc">Lowest confidence</option><option value="confidence_desc">Highest confidence</option><option value="disagreement">Most disagreement</option><option value="area_asc">Smallest ROI</option><option value="area_desc">Largest ROI</option></select></label>
    <div class="search-row"><input bind:value={search} on:keydown={(event) => event.key === 'Enter' && updateFilters()} placeholder="Search ROI or asset" /><button on:click={updateFilters}>Go</button></div>

    <section class="label-tree"><div class="section-title"><h3>Labels</h3><button class:active={!labelId} on:click={() => { labelId=''; updateFilters(); }}>All</button></div>{#each labels as label,index}<button class:active={labelId===label.id} on:click={() => { labelId=label.id; updateFilters(); }}><span><kbd>{index < 9 ? index + 1 : index === 9 ? 0 : ''}</kbd>{labelName(label)}</span><em>{label.annotation_count || 0}<small>human</small> {label.prediction_count || 0}<small>ML</small></em></button>{/each}</section>
    <div class="new-label"><input bind:value={newLabel} on:keydown={(event) => event.key === 'Enter' && createLabel()} placeholder="New project label" /><button disabled={!newLabel.trim() || working} on:click={createLabel}>Add</button></div>

    <section class="inference-panel"><h3>Classification inference</h3><label>Oracle model<select bind:value={modelRef}>{#each options?.models ?? [] as model}<option value={model.alias}>{model.alias}</option>{/each}{#if modelRef && !(options?.models ?? []).some((model) => model.alias===modelRef)}<option value={modelRef}>{modelRef}</option>{/if}</select></label><small class:unavailable={options?.oracle.status !== 'ready'}>Oracle: {options?.oracle.status || 'unknown'}</small><div><button disabled={working || !targets().length} on:click={() => runInference(true)}>Run selected</button><button disabled={working} on:click={() => runInference(false)}>Run all</button></div></section>
  </aside>

  <main class="curation-gallery panel">
    <header><div><p class="eyebrow">Refined ROI workspace</p><h2>{total.toLocaleString()} curatable ROIs</h2></div><div><strong>{selected.size}</strong> selected <button on:click={() => selected=new Set(items.map((item)=>item.id))}>Select page</button><button on:click={() => selected=new Set()}>Clear</button></div></header>
    <div class="gallery-grid" aria-label="Curatable ROI gallery">{#each items as item (item.id)}<button class="roi-tile" class:selected={selected.has(item.id)} class:focused={focusedId===item.id} class:verified={item.review_decision==='verified'} class:needs-review={item.review_decision==='needs_review'} class:disagreement={consensusSummary(item)==='Evidence disagreement'} on:click={(event)=>choose(item,event)}><span class="roi-image">{#if imageUrl(item)}<img loading="lazy" src={imageUrl(item)} alt="ROI" />{/if}</span><span class="human-label">{item.label_display_name || 'Unlabeled'}</span>{#if item.evidence_id}<span class="prediction"><b>{item.predicted_label_name || 'Prediction'}</b><em>{percent(item.confidence)}</em></span>{/if}</button>{/each}{#if !loading && !items.length}<div class="empty">No refined ROIs match this queue.</div>{/if}</div>
    <footer><button disabled={page===0 || loading} on:click={() => {page--;load();}}>Previous</button><span>{total ? `${page*pageSize+1}–${Math.min(total,(page+1)*pageSize)} of ${total}` : '0 ROIs'}</span><button disabled={(page+1)*pageSize>=total || loading} on:click={() => {page++;load();}}>Next</button></footer>
  </main>

  <aside class="curation-inspector panel">
    <div class="inspector-heading"><p class="eyebrow">Focused ROI</p><h2>Inspector</h2></div>
    {#if detail}<img class="inspect-image" src={imageUrl(detail)} alt="Focused ROI" /><code>{detail.id}</code>
      <section><h3>Human ground truth</h3><strong class="current-label">{detail.label_display_name || 'Unlabeled'}</strong><p>{detail.review_decision ? detail.review_decision.replace('_',' ') : detail.annotation_id ? 'Unverified' : 'No assertion'}</p><div class="review-actions"><button disabled={!detail.annotation_id || working} on:click={()=>review('verified')}>✓ Verify</button><button disabled={!detail.annotation_id || working} on:click={()=>review('needs_review')}>⚑ Flag</button><button disabled={!detail.annotation_id || working} on:click={()=>review('rejected')}>× Reject</button></div><label>Assign label<select value="" on:change={(event)=>{const label=labels.find((value)=>value.id===(event.currentTarget as HTMLSelectElement).value);if(label)assign(label);(event.currentTarget as HTMLSelectElement).value='';}}><option value="">Choose project label…</option>{#each labels as label}<option value={label.id}>{labelName(label)}</option>{/each}</select></label><button class="clear-label" disabled={!detail.annotation_id || working} on:click={clearLabel}>Clear current label</button></section>

      <section class:warning={consensus==='Evidence disagreement'}><h3>Evidence consensus</h3><strong>{consensus}</strong>{#if detail.evidence_id}<p>Neural: {detail.predicted_label_name || classLabel(detail.predicted_class_index ?? -1)} · Prototype: {classLabel(detail.prototype_class_index ?? -1)} · KNN: {classLabel(detail.knn_class_index ?? -1)}</p><button class="primary" disabled={!detail.predicted_label_id || working} on:click={acceptPrediction}>Accept prediction as human label</button>{:else}<p>No classification run has produced evidence for this ROI.</p>{/if}</section>

      {#if currentEvidence}<section><h3>Neural probabilities</h3>{#each probabilityRows.slice().sort((a,b)=>b.probability-a.probability).slice(0,6) as row}<div class="evidence-bar"><span>{row.label_name || `Class ${row.class_index}`}</span><i><b style={`width:${Math.max(0,Math.min(100,row.probability*100))}%`}></b></i><em>{percent(row.probability)}</em></div>{/each}<dl><dt>Margin</dt><dd>{percent(currentEvidence.probability_margin)}</dd><dt>Entropy</dt><dd>{similarity(currentEvidence.entropy)}</dd></dl></section>
      <section><h3>Prototype similarity</h3>{#if prototypeRows.length}{#each prototypeRows.slice(0,5) as row}<div class="evidence-bar"><span>{row.label}</span><i><b style={`width:${Math.max(0,Math.min(100,(row.similarity+1)*50))}%`}></b></i><em>{similarity(row.similarity)}</em></div>{/each}<dl><dt>Margin</dt><dd>{similarity(currentEvidence.prototype_margin)}</dd></dl>{:else}<p>Prototype evidence unavailable for this model.</p>{/if}</section>
      <section><h3>KNN context</h3><dl><dt>Agreement</dt><dd>{percent(currentEvidence.knn_agreement)}</dd><dt>Weighted support</dt><dd>{percent(currentEvidence.knn_weighted_support)}</dd><dt>Margin</dt><dd>{percent(currentEvidence.knn_margin)}</dd></dl>{#if knnNeighbors.length}<div class="neighbor-list">{#each knnNeighbors as neighbor}<div><b>#{Number(neighbor.rank)+1}</b><span>{classLabel(Number(neighbor.class_index))}</span><em>{similarity(neighbor.similarity)}</em><code>{neighbor.exemplar_id}</code></div>{/each}</div><small>Oracle currently provides exemplar identity and similarity, but not deployable exemplar images.</small>{:else}<p>KNN evidence unavailable for this model.</p>{/if}</section>
      <section><h3>Provenance</h3><dl><dt>Model selector</dt><dd>{currentEvidence.model_selector}</dd><dt>Artifact</dt><dd>{currentEvidence.artifact_id || 'Unknown'}</dd><dt>Model run</dt><dd>{currentEvidence.model_run_id || 'Unknown'}</dd><dt>Inference run</dt><dd>{currentEvidence.inference_run_id}</dd></dl></section>{/if}

      <section><h3>Annotation history</h3>{#if detail.annotations?.length}{#each detail.annotations as annotation}<div class="history"><strong>{annotation.label_display_name}</strong><span>{annotation.actor_username} · {annotation.is_current ? 'current' : 'replaced'}</span></div>{/each}{:else}<p>No human annotation history.</p>{/if}</section>
    {:else}<div class="empty">Select an ROI to review its evidence and annotation history.</div>{/if}
  </aside>
</div>

{#if loading}<div class="loading-line"></div>{/if}
{#if error}<div class="toast error">{error}<button on:click={()=>error=null}>×</button></div>{/if}
{#if notice}<div class="toast notice">{notice}<button on:click={()=>notice=null}>×</button></div>{/if}

<style>
  .curation-workspace{display:grid;grid-template-columns:250px minmax(420px,1fr)330px;gap:12px;min-height:calc(100vh - 128px)}
  .panel{background:var(--surface,#fff);border:1px solid var(--border,#cbd5d9);border-radius:10px;min-width:0}
  .curation-rail,.curation-inspector{padding:14px;overflow:auto;max-height:calc(100vh - 128px)}
  .rail-heading h2,.inspector-heading h2,.curation-gallery h2{margin:0 0 12px}.eyebrow{margin:0;color:var(--muted,#667);font-size:10px;text-transform:uppercase;letter-spacing:.08em}
  label{display:grid;gap:4px;margin:9px 0;font-size:11px;font-weight:650;color:var(--muted,#667)}select,input,button{font:inherit}select,input{min-width:0;padding:7px;border:1px solid var(--border,#bac5ca);border-radius:5px;background:var(--surface,#fff);color:inherit}button{border:1px solid var(--border,#bac5ca);border-radius:5px;background:var(--surface,#fff);color:inherit;padding:6px 8px;cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}button.primary{background:var(--accent,#197997);color:#fff;border-color:var(--accent,#197997);width:100%}
  .search-row,.new-label{display:flex}.search-row input,.new-label input{flex:1}.search-row button,.new-label button{border-radius:0 5px 5px 0;margin-left:-1px}
  .label-tree{margin:15px -5px}.section-title{display:flex;align-items:center;justify-content:space-between;padding:0 5px}.label-tree h3,.inference-panel h3,.curation-inspector h3{margin:8px 0;font-size:12px}.label-tree>button{width:100%;border:0;border-bottom:1px solid var(--border,#dde4e6);border-radius:0;display:flex;justify-content:space-between;text-align:left;background:transparent}.label-tree>button.active{background:color-mix(in srgb,var(--accent,#197997) 14%,transparent)}.label-tree span{display:flex;align-items:center;gap:5px}.label-tree em{font-style:normal;font-size:10px}.label-tree small{color:var(--muted,#778)}kbd{font:9px ui-monospace;border:1px solid var(--border,#ccd);padding:1px 3px}
  .inference-panel{border-top:1px solid var(--border,#ccd);margin-top:16px;padding-top:8px}.inference-panel>div{display:flex}.inference-panel>div button{flex:1}.inference-panel small{display:block;margin:7px 0;color:#28724d}.inference-panel small.unavailable{color:#a14f3d}
  .curation-gallery{display:flex;flex-direction:column;min-height:0}.curation-gallery header,.curation-gallery footer{padding:12px;display:flex;align-items:center;justify-content:space-between;gap:10px}.curation-gallery header{border-bottom:1px solid var(--border,#ccd)}.curation-gallery footer{border-top:1px solid var(--border,#ccd)}
  .gallery-grid{padding:10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(135px,1fr));gap:8px;align-content:start;overflow:auto;flex:1}.roi-tile{position:relative;padding:4px;display:flex;flex-direction:column;text-align:left;min-height:175px;background:var(--surface,#fff);border:2px solid var(--border,#ccd)}.roi-tile.selected{border-color:var(--accent,#197997)}.roi-tile.focused{box-shadow:0 0 0 2px color-mix(in srgb,var(--accent,#197997) 25%,transparent)}.roi-tile.verified{border-bottom-color:#3f8b6c}.roi-tile.needs-review{border-bottom-color:#ba7b35}.roi-tile.disagreement:after{content:'!';position:absolute;top:6px;right:6px;width:19px;height:19px;display:grid;place-items:center;border-radius:50%;background:#ba6b35;color:white;font-weight:800}.roi-image{height:125px;display:grid;place-items:center;background:#162329;overflow:hidden}.roi-image img{max-width:100%;max-height:100%;object-fit:contain}.human-label{font-weight:700;padding:5px 2px 2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.prediction{display:flex;justify-content:space-between;color:var(--muted,#667);font-size:10px}.prediction b{font-weight:500;overflow:hidden;text-overflow:ellipsis}.prediction em{font-style:normal}
  .inspect-image{width:100%;max-height:230px;object-fit:contain;background:#162329;border-radius:6px}.curation-inspector>code{display:block;margin:5px 0 12px;overflow:hidden;text-overflow:ellipsis;font-size:9px}.curation-inspector section{border-top:1px solid var(--border,#ccd);padding:9px 0}.curation-inspector section.warning{border-left:4px solid #ba6b35;padding-left:8px}.current-label{font-size:18px}.review-actions{display:flex}.review-actions button{flex:1;padding:5px 2px}.evidence-bar{display:grid;grid-template-columns:minmax(80px,1fr)80px 45px;gap:5px;align-items:center;font-size:10px;margin:5px 0}.evidence-bar i{height:7px;background:var(--border,#d9e0e2);border-radius:4px;overflow:hidden}.evidence-bar i b{display:block;height:100%;background:var(--accent,#197997)}.evidence-bar em{text-align:right;font-style:normal}dl{display:grid;grid-template-columns:90px minmax(0,1fr);font-size:10px;margin:7px 0}dt{color:var(--muted,#667)}dd{margin:0;overflow-wrap:anywhere}.neighbor-list>div{display:grid;grid-template-columns:24px 1fr 42px;gap:4px;padding:4px 0;border-bottom:1px solid var(--border,#dde4e6);font-size:10px}.neighbor-list code{grid-column:2/4;overflow:hidden;text-overflow:ellipsis}.history{display:flex;justify-content:space-between;font-size:10px;padding:5px 0;border-bottom:1px solid var(--border,#dde4e6)}.empty{padding:25px;color:var(--muted,#667);text-align:center}
  .toast{position:fixed;right:20px;bottom:20px;z-index:10;padding:10px 12px;border-radius:6px;color:#fff;box-shadow:0 5px 20px #0004}.toast.error{background:#9b3d37}.toast.notice{background:#286f55}.toast button{border:0;background:transparent;color:inherit}.loading-line{position:fixed;left:0;right:0;top:0;height:3px;background:var(--accent,#197997);z-index:20}
  @media(max-width:1050px){.curation-workspace{grid-template-columns:220px 1fr}.curation-inspector{grid-column:1/-1;max-height:none}}@media(max-width:700px){.curation-workspace{display:block}.curation-rail,.curation-gallery,.curation-inspector{margin-bottom:10px;max-height:none}.gallery-grid{max-height:65vh}}
</style>
