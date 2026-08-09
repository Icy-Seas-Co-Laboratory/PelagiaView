export type GalleryScaleMode = 'fit' | 'original';

export type SizedGalleryItem = {
  width: number | null | undefined;
  height: number | null | undefined;
};

export type OriginalGalleryEntry = {
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

export type OriginalGalleryLayout = {
  entries: OriginalGalleryEntry[];
  rows: Array<{ y: number; height: number; entries: number[] }>;
  width: number;
  height: number;
};

const OUTER_PADDING = 8;
const COLUMN_GAP = 10;
const ROW_GAP = 8;
const TILE_CHROME_WIDTH = 8;
const TILE_CHROME_HEIGHT = 34;
const COMPACT_TILE_CHROME_HEIGHT = 8;

function imageDimension(value: unknown, fallback = 128): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(20_000, Math.round(number)) : fallback;
}

export function fitTileSize(scale: number, baseSize = 150): number {
  const safeScale = Number.isFinite(scale) ? Math.max(0.5, Math.min(3, scale)) : 1;
  return Math.round(baseSize * safeScale);
}

export function buildOriginalGalleryLayout(
  items: SizedGalleryItem[],
  viewportWidth: number,
  scale = 1
): OriginalGalleryLayout {
  const entries: OriginalGalleryEntry[] = [];
  const rows: OriginalGalleryLayout['rows'] = [];
  const availableWidth = Math.max(1, viewportWidth - OUTER_PADDING);
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  let x = OUTER_PADDING;
  let y = OUTER_PADDING;
  let rowHeight = 0;
  let rowEntries: number[] = [];
  let layoutWidth = viewportWidth;

  const finishRow = () => {
    if (!rowEntries.length) return;
    rows.push({ y, height: rowHeight, entries: rowEntries });
    y += rowHeight + ROW_GAP;
    x = OUTER_PADDING;
    rowHeight = 0;
    rowEntries = [];
  };

  items.forEach((item, index) => {
    const imageWidth = Math.max(1, Math.round(imageDimension(item.width) * safeScale));
    const imageHeight = Math.max(1, Math.round(imageDimension(item.height) * safeScale));
    const showLabel = imageWidth >= 64 && imageHeight >= 32;
    const width = imageWidth + TILE_CHROME_WIDTH;
    const height = imageHeight + (showLabel ? TILE_CHROME_HEIGHT : COMPACT_TILE_CHROME_HEIGHT);
    if (rowEntries.length && x + width > availableWidth) finishRow();
    entries.push({ index, row: rows.length, x, y, width, height, imageWidth, imageHeight, showLabel });
    rowEntries.push(index);
    rowHeight = Math.max(rowHeight, height);
    layoutWidth = Math.max(layoutWidth, x + width + OUTER_PADDING);
    x += width + COLUMN_GAP;
  });
  finishRow();
  return { entries, rows, width: layoutWidth, height: Math.max(0, y) };
}

export function visibleOriginalEntries(
  layout: OriginalGalleryLayout,
  scrollTop: number,
  viewportHeight: number,
  overscan = 300
): OriginalGalleryEntry[] {
  const top = Math.max(0, scrollTop - overscan);
  const bottom = scrollTop + viewportHeight + overscan;
  return layout.entries.filter((entry) => entry.y + entry.height >= top && entry.y <= bottom);
}

export function visibleGridRange(
  count: number,
  columns: number,
  rowHeight: number,
  scrollTop: number,
  viewportHeight: number,
  overscanRows = 3
): { start: number; end: number; totalHeight: number } {
  const safeColumns = Math.max(1, columns);
  const safeRowHeight = Math.max(1, rowHeight);
  const rowCount = Math.ceil(count / safeColumns);
  const startRow = Math.max(0, Math.floor(scrollTop / safeRowHeight) - overscanRows);
  const endRow = Math.min(rowCount, Math.ceil((scrollTop + viewportHeight) / safeRowHeight) + overscanRows);
  return { start: startRow * safeColumns, end: Math.min(count, endRow * safeColumns), totalHeight: rowCount * safeRowHeight };
}

export function gridMoveIndex(index: number, key: string, columns: number, count: number): number {
  if (count <= 0) return -1;
  const current = Math.min(Math.max(index, 0), count - 1);
  const safeColumns = Math.max(1, columns);
  const rowStart = Math.floor(current / safeColumns) * safeColumns;
  const rowEnd = Math.min(count - 1, rowStart + safeColumns - 1);
  if (key === 'ArrowLeft') return Math.max(rowStart, current - 1);
  if (key === 'ArrowRight') return Math.min(rowEnd, current + 1);
  if (key === 'ArrowUp') return Math.max(0, current - safeColumns);
  if (key === 'ArrowDown') return Math.min(count - 1, current + safeColumns);
  return current;
}

export function originalMoveIndex(layout: OriginalGalleryLayout, index: number, key: string): number {
  const current = layout.entries[index];
  if (!current) return layout.entries.length ? 0 : -1;
  const row = layout.rows[current.row];
  const position = row.entries.indexOf(index);
  if (key === 'ArrowLeft') return row.entries[Math.max(0, position - 1)];
  if (key === 'ArrowRight') return row.entries[Math.min(row.entries.length - 1, position + 1)];
  if (key !== 'ArrowUp' && key !== 'ArrowDown') return index;
  const targetRow = layout.rows[current.row + (key === 'ArrowUp' ? -1 : 1)];
  if (!targetRow) return index;
  const center = current.x + current.width / 2;
  return targetRow.entries.reduce((closest, candidate) => {
    const candidateEntry = layout.entries[candidate];
    const closestEntry = layout.entries[closest];
    return Math.abs(candidateEntry.x + candidateEntry.width / 2 - center) <
      Math.abs(closestEntry.x + closestEntry.width / 2 - center)
      ? candidate
      : closest;
  }, targetRow.entries[0]);
}

export function nextSelection(
  selected: Set<string>, ids: string[], clicked: string, modifiers: { toggle: boolean; range: boolean }, anchor?: string
): { selected: Set<string>; anchor: string } {
  const next = new Set(selected);
  if (modifiers.range && anchor && ids.includes(anchor)) {
    const [start, end] = [ids.indexOf(anchor), ids.indexOf(clicked)].sort((a, b) => a - b);
    for (const id of ids.slice(start, end + 1)) next.add(id);
  } else if (modifiers.toggle) {
    next.has(clicked) ? next.delete(clicked) : next.add(clicked);
  } else {
    next.clear();
    next.add(clicked);
  }
  return { selected: next, anchor: clicked };
}

export function stickyClickSelection(selected: Set<string>, clicked: string, armed?: string): { selected: Set<string>; armed?: string } {
  const next = new Set(selected);
  if (next.has(clicked)) {
    next.delete(clicked);
    return { selected: next };
  }
  if (armed === clicked) {
    next.add(clicked);
    return { selected: next };
  }
  return { selected: next, armed: clicked };
}
