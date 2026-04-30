export type OutputFormat = 'custom' | 'relatorio' | 'site' | 'favicon';

export type BgRemovalMethod = 'canvas' | 'removebg';

export interface ImagePipelineParams {
  tolerance: number;
  padding: number;
  removeBackground: boolean;
  selectedFormat: OutputFormat;
  upscaleMultiplier: number;
  bgRemovalMethod: BgRemovalMethod;
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
