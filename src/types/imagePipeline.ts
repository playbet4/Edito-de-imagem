export type OutputFormat = 'custom' | 'relatorio' | 'site' | 'favicon';

export type WatermarkColorMode = 'white' | 'original';

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
