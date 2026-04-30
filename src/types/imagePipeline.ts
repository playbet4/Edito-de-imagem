export type OutputFormat = 'custom' | 'relatorio' | 'site' | 'favicon';

export type BgRemovalMethod = 'canvas' | 'removebg';

export type WatermarkColorMode = 'white' | 'original';

export interface ImagePipelineParams {
  tolerance: number;
  padding: number;
  /** Shrinks the auto bounding box by up to this many pixels per edge (0–100). */
  manualCropExtra: number;
  removeBackground: boolean;
  selectedFormat: OutputFormat;
  upscaleMultiplier: number;
  bgRemovalMethod: BgRemovalMethod;
  watermarkEnabled: boolean;
  watermarkColorMode: WatermarkColorMode;
  /** 10–100; scales alpha of non-transparent pixels after optional white fill. */
  watermarkOpacityPercent: number;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface ContentBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
