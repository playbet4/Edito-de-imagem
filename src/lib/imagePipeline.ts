import type {
  ContentBounds,
  ImagePipelineParams,
  OutputFormat,
  WatermarkColorMode,
} from '../types/imagePipeline';

/**
 * Euclidean distance in RGB space between two opaque colors.
 */
export function colorDistance(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

/**
 * Estimates a representative "background" RGB by sampling the image border (corners + edge stride).
 */
export function deriveBackgroundColorFromBorderSamples(
  data: Uint8ClampedArray,
  width: number,
  height: number
): { r: number; g: number; b: number } {
  const samples: { r: number; g: number; b: number }[] = [];

  const pushPixel = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    samples.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
  };

  pushPixel(0, 0);
  pushPixel(width - 1, 0);
  pushPixel(0, height - 1);
  pushPixel(width - 1, height - 1);

  const stride = Math.max(1, Math.floor(Math.min(width, height) / 120));
  for (let x = 0; x < width; x += stride) {
    pushPixel(x, 0);
    pushPixel(x, height - 1);
  }
  for (let y = 0; y < height; y += stride) {
    pushPixel(0, y);
    pushPixel(width - 1, y);
  }

  const medianChannel = (channel: 'r' | 'g' | 'b') => {
    const sorted = [...samples.map((s) => s[channel])].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };

  return {
    r: medianChannel('r'),
    g: medianChannel('g'),
    b: medianChannel('b'),
  };
}

export function removeBackgroundByColorDistance(
  data: Uint8ClampedArray,
  bg: { r: number; g: number; b: number },
  tolerance: number
): void {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const dist = colorDistance({ r, g, b }, bg);
    if (dist <= tolerance) {
      data[i + 3] = 0;
    }
  }
}

export function computeContentBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number
): ContentBounds | null {
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let hasVisible = false;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] <= 0) continue;
    hasVisible = true;
    const pixelIndex = i / 4;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  if (!hasVisible) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * Clamps inclusive crop bounds to image pixels [0, w-1] x [0, h-1] and enforces a minimal size.
 */
export function clampCropBounds(bounds: ContentBounds, width: number, height: number): ContentBounds {
  const maxXI = width - 1;
  const maxYI = height - 1;
  let minX = Math.round(Math.min(bounds.minX, bounds.maxX));
  let maxX = Math.round(Math.max(bounds.minX, bounds.maxX));
  let minY = Math.round(Math.min(bounds.minY, bounds.maxY));
  let maxY = Math.round(Math.max(bounds.minY, bounds.maxY));

  minX = Math.max(0, Math.min(minX, maxXI));
  maxX = Math.max(0, Math.min(maxX, maxXI));
  minY = Math.max(0, Math.min(minY, maxYI));
  maxY = Math.max(0, Math.min(maxY, maxYI));

  if (maxX < minX) [minX, maxX] = [maxX, minX];
  if (maxY < minY) [minY, maxY] = [maxY, minY];

  if (maxX - minX < 1) {
    const cx = Math.min(minX, maxXI - 1);
    minX = cx;
    maxX = cx + 1;
  }
  if (maxY - minY < 1) {
    const cy = Math.min(minY, maxYI - 1);
    minY = cy;
    maxY = cy + 1;
  }

  return { minX, minY, maxX, maxY };
}

export interface WorkingCanvasResult {
  canvas: HTMLCanvasElement;
  autoBounds: ContentBounds | null;
}

/**
 * Loads image onto a canvas and optionally removes background — shared by export pipeline and crop preview.
 */
export function buildWorkingCanvas(
  img: HTMLImageElement,
  removeBackground: boolean,
  tolerance: number
): WorkingCanvasResult {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { canvas, autoBounds: null };
  }

  canvas.width = img.width;
  canvas.height = img.height;
  ctx.drawImage(img, 0, 0);

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;

  if (removeBackground) {
    const bg = deriveBackgroundColorFromBorderSamples(data, canvas.width, canvas.height);
    removeBackgroundByColorDistance(data, bg, tolerance);
  }

  ctx.putImageData(imgData, 0, 0);

  const autoBounds = computeContentBounds(data, canvas.width, canvas.height);
  return { canvas, autoBounds };
}

export function workingCanvasToPngDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png');
}

/**
 * Applies the watermark color/opacity transform onto a 2D context using native
 * composite operations. Avoids the per-pixel JS loop (10-100x faster on large
 * canvases) by relying on the GPU/native canvas pipeline.
 *
 * - White color mode → `source-atop` with opaque white preserves destination
 *   alpha while replacing RGB.
 * - Opacity → `destination-in` with `rgba(0,0,0,factor)` multiplies alpha.
 */
export function applyWatermarkComposite(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  colorMode: WatermarkColorMode,
  opacityPercent: number
): void {
  const clamped = Math.min(100, Math.max(10, opacityPercent));
  const factor = clamped / 100;

  ctx.save();
  if (colorMode === 'white') {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = `rgba(0, 0, 0, ${factor})`;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function formatDimensions(
  format: OutputFormat
): { baseW: number; baseH: number; isFixed: boolean; maxPadding: number } {
  switch (format) {
    case 'relatorio':
      return { baseW: 200, baseH: 80, isFixed: true, maxPadding: 10 };
    case 'logoAdm':
      return { baseW: 200, baseH: 74, isFixed: true, maxPadding: 10 };
    case 'site':
      return { baseW: 500, baseH: 500, isFixed: true, maxPadding: 30 };
    case 'favicon':
      return { baseW: 30, baseH: 30, isFixed: true, maxPadding: 0 };
    default:
      return { baseW: 0, baseH: 0, isFixed: false, maxPadding: Infinity };
  }
}

function cropSizeInclusive(bounds: ContentBounds): { cropW: number; cropH: number } {
  return {
    cropW: bounds.maxX - bounds.minX + 1,
    cropH: bounds.maxY - bounds.minY + 1,
  };
}

/**
 * Light-weight params controlling the post-background-removal stages
 * (crop / scale / format / watermark). Used by the cached fast path so we
 * don't re-decode the source image or re-run background removal on every
 * slider tick.
 */
export type FinalizeParams = Pick<
  ImagePipelineParams,
  | 'padding'
  | 'selectedFormat'
  | 'upscaleMultiplier'
  | 'watermarkEnabled'
  | 'watermarkColorMode'
  | 'watermarkOpacityPercent'
  | 'interactiveCropBounds'
>;

/**
 * Light-weight stage that produces the final HTMLCanvasElement (cropped, scaled
 * and watermarked). Encoding to PNG is left to the caller so it can use async
 * `toBlob` and avoid blocking the main thread.
 */
export function finalizeWorkingCanvas(
  workingCanvas: HTMLCanvasElement,
  autoBounds: ContentBounds,
  params: FinalizeParams
): HTMLCanvasElement | null {
  const w = workingCanvas.width;
  const h = workingCanvas.height;

  let bounds: ContentBounds;
  if (params.interactiveCropBounds) {
    bounds = clampCropBounds(params.interactiveCropBounds, w, h);
  } else {
    bounds = autoBounds;
  }

  const { cropW, cropH } = cropSizeInclusive(bounds);
  if (cropW <= 0 || cropH <= 0) return null;

  const fmt = formatDimensions(params.selectedFormat);
  let baseTargetW = cropW + params.padding * 2;
  let baseTargetH = cropH + params.padding * 2;
  const isFixed = fmt.isFixed;
  let currentPadding = params.padding;

  if (fmt.isFixed) {
    baseTargetW = fmt.baseW;
    baseTargetH = fmt.baseH;
    currentPadding = Math.min(params.padding, fmt.maxPadding);
  }

  const u = params.upscaleMultiplier;
  const targetW = baseTargetW * u;
  const targetH = baseTargetH * u;

  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = targetW;
  finalCanvas.height = targetH;
  const finalCtx = finalCanvas.getContext('2d');
  if (!finalCtx) return null;

  finalCtx.imageSmoothingEnabled = true;
  finalCtx.imageSmoothingQuality = 'high';

  if (isFixed) {
    const availW = targetW - currentPadding * 2 * u;
    const availH = targetH - currentPadding * 2 * u;
    const scale = Math.min(availW / cropW, availH / cropH);
    const drawW = cropW * scale;
    const drawH = cropH * scale;
    const drawX = (targetW - drawW) / 2;
    const drawY = (targetH - drawH) / 2;
    finalCtx.drawImage(
      workingCanvas,
      bounds.minX,
      bounds.minY,
      cropW,
      cropH,
      drawX,
      drawY,
      drawW,
      drawH
    );
  } else {
    const drawW = cropW * u;
    const drawH = cropH * u;
    const p = params.padding * u;
    finalCtx.drawImage(
      workingCanvas,
      bounds.minX,
      bounds.minY,
      cropW,
      cropH,
      p,
      p,
      drawW,
      drawH
    );
  }

  if (params.watermarkEnabled) {
    applyWatermarkComposite(
      finalCtx,
      targetW,
      targetH,
      params.watermarkColorMode,
      params.watermarkOpacityPercent
    );
  }

  return finalCanvas;
}

/**
 * Synchronous helper returning a PNG data URL. Prefer `finalizeWorkingCanvas`
 * + async `canvas.toBlob` in interactive paths to avoid blocking on encoding.
 */
export function finalizeWorkingCanvasToPng(
  workingCanvas: HTMLCanvasElement,
  autoBounds: ContentBounds,
  params: FinalizeParams
): string | null {
  const finalCanvas = finalizeWorkingCanvas(workingCanvas, autoBounds, params);
  if (!finalCanvas) return null;
  return finalCanvas.toDataURL('image/png');
}

export function processImageToPng(img: HTMLImageElement, params: ImagePipelineParams): string | null {
  const { canvas, autoBounds } = buildWorkingCanvas(
    img,
    params.removeBackground,
    params.tolerance
  );
  if (!autoBounds) return null;
  return finalizeWorkingCanvasToPng(canvas, autoBounds, params);
}
