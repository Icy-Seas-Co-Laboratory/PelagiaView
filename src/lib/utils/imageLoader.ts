import { authenticatedFetch } from '$lib/api/client';

export type LoadedImage = {
  element: HTMLImageElement;
  width: number;
  height: number;
  sourceWidth?: number | null;
  sourceHeight?: number | null;
  scaleX?: number | null;
  scaleY?: number | null;
  byteSize: number;
  mediaType: string;
};

export type ComposedImage = {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  sourceWidth?: number | null;
  sourceHeight?: number | null;
  scaleX?: number | null;
  scaleY?: number | null;
  byteSize: number;
  mediaType: string;
};

export type ComposeImageOptions = {
  imageUrl: string;
  maskUrl?: string;
  applyMask?: boolean;
  invert?: boolean;
  outsideColor?: 'black' | 'white' | 'transparent';
  signal?: AbortSignal;
};

export async function loadElementImage(url: string, signal?: AbortSignal): Promise<LoadedImage> {
  const response = await authenticatedFetch(url, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`Could not load image (${response.status}).`);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const element = new Image();
    element.decoding = 'async';
    element.src = objectUrl;
    await element.decode();
    const scale = headerNumber(response.headers, 'x-pelagia-scale');
    const scaleX = headerNumber(response.headers, 'x-pelagia-scale-x') ?? scale;
    const scaleY = headerNumber(response.headers, 'x-pelagia-scale-y') ?? scale;
    const sourceWidth =
      headerNumber(response.headers, 'x-pelagia-source-width') ??
      headerNumber(response.headers, 'x-pelagia-original-width') ??
      (scaleX ? element.naturalWidth / scaleX : null);
    const sourceHeight =
      headerNumber(response.headers, 'x-pelagia-source-height') ??
      headerNumber(response.headers, 'x-pelagia-original-height') ??
      (scaleY ? element.naturalHeight / scaleY : null);
    return {
      element,
      width: element.naturalWidth,
      height: element.naturalHeight,
      sourceWidth,
      sourceHeight,
      scaleX,
      scaleY,
      byteSize: blob.size,
      mediaType: response.headers.get('content-type') ?? blob.type
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function composeImage(options: ComposeImageOptions): Promise<ComposedImage> {
  const image = await loadElementImage(options.imageUrl, options.signal);
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create image canvas.');
  context.drawImage(image.element, 0, 0);

  if (options.applyMask && options.maskUrl) {
    const mask = await loadElementImage(options.maskUrl, options.signal);
    applyBaseMask(context, mask.element, canvas.width, canvas.height, options.outsideColor ?? 'black');
  }

  if (options.invert) {
    invertCanvas(context, canvas.width, canvas.height);
  }

  return {
    canvas,
    width: canvas.width,
    height: canvas.height,
    sourceWidth: image.sourceWidth,
    sourceHeight: image.sourceHeight,
    scaleX: image.scaleX,
    scaleY: image.scaleY,
    byteSize: image.byteSize,
    mediaType: image.mediaType
  };
}

function headerNumber(headers: Headers, name: string): number | null {
  const parsed = Number(headers.get(name));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function applyBaseMask(
  context: CanvasRenderingContext2D,
  mask: HTMLImageElement,
  width: number,
  height: number,
  outsideColor: 'black' | 'white' | 'transparent'
) {
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskContext = maskCanvas.getContext('2d');
  if (!maskContext) return;
  maskContext.drawImage(mask, 0, 0, width, height);
  const maskData = maskContext.getImageData(0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  const outside = outsidePixel(outsideColor);

  for (let index = 0; index < imageData.data.length; index += 4) {
    const luminance =
      maskData.data[index] * 0.2126 +
      maskData.data[index + 1] * 0.7152 +
      maskData.data[index + 2] * 0.0722;
    if (luminance <= 0) {
      imageData.data[index] = outside.r;
      imageData.data[index + 1] = outside.g;
      imageData.data[index + 2] = outside.b;
      imageData.data[index + 3] = outside.a;
    }
  }
  context.putImageData(imageData, 0, 0);
}

function outsidePixel(color: 'black' | 'white' | 'transparent') {
  if (color === 'white') return { r: 255, g: 255, b: 255, a: 255 };
  if (color === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  return { r: 0, g: 0, b: 0, a: 255 };
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

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not encode PNG image.'));
    }, 'image/png');
  });
}
