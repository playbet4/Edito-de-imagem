import { useEffect, useRef, useState, type MutableRefObject } from 'react';
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

export interface PreparedCropPreview {
  /** Object URL pointing at the working canvas (PNG). */
  dataUrl: string;
  autoBounds: ContentBounds | null;
  width: number;
  height: number;
}

interface UseImagePipelineResult {
  processedSrc: string | null;
  isProcessing: boolean;
  cropPreview: PreparedCropPreview | null;
}

/**
 * Single source of truth for both the export pipeline and the interactive crop
 * preview. Background removal + auto-bounds (the heavy stage) run only when
 * source/tolerance/removeBackground change. The light stage (crop, scale,
 * watermark, encode) runs on slider/format/watermark tweaks. Encoding uses
 * `canvas.toBlob` + Object URLs so PNG encoding does not block the main thread.
 */
export function useImagePipeline(
  imageSrc: string | null,
  options: UseImagePipelineOptions
): UseImagePipelineResult {
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
  const [cropPreview, setCropPreview] = useState<PreparedCropPreview | null>(null);
  const [isHeavyProcessing, setIsHeavyProcessing] = useState(false);

  const decodedImageRef = useRef<{ src: string; image: HTMLImageElement } | null>(null);
  const finalUrlRef = useRef<string | null>(null);
  const cropUrlRef = useRef<string | null>(null);

  const replaceUrl = (
    ref: MutableRefObject<string | null>,
    next: string | null
  ) => {
    const previous = ref.current;
    ref.current = next;
    if (previous && previous !== next) {
      URL.revokeObjectURL(previous);
    }
  };

  useEffect(() => {
    return () => {
      if (finalUrlRef.current) {
        URL.revokeObjectURL(finalUrlRef.current);
        finalUrlRef.current = null;
      }
      if (cropUrlRef.current) {
        URL.revokeObjectURL(cropUrlRef.current);
        cropUrlRef.current = null;
      }
    };
  }, []);

  // Heavy stage: decode source, optionally remove background, compute auto-bounds,
  // and produce the crop-preview Object URL — all in a single pass shared by both
  // the interactive crop UI and the export pipeline.
  useEffect(() => {
    if (!imageSrc) {
      setWorkingState(null);
      decodedImageRef.current = null;
      replaceUrl(cropUrlRef, null);
      setCropPreview(null);
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
        replaceUrl(cropUrlRef, null);
        setCropPreview(null);
        setIsHeavyProcessing(false);
        return;
      }
      setWorkingState({ canvas, autoBounds });
      const cropWidth = canvas.width;
      const cropHeight = canvas.height;
      canvas.toBlob((blob) => {
        if (cancelled || !blob) {
          if (!cancelled) setIsHeavyProcessing(false);
          return;
        }
        const url = URL.createObjectURL(blob);
        replaceUrl(cropUrlRef, url);
        setCropPreview({ dataUrl: url, autoBounds, width: cropWidth, height: cropHeight });
        setIsHeavyProcessing(false);
      }, 'image/png');
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
      replaceUrl(cropUrlRef, null);
      setCropPreview(null);
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

  // Light stage: cheap finalize (crop / scale / watermark composite) + async PNG encode.
  useEffect(() => {
    if (!workingState) {
      replaceUrl(finalUrlRef, null);
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
      replaceUrl(finalUrlRef, null);
      setProcessedSrc(null);
      return;
    }
    finalCanvas.toBlob((blob) => {
      if (cancelled || !blob) return;
      const url = URL.createObjectURL(blob);
      replaceUrl(finalUrlRef, url);
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

  return { processedSrc, isProcessing: isHeavyProcessing, cropPreview };
}
