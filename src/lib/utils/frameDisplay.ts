export type FrameDisplayMode = 'original' | 'preprocessed' | 'preprocessed-inverted';

export function payloadKindForDisplay(mode: FrameDisplayMode): 'original' | 'preprocessed' {
  return mode === 'original' ? 'original' : 'preprocessed';
}

export function displayModeForPayloadKind(kind: string | null | undefined): FrameDisplayMode {
  return kind === 'preprocessed' ? 'preprocessed' : 'original';
}

export function frameCaption(mode: FrameDisplayMode): string {
  if (mode === 'preprocessed-inverted') return 'Preprocessed frame, inverted';
  if (mode === 'preprocessed') return 'Preprocessed frame';
  return 'Original frame';
}

export function isFrameDisplayInverted(mode: FrameDisplayMode): boolean {
  return mode === 'preprocessed-inverted';
}
