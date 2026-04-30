import { useEffect, useState } from 'react';
import { processImageToPng } from '../lib/imagePipeline';
import type {
  BgRemovalMethod,
  ImagePipelineParams,
  OutputFormat,
  WatermarkColorMode,
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
    manualCropExtra: number;
    removeBackground: boolean;
    selectedFormat: OutputFormat;
    upscaleMultiplier: number;
    bgRemovalMethod: BgRemovalMethod;
    watermarkEnabled: boolean;
    watermarkColorMode: WatermarkColorMode;
    watermarkOpacityPercent: number;
  }
): { processedSrc: string | null; isProcessing: boolean } {
  const debouncedTolerance = useDebouncedValue(options.tolerance, 200);
  const debouncedPadding = useDebouncedValue(options.padding, 200);
  const debouncedManualCropExtra = useDebouncedValue(options.manualCropExtra, 200);

  const [processedSrc, setProcessedSrc] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const {
    removeBackground,
    selectedFormat,
    upscaleMultiplier,
    bgRemovalMethod,
    watermarkEnabled,
    watermarkColorMode,
    watermarkOpacityPercent,
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
        manualCropExtra: debouncedManualCropExtra,
        removeBackground,
        selectedFormat,
        upscaleMultiplier,
        bgRemovalMethod,
        watermarkEnabled,
        watermarkColorMode,
        watermarkOpacityPercent,
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
    debouncedManualCropExtra,
    removeBackground,
    selectedFormat,
    upscaleMultiplier,
    bgRemovalMethod,
    watermarkEnabled,
    watermarkColorMode,
    watermarkOpacityPercent,
  ]);

  return { processedSrc, isProcessing };
}
