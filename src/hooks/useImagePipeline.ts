import { useEffect, useState } from 'react';
import { processImageToPng } from '../lib/imagePipeline';
import type {
  ContentBounds,
  ImagePipelineParams,
  OutputFormat,
  WatermarkColorMode,
} from '../types/imagePipeline';
import { useDebouncedValue } from './useDebouncedValue';

export function useImagePipeline(
  imageSrc: string | null,
  options: {
    tolerance: number;
    padding: number;
    interactiveCropBounds: ContentBounds | null;
    removeBackground: boolean;
    selectedFormat: OutputFormat;
    upscaleMultiplier: number;
    watermarkEnabled: boolean;
    watermarkColorMode: WatermarkColorMode;
    watermarkOpacityPercent: number;
  }
): { processedSrc: string | null; isProcessing: boolean } {
  const debouncedTolerance = useDebouncedValue(options.tolerance, 200);
  const debouncedPadding = useDebouncedValue(options.padding, 200);

  const [processedSrc, setProcessedSrc] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const {
    interactiveCropBounds,
    removeBackground,
    selectedFormat,
    upscaleMultiplier,
    watermarkEnabled,
    watermarkColorMode,
    watermarkOpacityPercent,
  } = options;

  const cropKey =
    interactiveCropBounds === null
      ? 'auto'
      : `${interactiveCropBounds.minX},${interactiveCropBounds.minY},${interactiveCropBounds.maxX},${interactiveCropBounds.maxY}`;

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
        watermarkEnabled,
        watermarkColorMode,
        watermarkOpacityPercent,
        interactiveCropBounds,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cropKey encodes interactiveCropBounds
  }, [
    imageSrc,
    debouncedTolerance,
    debouncedPadding,
    cropKey,
    removeBackground,
    selectedFormat,
    upscaleMultiplier,
    watermarkEnabled,
    watermarkColorMode,
    watermarkOpacityPercent,
  ]);

  return { processedSrc, isProcessing };
}
