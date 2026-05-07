import { useEffect, useRef, useState } from 'react';
import {
  buildWorkingCanvas,
  finalizeWorkingCanvas,
} from '../lib/imagePipeline';
import type {
  ContentBounds,
  OutputFormat,
  WatermarkColorMode,
} from '../types/imagePipeline';
import { useDebouncedValue } from './useDebouncedValue';

interface UseImagePipelineOptions {
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

interface WorkingState {
  canvas: HTMLCanvasElement;
  autoBounds: ContentBounds;
}

/**
 * Splits the pipeline into a heavy stage (decode source + remove background +
 * compute auto-bounds, cached against `imageSrc + removeBackground +
 * debouncedTolerance`) and a light stage (crop / scale / watermark) that runs
 * on slider changes.
 *
 * The light stage uses native canvas composite ops for the watermark and
 * `canvas.toBlob` to encode the PNG asynchronously — both keep the main thread
 * free so sidebar tweaks feel immediate.
 */
export function useImagePipeline(
  imageSrc: string | null,
  options: UseImagePipelineOptions
): { processedSrc: string | null; isProcessing: boolean } {
  const debouncedTolerance = useDebouncedValue(options.tolerance, 200);
  const debouncedPadding = useDebouncedValue(options.padding, 200);
  const debouncedOpacity = useDebouncedValue(options.watermarkOpacityPercent, 120);

  const {
    interactiveCropBounds,
    removeBackground,
    selectedFormat,
    upscaleMultiplier,
    watermarkEnabled,
    watermarkColorMode,
  } = options;

  const [workingState, setWorkingState] = useState<WorkingState | null>(null);
  const [processedSrc, setProcessedSrc] = useState<string | null>(null);
  const [isHeavyProcessing, setIsHeavyProcessing] = useState(false);

  const decodedImageRef = useRef<{ src: string; image: HTMLImageElement } | null>(null);
  const currentObjectUrlRef = useRef<string | null>(null);

  const replaceObjectUrl = (next: string | null) => {
    const previous = currentObjectUrlRef.current;
    currentObjectUrlRef.current = next;
    if (previous && previous !== next) {
      URL.revokeObjectURL(previous);
    }
  };

  useEffect(() => {
    return () => {
      if (currentObjectUrlRef.current) {
        URL.revokeObjectURL(currentObjectUrlRef.current);
        currentObjectUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!imageSrc) {
      setWorkingState(null);
      decodedImageRef.current = null;
      setIsHeavyProcessing(false);
      return;
    }

    let cancelled = false;
    setIsHeavyProcessing(true);

    const runWithImage = (img: HTMLImageElement) => {
      if (cancelled) return;
      const { canvas, autoBounds } = buildWorkingCanvas(img, removeBackground, debouncedTolerance);
      if (cancelled) return;
      if (!autoBounds) {
        setWorkingState(null);
      } else {
        setWorkingState({ canvas, autoBounds });
      }
      setIsHeavyProcessing(false);
    };

    const cached = decodedImageRef.current;
    if (cached && cached.src === imageSrc && cached.image.complete) {
      runWithImage(cached.image);
      return () => {
        cancelled = true;
      };
    }

    const img = new window.Image();
    img.onload = () => {
      decodedImageRef.current = { src: imageSrc, image: img };
      runWithImage(img);
    };
    img.onerror = () => {
      if (cancelled) return;
      setWorkingState(null);
      setIsHeavyProcessing(false);
    };
    img.src = imageSrc;

    return () => {
      cancelled = true;
    };
  }, [imageSrc, removeBackground, debouncedTolerance]);

  const cropKey =
    interactiveCropBounds === null
      ? 'auto'
      : `${interactiveCropBounds.minX},${interactiveCropBounds.minY},${interactiveCropBounds.maxX},${interactiveCropBounds.maxY}`;

  useEffect(() => {
    if (!workingState) {
      replaceObjectUrl(null);
      setProcessedSrc(null);
      return;
    }
    let cancelled = false;
    const finalCanvas = finalizeWorkingCanvas(workingState.canvas, workingState.autoBounds, {
      padding: debouncedPadding,
      selectedFormat,
      upscaleMultiplier,
      watermarkEnabled,
      watermarkColorMode,
      watermarkOpacityPercent: debouncedOpacity,
      interactiveCropBounds,
    });
    if (!finalCanvas) {
      replaceObjectUrl(null);
      setProcessedSrc(null);
      return;
    }
    finalCanvas.toBlob((blob) => {
      if (cancelled || !blob) return;
      const url = URL.createObjectURL(blob);
      replaceObjectUrl(url);
      setProcessedSrc(url);
    }, 'image/png');
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cropKey encodes interactiveCropBounds
  }, [
    workingState,
    debouncedPadding,
    selectedFormat,
    upscaleMultiplier,
    watermarkEnabled,
    watermarkColorMode,
    debouncedOpacity,
    cropKey,
  ]);

  return { processedSrc, isProcessing: isHeavyProcessing };
}
