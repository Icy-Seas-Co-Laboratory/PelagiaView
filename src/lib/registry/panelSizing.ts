export type PanelSide = 'left' | 'right';

export const PANEL_DEFAULT_WIDTH = { left: 250, right: 300 } as const;
export const PANEL_MIN_WIDTH = { left: 180, right: 240 } as const;
export const PANEL_MAX_WIDTH = { left: 520, right: 640 } as const;

const MIN_GALLERY_WIDTH = 320;
const RESIZER_WIDTHS = 14;

export function clampPanelWidth(side: PanelSide, value: number, viewportWidth: number, otherPanelWidth: number) {
  const available = Math.max(PANEL_MIN_WIDTH[side], viewportWidth - otherPanelWidth - MIN_GALLERY_WIDTH - RESIZER_WIDTHS);
  return Math.round(Math.min(PANEL_MAX_WIDTH[side], available, Math.max(PANEL_MIN_WIDTH[side], value)));
}

export function panelKeyDelta(side: PanelSide, key: string, step = 10) {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return 0;
  const direction = key === 'ArrowRight' ? 1 : -1;
  return side === 'left' ? direction * step : direction * -step;
}
