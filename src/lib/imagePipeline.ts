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
 * Soft gloss accents (center + a few corners) drawn with `lighter` on top of a
 * uniform body — never used as the only source of visibility.
 */
function createSpecularSparks(
  mask: HTMLCanvasElement,
  width: number,
  height: number
): HTMLCanvasElement {
  const out = createCanvas(width, height);
  const octx = out.getContext('2d');
  if (!octx) return out;

  const maxDim = Math.max(width, height);
  const paintSpot = (cx: number, cy: number, radius: number, peak: number): void => {
    const g = octx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0, `rgba(255, 255, 255, ${peak})`);
    g.addColorStop(0.35, `rgba(255, 255, 255, ${peak * 0.4})`);
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    octx.fillStyle = g;
    octx.fillRect(0, 0, width, height);
  };

  octx.globalCompositeOperation = 'lighter';
  paintSpot(width * 0.4, height * 0.34, maxDim * 0.26, 1);
  paintSpot(width * 0.18, height * 0.14, maxDim * 0.1, 1);
  paintSpot(width * 0.72, height * 0.2, maxDim * 0.09, 0.9);
  paintSpot(width * 0.55, height * 0.65, maxDim * 0.08, 0.7);
  paintSpot(width * 0.3, height * 0.72, maxDim * 0.07, 0.55);

  octx.globalCompositeOperation = 'destination-in';
  octx.drawImage(mask, 0, 0);
  return out;
}

/**
 * Liquid glass with two independent gains:
 * - bodyGain → uniform fill across the whole silhouette (marca d'água)
 * - glassGain → rim, edge light and gloss (efeito vidro)
 *
 * Glass slider is remapped so 0% = flat mark (no rim/shine) and 100% = full
 * glass look — the previous linear 10–100 range barely changed what you saw.
 */
function applyLiquidGlassLook(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bodyGain: number,
  glassGain: number
): void {
  const mask = createAlphaMask(ctx.canvas, width, height);
  const minSide = Math.min(width, height);
  // Wider rim at high glass so the slider change is obvious
  const rimBlur = Math.max(0.8, Math.min(2.2, minSide * 0.007 * (0.7 + glassGain * 0.6)));
  const hiBlur = Math.max(1.1, Math.min(2.8, minSide * 0.009));
  const shadowBlur = Math.max(2.4, Math.min(7, minSide * 0.024));
  const lift = Math.max(1, Math.min(4, Math.round(minSide * 0.006)));
  const crispRim = createEdgeRing(mask, width, height, rimBlur, false);
  const softRim = createEdgeRing(mask, width, height, rimBlur * 1.7, false);
  const hiBand = createEdgeRing(mask, width, height, hiBlur, false);

  // 0 → none, 1 → full glass. Keep a hair of effect only above ~5%.
  const g = Math.max(0, Math.min(1, glassGain));
  const gCurve = g * g; // ease-in: low values almost flat, high values punchy

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);

  // 1) Soft contact shadow (mostly follows the mark body)
  const contact = createCanvas(width, height);
  const cctx = contact.getContext('2d');
  if (cctx) {
    cctx.filter = `blur(${shadowBlur}px)`;
    cctx.drawImage(mask, 0, 0);
    cctx.filter = 'none';
    cctx.globalCompositeOperation = 'source-in';
    cctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    cctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 0.2 * bodyGain + 0.12 * g;
    ctx.drawImage(contact, lift * 0.45, Math.max(1.5, lift + 1));
    ctx.globalAlpha = 1;
  }

  // 2) Uniform body — marca opacity only
  const body = createCanvas(width, height);
  const bctx = body.getContext('2d');
  if (bctx) {
    bctx.fillStyle = 'rgba(255, 255, 255, 0.58)';
    bctx.fillRect(0, 0, width, height);
    bctx.globalCompositeOperation = 'destination-in';
    bctx.drawImage(mask, 0, 0);
    ctx.globalAlpha = bodyGain;
    ctx.drawImage(body, 0, 0);
    ctx.globalAlpha = 1;
  }

  if (g > 0.02) {
    // 3) Soft outer glow rim (glass) + crisp inner filete
    const softRimLayer = createCanvas(width, height);
    const softCtx = softRimLayer.getContext('2d');
    if (softCtx) {
      softCtx.drawImage(softRim, 0, 0);
      softCtx.globalCompositeOperation = 'source-in';
      softCtx.fillStyle = 'rgba(255, 255, 255, 1)';
      softCtx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55 * g;
      ctx.drawImage(softRimLayer, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    const rimLayer = createCanvas(width, height);
    const rimCtx = rimLayer.getContext('2d');
    if (rimCtx) {
      rimCtx.drawImage(crispRim, 0, 0);
      rimCtx.globalCompositeOperation = 'source-in';
      rimCtx.fillStyle = 'rgba(255, 255, 255, 1)';
      rimCtx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = Math.min(1, 1.15 * g);
      ctx.drawImage(rimLayer, 0, 0);
      ctx.globalAlpha = 1;
    }

    // 4) Top-left edge catch — stronger at high glass
    const hi = tintMask(mask, width, height, 'rgba(255, 255, 255, 1)');
    const hiLayer = createCanvas(width, height);
    const hiCtx = hiLayer.getContext('2d');
    if (hiCtx) {
      hiCtx.drawImage(hi, -lift, -lift);
      hiCtx.globalCompositeOperation = 'destination-in';
      hiCtx.drawImage(mask, 0, 0);
      hiCtx.globalCompositeOperation = 'destination-in';
      hiCtx.drawImage(hiBand, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.95 * g;
      ctx.drawImage(hiLayer, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // 5) Gloss sparks — punchy at 100%, nearly gone at low glass
    const sparks = createSpecularSparks(mask, width, height);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, 1.05 * gCurve + 0.25 * g);
    ctx.drawImage(sparks, 0, 0);
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
 * - Liquid glass → uniform body (watermark opacity) + rim/shine (glass opacity).
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
  // Glass may go to 0 so “opacidade do vidro” can fully turn the effect off.
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
