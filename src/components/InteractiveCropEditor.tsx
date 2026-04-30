import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { ContentBounds } from '../types/imagePipeline';
import { clampCropBounds } from '../lib/imagePipeline';

const MIN_SIZE = 2;
const CORNER_HIT_NATURAL = 14;

type Corner = 'nw' | 'ne' | 'sw' | 'se';

interface DragState {
  kind: 'move' | 'resize';
  corner?: Corner;
  startBounds: ContentBounds;
  anchor: { x: number; y: number };
}

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

function boundsToOverlayStyle(img: HTMLImageElement, b: ContentBounds): React.CSSProperties {
  const { scale, offsetX, offsetY } = getContainedLayout(img);
  const left = offsetX + b.minX * scale;
  const top = offsetY + b.minY * scale;
  const w = (b.maxX - b.minX + 1) * scale;
  const h = (b.maxY - b.minY + 1) * scale;
  return { left, top, width: w, height: h };
}

function hitCorner(nx: number, ny: number, bounds: ContentBounds): Corner | null {
  const corners: { id: Corner; x: number; y: number }[] = [
    { id: 'nw', x: bounds.minX, y: bounds.minY },
    { id: 'ne', x: bounds.maxX, y: bounds.minY },
    { id: 'sw', x: bounds.minX, y: bounds.maxY },
    { id: 'se', x: bounds.maxX, y: bounds.maxY },
  ];
  const thr = CORNER_HIT_NATURAL;
  for (const c of corners) {
    if (Math.abs(nx - c.x) <= thr && Math.abs(ny - c.y) <= thr) return c.id;
  }
  return null;
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
    const { x, y } = clientToNatural(img, e.clientX, e.clientY);
    const bounds = effective;

    const corner = hitCorner(x, y, bounds);
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

    if (
      x >= bounds.minX &&
      x <= bounds.maxX &&
      y >= bounds.minY &&
      y <= bounds.maxY
    ) {
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
    }
  };

  const pointerMove = useCallback(
    (e: PointerEvent) => {
      if (!drag || !imgRef.current) return;
      const img = imgRef.current;
      const { x, y } = clientToNatural(img, e.clientX, e.clientY);
      const W = naturalWidth;
      const H = naturalHeight;
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
        const c = drag.corner!;
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
  const cropStyle =
    img && effective ? boundsToOverlayStyle(img, effective) : null;
  const cw = img?.clientWidth ?? 0;
  const ch = img?.clientHeight ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 tracking-tight">Área de recorte</h3>
          <p className="text-xs text-gray-500 mt-1 max-w-xl leading-relaxed">
            Clique e arraste dentro da moldura para mover, ou arraste os cantos para ajustar — como em editores
            modernos. O quadro reflete a arte já processada (incluindo remoção de fundo).
          </p>
        </div>
        <button
          type="button"
          disabled={disabled || cropBounds === null}
          onClick={() => onCropChange(null)}
          className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 px-3 py-2 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:pointer-events-none shadow-sm"
        >
          <RotateCcw size={14} /> Recorte automático
        </button>
      </div>

      <div
        className="rounded-xl border border-slate-200 shadow-inner overflow-hidden"
        style={{
          backgroundColor: '#f3f4f6',
          backgroundImage: `linear-gradient(45deg, #e5e7eb 25%, transparent 25%),
            linear-gradient(-45deg, #e5e7eb 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #e5e7eb 75%),
            linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)`,
          backgroundSize: '16px 16px',
          backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
        }}
      >
        {!autoBounds ? (
          <div className="py-14 text-center text-sm text-gray-500">Nenhum conteúdo visível para recortar.</div>
        ) : (
          <div className="flex justify-center p-4">
            <div className="relative inline-block max-w-full">
              <img
                ref={imgRef}
                src={imageSrc}
                alt="Recorte"
                draggable={false}
                onLoad={onImgLoad}
                onPointerDown={pointerDown}
                className="block max-h-[min(320px,55vh)] w-auto h-auto max-w-full object-contain select-none cursor-crosshair touch-none"
                style={{ touchAction: 'none' }}
              />

              {cropStyle && img && effective && (
                <>
                  <div
                    className="pointer-events-none absolute bg-slate-900/55 z-10"
                    style={{ left: 0, top: 0, width: cw, height: cropStyle.top as number }}
                  />
                  <div
                    className="pointer-events-none absolute bg-slate-900/55 z-10"
                    style={{
                      left: 0,
                      top: (cropStyle.top as number) + (cropStyle.height as number),
                      width: cw,
                      height: Math.max(0, ch - (cropStyle.top as number) - (cropStyle.height as number)),
                    }}
                  />
                  <div
                    className="pointer-events-none absolute bg-slate-900/55 z-10"
                    style={{
                      left: 0,
                      top: cropStyle.top as number,
                      width: cropStyle.left as number,
                      height: cropStyle.height as number,
                    }}
                  />
                  <div
                    className="pointer-events-none absolute bg-slate-900/55 z-10"
                    style={{
                      left: (cropStyle.left as number) + (cropStyle.width as number),
                      top: cropStyle.top as number,
                      width: Math.max(0, cw - (cropStyle.left as number) - (cropStyle.width as number)),
                      height: cropStyle.height as number,
                    }}
                  />

                  <div
                    className="pointer-events-none absolute border-2 border-white ring-1 ring-slate-950 rounded-sm z-20 shadow-lg box-border"
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
                        className="pointer-events-none absolute z-30 w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 bg-white border-2 border-slate-900 rounded-sm shadow-md"
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
