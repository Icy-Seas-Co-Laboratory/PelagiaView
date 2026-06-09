export type CanvasCoordinateSpace = 'source' | 'image' | 'percent';
export type CanvasExportControls = 'full' | 'menu' | 'copy-menu' | 'none';

export type CanvasOverlayRect = {
  id?: string | number;
  x: number;
  y: number;
  w: number;
  h: number;
  stroke: string;
  lineWidth?: number;
  halo?: string;
  className?: string;
  coordinateSpace?: CanvasCoordinateSpace;
  selected?: boolean;
  hoverPreview?: {
    imageUrl: string;
    imageStyle: string;
    inverted?: boolean;
  };
};

export type CanvasScaleBar = {
  enabled?: boolean;
  lengths?: number[];
  placement?: 'inside' | 'below';
  maxPercent?: number;
};
