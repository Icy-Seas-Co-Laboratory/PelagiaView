<script lang="ts">
  import Konva from 'konva';
  import { onDestroy, onMount } from 'svelte';
  import { authenticatedFetch } from '$lib/api/client';
  import { recordClientEvent } from '$lib/utils/analytics';
  import { composeImage, loadElementImage } from '$lib/utils/imageLoader';
  import { displayScale, projectRect, scaleBarLength } from '$lib/utils/imageProjection';
  import { formatBytes } from '$lib/utils/format';
  import type {
    ImageDownloadOption,
    ImageDownloadVariant,
    ImageLayer,
    ImageMaskOverlayLayer,
    ImageRectLayer,
    ImageRenderSpec,
    ImageViewerMode
  } from '$lib/utils/imageRenderSpec';

  export let spec: ImageRenderSpec;
  export let mode: ImageViewerMode = 'static';
  export let onImageLoad: ((dimensions: { width: number; height: number }) => void) | null = null;
  export let onImageError: (() => void) | null = null;
  export let onMoreAction: (() => void) | null = null;

  let root: HTMLDivElement;
  let container: HTMLDivElement;
  let mounted = false;
  let renderSerial = 0;
  let abortController: AbortController | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let stage: Konva.Stage | null = null;
  let contentGroup: Konva.Group | null = null;
  let measurementLayer: Konva.Group | null = null;
  let measurementLine: Konva.Line | null = null;
  let measurementLabel: Konva.Label | null = null;
  let measurementStart: { x: number; y: number } | null = null;
  let contentInitialX = 0;
  let contentInitialY = 0;
  let busy = false;
  let status: string | null = null;
  let error: string | null = null;
  let activePanel: 'download' | 'zoom' | 'info' | null = null;
  let measuring = false;
  let stageReady = false;
  let canvasWidth = 0;
  let canvasHeight = 0;
  let lastRenderSignature = '';
  let availableWidth = 0;
  let metadataText = '';
  let zoomPreviewWidth = 260;
  let zoomPreviewHeight = 220;
  let zoomPreviewUrl: string | null = null;
  let zoomPreviewSourceUrl = '';
  let zoomPreviewSerial = 0;

  const defaultScaleBarLengths = [1000, 500, 100, 50, 10];

  onMount(() => {
    mounted = true;
    resizeObserver = new ResizeObserver(() => {
      const width = Math.floor(root?.clientWidth ?? 0);
      if (width !== availableWidth) availableWidth = width;
    });
    if (root) resizeObserver.observe(root);
    availableWidth = Math.floor(root?.clientWidth ?? 0);
    void render();
  });

  onDestroy(() => {
    cleanup();
  });

  $: renderSignature = [
    spec?.key ?? '',
    spec?.image?.url ?? '',
    spec?.image?.invert ? 'invert' : 'normal',
    spec?.baseMask?.enabled ? 'mask-on' : 'mask-off',
    spec?.baseMask?.url ?? '',
    layerSignature(spec?.layers ?? []),
    mode === 'viewer' ? availableWidth : ''
  ].join('|');
  $: if (mounted && renderSignature !== lastRenderSignature) void render(spec, renderSignature);
  $: if (mounted) void syncZoomPreview(activePanel, spec?.image?.url ?? '');

  function layerSignature(layers: ImageLayer[]): string {
    return layers
      .map((layer) => {
        if (layer.kind === 'mask-overlay') {
          return [
            layer.kind,
            layer.id ?? '',
            layer.imageUrl,
            layer.x,
            layer.y,
            layer.w,
            layer.h,
            layer.tint,
            layer.colorMode ?? '',
            layer.blendMode ?? '',
            layer.opacity ?? '',
            layer.compositeOperation ?? '',
            layer.coordinateSpace ?? ''
          ].join(':');
        }
        return [
          layer.kind,
          layer.id ?? '',
          layer.x,
          layer.y,
          layer.w,
          layer.h,
          layer.stroke,
          layer.lineWidth ?? '',
          layer.halo ?? '',
          layer.selected ? 'selected' : '',
          layer.coordinateSpace ?? ''
        ].join(':');
      })
      .join('|');
  }

  function cleanup() {
    abortController?.abort();
    abortController = null;
    cleanupZoomPreview();
    clearStage();
    resizeObserver?.disconnect();
    resizeObserver = null;
  }

  function clearStage() {
    stage?.destroy();
    stage = null;
    contentGroup = null;
    measurementLayer = null;
    measurementLine = null;
    measurementLabel = null;
    measurementStart = null;
    stageReady = false;
  }

  async function render(_spec = spec, signature = renderSignature) {
    lastRenderSignature = signature;
    const serial = ++renderSerial;
    abortController?.abort();
    const controller = new AbortController();
    abortController = controller;
    error = null;
    stageReady = false;
    metadataText = '';
    activePanel = null;
    cleanupZoomPreview();
    clearStage();
    if (!_spec?.image?.url || !container || typeof window === 'undefined') return;

    try {
      const composed = await composeImage({
        imageUrl: _spec.image.url,
        maskUrl: _spec.baseMask?.url,
        applyMask: Boolean(_spec.baseMask?.enabled),
        invert: Boolean(_spec.image.invert),
        outsideColor: _spec.baseMask?.outsideColor ?? 'black',
        signal: controller.signal
      });
      if (serial !== renderSerial || controller.signal.aborted) return;
      onImageLoad?.({ width: composed.width, height: composed.height });

      const sourceWidth = positiveNumber(composed.sourceWidth) ?? positiveNumber(_spec.image.sourceWidth) ?? composed.width;
      const sourceHeight = positiveNumber(composed.sourceHeight) ?? positiveNumber(_spec.image.sourceHeight) ?? composed.height;
      metadataText = `${Math.round(sourceWidth)} x ${Math.round(sourceHeight)} px · 8-bit grayscale · ${formatBytes(composed.byteSize)}`;
      setZoomPreviewSize(composed.width, composed.height);
      const requestedMaxWidth = _spec.display?.maxWidth ?? sourceWidth;
      const maxWidth =
        mode === 'viewer' && availableWidth > 0
          ? Math.min(requestedMaxWidth, availableWidth)
          : requestedMaxWidth;
      const maxHeight = _spec.display?.maxHeight ?? sourceHeight;
      const imageScale = displayScale(sourceWidth, sourceHeight, maxWidth, maxHeight);
      const imageWidth = Math.max(1, Math.round(sourceWidth * imageScale));
      const imageHeight = Math.max(1, Math.round(sourceHeight * imageScale));
      const scaleBarPlacement = _spec.scaleBar?.placement ?? 'inside';
      const belowScaleBarHeight = _spec.scaleBar?.enabled && scaleBarPlacement === 'below' ? 24 : 0;
      const viewerMode = mode === 'viewer';
      const viewportWidth = viewerMode ? Math.max(1, Math.round(maxWidth)) : imageWidth;
      const viewportHeight = viewerMode ? Math.max(1, Math.round(maxHeight)) : imageHeight;
      canvasWidth = viewportWidth;
      canvasHeight = viewportHeight + belowScaleBarHeight;
      contentInitialX = viewerMode ? Math.round((viewportWidth - imageWidth) / 2) : 0;
      contentInitialY = viewerMode ? Math.round((viewportHeight - imageHeight) / 2) : 0;

      stage = new Konva.Stage({
        container,
        width: canvasWidth,
        height: canvasHeight
      });
      const backgroundLayer = new Konva.Layer({ listening: false });
      const contentLayer = new Konva.Layer();
      const uiLayer = new Konva.Layer({ listening: false });
      stage.add(backgroundLayer);
      stage.add(contentLayer);
      stage.add(uiLayer);
      contentGroup = new Konva.Group({
        x: contentInitialX,
        y: contentInitialY,
        draggable: viewerMode && !measuring
      });
      contentLayer.add(contentGroup);

      backgroundLayer.add(
        new Konva.Rect({
          x: 0,
          y: 0,
          width: canvasWidth,
          height: canvasHeight,
          fill: _spec.display?.background ?? '#050807'
        })
      );
      contentGroup.add(
        new Konva.Image({
          image: composed.canvas,
          x: 0,
          y: 0,
          width: imageWidth,
          height: imageHeight
        })
      );

      const projection = {
        sourceWidth,
        sourceHeight,
        imageWidth,
        imageHeight,
        canvasWidth: imageWidth,
        canvasHeight: imageHeight
      };

      for (const layer of _spec.layers ?? []) {
        if (layer.kind === 'rect') {
          addRectLayer(contentGroup, layer, projection);
        } else if (layer.kind === 'mask-overlay') {
          await addMaskOverlayLayer(contentGroup, layer, projection, controller.signal);
        }
        if (serial !== renderSerial || controller.signal.aborted) return;
      }

      addScaleBar(contentGroup, _spec, sourceWidth, imageWidth, imageHeight, scaleBarPlacement);
      if (mode === 'viewer') setupViewerInteraction(sourceWidth, imageWidth);
      backgroundLayer.draw();
      contentLayer.draw();
      uiLayer.draw();
      stageReady = true;
    } catch (err) {
      if (controller.signal.aborted || serial !== renderSerial) return;
      error = err instanceof Error ? err.message : String(err);
      onImageError?.();
      stage?.destroy();
      stage = null;
      contentGroup = null;
      measurementLayer = null;
    }
  }

  function addRectLayer(
    layer: Konva.Container,
    rect: ImageRectLayer,
    projection: Parameters<typeof projectRect>[2]
  ) {
    const projected = projectRect(rect, rect.coordinateSpace ?? 'source', projection);
    if (projected.w <= 0 || projected.h <= 0) return;
    if (rect.halo) {
      layer.add(
        new Konva.Rect({
          x: projected.x,
          y: projected.y,
          width: projected.w,
          height: projected.h,
          stroke: rect.halo,
          strokeWidth: (rect.lineWidth ?? 2) + 2,
          listening: false
        })
      );
    }
    const shape = new Konva.Rect({
      x: projected.x,
      y: projected.y,
      width: projected.w,
      height: projected.h,
      stroke: rect.stroke,
      strokeWidth: rect.lineWidth ?? 2,
      listening: Boolean(rect.tooltip)
    });
    if (rect.tooltip) {
      shape.on('mouseenter', () => {
        const node = stage?.container();
        if (node) node.title = rect.tooltip ?? '';
      });
      shape.on('mouseleave', () => {
        const node = stage?.container();
        if (node) node.title = '';
      });
    }
    layer.add(shape);
  }

  async function addMaskOverlayLayer(
    layer: Konva.Container,
    mask: ImageMaskOverlayLayer,
    projection: Parameters<typeof projectRect>[2],
    signal: AbortSignal
  ) {
    const projected = projectRect(mask, mask.coordinateSpace ?? 'source', projection);
    if (projected.w <= 0 || projected.h <= 0) return;
    const maskCanvas = await tintedMaskCanvas(mask, Math.max(1, Math.round(projected.w)), Math.max(1, Math.round(projected.h)), signal);
    layer.add(
      new Konva.Image({
        image: maskCanvas,
        x: projected.x,
        y: projected.y,
        width: projected.w,
        height: projected.h,
        opacity: mask.opacity ?? 1,
        globalCompositeOperation: mask.compositeOperation ?? compositeOperationForBlendMode(mask.blendMode),
        listening: false
      })
    );
  }

  async function tintedMaskCanvas(mask: ImageMaskOverlayLayer, width: number, height: number, signal?: AbortSignal) {
    const loaded = await loadElementImage(mask.imageUrl, signal);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return canvas;
    context.drawImage(loaded.element, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    const color = overlayColor(mask);
    for (let index = 0; index < imageData.data.length; index += 4) {
      const sourceAlpha = imageData.data[index + 3] / 255;
      const luminance =
        imageData.data[index] * 0.2126 +
        imageData.data[index + 1] * 0.7152 +
        imageData.data[index + 2] * 0.0722;
      imageData.data[index] = color.r;
      imageData.data[index + 1] = color.g;
      imageData.data[index + 2] = color.b;
      imageData.data[index + 3] = Math.round(sourceAlpha * (luminance / 255) * 255);
    }
    context.putImageData(imageData, 0, 0);
    return canvas;
  }

  function overlayColor(mask: ImageMaskOverlayLayer): { r: number; g: number; b: number } {
    if (mask.colorMode === 'black') return { r: 0, g: 0, b: 0 };
    if (mask.colorMode === 'white') return { r: 255, g: 255, b: 255 };
    if (mask.colorMode === 'red') return { r: 255, g: 32, b: 32 };
    return rgbFromCss(mask.tint);
  }

  function compositeOperationForBlendMode(mode: ImageMaskOverlayLayer['blendMode']): GlobalCompositeOperation {
    if (mode === 'add') return 'lighter';
    if (mode === 'subtract') return 'multiply';
    if (mode === 'multiply') return 'multiply';
    if (mode === 'screen') return 'screen';
    if (mode === 'darken') return 'darken';
    if (mode === 'lighten') return 'lighten';
    return 'source-over';
  }

  function addScaleBar(
    layer: Konva.Container,
    renderSpec: ImageRenderSpec,
    sourceWidth: number,
    imageWidth: number,
    imageHeight: number,
    placement: 'inside' | 'below'
  ) {
    if (!renderSpec.scaleBar?.enabled) return;
    const length = scaleBarLength(
      sourceWidth,
      renderSpec.scaleBar.lengths ?? defaultScaleBarLengths,
      renderSpec.scaleBar.maxPercent ?? 48
    );
    if (!length) return;
    const width = (length / sourceWidth) * imageWidth;
    const x = 8;
    const y = placement === 'below' ? imageHeight + 6 : Math.max(6, imageHeight - 20);
    layer.add(
      new Konva.Line({
        points: [x, y, x + width, y],
        stroke: '#050807',
        strokeWidth: 5,
        lineCap: 'square',
        listening: false
      })
    );
    layer.add(
      new Konva.Line({
        points: [x, y, x + width, y],
        stroke: '#ffffff',
        strokeWidth: 4,
        lineCap: 'square',
        listening: false
      })
    );
    layer.add(
      new Konva.Text({
        x,
        y: y + 4,
        text: `${length} px`,
        fill: '#ffffff',
        fontSize: 10,
        fontStyle: 'bold',
        shadowColor: '#050807',
        shadowBlur: 1,
        listening: false
      })
    );
  }

  function setupViewerInteraction(sourceWidth: number, imageWidth: number) {
    if (!stage || !contentGroup) return;
    measurementLayer = new Konva.Group();
    contentGroup.add(measurementLayer);
    contentGroup.draggable(!measuring);
    stage.on('mousedown touchstart', () => {
      if (!measuring || !stage || !measurementLayer) return;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      const point = pointerToImagePoint(pointer);
      measurementStart = point;
      measurementLine?.destroy();
      measurementLabel?.destroy();
      measurementLine = new Konva.Line({
        points: [point.x, point.y, point.x, point.y],
        stroke: '#f7d84a',
        strokeWidth: 2 / Math.max(contentGroup?.scaleX() ?? 1, 0.1),
        lineCap: 'round',
        listening: false
      });
      measurementLabel = new Konva.Label({ x: point.x, y: point.y - 22, listening: false });
      measurementLabel.add(
        new Konva.Tag({
          fill: 'rgba(5, 8, 7, 0.82)',
          stroke: 'rgba(255, 255, 255, 0.24)',
          cornerRadius: 1
        })
      );
      measurementLabel.add(
        new Konva.Text({
          text: '0 px',
          fill: '#f7fbf9',
          fontSize: 11,
          fontStyle: 'bold',
          padding: 5
        })
      );
      measurementLayer.add(measurementLine);
      measurementLayer.add(measurementLabel);
      measurementLayer.getLayer()?.batchDraw();
    });
    stage.on('mousemove touchmove', () => {
      if (!measuring || !stage || !measurementStart || !measurementLine || !measurementLabel || !measurementLayer) return;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      const point = pointerToImagePoint(pointer);
      measurementLine.points([measurementStart.x, measurementStart.y, point.x, point.y]);
      const distance = Math.hypot(point.x - measurementStart.x, point.y - measurementStart.y) / Math.max(imageWidth / Math.max(sourceWidth, 1), 0.0001);
      measurementLabel.position({
        x: (measurementStart.x + point.x) / 2,
        y: (measurementStart.y + point.y) / 2 - 22
      });
      const text = measurementLabel.findOne('Text') as Konva.Text | undefined;
      text?.text(`${Math.round(distance)} px`);
      measurementLayer.getLayer()?.batchDraw();
    });
    stage.on('mouseup touchend', () => {
      measurementStart = null;
    });
  }

  $: if (stage && mode === 'viewer') {
    contentGroup?.draggable(!measuring);
    stage.container().style.cursor = measuring ? 'crosshair' : (contentGroup?.scaleX() ?? 1) > 1 ? 'grab' : 'default';
  }

  function pointerToImagePoint(pointer: { x: number; y: number }) {
    if (!contentGroup) return pointer;
    return contentGroup.getAbsoluteTransform().copy().invert().point(pointer);
  }

  function zoomStage(multiplier: number) {
    if (!stage || !contentGroup || !stageReady) return;
    const oldScale = contentGroup.scaleX();
    const newScale = Math.min(8, Math.max(0.25, oldScale * multiplier));
    const center = {
      x: stage.width() / 2,
      y: stage.height() / 2
    };
    const point = {
      x: (center.x - contentGroup.x()) / oldScale,
      y: (center.y - contentGroup.y()) / oldScale
    };
    contentGroup.scale({ x: newScale, y: newScale });
    contentGroup.position({
      x: center.x - point.x * newScale,
      y: center.y - point.y * newScale
    });
    stage.batchDraw();
  }

  function resetStageView() {
    if (!stage || !contentGroup) return;
    contentGroup.scale({ x: 1, y: 1 });
    contentGroup.position({ x: contentInitialX, y: contentInitialY });
    stage.batchDraw();
  }

  function setZoomPreviewSize(width: number, height: number) {
    if (!width || !height) {
      zoomPreviewWidth = 260;
      zoomPreviewHeight = 220;
      return;
    }
    const maxWidth = Math.min(mode === 'thumbnail' ? 520 : 760, Math.max(260, window.innerWidth - 48));
    const maxHeight = Math.min(mode === 'thumbnail' ? 420 : 620, Math.max(220, window.innerHeight - 120));
    const desiredScale = mode === 'thumbnail' ? 2.4 : 1.5;
    let previewWidth = width * desiredScale;
    let previewHeight = height * desiredScale;
    const fitScale = Math.min(1, maxWidth / previewWidth, maxHeight / previewHeight);
    previewWidth *= fitScale;
    previewHeight *= fitScale;
    const minScale = Math.min(4, Math.max(1, 180 / Math.max(previewWidth, 1), 140 / Math.max(previewHeight, 1)));
    previewWidth = Math.min(maxWidth, previewWidth * minScale);
    previewHeight = Math.min(maxHeight, previewHeight * minScale);
    zoomPreviewWidth = Math.max(120, Math.round(previewWidth));
    zoomPreviewHeight = Math.max(100, Math.round(previewHeight));
  }

  function runMoreAction() {
    activePanel = null;
    onMoreAction?.();
  }

  async function syncZoomPreview(panel: typeof activePanel, imageUrl: string) {
    if (panel !== 'zoom' || !imageUrl) {
      cleanupZoomPreview();
      return;
    }
    if (zoomPreviewUrl && zoomPreviewSourceUrl === imageUrl) return;
    cleanupZoomPreview();
    const serial = ++zoomPreviewSerial;
    try {
      const response = await authenticatedFetch(imageUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Preview image request failed (${response.status}).`);
      const blob = await response.blob();
      if (serial !== zoomPreviewSerial) return;
      zoomPreviewUrl = URL.createObjectURL(blob);
      zoomPreviewSourceUrl = imageUrl;
    } catch {
      if (serial === zoomPreviewSerial) {
        zoomPreviewUrl = null;
        zoomPreviewSourceUrl = '';
      }
    }
  }

  function cleanupZoomPreview() {
    zoomPreviewSerial += 1;
    if (zoomPreviewUrl) URL.revokeObjectURL(zoomPreviewUrl);
    zoomPreviewUrl = null;
    zoomPreviewSourceUrl = '';
  }

  async function runToolbarDownload(variant: ImageDownloadVariant, filenameOverride?: string) {
    if (!stageReady) return;
    busy = true;
    status = null;
    const started = performance.now();
    try {
      const filename = exportFilename(variant, filenameOverride);
      if (variant === 'original' && spec.toolbar?.originalUrl) {
        await downloadRemoteImage(spec.toolbar.originalUrl, filename);
      } else {
        const dataUrl = await exportDataUrl(variant);
        downloadDataUrl(dataUrl, filename);
      }
      status = 'Downloaded image.';
      recordClientEvent('image_export', {
        action: 'download',
        variant,
        filename,
        overlay_count: 0,
        inverted: Boolean(spec.image.invert),
        image_width: canvasWidth,
        image_height: canvasHeight,
        renderer: 'konva',
        duration_ms: Math.round((performance.now() - started) * 10) / 10
      });
    } catch (err) {
      status = err instanceof Error ? err.message : String(err);
      recordClientEvent('image_export_error', {
        action: 'download',
        variant,
        filename: exportFilename(variant),
        renderer: 'konva',
        error: status
      });
    } finally {
      busy = false;
      activePanel = null;
    }
  }

  async function exportDataUrl(variant: ImageDownloadVariant) {
    if (variant === 'mask') return maskExportDataUrl();
    const includeOverlay = variant === 'annotated' || variant === 'masked-annotated';
    const applyMask = variant === 'masked' || variant === 'masked-annotated';
    const imageUrl = spec.toolbar?.originalUrl ?? spec.image.url;
    const composed = await composeImage({
      imageUrl,
      maskUrl: spec.toolbar?.maskUrl ?? spec.baseMask?.url,
      applyMask,
      invert: Boolean(spec.image.invert),
      outsideColor: spec.baseMask?.outsideColor ?? 'black'
    });
    if (includeOverlay) await drawExportOverlay(composed.canvas, composed.sourceWidth ?? composed.width, composed.sourceHeight ?? composed.height);
    return composed.canvas.toDataURL('image/png');
  }

  async function drawExportOverlay(canvas: HTMLCanvasElement, fallbackSourceWidth: number, fallbackSourceHeight: number) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create image export canvas.');
    const sourceWidth = positiveNumber(spec.image.sourceWidth) ?? positiveNumber(fallbackSourceWidth) ?? canvas.width;
    const sourceHeight = positiveNumber(spec.image.sourceHeight) ?? positiveNumber(fallbackSourceHeight) ?? canvas.height;
    const projection = {
      sourceWidth,
      sourceHeight,
      imageWidth: canvas.width,
      imageHeight: canvas.height,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height
    };
    for (const layer of spec.layers ?? []) {
      if (layer.kind === 'rect') drawRectExportLayer(context, layer, projection);
      else if (layer.kind === 'mask-overlay') await drawMaskExportLayer(context, layer, projection);
    }
    drawScaleBarExport(context, sourceWidth, canvas.width, canvas.height);
  }

  function drawRectExportLayer(
    context: CanvasRenderingContext2D,
    rect: ImageRectLayer,
    projection: Parameters<typeof projectRect>[2]
  ) {
    const projected = projectRect(rect, rect.coordinateSpace ?? 'source', projection);
    if (projected.w <= 0 || projected.h <= 0) return;
    context.save();
    if (rect.halo) {
      context.strokeStyle = rect.halo;
      context.lineWidth = (rect.lineWidth ?? 2) + 2;
      context.strokeRect(projected.x, projected.y, projected.w, projected.h);
    }
    context.strokeStyle = rect.stroke;
    context.lineWidth = rect.lineWidth ?? 2;
    context.strokeRect(projected.x, projected.y, projected.w, projected.h);
    context.restore();
  }

  async function drawMaskExportLayer(
    context: CanvasRenderingContext2D,
    mask: ImageMaskOverlayLayer,
    projection: Parameters<typeof projectRect>[2]
  ) {
    const projected = projectRect(mask, mask.coordinateSpace ?? 'source', projection);
    if (projected.w <= 0 || projected.h <= 0) return;
    const maskCanvas = await tintedMaskCanvas(mask, Math.max(1, Math.round(projected.w)), Math.max(1, Math.round(projected.h)));
    context.save();
    context.globalAlpha = mask.opacity ?? 1;
    context.globalCompositeOperation = mask.compositeOperation ?? compositeOperationForBlendMode(mask.blendMode);
    context.drawImage(maskCanvas, projected.x, projected.y, projected.w, projected.h);
    context.restore();
  }

  async function maskExportDataUrl() {
    const maskUrl = spec.toolbar?.maskUrl ?? spec.baseMask?.url;
    if (!maskUrl) throw new Error('No mask image is available for this image.');
    const composed = await composeImage({
      imageUrl: maskUrl,
      invert: Boolean(spec.image.invert)
    });
    return composed.canvas.toDataURL('image/png');
  }

  function drawScaleBarExport(
    context: CanvasRenderingContext2D,
    sourceWidth: number,
    imageWidth: number,
    imageHeight: number
  ) {
    if (!spec.scaleBar?.enabled) return;
    const length = scaleBarLength(
      sourceWidth,
      spec.scaleBar.lengths ?? defaultScaleBarLengths,
      spec.scaleBar.maxPercent ?? 48
    );
    if (!length) return;
    const width = (length / sourceWidth) * imageWidth;
    const x = 8;
    const y = Math.max(6, imageHeight - 20);
    const fontSize = Math.max(10, Math.min(18, Math.round(imageWidth * 0.018)));
    context.save();
    context.lineCap = 'square';
    context.strokeStyle = '#050807';
    context.lineWidth = 5;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + width, y);
    context.stroke();
    context.strokeStyle = '#ffffff';
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + width, y);
    context.stroke();
    context.font = `700 ${fontSize}px sans-serif`;
    context.textBaseline = 'top';
    context.lineWidth = Math.max(2, Math.round(fontSize * 0.22));
    context.strokeStyle = '#050807';
    context.strokeText(`${length} px`, x, y + 4);
    context.fillStyle = '#ffffff';
    context.fillText(`${length} px`, x, y + 4);
    context.restore();
  }

  function downloadDataUrl(dataUrl: string, filename: string) {
    const anchor = document.createElement('a');
    anchor.href = dataUrl;
    anchor.download = ensurePngFilename(filename);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }

  async function downloadRemoteImage(url: string, filename: string) {
    const response = await authenticatedFetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Download failed (${response.status}).`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  function exportFilename(variant: ImageDownloadVariant, filenameOverride?: string) {
    if (filenameOverride) return filenameOverride;
    if (variant === 'annotated') return spec.toolbar?.annotatedFilename ?? suffixFilename('overlays');
    if (variant === 'mask') return spec.toolbar?.maskFilename ?? suffixFilename('mask');
    if (variant === 'masked') return spec.toolbar?.maskedFilename ?? suffixFilename('masked');
    if (variant === 'masked-annotated') return spec.toolbar?.maskedAnnotatedFilename ?? suffixFilename('masked-overlays');
    return spec.toolbar?.originalFilename ?? spec.toolbar?.filename ?? 'pelagia-image.png';
  }

  function suffixFilename(suffix: string) {
    const base = spec.toolbar?.filename ?? 'pelagia-image.png';
    return base.replace(/\.png$/i, `-${suffix}.png`);
  }

  function ensurePngFilename(filename: string) {
    return filename.toLowerCase().endsWith('.png') ? filename : `${filename}.png`;
  }

  function togglePanel(panel: 'download' | 'zoom' | 'info') {
    activePanel = activePanel === panel ? null : panel;
  }

  function closePanelSoon() {
    window.setTimeout(() => {
      if (!root?.matches(':hover') && !root?.matches(':focus-within')) activePanel = null;
    }, 80);
  }

  function infoValue(value: unknown): string {
    if (value === null || value === undefined || value === '') return 'unknown';
    if (Array.isArray(value)) return value.length ? value.join(', ') : 'none';
    return String(value);
  }

  function hasToolbarInfo() {
    return Boolean(spec.toolbar?.info);
  }

  function defaultDownloadOptions(): ImageDownloadOption[] {
    const options: ImageDownloadOption[] = [
      { label: 'Download original image', variant: 'original' }
    ];
    if ((spec.layers?.length ?? 0) > 0 || spec.scaleBar?.enabled) {
      options.push({ label: 'Download image + overlays', variant: 'annotated' });
    }
    options.push(
      { label: 'Download mask only', variant: 'mask', requiresMask: true },
      { label: 'Download masked image', variant: 'masked', requiresMask: true }
    );
    return options;
  }

  function downloadOptionDisabled(option: ImageDownloadOption) {
    const requiresMask =
      option.requiresMask ||
      option.variant === 'mask' ||
      option.variant === 'masked' ||
      option.variant === 'masked-annotated';
    return requiresMask && !maskAvailable;
  }

  function positiveNumber(value: number | null | undefined): number | null {
    return Number.isFinite(value) && value && value > 0 ? value : null;
  }

  function rgbFromCss(value: string): { r: number; g: number; b: number } {
    const hex = value.trim().match(/^#?([0-9a-f]{6})$/i)?.[1];
    if (hex) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16)
      };
    }
    const rgb = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
    return { r: 0, g: 220, b: 255 };
  }

  $: exportControls = spec.toolbar?.exportControls ?? 'full';
  $: toolbarEnabled = exportControls !== 'none';
  $: maskAvailable = Boolean(spec.toolbar?.maskUrl ?? spec.baseMask?.url);
  $: downloadOptions = spec.toolbar?.downloadOptions ?? defaultDownloadOptions();
  $: toolbarInfo = spec.toolbar?.info ?? null;
</script>

<div
  class="konva-image-canvas"
  class:konva-thumbnail={mode === 'thumbnail'}
  class:konva-viewer={mode === 'viewer'}
  bind:this={root}
>
  <div class="konva-image-stage" bind:this={container} style={`width: ${canvasWidth || 'auto'}px; min-height: ${canvasHeight || 0}px;`}></div>
  {#if metadataText}
    <div class="konva-image-meta" aria-label="Image metadata">
      {metadataText}
    </div>
  {/if}
  {#if error}
    <div class="konva-image-error" role="status">
      <strong>Image unavailable</strong>
      <span>{error}</span>
    </div>
  {/if}

  {#if toolbarEnabled}
    <div class="konva-image-toolbar" role="toolbar" tabindex="-1" aria-label="Image tools" on:mouseleave={closePanelSoon}>
      <button
        class="konva-tool-button"
        type="button"
        disabled={busy || !stageReady}
        aria-label="Download image options"
        aria-expanded={activePanel === 'download'}
        on:click|stopPropagation={() => togglePanel('download')}
      >
        <span aria-hidden="true">↓</span>
      </button>

      <button
        class="konva-tool-button"
        type="button"
        disabled={!stageReady}
        aria-label="Show magnified preview"
        aria-expanded={activePanel === 'zoom'}
        on:click|stopPropagation={() => togglePanel('zoom')}
      >
        <span aria-hidden="true">⌕</span>
      </button>

      {#if hasToolbarInfo()}
        <button
          class="konva-tool-button"
          type="button"
          aria-label="Show image information"
          aria-expanded={activePanel === 'info'}
          on:click|stopPropagation={() => togglePanel('info')}
        >
          <span aria-hidden="true">i</span>
        </button>
      {/if}

      {#if onMoreAction}
        <button
          class="konva-tool-button"
          type="button"
          aria-label="Open image details"
          on:click|stopPropagation={runMoreAction}
        >
          <span aria-hidden="true">•••</span>
        </button>
      {/if}

      {#if mode === 'viewer'}
        <span class="konva-toolbar-divider" aria-hidden="true"></span>
        <button class="konva-tool-button" type="button" disabled={!stageReady} aria-label="Zoom in" on:click|stopPropagation={() => zoomStage(1.25)}>+</button>
        <button class="konva-tool-button" type="button" disabled={!stageReady} aria-label="Zoom out" on:click|stopPropagation={() => zoomStage(0.8)}>−</button>
        <button class="konva-tool-button" type="button" disabled={!stageReady} aria-label="Reset zoom" on:click|stopPropagation={resetStageView}>1:1</button>
        <button
          class="konva-tool-button"
          class:active={measuring}
          type="button"
          disabled={!stageReady}
          aria-label="Measure pixels"
          on:click|stopPropagation={() => (measuring = !measuring)}
        >
          px
        </button>
      {/if}

      {#if activePanel === 'download'}
        <div class="konva-tool-popover konva-download-menu" role="menu" tabindex="-1" on:click|stopPropagation on:keydown|stopPropagation>
          {#each downloadOptions as option}
            <button
              type="button"
              disabled={busy || !stageReady || downloadOptionDisabled(option)}
              on:click={() => runToolbarDownload(option.variant, option.filename)}
            >
              {option.label}
            </button>
          {/each}
        </div>
      {/if}

      {#if activePanel === 'zoom'}
        <div
          class="konva-tool-popover konva-zoom-popover"
          role="dialog"
          tabindex="-1"
          aria-label="Magnified image preview"
          style={`width: ${zoomPreviewWidth}px; height: ${zoomPreviewHeight}px;`}
          on:click|stopPropagation
          on:keydown|stopPropagation
        >
          {#if zoomPreviewUrl}
            <img src={zoomPreviewUrl} alt={spec.image.alt ?? 'Magnified image preview'} class:inverted-preview={spec.image.invert} />
          {/if}
        </div>
      {/if}

      {#if activePanel === 'info' && toolbarInfo}
        <div class="konva-tool-popover konva-info-popover" role="dialog" tabindex="-1" aria-label="Image information" on:click|stopPropagation on:keydown|stopPropagation>
          <dl>
            <div><dt>Asset</dt><dd>{infoValue(toolbarInfo.assetFilename)}</dd></div>
            <div><dt>Frame</dt><dd>{infoValue(toolbarInfo.frameNumber)}</dd></div>
            <div><dt>Timestamp</dt><dd>{infoValue(toolbarInfo.timestamp)}</dd></div>
            <div><dt>Collections</dt><dd>{infoValue(toolbarInfo.collections)}</dd></div>
          </dl>
        </div>
      {/if}
    </div>
    {#if status}<span class="konva-image-status">{status}</span>{/if}
  {/if}
</div>
