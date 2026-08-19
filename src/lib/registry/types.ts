export type Label = {
  label_id: string; name: string; display_name?: string; deprecated_at?: string;
  parent_label_id?: string; item_count: number; verified_count: number;
  unverified_count: number; ml_count: number; standard_concept_id?: string;
  standard_vocabulary_key?: string;
  preferred?: boolean; metadata: Record<string, any>;
};

export type VocabularyNode = {
  id: string; name: string; display_name?: string; scientific_name?: string;
  parent_id?: string; concept_type?: string; rank?: string; selectable?: boolean;
  exclusive_within_parent?: boolean;
  mappings?: Array<{ authority: string; scheme: string; identifier: string; uri?: string; relationship?: string }>;
};

export type CoreVocabulary = {
  catalog_key: string; filename: string;
  vocabulary: { id: string; name: string; version: string; status: string; description: string };
  sources: Array<{ id: string; name: string; organization: string; authority_type: string; version?: string }>;
  taxonomy: { name: string; description: string; nodes: VocabularyNode[] };
  target_tags: { name: string; description: string; nodes: VocabularyNode[] };
  image_tags: { name: string; description: string; nodes: VocabularyNode[] };
};

export type VocabularySummary = {
  key: string; filename: string;
  vocabulary: CoreVocabulary['vocabulary'];
  taxonomy_count: number; target_tag_count: number; image_tag_count: number;
};

export type EvidenceSource = {
  source_key: string; source_kind: 'oracle' | 'registry'; source_name: string;
  item_count: number; embedding_count: number; confidence_count: number;
  knn_count: number; prototype_count: number;
  capabilities: { confidence: boolean; knn: boolean; prototype: boolean; embedding: boolean };
};

export type ItemEvidence = {
  source_key: string; source_kind: string; source_name: string; item_id: string;
  predicted_label_id?: string; prediction_confidence?: number;
  prototype_label_id?: string; prototype_similarity?: number; prototype_margin?: number;
  knn_label_id?: string; nearest_neighbor_similarity?: number; top_k_label_agreement?: number;
  weighted_label_support?: number; label_margin?: number; embedding_available: number;
  neighbors: Array<{ uuid: string; label?: number; similarity: number }>;
};

export type DescriptorTag = {
  tag_id: string; scope: 'target_tags' | 'image_tags'; name: string; parent_tag_id?: string;
  concept_type?: string; selectable: boolean; exclusive_within_parent: boolean;
  preferred: boolean; item_count: number; metadata: Record<string, any>;
  deprecated_at?: string;
};

export type SpatialBox = { x: number; y: number; w: number; h: number };

export type Item = {
  item_id: string; source_key?: string; shape?: number[]; metadata: Record<string, unknown>;
  coordinate_space?: string; bbox?: SpatialBox; crop_bbox?: SpatialBox;
  spatial_metadata?: Record<string, unknown>;
  descriptor_indicators?: Array<{ tag_id: string; scope: 'target_tags' | 'image_tags'; name: string }>;
  image_width?: number; image_height?: number; pixel_area?: number; longest_side?: number;
  annotation_id?: string; label_id?: string; label_name?: string; label_display_name?: string;
  annotator?: string; annotation_created_at?: string; review_decision?: string;
  annotation_status?: string; annotation_source?: string; label_origin?: 'classification' | 'workspace';
  evidence_source?: string; ml_predicted_label_id?: string; prediction_confidence?: number;
  prototype_similarity?: number; prototype_margin?: number; nearest_neighbor_similarity?: number;
  top_k_label_agreement?: number; weighted_label_support?: number; label_margin?: number;
  embedding_available?: number; similarity?: number;
};

export type Dataset = {
  dataset_id: string; revision_id: string; dataset_type: string; name: string; title?: string;
  lifecycle: string; path: string; backup_path?: string; thawed_from_path?: string;
  workspace_id?: string; dirty?: boolean;
  stats: { total: number; labeled: number; unlabeled: number; verified: number; needs_review: number; active_labels: number };
  label_distribution: Array<{ label_id: string; display_name: string; count: number }>;
  physical_scale: { available: boolean; calibrated_items: number; total_items: number; reference_um_per_pixel?: number };
};

export type RegistryWorkspace = {
  workspace_id: string; dataset_id: string; revision_id: string; parent_revision_id?: string;
  dataset_type: string; name: string; title?: string; description?: string; version?: string;
  lifecycle: string; source_path: string; source_size_bytes: number; status: string;
  is_active: boolean; dirty_at?: string; loaded_at: string; exported_at?: string;
  last_export_path?: string; contract_schema_version: string;
  item_count: number; labeled_count: number;
};

export type InferenceSourceDetail = {
  source_key: string; source_kind: 'oracle' | 'registry'; name: string;
  evidence: EvidenceSource & { aggregates?: Record<string, number | null> };
  performance_metrics: Record<string, string | number>;
  model?: Record<string, any>; run?: Record<string, any>; legacy?: Record<string, any>;
};

export type DatasetDetails = {
  dataset: Record<string, any>; summary: Dataset;
  database: {
    path: string; size_bytes: number; schema: Record<string, any>; table_count: number;
    tables: string[]; counts: Record<string, number>;
  };
  asset_formats: Array<{ media_type: string; encoding: string; count: number }>;
  recent_events: Array<Record<string, any>>;
  inference_sources: InferenceSourceDetail[];
};

export type ImportDuplicate = {
  source_item_id: string; source_key?: string; target_item_id: string;
  matching_item_ids: string[]; reasons: Array<'uuid' | 'roi_hash'>;
  roi_hash?: string; metadata_conflicts: string[];
};

export type ImportPreview = {
  source: { path: string; dataset_id: string; name: string; dataset_type: string; lifecycle: string; schema_version: string; size_bytes: number };
  total_items: number; new_items: number; duplicate_count: number; duplicates: ImportDuplicate[];
  labels: { available: boolean; annotation_count: number };
  descriptors: { available: boolean; annotation_count: number };
  evidence: { available: boolean; registry_count: number; legacy_count: number };
};

export type ImportResult = {
  imported_items: number; merged_items: number; skipped_items: number; metadata_conflicts: number;
  imported_labels: number; label_conflicts: number; imported_descriptors: number; imported_evidence: number;
  backup_path: string; source_path: string;
};

export type FileEntry = {
  name: string; path: string; is_directory: boolean; size?: number; modified_at: string;
};

export type FileListing = {
  current_path: string; parent_path?: string; root_path: string; roots: string[]; entries: FileEntry[];
};
