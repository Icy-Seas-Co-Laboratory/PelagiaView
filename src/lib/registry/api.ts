import { getClient } from '$lib/stores/session';
import type {
  CoreVocabulary,
  Dataset,
  DatasetDetails,
  DescriptorTag,
  EvidenceSource,
  FileListing,
  ImportPreview,
  ImportResult,
  Item,
  ItemEvidence,
  Label,
  RegistryWorkspace,
  VocabularySummary
} from './types';

function client() {
  const value = getClient();
  if (!value) throw new Error('Connect to Pelagia before opening Registry.');
  return value;
}

function route(path: string): string {
  return `/registry${path.replace(/^\/api/, '')}`;
}

type TransferJob = {
  id: string; status: string; summary?: string; progress?: { message?: string; percent?: number | null };
  result?: Record<string, any>; error_message?: string;
};

async function waitForTransfer(job: TransferJob, onProgress?: (message: string) => void): Promise<TransferJob> {
  let current = job;
  while (!['succeeded', 'failed', 'cancelled', 'dead_lettered'].includes(current.status)) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    current = (await client().get<{ job: TransferJob }>(`/jobs/${encodeURIComponent(current.id)}`)).job;
    if (current.progress?.message) onProgress?.(current.progress.message);
  }
  if (current.status !== 'succeeded') throw new Error(current.error_message || current.summary || `Registry transfer ${current.status}`);
  return current;
}

export function registryUrl(path: string): string {
  const value = getClient();
  const resolved = route(path);
  return value ? value.resolveApiUrl(resolved) : resolved;
}

export const api = {
  files: (path?: string) => client().get<FileListing>(route('/api/files') + (path ? `?path=${encodeURIComponent(path)}` : '')),
  open: async (path: string, onProgress?: (message: string) => void) => {
    const queued = await client().post<{ job: TransferJob }>(route('/api/dataset/open'), { path, migrate: true, backup: true, thaw_frozen: true });
    await waitForTransfer(queued.job, onProgress);
    return client().get<Dataset>(route('/api/dataset'));
  },
  workspaces: async () => (await client().get<{ workspaces: RegistryWorkspace[] }>(route('/api/workspaces'))).workspaces,
  activateWorkspace: (workspaceId: string) => client().post<Dataset>(route(`/api/workspaces/${encodeURIComponent(workspaceId)}/activate`)),
  dataset: () => client().get<Dataset>(route('/api/dataset')),
  datasetDetails: () => client().get<DatasetDetails>(route('/api/dataset/details')),
  exportDataset: async (path: string, replace_source = false, onProgress?: (message: string) => void) => {
    const queued = await client().post<{ job: TransferJob }>(route('/api/dataset/export'), { path, replace_source });
    const finished = await waitForTransfer(queued.job, onProgress);
    return finished.result as { path: string; sha256: string; revision_id: string; backup_path?: string };
  },
  purgeDataset: () => client().delete<{ workspace_id: string; status: string; deleted_rows: number }>(route('/api/dataset')),
  importPreview: (path: string) => client().post<ImportPreview>(route('/api/import/preview'), { path }),
  importDataset: (body: { path: string; include_labels: boolean; include_evidence: boolean; duplicate_policy: 'skip' | 'merge'; duplicate_actions: Record<string, 'skip' | 'merge'> }) => client().post<ImportResult>(route('/api/import/execute'), body),
  labels: () => client().get<Label[]>(route('/api/labels')),
  vocabulary: () => client().get<CoreVocabulary>(route('/api/vocabulary')),
  vocabularies: () => client().get<VocabularySummary[]>(route('/api/vocabularies')),
  reloadVocabularies: () => client().post<VocabularySummary[]>(route('/api/vocabularies/reload')),
  installedVocabulary: (key: string) => client().get<CoreVocabulary>(route(`/api/vocabularies/${encodeURIComponent(key)}`)),
  useStandardLabel: (conceptId: string, vocabularyKey = 'pelagia-core@0.1.0') => client().post<Label>(route(`/api/vocabularies/${encodeURIComponent(vocabularyKey)}/taxonomy/${encodeURIComponent(conceptId)}`)),
  tags: () => client().get<DescriptorTag[]>(route('/api/tags')),
  addTag: (body: { name: string; scope: 'target_tags' | 'image_tags' }) => client().post<DescriptorTag>(route('/api/tags'), body),
  setTag: (item_ids: string[], tag_id: string, assigned: boolean) => client().post(route('/api/item-tags/bulk'), { item_ids, tag_id, assigned }),
  items: (params: URLSearchParams) => client().get<{ items: Item[]; total: number }>(route('/api/items') + '?' + params.toString()),
  evidenceSources: () => client().get<EvidenceSource[]>(route('/api/evidence/sources')),
  itemEvidence: (id: string, sourceKey?: string) => client().get<ItemEvidence[]>(route(`/api/evidence/items/${id}`) + (sourceKey ? `?source_key=${encodeURIComponent(sourceKey)}` : '')),
  similar: (id: string, sourceKey: string, limit: number, offset: number, minimum: number) => client().get<{ items: Item[]; total: number }>(route(`/api/similarity/${id}`) + `?source_key=${encodeURIComponent(sourceKey)}&limit=${limit}&offset=${offset}&minimum=${minimum}`),
  neighbors: (id: string, sourceKey: string) => client().get<{ items: Item[]; total: number }>(route(`/api/evidence/neighbors/${id}`) + `?source_key=${encodeURIComponent(sourceKey)}`),
  item: (id: string) => client().get<Record<string, any>>(route(`/api/items/${id}`)),
  addLabel: (body: Record<string, unknown>) => client().post<Label>(route('/api/labels'), body),
  updateLabel: (id: string, body: Record<string, unknown>) => client().patch<Label>(route(`/api/labels/${id}`), body),
  reassignLabel: (source_label_id: string, target_label_id: string, deprecate_source = true) => client().post<{ reassigned_count: number; source_deprecated: boolean }>(route('/api/labels/reassign'), { source_label_id, target_label_id, deprecate_source }),
  annotate: (item_ids: string[], label_id: string) => client().post(route('/api/annotations/bulk'), { item_ids, label_id }),
  removeLabels: (item_ids: string[]) => client().post(route('/api/annotations/remove/bulk'), { item_ids }),
  review: (item_ids: string[], decision: string) => client().post(route('/api/reviews/bulk'), { item_ids, decision }),
  undo: () => client().post(route('/api/undo'), {})
};
