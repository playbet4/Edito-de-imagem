import { useEffect, useState } from 'react';
import {
  buildWorkingCanvas,
  workingCanvasToPngDataUrl,
} from '../lib/imagePipeline';
import type { ContentBounds } from '../types/imagePipeline';
import { useDebouncedValue } from './useDebouncedValue';

export interface PreparedCropPreview {
  dataUrl: string;
  autoBounds: ContentBounds | null;
  width: number;
  height: number;
}

/**
 * Renders the same working canvas as the export pipeline (optional BG removal) for the interactive crop UI.
 */
export function usePreparedCropPreview(
  imageSrc: string | null,
  removeBackground: boolean,
  tolerance: number
): PreparedCropPreview | null {
  const debouncedTolerance = useDebouncedValue(tolerance, 200);
  const [preview, setPreview] = useState<PreparedCropPreview | null>(null);

  useEffect(() => {
    if (!imageSrc) {
      setPreview(null);
      return;
    }

    const img = new window.Image();
    img.onload = () => {
      const { canvas, autoBounds } = buildWorkingCanvas(
        img,
        removeBackground,
        debouncedTolerance
      );
      setPreview({
        dataUrl: workingCanvasToPngDataUrl(canvas),
        autoBounds,
        width: canvas.width,
        height: canvas.height,
      });
    };
    img.onerror = () => setPreview(null);
    img.src = imageSrc;
  }, [imageSrc, removeBackground, debouncedTolerance]);

  return preview;
}
