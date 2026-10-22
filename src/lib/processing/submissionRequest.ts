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
  const saved = retry ?? { request_id: createSubmissionId(), request };
  return { ...saved, kind };
}

/** randomUUID is secure-context-only; getRandomValues also works on HTTP servers. */
function createSubmissionId(): string {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  if (typeof crypto?.getRandomValues !== 'function') {
    throw new Error('This browser cannot generate a processing request ID. Browser cryptographic randomness is unavailable.');
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
