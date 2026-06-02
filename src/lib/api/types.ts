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
  current_job_id?: string | null;
  shutdown_requested?: boolean;
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
  media_count?: number | null;
  created_at?: string;
  metadata?: Record<string, unknown>;
};

export type FrameSummary = {
  id: string;
  asset_id?: string;
  run_id?: string | null;
  frame_num?: number;
  width?: number | null;
  height?: number | null;
  shape?: number[] | null;
  dtype?: string | null;
  created_at?: string;
};

export type DetectionSummary = {
  id?: string;
  frame_id?: string;
  roi_index?: number;
  bbox_x?: number;
  bbox_y?: number;
  bbox_w?: number;
  bbox_h?: number;
  area?: number;
  perimeter?: number;
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
  min_perimeter?: number | null;
  max_perimeter?: number | null;
  padding?: number | null;
  roi_encoding?: 'png' | 'raw' | 'zstd' | 'auto' | null;
  zstd_min_bytes?: number | null;
};
