<script lang="ts">
  import Konva from 'konva';
  import { onDestroy, onMount } from 'svelte';
  import { authenticatedFetch } from '$lib/api/client';
  import type { SpatialBox } from './types';

  export let open = false;
  export let itemId = '';
  export let imageUrl = '';
  export let candidateMaskUrl: string | null = null;
  export let currentMaskUrl: string | null = null;
  export let bbox: SpatialBox | null = null; // Coordinates relative to the stored crop.
  export let invert = false;
  export let onClose: () => void = () => {};
  export let onSaveGeometry: ((bbox: SpatialBox) => Promise<void>) | null = null;
  export let onSaveMask: ((pngDataUrl: string) => Promise<void>) | null = null;

  let host: HTMLDivElement;
  let dialog: HTMLDivElement;
  let focusedOnOpen = false;
  let stage: Konva.Stage | null = null;
  let layer: Konva.Layer | null = null;
  let imageGroup: Konva.Group | null = null;
  let imageNode: Konva.Image | null = null;
  let maskNode: Konva.Image | null = null;
  let candidateNode: Konva.Image | null = null;
  let candidateMask: HTMLCanvasElement | null = null;
  let currentMask: HTMLCanvasElement | null = null;
  let boxGroup: Konva.Group | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let serial = 0;
  let sourceWidth = 0;
  let sourceHeight = 0;
  let localBox: SpatialBox | null = null;
  let originalBox: SpatialBox | null = null;
  let editMode = false;
  let tool: 'pan' | 'box' | 'line' | 'area' | 'erase' = 'pan';
  let showCandidate = false;
  let showCurrent = true;
  let working = false;
  let error = '';
  let measurements: Array<{ kind: 'line' | 'area'; points: number[]; label: string }> = [];
  let draftPoints: number[] = [];
  let measureNode: Konva.Line | null = null;
  let eraseHistory: ImageData[] = [];
  let boxHistory: SpatialBox[] = [];
  let editableMask: HTMLCanvasElement | null = null;
  let activeMaskUrl = '';
  let maskAnnotationId: string | null = null;
  let lastRenderKey = '';
  const brushRadius = 12;

  $: maskKey = `${candidateMaskUrl ?? ''}|${currentMaskUrl ?? ''}`;
  $: if (open && maskKey !== activeMaskUrl) void loadMasks();
  $: renderKey = `${open ? 'open' : 'closed'}|${itemId}|${imageUrl}`;
  $: if (open && imageUrl && renderKey !== lastRenderKey) { lastRenderKey = renderKey; void renderImage(); }
  $: if (imageNode) { invert; applyImageInversion(); }
  $: if (open && bbox && (!originalBox || itemId !== lastItemId)) resetBox();
  $: if (open && dialog && !focusedOnOpen) { focusedOnOpen = true; requestAnimationFrame(() => dialog?.focus()); }
  $: if (!open) focusedOnOpen = false;
  let lastItemId = '';

  onMount(() => {
    resizeObserver = new ResizeObserver(() => fitStage());
    if (host) resizeObserver.observe(host);
  });
  onDestroy(() => { resizeObserver?.disconnect(); destroyStage(); });

  function resetBox() {
    lastItemId = itemId;
    localBox = bbox ? { ...bbox } : null;
    originalBox = bbox ? { ...bbox } : null;
    measurements = [];
    draftPoints = [];
    eraseHistory = [];
  }
  function trapFocus(event: KeyboardEvent) {
    if (event.key !== 'Tab' || !dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const current = document.activeElement as HTMLElement;
    const index = focusable.indexOf(current);
    if (event.shiftKey && (index <= 0 || current === dialog)) { event.preventDefault(); focusable.at(-1)?.focus(); }
    else if (!event.shiftKey && index === focusable.length - 1) { event.preventDefault(); focusable[0].focus(); }
  }

  function destroyStage() {
    stage?.destroy(); stage = null; layer = null; imageGroup = null; imageNode = null; maskNode = null; candidateNode = null; boxGroup = null;
  }

  async function elementFor(url: string): Promise<HTMLImageElement> {
    const response = await authenticatedFetch(url);
    if (!response.ok) throw new Error(`Unable to load ROI image (${response.status})`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      return await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Unable to decode ROI image'));
        image.src = objectUrl;
      });
    } finally { URL.revokeObjectURL(objectUrl); }
  }

  async function renderImage() {
    const renderId = ++serial;
    try {
      const image = await elementFor(imageUrl);
      if (renderId !== serial || !open) return;
      sourceWidth = image.naturalWidth; sourceHeight = image.naturalHeight;
      destroyStage();
      stage = new Konva.Stage({ container: host, width: Math.max(host.clientWidth, 1), height: Math.max(host.clientHeight, 1) });
      layer = new Konva.Layer(); stage.add(layer);
      imageGroup = new Konva.Group({ draggable: tool === 'pan' }); layer.add(imageGroup);
      imageNode = new Konva.Image({ image, width: sourceWidth, height: sourceHeight, listening: true });
      applyImageInversion();
      imageGroup.add(imageNode);
      imageGroup.on('wheel', (event) => { event.evt.preventDefault(); zoomAt(event.evt.offsetX, event.evt.offsetY, event.evt.deltaY > 0 ? 0.8 : 1.25); });
      imageGroup.on('pointerdown', startPointer);
      imageGroup.on('pointermove', movePointer);
      imageGroup.on('pointerup pointerleave', finishPointer);
      fitStage();
      await loadMasks();
      redraw();
    } catch (reason) { error = reason instanceof Error ? reason.message : String(reason); }
  }

  function applyImageInversion() {
    if (!imageNode) return;
    // Inversion is a rendering preference only.  The mask canvas and saved
    // payload remain unchanged, so ROI segmentation semantics never flip.
    imageNode.clearCache();
    if (invert) { imageNode.cache(); imageNode.filters([Konva.Filters.Invert]); }
    else imageNode.filters([]);
    layer?.batchDraw();
  }

  async function maskCanvas(url: string): Promise<HTMLCanvasElement> {
    const image = await elementFor(url);
    const canvas = document.createElement('canvas'); canvas.width = sourceWidth; canvas.height = sourceHeight;
    const context = canvas.getContext('2d'); context?.drawImage(image, 0, 0, sourceWidth, sourceHeight);
    return canvas;
  }
  function copyMask(source: HTMLCanvasElement | null): HTMLCanvasElement | null {
    if (!source) return null;
    const copy = document.createElement('canvas'); copy.width = sourceWidth; copy.height = sourceHeight;
    copy.getContext('2d')?.drawImage(source, 0, 0);
    return copy;
  }
  async function loadMasks() {
    const key = `${candidateMaskUrl ?? ''}|${currentMaskUrl ?? ''}`; activeMaskUrl = key;
    if (!imageGroup) return;
    try {
      const [candidate, current] = await Promise.all([candidateMaskUrl ? maskCanvas(candidateMaskUrl) : Promise.resolve(null), currentMaskUrl ? maskCanvas(currentMaskUrl) : Promise.resolve(null)]);
      if (!open || key !== activeMaskUrl || !imageGroup) return;
      candidateMask = candidate; currentMask = current;
      // A candidate mask remains an immutable display layer.  When no current
      // revision exists, editing works on a private copy and Save creates the
      // first current annotation with expected_current_annotation_id=null.
      editableMask = currentMask ?? copyMask(candidateMask);
      updateMaskNode();
    } catch (reason) { error = reason instanceof Error ? reason.message : String(reason); }
  }

  function tintedCanvas(source: HTMLCanvasElement, color: [number, number, number]) {
    const tinted=document.createElement('canvas'); tinted.width=sourceWidth;tinted.height=sourceHeight;const target=tinted.getContext('2d');const mask=source.getContext('2d');
    if(target&&mask){const data=mask.getImageData(0,0,sourceWidth,sourceHeight);for(let i=0;i<data.data.length;i+=4){const strength=data.data[i+3]?data.data[i]/255:0;data.data[i]=color[0];data.data[i+1]=color[1];data.data[i+2]=color[2];data.data[i+3]=Math.round(strength*130);}target.putImageData(data,0,0);} return tinted;
  }
  function updateMaskNode() {
    if (!imageGroup) return;
    maskNode?.destroy();candidateNode?.destroy();maskNode=null;candidateNode=null;
    if (candidateMask && showCandidate) { candidateNode=new Konva.Image({image:tintedCanvas(candidateMask,[48,160,255]),width:sourceWidth,height:sourceHeight,listening:false});imageGroup.add(candidateNode); }
    if (editableMask && showCurrent) { maskNode=new Konva.Image({image:tintedCanvas(editableMask,[255,42,42]),width:sourceWidth,height:sourceHeight,listening:false});imageGroup.add(maskNode); }
    redraw();
  }

  function fitStage() {
    if (!stage || !imageGroup || !sourceWidth || !sourceHeight) return;
    const width = Math.max(host.clientWidth, 1), height = Math.max(host.clientHeight, 1);
    stage.size({ width, height });
    const scale = Math.min(width / sourceWidth, height / sourceHeight) * 0.92;
    imageGroup.scale({ x: scale, y: scale });
    imageGroup.position({ x: (width-sourceWidth*scale)/2, y: (height-sourceHeight*scale)/2 });
    redraw();
  }

  function zoomAt(x: number, y: number, multiplier: number) {
    if (!stage || !imageGroup) return;
    const old = imageGroup.scaleX(), next = Math.max(0.05, Math.min(16, old * multiplier));
    const point = { x: (x-imageGroup.x())/old, y: (y-imageGroup.y())/old };
    imageGroup.scale({x:next,y:next}); imageGroup.position({x:x-point.x*next,y:y-point.y*next}); redraw();
  }
  function zoom(multiplier: number) { if (stage) zoomAt(stage.width()/2, stage.height()/2, multiplier); }

  function imagePoint(): { x:number; y:number } | null {
    const pointer=stage?.getPointerPosition(); if (!pointer || !imageGroup) return null;
    const point=imageGroup.getAbsoluteTransform().copy().invert().point(pointer);
    return {x:Math.max(0,Math.min(sourceWidth,point.x)),y:Math.max(0,Math.min(sourceHeight,point.y))};
  }
  let dragging = false;
  let lastErasePoint: { x: number; y: number } | null = null;
  function startPointer() {
    if ((tool === 'erase' || tool === 'box') && !editMode || tool === 'pan') return;
    const point=imagePoint(); if (!point) return;
    if (tool === 'erase') { if (!editableMask) return; saveMaskHistory(); dragging=true; lastErasePoint=null; eraseAt(point); return; }
    if (tool === 'line') { draftPoints=[point.x,point.y,point.x,point.y]; dragging=true; redraw(); return; }
    if (tool === 'area') { draftPoints=[...draftPoints,point.x,point.y]; redraw(); }
  }
  function movePointer() {
    const point=imagePoint(); if (!point || ((tool === 'erase' || tool === 'box') && !editMode)) return;
    if (tool === 'erase' && dragging) eraseAt(point);
    if (tool === 'line' && dragging && draftPoints.length===4) { draftPoints[2]=point.x;draftPoints[3]=point.y;redraw(); }
    if (tool === 'area' && draftPoints.length>=2) { redraw(point); }
  }
  function finishPointer() {
    if (tool === 'erase') { dragging=false; lastErasePoint=null; }
    if (tool === 'line' && dragging && draftPoints.length===4) { measurements=[...measurements,{kind:'line',points:[...draftPoints],label:lineLabel(draftPoints)}];draftPoints=[];dragging=false;redraw(); }
  }
  function finishArea() { if (draftPoints.length>=6) { measurements=[...measurements,{kind:'area',points:[...draftPoints],label:areaLabel(draftPoints)}]; draftPoints=[]; redraw(); } }
  function eraseAt(point: {x:number;y:number}) { const c=editableMask?.getContext('2d'); if (!c) return; c.save();c.globalCompositeOperation='source-over';c.strokeStyle='#000';c.fillStyle='#000';c.lineWidth=brushRadius*2;c.lineCap='round';c.beginPath();if(lastErasePoint){c.moveTo(lastErasePoint.x,lastErasePoint.y);c.lineTo(point.x,point.y);c.stroke();}else{c.arc(point.x,point.y,brushRadius,0,Math.PI*2);c.fill();}c.restore();lastErasePoint=point;updateMaskNode(); }
  function saveMaskHistory() { const c=editableMask?.getContext('2d'); if (!c || eraseHistory.length>20) return; eraseHistory=[...eraseHistory,c.getImageData(0,0,sourceWidth,sourceHeight)]; }
  function undoMask() { const last=eraseHistory.pop(); const c=editableMask?.getContext('2d'); if(last&&c){c.putImageData(last,0,0);eraseHistory=[...eraseHistory];updateMaskNode();} }

  function redraw(pointer?: {x:number;y:number}) {
    if (!imageGroup || !layer) return;
    imageNode?.moveToBottom(); if (maskNode) maskNode.moveToTop();
    boxGroup?.destroy(); boxGroup = new Konva.Group(); imageGroup.add(boxGroup); boxGroup.moveToTop();
    if (localBox) drawBox(localBox);
    for (const measurement of measurements) drawMeasurement(measurement.points, measurement.kind, measurement.label);
    if (draftPoints.length) drawMeasurement(pointer ? [...draftPoints,pointer.x,pointer.y] : draftPoints, tool === 'area' ? 'area':'line', tool === 'area' ? 'click to close':'');
    drawScaleBar(); layer.batchDraw();
  }
  function drawBox(box: SpatialBox) {
    if (!boxGroup) return;
    const group=boxGroup;
    group.add(new Konva.Rect({x:box.x,y:box.y,width:box.w,height:box.h,stroke:'#fff',strokeWidth:5/Math.max(imageGroup?.scaleX()??1,0.1),listening:false}));
    const rect=new Konva.Rect({x:box.x,y:box.y,width:box.w,height:box.h,stroke:'#ef2424',strokeWidth:2/Math.max(imageGroup?.scaleX()??1,0.1),listening:editMode});group.add(rect);
    if (!editMode || tool !== 'box') return;
    const transformer=new Konva.Transformer({nodes:[rect],enabledAnchors:['top-left','top-center','top-right','middle-left','middle-right','bottom-left','bottom-center','bottom-right'],rotateEnabled:false,borderEnabled:false,anchorSize:10/Math.max(imageGroup?.scaleX()??1,0.1),anchorFill:'#ef2424',anchorStroke:'#fff',keepRatio:false});
    transformer.on('transformstart',()=>{if(localBox)boxHistory=[...boxHistory,{...localBox}];});
    transformer.on('transformend',()=>{ const node=rect;localBox=clamped({x:node.x(),y:node.y(),w:node.width()*node.scaleX(),h:node.height()*node.scaleY()});redraw(); }); group.add(transformer);
  }
  function clamped(box: SpatialBox): SpatialBox { const x=Math.max(0,Math.min(sourceWidth-1,box.x));const y=Math.max(0,Math.min(sourceHeight-1,box.y));return{x,y,w:Math.max(1,Math.min(sourceWidth-x,box.w)),h:Math.max(1,Math.min(sourceHeight-y,box.h))}; }
  function drawMeasurement(points:number[],kind:'line'|'area',label:string) { if (!boxGroup || points.length<4) return; const closed=kind==='area'&&points.length>=6;boxGroup.add(new Konva.Line({points,closed,stroke:'#f8d34a',fill:closed?'rgba(248,211,74,.18)':undefined,strokeWidth:2/Math.max(imageGroup?.scaleX()??1,.1),listening:false})); if(label){const x=points[0],y=points[1];boxGroup.add(new Konva.Text({x,y:y-18/(imageGroup?.scaleX()??1),text:label,fill:'#f8d34a',fontSize:13/(imageGroup?.scaleX()??1),listening:false}));} }
  function drawScaleBar() { if(!boxGroup||!sourceWidth||!sourceHeight)return;const length=sourceWidth>1000?500:sourceWidth>500?100:sourceWidth>100?50:10;const x=12,y=sourceHeight-16,s=1/(imageGroup?.scaleX()??1);boxGroup.add(new Konva.Line({points:[x,y,x+length,y],stroke:'#000',strokeWidth:6*s,listening:false}),new Konva.Line({points:[x,y,x+length,y],stroke:'#fff',strokeWidth:3*s,listening:false}),new Konva.Text({x,y:y+5*s,text:`${length} px`,fill:'#fff',fontSize:12*s,listening:false})); }
  function lineLabel(points:number[]) { return `${Math.round(Math.hypot(points[2]-points[0],points[3]-points[1]))} px`; }
  function areaLabel(points:number[]) { let sum=0;for(let i=0;i<points.length;i+=2){const j=(i+2)%points.length;sum+=points[i]*points[j+1]-points[j]*points[i+1];}return `${Math.round(Math.abs(sum)/2).toLocaleString()} px²`; }
  function setTool(next: typeof tool) { tool=next; if(imageGroup) imageGroup.draggable(next==='pan'); if(next!=='area') draftPoints=[]; redraw(); }
  async function saveGeometry() { if(!onSaveGeometry||!localBox||JSON.stringify(localBox)===JSON.stringify(originalBox))return; error='';working=true;try{await onSaveGeometry(localBox);originalBox={...localBox};}catch(reason){error=reason instanceof Error?reason.message:String(reason);}finally{working=false;} }
  function binaryMaskPng() { const canvas=document.createElement('canvas');canvas.width=sourceWidth;canvas.height=sourceHeight;const context=canvas.getContext('2d')!;const source=editableMask?.getContext('2d')?.getImageData(0,0,sourceWidth,sourceHeight);if(source){for(let i=0;i<source.data.length;i+=4){const value=(source.data[i]+source.data[i+1]+source.data[i+2])/3>=128?255:0;source.data[i]=value;source.data[i+1]=value;source.data[i+2]=value;source.data[i+3]=255;}context.putImageData(source,0,0);}return canvas.toDataURL('image/png'); }
  async function saveMask() { if(!onSaveMask||!editableMask||!eraseHistory.length)return; error='';working=true;try{await onSaveMask(binaryMaskPng());eraseHistory=[];}catch(reason){error=reason instanceof Error?reason.message:String(reason);}finally{working=false;} }
  function undoBox() { const previous=boxHistory.pop();if(previous){localBox=previous;boxHistory=[...boxHistory];redraw();} }
  function cancel() { localBox=originalBox?{...originalBox}:null; eraseHistory=[]; void loadMasks(); editMode=false; redraw(); }
</script>

<svelte:window on:keydown={(event) => { if (open && event.key === 'Escape') onClose(); }} />
{#if open}
  <div class="roi-backdrop" role="presentation" on:click|self={onClose}>
    <div bind:this={dialog} tabindex="-1" class="roi-modal" role="dialog" aria-modal="true" aria-label="ROI viewer" on:keydown={trapFocus}>
      <header><div><strong>ROI viewer</strong><small>{itemId}</small></div><div class="tools"><button title="Fit image" on:click={fitStage}>Fit</button><button title="Zoom out" on:click={()=>zoom(.8)}>−</button><button title="Zoom in" on:click={()=>zoom(1.25)}>+</button><button class:active={tool==='pan'} on:click={()=>setTool('pan')}>Pan</button><button class:active={tool==='line'} on:click={()=>setTool('line')}>Measure</button><button class:active={tool==='area'} on:click={()=>setTool('area')}>Area</button>{#if tool==='area'&&draftPoints.length>=6}<button on:click={finishArea}>Finish area</button>{/if}<button class:active={editMode} on:click={()=>{editMode=!editMode;setTool('box')}}>Edit</button>{#if editMode}<button class:active={tool==='box'} on:click={()=>setTool('box')}>Box</button><button class:active={tool==='erase'} disabled={!editableMask} on:click={()=>setTool('erase')}>Erase mask</button>{/if}<button class="close" aria-label="Close ROI viewer" on:click={onClose}>×</button></div></header>
      <div class="roi-body"><div bind:this={host} class:erase-cursor={editMode&&tool==='erase'} class="roi-stage"></div><aside><h3>Layers</h3><label><input type="checkbox" bind:checked={showCandidate} on:change={updateMaskNode} /> Candidate mask</label><label><input type="checkbox" bind:checked={showCurrent} on:change={updateMaskNode} /> Edited mask</label><p>Red: object bounding box</p><p>Yellow: measurements</p>{#if tool==='erase'&&!editableMask}<p class="muted">No stored mask is available to edit.</p>{/if}</aside></div>
      <footer>{#if error}<p class="error">{error}</p>{/if}<span>{localBox ? `Box ${Math.round(localBox.x)}, ${Math.round(localBox.y)} · ${Math.round(localBox.w)} × ${Math.round(localBox.h)} px` : 'No bounding box'}</span><div>{#if editMode}<button on:click={undoBox} disabled={!boxHistory.length}>Undo box</button><button on:click={undoMask} disabled={!eraseHistory.length}>Undo erase</button><button on:click={cancel} disabled={working}>Cancel</button><button class="primary" on:click={saveGeometry} disabled={working||!boxHistory.length}>Save box</button><button class="primary" on:click={saveMask} disabled={working||!eraseHistory.length}>Save mask</button>{/if}</div></footer>
    </div>
  </div>
{/if}

<style>
  .roi-backdrop{position:fixed;z-index:1000;inset:0;background:rgba(4,12,15,.78);display:grid;place-items:center;padding:2.5vh 2.5vw}.roi-modal{width:95vw;height:95vh;background:#132126;color:#edf4f2;border:1px solid #557078;border-radius:8px;display:grid;grid-template-rows:auto 1fr auto;overflow:hidden}.roi-modal header,.roi-modal footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;background:#1a2c32}.roi-modal header small{display:block;color:#b7c8cc;font:11px ui-monospace,monospace}.tools{display:flex;align-items:center;flex-wrap:wrap;justify-content:flex-end;gap:5px}.tools button,.roi-modal footer button{padding:5px 8px;border:1px solid #587078;background:#213940;color:inherit;border-radius:4px}.tools button.active,.roi-modal button.primary{background:#386675;border-color:#71b7c7}.tools .close{font-size:20px;padding:0 8px}.roi-body{min-height:0;display:grid;grid-template-columns:minmax(0,1fr) 175px}.roi-stage{min-width:0;min-height:0;background:#050807;overflow:hidden}.erase-cursor{cursor:crosshair}.roi-body aside{padding:14px;border-left:1px solid #40575e;background:#17272c;font-size:13px}.roi-body aside h3{margin:0 0 10px}.roi-body aside label{display:block;margin:8px 0}.roi-body aside p{color:#bbcccf;line-height:1.35}.roi-modal footer{font-size:12px;color:#bed1d4}.roi-modal footer>div{display:flex;gap:7px}.error{color:#ffaaaa;margin:0}.muted{color:#9fb4b9}@media(max-width:760px){.roi-modal{width:100vw;height:100vh;border-radius:0}.roi-body{grid-template-columns:1fr}.roi-body aside{display:none}.tools{gap:3px}.tools button{padding:4px 5px}}
</style>
