import type { CurationLabel } from '$lib/api/types';

export type CurationTaxonomyRow = {
  label: CurationLabel;
  depth: number;
  hasChildren: boolean;
  ancestorIds: string[];
};

function labelName(label: CurationLabel): string {
  return label.display_name || label.name;
}

/** Build a deterministic preorder while keeping orphaned or cyclic labels visible. */
export function buildCurationTaxonomy(labels: CurationLabel[]): CurationTaxonomyRow[] {
  const byId = new Map(labels.map((label) => [label.id, label]));
  const children = new Map<string, CurationLabel[]>();
  const roots: CurationLabel[] = [];
  const compare = (left: CurationLabel, right: CurationLabel) =>
    labelName(left).localeCompare(labelName(right), undefined, { sensitivity: 'base' });

  for (const label of labels) {
    const parentId = label.parent_label_id;
    if (!parentId || parentId === label.id || !byId.has(parentId)) {
      roots.push(label);
      continue;
    }
    children.set(parentId, [...(children.get(parentId) ?? []), label]);
  }
  roots.sort(compare);
  for (const descendants of children.values()) descendants.sort(compare);

  const rows: CurationTaxonomyRow[] = [];
  const visited = new Set<string>();
  const visit = (label: CurationLabel, ancestorIds: string[]) => {
    if (visited.has(label.id)) return;
    visited.add(label.id);
    const descendants = (children.get(label.id) ?? []).filter(
      (child) => !ancestorIds.includes(child.id) && child.id !== label.id
    );
    rows.push({
      label,
      depth: ancestorIds.length,
      hasChildren: descendants.length > 0,
      ancestorIds
    });
    for (const child of descendants) visit(child, [...ancestorIds, label.id]);
  };

  for (const root of roots) visit(root, []);
  for (const label of [...labels].sort(compare)) visit(label, []);
  return rows;
}

export function visibleCurationTaxonomy(
  rows: CurationTaxonomyRow[],
  expandedIds: Set<string>
): CurationTaxonomyRow[] {
  return rows.filter((row) => row.ancestorIds.every((id) => expandedIds.has(id)));
}

export function expandableCurationLabelIds(rows: CurationTaxonomyRow[]): Set<string> {
  return new Set(rows.filter((row) => row.hasChildren).map((row) => row.label.id));
}
