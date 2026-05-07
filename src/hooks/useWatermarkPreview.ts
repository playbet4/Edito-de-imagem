import { useEffect, useRef, useState } from 'react';
import { composeWatermarkPreviewCanvas } from '../lib/watermarkPreview';
import type { WatermarkPosition, WatermarkSize } from '../types/imagePipeline';

interface UseWatermarkPreviewParams {
  /** Already-processed watermark PNG (data/object URL). Pass null when watermark is disabled or empty. */
  processedWatermarkSrc: string | null;
  propertySrc: string;
  position: WatermarkPosition;
  size: WatermarkSize;
}

interface UseWatermarkPreviewResult {
  previewSrc: string | null;
  isComposing: boolean;
}

const propertyImageCache = new Map<string, HTMLImageElement>();

function loadImageOnce(src: string, cache: Map<string, HTMLImageElement>): Promise<HTMLImageElement> {
  const cached = cache.get(src);
  if (cached && cached.complete && cached.naturalWidth > 0) {
    return Promise.resolve(cached);
  }
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      cache.set(src, img);
      resolve(img);
    };
    img.onerror = () => reject(new Error('image_load_failed'));
    img.src = src;
  });
}

/**
 * Loads property photo (cached) + watermark PNG, composes them on a canvas, and exposes
 * the resulting object URL. Reuses cached property images across renders to avoid
 * re-decode and uses async `toBlob` so PNG encoding doesn't block the main thread.
 */
export function useWatermarkPreview(params: UseWatermarkPreviewParams): UseWatermarkPreviewResult {
  const { processedWatermarkSrc, propertySrc, position, size } = params;
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [isComposing, setIsComposing] = useState(false);

  const watermarkImgRef = useRef<HTMLImageElement | null>(null);
  if (watermarkImgRef.current === null && typeof window !== 'undefined') {
    watermarkImgRef.current = new window.Image();
  }

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
    if (!processedWatermarkSrc || !propertySrc) {
      replaceObjectUrl(null);
      setPreviewSrc(null);
      setIsComposing(false);
      return;
    }

    let cancelled = false;
    setIsComposing(true);

    const watermarkImg = watermarkImgRef.current ?? new window.Image();
    watermarkImgRef.current = watermarkImg;

    const compose = (propertyImage: HTMLImageElement, watermarkImage: HTMLImageElement) => {
      if (cancelled) return;
      const canvas = composeWatermarkPreviewCanvas({
        propertyImage,
        watermarkImage,
        position,
        size,
      });
      if (cancelled || !canvas) {
        if (!cancelled) setIsComposing(false);
        return;
      }
      canvas.toBlob((blob) => {
        if (cancelled || !blob) return;
        const url = URL.createObjectURL(blob);
        replaceObjectUrl(url);
        setPreviewSrc(url);
        setIsComposing(false);
      }, 'image/png');
    };

    const propertyPromise = loadImageOnce(propertySrc, propertyImageCache);

    const watermarkPromise = new Promise<HTMLImageElement>((resolve, reject) => {
      if (
        watermarkImg.src === processedWatermarkSrc &&
        watermarkImg.complete &&
        watermarkImg.naturalWidth > 0
      ) {
        resolve(watermarkImg);
        return;
      }
      watermarkImg.onload = () => resolve(watermarkImg);
      watermarkImg.onerror = () => reject(new Error('watermark_load_failed'));
      watermarkImg.src = processedWatermarkSrc;
    });

    Promise.all([propertyPromise, watermarkPromise])
      .then(([propertyImg, watermarkLoaded]) => {
        compose(propertyImg, watermarkLoaded);
      })
      .catch(() => {
        if (cancelled) return;
        setPreviewSrc(null);
        setIsComposing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [processedWatermarkSrc, propertySrc, position, size]);

  return { previewSrc, isComposing };
}
