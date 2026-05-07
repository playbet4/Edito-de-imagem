import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ContentBounds } from '../types/imagePipeline';
import { clampCropBounds } from '../lib/imagePipeline';

const MIN_SIZE = 2;
/** Hit target around each corner in screen pixels (handles natural-image scaling). */
const CORNER_HIT_SCREEN_PX = 20;

type Corner = 'nw' | 'ne' | 'sw' | 'se';

type DragState =
  | { kind: 'move'; startBounds: ContentBounds; anchor: { x: number; y: number } }
  | { kind: 'resize'; corner: Corner; startBounds: ContentBounds; anchor: { x: number; y: number } }
  | { kind: 'marquee'; startNatural: { x: number; y: number } };

function getContainedLayout(img: HTMLImageElement): {
  scale: number;
  offsetX: number;
  offsetY: number;
  drawW: number;
  drawH: number;
} {
  const cw = img.clientWidth;
  const ch = img.clientHeight;
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const scale = Math.min(cw / nw, ch / nh);
  const drawW = nw * scale;
  const drawH = nh * scale;
  const offsetX = (cw - drawW) / 2;
  const offsetY = (ch - drawH) / 2;
  return { scale, offsetX, offsetY, drawW, drawH };
}

function clientToNatural(img: HTMLImageElement, clientX: number, clientY: number): { x: number; y: number } {
  const r = img.getBoundingClientRect();
  const { scale, offsetX, offsetY } = getContainedLayout(img);
  const lx = clientX - r.left - offsetX;
  const ly = clientY - r.top - offsetY;
  return { x: lx / scale, y: ly / scale };
}

function naturalToClientPoint(
  img: HTMLImageElement,
  nx: number,
  ny: number
): { x: number; y: number } {
  const r = img.getBoundingClientRect();
  const { scale, offsetX, offsetY } = getContainedLayout(img);
  return {
    x: r.left + offsetX + nx * scale,
    y: r.top + offsetY + ny * scale,
  };
}

function clampNatural(
  nx: number,
  ny: number,
  naturalWidth: number,
  naturalHeight: number
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(naturalWidth - 1, Math.round(nx))),
    y: Math.max(0, Math.min(naturalHeight - 1, Math.round(ny))),
  };
}

function hitCornerScreen(
  img: HTMLImageElement,
  bounds: ContentBounds,
  clientX: number,
  clientY: number,
  thresholdPx: number
): Corner | null {
  const corners: { id: Corner; nx: number; ny: number }[] = [
    { id: 'nw', nx: bounds.minX, ny: bounds.minY },
    { id: 'ne', nx: bounds.maxX, ny: bounds.minY },
    { id: 'sw', nx: bounds.minX, ny: bounds.maxY },
    { id: 'se', nx: bounds.maxX, ny: bounds.maxY },
  ];
  const thr2 = thresholdPx * thresholdPx;
  for (const c of corners) {
    const p = naturalToClientPoint(img, c.nx, c.ny);
    const dx = clientX - p.x;
    const dy = clientY - p.y;
    if (dx * dx + dy * dy <= thr2) return c.id;
  }
  return null;
}

function boundsToOverlayStyle(img: HTMLImageElement, b: ContentBounds): React.CSSProperties {
  const { scale, offsetX, offsetY } = getContainedLayout(img);
  const left = offsetX + b.minX * scale;
  const top = offsetY + b.minY * scale;
  const w = (b.maxX - b.minX + 1) * scale;
  const h = (b.maxY - b.minY + 1) * scale;
  return { left, top, width: w, height: h };
}

export interface InteractiveCropEditorProps {
  imageSrc: string;
  naturalWidth: number;
  naturalHeight: number;
  autoBounds: ContentBounds | null;
  cropBounds: ContentBounds | null;
  onCropChange: (bounds: ContentBounds | null) => void;
  disabled?: boolean;
}

export function InteractiveCropEditor({
  imageSrc,
  naturalWidth,
  naturalHeight,
  autoBounds,
  cropBounds,
  onCropChange,
  disabled,
}: InteractiveCropEditorProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [, setLayoutTick] = useState(0);

  const effective = cropBounds ?? autoBounds;

  const onImgLoad = () => setLayoutTick((n) => n + 1);

  const pointerDown = (e: React.PointerEvent) => {
    if (disabled || !effective || !autoBounds || !imgRef.current) return;
    const img = imgRef.current;
    const raw = clientToNatural(img, e.clientX, e.clientY);
    const { x, y } = clampNatural(raw.x, raw.y, naturalWidth, naturalHeight);
    const bounds = effective;

    const corner = hitCornerScreen(img, bounds, e.clientX, e.clientY, CORNER_HIT_SCREEN_PX);
    if (corner) {
      e.preventDefault();
      if (cropBounds === null) {
        onCropChange({ ...bounds });
      }
      img.setPointerCapture(e.pointerId);
      setDrag({
        kind: 'resize',
        corner,
        startBounds: { ...bounds },
        anchor: { x, y },
      });
      return;
    }

    const inside =
      x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;

    if (inside) {
      e.preventDefault();
      if (cropBounds === null) {
        onCropChange({ ...bounds });
      }
      img.setPointerCapture(e.pointerId);
      setDrag({
        kind: 'move',
        startBounds: { ...bounds },
        anchor: { x, y },
      });
      return;
    }

    e.preventDefault();
    img.setPointerCapture(e.pointerId);
    setDrag({ kind: 'marquee', startNatural: { x, y } });
  };

  const pointerMove = useCallback(
    (e: PointerEvent) => {
      if (!drag || !imgRef.current) return;
      const img = imgRef.current;
      const raw = clientToNatural(img, e.clientX, e.clientY);
      const { x, y } = clampNatural(raw.x, raw.y, naturalWidth, naturalHeight);
      const W = naturalWidth;
      const H = naturalHeight;

      if (drag.kind === 'marquee') {
        const x0 = drag.startNatural.x;
        const y0 = drag.startNatural.y;
        const minX = Math.min(x0, x);
        const maxX = Math.max(x0, x);
        const minY = Math.min(y0, y);
        const maxY = Math.max(y0, y);
        const next = clampCropBounds(
          {
            minX: Math.round(minX),
            minY: Math.round(minY),
            maxX: Math.round(maxX),
            maxY: Math.round(maxY),
          },
          W,
          H
        );
        onCropChange(next);
        return;
      }

      const b = drag.startBounds;

      let next: ContentBounds;

      if (drag.kind === 'move') {
        const dx = Math.round(x - drag.anchor.x);
        const dy = Math.round(y - drag.anchor.y);
        const spanX = b.maxX - b.minX;
        const spanY = b.maxY - b.minY;
        const minX = Math.max(0, Math.min(b.minX + dx, W - 1 - spanX));
        const minY = Math.max(0, Math.min(b.minY + dy, H - 1 - spanY));
        const maxX = minX + spanX;
        const maxY = minY + spanY;
        next = { minX, minY, maxX, maxY };
      } else {
        const c = drag.corner;
        let { minX, minY, maxX, maxY } = b;
        const px = Math.max(0, Math.min(W - 1, Math.round(x)));
        const py = Math.max(0, Math.min(H - 1, Math.round(y)));

        if (c === 'nw') {
          minX = Math.min(px, maxX - MIN_SIZE + 1);
          minY = Math.min(py, maxY - MIN_SIZE + 1);
        } else if (c === 'ne') {
          maxX = Math.max(px, minX + MIN_SIZE - 1);
          minY = Math.min(py, maxY - MIN_SIZE + 1);
        } else if (c === 'sw') {
          minX = Math.min(px, maxX - MIN_SIZE + 1);
          maxY = Math.max(py, minY + MIN_SIZE - 1);
        } else {
          maxX = Math.max(px, minX + MIN_SIZE - 1);
          maxY = Math.max(py, minY + MIN_SIZE - 1);
        }
        next = clampCropBounds({ minX, minY, maxX, maxY }, W, H);
      }

      onCropChange(next);
    },
    [drag, naturalWidth, naturalHeight, onCropChange]
  );

  const pointerUp = useCallback((e: PointerEvent) => {
    if (!imgRef.current) return;
    try {
      imgRef.current.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    setDrag(null);
  }, []);

  useEffect(() => {
    if (!drag) return;
    window.addEventListener('pointermove', pointerMove);
    window.addEventListener('pointerup', pointerUp);
    window.addEventListener('pointercancel', pointerUp);
    return () => {
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerUp);
      window.removeEventListener('pointercancel', pointerUp);
    };
  }, [drag, pointerMove, pointerUp]);

  const img = imgRef.current;
  const cropStyle = img && effective ? boundsToOverlayStyle(img, effective) : null;
  const cw = img?.clientWidth ?? 0;
  const ch = img?.clientHeight ?? 0;

  return (
    <div>
      <div
        className="rounded-2xl border border-loft-green/10 shadow-inner overflow-hidden bg-slate-100/50 h-[280px] flex items-center justify-center"
        style={{
          backgroundImage: `linear-gradient(45deg, #e5e7eb 25%, transparent 25%),
            linear-gradient(-45deg, #e5e7eb 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #e5e7eb 75%),
            linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)`,
          backgroundSize: '16px 16px',
          backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
        }}
      >
        {!autoBounds ? (
          <div className="text-center text-sm text-loft-green/70">
            Nenhum conteúdo visível para recortar.
          </div>
        ) : (
          <div className="flex items-center justify-center p-3 max-h-full">
            <div className="relative inline-block max-w-full max-h-full">
              <img
                ref={imgRef}
                src={imageSrc}
                alt="Recorte"
                draggable={false}
                onLoad={onImgLoad}
                onPointerDown={pointerDown}
                className="block max-h-[256px] w-auto h-auto max-w-full object-contain select-none cursor-crosshair touch-none rounded-xl"
                style={{ touchAction: 'none' }}
              />

              {cropStyle && img && effective && (
                <>
                  <div
                    className="pointer-events-none absolute bg-loft-green/50 z-10"
                    style={{ left: 0, top: 0, width: cw, height: cropStyle.top as number }}
                  />
                  <div
                    className="pointer-events-none absolute bg-loft-green/50 z-10"
                    style={{
                      left: 0,
                      top: (cropStyle.top as number) + (cropStyle.height as number),
                      width: cw,
                      height: Math.max(0, ch - (cropStyle.top as number) - (cropStyle.height as number)),
                    }}
                  />
                  <div
                    className="pointer-events-none absolute bg-loft-green/50 z-10"
                    style={{
                      left: 0,
                      top: cropStyle.top as number,
                      width: cropStyle.left as number,
                      height: cropStyle.height as number,
                    }}
                  />
                  <div
                    className="pointer-events-none absolute bg-loft-green/50 z-10"
                    style={{
                      left: (cropStyle.left as number) + (cropStyle.width as number),
                      top: cropStyle.top as number,
                      width: Math.max(0, cw - (cropStyle.left as number) - (cropStyle.width as number)),
                      height: cropStyle.height as number,
                    }}
                  />

                  <div
                    className="pointer-events-none absolute border-2 border-white ring-2 ring-loft-green rounded-md z-20 shadow-lg box-border"
                    style={cropStyle}
                  />
                  {(['nw', 'ne', 'sw', 'se'] as const).map((id) => {
                    const l =
                      id === 'nw' || id === 'sw'
                        ? (cropStyle.left as number)
                        : (cropStyle.left as number) + (cropStyle.width as number);
                    const t =
                      id === 'nw' || id === 'ne'
                        ? (cropStyle.top as number)
                        : (cropStyle.top as number) + (cropStyle.height as number);
                    return (
                      <span
                        key={id}
                        className="pointer-events-none absolute z-30 w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 bg-white border-2 border-loft-green rounded-sm shadow-md"
                        style={{ left: l, top: t }}
                      />
                    );
                  })}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
