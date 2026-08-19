import type { Item } from './types';

export type ViewMode = 'fit' | 'original' | 'physical' | 'normalize-height';
export type PixelCalibration = { x: number; y: number };

const DIRECT_KEYS = new Set([
  'microns_per_pixel', 'micron_per_pixel', 'um_per_pixel', 'um_per_px',
  'pixel_size_um', 'pixel_size_microns', 'pixel_scale_um',
  'pixel_scale_um_per_px', 'resolution_um_per_pixel'
]);

function positiveNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) && number > 0 ? number : null;
}

function unitMultiplier(unit: unknown): number | null {
  if (typeof unit !== 'string') return null;
  const normalized = unit.trim().toLowerCase().replace('μ', 'µ');
  if (['µm', 'um', 'micron', 'microns', 'micrometer', 'micrometers'].includes(normalized)) return 1;
  if (['mm', 'millimeter', 'millimeters'].includes(normalized)) return 1000;
  if (['m', 'meter', 'meters'].includes(normalized)) return 1_000_000;
  return null;
}

function findCalibration(value: unknown): PixelCalibration | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const [key, candidate] of Object.entries(record)) {
    if (DIRECT_KEYS.has(key.toLowerCase())) {
      const number = positiveNumber(candidate);
      if (number) return { x: number, y: number };
    }
  }

  const x = positiveNumber(record.pixel_size_um_x ?? record.um_per_pixel_x ?? record.microns_per_pixel_x);
  const y = positiveNumber(record.pixel_size_um_y ?? record.um_per_pixel_y ?? record.microns_per_pixel_y);
  if (x || y) return { x: x ?? y!, y: y ?? x! };

  const scalar = positiveNumber(record.pixel_size ?? record.pixel_scale ?? record.resolution);
  const multiplier = unitMultiplier(record.pixel_size_unit ?? record.pixel_scale_unit ?? record.resolution_unit ?? record.unit);
  if (scalar && multiplier) return { x: scalar * multiplier, y: scalar * multiplier };

  for (const candidate of Object.values(record)) {
    const nested = findCalibration(candidate);
    if (nested) return nested;
  }
  return null;
}

export function itemCalibration(item: Item): PixelCalibration | null {
  return findCalibration(item.metadata);
}

export function medianPhysicalReference(items: Item[]): number | null {
  const values = items.flatMap((item) => {
    const calibration = itemCalibration(item);
    return calibration ? [(calibration.x + calibration.y) / 2] : [];
  }).sort((a, b) => a - b);
  if (!values.length) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

export function imageDimensions(
  item: Item,
  mode: ViewMode,
  tileSize: number,
  physicalReference: number | null
): { width: number | null; height: number | null; objectFit: 'contain' | null } {
  if (mode === 'fit') return { width: tileSize, height: tileSize, objectFit: 'contain' };
  const shape = item.shape;
  if (!shape || shape.length < 2) return { width: tileSize, height: tileSize, objectFit: 'contain' };
  const [height, width] = shape;
  const scaleFactor = tileSize / 128;
  if (mode === 'original') {
    return { width: width * scaleFactor, height: height * scaleFactor, objectFit: null };
  }
  if (mode === 'normalize-height') {
    return { width: null, height: tileSize, objectFit: null };
  }
  const calibration = itemCalibration(item);
  if (calibration && physicalReference) {
    return {
      width: width * calibration.x / physicalReference * scaleFactor,
      height: height * calibration.y / physicalReference * scaleFactor,
      objectFit: null
    };
  }
  return { width: tileSize, height: tileSize, objectFit: 'contain' };
}
