import type { ProcessingSubmissionProgress } from '$lib/api/types';

/** Present durable planner state without mistaking a released batch for completion. */
export function submissionPhaseCopy(
  progress: ProcessingSubmissionProgress | null | undefined,
  unit = 'detections'
): string {
  const phase = progress?.phase;
  if (phase === 'finding_eligible') return `Finding eligible ${unit}.`;
  if (phase === 'waiting') {
    const waitingFor = progress?.waiting_for_submission_id;
    return waitingFor
      ? `Waiting behind request ${waitingFor.slice(0, 8)}.`
      : 'Waiting behind another processing request.';
  }
  if (phase === 'planning_and_processing') return 'Planning and processing';
  if (phase === 'processing') return 'Processing scheduled work.';
  if (phase === 'complete') return 'Processing complete.';
  if (phase === 'cancelled') return 'Cancelled.';
  if (phase === 'failed') return 'Planning failed.';
  return `Finding eligible ${unit}.`;
}

/** A terminal empty selection is a valid outcome, distinct from a failed plan. */
export function hasNoEligibleWork(progress: ProcessingSubmissionProgress | null | undefined): boolean {
  if (progress?.scheduled_count == null || progress.job_count == null) return false;
  return Number(progress.scheduled_count) === 0 && Number(progress.job_count) === 0;
}
