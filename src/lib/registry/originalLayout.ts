import type { Item } from './types';

export type OriginalLayoutEntry = {
  index: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
  showLabel: boolean;
};

export type OriginalLayoutRow = {
  y: number;
  height: number;
  entries: number[];
};

export type OriginalLayout = {
  entries: OriginalLayoutEntry[];
  rows: OriginalLayoutRow[];
  width: number;
  height: number;
};

const OUTER_PADDING = 8;
const COLUMN_GAP = 10;
const ROW_GAP = 8;
const TILE_CHROME_WIDTH = 8;
const TILE_CHROME_HEIGHT = 38;
const COMPACT_TILE_CHROME_HEIGHT = 8;

function imageDimension(value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(20_000, Math.round(number)) : fallback;
}

export function buildOriginalLayout(items: Item[], viewportWidth: number, scaleFactor = 1): OriginalLayout {
  const entries: OriginalLayoutEntry[] = [];
  const rows: OriginalLayoutRow[] = [];
  const availableWidth = Math.max(1, viewportWidth - OUTER_PADDING);
  let x = OUTER_PADDING;
  let y = OUTER_PADDING;
  let rowHeight = 0;
  let rowEntries: number[] = [];
  let layoutWidth = viewportWidth;

  function finishRow() {
    if (!rowEntries.length) return;
    rows.push({ y, height: rowHeight, entries: rowEntries });
    y += rowHeight + ROW_GAP;
    x = OUTER_PADDING;
    rowHeight = 0;
    rowEntries = [];
  }

  items.forEach((item, index) => {
    const safeScale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
    const imageHeight = imageDimension(item.shape?.[0], 128) * safeScale;
    const imageWidth = imageDimension(item.shape?.[1], 128) * safeScale;
    const showLabel = imageWidth >= 64 && imageHeight >= 32;
    const width = imageWidth + TILE_CHROME_WIDTH;
    const height = imageHeight + (showLabel ? TILE_CHROME_HEIGHT : COMPACT_TILE_CHROME_HEIGHT);
    if (rowEntries.length && x + width > availableWidth) finishRow();
    const entry: OriginalLayoutEntry = {
      index, row: rows.length, x, y, width, height, imageWidth, imageHeight, showLabel
    };
    entries.push(entry);
    rowEntries.push(index);
    rowHeight = Math.max(rowHeight, height);
    layoutWidth = Math.max(layoutWidth, x + width + OUTER_PADDING);
    x += width + COLUMN_GAP;
  });
  finishRow();
  return { entries, rows, width: layoutWidth, height: Math.max(0, y) };
}

export function visibleOriginalEntries(
  layout: OriginalLayout, scrollTop: number, viewportHeight: number, overscan = 300
): OriginalLayoutEntry[] {
  const top = Math.max(0, scrollTop - overscan);
  const bottom = scrollTop + viewportHeight + overscan;
  return layout.entries.filter((entry) => entry.y + entry.height >= top && entry.y <= bottom);
}

export function originalMoveIndex(layout: OriginalLayout, index: number, key: string): number {
  const current = layout.entries[index];
  if (!current) return layout.entries.length ? 0 : -1;
  const row = layout.rows[current.row];
  const position = row.entries.indexOf(index);
  if (key === 'ArrowLeft') return row.entries[Math.max(0, position - 1)];
  if (key === 'ArrowRight') return row.entries[Math.min(row.entries.length - 1, position + 1)];
  if (key !== 'ArrowUp' && key !== 'ArrowDown') return index;
  const targetRowIndex = current.row + (key === 'ArrowUp' ? -1 : 1);
  const targetRow = layout.rows[targetRowIndex];
  if (!targetRow) return index;
  const center = current.x + current.width / 2;
  return targetRow.entries.reduce((closest, candidate) => {
    const candidateEntry = layout.entries[candidate];
    const candidateDistance = Math.abs(candidateEntry.x + candidateEntry.width / 2 - center);
    const closestEntry = layout.entries[closest];
    const closestDistance = Math.abs(closestEntry.x + closestEntry.width / 2 - center);
    return candidateDistance < closestDistance ? candidate : closest;
  }, targetRow.entries[0]);
}
