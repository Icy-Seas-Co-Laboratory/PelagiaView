export type ImageOverlayRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  stroke: string;
  lineWidth?: number;
  halo?: string;
};

export type ImageOverlayMask = {
  imageUrl: string;
  x: number;
  y: number;
  w: number;
  h: number;
  tint: string;
  opacity?: number;
};

export type ImageExportOptions = {
  imageUrl: string;
  filename: string;
  baseMaskUrl?: string;
  overlays?: ImageOverlayRect[];
  masks?: ImageOverlayMask[];
  inverted?: boolean;
};

export async function downloadImagePng(options: ImageExportOptions): Promise<void> {
  const canvas = await renderImageCanvas(options);
  const blob = await canvasToPngBlob(canvas);
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = ensurePngFilename(options.filename);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(anchor.href);
}

export async function copyImagePng(options: ImageExportOptions): Promise<void> {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
    throw new Error('PNG clipboard export is not available in this browser.');
  }
  const canvas = await renderImageCanvas(options);
  const blob = await canvasToPngBlob(canvas);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

async function renderImageCanvas(options: ImageExportOptions): Promise<HTMLCanvasElement> {
  const image = await loadImage(options.imageUrl);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create an image canvas.');

  context.drawImage(image, 0, 0);

  if (options.baseMaskUrl) {
    await applyBaseMask(context, options.baseMaskUrl, canvas.width, canvas.height);
  }
  if (options.inverted) {
    invertCanvas(context, canvas.width, canvas.height);
  }

  for (const mask of options.masks ?? []) {
    await drawMaskOverlay(context, mask);
  }
  for (const overlay of options.overlays ?? []) {
    drawOverlay(context, overlay);
  }
  return canvas;
}

async function applyBaseMask(
  context: CanvasRenderingContext2D,
  maskUrl: string,
  width: number,
  height: number
) {
  const mask = await loadImage(maskUrl);
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskContext = maskCanvas.getContext('2d');
  if (!maskContext) return;
  maskContext.drawImage(mask, 0, 0, width, height);
  const maskData = maskContext.getImageData(0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
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
}

function invertCanvas(context: CanvasRenderingContext2D, width: number, height: number) {
  const imageData = context.getImageData(0, 0, width, height);
  for (let index = 0; index < imageData.data.length; index += 4) {
    const luminance =
      imageData.data[index] * 0.2126 +
      imageData.data[index + 1] * 0.7152 +
      imageData.data[index + 2] * 0.0722;
    const inverted = 255 - Math.round(luminance);
    imageData.data[index] = inverted;
    imageData.data[index + 1] = inverted;
    imageData.data[index + 2] = inverted;
  }
  context.putImageData(imageData, 0, 0);
}

async function loadImage(imageUrl: string): Promise<HTMLImageElement> {
  const response = await fetch(imageUrl, { cache: 'no-store' });
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

function drawOverlay(context: CanvasRenderingContext2D, overlay: ImageOverlayRect) {
  const lineWidth = overlay.lineWidth ?? 2;
  const x = overlay.x + lineWidth / 2;
  const y = overlay.y + lineWidth / 2;
  const width = Math.max(0, overlay.w - lineWidth);
  const height = Math.max(0, overlay.h - lineWidth);
  if (width <= 0 || height <= 0) return;

  if (overlay.halo) {
    context.strokeStyle = overlay.halo;
    context.lineWidth = lineWidth + 2;
    context.strokeRect(x, y, width, height);
  }

  context.strokeStyle = overlay.stroke;
  context.lineWidth = lineWidth;
  context.strokeRect(x, y, width, height);
}

async function drawMaskOverlay(context: CanvasRenderingContext2D, mask: ImageOverlayMask) {
  if (mask.w <= 0 || mask.h <= 0) return;
  const image = await loadImage(mask.imageUrl);
  const width = Math.max(1, Math.round(mask.w));
  const height = Math.max(1, Math.round(mask.h));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const maskContext = canvas.getContext('2d');
  if (!maskContext) return;
  maskContext.drawImage(image, 0, 0, width, height);
  const imageData = maskContext.getImageData(0, 0, width, height);
  const color = rgbFromCss(mask.tint);
  const opacity = Math.max(0, Math.min(1, mask.opacity ?? 0.45));
  for (let index = 0; index < imageData.data.length; index += 4) {
    const luminance =
      imageData.data[index] * 0.2126 +
      imageData.data[index + 1] * 0.7152 +
      imageData.data[index + 2] * 0.0722;
    imageData.data[index] = color.r;
    imageData.data[index + 1] = color.g;
    imageData.data[index + 2] = color.b;
    imageData.data[index + 3] = Math.round(imageData.data[index + 3] * (luminance / 255) * opacity);
  }
  maskContext.putImageData(imageData, 0, 0);
  context.drawImage(canvas, mask.x, mask.y);
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
  if (rgb) {
    return {
      r: Number(rgb[1]),
      g: Number(rgb[2]),
      b: Number(rgb[3])
    };
  }
  return { r: 0, g: 220, b: 255 };
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not encode PNG image.'));
    }, 'image/png');
  });
}

function ensurePngFilename(filename: string): string {
  return filename.toLowerCase().endsWith('.png') ? filename : `${filename}.png`;
}
