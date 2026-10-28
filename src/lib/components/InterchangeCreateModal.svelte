<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import FileSelector from '$lib/components/FileSelector.svelte';
  import { getClient } from '$lib/stores/session';
  import { queueStatus } from '$lib/stores/queueStatus';
  import type { Job } from '$lib/api/types';
  export let initialSource = '';
  const dispatch = createEventDispatcher();
  let source = initialSource;
  let outputParent = '';
  let outputName = '';
  let browserTarget: 'source' | 'output' | null = null;
  let browserPath = '.';
  let browserSelection: string[] = [];
  $: output = outputParent && outputName.trim()
    ? `${outputParent.replace(/\/+$/, '')}/${outputName.trim()}` : '';
  $: validOutputName = !!outputName.trim() && !['.', '..'].includes(outputName.trim()) && !/[\\/]/.test(outputName.trim());

  async function loadDirectory(path: string) {
    const client = getClient();
    if (!client) throw new Error('Connect to a Pelagia server before browsing folders.');
    return client.listRawDirectory(path);
  }
  function browse(target: 'source' | 'output') {
    browserTarget = target;
    browserPath = (target === 'source' ? source : outputParent) || '.';
    browserSelection = [];
  }
  function useFolder() {
    const chosen = browserSelection[0] || browserPath;
    if (browserTarget === 'source') source = chosen;
    else outputParent = chosen;
    browserTarget = null;
  }
  let title = '';
  let stream = 'camera';
  let shardSize = '10GB';
  let quality = 90;
  let subsampling = '444';
  let recursive = false;
  let grayscale = false;
  let boundary = false;
  let previews = true;
  let busy = false;
  let error = '';
  let job: Job | null = null;
  let stop: (() => void) | undefined;
  onDestroy(() => stop?.());
  async function submit() {
    const client = getClient();
    if (!client) { error = 'Connect to a Pelagia server first.'; return; }
    busy = true; error = '';
    try {
      const response = await client.post<{ job: Job }>('/ingestion/interchange', {
        source_path: source.trim(), output_path: output.trim(), title: title.trim() || null,
        stream: stream.trim(), shard_target_size: shardSize.trim(), jpeg_quality: quality,
        jpeg_subsampling: subsampling, recursive, grayscale, source_file_boundary: boundary,
        generate_previews: previews
      });
      job = response.job;
      stop = queueStatus({ ids: [job.id], job_limit: 1 }).subscribe((state) => {
        job = state.snapshot?.jobs.items.find((item) => item.id === response.job.id) ?? job;
        if (state.error) error = `Status update failed: ${state.error}`;
      });
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    finally { busy = false; }
  }
</script>

<div class="backdrop" role="presentation">
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="interchange-title">
    <header><h2 id="interchange-title">Create interchange dataset</h2><button type="button" aria-label="Close" on:click={() => dispatch('close')}>×</button></header>
    <p>Archive videos on the server as a PII dataset. Once complete, select the output directory in the raw asset browser to import it.</p>
    <div class="fields">
      <div class="folder-field"><label for="source-folder">Video directory on server</label><div class="folder-row"><input id="source-folder" value={source} readonly placeholder="Choose a folder" /><button type="button" disabled={!!job} on:click={() => browse('source')}>Browse…</button></div></div>
      <div class="folder-field"><label for="output-parent">Output parent folder on server</label><div class="folder-row"><input id="output-parent" value={outputParent} readonly placeholder="Choose a folder" /><button type="button" disabled={!!job} on:click={() => browse('output')}>Browse…</button></div><small>Choose a folder outside the video directory.</small></div>
      <label>New dataset folder name<input bind:value={outputName} disabled={!!job} placeholder="e.g. deployment_interchange" /><small>A new folder will be created inside the output parent.</small></label>
      <label>Dataset title (optional)<input bind:value={title} disabled={!!job} /></label>
      <label>Stream name<input bind:value={stream} disabled={!!job} /></label>
      <label>Shard target size<input bind:value={shardSize} disabled={!!job} /></label>
      <label>JPEG quality<input type="number" min="1" max="100" bind:value={quality} disabled={!!job} /></label>
      <label>JPEG subsampling<select bind:value={subsampling} disabled={!!job}><option value="444">4:4:4</option><option value="422">4:2:2</option><option value="420">4:2:0</option></select></label>
      <div class="checks"><label><input type="checkbox" bind:checked={recursive} disabled={!!job} /> Include subdirectories</label><label><input type="checkbox" bind:checked={grayscale} disabled={!!job} /> Grayscale</label><label><input type="checkbox" bind:checked={boundary} disabled={!!job} /> Start a shard at each source file</label><label><input type="checkbox" bind:checked={previews} disabled={!!job} /> Generate previews</label></div>
    </div>
    {#if browserTarget}
      <section class="folder-browser" aria-label={browserTarget === 'source' ? 'Choose video directory' : 'Choose output parent folder'}>
        <h3>{browserTarget === 'source' ? 'Choose video directory' : 'Choose output parent folder'}</h3>
        <p>Open a folder or select one, then choose it below.</p>
        <FileSelector mode="wizard" multiSelect={false} selectableKinds={['directory']} initialPath={browserPath}
          selectedPaths={browserSelection} {loadDirectory}
          onPathChange={(path) => { browserPath = path; browserSelection = []; }}
          onSelectionChange={(paths) => browserSelection = paths} label="Server folders" />
        <div class="browser-actions"><span>Folder: {browserSelection[0] || browserPath}</span><button type="button" on:click={() => browserTarget = null}>Cancel</button><button type="button" disabled={(browserSelection[0] || browserPath) === '.'} on:click={useFolder}>Use folder</button></div>
      </section>
    {/if}
    {#if job}<p role="status"><strong>{job.status}</strong> — {job.progress?.message || job.summary || 'Queued'}{#if job.error_message}: {job.error_message}{/if}{#if job.status === 'succeeded'}<br />Dataset ready at {output}.{/if}</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <footer><button type="button" on:click={() => dispatch('close')}>Close</button><button type="button" disabled={busy || !!job || !source.trim() || !output.trim() || !validOutputName || !!browserTarget || !stream.trim() || !shardSize.trim() || !quality || quality < 1 || quality > 100} on:click={submit}>{busy ? 'Queueing…' : 'Create dataset'}</button></footer>
  </div>
</div>
<style>
  .backdrop{position:fixed;inset:0;z-index:1000;background:#0008;display:flex;align-items:center;justify-content:center;padding:1rem}.dialog{background:var(--surface,#fff);color:var(--text,#172c30);border-radius:12px;padding:1.25rem;width:min(680px,100%);max-height:90vh;overflow:auto;box-shadow:0 16px 50px #0004}header,footer{display:flex;align-items:center;justify-content:space-between;gap:1rem}h2{margin:0}.fields{display:grid;grid-template-columns:1fr 1fr;gap:.8rem;margin:1rem 0}.fields>label{display:grid;gap:.3rem}.folder-field,.checks{grid-column:1/-1}.folder-field{display:grid;gap:.3rem}.folder-row{display:flex;gap:.5rem}.folder-row input{flex:1;min-width:0}.folder-row button{white-space:nowrap}.folder-browser{border:1px solid var(--border,#d9e1e3);border-radius:8px;padding:1rem;margin:1rem 0}.folder-browser h3{margin:0}.browser-actions{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin-top:.75rem}.browser-actions span{flex:1;overflow-wrap:anywhere}input:not([type=checkbox]),select{width:100%;padding:.5rem}.checks{display:flex;gap:.8rem;flex-wrap:wrap}.checks label{display:flex;gap:.3rem;align-items:center}small{color:var(--muted,#66777b)}.error{color:#b44343}footer{justify-content:flex-end}@media(max-width:550px){.fields{grid-template-columns:1fr}}
</style>
