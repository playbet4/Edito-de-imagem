import { useEffect, useState } from 'react';
import { processImageToPng } from '../lib/imagePipeline';
import type {
  BgRemovalMethod,
  ImagePipelineParams,
  OutputFormat,
} from '../types/imagePipeline';
import { useDebouncedValue } from './useDebouncedValue';

/**
 * Runs the canvas pipeline when `imageSrc` or pipeline settings change.
 * Tolerance and padding are debounced (~200ms) to avoid reprocessing on every slider tick.
 * Pixel loops stay on the main thread; debouncing limits churn. A Web Worker would require
 * transferring ImageData for large assets — left as a future optimization.
 */
export function useImagePipeline(
  imageSrc: string | null,
  options: {
    tolerance: number;
    padding: number;
    removeBackground: boolean;
    selectedFormat: OutputFormat;
    upscaleMultiplier: number;
    bgRemovalMethod: BgRemovalMethod;
  }
): { processedSrc: string | null; isProcessing: boolean } {
  const debouncedTolerance = useDebouncedValue(options.tolerance, 200);
  const debouncedPadding = useDebouncedValue(options.padding, 200);

  const [processedSrc, setProcessedSrc] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const {
    removeBackground,
    selectedFormat,
    upscaleMultiplier,
    bgRemovalMethod,
  } = options;

  useEffect(() => {
    if (!imageSrc) {
      setProcessedSrc(null);
      setIsProcessing(false);
      return;
    }

    setIsProcessing(true);
    const img = new window.Image();

    img.onload = () => {
      const merged: ImagePipelineParams = {
        tolerance: debouncedTolerance,
        padding: debouncedPadding,
        removeBackground,
        selectedFormat,
        upscaleMultiplier,
        bgRemovalMethod,
      };
      const out = processImageToPng(img, merged);
      setProcessedSrc(out);
      setIsProcessing(false);
    };

    img.onerror = () => {
      setProcessedSrc(null);
      setIsProcessing(false);
    };

    img.src = imageSrc;
  }, [
    imageSrc,
    debouncedTolerance,
    debouncedPadding,
    removeBackground,
    selectedFormat,
    upscaleMultiplier,
    bgRemovalMethod,
  ]);

  return { processedSrc, isProcessing };
}
