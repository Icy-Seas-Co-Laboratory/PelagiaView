import type { Job } from '$lib/api/types';

export type JobAction = 'pause' | 'resume' | 'retry';
export type JobStageKey = 'ingestion' | 'preprocessing' | 'segmentation' | 'roi_refinement';

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
  ingestion: ['ingest', 'ingestion', 'video_ingest', 'frame_ingest', 'extract_frames', 'frame_extraction'],
  preprocessing: ['preprocess', 'preprocessing', 'frame_preprocess', 'frame_preprocessing', 'preprocess_frames'],
  segmentation: ['segment', 'segmentation', 'candidate', 'candidates', 'detection', 'detection_candidate', 'candidate_generation'],
  roi_refinement: ['roi_refinement', 'refinement', 'refine', 'refined_roi', 'roi_refine']
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
    const status = normalizedJobStatus(job);
    if (status === 'queued' || status === 'pending') counts.queued += 1;
    else if (status === 'leased' || status === 'running' || status === 'started' || status === 'active') counts.running += 1;
    else if (status === 'succeeded' || status === 'success' || status === 'completed' || status === 'complete') counts.succeeded += 1;
    else if (status === 'failed' || status === 'error' || status === 'cancelled' || status === 'canceled') counts.failed += 1;
    else if (status === 'paused' || status === 'pause') counts.paused += 1;
    else counts.other += 1;
  }
  return counts;
}

export function jobActions(job: Job): JobAction[] {
  const status = normalizedJobStatus(job);
  if (status === 'succeeded' || status === 'success' || status === 'completed' || status === 'complete') return ['retry'];
  if (status === 'queued' || status === 'leased' || status === 'running') return ['pause', 'retry'];
  if (status === 'paused' || status === 'pause') return ['resume', 'retry'];
  if (status === 'failed' || status === 'error' || status === 'cancelled' || status === 'canceled') return ['retry'];
  return ['pause', 'resume', 'retry'];
}

export function jobActionLabel(action: JobAction): string {
  if (action === 'pause') return 'Pause';
  if (action === 'resume') return 'Resume';
  return 'Retry';
}

export function jobActionClass(job: Job, action: JobAction): string {
  const status = normalizedJobStatus(job);
  return [
    'ghost',
    'job-action',
    (status === 'succeeded' || status === 'success' || status === 'completed' || status === 'complete') && action === 'retry'
      ? 'job-action-muted'
      : '',
    (status === 'queued' || status === 'leased' || status === 'running') && (action === 'pause' || action === 'retry')
      ? 'job-action-muted'
      : ''
  ]
    .filter(Boolean)
    .join(' ');
}
