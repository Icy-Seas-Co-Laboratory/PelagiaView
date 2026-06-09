<script lang="ts">
  import { copyImagePng, downloadImagePng, type ImageOverlayRect } from '$lib/utils/imageExport';

  export let imageUrl = '';
  export let filename = 'pelagia-image.png';
  export let annotatedFilename = 'pelagia-image-annotated.png';
  export let overlays: ImageOverlayRect[] = [];
  export let inverted = false;
  export let disabled = false;
  export let floating = false;
  export let exportRoot: HTMLElement | null = null;
  export let overlaySelectors: Array<{
    selector: string;
    stroke: string;
    lineWidth?: number;
    halo?: string;
  }> = [];

  let busy = false;
  let status: string | null = null;

  $: isDisabled = disabled || busy || !imageUrl;
  $: hasOverlaySource = overlays.length > 0 || overlaySelectors.length > 0;
  $: exportFilename = hasOverlaySource ? annotatedFilename : filename;

  async function runExport(action: 'download' | 'copy') {
    busy = true;
    status = null;
    const effectiveOverlays = domOverlays() ?? overlays;
    const options = {
      imageUrl,
      filename: exportFilename,
      overlays: effectiveOverlays,
      inverted
    };
    try {
      if (action === 'download') {
        await downloadImagePng(options);
        status = effectiveOverlays.length ? 'Downloaded boxed PNG.' : 'Downloaded PNG without boxes.';
      } else {
        await copyImagePng(options);
        status = effectiveOverlays.length ? 'Copied boxed PNG.' : 'Copied PNG without boxes.';
      }
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
    }
  }

  function domOverlays(): ImageOverlayRect[] | null {
    if (!exportRoot || !overlaySelectors.length) return null;
    const image = exportRoot.querySelector('img');
    if (!image) return null;
    const imageRect = image.getBoundingClientRect();
    const scaleX = image.naturalWidth / Math.max(imageRect.width, 1);
    const scaleY = image.naturalHeight / Math.max(imageRect.height, 1);
    const rects: ImageOverlayRect[] = [];

    for (const spec of overlaySelectors) {
      for (const element of exportRoot.querySelectorAll(spec.selector)) {
        const rect = element.getBoundingClientRect();
        rects.push({
          x: (rect.left - imageRect.left) * scaleX,
          y: (rect.top - imageRect.top) * scaleY,
          w: rect.width * scaleX,
          h: rect.height * scaleY,
          stroke: spec.stroke,
          lineWidth: spec.lineWidth,
          halo: spec.halo
        });
      }
    }

    return rects.filter((rect) => rect.w > 0 && rect.h > 0);
  }
</script>

<div class="image-export-actions" class:image-export-floating={floating} aria-label="Image export actions">
  <button class="ghost" type="button" disabled={isDisabled} on:click={() => runExport('download')}>
    Download PNG
  </button>
  <button class="ghost" type="button" disabled={isDisabled} on:click={() => runExport('copy')}>
    Copy PNG
  </button>
  {#if status}<span class="soft">{status}</span>{/if}
</div>
