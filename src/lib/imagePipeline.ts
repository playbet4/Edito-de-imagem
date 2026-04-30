import type {
  ContentBounds,
  ImagePipelineParams,
  OutputFormat,
  Rgb,
} from '../types/imagePipeline';

/**
 * Euclidean distance in RGB space between two opaque colors.
 */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.sqrt(
    (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2
  );
}

/**
 * Estimates a representative "background" RGB by sampling the image border (corners + edge stride).
 * Uses per-channel median across samples: robust when one corner differs (e.g. logo touches a corner)
 * while most of the border shows the true backdrop color.
 */
export function deriveBackgroundColorFromBorderSamples(
  data: Uint8ClampedArray,
  width: number,
  height: number
): Rgb {
  const samples: Rgb[] = [];

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
 * Marks pixels within `tolerance` distance of `bg` as fully transparent (when removal is enabled).
 */
export function removeBackgroundByColorDistance(
  data: Uint8ClampedArray,
  bg: Rgb,
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

/**
 * Tight axis-aligned bounds of pixels with alpha > 0.
 */
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

function formatDimensions(
  format: OutputFormat
): { baseW: number; baseH: number; isFixed: boolean; maxPadding: number } {
  switch (format) {
    case 'relatorio':
      return { baseW: 200, baseH: 80, isFixed: true, maxPadding: 10 };
    case 'site':
      return { baseW: 500, baseH: 500, isFixed: true, maxPadding: 30 };
    case 'favicon':
      return { baseW: 30, baseH: 30, isFixed: true, maxPadding: 0 };
    default:
      return { baseW: 0, baseH: 0, isFixed: false, maxPadding: Infinity };
  }
}

/**
 * Full canvas pipeline: optional chroma-style removal, crop to content, pad, optional fixed canvas sizes,
 * scale by upscaleMultiplier with high-quality smoothing (browser interpolation, not ML upscaling).
 */
export function processImageToPng(
  img: HTMLImageElement,
  params: ImagePipelineParams
): string | null {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  canvas.width = img.width;
  canvas.height = img.height;
  ctx.drawImage(img, 0, 0);

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;

  const shouldRemoveLocal =
    params.removeBackground && params.bgRemovalMethod === 'canvas';

  if (shouldRemoveLocal) {
    const bg = deriveBackgroundColorFromBorderSamples(
      data,
      canvas.width,
      canvas.height
    );
    removeBackgroundByColorDistance(data, bg, params.tolerance);
  }

  ctx.putImageData(imgData, 0, 0);

  const bounds = computeContentBounds(data, canvas.width, canvas.height);
  if (!bounds) return null;

  const cropW = bounds.maxX - bounds.minX;
  const cropH = bounds.maxY - bounds.minY;

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
      canvas,
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
      canvas,
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

  return finalCanvas.toDataURL('image/png');
}
