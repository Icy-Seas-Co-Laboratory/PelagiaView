import type { DescriptorTag } from './types';

function searchText(tag: DescriptorTag): string {
  const concept = tag.metadata?.concept || {};
  const mappings = (concept.mappings || []).flatMap((mapping: any) => [mapping.authority, mapping.scheme, mapping.identifier]);
  return [tag.tag_id, tag.name, tag.concept_type, concept.id, concept.name, ...mappings]
    .filter(Boolean).join(' ').toLocaleLowerCase();
}

export function descriptorOptions(
  tags: DescriptorTag[], scope: 'target_tags' | 'image_tags', assignedIds: Set<string>, query: string, limit = 12
): DescriptorTag[] {
  const normalized = query.trim().toLocaleLowerCase();
  return tags.filter((tag) => tag.scope === scope && tag.selectable && !tag.deprecated_at && !assignedIds.has(tag.tag_id))
    .filter((tag) => !normalized || searchText(tag).includes(normalized))
    .sort((a, b) => {
      const preferred = Number(b.preferred) - Number(a.preferred);
      const starts = Number(!a.name.toLocaleLowerCase().startsWith(normalized)) - Number(!b.name.toLocaleLowerCase().startsWith(normalized));
      return preferred || starts || a.name.localeCompare(b.name);
    }).slice(0, limit);
}

export function canCreateDescriptor(tags: DescriptorTag[], scope: 'target_tags' | 'image_tags', query: string): boolean {
  const name = query.trim();
  return !!name && !tags.some((tag) => tag.scope === scope && tag.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0);
}
