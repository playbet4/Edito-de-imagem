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

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** White silhouette preserving the source alpha (mask for glass layers). */
function createAlphaMask(
  source: CanvasImageSource,
  width: number,
  height: number
): HTMLCanvasElement {
  const mask = createCanvas(width, height);
  const mctx = mask.getContext('2d');
  if (!mctx) return mask;
  mctx.drawImage(source, 0, 0);
  mctx.globalCompositeOperation = 'source-in';
  mctx.fillStyle = '#ffffff';
  mctx.fillRect(0, 0, width, height);
  return mask;
}

/**
 * Soft ring from a blurred mask minus the sharp mask.
 * - outer=false → keep only the part inside the glyph (inner rim / bevel band)
 * - outer=true  → keep the bleed outside the glyph (halo / outer contour)
 */
function createEdgeRing(
  mask: HTMLCanvasElement,
  width: number,
  height: number,
  blurPx: number,
  outer = false
): HTMLCanvasElement {
  const ring = createCanvas(width, height);
  const rctx = ring.getContext('2d');
  if (!rctx) return ring;
  rctx.filter = `blur(${blurPx}px)`;
  rctx.drawImage(mask, 0, 0);
  rctx.filter = 'none';
  rctx.globalCompositeOperation = 'destination-out';
  rctx.drawImage(mask, 0, 0);
  if (!outer) {
    rctx.globalCompositeOperation = 'destination-in';
    rctx.drawImage(mask, 0, 0);
  }
  return ring;
}

/**
 * Mask tinted to a solid color (keeps alpha). Used for emboss highlight/shade.
 */
function tintMask(
  mask: HTMLCanvasElement,
  width: number,
  height: number,
  color: string
): HTMLCanvasElement {
  const out = createCanvas(width, height);
  const octx = out.getContext('2d');
  if (!octx) return out;
  octx.drawImage(mask, 0, 0);
  octx.globalCompositeOperation = 'source-in';
  octx.fillStyle = color;
  octx.fillRect(0, 0, width, height);
  return out;
}

/**
 * Liquid glass with two independent gains:
 * - markGain → strength of the outline around the logo (not a filled silhouette)
 * - glassGain → uniform interior fill only
 *
 * Border = thin ring OUTSIDE / on the contour. Never widen an inner ring enough
 * to paint the whole glyph gray (that happened when glass hit 0% before).
 * When glass drops, we only boost outline opacity a little — not fill the letter.
 */
function applyLiquidGlassLook(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  markGain: number,
  glassGain: number
): void {
  const mask = createAlphaMask(ctx.canvas, width, height);
  const minSide = Math.min(width, height);

  const mark = Math.max(0, Math.min(1, markGain));
  const glass = Math.max(0, Math.min(1, glassGain));
  const hollow = 1 - glass;
  // Opacity boost when hollow — stroke stays a contour, not a filled glyph
  const edgeBoost = 1 + hollow * 0.35;

  // Slightly bolder outer stroke (“leve negrito”), still outside the fill
  const outerBlur = Math.max(1.05, Math.min(2.1, minSide * 0.0068));
  const boldOuterBlur = Math.max(1.35, Math.min(2.6, minSide * 0.0085));
  const hairBlur = Math.max(0.55, Math.min(1.15, minSide * 0.0038));
  const bevelBlur = Math.max(0.7, Math.min(1.35, minSide * 0.0045));
  const lift = Math.max(1, Math.min(2, Math.round(minSide * 0.0045)));

  const outerContour = createEdgeRing(mask, width, height, outerBlur, true);
  const boldOuter = createEdgeRing(mask, width, height, boldOuterBlur, true);
  const hairline = createEdgeRing(mask, width, height, hairBlur, false);
  const bevelBand = createEdgeRing(mask, width, height, bevelBlur, false);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);

  // 1) Dark contact shade — outer ring only (liquid-glass depth, not a gray fill)
  const shadowRing = createCanvas(width, height);
  const sctx = shadowRing.getContext('2d');
  if (sctx) {
    const softOuter = createEdgeRing(
      mask,
      width,
      height,
      Math.max(2.2, Math.min(5, minSide * 0.02)),
      true
    );
    sctx.drawImage(softOuter, 0, 0);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
    sctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = Math.min(0.48, 0.32 * mark * edgeBoost);
    ctx.drawImage(shadowRing, lift * 0.5, Math.max(1.2, lift + 0.5));
    ctx.globalAlpha = 1;
  }

  // Tight dark lip just outside the stroke (reads as glass thickness)
  const darkLip = createCanvas(width, height);
  const dctx = darkLip.getContext('2d');
  if (dctx) {
    dctx.drawImage(boldOuter, 0, 0);
    dctx.globalCompositeOperation = 'source-in';
    dctx.fillStyle = 'rgba(15, 20, 28, 0.9)';
    dctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = Math.min(0.4, 0.28 * mark * edgeBoost);
    ctx.drawImage(darkLip, lift * 0.25, Math.max(0.8, lift * 0.6));
    ctx.globalAlpha = 1;
  }

  // 2) Uniform interior fill — glass only; empty when glass = 0
  if (glass > 0.01) {
    const body = createCanvas(width, height);
    const bctx = body.getContext('2d');
    if (bctx) {
      bctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      bctx.fillRect(0, 0, width, height);
      bctx.globalCompositeOperation = 'destination-in';
      bctx.drawImage(mask, 0, 0);
      ctx.globalAlpha = glass * mark;
      ctx.drawImage(body, 0, 0);
      ctx.globalAlpha = 1;
    }
  }

  // 3) White contour — soft under-stroke + brighter filete (leve negrito)
  const boldWhite = createCanvas(width, height);
  const bwCtx = boldWhite.getContext('2d');
  if (bwCtx) {
    bwCtx.drawImage(boldOuter, 0, 0);
    bwCtx.globalCompositeOperation = 'source-in';
    bwCtx.fillStyle = 'rgba(255, 255, 255, 1)';
    bwCtx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = Math.min(0.7, 0.48 * mark * edgeBoost);
    ctx.drawImage(boldWhite, 0, 0);
    ctx.globalAlpha = 1;
  }

  const outerLayer = createCanvas(width, height);
  const octx = outerLayer.getContext('2d');
  if (octx) {
    octx.drawImage(outerContour, 0, 0);
    octx.globalCompositeOperation = 'source-in';
    octx.fillStyle = 'rgba(255, 255, 255, 1)';
    octx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = Math.min(1, 0.95 * mark * edgeBoost);
    ctx.drawImage(outerLayer, 0, 0);
    ctx.globalAlpha = 1;
  }

  // 4) Inner hairline — brighter lip
  const hairLayer = createCanvas(width, height);
  const hctx = hairLayer.getContext('2d');
  if (hctx) {
    hctx.drawImage(hairline, 0, 0);
    hctx.globalCompositeOperation = 'source-in';
    hctx.fillStyle = 'rgba(255, 255, 255, 1)';
    hctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = Math.min(0.95, 0.78 * mark * edgeBoost);
    ctx.drawImage(hairLayer, 0, 0);
    ctx.globalAlpha = 1;
  }

  // 5) Specular catch on the lip
  const hi = tintMask(mask, width, height, 'rgba(255, 255, 255, 1)');
  const hiLayer = createCanvas(width, height);
  const hiCtx = hiLayer.getContext('2d');
  if (hiCtx) {
    hiCtx.drawImage(hi, -lift, -lift);
    hiCtx.globalCompositeOperation = 'destination-in';
    hiCtx.drawImage(mask, 0, 0);
    hiCtx.globalCompositeOperation = 'destination-in';
    hiCtx.drawImage(bevelBand, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(0.85, 0.58 * mark * edgeBoost);
    ctx.drawImage(hiLayer, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.restore();
}

/**
 * Applies the watermark color/opacity transform onto a 2D context using native
 * composite operations. Avoids the per-pixel JS loop (10-100x faster on large
 * canvases) by relying on the GPU/native canvas pipeline.
 *
 * - White → `source-atop` opaque white, preserving destination alpha.
 * - Liquid glass → uniform interior (glass opacity) + 3D rim (mark opacity).
 * - Opacity → linear `destination-in` for white/original.
 */
export function applyWatermarkComposite(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  colorMode: WatermarkColorMode,
  opacityPercent: number,
  liquidGlassOpacityPercent = 100
): void {
  const clamped = Math.min(100, Math.max(10, opacityPercent));
  const factor = clamped / 100;
  const glassClamped = Math.min(100, Math.max(0, liquidGlassOpacityPercent));
  const glassFactor = glassClamped / 100;

  ctx.save();
  if (colorMode === 'liquidGlass') {
    applyLiquidGlassLook(ctx, width, height, factor, glassFactor);
    ctx.restore();
    return;
  }

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

export interface RoundedCornerRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Clips artwork to a rounded rectangle using `destination-in`. Applied to the
 * drawn content rect (not necessarily the full canvas) so letterboxed fixed
 * formats like Relatório / Logo ADM round the logo itself instead of the empty
 * transparent margins around it.
 *
 * Radius is a percentage of the content rect's smaller side, so it stays
 * proportional across formats and upscale multipliers. Single native path
 * fill — no per-pixel work.
 */
export function applyRoundedCornersMask(
  ctx: CanvasRenderingContext2D,
  radiusPercent: number,
  contentRect: RoundedCornerRect
): void {
  const { x, y, width, height } = contentRect;
  if (width <= 0 || height <= 0) return;

  const clampedPercent = Math.min(50, Math.max(0, radiusPercent));
  const radius = (Math.min(width, height) * clampedPercent) / 100;
  if (radius <= 0) return;

  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = '#000000';
  traceRoundedRectPath(ctx, x, y, width, height, radius);
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
  | 'liquidGlassOpacityPercent'
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

  // Destination rect of the artwork on the output canvas. Rounded corners are
  // applied to this rect so letterboxed formats (Relatório, Logo ADM) round the
  // logo itself instead of the empty transparent canvas margins.
  let contentRect: RoundedCornerRect;

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
    contentRect = { x: drawX, y: drawY, width: drawW, height: drawH };
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
    contentRect = { x: p, y: p, width: drawW, height: drawH };
  }

  if (params.watermarkEnabled) {
    applyWatermarkComposite(
      finalCtx,
      targetW,
      targetH,
      params.watermarkColorMode,
      params.watermarkOpacityPercent,
      params.liquidGlassOpacityPercent
    );
  }

  // Runs last so the mask also trims whatever the watermark stage produced.
  if (params.roundedCorners) {
    applyRoundedCornersMask(finalCtx, params.cornerRadiusPercent, contentRect);
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
