<script lang="ts">
  import {
    copyImagePng,
    downloadImagePng,
    type ImageOverlayRect
  } from '$lib/utils/imageExport';
  import { recordClientEvent } from '$lib/utils/analytics';
  import type {
    CanvasExportControls,
    CanvasOverlayRect,
    CanvasScaleBar
  } from '$lib/utils/imageCanvas';

  export let imageUrl = '';
  export let alt = '';
  export let filename = 'pelagia-image.png';
  export let annotatedFilename = 'pelagia-image-boxed.png';
  export let overlays: CanvasOverlayRect[] = [];
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

  const defaultScaleBarLengths = [1000, 500, 100, 50, 10];

  $: exportOverlays = overlayExportRects();
  $: exportFilename = exportOverlays.length ? annotatedFilename : filename;
  $: isDisabled = disabled || busy || !imageUrl;
  $: scaleBarLength = selectedScaleBarLength();
  $: scaleBarPlacement = scaleBar?.placement ?? 'inside';
  $: resolvedSourceWidth = headerSourceWidth ?? sourceWidth ?? imageNaturalWidth;
  $: resolvedSourceHeight = headerSourceHeight ?? sourceHeight ?? imageNaturalHeight;
  $: void loadImageHeaders(imageUrl, readImageHeaders);

  function handleLoad(event: Event) {
    const image = event.currentTarget as HTMLImageElement;
    imageNaturalWidth = image.naturalWidth;
    imageNaturalHeight = image.naturalHeight;
    onImageLoad?.({ width: imageNaturalWidth, height: imageNaturalHeight });
  }

  function handleError() {
    imageNaturalWidth = 0;
    imageNaturalHeight = 0;
    onImageError?.();
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

  function headerNumber(headers: Headers, name: string): number | null {
    const parsed = Number(headers.get(name));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  async function runDownload() {
    await runExport('download', exportOverlays, inverted, exportFilename);
  }

  async function runCopy() {
    await runExport('copy', exportOverlays, inverted, exportFilename);
  }

  async function runMenuExport(
    action: 'download' | 'copy',
    variant: 'plain' | 'boxed' | 'inverted'
  ) {
    const nextOverlays = variant === 'boxed' ? exportOverlays : [];
    const nextInverted = variant === 'inverted' ? true : inverted;
    const nextFilename =
      variant === 'boxed'
        ? annotatedFilename
        : filenameForSuffix(filename, variant === 'inverted' ? '-inverted' : '');
    await runExport(action, nextOverlays, nextInverted, nextFilename);
    exportMenuOpen = false;
  }

  async function runExport(
    action: 'download' | 'copy',
    nextOverlays: ImageOverlayRect[],
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
        overlays: nextOverlays,
        inverted: nextInverted
      };
      if (action === 'download') {
        await downloadImagePng(options);
        status = nextOverlays.length ? 'Downloaded boxed PNG.' : 'Downloaded PNG.';
      } else {
        await copyImagePng(options);
        status = nextOverlays.length
          ? 'Copied boxed PNG.'
          : nextInverted
            ? 'Copied inverted PNG.'
            : 'Copied PNG.';
      }
      recordClientEvent('image_export', {
        action,
        filename: nextFilename,
        overlay_count: nextOverlays.length,
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

  function overlayPercentRect(overlay: CanvasOverlayRect) {
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
</script>

<div class="image-canvas">
  {#if imageUrl}
    <div class="image-canvas-stage" style={canvasStyle}>
      <img
        class:inverted-frame={inverted}
        class={imageClass}
        src={imageUrl}
        alt={alt}
        {loading}
        on:load={handleLoad}
        on:error={handleError}
      />

      {#if imageNaturalWidth && imageNaturalHeight && overlays.length}
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
              {#if exportOverlays.length}
                <button type="button" on:click|stopPropagation={() => runMenuExport('copy', 'boxed')}>Copy image + bbox</button>
                <button type="button" on:click|stopPropagation={() => runMenuExport('download', 'boxed')}>Download image + bbox</button>
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
