import type { WatermarkPosition, WatermarkSize } from '../types/imagePipeline';

/** Watermark width as a fraction of the property photo width per size token. */
const SIZE_RATIO: Record<WatermarkSize, number> = {
  small: 0.15,
  medium: 0.25,
  large: 0.4,
};

/** Edge padding as a fraction of the smaller dimension of the property photo. */
const EDGE_PADDING_RATIO = 0.04;

export interface ComposeWatermarkPreviewParams {
  propertyImage: HTMLImageElement;
  /** Already has color/opacity applied (i.e. exported `processedSrc`). */
  watermarkImage: HTMLImageElement;
  position: WatermarkPosition;
  size: WatermarkSize;
}

/**
 * Composes the watermark on top of a property photo, returning the resulting
 * canvas sized to the property photo's natural resolution. Encoding is left to
 * the caller so it can use async `toBlob` and avoid blocking on PNG encode.
 */
export function composeWatermarkPreviewCanvas(
  params: ComposeWatermarkPreviewParams
): HTMLCanvasElement | null {
  const { propertyImage, watermarkImage, position, size } = params;
  const propertyW = propertyImage.naturalWidth || propertyImage.width;
  const propertyH = propertyImage.naturalHeight || propertyImage.height;
  const watermarkW = watermarkImage.naturalWidth || watermarkImage.width;
  const watermarkH = watermarkImage.naturalHeight || watermarkImage.height;

  if (propertyW <= 0 || propertyH <= 0 || watermarkW <= 0 || watermarkH <= 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = propertyW;
  canvas.height = propertyH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.drawImage(propertyImage, 0, 0, propertyW, propertyH);

  const targetW = propertyW * SIZE_RATIO[size];
  const aspect = watermarkH / watermarkW;
  const targetH = targetW * aspect;

  const padding = Math.round(Math.min(propertyW, propertyH) * EDGE_PADDING_RATIO);

  let drawX = 0;
  let drawY = 0;
  switch (position) {
    case 'top-left':
      drawX = padding;
      drawY = padding;
      break;
    case 'top-right':
      drawX = propertyW - targetW - padding;
      drawY = padding;
      break;
    case 'bottom-left':
      drawX = padding;
      drawY = propertyH - targetH - padding;
      break;
    case 'bottom-right':
      drawX = propertyW - targetW - padding;
      drawY = propertyH - targetH - padding;
      break;
    case 'center':
      drawX = (propertyW - targetW) / 2;
      drawY = (propertyH - targetH) / 2;
      break;
  }

  ctx.drawImage(watermarkImage, drawX, drawY, targetW, targetH);

  return canvas;
}

/**
 * Sync helper kept for back-compat. Prefer `composeWatermarkPreviewCanvas` +
 * async `canvas.toBlob` to avoid blocking the main thread on PNG encoding.
 */
export function composeWatermarkPreview(params: ComposeWatermarkPreviewParams): string | null {
  const canvas = composeWatermarkPreviewCanvas(params);
  if (!canvas) return null;
  return canvas.toDataURL('image/png');
}
