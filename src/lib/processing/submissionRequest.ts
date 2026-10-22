import { browser } from '$app/environment';
import type { JobSeriesRequest, ProcessingQueueRequest, ProcessingSubmissionKind, ProcessingSubmissionRequest } from '$lib/api/types';

export type RetryableSubmission<T extends ProcessingQueueRequest | JobSeriesRequest> = {
  request_id: string;
  request: T;
};

/** Keep both the opaque criteria and idempotency key intact after an ambiguous POST. */
export function prepareSubmission<T extends ProcessingQueueRequest | JobSeriesRequest>(
  kind: ProcessingSubmissionKind,
  request: T,
  retry?: RetryableSubmission<T> | null
): ProcessingSubmissionRequest & RetryableSubmission<T> {
  const saved = retry ?? { request_id: crypto.randomUUID(), request };
  return { ...saved, kind };
}

const storageKey = (scope: string, kind: ProcessingSubmissionKind) => `pelagia-pending-submission:${kind}:${encodeURIComponent(scope)}`;

export function restoreRetrySubmission<T extends ProcessingQueueRequest | JobSeriesRequest>(scope: string, kind: ProcessingSubmissionKind): RetryableSubmission<T> | null {
  if (!browser) return null;
  try {
    return JSON.parse(sessionStorage.getItem(storageKey(scope, kind)) ?? 'null') as RetryableSubmission<T> | null;
  } catch { return null; }
}

export function persistRetrySubmission<T extends ProcessingQueueRequest | JobSeriesRequest>(scope: string, kind: ProcessingSubmissionKind, pending: RetryableSubmission<T>): void {
  if (!browser) return;
  try { sessionStorage.setItem(storageKey(scope, kind), JSON.stringify(pending)); } catch { /* Memory retry remains usable when storage is unavailable. */ }
}

export function clearRetrySubmission(scope: string, kind: ProcessingSubmissionKind): void {
  if (!browser) return;
  try { sessionStorage.removeItem(storageKey(scope, kind)); } catch { /* Session storage is optional. */ }
}
