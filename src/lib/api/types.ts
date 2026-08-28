export type HealthResponse = {
  status: string;
  postgres_configured?: boolean;
  kvstore_configured?: boolean;
};

export type KvStoreStatus = Record<string, unknown> & {
  initialized?: boolean;
  total_file_bytes?: number | string;
  total_physical_file_bytes?: number | string;
  total_storage_file_bytes?: number | string;
  total_sqlite_file_bytes?: number | string;
  total_blob_file_bytes?: number | string;
  total_index_file_bytes?: number | string;
  total_stored_payload_bytes?: number | string;
  largest_blob_file_size?: number | string;
  largest_blob_file_bytes?: number | string;
  largest_blob_bytes?: number | string;
  deep?: boolean;
};

export type SystemStatus = {
  postgres?: Record<string, unknown>;
  kvstore?: KvStoreStatus;
  queue?: Record<string, number>;
  workers?: Record<string, number>;
};

export type SystemUsageFilesystem = {
  available?: boolean;
  configured_path?: string;
  resolved_path?: string;
  probe_path?: string;
  path_exists?: boolean;
  total_bytes?: number | null;
  used_bytes?: number | null;
  free_bytes?: number | null;
  used_percent?: number | null;
  free_percent?: number | null;
  reason?: string;
};

export type SystemUsageResponse = {
  reported_at?: string;
  host?: Record<string, unknown>;
  cpu?: {
    logical_cpus?: number | null;
    physical_cpus?: number | null;
    utilization_percent?: number | null;
    load_average?: {
      one_minute?: number | null;
      five_minutes?: number | null;
      fifteen_minutes?: number | null;
    } | null;
  };
  memory?: {
    total_bytes?: number | null;
    used_bytes?: number | null;
    available_bytes?: number | null;
    used_percent?: number | null;
    available_percent?: number | null;
    swap_total_bytes?: number | null;
    swap_used_bytes?: number | null;
    swap_used_percent?: number | null;
    source?: string;
  };
  process?: Record<string, unknown>;
  storage?: {
    kvstore_directory?: SystemUsageFilesystem;
    raw_assets_default?: SystemUsageFilesystem;
    database?: {
      connection?: Record<string, unknown>;
      storage?: {
        available?: boolean;
        database_name?: string | null;
        database_bytes?: number | null;
        data_directory?: string | null;
        filesystem?: SystemUsageFilesystem;
        reason?: string;
      };
    };
    [key: string]: unknown;
  };
  stress?: {
    status?: 'ok' | 'warning' | 'critical' | string;
    alerts?: Array<{
      level?: 'warning' | 'critical' | string;
      metric?: string;
      message?: string;
    }>;
  };
};

export type SystemConfigResponse = {
  effective?: {
    processing?: {
      segmentation?: Record<string, unknown>;
      thresholding?: Record<string, unknown>;
      flatfield?: Record<string, unknown>;
      preprocessing?: Record<string, unknown>;
      mask_augmentation?: Record<string, unknown>;
      roi_assembly?: Record<string, unknown>;
      roi_filter?: Record<string, unknown>;
      roi_recording?: Record<string, unknown>;
      roi_refinement?: Record<string, unknown>;
      video_ingest?: Record<string, unknown>;
      frame_storage?: Record<string, unknown>;
    };
    [key: string]: unknown;
  };
  defaults?: Record<string, unknown>;
};

export type SystemCapabilitiesResponse = {
  name?: string;
  version?: string;
  supported?: {
    image_encodings?: string[];
    image_codec_availability?: Record<string, boolean>;
    image_storage_policy?: {
      allowed_encodings?: string[];
      unavailable_encodings?: string[];
    };
    roi_encoding_options?: string[];
    [key: string]: unknown;
  };
  processing?: Record<string, unknown>;
  jobs?: Record<string, unknown>;
  storage?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ProjectSummary = {
  id: string;
  project_key?: string;
  project_name?: string | null;
  name?: string | null;
  description?: string | null;
  kvstore_root_path?: string | null;
  settings?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  role?: string | null;
  membership_role?: string | null;
  is_active?: boolean;
};

export type ProjectStorageSettingsRequest = {
  frame_encoding?: string | null;
  frame_quality?: number | null;
  small_roi_encoding?: string | null;
  large_roi_encoding?: string | null;
  large_roi_min_pixels?: number | null;
  roi_quality?: number | null;
  mask_encoding?: string | null;
};

export type ProjectStorageSettings = {
  frame?: {
    encoding?: string | null;
    quality?: number | string | null;
  };
  roi?: {
    small_encoding?: string | null;
    large_encoding?: string | null;
    large_min_pixels?: number | string | null;
    quality?: number | string | null;
    mask_encoding?: string | null;
  };
  sources?: {
    frame_encoding?: string | null;
    frame_quality?: string | null;
    small_roi_encoding?: string | null;
    large_roi_encoding?: string | null;
    large_roi_min_pixels?: string | null;
    roi_quality?: string | null;
    mask_encoding?: string | null;
  };
};

export type ProjectStorageSettingsResponse = {
  project?: ProjectSummary;
  project_id?: string;
  configured?: Record<string, unknown>;
  effective?: ProjectStorageSettings;
};

export type AuthUserSummary = {
  id: string;
  username: string;
  display_name?: string | null;
  is_admin?: boolean;
  is_active?: boolean;
  project_id?: string | null;
  project_role?: string | null;
  role?: string | null;
  metadata?: Record<string, unknown>;
};

export type ProjectMembershipSummary = {
  id?: string;
  user_id?: string;
  project_id?: string;
  role?: string | null;
  [key: string]: unknown;
};

export type AuthSessionSummary = {
  id?: string;
  user_id?: string;
  project_id?: string;
  project_key?: string;
  project_name?: string | null;
  project_role?: string | null;
  expires_at?: string | null;
  [key: string]: unknown;
};

export type AuthLoginResponse = {
  token: string;
  session?: AuthSessionSummary;
  user?: AuthUserSummary;
  project?: ProjectSummary | null;
  project_creation_required?: boolean;
  project_created?: boolean;
  kvstore?: Record<string, unknown> | null;
};

export type AuthMeResponse = {
  auth?: {
    user_id?: string;
    username?: string;
    project_id?: string;
    project_key?: string;
    role?: string;
    is_admin?: boolean;
    session_id?: string | null;
    [key: string]: unknown;
  };
  user?: AuthUserSummary;
  project?: ProjectSummary;
  projects?: ProjectSummary[];
};

export type KvStoreOverview = {
  root_path?: string;
  configured_hash_algorithm?: string;
  configured_prefix_length?: number;
  total_sqlite_file_bytes?: number;
  status?: KvStoreStatus;
  health?: Record<string, unknown>;
};

export type KvStoreOverviewOptions = {
  deep_status?: boolean;
  include_health?: boolean;
};

export type Job = {
  id: string;
  stage?: string;
  status?: string;
  run_id?: string | null;
  asset_id?: string | null;
  worker_id?: string | null;
  submitted_by_user_id?: string | null;
  submitted_by_username?: string | null;
  priority?: number;
  attempts?: number;
  attempt_count?: number;
  max_attempts?: number;
  summary?: string | null;
  created_at?: string;
  updated_at?: string;
  started_at?: string | null;
  finished_at?: string | null;
  lease_expires_at?: string | null;
  progress?: JobProgress | null;
  error_message?: string | null;
  control_reason?: string | null;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
};

/** A reproducible, ordered submission of one or more processing stages. */
export type JobSeriesStep = {
  id?: string;
  stage: string;
  enabled?: boolean;
  options?: Record<string, unknown>;
  status?: string | null;
  job_ids?: string[];
  progress?: JobProgress | null;
  error_message?: string | null;
  skip_reason?: string | null;
};

export type JobSeriesTarget = {
  asset_ids?: string[];
  collections?: string[];
  frame_ids?: string[];
  start_frame?: number | null;
  end_frame?: number | null;
};

export type JobSeriesPresetSnapshot = {
  preset_id?: string | null;
  preset_name?: string | null;
  source?: string | null;
  captured_at?: string | null;
  settings?: Record<string, unknown>;
};

export type JobSeriesFailurePolicy = 'continue' | 'fail_fast';

export type JobSeriesRequest = {
  targets: JobSeriesTarget;
  preset_snapshot: JobSeriesPresetSnapshot;
  steps: JobSeriesStep[];
  priority?: number | null;
  failure_policy?: JobSeriesFailurePolicy;
  dry_run?: boolean;
};

export type JobSeriesEligibility = {
  eligible_count?: number | string | null;
  ineligible_count?: number | string | null;
  selected_asset_count?: number | string | null;
  selected_frame_count?: number | string | null;
  by_step?: Array<{
    stage?: string;
    eligible_count?: number | string | null;
    ineligible_count?: number | string | null;
    reasons?: Record<string, number | string>;
  }>;
  sample_frame_ids?: string[];
};

export type JobSeriesProgress = JobProgress & {
  unit_lineage?: Array<Record<string, unknown>>;
};

export type JobSeries = {
  id: string;
  status?: string | null;
  targets?: JobSeriesTarget;
  selection?: JobSeriesTarget;
  preset_snapshot?: JobSeriesPresetSnapshot | null;
  steps?: JobSeriesStep[];
  priority?: number | null;
  failure_policy?: JobSeriesFailurePolicy | string | null;
  dry_run?: boolean;
  progress?: JobSeriesProgress | null;
  job_ids?: string[];
  created_at?: string | null;
  updated_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  error_message?: string | null;
};

export type JobSeriesListOptions = {
  status?: string | string[] | null;
  limit?: number | null;
  offset?: number | null;
  include_details?: boolean;
};

export type JobSeriesSubmitResponse = {
  series?: JobSeries;
  eligibility?: JobSeriesEligibility;
  dry_run?: boolean;
};

export type RunSummary = {
  id?: string | null;
  run_id?: string | null;
  run_key?: string | null;
  status?: string | null;
  source_path?: string | null;
  source_type?: string | null;
};

export type JobProgress = {
  schema_version?: number;
  stage?: string;
  unit?: string;
  total?: number | string | null;
  completed?: number | string | null;
  failed?: number | string | null;
  skipped?: number | string | null;
  percent?: number | string | null;
  current?: Record<string, unknown>;
  secondary?: Record<string, unknown>;
  rates?: Record<string, number | string | null>;
  message?: string | null;
};

export type JobAggregateProgress = {
  known_total_units?: number | string | null;
  completed_units?: number | string | null;
  failed_units?: number | string | null;
  skipped_units?: number | string | null;
  percent?: number | string | null;
};

export type JobAggregateSummary = {
  stage?: string | null;
  status?: string | null;
  job_count?: number | string | null;
  queued?: number | string | null;
  leased?: number | string | null;
  working?: number | string | null;
  paused?: number | string | null;
  succeeded?: number | string | null;
  failed?: number | string | null;
  cancelled?: number | string | null;
  dead_lettered?: number | string | null;
  progress?: JobAggregateProgress | null;
};

export type JobsSummaryResponse = {
  filters?: Record<string, unknown>;
  total?: JobAggregateSummary;
  by_stage?: JobAggregateSummary[];
  by_status?: JobAggregateSummary[];
  recent_jobs?: Job[];
};

export type JobsClearOptions = {
  run_id?: string | null;
  asset_id?: string | null;
  status?: string[] | null;
  stage?: string[] | null;
  ids?: string[] | null;
  worker_id?: string | null;
  reason?: string | null;
  mode?: 'cancel' | 'delete';
  dry_run?: boolean;
};

export type JobsClearResponse = {
  matched_count?: number | string | null;
  cancellable_count?: number | string | null;
  cancelled_count?: number | string | null;
  deleted_count?: number | string | null;
  dry_run?: boolean;
  jobs?: Job[];
};

export type JobsControlOptions = {
  action: 'pause' | 'resume';
  run_id?: string | null;
  asset_id?: string | null;
  stage?: string[] | null;
  ids?: string[] | null;
  worker_id?: string | null;
  reason?: string | null;
};

export type JobsControlResponse = {
  matched_count?: number | string | null;
  paused_count?: number | string | null;
  pause_requested_count?: number | string | null;
  resumed_count?: number | string | null;
  jobs?: Job[];
};

export type JobListOptions = {
  run_id?: string | null;
  asset_id?: string | null;
  status?: string | string[] | null;
  stage?: string | string[] | null;
  ids?: string[] | null;
  worker_id?: string | null;
  limit?: number | null;
  offset?: number | null;
  include_details?: boolean;
  include_progress?: boolean;
  include_payload?: boolean;
  include_result?: boolean;
  sort?: string;
  direction?: 'asc' | 'desc';
};

export type JobEventListOptions = {
  after_id?: number | null;
  run_id?: string | null;
  job_id?: string | null;
  limit?: number | null;
  offset?: number | null;
};

export type JobsSummaryOptions = {
  run_id?: string | null;
  asset_id?: string | null;
  status?: string | string[] | null;
  stage?: string | string[] | null;
  ids?: string[] | null;
  worker_id?: string | null;
  include_recent?: boolean;
  recent_limit?: number;
};

export type WorkerSession = {
  id: string;
  worker_id?: string;
  status?: string;
  capability?: string;
  capabilities?: string | string[];
  current_job_id?: string | null;
  shutdown_requested?: boolean;
  last_heartbeat?: string | null;
  last_heartbeat_at?: string | null;
  started_at?: string | null;
  metadata?: Record<string, unknown>;
};

export type RawAsset = {
  id: string;
  project_id?: string | null;
  run_id?: string | null;
  filename?: string;
  path?: string;
  kind?: string;
  size_bytes?: number;
  checksum?: string;
  collections?: string[];
  media_count?: number | null;
  frame_count?: number;
  created_at?: string;
  metadata?: Record<string, unknown>;
};

export type AssetUpdateRequest = {
  collections?: string[] | string | null;
};

export type AssetDeleteResponse = {
  status?: string;
  asset_id?: string;
  asset?: RawAsset;
  frame_count?: number | string | null;
  generated_kvstore_keys?: string[];
  deleted_kvstore_keys?: Array<{
    key?: string;
    deleted?: boolean;
    missing?: boolean;
  }>;
};

export type AnalyzedIngestionAsset = {
  asset_id?: string | null;
  filename?: string | null;
  path: string;
  kind: 'video' | 'image_sequence' | 'interchange' | string;
  size_bytes?: number | null;
  checksum?: string | null;
  checksum_status?: string | null;
  collections?: string[];
  media_count?: number | null;
  metadata?: Record<string, unknown>;
  warnings?: string[];
};

export type AnalyzeIngestionRequest = {
  source_path: string;
  kind?: 'auto' | 'video' | 'image_sequence' | 'interchange' | string;
  recursive?: boolean;
  compute_checksum?: boolean;
  collections?: string | string[] | null;
  n_tile?: number | null;
  image_encoding?: 'zstd' | 'jxl' | 'jxs' | 'jpg' | 'png' | 'raw' | string | null;
  image_quality?: number | null;
  generate_backgrounds?: boolean | null;
  generate_flatfield_profiles?: boolean | null;
  flatfield_axis?: number | null;
  background_window_stride?: number | null;
  background_window_width?: number | null;
  flatfield_window_stride?: number | null;
  flatfield_window_width?: number | null;
  background_encoding?: 'zstd' | 'jxl' | 'jxs' | 'jpg' | 'png' | 'raw' | string | null;
  background_quality?: number | null;
  metadata?: Record<string, unknown>;
};

export type AnalyzeIngestionResponse = {
  source_path?: string;
  kind?: string;
  recursive?: boolean;
  asset_count?: number;
  assets?: AnalyzedIngestionAsset[];
  defaults?: Record<string, unknown>;
  suggested_ingestion_request?: QueueAssetsRequest;
};

export type TelemetryUnitCatalogEntry = {
  canonical_unit: string;
  dimension: string;
  aliases?: string[];
  scale_to_reference?: number;
  offset_to_reference?: number;
};

export type TelemetryCatalogResponse = {
  unit_registry?: { name?: string; version?: string; units?: TelemetryUnitCatalogEntry[] };
  parameters?: Array<Record<string, unknown>>;
  sensors?: Array<Record<string, unknown>>;
  interpolation_methods?: string[];
};

export type TelemetryValue = {
  parameter?: string;
  unit?: string | null;
  value?: number | null;
  observed_at?: string | null;
  method?: string | null;
  missing_reason?: string | null;
  source_observed_at?: string[];
  gap_seconds?: number | null;
  qc_flags?: Array<number | null>;
};

export type TelemetryRangeFilter = {
  parameter_key: string;
  min_value?: number | null;
  max_value?: number | null;
};

export type TelemetryAnalyzeRequest = {
  path: string;
  timestamp_column?: string | null;
  timestamp_format?: string;
  source_timezone?: string;
  delimiter?: string;
  sample_limit?: number;
};

export type TelemetryAnalyzeResponse = {
  path?: string;
  filename?: string;
  size_bytes?: number;
  columns?: string[];
  timestamp_column?: string;
  timestamp_format?: string | null;
  source_timezone?: string;
  row_count?: number;
  time_range?: { start?: string | null; end?: string | null; duration_seconds?: number | null };
  sampling?: { median_interval_seconds?: number | null; min_interval_seconds?: number | null; max_interval_seconds?: number | null };
  timestamp_diagnostics?: { valid?: boolean; invalid_count?: number; invalid_examples?: Array<Record<string, unknown>>; duplicate_count?: number; non_monotonic_count?: number };
  column_stats?: Array<{ column?: string; missing?: number; numeric?: number; invalid_numeric?: number; sample?: number[] }>;
  preview_rows?: Array<{ row?: number; timestamp?: string | null; values?: Record<string, unknown> }>;
};

export type TelemetryImportRequest = {
  path: string;
  timestamp_column: string;
  streams: Array<Record<string, unknown>>;
  timestamp_format?: string;
  source_timezone?: string;
  delimiter?: string;
  parser_name?: string;
  parser_version?: string;
  collections?: string[] | null;
  metadata?: Record<string, unknown>;
};

export type QueueIngestionAssetRequest = Omit<AnalyzedIngestionAsset, 'collections'> & {
  collections?: string | string[] | null;
  n_tile?: number | null;
  image_encoding?: 'zstd' | 'jxl' | 'jxs' | 'jpg' | 'png' | 'raw' | string | null;
  image_quality?: number | null;
  generate_backgrounds?: boolean | null;
  generate_flatfield_profiles?: boolean | null;
  flatfield_axis?: number | null;
  background_window_stride?: number | null;
  background_window_width?: number | null;
  flatfield_window_stride?: number | null;
  flatfield_window_width?: number | null;
  background_encoding?: 'zstd' | 'jxl' | 'jxs' | 'jpg' | 'png' | 'raw' | string | null;
  background_quality?: number | null;
  recursive?: boolean | null;
  adaptive_background_subtraction?: boolean | null;
  adaptive_background_period?: number | null;
  apply_mask?: boolean | null;
  mask_path?: string | null;
  enqueue_segment?: boolean | null;
  roi_padding?: number | null;
  roi_encoding?: string | null;
};

export type QueueAssetsRequest = {
  assets: QueueIngestionAssetRequest[];
  run_id?: string | null;
  run_key?: string | null;
  instrument?: string;
  source_path?: string | null;
  source_type?: string | null;
  metadata?: Record<string, unknown>;
  n_tile?: number | null;
  image_encoding?: 'zstd' | 'jxl' | 'jxs' | 'jpg' | 'png' | 'raw' | string | null;
  image_quality?: number | null;
  generate_backgrounds?: boolean | null;
  generate_flatfield_profiles?: boolean | null;
  flatfield_axis?: number | null;
  background_window_stride?: number | null;
  background_window_width?: number | null;
  flatfield_window_stride?: number | null;
  flatfield_window_width?: number | null;
  background_encoding?: 'zstd' | 'jxl' | 'jxs' | 'jpg' | 'png' | 'raw' | string | null;
  background_quality?: number | null;
  adaptive_background_subtraction?: boolean | null;
  adaptive_background_period?: number | null;
  apply_mask?: boolean | null;
  mask_path?: string | null;
  enqueue_segment?: boolean;
  roi_padding?: number | null;
  roi_encoding?: string | null;
};

export type QueueAssetsResponse = {
  run_id?: string;
  run_key?: string;
  asset_count?: number;
  assets?: RawAsset[];
  registration?: Record<string, unknown>;
  jobs?: Job[];
};

export type RunsListResponse = { runs?: RunSummary[] };

export type FrameSummary = {
  id: string;
  asset_id?: string;
  run_id?: string | null;
  frame_num?: number;
  frame_index?: number;
  captured_at?: string | null;
  width?: number | null;
  height?: number | null;
  bbox_x?: number | string | null;
  bbox_y?: number | string | null;
  shape?: number[] | null;
  payload_shape?: number[] | null;
  preprocessed_payload_shape?: number[] | null;
  dtype?: string | null;
  has_preprocessed_payload?: boolean;
  created_at?: string;
  metadata?: Record<string, unknown>;
  preprocessed_metadata?: Record<string, unknown>;
};

export type CollectionSummary = {
  collection: string;
  asset_count?: number;
};

export type AssetDetectionStats = {
  summary?: {
    total_asset_count?: number;
    identified_asset_count?: number;
    total_detection_count?: number;
  };
  assets?: Array<{
    asset_id: string;
    run_id?: string | null;
    filename?: string;
    kind?: string;
    collections?: string[];
    frame_count?: number;
    detection_count?: number;
  }>;
};

export type AssetProcessingState = {
  summary?: {
    total_asset_count?: number;
    total_frame_count?: number;
    total_preprocessed_frame_count?: number;
    total_detected_frame_count?: number;
    total_detection_count?: number;
  };
  assets?: Array<{
    asset_id: string;
    run_id?: string | null;
    filename?: string;
    kind?: string;
    collections?: string[];
    frame_count?: number;
    preprocessed_frame_count?: number;
    detected_frame_count?: number;
    detection_count?: number;
    preprocessing_state?: string;
    detection_state?: string;
  }>;
  page?: PageMetadata;
};

export type FrameProcessingState = {
  summary?: {
    total_frame_count?: number | string;
    total_preprocessed_frame_count?: number | string;
    total_detected_frame_count?: number | string;
    total_detection_count?: number | string;
    total_refined_candidate_detection_count?: number | string;
    total_unrefined_detection_count?: number | string;
    total_refined_detection_count?: number | string;
  };
  frames?: Array<{
    frame_id: string;
    run_id?: string | null;
    asset_id?: string;
    frame_index?: number;
    frame_num?: number;
    captured_at?: string | null;
    asset_filename?: string;
    kind?: string;
    collections?: string[];
    has_preprocessed_payload?: boolean;
    detection_count?: number | string;
    refined_candidate_detection_count?: number | string;
    unrefined_detection_count?: number | string;
    refined_detection_count?: number | string;
    preprocessing_state?: string;
    detection_state?: string;
    refinement_state?: string;
  }>;
  page?: PageMetadata;
};

export type ProcessingStageStatus =
  | 'unknown'
  | 'queued'
  | 'leased'
  | 'working'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'dead_lettered'
  | string;

export type ProcessingStatusSnapshot = {
  id?: string | null;
  project_id?: string | null;
  session_id?: string | null;
  status_version?: number | string;
  generated_at?: string | null;
  updated_at?: string | null;
  summary?: Record<string, unknown>;
};

export type ProcessingStatusSummary = {
  total_frame_count?: number | string;
  preprocessing_succeeded_count?: number | string;
  candidate_detection_succeeded_count?: number | string;
  roi_refinement_succeeded_count?: number | string;
  frames_with_candidates_count?: number | string;
  frames_with_refined_rois_count?: number | string;
  candidate_detection_count?: number | string;
  refined_detection_count?: number | string;
  unrefined_candidate_count?: number | string;
  updated_at?: string | null;
  by_status?: Record<string, Record<string, number | string>>;
};

export type ProcessingStatusSummaryResponse = {
  summary?: ProcessingStatusSummary;
  snapshot?: ProcessingStatusSnapshot;
};

export type ProcessingStatusFacets = {
  assets?: Record<string, number | string>;
  collections?: Record<string, number | string>;
  preprocessing_status?: Record<string, number | string>;
  candidate_detection_status?: Record<string, number | string>;
  roi_refinement_status?: Record<string, number | string>;
  refinement_state?: Record<string, number | string>;
};

export type ProcessingStatusFacetsResponse = {
  summary?: ProcessingStatusSummary;
  facets?: ProcessingStatusFacets;
  snapshot?: ProcessingStatusSnapshot;
};

export type ProcessingStatusFrame = {
  project_id?: string | null;
  frame_id: string;
  asset_id?: string | null;
  run_id?: string | null;
  frame_index?: number | null;
  collections?: string[];
  preprocessing_status?: ProcessingStageStatus;
  preprocessing_job_id?: string | null;
  preprocessing_completed_at?: string | null;
  candidate_detection_status?: ProcessingStageStatus;
  candidate_detection_job_id?: string | null;
  candidate_detection_completed_at?: string | null;
  candidate_detection_count?: number | string;
  roi_refinement_status?: ProcessingStageStatus;
  roi_refinement_job_id?: string | null;
  roi_refinement_completed_at?: string | null;
  refined_detection_count?: number | string;
  unrefined_candidate_count?: number | string;
  updated_at?: string | null;
  asset_filename?: string | null;
  asset_kind?: string | null;
};

export type ProcessingStatusFramesResponse = {
  frames?: ProcessingStatusFrame[];
  next_cursor?: string | null;
  page?: PageMetadata;
};

export type ProcessingStatusFrameIdsResponse = {
  frame_ids?: string[];
  next_cursor?: string | null;
  page?: PageMetadata;
};

export type ProcessingStatusFilters = {
  run_id?: string | null;
  asset_id?: string | string[] | null;
  collection?: string | string[] | null;
  preprocessing_status?: string | string[] | null;
  candidate_detection_status?: string | string[] | null;
  roi_refinement_status?: string | string[] | null;
  has_candidates?: boolean | null;
  has_refined_rois?: boolean | null;
  start_frame?: number | null;
  end_frame?: number | null;
  limit?: number | null;
  cursor?: string | null;
  offset?: number | null;
};

export type ProcessingQueueStage = 'preprocess_frames' | 'segment' | 'roi_refinement';

export type ProcessingQueueFilters = {
  run_id?: string | null;
  asset_ids?: string[];
  collection?: string[];
  preprocessing_status?: string[];
  candidate_detection_status?: string[];
  roi_refinement_status?: string[];
  refinement_state?: Array<'refined' | 'unrefined'>;
  start_frame?: number | null;
  end_frame?: number | null;
};

export type ProcessingQueueRequest = {
  stage: ProcessingQueueStage;
  filters?: ProcessingQueueFilters;
  options?: Record<string, unknown>;
  priority?: number | null;
  dry_run?: boolean;
};

export type ProcessingQueueResponse = {
  stage?: ProcessingQueueStage | string;
  unit?: string;
  matched_count?: number | string;
  job_count?: number | string;
  batch_sizes?: Array<number | string>;
  ordering?: string;
  max_units_per_job?: number | string;
  job_ids?: string[];
  dry_run?: boolean;
  sample_frame_ids?: string[];
};

export type PageMetadata = {
  limit?: number | null;
  offset?: number;
  count?: number;
  next_offset?: number | null;
};

export type BBoxObject = {
  x?: number | string;
  y?: number | string;
  w?: number | string;
  h?: number | string;
  width?: number | string;
  height?: number | string;
};

export type DetectionSummary = {
  id?: string;
  frame_id?: string;
  asset_id?: string;
  asset_filename?: string;
  frame_index?: number;
  roi_index?: number;
  bbox_x?: number | string;
  bbox_y?: number | string;
  bbox_w?: number | string;
  bbox_h?: number | string;
  bbox?: BBoxObject | Array<number | string>;
  crop_bbox_x?: number | string;
  crop_bbox_y?: number | string;
  crop_bbox_w?: number | string;
  crop_bbox_h?: number | string;
  crop_bbox?: BBoxObject;
  area?: number;
  perimeter?: number;
  roi_encoding?: string | null;
  roi_format?: string | null;
  roi_payload_bytes?: number;
  mask_payload_bytes?: number;
  refined_detection_id?: string | null;
  candidate_detection_id?: string | null;
  candidate_detection_ids?: string[] | null;
  primary_candidate_detection_id?: string | null;
  refinement_relationship?: 'one_to_one' | 'split_parent' | 'split_child' | 'merge_keeper' | 'merge_consumed' | 'many_to_many' | string | null;
  refined_roi_url?: string | null;
  refined_mask_url?: string | null;
  refinement_method?: string | null;
  metadata?: Record<string, unknown>;
};

export type DetectionListResponse = {
  detections: DetectionSummary[];
  page?: PageMetadata;
};

export type FrameContextResponse = {
  frame: FrameSummary;
  asset: RawAsset;
  image_urls: {
    original?: string | null;
    preprocessed?: string | null;
  };
  frame_payload_kind?: 'original' | 'preprocessed';
  detections: DetectionSummary[];
  detection_count: number;
  page?: PageMetadata;
  telemetry?: Record<string, TelemetryValue>;
  events?: Array<Record<string, unknown>>;
};

export type DetectionFilters = {
  run_id?: string | null;
  asset_id?: string | null;
  collection?: string | null;
  frame_id?: string | null;
  start_frame?: number | null;
  end_frame?: number | null;
  min_bbox_w?: number | null;
  max_bbox_w?: number | null;
  min_bbox_h?: number | null;
  max_bbox_h?: number | null;
  min_area?: number | null;
  max_area?: number | null;
  min_perimeter?: number | null;
  max_perimeter?: number | null;
  roi_encoding?: string | null;
  roi_format?: string | null;
  /** Restrict results by whether a non-empty stored ROI image payload is available. */
  has_roi_payload?: boolean | null;
  sort_by?: 'area' | 'byte_size' | 'id' | 'asset_frame' | null;
  sort_dir?: 'asc' | 'desc' | null;
  refinement_state?: 'any' | 'refined' | 'unrefined' | null;
  telemetry_filters?: TelemetryRangeFilter[];
  limit?: number | null;
  offset?: number | null;
};

export type JobEvent = {
  id: number;
  job_id?: string;
  run_id?: string | null;
  event_type?: string;
  message?: string | null;
  created_at?: string;
  payload?: Record<string, unknown>;
};

export type LogEntry = {
  id: number;
  event_type?: string;
  message?: string | null;
  level?: string;
  logger?: string;
  run_id?: string | null;
  asset_id?: string | null;
  job_id?: string | null;
  worker_id?: string | null;
  request_id?: string | null;
  duration_ms?: number | null;
  created_at?: string;
  payload?: Record<string, unknown>;
};

export type LogListOptions = {
  after_id?: number | null;
  before_id?: number | null;
  level?: string | null;
  event_type?: string | null;
  logger?: string | null;
  run_id?: string | null;
  asset_id?: string | null;
  job_id?: string | null;
  worker_id?: string | null;
  request_id?: string | null;
  limit?: number | null;
  offset?: number | null;
};

export type DirectoryEntry = {
  name: string;
  path: string;
  relative_path?: string;
  key?: string;
  label?: string;
  kind: 'file' | 'directory';
  is_dir?: boolean;
  size_bytes?: number;
  created_at?: string | number;
  modified_at?: string | number;
  asset_id?: string;
};

export type DirectoryListing = {
  path: string;
  entries: DirectoryEntry[];
  source: 'live-files' | 'registered-assets';
};

export type SegmentationOptions = {
  threshold?: number | null;
  threshold_method?: string | null;
  manual_threshold?: number | null;
  thresholding_maximum_value?: number | null;
  bounded_otsu_min_contrast?: number | null;
  bounded_otsu_max_foreground_fraction?: number | null;
  canny_enabled?: boolean | null;
  canny_low_threshold?: number | null;
  canny_high_threshold?: number | null;
  canny_blur_kernel?: number | null;
  dilate_kernel_w?: number | null;
  dilate_kernel_h?: number | null;
  dilate_iterations?: number | null;
  erode_kernel_w?: number | null;
  erode_kernel_h?: number | null;
  erode_iterations?: number | null;
  open_kernel_w?: number | null;
  open_kernel_h?: number | null;
  open_iterations?: number | null;
  close_kernel_w?: number | null;
  close_kernel_h?: number | null;
  close_iterations?: number | null;
  fill_holes?: boolean | null;
  remove_small_components?: boolean | null;
  min_component_area?: number | null;
  clear_border?: boolean | null;
  adaptive_block_size?: number | null;
  adaptive_c?: number | null;
  percentile_background_percentile?: number | null;
  percentile_min_contrast?: number | null;
  hysteresis_low_threshold?: number | null;
  hysteresis_high_threshold?: number | null;
  hysteresis_connectivity?: number | null;
  sobel_percentile?: number | null;
  sobel_threshold?: number | null;
  sobel_kernel_size?: number | null;
  frame_payload_kind?: 'original' | 'preprocessed' | null;
  apply_preprocessing?: boolean | null;
  min_field_value?: number | null;
  max_field_value?: number | null;
  apply_mask?: boolean | null;
  crop_enabled?: boolean | null;
  crop_x?: number | null;
  crop_y?: number | null;
  crop_w?: number | null;
  crop_h?: number | null;
  mask_augmentation_enabled?: boolean | null;
  mask_augmentation_steps?: string[] | null;
  roi_assembly_method?: string | null;
  roi_assembly_connectivity?: number | null;
  min_area?: number | null;
  max_area?: number | null;
  min_perimeter?: number | null;
  max_perimeter?: number | null;
  min_width?: number | null;
  max_width?: number | null;
  min_height?: number | null;
  max_height?: number | null;
  min_width_plus_height?: number | null;
  max_width_plus_height?: number | null;
  padding?: number | null;
  roi_encoding?: 'png' | 'jpg' | 'jxl' | 'jxs' | 'raw' | 'zstd' | null;
  small_roi_encoding?: 'png' | 'jpg' | 'jxl' | 'jxs' | 'raw' | 'zstd' | null;
  large_roi_encoding?: 'png' | 'jpg' | 'jxl' | 'jxs' | 'raw' | 'zstd' | null;
  large_roi_min_pixels?: number | null;
  roi_quality?: number | null;
  mask_encoding?: 'png' | 'jpg' | 'jxl' | 'jxs' | 'raw' | 'zstd' | null;
  store_roi_payload_min_area?: number | null;
  store_roi_payload_min_width?: number | null;
  store_roi_payload_min_height?: number | null;
  store_roi_payload_min_width_plus_height?: number | null;
  always_store_mask?: boolean | null;
};

export type SegmentationResolvedOptions = Record<string, Record<string, unknown>>;

export type LiveSandboxFields = {
  frame_id: string;
  source_frame_id?: string | null;
  sandbox_frame_id?: string | null;
  sandboxed?: boolean;
  sandbox_created?: boolean;
  run_id?: string | null;
  asset_id?: string | null;
  saved?: boolean;
  frame_payload_kind?: string | null;
  apply_preprocessing?: boolean | null;
  resolved_options?: SegmentationResolvedOptions;
  processed_frame_shape?: number[] | null;
  stage_counts?: Record<string, number>;
  stage_durations_ms?: Record<string, number>;
};

export type LiveThresholdResponse = LiveSandboxFields & {
  mask?: {
    shape?: number[];
    dtype?: string;
    foreground_pixels?: number;
    foreground_fraction?: number;
    mask_payload_base64?: string;
    mask_payload_bytes?: number;
    mask_encoding?: string;
    mask_format?: string;
  };
};

export type LiveDetectionCandidateResponse = LiveSandboxFields & {
  bbox_coordinate_space?: string | null;
  coordinate_space?: string | null;
  payloads_encoded?: boolean;
  max_detections?: number | null;
  candidate_limit_applied?: boolean | null;
  candidate_detection_count?: number;
  detection_count: number;
  candidate_detections?: DetectionSummary[];
  detections: DetectionSummary[];
};

export type LiveSandboxListResponse = {
  sandbox_frames: FrameSummary[];
  limit: number;
  offset: number;
  count: number;
};

export type LiveSandboxDeleteResponse = {
  status: string;
  sandbox_frame_id: string;
  frame?: FrameSummary;
  generated_kvstore_keys?: string[];
  deleted_kvstore_keys?: Array<Record<string, unknown>>;
};

export type SegmentationCapabilities = {
  pipeline_stage_order?: string[];
  supported?: {
    frame_payload_kinds?: string[];
    threshold_methods?: string[];
    mask_augmentation_steps?: string[];
    roi_assembly_methods?: string[];
    roi_encoding_options?: string[];
  };
  defaults?: SegmentationResolvedOptions;
  fields?: Record<string, Array<Record<string, unknown>>>;
  config_defaults?: Record<string, Record<string, unknown>>;
};

export type RoiRefinementOptions = {
  detection_ids?: string[];
  method?: 'oracle' | 'identity';
  model_ref?: string | null;
  max_iterations?: number | null;
  expansion_pixels?: number | null;
  edge_touch_margin?: number | null;
  encoding?: 'png' | 'jpg' | 'jxl' | 'jxs' | 'raw' | 'zstd' | 'auto' | null;
  allow_frame_expansion?: boolean | null;
  store?: boolean | null;
  dry_run?: boolean | null;
};

export type RoiRefinementCapabilities = {
  pipeline_stage_order?: string[];
  supported?: {
    model_refs?: string[];
    methods?: Array<'oracle' | 'identity'>;
    models?: Array<Record<string, unknown>>;
    inference_backend?: string;
    oracle?: { enabled?: boolean; status?: string; error?: string };
    roi_encoding_options?: string[];
  };
  defaults?: {
    roi_refinement?: Record<string, unknown>;
  };
  fields?: Record<string, Array<Record<string, unknown>>>;
};

export type CurationLabel = {
  id: string;
  name: string;
  display_name?: string | null;
  stable_concept_id?: string | null;
  parent_label_id?: string | null;
  annotation_count?: number;
  prediction_count?: number;
  deprecated_at?: string | null;
  metadata?: Record<string, unknown>;
};

export type CurationLabelDictionary = {
  key: string;
  filename: string;
  vocabulary: {
    id: string;
    name: string;
    version: string;
    [key: string]: unknown;
  };
  sources: Array<Record<string, unknown>>;
  labels: Array<Record<string, unknown>>;
  selectable_count: number;
};

export type CurationLabelImportResult = {
  dictionary_key: string;
  created_count: number;
  updated_count: number;
  labels: CurationLabel[];
};

export type OracleExecution = {
  gpu_accelerated?: boolean;
  accelerator?: string;
  device_type?: string;
  device_name?: string;
  device_count?: number;
};

export type OracleModelSummary = {
  alias: string;
  loaded: boolean;
  available: boolean;
  load_error?: string | null;
  task?: string | null;
  architecture?: string | null;
  runtime?: { execution?: OracleExecution };
  parameters?: { execution?: OracleExecution };
  model?: {
    artifact_id?: string | null;
    run_id?: string | null;
    artifact_fingerprint?: string | null;
    task?: string | null;
    architecture?: string | null;
  };
  capabilities?: {
    contract_version?: string | null;
    labels?: Array<{ class_index: number; label_id?: string | null; name?: string | null }>;
    embedding?: { available?: boolean; dimension?: number | null; normalized?: boolean };
    evidence?: {
      available?: boolean;
      prototype?: boolean;
      knn?: boolean;
      visual_exemplars?: boolean;
    };
    clustering?: {
      available?: boolean;
      cluster_count?: number | null;
      method?: string | null;
      embedding_dimension?: number | null;
    };
  };
};

export type CurationEvidenceSummary = {
  evidence_id?: string | null;
  inference_run_id?: string | null;
  predicted_label_id?: string | null;
  predicted_label_name?: string | null;
  predicted_class_index?: number | null;
  confidence?: number | null;
  entropy?: number | null;
  probability_margin?: number | null;
  prototype_class_index?: number | null;
  prototype_similarity?: number | null;
  prototype_margin?: number | null;
  knn_class_index?: number | null;
  knn_agreement?: number | null;
  knn_weighted_support?: number | null;
  knn_margin?: number | null;
  clustering_evidence_id?: string | null;
  clustering_inference_run_id?: string | null;
  cluster_index?: number | null;
  cluster_id?: string | null;
  cluster_similarity?: number | null;
  cluster_novel?: boolean | null;
  cluster_abstained?: boolean | null;
};

export type CurationRoi = CurationEvidenceSummary & {
  id: string;
  asset_id?: string | null;
  asset_filename?: string | null;
  frame_id?: string | null;
  frame_index?: number | null;
  roi_index?: number | null;
  area?: number | null;
  roi_shape?: number[];
  roi_url?: string;
  thumbnail_url?: string;
  annotation_id?: string | null;
  label_id?: string | null;
  label_name?: string | null;
  label_display_name?: string | null;
  annotation_status?: string | null;
  actor_username?: string | null;
  review_decision?: 'verified' | 'rejected' | 'needs_review' | null;
  annotations?: Array<Record<string, unknown>>;
  reviews?: Array<Record<string, unknown>>;
  evidence?: Array<Record<string, any>>;
  clustering_evidence?: Array<Record<string, any>>;
};

export type CurationOptions = {
  oracle: {
    enabled?: boolean;
    status?: string;
    error?: string;
    registered_model_count?: number;
    available_model_count?: number;
  };
  models: OracleModelSummary[];
  clustering_models?: OracleModelSummary[];
  default_model_ref: string;
  labels: CurationLabel[];
  assets?: Array<{ id: string; filename: string; kind?: string }>;
  registry_export?: { root_path: string; default_path: string };
  default_label_dictionary: CurationLabelDictionary;
  ownership: Record<string, string>;
};

export type RegistryDatasetSelection = {
  asset_ids?: string[];
  annotation_state?: 'all' | 'labeled' | 'unlabeled';
  review_state?: 'all' | 'unreviewed' | 'verified' | 'rejected' | 'needs_review';
  evidence_state?: 'all' | 'available' | 'missing' | 'disagreement';
  min_area?: number | null;
  max_area?: number | null;
};

export type RegistryDatasetPreview = {
  matching_count: number;
  selected_count: number;
  payload_bytes: number;
  estimated_sqlite_bytes: number;
  subsample_ratio: number;
};

export type RegistryDatasetGenerationResponse = {
  job: Job;
  preview: RegistryDatasetPreview;
  dataset_id: string;
  revision_id: string;
  destination_path: string;
};

export type ClassificationTargetSelection = {
  asset_ids?: string[];
  collections?: string[];
  annotation_state?: 'all' | 'labeled' | 'unlabeled';
  review_state?: 'all' | 'unreviewed' | 'verified' | 'rejected' | 'needs_review';
  evidence_state?: 'all' | 'missing_model' | 'available_model' | 'missing_any' | 'available_any' | 'disagreement';
  label_id?: string | null;
  label_source?: 'any' | 'human' | 'prediction';
  min_area?: number | null;
  max_area?: number | null;
  search?: string | null;
};

export type ClassificationTargetPreview = {
  model_ref: string;
  evidence_kind?: 'classification' | 'clustering';
  selection: ClassificationTargetSelection;
  target_count: number;
  explicit_roi_count: number;
};

export type ClassificationJobResponse = ClassificationTargetPreview & {
  job: Job;
};

export type CurationRoiPage = {
  items: CurationRoi[];
  total: number;
  limit: number;
  offset: number;
};

export type FeatureSpaceSource = {
  source_key: string;
  source_kind: 'classification' | 'clustering';
  inference_run_id: string;
  model_selector?: string | null;
  artifact_id?: string | null;
  model_run_id?: string | null;
  artifact_fingerprint?: string | null;
  evidence_count: number;
  embedding_count: number;
  embedding_shape?: number[] | null;
  latest_evidence_at?: string | null;
  comparison: 'cosine_similarity';
  scope: 'single_inference_run';
};

export type FeatureSpaceRoi = {
  id: string;
  asset_id?: string | null;
  asset_filename?: string | null;
  roi_index?: number | null;
  area?: number | null;
  bbox_w?: number | null;
  bbox_h?: number | null;
  roi_shape?: number[] | null;
  label_display_name?: string | null;
  review_decision?: string | null;
  roi_url?: string;
  thumbnail_url?: string;
  similarity?: number | null;
  is_reference?: boolean;
  cluster_id?: string | null;
  cluster_index?: number | null;
  cluster_name?: string | null;
  novel?: boolean | null;
  abstained?: boolean | null;
};

export type FeatureSpaceSimilarityResult = {
  items: FeatureSpaceRoi[];
  reference_roi_id: string;
  source_key: string;
  comparison: 'cosine_similarity' | 'cluster_centroid_similarity';
  minimum: number;
  candidate_count: number;
  total_vector_count: number;
  scanned_vector_count: number;
  search_scope: 'full_source' | 'deterministic_prefix' | 'cluster_local';
  readable_embedding_count: number | null;
  unreadable_embedding_count: number;
  limit: number;
  cluster_id?: string;
};

export type FeatureSpaceSourceRois = {
  items: FeatureSpaceRoi[];
  source_key: string;
  limit: number;
};

export type FeatureSpaceUmapRoi = FeatureSpaceRoi & {
  umap_coordinates: number[];
  hdbscan_label: number;
  hdbscan_cluster_id?: string | null;
  hdbscan_membership_strength: number;
};

export type FeatureSpaceUmapResult = {
  items: FeatureSpaceUmapRoi[];
  source_key: string;
  component_count: number;
  random_seed: number;
  clustering: 'hdbscan';
  cluster_count: number;
  noise_count: number;
  hdbscan_parameters: {
    min_cluster_size: number;
    min_samples: number | null;
    cluster_selection_epsilon: number;
    metric: string;
  };
  component_ranges: Array<{
    component: number;
    minimum: number;
    maximum: number;
  }>;
  readable_embedding_count: number;
  unreadable_embedding_count: number;
  scanned_vector_count?: number;
  total_vector_count?: number;
  projection_scope?: string;
};

export type FeatureSpaceUmapAnalysisRequest = {
  source_key: string;
  min_cluster_size?: number;
  min_samples?: number | null;
  cluster_selection_epsilon?: number;
  force?: boolean;
};

export type FeatureSpaceUmapAnalysisResponse = {
  job: Job;
  disposition?: 'cached' | 'existing' | 'queued' | string;
  cache_key?: string | null;
  ephemeral?: boolean;
};

export type FeatureSpaceCluster = {
  cluster_id: string;
  cluster_index?: number | null;
  cluster_name?: string | null;
  roi_count: number;
  mean_similarity?: number | null;
  min_similarity?: number | null;
  max_similarity?: number | null;
  novelty_count: number;
  representative_detection_id: string;
  representative_similarity?: number | null;
};

export type FeatureSpaceClusterResult = {
  items: FeatureSpaceCluster[];
  source_key: string;
  organization_kind: 'self_supervised_clusters' | 'label_prototypes';
  group_ids: 'run_local';
};

export type FeatureSpaceClusterMembers = {
  items: FeatureSpaceRoi[];
  total: number;
  limit: number;
  offset: number;
  source_key: string;
  cluster_id: string;
  organization_kind: 'self_supervised_clusters' | 'label_prototypes';
  group_ids: 'run_local';
};

export type FramePreprocessOptions = {
  frame_id?: string | null;
  asset_id?: string | null;
  frame_num?: number | null;
  min_field_value?: number | null;
  max_field_value?: number | null;
  apply_mask?: boolean | null;
  crop_enabled?: boolean | null;
  crop_x?: number | null;
  crop_y?: number | null;
  crop_w?: number | null;
  crop_h?: number | null;
  store?: boolean;
  encoding?: 'png' | 'jpg' | 'jxl' | 'jxs' | 'raw' | 'zstd' | null;
  response_format?: 'metadata' | 'matrix';
};

export type FramePreprocessResponse = {
  frame_id: string;
  asset_id?: string;
  frame_num?: number;
  stored: boolean;
  dtype?: string;
  shape?: number[];
  preprocessing?: Record<string, unknown>;
  frame?: FrameSummary;
  data?: unknown;
};

export type LivePreprocessResponse = {
  status?: string;
  saved?: boolean;
  frame_id: string;
  source_frame_id?: string | null;
  sandbox_frame_id?: string | null;
  sandboxed?: boolean;
  sandbox_created?: boolean;
  run_id?: string | null;
  asset_id?: string | null;
  old_preprocessed_key?: string | null;
  new_preprocessed_key?: string | null;
  old_preprocessed_deleted?: boolean;
  old_preprocessed_missing?: boolean;
  preprocessing?: Record<string, unknown>;
  frame?: FrameSummary;
};
