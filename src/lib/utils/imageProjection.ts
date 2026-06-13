import type { ImageCoordinateSpace, ProjectedRect } from '$lib/utils/imageRenderSpec';

export type ImageProjectionContext = {
  sourceWidth: number;
  sourceHeight: number;
  imageWidth: number;
  imageHeight: number;
  canvasWidth: number;
  canvasHeight: number;
};

export function displayScale(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number,
  maxHeight: number
): number {
  if (!sourceWidth || !sourceHeight) return 1;
  return Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
}

export function projectRect(
  rect: ProjectedRect,
  coordinateSpace: ImageCoordinateSpace = 'source',
  context: ImageProjectionContext
): ProjectedRect {
  if (coordinateSpace === 'percent') {
    return {
      x: (rect.x / 100) * context.canvasWidth,
      y: (rect.y / 100) * context.canvasHeight,
      w: (rect.w / 100) * context.canvasWidth,
      h: (rect.h / 100) * context.canvasHeight
    };
  }

  const width = coordinateSpace === 'image' ? context.imageWidth : context.sourceWidth;
  const height = coordinateSpace === 'image' ? context.imageHeight : context.sourceHeight;
  if (!width || !height) return { x: 0, y: 0, w: 0, h: 0 };
  return {
    x: (rect.x / width) * context.imageWidth,
    y: (rect.y / height) * context.imageHeight,
    w: (rect.w / width) * context.imageWidth,
    h: (rect.h / height) * context.imageHeight
  };
}

export function scaleBarLength(
  sourceWidth: number,
  lengths = [1000, 500, 100, 50, 10],
  maxPercent = 48
): number | null {
  if (!sourceWidth) return null;
  return (
    lengths.find((length) => length <= sourceWidth * 0.9 && (length / sourceWidth) * 100 <= maxPercent) ??
    lengths.slice().reverse().find((length) => length <= sourceWidth) ??
    null
  );
}
