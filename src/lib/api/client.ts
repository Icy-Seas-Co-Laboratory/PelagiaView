import type {
  AssetDetectionStats,
  AssetProcessingState,
  CollectionSummary,
  DetectionListResponse,
  DetectionFilters,
  DetectionSummary,
  DirectoryEntry,
  DirectoryListing,
  FrameContextResponse,
  FramePreprocessOptions,
  FramePreprocessResponse,
  FrameProcessingState,
  FrameSummary,
  HealthResponse,
  Job,
  JobEventListOptions,
  JobListOptions,
  JobEvent,
  LogListOptions,
  JobsSummaryOptions,
  JobsSummaryResponse,
  KvStoreOverview,
  LivePreprocessResponse,
  LogEntry,
  RawAsset,
  RoiRefinementCapabilities,
  RoiRefinementOptions,
  SegmentationOptions,
  SegmentationCapabilities,
  SegmentationResolvedOptions,
  SystemConfigResponse,
  SystemStatus,
  WorkerSession
} from './types';
import { recordApiRequest } from '$lib/utils/analytics';

type CacheRecord<T> = {
  expiresAt: number;
  value: T;
};

type FrameImageOptions = {
  format?: string;
  scale?: string | number;
  width?: number | null;
  height?: number | null;
  flatfield_correction?: boolean | null;
  flatfield_q?: number | null;
  flatfield_axis?: number | null;
  flatfield_min_field_value?: number | null;
  flatfield_max_field_value?: number | null;
  background_correction?: boolean | null;
  preview_max_dim?: number | null;
};

type FrameEndpointOptions = {
  frame_id?: string | null;
  asset_id?: string | null;
  frame_num?: number | null;
  format?: string;
  scale?: string | number;
  width?: number | null;
  height?: number | null;
  preview_max_dim?: number | null;
  cache_bust?: number | null;
};

type FrameContextOptions = {
  width?: number | null;
  height?: number | null;
  scale?: string | number;
  include_detections?: boolean;
  detection_limit?: number | null;
  detection_offset?: number | null;
  frame_payload_kind?: 'original' | 'preprocessed' | null;
};

type DetectionImageOptions = {
  applyMask?: boolean;
};

type QueryParamValue = string | number | boolean | Array<string | number | boolean> | null | undefined;

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

export class PelagiaApiClient {
  readonly baseUrl: string;
  private cache = new Map<string, CacheRecord<unknown>>();

  constructor(baseUrl: string) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

  async get<T>(path: string, params?: Record<string, QueryParamValue>, ttlMs = 0): Promise<T> {
    const url = this.url(path, params);
    if (ttlMs > 0) {
      const cached = this.cache.get(url) as CacheRecord<T> | undefined;
      if (cached && cached.expiresAt > Date.now()) {
        return cached.value;
      }
    }

    const value = await this.request<T>(url);
    if (ttlMs > 0) {
      this.cache.set(url, { expiresAt: Date.now() + ttlMs, value });
    }
    return value;
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const value = await this.request<T>(this.url(path), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    this.cache.clear();
    return value;
  }

  async health(): Promise<HealthResponse> {
    return this.get<HealthResponse>('/health');
  }

  async systemStatus(): Promise<SystemStatus> {
    return this.get<SystemStatus>('/system/status', undefined, 1500);
  }

  async systemUse(): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>('/system/use', undefined, 15000);
  }

  async systemConfig(): Promise<SystemConfigResponse> {
    return this.get<SystemConfigResponse>('/system/config', undefined, 15000);
  }

  async segmentationOptions(): Promise<SegmentationCapabilities> {
    return this.get<SegmentationCapabilities>('/segmentation/options', undefined, 15000);
  }

  async roiRefinementOptions(): Promise<RoiRefinementCapabilities> {
    return this.get<RoiRefinementCapabilities>('/roi-refinement/options', undefined, 15000);
  }

  async kvStoreOverview(): Promise<KvStoreOverview> {
    return this.get<KvStoreOverview>('/kvstore', undefined, 1500);
  }

  async listJobs(options: number | JobListOptions = 100): Promise<Job[]> {
    const params = typeof options === 'number' ? { limit: options } : options;
    const response = await this.get<{ jobs: Job[] }>('/jobs', params, 1500);
    return response.jobs ?? [];
  }

  async jobsSummary(options: JobsSummaryOptions = {}): Promise<JobsSummaryResponse> {
    return this.get<JobsSummaryResponse>('/jobs/summary', options, 1500);
  }

  async listJobEvents(options: number | JobEventListOptions = {}): Promise<JobEvent[]> {
    const params = typeof options === 'number' ? { after_id: options, limit: 150 } : options;
    const response = await this.get<{ events: JobEvent[] }>('/jobs/events', params);
    return response.events ?? [];
  }

  async listLogs(options: number | LogListOptions = {}): Promise<LogEntry[]> {
    const params = typeof options === 'number' ? { after_id: options, limit: 150 } : options;
    const response = await this.get<{ logs: LogEntry[] }>('/logs', params);
    return response.logs ?? [];
  }

  async pauseJob(jobId: string): Promise<Job> {
    const response = await this.post<{ job: Job }>(`/jobs/${encodeURIComponent(jobId)}/pause`, {
      reason: 'Paused from PelagiaView'
    });
    return response.job;
  }

  async resumeJob(jobId: string): Promise<Job> {
    const response = await this.post<{ job: Job }>(`/jobs/${encodeURIComponent(jobId)}/resume`, {
      reason: 'Resumed from PelagiaView'
    });
    return response.job;
  }

  async retryJob(jobId: string): Promise<Job> {
    const response = await this.post<{ job: Job }>(`/jobs/${encodeURIComponent(jobId)}/retry`);
    return response.job;
  }

  async listWorkers(limit = 100): Promise<WorkerSession[]> {
    const response = await this.get<{ workers: WorkerSession[] }>('/workers', { limit }, 1500);
    return response.workers ?? [];
  }

  async requestWorkerShutdown(workerId: string): Promise<WorkerSession> {
    const response = await this.post<{ worker: WorkerSession }>(`/workers/${encodeURIComponent(workerId)}/shutdown`, {
      reason: 'Shutdown requested from PelagiaView'
    });
    return response.worker;
  }

  async listAssets(kind?: string, limit = 200): Promise<RawAsset[]> {
    const response = await this.get<{ assets: RawAsset[] }>('/assets', { kind, limit }, 2500);
    return response.assets ?? [];
  }

  async listCollections(limit = 200): Promise<CollectionSummary[]> {
    const response = await this.get<{ collections: CollectionSummary[] }>('/collections', { limit }, 5000);
    return response.collections ?? [];
  }

  async assetDetectionStats(kind?: string, limit = 500): Promise<AssetDetectionStats> {
    return this.get<AssetDetectionStats>('/assets/detections', { kind, limit }, 2500);
  }

  async assetProcessingState(kind?: string, limit = 1000): Promise<AssetProcessingState> {
    return this.get<AssetProcessingState>('/assets/processing-state', { kind, limit }, 3000);
  }

  async frameProcessingState(options: {
    run_id?: string | null;
    asset_id?: string | null;
    collection?: string | null;
    kind?: string | null;
    filename?: string | null;
    preprocessing_state?: string | null;
    detection_state?: string | null;
    refinement_state?: string | null;
    start_frame?: number | null;
    end_frame?: number | null;
    limit?: number | null;
    offset?: number | null;
  } = {}): Promise<FrameProcessingState> {
    return this.get<FrameProcessingState>('/frames/processing-state', options, 3000);
  }

  async getAsset(assetId: string): Promise<RawAsset> {
    const response = await this.get<{ asset: RawAsset }>(`/assets/${encodeURIComponent(assetId)}`, undefined, 2500);
    return response.asset;
  }

  async listFrames(
    assetId: string,
    limit = 500,
    startFrame?: number,
    endFrame?: number
  ): Promise<FrameSummary[]> {
    const response = await this.get<{ frames: FrameSummary[] }>(
      `/assets/${encodeURIComponent(assetId)}/frames`,
      { limit, start_frame: startFrame, end_frame: endFrame },
      2500
    );
    return response.frames ?? [];
  }

  frameImageUrl(assetId: string, frameNum: number, options: FrameImageOptions = {}): string {
    const { format = 'jpg', ...frameOptions } = options;
    return this.url(`/assets/${encodeURIComponent(assetId)}/framedata/${frameNum}`, {
      format,
      ...frameOptions
    });
  }

  originalFrameUrl(options: FrameEndpointOptions): string {
    const { format = 'jpg', ...frameOptions } = options;
    return this.url('/frame/original', { format, ...frameOptions });
  }

  preprocessedFrameUrl(options: FrameEndpointOptions): string {
    const { format = 'jpg', ...frameOptions } = options;
    return this.url('/frame/preprocessed', { format, ...frameOptions });
  }

  async listDetections(assetId: string, frameId?: string, limit = 500, offset = 0): Promise<DetectionSummary[]> {
    const response = await this.listDetectionsPage(assetId, frameId, limit, offset);
    return response.detections ?? [];
  }

  async listDetectionsPage(
    assetId: string,
    frameId?: string,
    limit = 500,
    offset = 0
  ): Promise<DetectionListResponse> {
    const response = await this.get<DetectionListResponse>(
      `/assets/${encodeURIComponent(assetId)}/detections`,
      { frame_id: frameId, limit, offset }
    );
    return withDetectionPageFallback(response, limit, offset);
  }

  async searchDetections(filters: DetectionFilters = {}): Promise<DetectionSummary[]> {
    const response = await this.searchDetectionsPage(filters);
    return response.detections ?? [];
  }

  async searchDetectionsPage(filters: DetectionFilters = {}): Promise<DetectionListResponse> {
    const response = await this.get<DetectionListResponse>('/detections', compact(filters), 1500);
    return withDetectionPageFallback(response, filters.limit ?? 100, filters.offset ?? 0);
  }

  detectionImageUrl(detectionId: string, format = 'jpg', options: DetectionImageOptions = {}): string {
    return this.url(
      `/detections/${encodeURIComponent(detectionId)}/framedata`,
      compact({ format, apply_mask: options.applyMask || undefined })
    );
  }

  refinedDetectionImageUrl(detectionId: string, format = 'jpg', options: DetectionImageOptions = {}): string {
    return this.url(
      `/detections/${encodeURIComponent(detectionId)}/refined-roi`,
      compact({ format, apply_mask: options.applyMask || undefined })
    );
  }

  detectionMaskUrl(detectionId: string, format = 'png'): string {
    return this.url(`/detections/${encodeURIComponent(detectionId)}/mask`, { format });
  }

  refinedDetectionMaskUrl(detectionId: string, format = 'png'): string {
    return this.url(`/detections/${encodeURIComponent(detectionId)}/refined-mask`, { format });
  }

  async frameContext(frameId: string, options: FrameContextOptions = {}): Promise<FrameContextResponse> {
    const response = await this.get<FrameContextResponse>(
      `/frames/${encodeURIComponent(frameId)}/context`,
      compact(options),
      1000
    );
    return {
      ...response,
      image_urls: {
        original: this.absoluteUrlOrNull(response.image_urls?.original),
        preprocessed: this.absoluteUrlOrNull(response.image_urls?.preprocessed)
      },
      detections: response.detections ?? []
    };
  }

  async queueVideo(sourcePath: string, options: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.post<Record<string, unknown>>('/ingestion/videos', {
      source_path: sourcePath,
      ...options
    });
  }

  async segmentFrame(frameId: string, options: SegmentationOptions): Promise<{
    frame_id: string;
    run_id?: string;
    asset_id?: string;
    saved?: boolean;
    frame_payload_kind?: string;
    apply_preprocessing?: boolean;
    resolved_options?: SegmentationResolvedOptions;
    bbox_coordinate_space?: string | null;
    processed_frame_shape?: number[] | null;
    stage_counts?: Record<string, number>;
    detection_count: number;
    detections: DetectionSummary[];
  }> {
    return this.post(`/segmentation/frames/${encodeURIComponent(frameId)}`, compact(options));
  }

  async liveSegmentFrame(frameId: string, options: SegmentationOptions): Promise<{
    frame_id: string;
    run_id?: string;
    asset_id?: string;
    saved: boolean;
    frame_payload_kind?: string;
    apply_preprocessing?: boolean;
    apply_mask?: boolean;
    crop_enabled?: boolean;
    crop_x?: number | null;
    crop_y?: number | null;
    crop_w?: number | null;
    crop_h?: number | null;
    bbox_coordinate_space?: string | null;
    coordinate_space?: string | null;
    resolved_options?: SegmentationResolvedOptions;
    processed_frame_shape?: number[] | null;
    stage_counts?: Record<string, number>;
    background_correction?: boolean;
    background_percentile?: number;
    intensity_inverted?: boolean;
    detection_count: number;
    detections: DetectionSummary[];
  }> {
    return this.get('/live/segmentation', {
      frame_id: frameId,
      ...compact(options)
    });
  }

  async preprocessFrame(options: FramePreprocessOptions): Promise<FramePreprocessResponse> {
    return this.post('/frame/preprocess', compact(options));
  }

  async queuePreprocessJob(body: FramePreprocessOptions & {
    run_id?: string | null;
    frame_ids?: string[];
    start_frame?: number | null;
    end_frame?: number | null;
    limit?: number | null;
    priority?: number | null;
    depends_on?: string[];
  }): Promise<{ job: Job }> {
    return this.post('/frame/preprocess/jobs', compact(body));
  }

  async livePreprocessFrame(
    frameId: string,
    options: FramePreprocessOptions = {}
  ): Promise<LivePreprocessResponse> {
    const { encoding = 'png', ...preprocessOptions } = options;
    const value = await this.request<LivePreprocessResponse>(
      this.url('/live/preprocess', {
        frame_id: frameId,
        encoding,
        ...compact(preprocessOptions)
      }),
      {
        method: 'POST'
      }
    );
    this.cache.clear();
    return value;
  }

  async queueSegmentationJob(body: Record<string, unknown>): Promise<{ job: Job }> {
    return this.post('/segmentation/jobs', compact(body));
  }

  async queueRoiRefinementJob(body: RoiRefinementOptions & {
    run_id?: string | null;
    asset_id?: string | null;
    priority?: number | null;
    depends_on?: string[];
  }): Promise<{ job: Job }> {
    return this.post('/roi-refinement/jobs', compact(body));
  }

  async refineRois(body: RoiRefinementOptions): Promise<{
    dry_run?: boolean;
    stored?: boolean;
    detection_ids?: string[];
    candidate_count?: number;
    refined_count?: number;
    stored_count?: number;
    resolved_options?: Record<string, unknown>;
    model_kind?: string | null;
    model_ref?: string | null;
    refinement_method?: string | null;
    refined_detections?: DetectionSummary[];
  }> {
    return this.post('/roi-refinement', compact(body));
  }

  async listRawDirectory(path = '.'): Promise<DirectoryListing> {
    try {
      const response = await this.get<{
        directory?: string;
        entries?: Array<DirectoryEntry & { is_dir?: boolean }>;
      }>('/live/files', { directory: path });
      return {
        path: response.directory ?? path,
        entries: (response.entries ?? []).map((entry) => ({
          ...entry,
          kind: entry.is_dir ? 'directory' : 'file'
        })),
        source: 'live-files'
      };
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) {
        throw error;
      }
      const assets = await this.listAssets(undefined, 500);
      return directoryFromAssets(assets, path);
    }
  }

  private async request<T>(input: string, init?: RequestInit): Promise<T> {
    let response: Response;
    const started = performance.now();
    try {
      response = await fetch(input, init);
      recordApiRequest(input, init, response, performance.now() - started);
    } catch (error) {
      recordApiRequest(input, init, null, performance.now() - started, error);
      throw new ApiError(
        0,
        `Unable to reach Pelagia at ${this.baseUrl}. Check that the server is running and allows browser requests from PelagiaView.`,
        error
      );
    }
    if (!response.ok) {
      let detail: unknown;
      try {
        detail = await response.json();
      } catch {
        detail = await response.text();
      }
      const message =
        typeof detail === 'object' && detail && 'detail' in detail
          ? String((detail as { detail: unknown }).detail)
          : `Pelagia API returned HTTP ${response.status}`;
      throw new ApiError(response.status, message, detail);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return response.json() as Promise<T>;
  }

  private url(path: string, params?: Record<string, QueryParamValue>): string {
    const url = new URL(path.startsWith('/') ? path : `/${path}`, `${this.baseUrl}/`);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item !== undefined && item !== null && item !== '') {
            url.searchParams.append(key, String(item));
          }
        }
      } else if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private absoluteUrlOrNull(value: string | null | undefined): string | null {
    if (!value) return null;
    if (/^[a-z][a-z\d+\-.]*:\/\//i.test(value)) return value;
    return this.url(value);
  }
}

export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim() || 'http://127.0.0.1:8000';
  const withScheme = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withScheme.replace(/\/+$/, '');
}

function compact<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== '')
  ) as T;
}

function withDetectionPageFallback(
  response: DetectionListResponse,
  limit: number | null | undefined,
  offset: number | null | undefined
): DetectionListResponse {
  const detections = response.detections ?? [];
  return {
    detections,
    page: response.page ?? {
      limit,
      offset: offset ?? 0,
      count: detections.length,
      next_offset: limit && detections.length >= limit ? (offset ?? 0) + detections.length : null
    }
  };
}

function directoryFromAssets(assets: RawAsset[], currentPath: string): DirectoryListing {
  const normalizedPath = currentPath.replace(/\/+$/, '');
  const children = new Map<string, DirectoryEntry>();

  for (const asset of assets) {
    if (!asset.path) continue;
    const assetPath = asset.path;
    if (normalizedPath && !assetPath.startsWith(`${normalizedPath}/`)) continue;
    const relative = normalizedPath ? assetPath.slice(normalizedPath.length + 1) : assetPath.replace(/^\/+/, '');
    if (!relative) continue;
    const [first, ...rest] = relative.split('/');
    const childPath = normalizedPath ? `${normalizedPath}/${first}` : first;
    if (rest.length > 0) {
      children.set(childPath, {
        name: first,
        path: childPath,
        kind: 'directory'
      });
    } else {
      children.set(assetPath, {
        name: asset.filename ?? first,
        path: assetPath,
        kind: 'file',
        size_bytes: asset.size_bytes,
        asset_id: asset.id
      });
    }
  }

  return {
    path: normalizedPath,
    entries: [...children.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)),
    source: 'registered-assets'
  };
}
