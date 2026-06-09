export type ImageOverlayRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  stroke: string;
  lineWidth?: number;
  halo?: string;
};

export type ImageExportOptions = {
  imageUrl: string;
  filename: string;
  overlays?: ImageOverlayRect[];
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

  context.filter = options.inverted ? 'grayscale(1) invert(1)' : 'none';
  context.drawImage(image, 0, 0);
  context.filter = 'none';

  for (const overlay of options.overlays ?? []) {
    drawOverlay(context, overlay);
  }
  return canvas;
}

async function loadImage(imageUrl: string): Promise<HTMLImageElement> {
  const response = await fetch(imageUrl);
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
