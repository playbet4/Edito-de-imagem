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

/**
 * Marks pixels close to `bg` as fully transparent. Hot loop — uses squared
 * distance (no Math.sqrt), local primitives (no per-pixel allocations) and
 * caches array length to stay in a JIT-friendly shape.
 */
export function removeBackgroundByColorDistance(
  data: Uint8ClampedArray,
  bg: { r: number; g: number; b: number },
  tolerance: number
): void {
  const bgR = bg.r;
  const bgG = bg.g;
  const bgB = bg.b;
  const tolSq = tolerance * tolerance;
  const len = data.length;
  for (let i = 0; i < len; i += 4) {
    const dr = data[i] - bgR;
    const dg = data[i + 1] - bgG;
    const db = data[i + 2] - bgB;
    if (dr * dr + dg * dg + db * db <= tolSq) {
      data[i + 3] = 0;
    }
  }
}

/**
 * Trims the bounding box of opaque pixels using row-then-column edge scans
 * with early termination. For typical logos this is dramatically faster than
 * a full pass because the search stops as soon as the first opaque pixel of
 * each edge is found.
 */
export function computeContentBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number
): ContentBounds | null {
  let minY = -1;
  for (let y = 0; y < height; y++) {
    const rowStart = y * width * 4 + 3;
    const rowEnd = rowStart + width * 4;
    for (let i = rowStart; i < rowEnd; i += 4) {
      if (data[i] > 0) {
        minY = y;
        break;
      }
    }
    if (minY !== -1) break;
  }
  if (minY === -1) return null;

  let maxY = minY;
  for (let y = height - 1; y > minY; y--) {
    const rowStart = y * width * 4 + 3;
    const rowEnd = rowStart + width * 4;
    for (let i = rowStart; i < rowEnd; i += 4) {
      if (data[i] > 0) {
        maxY = y;
        break;
      }
    }
    if (maxY !== minY) break;
  }

  let minX = width;
  let maxX = -1;
  for (let y = minY; y <= maxY; y++) {
    const rowOffset = y * width * 4;
    for (let x = 0; x < minX; x++) {
      if (data[rowOffset + x * 4 + 3] > 0) {
        minX = x;
        break;
      }
    }
    for (let x = width - 1; x > maxX; x--) {
      if (data[rowOffset + x * 4 + 3] > 0) {
        maxX = x;
        break;
      }
    }
    if (minX === 0 && maxX === width - 1) break;
  }

  if (maxX < minX) return null;
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

/**
 * Traces a rounded-rectangle path. Hand-rolled with `arcTo` instead of
 * `ctx.roundRect` so it also works on browsers without the newer canvas API.
 */
function traceRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

/**
 * Clips the canvas to a rounded rectangle using `destination-in`, which keeps
 * the existing pixels only inside the path. Single native path fill — no
 * per-pixel work, so it stays in the cheap light stage.
 *
 * The radius is relative to the smaller side, so it scales consistently across
 * output formats and upscale multipliers.
 */
export function applyRoundedCornersMask(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  radiusPercent: number
): void {
  const clampedPercent = Math.min(50, Math.max(0, radiusPercent));
  const radius = (Math.min(width, height) * clampedPercent) / 100;
  if (radius <= 0) return;

  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = '#000000';
  traceRoundedRectPath(ctx, 0, 0, width, height, radius);
  ctx.fill();
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
  | 'roundedCorners'
  | 'cornerRadiusPercent'
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

  // Runs last so the mask also trims whatever the watermark stage produced.
  if (params.roundedCorners) {
    applyRoundedCornersMask(finalCtx, targetW, targetH, params.cornerRadiusPercent);
  }

  return finalCanvas;
}

/** Rec. 709 perceptual luminance weights. */
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

/**
 * Alpha-weighted mean luminance (0–1) of the visible artwork. Measured on a
 * downscaled copy so the cost is constant (a few hundred pixels) regardless of
 * the output resolution or upscale multiplier.
 *
 * Weighting by alpha means a faint white watermark still reports as "light",
 * which is exactly what the preview backdrop heuristic needs.
 * Returns null when there is nothing visible to measure.
 */
export function estimateArtworkLuminance(
  canvas: HTMLCanvasElement,
  sampleSize = 32
): number | null {
  if (canvas.width === 0 || canvas.height === 0) return null;

  const sample = document.createElement('canvas');
  sample.width = Math.max(1, Math.min(sampleSize, canvas.width));
  sample.height = Math.max(1, Math.min(sampleSize, canvas.height));
  const ctx = sample.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(canvas, 0, 0, sample.width, sample.height);
  const { data } = ctx.getImageData(0, 0, sample.width, sample.height);

  let weightedLuma = 0;
  let alphaSum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) continue;
    const luma = (LUMA_R * data[i] + LUMA_G * data[i + 1] + LUMA_B * data[i + 2]) / 255;
    weightedLuma += luma * a;
    alphaSum += a;
  }

  if (alphaSum === 0) return null;
  return weightedLuma / alphaSum;
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
