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
      flatfield?: Record<string, unknown>;
      preprocessing?: Record<string, unknown>;
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
  min_perimeter?: number | null;
  max_perimeter?: number | null;
  padding?: number | null;
  flatfield_correction?: boolean | null;
  flatfield_q?: number | null;
  roi_encoding?: 'png' | 'raw' | 'zstd' | 'auto' | null;
  zstd_min_bytes?: number | null;
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
