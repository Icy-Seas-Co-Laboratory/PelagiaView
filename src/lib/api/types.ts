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
  roi_encoding?: string | null;
};

export type ProjectStorageSettings = {
  frame?: {
    encoding?: string | null;
    quality?: number | string | null;
  };
  roi?: {
    encoding?: string | null;
  };
  sources?: {
    frame_encoding?: string | null;
    frame_quality?: string | null;
    roi_encoding?: string | null;
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
  status?: string | string[] | null;
  stage?: string | string[] | null;
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
  kind: 'video' | 'image_sequence' | string;
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
  kind?: 'auto' | 'video' | 'image_sequence' | string;
  recursive?: boolean;
  compute_checksum?: boolean;
  collections?: string | string[] | null;
  n_tile?: number | null;
  image_encoding?: 'zstd' | 'jxl' | 'jxs' | 'jpg' | 'png' | 'raw' | string | null;
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

export type QueueIngestionAssetRequest = Omit<AnalyzedIngestionAsset, 'collections'> & {
  collections?: string | string[] | null;
  n_tile?: number | null;
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
  asset_id?: string | null;
  collection?: string | null;
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
  sort_by?: 'area' | 'byte_size' | 'id' | 'asset_frame' | null;
  sort_dir?: 'asc' | 'desc' | null;
  refinement_state?: 'any' | 'refined' | 'unrefined' | null;
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
  background_correction?: boolean | null;
  background_min_field_value?: number | null;
  background_max_field_value?: number | null;
  background_asset_id?: string | null;
  background_start_frame?: number | null;
  background_end_frame?: number | null;
  background_limit?: number | null;
  background_window_stride?: number | null;
  background_window_width?: number | null;
  flatfield_axis?: number | null;
  flatfield_min_field_value?: number | null;
  flatfield_max_field_value?: number | null;
  apply_mask?: boolean | null;
  crop_enabled?: boolean | null;
  crop_x?: number | null;
  crop_y?: number | null;
  crop_w?: number | null;
  crop_h?: number | null;
  invert_intensity?: boolean | null;
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
  flatfield_correction?: boolean | null;
  flatfield_q?: number | null;
  roi_encoding?: 'png' | 'jpg' | 'jxl' | 'jxs' | 'raw' | 'zstd' | 'auto' | null;
  zstd_min_bytes?: number | null;
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
  model_ref?: string | null;
  model_kind?: string | null;
  model_run_dir?: string | null;
  model_artifact?: string | null;
  batch_size?: number | null;
  tile_size?: number | null;
  overlap_fraction?: number | null;
  max_iterations?: number | null;
  expansion_pixels?: number | null;
  edge_touch_margin?: number | null;
  output_threshold?: number | null;
  encoding?: 'png' | 'jpg' | 'jxl' | 'jxs' | 'raw' | 'zstd' | 'auto' | null;
  allow_frame_expansion?: boolean | null;
  store?: boolean | null;
  dry_run?: boolean | null;
};

export type RoiRefinementCapabilities = {
  pipeline_stage_order?: string[];
  supported?: {
    model_kinds?: string[];
    model_refs?: string[];
    model_artifacts?: Array<Record<string, unknown>>;
    roi_encoding_options?: string[];
  };
  defaults?: {
    roi_refinement?: Record<string, unknown>;
  };
  fields?: Record<string, Array<Record<string, unknown>>>;
};

export type FramePreprocessOptions = {
  frame_id?: string | null;
  asset_id?: string | null;
  frame_num?: number | null;
  flatfield_correction?: boolean | null;
  flatfield_q?: number | null;
  flatfield_axis?: number | null;
  flatfield_min_field_value?: number | null;
  flatfield_max_field_value?: number | null;
  apply_mask?: boolean | null;
  crop_enabled?: boolean | null;
  crop_x?: number | null;
  crop_y?: number | null;
  crop_w?: number | null;
  crop_h?: number | null;
  background_correction?: boolean | null;
  background_min_field_value?: number | null;
  background_max_field_value?: number | null;
  background_asset_id?: string | null;
  background_start_frame?: number | null;
  background_end_frame?: number | null;
  background_limit?: number | null;
  background_window_stride?: number | null;
  background_window_width?: number | null;
  invert_intensity?: boolean | null;
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
