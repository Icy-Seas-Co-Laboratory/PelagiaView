import type { CoreVocabulary, Label, VocabularyNode } from './types';

export type AssignmentOption = {
  key: string;
  name: string;
  detail: string;
  preferred: boolean;
  label?: Label;
  concept?: VocabularyNode;
  vocabularyKey?: string;
  vocabularyName?: string;
};

function searchableConcept(concept: VocabularyNode): string {
  const mappings = (concept.mappings || []).flatMap((mapping) => [mapping.authority, mapping.identifier]);
  return [concept.id, concept.name, concept.display_name, concept.scientific_name, concept.rank, ...mappings]
    .filter(Boolean).join(' ').toLocaleLowerCase();
}

export function assignmentOptions(
  labels: Label[], vocabularies: CoreVocabulary[], query: string, limit = 14
): AssignmentOption[] {
  const normalized = query.trim().toLocaleLowerCase();
  const materialized = new Set(labels.filter((label) => label.standard_concept_id).map((label) => `${label.standard_vocabulary_key || 'pelagia-core@0.1.0'}:${label.standard_concept_id}`));
  const datasetOptions: AssignmentOption[] = labels.filter((label) => !label.deprecated_at).map((label) => ({
    key: `label:${label.label_id}`,
    name: label.display_name || label.name,
    detail: label.preferred ? `${label.metadata?.registry?.vocabulary?.name || 'Standard vocabulary'} · in dataset` : 'Dataset label',
    preferred: !!label.preferred,
    label
  }));
  const standardOptions: AssignmentOption[] = vocabularies.flatMap((vocabulary) => vocabulary.taxonomy.nodes
    .filter((concept) => concept.selectable !== false && !materialized.has(`${vocabulary.catalog_key}:${concept.id}`))
    .map((concept) => ({
      key: `concept:${vocabulary.catalog_key}:${concept.id}`,
      name: concept.display_name || concept.name,
      detail: [concept.scientific_name, concept.rank, `${vocabulary.vocabulary.name} v${vocabulary.vocabulary.version}`].filter(Boolean).join(' · '),
      preferred: true,
      concept,
      vocabularyKey: vocabulary.catalog_key,
      vocabularyName: vocabulary.vocabulary.name
    })));
  return [...datasetOptions, ...standardOptions]
    .filter((option) => !normalized || `${option.name} ${option.label?.name || ''} ${option.concept ? searchableConcept(option.concept) : ''}`.toLocaleLowerCase().includes(normalized))
    .sort((a, b) => {
      const aStarts = a.name.toLocaleLowerCase().startsWith(normalized) ? 0 : 1;
      const bStarts = b.name.toLocaleLowerCase().startsWith(normalized) ? 0 : 1;
      return aStarts - bStarts || a.name.localeCompare(b.name);
    }).slice(0, limit);
}
