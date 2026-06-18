export type ImageCoordinateSpace = 'source' | 'image' | 'percent';
export type ImageViewerMode = 'thumbnail' | 'static' | 'viewer' | 'interactive';
export type ImageExportControls = 'full' | 'menu' | 'copy-menu' | 'none';

export type ImageBaseSpec = {
  url: string;
  alt?: string;
  invert?: boolean;
  sourceWidth?: number | null;
  sourceHeight?: number | null;
};

export type ImageBaseMaskSpec = {
  url: string;
  enabled?: boolean;
  outsideColor?: 'black' | 'white' | 'transparent';
  applyBeforeInvert?: boolean;
};

export type ImageRectLayer = {
  kind: 'rect';
  id?: string | number;
  x: number;
  y: number;
  w: number;
  h: number;
  stroke: string;
  lineWidth?: number;
  halo?: string;
  selected?: boolean;
  coordinateSpace?: ImageCoordinateSpace;
  tooltip?: string;
};

export type ImageMaskOverlayLayer = {
  kind: 'mask-overlay';
  id?: string | number;
  imageUrl: string;
  x: number;
  y: number;
  w: number;
  h: number;
  tint: string;
  opacity?: number;
  coordinateSpace?: ImageCoordinateSpace;
};

export type ImageLayer = ImageRectLayer | ImageMaskOverlayLayer;

export type ImageOverlayRect = {
  id?: string | number;
  x: number;
  y: number;
  w: number;
  h: number;
  stroke: string;
  lineWidth?: number;
  halo?: string;
  coordinateSpace?: ImageCoordinateSpace;
  selected?: boolean;
  tooltip?: string;
};

export type ImageOverlayImage = {
  id?: string | number;
  imageUrl: string;
  x: number;
  y: number;
  w: number;
  h: number;
  tint: string;
  opacity?: number;
  coordinateSpace?: ImageCoordinateSpace;
};

export type ImageScaleBarSpec = {
  enabled?: boolean;
  lengths?: number[];
  placement?: 'inside' | 'below';
  maxPercent?: number;
};

export type ImageInfoSpec = {
  assetFilename?: string | null;
  frameNumber?: string | number | null;
  timestamp?: string | null;
  collections?: string[] | string | null;
};

export type ImageToolbarSpec = {
  exportControls?: ImageExportControls;
  filename?: string;
  annotatedFilename?: string;
  originalUrl?: string;
  originalFilename?: string;
  maskUrl?: string;
  maskFilename?: string;
  maskedFilename?: string;
  info?: ImageInfoSpec | null;
};

export type ImageRenderSpec = {
  key?: string;
  image: ImageBaseSpec;
  baseMask?: ImageBaseMaskSpec | null;
  layers?: ImageLayer[];
  scaleBar?: ImageScaleBarSpec | null;
  toolbar?: ImageToolbarSpec | null;
  display?: {
    maxWidth?: number;
    maxHeight?: number;
    background?: string;
  };
};

export type ProjectedRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};
