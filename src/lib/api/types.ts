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
      video_ingest?: Record<string, unknown>;
      frame_storage?: Record<string, unknown>;
    };
    [key: string]: unknown;
  };
  defaults?: Record<string, unknown>;
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
  max_attempts?: number;
  summary?: string | null;
  created_at?: string;
  updated_at?: string;
  payload?: Record<string, unknown>;
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
    preprocessing_state?: string;
    detection_state?: string;
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

export type FramePreprocessOptions = {
  frame_id?: string | null;
  asset_id?: string | null;
  frame_num?: number | null;
  flatfield_correction?: boolean | null;
  flatfield_q?: number | null;
  flatfield_axis?: number | null;
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
  run_id?: string | null;
  asset_id?: string | null;
  old_preprocessed_key?: string | null;
  new_preprocessed_key?: string | null;
  old_preprocessed_deleted?: boolean;
  old_preprocessed_missing?: boolean;
  preprocessing?: Record<string, unknown>;
  frame?: FrameSummary;
};
