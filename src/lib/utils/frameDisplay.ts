export type FrameDisplayMode = 'original' | 'preprocessed';

export function payloadKindForDisplay(mode: FrameDisplayMode): 'original' | 'preprocessed' {
  return mode === 'original' ? 'original' : 'preprocessed';
}

export function displayModeForPayloadKind(kind: string | null | undefined): FrameDisplayMode {
  return kind === 'preprocessed' ? 'preprocessed' : 'original';
}

export function frameCaption(mode: FrameDisplayMode): string {
  if (mode === 'preprocessed') return 'Preprocessed frame';
  return 'Original frame';
}
