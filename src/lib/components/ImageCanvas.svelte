<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    copyImagePng,
    downloadImagePng,
    type ImageOverlayMask,
    type ImageOverlayRect
  } from '$lib/utils/imageExport';
  import { recordClientEvent } from '$lib/utils/analytics';
  import type {
    CanvasExportControls,
    CanvasOverlayImage,
    CanvasOverlayRect,
    CanvasScaleBar
  } from '$lib/utils/imageCanvas';

  export let imageUrl = '';
  export let alt = '';
  export let filename = 'pelagia-image.png';
  export let annotatedFilename = 'pelagia-image-boxed.png';
  export let imageMaskUrl = '';
  export let applyImageMask = false;
  export let overlays: CanvasOverlayRect[] = [];
  export let imageOverlays: CanvasOverlayImage[] = [];
  export let inverted = false;
  export let disabled = false;
  export let sourceWidth: number | null = null;
  export let sourceHeight: number | null = null;
  export let canvasStyle = '';
  export let imageClass = '';
  export let loading: 'eager' | 'lazy' = 'eager';
  export let exportControls: CanvasExportControls = 'full';
  export let scaleBar: CanvasScaleBar | null = null;
  export let readImageHeaders = false;
  export let onImageLoad: ((dimensions: { width: number; height: number }) => void) | null = null;
  export let onImageError: (() => void) | null = null;

  let imageNaturalWidth = 0;
  let imageNaturalHeight = 0;
  let headerSourceWidth: number | null = null;
  let headerSourceHeight: number | null = null;
  let headerLoadSerial = 0;
  let busy = false;
  let status: string | null = null;
  let exportMenuOpen = false;
  let imageFailed = false;
  let lastImageUrl = '';
  let maskedImageUrl = '';
  let maskedImageKey = '';
  let maskRenderSerial = 0;

  const defaultScaleBarLengths = [1000, 500, 100, 50, 10];

  onDestroy(() => {
    if (maskedImageUrl) URL.revokeObjectURL(maskedImageUrl);
  });

  $: visibleImageUrl = applyImageMask && maskedImageUrl ? maskedImageUrl : imageUrl;
  $: exportOverlays = overlayExportRects();
  $: exportMasks = overlayExportMasks();
  $: exportFilename = exportOverlays.length || exportMasks.length ? annotatedFilename : filename;
  $: isDisabled = disabled || busy || !imageUrl;
  $: scaleBarLength = selectedScaleBarLength();
  $: scaleBarPlacement = scaleBar?.placement ?? 'inside';
  $: resolvedSourceWidth = headerSourceWidth ?? sourceWidth ?? imageNaturalWidth;
  $: resolvedSourceHeight = headerSourceHeight ?? sourceHeight ?? imageNaturalHeight;
  $: void loadImageHeaders(imageUrl, readImageHeaders);
  $: void renderMaskedImage(imageUrl, imageMaskUrl, applyImageMask);
  $: resetImageState(visibleImageUrl);

  function handleLoad(event: Event) {
    const image = event.currentTarget as HTMLImageElement;
    imageNaturalWidth = image.naturalWidth;
    imageNaturalHeight = image.naturalHeight;
    imageFailed = false;
    onImageLoad?.({ width: imageNaturalWidth, height: imageNaturalHeight });
  }

  function handleError() {
    imageNaturalWidth = 0;
    imageNaturalHeight = 0;
    imageFailed = true;
    onImageError?.();
  }

  function resetImageState(url: string) {
    if (url === lastImageUrl) return;
    lastImageUrl = url;
    imageFailed = false;
    imageNaturalWidth = 0;
    imageNaturalHeight = 0;
  }

  async function loadImageHeaders(url: string, enabled: boolean) {
    const serial = ++headerLoadSerial;
    headerSourceWidth = null;
    headerSourceHeight = null;
    if (!enabled || !url || typeof window === 'undefined') return;
    try {
      const response = await fetch(url, { method: 'HEAD' });
      if (serial !== headerLoadSerial || !response.ok) return;
      headerSourceWidth =
        headerNumber(response.headers, 'x-pelagia-source-width') ??
        headerNumber(response.headers, 'x-pelagia-width');
      headerSourceHeight =
        headerNumber(response.headers, 'x-pelagia-source-height') ??
        headerNumber(response.headers, 'x-pelagia-height');
    } catch {
      if (serial === headerLoadSerial) {
        headerSourceWidth = null;
        headerSourceHeight = null;
      }
    }
  }

  async function renderMaskedImage(url: string, maskUrl: string, enabled: boolean) {
    const key = enabled && maskUrl ? `${url}::${maskUrl}::masked` : '';
    if (key === maskedImageKey && maskedImageUrl) return;
    const previousUrl = maskedImageUrl;
    maskedImageUrl = '';
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    const serial = ++maskRenderSerial;
    if (!enabled || !url || !maskUrl || typeof window === 'undefined') {
      maskedImageKey = '';
      return;
    }
    maskedImageKey = key;
    try {
      const [image, mask] = await Promise.all([loadElementImage(url), loadElementImage(maskUrl)]);
      if (serial !== maskRenderSerial) return;
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.drawImage(image, 0, 0);

      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = canvas.width;
      maskCanvas.height = canvas.height;
      const maskContext = maskCanvas.getContext('2d');
      if (!maskContext) return;
      maskContext.drawImage(mask, 0, 0, canvas.width, canvas.height);

      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const maskData = maskContext.getImageData(0, 0, canvas.width, canvas.height);
      for (let index = 0; index < imageData.data.length; index += 4) {
        const luminance =
          maskData.data[index] * 0.2126 +
          maskData.data[index + 1] * 0.7152 +
          maskData.data[index + 2] * 0.0722;
        if (luminance <= 0) {
          imageData.data[index] = 0;
          imageData.data[index + 1] = 0;
          imageData.data[index + 2] = 0;
          imageData.data[index + 3] = 255;
        }
      }
      context.putImageData(imageData, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (serial !== maskRenderSerial || !blob) return;
      maskedImageUrl = URL.createObjectURL(blob);
    } catch {
      if (serial === maskRenderSerial) {
        maskedImageUrl = '';
        maskedImageKey = '';
      }
    }
  }

  async function loadElementImage(url: string): Promise<HTMLImageElement> {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not load image (${response.status}).`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.decoding = 'async';
      image.src = objectUrl;
      await image.decode();
      return image;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  function headerNumber(headers: Headers, name: string): number | null {
    const parsed = Number(headers.get(name));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  async function runDownload() {
    await runExport('download', exportOverlays, exportMasks, inverted, exportFilename);
  }

  async function runCopy() {
    await runExport('copy', exportOverlays, exportMasks, inverted, exportFilename);
  }

  async function runMenuExport(
    action: 'download' | 'copy',
    variant: 'plain' | 'boxed' | 'inverted'
  ) {
    const nextOverlays = variant === 'boxed' ? exportOverlays : [];
    const nextMasks = variant === 'boxed' ? exportMasks : [];
    const nextInverted = variant === 'inverted' ? true : inverted;
    const nextFilename =
      variant === 'boxed'
        ? annotatedFilename
        : filenameForSuffix(filename, variant === 'inverted' ? '-inverted' : '');
    await runExport(action, nextOverlays, nextMasks, nextInverted, nextFilename);
    exportMenuOpen = false;
  }

  async function runExport(
    action: 'download' | 'copy',
    nextOverlays: ImageOverlayRect[],
    nextMasks: ImageOverlayMask[],
    nextInverted: boolean,
    nextFilename: string
  ) {
    busy = true;
    status = null;
    const started = performance.now();
    try {
      const options = {
        imageUrl,
        filename: nextFilename,
        baseMaskUrl: applyImageMask ? imageMaskUrl || undefined : undefined,
        overlays: nextOverlays,
        masks: nextMasks,
        inverted: nextInverted
      };
      const annotationCount = nextOverlays.length + nextMasks.length;
      if (action === 'download') {
        await downloadImagePng(options);
        status = annotationCount ? 'Downloaded annotated PNG.' : 'Downloaded PNG.';
      } else {
        await copyImagePng(options);
        status = annotationCount
          ? 'Copied annotated PNG.'
          : nextInverted
            ? 'Copied inverted PNG.'
            : 'Copied PNG.';
      }
      recordClientEvent('image_export', {
        action,
        filename: nextFilename,
        overlay_count: nextOverlays.length,
        mask_count: nextMasks.length,
        inverted: nextInverted,
        image_width: imageNaturalWidth,
        image_height: imageNaturalHeight,
        duration_ms: Math.round((performance.now() - started) * 10) / 10
      });
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
      recordClientEvent('image_export_error', {
        action,
        filename: nextFilename,
        overlay_count: nextOverlays.length,
        mask_count: nextMasks.length,
        inverted: nextInverted,
        error: status
      });
    } finally {
      busy = false;
    }
  }

  function overlayStyle(overlay: CanvasOverlayRect): string {
    const rect = overlayPercentRect(overlay);
    return [
      `left: ${rect.x}%`,
      `top: ${rect.y}%`,
      `width: ${rect.w}%`,
      `height: ${rect.h}%`,
      `border-color: ${overlay.stroke}`,
      `border-width: ${overlay.lineWidth ?? 2}px`,
      overlay.halo ? `box-shadow: 0 0 0 1px ${overlay.halo}` : ''
    ]
      .filter(Boolean)
      .join('; ');
  }

  function imageOverlayStyle(overlay: CanvasOverlayImage): string {
    const rect = overlayPercentRect(overlay);
    const opacity = Math.max(0, Math.min(1, overlay.opacity ?? 0.45));
    const escapedUrl = overlay.imageUrl.replace(/"/g, '\\"');
    return [
      `left: ${rect.x}%`,
      `top: ${rect.y}%`,
      `width: ${rect.w}%`,
      `height: ${rect.h}%`,
      `background-color: ${overlay.tint}`,
      `opacity: ${opacity}`,
      `-webkit-mask-image: url("${escapedUrl}")`,
      `mask-image: url("${escapedUrl}")`,
      '-webkit-mask-size: 100% 100%',
      'mask-size: 100% 100%',
      '-webkit-mask-mode: luminance',
      'mask-mode: luminance',
      '-webkit-mask-repeat: no-repeat',
      'mask-repeat: no-repeat',
      '-webkit-mask-position: center',
      'mask-position: center',
      overlay.inverted ? 'filter: invert(1)' : ''
    ]
      .filter(Boolean)
      .join('; ');
  }

  function overlayPercentRect(overlay: {
    x: number;
    y: number;
    w: number;
    h: number;
    coordinateSpace?: 'source' | 'image' | 'percent';
  }) {
    const coordinateSpace = overlay.coordinateSpace ?? 'source';
    if (coordinateSpace === 'percent') {
      return { x: overlay.x, y: overlay.y, w: overlay.w, h: overlay.h };
    }
    const width = coordinateSpace === 'image' ? imageNaturalWidth : resolvedSourceWidth;
    const height = coordinateSpace === 'image' ? imageNaturalHeight : resolvedSourceHeight;
    if (!width || !height) return { x: 0, y: 0, w: 0, h: 0 };
    return {
      x: (overlay.x / width) * 100,
      y: (overlay.y / height) * 100,
      w: (overlay.w / width) * 100,
      h: (overlay.h / height) * 100
    };
  }

  function overlayExportRects(): ImageOverlayRect[] {
    if (!imageNaturalWidth || !imageNaturalHeight) return [];
    return overlays
      .map((overlay) => {
        const rect = overlayPercentRect(overlay);
        return {
          x: (rect.x / 100) * imageNaturalWidth,
          y: (rect.y / 100) * imageNaturalHeight,
          w: (rect.w / 100) * imageNaturalWidth,
          h: (rect.h / 100) * imageNaturalHeight,
          stroke: overlay.stroke,
          lineWidth: overlay.lineWidth,
          halo: overlay.halo
        };
      })
      .filter((overlay) => overlay.w > 0 && overlay.h > 0);
  }

  function overlayExportMasks(): ImageOverlayMask[] {
    if (!imageNaturalWidth || !imageNaturalHeight) return [];
    return imageOverlays
      .map((overlay) => {
        const rect = overlayPercentRect(overlay);
        return {
          imageUrl: overlay.imageUrl,
          x: (rect.x / 100) * imageNaturalWidth,
          y: (rect.y / 100) * imageNaturalHeight,
          w: (rect.w / 100) * imageNaturalWidth,
          h: (rect.h / 100) * imageNaturalHeight,
          tint: overlay.tint,
          opacity: overlay.opacity
        };
      })
      .filter((overlay) => overlay.w > 0 && overlay.h > 0);
  }

  function selectedScaleBarLength(): number | null {
    if (!scaleBar?.enabled || !resolvedSourceWidth) return null;
    const lengths = scaleBar.lengths ?? defaultScaleBarLengths;
    const maxPercent = scaleBar.maxPercent ?? 48;
    return (
      lengths.find((length) => length <= resolvedSourceWidth * 0.9 && (length / resolvedSourceWidth) * 100 <= maxPercent) ??
      lengths.slice().reverse().find((length) => length <= resolvedSourceWidth) ??
      null
    );
  }

  function scaleBarStyle(): string {
    if (!scaleBarLength || !resolvedSourceWidth) return '';
    return `width: ${(scaleBarLength / resolvedSourceWidth) * 100}%`;
  }

  function filenameForSuffix(name: string, suffix: string): string {
    if (!suffix) return name;
    return name.replace(/\.png$/i, '') + suffix + '.png';
  }

  function overlayClass(overlay: CanvasOverlayRect): string {
    return [
      'image-canvas-rect',
      overlay.selected ? 'image-canvas-rect-selected' : '',
      overlay.className ?? ''
    ]
      .filter(Boolean)
      .join(' ');
  }

  function imageOverlayClass(overlay: CanvasOverlayImage): string {
    return ['image-canvas-mask', overlay.className ?? ''].filter(Boolean).join(' ');
  }
</script>

<div class="image-canvas">
  {#if imageUrl}
    <div class="image-canvas-stage" style={canvasStyle}>
      {#if imageFailed}
        <div class="image-canvas-error" role="status">
          <strong>Image unavailable</strong>
          <span>Check the frame or ROI endpoint.</span>
        </div>
      {:else}
        {#key visibleImageUrl}
          <img
            class:inverted-frame={inverted}
            class={imageClass}
            src={visibleImageUrl}
            alt={alt}
            {loading}
            on:load={handleLoad}
            on:error={handleError}
          />
        {/key}
      {/if}

      {#if !imageFailed && imageNaturalWidth && imageNaturalHeight && imageOverlays.length}
        <div class="image-canvas-mask-overlay" aria-hidden="true">
          {#each imageOverlays as overlay}
            <div class={imageOverlayClass(overlay)} style={imageOverlayStyle(overlay)}></div>
          {/each}
        </div>
      {/if}

      {#if !imageFailed && imageNaturalWidth && imageNaturalHeight && overlays.length}
        <div class="image-canvas-overlay" aria-hidden="true">
          {#each overlays as overlay, index}
            <div
              class={overlayClass(overlay)}
              style={overlayStyle(overlay)}
            >
              {#if overlay.hoverPreview}
                <div class="bbox-hover-preview image-hover-preview">
                  <img
                    class:inverted-frame={overlay.hoverPreview.inverted}
                    src={overlay.hoverPreview.imageUrl}
                    alt=""
                    style={overlay.hoverPreview.imageStyle}
                  />
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      {#if scaleBarLength && scaleBarPlacement === 'inside'}
        <div class="image-canvas-scale" aria-hidden="true">
          <span class="image-canvas-scale-bar" style={scaleBarStyle()}></span>
          <span>{scaleBarLength} px</span>
        </div>
      {/if}

      {#if exportControls === 'full'}
        <div class="image-export-actions image-export-floating" aria-label="Image export actions">
          <button class="ghost" type="button" disabled={isDisabled} on:click={runDownload}>Download PNG</button>
          <button class="ghost" type="button" disabled={isDisabled} on:click={runCopy}>Copy PNG</button>
          {#if status}<span class="soft">{status}</span>{/if}
        </div>
      {:else if exportControls === 'menu' || exportControls === 'copy-menu'}
        <div class="image-canvas-menu-control">
          <button
            class="image-canvas-menu-button"
            type="button"
            disabled={isDisabled}
            aria-label="Image export menu"
            aria-expanded={exportMenuOpen}
            on:click|stopPropagation={() => (exportMenuOpen = !exportMenuOpen)}
          >
            <span aria-hidden="true"></span>
          </button>
          {#if exportMenuOpen}
            <div class="image-canvas-menu">
              <button type="button" on:click|stopPropagation={() => runMenuExport('copy', 'plain')}>Copy image</button>
              <button type="button" on:click|stopPropagation={() => runMenuExport('download', 'plain')}>Download image</button>
              {#if exportOverlays.length || exportMasks.length}
                <button type="button" on:click|stopPropagation={() => runMenuExport('copy', 'boxed')}>Copy image + overlays</button>
                <button type="button" on:click|stopPropagation={() => runMenuExport('download', 'boxed')}>Download image + overlays</button>
              {/if}
              <button type="button" on:click|stopPropagation={() => runMenuExport('copy', 'inverted')}>Copy inverted image</button>
              <button type="button" on:click|stopPropagation={() => runMenuExport('download', 'inverted')}>Download inverted image</button>
            </div>
          {/if}
        </div>
        {#if status}<span class="image-canvas-menu-status">{status}</span>{/if}
      {/if}
    </div>

    {#if scaleBarLength && scaleBarPlacement === 'below'}
      <div class="image-canvas-scale image-canvas-scale-below" aria-hidden="true">
        <span class="image-canvas-scale-bar" style={scaleBarStyle()}></span>
        <span>{scaleBarLength} px</span>
      </div>
    {/if}
  {/if}
</div>
