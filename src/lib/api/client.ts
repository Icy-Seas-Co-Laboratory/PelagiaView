import type {
  DetectionSummary,
  DirectoryEntry,
  DirectoryListing,
  FrameSummary,
  HealthResponse,
  Job,
  JobEvent,
  KvStoreOverview,
  RawAsset,
  SegmentationOptions,
  SystemStatus,
  WorkerSession
} from './types';

type CacheRecord<T> = {
  expiresAt: number;
  value: T;
};

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

  async get<T>(path: string, params?: Record<string, string | number | boolean | null | undefined>, ttlMs = 0): Promise<T> {
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

  async kvStoreOverview(): Promise<KvStoreOverview> {
    return this.get<KvStoreOverview>('/kvstore', undefined, 1500);
  }

  async listJobs(limit = 100): Promise<Job[]> {
    const response = await this.get<{ jobs: Job[] }>('/jobs', { limit }, 1500);
    return response.jobs ?? [];
  }

  async listJobEvents(afterId?: number, limit = 150): Promise<JobEvent[]> {
    const response = await this.get<{ events: JobEvent[] }>('/jobs/events', { after_id: afterId, limit });
    return response.events ?? [];
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

  async spawnWorker(capability: string): Promise<WorkerSession> {
    const response = await this.post<{ worker: WorkerSession }>('/workers', { capability });
    return response.worker;
  }

  async listAssets(kind?: string, limit = 200): Promise<RawAsset[]> {
    const response = await this.get<{ assets: RawAsset[] }>('/assets', { kind, limit }, 2500);
    return response.assets ?? [];
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

  frameImageUrl(assetId: string, frameNum: number): string {
    return this.url(`/assets/${encodeURIComponent(assetId)}/framedata/${frameNum}`);
  }

  async listDetections(assetId: string, frameId?: string): Promise<DetectionSummary[]> {
    const response = await this.get<{ detections: DetectionSummary[] }>(
      `/assets/${encodeURIComponent(assetId)}/detections`,
      { frame_id: frameId, limit: 500 }
    );
    return response.detections ?? [];
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
    detection_count: number;
    detections: DetectionSummary[];
  }> {
    return this.get('/live/segment', {
      frame_id: frameId,
      ...compact(options)
    });
  }

  async queueSegmentationJob(body: Record<string, unknown>): Promise<{ job: Job }> {
    return this.post('/segmentation/jobs', compact(body));
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
    try {
      response = await fetch(input, init);
    } catch (error) {
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

  private url(path: string, params?: Record<string, string | number | boolean | null | undefined>): string {
    const url = new URL(path.startsWith('/') ? path : `/${path}`, `${this.baseUrl}/`);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
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
