import type { Job } from '$lib/api/types';

export type JobAction = 'pause' | 'resume' | 'retry';
export type JobStageKey = 'ingestion' | 'preprocessing' | 'segmentation' | 'roi_refinement' | 'classification' | 'export';
/**
 * Presentation categories deliberately sit above the wire-level job status.
 * Keep components from independently deciding that, for example, a leased
 * job is queued while a working job with a pause request is running.
 */
export type JobStatusCategory = 'queued' | 'running' | 'control_requested' | 'paused' | 'succeeded' | 'failed' | 'terminal' | 'other';

export const activeJobStatuses = ['queued', 'leased', 'working', 'paused'] as const;
export const runningJobStatuses = ['leased', 'working'] as const;

const queuedStatuses = new Set(['queued', 'pending']);
const runningStatuses = new Set(['leased', 'working', 'running', 'started', 'active']);
const pausedStatuses = new Set(['paused', 'pause']);
const succeededStatuses = new Set(['succeeded', 'success', 'completed', 'complete']);
const failedStatuses = new Set(['failed', 'error', 'dead_lettered']);
const cancelledStatuses = new Set(['cancelled', 'canceled']);

export function isControlRequested(job: Job): boolean {
  const reason = String(job.control_reason ?? '').trim().toLowerCase();
  const status = normalizedJobStatus(job);
  return (
    status === 'pause_requested' ||
    status === 'cancel_requested' ||
    status === 'cancelling' ||
    reason.startsWith('pause_requested:') ||
    reason.startsWith('cancel_requested:')
  );
}

export function jobStatusCategory(job: Job): JobStatusCategory {
  const status = normalizedJobStatus(job);
  if (isControlRequested(job)) return 'control_requested';
  if (queuedStatuses.has(status)) return 'queued';
  if (runningStatuses.has(status)) return 'running';
  if (pausedStatuses.has(status)) return 'paused';
  if (succeededStatuses.has(status)) return 'succeeded';
  if (failedStatuses.has(status)) return 'failed';
  if (cancelledStatuses.has(status)) return 'terminal';
  return 'other';
}

export function jobStatusLabel(job: Job): string {
  const category = jobStatusCategory(job);
  if (category === 'control_requested') {
    return String(job.control_reason ?? '').toLowerCase().startsWith('cancel_requested') ? 'cancel requested' : 'pause requested';
  }
  return job.status ?? 'unknown';
}

export type JobStatusCounts = {
  total: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  paused: number;
  other: number;
};

export const jobStageAliases: Record<JobStageKey, string[]> = {
  ingestion: ['ingest', 'ingestion', 'ingest_run', 'video_ingest', 'frame_ingest', 'extract_frames', 'frame_extraction'],
  preprocessing: ['preprocess', 'preprocessing', 'frame_preprocess', 'frame_preprocessing', 'preprocess_frames'],
  segmentation: ['segment', 'segmentation', 'candidate', 'candidates', 'detection', 'detection-candidate', 'candidate-generation'],
  roi_refinement: ['roi_refinement', 'refinement', 'refine', 'refined_roi', 'roi_refine'],
  classification: ['classify', 'classification', 'ml_evidence'],
  export: ['export_bundle', 'export', 'exports']
};

export function normalizedJobStatus(job: Job): string {
  return String(job.status ?? '').trim().toLowerCase();
}

export function normalizedJobStage(job: Job): string {
  return String(job.stage ?? '').trim().toLowerCase();
}

export function filterJobs(
  jobs: Job[],
  options: { stages?: string[] | null; jobIds?: string[] | null } = {}
): Job[] {
  const stageAliases = (options.stages ?? []).map((stage) => stage.toLowerCase());
  const jobIds = new Set((options.jobIds ?? []).filter(Boolean));
  return jobs.filter((job) => {
    const matchesId = jobIds.size > 0 && jobIds.has(job.id);
    const matchesStage =
      stageAliases.length > 0 &&
      stageAliases.some((alias) => {
        const stage = normalizedJobStage(job);
        return stage === alias || stage.includes(alias);
      });
    if (jobIds.size > 0 && stageAliases.length > 0) return matchesId || matchesStage;
    if (jobIds.size > 0) return matchesId;
    if (stageAliases.length > 0) return matchesStage;
    return true;
  });
}

export function countJobs(jobs: Job[]): JobStatusCounts {
  const counts: JobStatusCounts = {
    total: jobs.length,
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    paused: 0,
    other: 0
  };
  for (const job of jobs) {
    const category = jobStatusCategory(job);
    if (category === 'queued') counts.queued += 1;
    else if (category === 'running' || category === 'control_requested') counts.running += 1;
    else if (category === 'succeeded') counts.succeeded += 1;
    else if (category === 'failed' || category === 'terminal') counts.failed += 1;
    else if (category === 'paused') counts.paused += 1;
    else counts.other += 1;
  }
  return counts;
}

export function jobActions(job: Job): JobAction[] {
  const category = jobStatusCategory(job);
  if (category === 'succeeded' || category === 'failed' || category === 'terminal') return ['retry'];
  if (category === 'queued' || category === 'running') return ['pause', 'retry'];
  if (category === 'paused') return ['resume', 'retry'];
  if (category === 'control_requested') return [];
  return ['pause', 'resume', 'retry'];
}

export function jobActionLabel(action: JobAction): string {
  if (action === 'pause') return 'Pause';
  if (action === 'resume') return 'Resume';
  return 'Retry';
}

export function jobActionClass(job: Job, action: JobAction): string {
  const category = jobStatusCategory(job);
  return [
    'ghost',
    'job-action',
    category === 'succeeded' && action === 'retry'
      ? 'job-action-muted'
      : '',
    (category === 'queued' || category === 'running') && (action === 'pause' || action === 'retry')
      ? 'job-action-muted'
      : ''
  ]
    .filter(Boolean)
    .join(' ');
}
