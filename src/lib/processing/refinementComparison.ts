import { collectOffsetPages, type OffsetPage } from '../utils/offsetPagination';

type CandidateFrame = { frame_id?: string | null };

/** The displayed source frame can differ from the frame that owns live ROIs. */
export function refinementFrameId(candidates: readonly CandidateFrame[], fallbackFrameId: string): string {
  const ids = new Set(candidates.map((candidate) => candidate.frame_id).filter((id): id is string => Boolean(id)));
  if (ids.size > 1) throw new Error('ROI comparison candidates belong to different frames. Refresh candidates before refining.');
  const frameId = ids.values().next().value ?? fallbackFrameId;
  if (!frameId) throw new Error('No candidate frame is available for ROI comparison.');
  return frameId;
}

export async function loadRefinedComparison<T>(
  candidates: readonly CandidateFrame[],
  fallbackFrameId: string,
  fetchPage: (frameId: string, offset: number) => Promise<OffsetPage<T>>
): Promise<T[]> {
  const frameId = refinementFrameId(candidates, fallbackFrameId);
  return collectOffsetPages((offset) => fetchPage(frameId, offset), 'Refined ROI');
}
