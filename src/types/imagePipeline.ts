export type OutputFormat = 'custom' | 'relatorio' | 'logoAdm' | 'site' | 'favicon';

export type WatermarkColorMode = 'white' | 'original';

export type WatermarkPosition =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'center';

export type WatermarkSize = 'small' | 'medium' | 'large';

export interface ImagePipelineParams {
  tolerance: number;
  padding: number;
  removeBackground: boolean;
  selectedFormat: OutputFormat;
  upscaleMultiplier: number;
  watermarkEnabled: boolean;
  watermarkColorMode: WatermarkColorMode;
  /** 10–100; scales alpha of non-transparent pixels after optional white fill. */
  watermarkOpacityPercent: number;
  /** When true, the exported PNG is masked to a rounded rectangle. */
  roundedCorners: boolean;
  /** 0–50; corner radius as a percentage of the smaller output dimension (50 = pill/circle). */
  cornerRadiusPercent: number;
  /**
   * When null, crop uses automatic content bounds. When set, this rectangle (image pixels, inclusive
   * min/max indices) replaces the auto crop — must match the working canvas size after background removal.
   */
  interactiveCropBounds: ContentBounds | null;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Inclusive pixel indices on the working canvas (same convention as computeContentBounds). */
export interface ContentBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
