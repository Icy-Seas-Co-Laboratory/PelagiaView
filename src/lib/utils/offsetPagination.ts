export type OffsetPage<T> = {
  items: readonly T[];
  nextOffset?: number | null;
};

/** Collect offset pages without accepting a non-advancing server cursor. */
export async function collectOffsetPages<T>(
  fetchPage: (offset: number) => Promise<OffsetPage<T>>,
  errorLabel = 'Pagination'
): Promise<T[]> {
  const items: T[] = [];
  let offset = 0;
  while (true) {
    const page = await fetchPage(offset);
    items.push(...page.items);
    const nextOffset = page.nextOffset;
    if (nextOffset === null || nextOffset === undefined) return items;
    if (nextOffset <= offset) throw new Error(`${errorLabel} pagination did not advance.`);
    offset = nextOffset;
  }
}
