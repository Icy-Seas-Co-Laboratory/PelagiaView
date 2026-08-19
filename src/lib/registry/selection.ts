export function nextSelection(
  selected: Set<string>, ids: string[], clicked: string, modifiers: { toggle: boolean; range: boolean }, anchor?: string
): { selected: Set<string>; anchor: string } {
  const next = new Set(selected);
  if (modifiers.range && anchor && ids.includes(anchor)) {
    const [a, b] = [ids.indexOf(anchor), ids.indexOf(clicked)].sort((x, y) => x - y);
    for (const id of ids.slice(a, b + 1)) next.add(id);
  } else if (modifiers.toggle) {
    next.has(clicked) ? next.delete(clicked) : next.add(clicked);
  } else {
    next.clear(); next.add(clicked);
  }
  return { selected: next, anchor: clicked };
}

export function stickyClickSelection(
  selected: Set<string>, clicked: string, armed?: string
): { selected: Set<string>; armed?: string } {
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
