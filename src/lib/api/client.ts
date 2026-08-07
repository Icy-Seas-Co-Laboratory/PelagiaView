import type {
  AssetDetectionStats,
  AssetDeleteResponse,
  AssetProcessingState,
  AssetUpdateRequest,
  AuthLoginResponse,
  AuthMeResponse,
  AuthUserSummary,
  AnalyzeIngestionRequest,
  AnalyzeIngestionResponse,
  CollectionSummary,
  CurationLabel,
  CurationOptions,
  CurationRoi,
  CurationRoiPage,
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
  JobsClearOptions,
  JobsClearResponse,
  LogListOptions,
  JobsSummaryOptions,
  JobsSummaryResponse,
  KvStoreOverview,
  KvStoreOverviewOptions,
  LiveDetectionCandidateResponse,
  LivePreprocessResponse,
  LiveSandboxDeleteResponse,
  LiveSandboxListResponse,
  LiveThresholdResponse,
  LogEntry,
  ProjectSummary,
  ProjectMembershipSummary,
  ProjectStorageSettingsRequest,
  ProjectStorageSettingsResponse,
  ProcessingQueueRequest,
  ProcessingQueueResponse,
  ProcessingStatusFacetsResponse,
  ProcessingStatusFilters,
  ProcessingStatusFrameIdsResponse,
  ProcessingStatusFramesResponse,
  ProcessingStatusSummaryResponse,
  QueueAssetsRequest,
  QueueAssetsResponse,
  RawAsset,
  RoiRefinementCapabilities,
  RoiRefinementOptions,
  SegmentationOptions,
  SegmentationCapabilities,
  SegmentationResolvedOptions,
  SystemCapabilitiesResponse,
  SystemConfigResponse,
  SystemUsageResponse,
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
  width?: number | null;
  height?: number | null;
  scale?: string | number | null;
};

type QueryParamValue = string | number | boolean | Array<string | number | boolean> | null | undefined;

type ClientOptions = {
  token?: string | null;
};

type LoginRequest = {
  username: string;
  password: string;
  project_id?: string | null;
  project_key?: string | null;
  create_project?: {
    project_key: string;
    project_name?: string | null;
    description?: string | null;
    kvstore_directory: string;
    kvstore_name: string;
    is_active?: boolean;
    metadata?: Record<string, unknown>;
  } | null;
  ttl_seconds?: number | null;
  metadata?: Record<string, unknown>;
};

type ProjectSwitchRequest = {
  project_id?: string | null;
  project_key?: string | null;
  ttl_seconds?: number | null;
  metadata?: Record<string, unknown>;
};

type CreateProjectRequest = {
  project_key: string;
  project_name?: string | null;
  description?: string | null;
  kvstore_directory?: string | null;
  kvstore_name?: string | null;
  kvstore_root_path?: string | null;
  is_active?: boolean;
  metadata?: Record<string, unknown>;
};

type UpdateProjectRequest = {
  project_name?: string | null;
  description?: string | null;
  kvstore_root_path?: string | null;
  is_active?: boolean | null;
  metadata?: Record<string, unknown> | null;
};

type CreateUserRequest = {
  username: string;
  password?: string | null;
  display_name?: string | null;
  is_admin?: boolean;
  is_active?: boolean;
  project_id?: string | null;
  project_key?: string | null;
  role?: string;
  metadata?: Record<string, unknown>;
};

type RequestOptions = {
  auth?: 'required' | 'none';
  cache?: RequestCache;
};

let activeApiToken: string | null = null;

export function setActiveApiToken(token: string | null): void {
  activeApiToken = token || null;
}

export function authenticatedRequestInit(init: RequestInit = {}, token = activeApiToken): RequestInit {
  const headers = new Headers(init.headers);
  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  } else {
    headers.delete('authorization');
  }
  return { ...init, headers };
}

export function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, authenticatedRequestInit(init));
}

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
  readonly token: string | null;
  private cache = new Map<string, CacheRecord<unknown>>();

  constructor(baseUrl: string, options: ClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.token = options.token ?? null;
  }

  async get<T>(path: string, params?: Record<string, QueryParamValue>, ttlMs = 0, options: RequestOptions = {}): Promise<T> {
    const url = this.url(path, params);
    if (ttlMs > 0) {
      const cached = this.cache.get(url) as CacheRecord<T> | undefined;
      if (cached && cached.expiresAt > Date.now()) {
        return cached.value;
      }
    }

    const value = await this.request<T>(url, undefined, options);
    if (ttlMs > 0) {
      this.cache.set(url, { expiresAt: Date.now() + ttlMs, value });
    }
    return value;
  }

  async post<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    const value = await this.request<T>(this.url(path), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    }, options);
    this.cache.clear();
    return value;
  }

  async patch<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    const value = await this.request<T>(this.url(path), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    }, options);
    this.cache.clear();
    return value;
  }

  async delete<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const value = await this.request<T>(this.url(path), {
      method: 'DELETE'
    }, options);
    this.cache.clear();
    return value;
  }

  async health(): Promise<HealthResponse> {
    return this.get<HealthResponse>('/health', undefined, 0, { auth: 'none' });
  }

  async systemStatus(projectIdOrKey?: string | null, options: { deep_kvstore?: boolean } = {}): Promise<SystemStatus> {
    if (projectIdOrKey) {
      return this.get<SystemStatus>(
        `/system/status/${encodeURIComponent(projectIdOrKey)}`,
        compact(options),
        0,
        { cache: 'no-store' }
      );
    }
    return this.get<SystemStatus>('/system/status', compact(options), 0, { auth: 'none', cache: 'no-store' });
  }

  async systemUse(): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>('/system/use', undefined, 15000, { auth: 'none' });
  }

  async systemUsage(): Promise<SystemUsageResponse> {
    return this.get<SystemUsageResponse>('/system/usage', undefined, 0, { cache: 'no-store' });
  }

  async systemConfig(): Promise<SystemConfigResponse> {
    return this.get<SystemConfigResponse>('/system/config', undefined, 15000, { auth: 'none' });
  }

  async systemCapabilities(): Promise<SystemCapabilitiesResponse> {
    return this.get<SystemCapabilitiesResponse>('/system/capabilities', undefined, 15000, { auth: 'none' });
  }

  async login(body: LoginRequest): Promise<AuthLoginResponse> {
    return this.post<AuthLoginResponse>('/auth/login', compact(body), { auth: 'none' });
  }

  async authMe(): Promise<AuthMeResponse> {
    return this.get<AuthMeResponse>('/auth/me');
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const response = await this.get<{ projects: ProjectSummary[] }>('/projects');
    return response.projects ?? [];
  }

  async createProject(body: CreateProjectRequest): Promise<{ project: ProjectSummary; membership?: ProjectMembershipSummary | null }> {
    return this.post('/projects', compact(body));
  }

  async updateProject(projectIdOrKey: string, body: UpdateProjectRequest): Promise<{ project: ProjectSummary }> {
    return this.request(this.url(`/projects/${encodeURIComponent(projectIdOrKey)}`), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(compact(body))
    });
  }

  async getProjectStorageSettings(projectIdOrKey: string): Promise<ProjectStorageSettingsResponse> {
    return this.get<ProjectStorageSettingsResponse>(`/projects/${encodeURIComponent(projectIdOrKey)}/storage-settings`);
  }

  async updateProjectStorageSettings(
    projectIdOrKey: string,
    body: ProjectStorageSettingsRequest
  ): Promise<ProjectStorageSettingsResponse> {
    return this.request(this.url(`/projects/${encodeURIComponent(projectIdOrKey)}/storage-settings`), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(compact(body))
    });
  }

  async deleteProject(projectIdOrKey: string): Promise<{ deleted: boolean; project: ProjectSummary }> {
    return this.delete(`/projects/${encodeURIComponent(projectIdOrKey)}`);
  }

  async createUser(body: CreateUserRequest): Promise<{ user: AuthUserSummary; membership?: ProjectMembershipSummary | null }> {
    return this.post('/users', compact(body));
  }

  async updateProjectUserRole(
    projectIdOrKey: string,
    userIdOrUsername: string,
    role: string
  ): Promise<{ user?: AuthUserSummary | null; membership?: ProjectMembershipSummary | null }> {
    return this.post(
      `/projects/${encodeURIComponent(projectIdOrKey)}/users/${encodeURIComponent(userIdOrUsername)}/role`,
      { role }
    );
  }

  async listUsers(options: { active_only?: boolean; include_all_projects?: boolean } = {}): Promise<AuthUserSummary[]> {
    const response = await this.get<{ users?: AuthUserSummary[] } | AuthUserSummary[]>('/users', compact(options));
    return Array.isArray(response) ? response : response.users ?? [];
  }

  async resetUserPassword(userIdOrUsername: string, password: string): Promise<{ reset: boolean; user: AuthUserSummary | null }> {
    return this.post(`/users/${encodeURIComponent(userIdOrUsername)}/reset-password`, { password });
  }

  async deactivateUser(userIdOrUsername: string): Promise<{ deactivated: boolean; user: AuthUserSummary | null }> {
    return this.post(`/users/${encodeURIComponent(userIdOrUsername)}/deactivate`);
  }

  async deleteUser(userIdOrUsername: string): Promise<{ deleted: boolean; user: AuthUserSummary | null }> {
    return this.delete(`/users/${encodeURIComponent(userIdOrUsername)}`);
  }

  async switchProject(body: ProjectSwitchRequest): Promise<AuthLoginResponse> {
    return this.post<AuthLoginResponse>('/auth/switch-project', compact(body));
  }

  async logout(): Promise<{ revoked?: boolean }> {
    return this.post<{ revoked?: boolean }>('/auth/logout');
  }

  async segmentationOptions(): Promise<SegmentationCapabilities> {
    return this.get<SegmentationCapabilities>('/segmentation/options', undefined, 15000, { auth: 'none' });
  }

  async roiRefinementOptions(): Promise<RoiRefinementCapabilities> {
    return this.get<RoiRefinementCapabilities>('/roi-refinement/options', undefined, 15000, { auth: 'none' });
  }

  async kvStoreOverview(options: KvStoreOverviewOptions = {}): Promise<KvStoreOverview> {
    return this.get<KvStoreOverview>('/kvstore', compact(options), 0, { auth: 'none', cache: 'no-store' });
  }

  async listJobs(options: number | JobListOptions = 100): Promise<Job[]> {
    const params = typeof options === 'number' ? { limit: options } : options;
    const response = await this.get<{ jobs: Job[] }>('/jobs', params, 0, { cache: 'no-store' });
    return response.jobs ?? [];
  }

  async jobsSummary(options: JobsSummaryOptions = {}): Promise<JobsSummaryResponse> {
    return this.get<JobsSummaryResponse>('/jobs/summary', options, 0, { cache: 'no-store' });
  }

  async clearJobs(options: JobsClearOptions = {}): Promise<JobsClearResponse> {
    return this.post<JobsClearResponse>('/jobs/clear', compact(options));
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
    const response = await this.get<{ workers: WorkerSession[] }>('/workers', { limit }, 1500, { auth: 'none' });
    return response.workers ?? [];
  }

  async requestWorkerShutdown(workerId: string): Promise<WorkerSession> {
    const response = await this.post<{ worker: WorkerSession }>(`/workers/${encodeURIComponent(workerId)}/shutdown`, {
      reason: 'Shutdown requested from PelagiaView'
    }, { auth: 'none' });
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
    sort_by?: 'asset_frame' | 'frame' | 'captured_at' | 'filename' | 'roi_count' | 'refined_count' | null;
    sort_dir?: 'asc' | 'desc' | null;
    limit?: number | null;
    offset?: number | null;
  } = {}): Promise<FrameProcessingState> {
    return this.get<FrameProcessingState>('/frames/processing-state', options, 3000);
  }

  async processingStatusSummary(filters: ProcessingStatusFilters = {}): Promise<ProcessingStatusSummaryResponse> {
    return this.get<ProcessingStatusSummaryResponse>('/processing/status/summary', compact(filters), 3000);
  }

  async processingStatusFacets(filters: ProcessingStatusFilters = {}): Promise<ProcessingStatusFacetsResponse> {
    return this.get<ProcessingStatusFacetsResponse>('/processing/status/facets', compact(filters), 3000);
  }

  async processingStatusFrames(filters: ProcessingStatusFilters = {}): Promise<ProcessingStatusFramesResponse> {
    return this.get<ProcessingStatusFramesResponse>('/processing/status/frames', compact(filters), 3000);
  }

  async processingStatusFrameIds(filters: ProcessingStatusFilters = {}): Promise<ProcessingStatusFrameIdsResponse> {
    return this.get<ProcessingStatusFrameIdsResponse>('/processing/status/frames/ids', compact(filters), 3000);
  }

  async queueProcessing(body: ProcessingQueueRequest): Promise<ProcessingQueueResponse> {
    return this.post<ProcessingQueueResponse>('/processing/queue', body);
  }

  async getAsset(assetId: string): Promise<RawAsset> {
    const response = await this.get<{ asset: RawAsset }>(`/assets/${encodeURIComponent(assetId)}`, undefined, 2500);
    return response.asset;
  }

  async updateAsset(assetId: string, body: AssetUpdateRequest): Promise<RawAsset> {
    const response = await this.patch<{ asset: RawAsset }>(`/assets/${encodeURIComponent(assetId)}`, compact(body));
    return response.asset;
  }

  async deleteAsset(assetId: string): Promise<AssetDeleteResponse> {
    return this.delete<AssetDeleteResponse>(`/assets/${encodeURIComponent(assetId)}`);
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
      compact({
        format,
        apply_mask: options.applyMask || undefined,
        width: options.width,
        height: options.height,
        scale: options.scale
      })
    );
  }

  detectionRoiUrl(detectionId: string, format = 'jpg', options: DetectionImageOptions = {}): string {
    return this.url(
      `/detections/${encodeURIComponent(detectionId)}/roi`,
      compact({
        format,
        apply_mask: options.applyMask || undefined,
        width: options.width,
        height: options.height,
        scale: options.scale
      })
    );
  }

  refinedDetectionImageUrl(detectionId: string, format = 'jpg', options: DetectionImageOptions = {}): string {
    return this.url(
      `/detections/${encodeURIComponent(detectionId)}/refined-roi`,
      compact({
        format,
        apply_mask: options.applyMask || undefined,
        width: options.width,
        height: options.height,
        scale: options.scale
      })
    );
  }

  refinedDetectionRecordUrl(refinedDetectionId: string): string {
    return this.url(`/refined-detections/${encodeURIComponent(refinedDetectionId)}`);
  }

  resolveApiUrl(value: string): string {
    if (/^[a-z][a-z\d+\-.]*:\/\//i.test(value)) return value;
    return this.url(value);
  }

  async getRefinedDetection(refinedDetectionId: string): Promise<DetectionSummary> {
    return this.get<DetectionSummary>(`/refined-detections/${encodeURIComponent(refinedDetectionId)}`);
  }

  refinedDetectionRecordImageUrl(refinedDetectionId: string, format = 'jpg', options: DetectionImageOptions = {}): string {
    return this.url(
      `/refined-detections/${encodeURIComponent(refinedDetectionId)}/roi`,
      compact({
        format,
        apply_mask: options.applyMask || undefined,
        width: options.width,
        height: options.height,
        scale: options.scale
      })
    );
  }

  detectionMaskUrl(detectionId: string, format = 'png', options: DetectionImageOptions = {}): string {
    return this.url(
      `/detections/${encodeURIComponent(detectionId)}/mask`,
      compact({
        format,
        width: options.width,
        height: options.height,
        scale: options.scale
      })
    );
  }

  refinedDetectionMaskUrl(detectionId: string, format = 'png', options: DetectionImageOptions = {}): string {
    return this.url(
      `/detections/${encodeURIComponent(detectionId)}/refined-mask`,
      compact({
        format,
        width: options.width,
        height: options.height,
        scale: options.scale
      })
    );
  }

  refinedDetectionRecordMaskUrl(refinedDetectionId: string, format = 'png', options: DetectionImageOptions = {}): string {
    return this.url(
      `/refined-detections/${encodeURIComponent(refinedDetectionId)}/mask`,
      compact({
        format,
        width: options.width,
        height: options.height,
        scale: options.scale
      })
    );
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

  async analyzeIngestionSource(body: AnalyzeIngestionRequest): Promise<AnalyzeIngestionResponse> {
    return this.post<AnalyzeIngestionResponse>('/ingestion/analyze', compact(body));
  }

  async queueAnalyzedAssets(body: QueueAssetsRequest): Promise<QueueAssetsResponse> {
    return this.post<QueueAssetsResponse>('/ingestion/assets', compact(body));
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

  async liveThresholdFrame(frameId: string, options: SegmentationOptions & {
    include_mask_payload?: boolean;
    mask_encoding?: string | null;
  }): Promise<LiveThresholdResponse> {
    return this.get('/live/threshold', {
      frame_id: frameId,
      ...compact(options)
    });
  }

  async liveDetectionCandidateFrame(frameId: string, options: SegmentationOptions & {
    include_detection_payloads?: boolean;
    max_detections?: number | null;
  }): Promise<LiveDetectionCandidateResponse> {
    return this.get('/live/detection-candidate', {
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
    if (!this.token) {
      throw new ApiError(401, 'Pelagia session token is required.');
    }
    const { encoding, ...preprocessOptions } = options;
    const params = {
      frame_id: frameId,
      encoding,
      ...compact(preprocessOptions)
    };
    const value = await this.request<LivePreprocessResponse>(
      this.url('/live/preprocess', params),
      {
        method: 'POST'
      }
    );
    this.cache.clear();
    return value;
  }

  async listLiveSandboxFrames(options: {
    source_frame_id?: string | null;
    operation?: string | null;
    limit?: number | null;
    offset?: number | null;
  } = {}): Promise<LiveSandboxListResponse> {
    return this.get('/live/sandbox', options);
  }

  async deleteLiveSandboxFrame(frameId: string): Promise<LiveSandboxDeleteResponse> {
    return this.delete(`/live/sandbox/${encodeURIComponent(frameId)}`);
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
    inference_backend?: string | null;
    model_ref?: string | null;
    refinement_method?: string | null;
    refined_detections?: DetectionSummary[];
  }> {
    return this.post('/roi-refinement', compact(body));
  }

  async getCurationOptions(): Promise<CurationOptions> {
    return this.get('/curation/options', {}, 0);
  }

  async listCurationLabels(includeDeprecated = false): Promise<CurationLabel[]> {
    const response = await this.get<{ labels: CurationLabel[] }>('/curation/labels', {
      include_deprecated: includeDeprecated
    }, 0);
    return response.labels ?? [];
  }

  async createCurationLabel(body: { name: string; display_name?: string | null }): Promise<CurationLabel> {
    const response = await this.post<{ label: CurationLabel }>('/curation/labels', body);
    return response.label;
  }

  async listCurationRois(options: Record<string, unknown> = {}): Promise<CurationRoiPage> {
    return this.get('/curation/rois', options as Record<string, QueryParamValue>, 0);
  }

  async getCurationRoi(roiId: string): Promise<CurationRoi> {
    const response = await this.get<{ roi: CurationRoi }>(`/curation/rois/${encodeURIComponent(roiId)}`, {}, 0);
    return response.roi;
  }

  async annotateCurationRois(
    roiIds: string[],
    labelId: string,
    suggestedByEvidenceId?: string | null
  ): Promise<void> {
    await this.post('/curation/annotations', {
      roi_ids: roiIds,
      label_id: labelId,
      suggested_by_evidence_id: suggestedByEvidenceId || undefined
    });
  }

  async reviewCurationRois(roiIds: string[], decision: 'verified' | 'rejected' | 'needs_review'): Promise<void> {
    await this.post('/curation/reviews', { roi_ids: roiIds, decision });
  }

  async removeCurationLabels(roiIds: string[]): Promise<void> {
    await this.post('/curation/annotations/remove', { roi_ids: roiIds });
  }

  async queueClassificationJob(body: {
    roi_ids?: string[];
    model_ref?: string | null;
    priority?: number | null;
  }): Promise<{ job: Job; model_ref: string }> {
    return this.post('/curation/classification-jobs', compact(body));
  }

  async listRawDirectory(path = '.'): Promise<DirectoryListing> {
    try {
      const params = isRootDirectoryRequest(path) ? {} : { directory: path };
      const response = await this.get<{
        directory?: string | null;
        entries?: Array<DirectoryEntry & { is_dir?: boolean; exists?: boolean }>;
        roots?: Array<DirectoryEntry & { is_dir?: boolean; exists?: boolean }>;
      }>('/live/files', params, 0, { auth: 'none' });
      const directory = response.directory ?? '.';
      return {
        path: directory,
        entries: (response.entries ?? response.roots ?? []).map((entry) => normalizeDirectoryEntry(entry, directory)),
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

  private async request<T>(input: string, init?: RequestInit, options: RequestOptions = {}): Promise<T> {
    let response: Response;
    const requestInit = options.auth === 'none' ? { ...(init ?? {}) } : authenticatedRequestInit(init, this.token);
    if (options.cache) requestInit.cache = options.cache;
    const started = performance.now();
    try {
      response = await fetch(input, requestInit);
      recordApiRequest(input, requestInit, response, performance.now() - started);
    } catch (error) {
      recordApiRequest(input, requestInit, null, performance.now() - started, error);
      throw new ApiError(
        0,
        `Unable to reach Pelagia at ${this.baseUrl}. Check that the server is running and allows browser requests from PelagiaView.`,
        error
      );
    }
    if (!response.ok) {
      const detail = await responseDetail(response);
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
    return this.resolveApiUrl(value);
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

function isRootDirectoryRequest(path: string) {
  const trimmed = path.trim();
  return !trimmed || trimmed === '.';
}

function normalizeDirectoryEntry(
  entry: DirectoryEntry & { is_dir?: boolean; exists?: boolean },
  directory: string
): DirectoryEntry {
  const explicitKind = entry.kind === 'directory' || entry.kind === 'file' ? entry.kind : null;
  const kind = explicitKind ?? (entry.is_dir ? 'directory' : 'file');
  const path = entry.path || pathFromDirectoryEntry(directory, entry);
  return {
    ...entry,
    path,
    kind
  };
}

function pathFromDirectoryEntry(directory: string, entry: DirectoryEntry) {
  if (entry.relative_path) {
    if (!directory || directory === '.') return entry.relative_path;
    return `${directory.replace(/\/+$/, '')}/${entry.relative_path.replace(/^\/+/, '')}`;
  }
  return entry.name;
}

async function responseDetail(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('json')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
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
