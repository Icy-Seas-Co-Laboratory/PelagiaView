export type HealthResponse = {
  status: string;
  postgres_configured?: boolean;
  kvstore_configured?: boolean;
};

export type SystemStatus = {
  postgres?: Record<string, unknown>;
  kvstore?: Record<string, unknown>;
  queue?: Record<string, number>;
  workers?: Record<string, number>;
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

export type ProjectSummary = {
  id: string;
  project_key?: string;
  project_name?: string | null;
  name?: string | null;
  description?: string | null;
  role?: string | null;
  membership_role?: string | null;
  is_active?: boolean;
};

export type AuthUserSummary = {
  id: string;
  username: string;
  display_name?: string | null;
  is_admin?: boolean;
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
  project?: ProjectSummary;
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
  status?: Record<string, unknown> & {
    total_sqlite_file_bytes?: number | string;
    total_stored_payload_bytes?: number | string;
    deep?: boolean;
  };
  health?: Record<string, unknown>;
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
  kind: 'file' | 'directory';
  is_dir?: boolean;
  size_bytes?: number;
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
  background_percentile?: number | null;
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
  roi_encoding?: 'png' | 'raw' | 'zstd' | 'auto' | null;
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
  encoding?: 'png' | 'raw' | 'zstd' | 'auto' | null;
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
  background_percentile?: number | null;
  invert_intensity?: boolean | null;
  store?: boolean;
  encoding?: 'png' | 'jpg' | 'raw' | 'zstd' | null;
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
