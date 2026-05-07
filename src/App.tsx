import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  Upload,
  Download,
  Image as ImageIcon,
  Maximize,
  MonitorUp,
  Wand2,
  Droplets,
  Loader2,
  ChevronDown,
  Copy,
  RotateCcw,
  RefreshCw,
  Home,
  ArrowUpLeft,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowDownRight,
  Square,
  AlertCircle,
  MessageSquareText,
} from 'lucide-react';
import { useImagePipeline } from './hooks/useImagePipeline';
import { usePreparedCropPreview } from './hooks/usePreparedCropPreview';
import { useDebouncedValue } from './hooks/useDebouncedValue';
import { useWatermarkPreview } from './hooks/useWatermarkPreview';
import { InteractiveCropEditor } from './components/InteractiveCropEditor';
import type {
  ContentBounds,
  OutputFormat,
  WatermarkColorMode,
  WatermarkPosition,
  WatermarkSize,
} from './types/imagePipeline';
import loftLogoUrl from './assets/loft-logo-header.png';
import propertySample1 from './assets/sample-properties/property-1.png';
import propertySample2 from './assets/sample-properties/property-2.png';
import propertySample3 from './assets/sample-properties/property-3.png';

function boundsKey(b: ContentBounds | null): string {
  if (!b) return 'auto';
  return `${b.minX},${b.minY},${b.maxX},${b.maxY}`;
}

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const IMAGE_MIME_PREFIX = 'image/';

function isImageMimeType(type: string): boolean {
  return type.startsWith(IMAGE_MIME_PREFIX);
}

/**
 * Skip hijacking paste when the user is typing in a text field (allow normal paste of text).
 */
function isEditablePasteTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const el = target;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  if (el.closest('[contenteditable="true"]')) return true;
  if (tag === 'INPUT') {
    const input = el as HTMLInputElement;
    const t = input.type.toLowerCase();
    if (
      t === 'checkbox' ||
      t === 'radio' ||
      t === 'range' ||
      t === 'file' ||
      t === 'button' ||
      t === 'submit' ||
      t === 'reset' ||
      t === 'hidden' ||
      t === 'color'
    ) {
      return false;
    }
    return true;
  }
  return false;
}

const SAMPLE_PROPERTIES: { src: string; label: string }[] = [
  { src: propertySample1, label: 'Sala com pendentes azuis' },
  { src: propertySample2, label: 'Sala com plantas e luz natural' },
  { src: propertySample3, label: 'Sala de jantar com painel verde' },
];

const WATERMARK_POSITION_LABELS: Record<WatermarkPosition, string> = {
  center: 'Centro',
  'top-left': 'Canto superior esquerdo',
  'top-right': 'Canto superior direito',
  'bottom-left': 'Canto inferior esquerdo',
  'bottom-right': 'Canto inferior direito',
};

const WATERMARK_SIZE_LABELS: Record<WatermarkSize, string> = {
  small: 'Pequeno',
  medium: 'Médio',
  large: 'Grande',
};

function buildWatermarkMessage(params: {
  position: WatermarkPosition;
  size: WatermarkSize;
  opacityPercent: number;
}): string {
  return `Marca d'água configurada com sucesso! 💧

Posição: ${WATERMARK_POSITION_LABELS[params.position]}
Tamanho: ${WATERMARK_SIZE_LABELS[params.size]}
Opacidade: ${params.opacityPercent}%`;
}

const DEFAULT_WATERMARK_MESSAGE = buildWatermarkMessage({
  position: 'center',
  size: 'medium',
  opacityPercent: 50,
});

function extractImageFileFromClipboard(data: DataTransfer | null): File | null {
  if (!data) return null;
  if (data.files?.length) {
    for (let i = 0; i < data.files.length; i++) {
      const f = data.files[i];
      if (f && isImageMimeType(f.type)) return f;
    }
  }
  if (data.items?.length) {
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      if (item.kind === 'file' && item.type && isImageMimeType(item.type)) {
        const f = item.getAsFile();
        if (f) return f;
      }
    }
  }
  return null;
}

export default function App() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);

  const [removeBackground, setRemoveBackground] = useState(true);
  const [tolerance, setTolerance] = useState(15);
  const [padding, setPadding] = useState(40);
  const [interactiveCropBounds, setInteractiveCropBounds] = useState<ContentBounds | null>(null);
  const debouncedCropForExport = useDebouncedValue(interactiveCropBounds, 120);

  const [watermarkEnabled, setWatermarkEnabled] = useState(false);
  const [watermarkColorMode, setWatermarkColorMode] = useState<WatermarkColorMode>('original');
  const [watermarkOpacityPercent, setWatermarkOpacityPercent] = useState(40);

  const [selectedFormat, setSelectedFormat] = useState<OutputFormat>('custom');
  const [upscaleMultiplier, setUpscaleMultiplier] = useState(1);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pasteToastMessage, setPasteToastMessage] = useState<string | null>(null);
  const [watermarkClientMessage, setWatermarkClientMessage] = useState<string>(
    DEFAULT_WATERMARK_MESSAGE
  );
  const [watermarkClientMessageDirty, setWatermarkClientMessageDirty] = useState(false);

  const [propertyIndex, setPropertyIndex] = useState(0);
  const [watermarkPosition, setWatermarkPosition] = useState<WatermarkPosition>('center');
  const [watermarkSize, setWatermarkSize] = useState<WatermarkSize>('medium');

  const cropPreview = usePreparedCropPreview(imageSrc, removeBackground, tolerance);

  const { processedSrc, isProcessing } = useImagePipeline(imageSrc, {
    tolerance,
    padding,
    interactiveCropBounds: debouncedCropForExport,
    removeBackground,
    selectedFormat,
    upscaleMultiplier,
    watermarkEnabled,
    watermarkColorMode,
    watermarkOpacityPercent,
  });

  const previewStale = useMemo(
    () => boundsKey(interactiveCropBounds) !== boundsKey(debouncedCropForExport),
    [interactiveCropBounds, debouncedCropForExport]
  );

  const showFinalPreviewBusy = Boolean(imageSrc) && (isProcessing || previewStale);

  const currentProperty = SAMPLE_PROPERTIES[propertyIndex] ?? SAMPLE_PROPERTIES[0];

  const isPropertyPreviewSupportedFormat =
    selectedFormat === 'custom' || selectedFormat === 'site';
  const showPropertyPreview =
    watermarkEnabled && isPropertyPreviewSupportedFormat && removeBackground;
  const propertyPreviewBlockedReason: 'format' | 'background' | null = watermarkEnabled
    ? !removeBackground
      ? 'background'
      : !isPropertyPreviewSupportedFormat
        ? 'format'
        : null
    : null;
  const propertyPreviewBlockedTooltip =
    propertyPreviewBlockedReason === 'background'
      ? "A prévia em foto de imóvel só aparece com 'Remover fundo' ativado."
      : propertyPreviewBlockedReason === 'format'
        ? 'A prévia em foto de imóvel é exibida apenas para os formatos Livre e Site.'
        : null;

  const { previewSrc: propertyPreviewSrc, isComposing: isComposingPropertyPreview } =
    useWatermarkPreview({
      processedWatermarkSrc: showPropertyPreview ? processedSrc : null,
      propertySrc: currentProperty.src,
      position: watermarkPosition,
      size: watermarkSize,
    });

  useEffect(() => {
    if (watermarkClientMessageDirty) return;
    setWatermarkClientMessage(
      buildWatermarkMessage({
        position: watermarkPosition,
        size: watermarkSize,
        opacityPercent: watermarkOpacityPercent,
      })
    );
  }, [watermarkPosition, watermarkSize, watermarkOpacityPercent, watermarkClientMessageDirty]);

  const handleCropChange = useCallback((bounds: ContentBounds | null) => {
    setInteractiveCropBounds(bounds);
  }, []);

  const loadImageFromFile = useCallback((file: File, options?: { showPastedToast?: boolean }) => {
    if (!isImageMimeType(file.type)) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      setImageSrc(result);
      setInteractiveCropBounds(null);
      if (options?.showPastedToast) {
        setPasteToastMessage('Imagem colada');
      }
    };
    reader.readAsDataURL(file);
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isEditablePasteTarget(e.target)) return;
      const file = extractImageFileFromClipboard(e.clipboardData);
      if (!file) return;
      e.preventDefault();
      loadImageFromFile(file, { showPastedToast: true });
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [loadImageFromFile]);

  useEffect(() => {
    if (!pasteToastMessage) return;
    const timer = window.setTimeout(() => setPasteToastMessage(null), 2200);
    return () => window.clearTimeout(timer);
  }, [pasteToastMessage]);

  const checkeredStyleLight: React.CSSProperties = {
    backgroundColor: '#f8fafc',
    backgroundImage: `linear-gradient(45deg, #e2e8f0 25%, transparent 25%),
                      linear-gradient(-45deg, #e2e8f0 25%, transparent 25%),
                      linear-gradient(45deg, transparent 75%, #e2e8f0 75%),
                      linear-gradient(-45deg, transparent 75%, #e2e8f0 75%)`,
    backgroundSize: '20px 20px',
    backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
  };

  const checkeredStyleDark: React.CSSProperties = {
    backgroundColor: '#0f172a',
    backgroundImage: `linear-gradient(45deg, #1e293b 25%, transparent 25%),
                      linear-gradient(-45deg, #1e293b 25%, transparent 25%),
                      linear-gradient(45deg, transparent 75%, #1e293b 75%),
                      linear-gradient(-45deg, transparent 75%, #1e293b 75%)`,
    backgroundSize: '20px 20px',
    backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
  };

  const useDarkPreviewBackground = watermarkEnabled && watermarkColorMode === 'white';
  const previewBackgroundStyle = useDarkPreviewBackground ? checkeredStyleDark : checkeredStyleLight;

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadImageFromFile(file);
    e.target.value = '';
  };

  const handleDownload = () => {
    if (!processedSrc) return;
    const link = document.createElement('a');
    link.href = processedSrc;

    let filename = 'logo_imobiliaria.png';
    if (selectedFormat === 'relatorio') filename = 'relatorio.png';
    else if (selectedFormat === 'logoAdm') filename = 'logo_adm.png';
    else if (selectedFormat === 'site') filename = 'LOGO_SITE.png';
    else if (selectedFormat === 'favicon') filename = 'favicon.png';
    if (watermarkEnabled) filename = `marca_dagua_${filename}`;

    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCopyWatermarkMessage = async () => {
    try {
      await navigator.clipboard.writeText(watermarkClientMessage);
      setPasteToastMessage('Texto copiado');
    } catch {
      setPasteToastMessage('Não foi possível copiar');
    }
  };

  const handleResetWatermarkMessage = () => {
    setWatermarkClientMessage(
      buildWatermarkMessage({
        position: watermarkPosition,
        size: watermarkSize,
        opacityPercent: watermarkOpacityPercent,
      })
    );
    setWatermarkClientMessageDirty(false);
  };

  const handleWatermarkMessageChange = (value: string) => {
    setWatermarkClientMessage(value);
    setWatermarkClientMessageDirty(true);
  };

  const handleCyclePropertySample = () => {
    setPropertyIndex((i) => (i + 1) % SAMPLE_PROPERTIES.length);
  };

  const handleDownloadPropertyPreview = () => {
    if (!propertyPreviewSrc) return;
    const link = document.createElement('a');
    link.href = propertyPreviewSrc;
    link.download = 'previa_marca_dagua_imovel.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCopyPropertyPreview = async () => {
    if (!propertyPreviewSrc) return;
    try {
      const blob = await (await fetch(propertyPreviewSrc)).blob();
      // ClipboardItem may be missing on older browsers; the cast keeps TS happy.
      const ClipboardItemCtor = (window as unknown as { ClipboardItem?: typeof ClipboardItem })
        .ClipboardItem;
      if (!ClipboardItemCtor || !navigator.clipboard?.write) {
        throw new Error('Clipboard image API not available');
      }
      await navigator.clipboard.write([new ClipboardItemCtor({ 'image/png': blob })]);
      setPasteToastMessage('Imagem copiada');
    } catch {
      setPasteToastMessage('Use "Baixar prévia" — seu navegador não permite copiar imagem');
    }
  };

  const cropReady =
    cropPreview &&
    cropPreview.dataUrl &&
    cropPreview.autoBounds &&
    cropPreview.width > 0;

  const stepHeadingClass =
    'text-[11px] font-bold uppercase tracking-wider flex items-center gap-2 text-loft-green';

  const controlShellClass =
    'space-y-4 rounded-2xl border border-loft-green/10 bg-white/55 p-4 backdrop-blur-sm shadow-sm';

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50/90 via-white to-orange-50/70 font-sans text-loft-green">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-5 space-y-5">
        <header className="glass-panel flex items-center justify-between gap-4 px-4 sm:px-6 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="hidden sm:inline-flex items-center justify-center rounded-full bg-loft-orange/10 text-loft-orange w-9 h-9">
              <Wand2 size={18} />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-loft-orange leading-none">
                Loft · Implantação
              </p>
              <h1 className="text-lg sm:text-xl font-bold text-loft-green tracking-tight truncate mt-0.5">
                Processador de logo
              </h1>
            </div>
          </div>
          <div className="flex-shrink-0 inline-flex items-center rounded-xl bg-white px-2.5 py-1.5 shadow-sm ring-1 ring-loft-green/10">
            <img
              src={loftLogoUrl}
              alt="Loft"
              className="max-h-[44px] sm:max-h-[52px] w-auto object-contain"
            />
          </div>
        </header>

        {imageSrc && (
          <div className="flex lg:hidden sticky top-2 z-40 gap-2 justify-center flex-wrap">
            <button
              type="button"
              onClick={() => scrollToId('section-crop')}
              className="inline-flex items-center gap-1 rounded-full border border-white/60 bg-white/85 px-4 py-2 text-xs font-semibold text-loft-green shadow-loft backdrop-blur-md"
            >
              Ir para o recorte <ChevronDown size={14} className="opacity-70" />
            </button>
            <button
              type="button"
              onClick={() => scrollToId('section-export')}
              className="inline-flex items-center gap-1 rounded-full border border-white/60 bg-loft-green/90 px-4 py-2 text-xs font-semibold text-white shadow-loft backdrop-blur-md hover:bg-loft-green"
            >
              Ir para exportar <ChevronDown size={14} className="opacity-80" />
            </button>
          </div>
        )}

        <div className="glass-panel p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10">
          <div className="order-1 flex flex-col gap-8 lg:order-none lg:col-span-8">
            {!imageSrc ? (
              <div className="glass-panel-inset min-h-[280px] flex flex-col items-center justify-center p-8 border-dashed">
                <ImageIcon size={52} className="mb-3 text-loft-orange/50" strokeWidth={1.25} />
                <p className="text-sm font-semibold text-loft-green">Envie uma imagem para começar</p>
                <p className="text-xs text-loft-green/60 mt-2 text-center max-w-xs leading-relaxed">
                  PNG ou JPG com fundo sólido costuma dar melhor resultado na remoção automática.
                </p>
              </div>
            ) : (
              <>
                <section
                  id="section-quick-toolbar"
                  className="rounded-2xl border border-white/50 bg-white/40 p-3 sm:p-4 shadow-loft backdrop-blur-md space-y-3"
                >
                  <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-loft-green/65 flex items-center gap-1.5">
                        Formato
                        {propertyPreviewBlockedTooltip && (
                          <span
                            className="inline-flex items-center text-loft-orange cursor-help normal-case"
                            title={propertyPreviewBlockedTooltip}
                            aria-label="Aviso sobre prévia em foto"
                          >
                            <AlertCircle size={12} />
                          </span>
                        )}
                      </span>
                      <div className="flex flex-wrap gap-1 rounded-full bg-loft-green/5 p-1">
                        {(
                          [
                            { value: 'custom', label: 'Livre' },
                            { value: 'relatorio', label: 'Relatório' },
                            { value: 'logoAdm', label: 'Logo ADM' },
                            { value: 'site', label: 'Site' },
                            { value: 'favicon', label: 'Favicon' },
                          ] as { value: OutputFormat; label: string }[]
                        ).map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setSelectedFormat(opt.value)}
                            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                              selectedFormat === opt.value
                                ? 'bg-white text-loft-green shadow'
                                : 'text-loft-green/55 hover:text-loft-green'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-loft-green/65 flex items-center gap-1">
                        <MonitorUp size={11} /> Escala
                      </span>
                      <div className="flex gap-1 rounded-full bg-loft-green/5 p-1">
                        {[1, 2, 4].map((mult) => (
                          <button
                            key={mult}
                            type="button"
                            onClick={() => setUpscaleMultiplier(mult)}
                            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                              upscaleMultiplier === mult
                                ? 'bg-white text-loft-green shadow'
                                : 'text-loft-green/55 hover:text-loft-green'
                            }`}
                          >
                            {mult}×
                          </button>
                        ))}
                      </div>
                    </div>

                    {selectedFormat !== 'favicon' && (
                      <div className="space-y-1.5 min-w-[160px] flex-1 max-w-[260px]">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-loft-green/65 flex items-center justify-between">
                          <span>Margem</span>
                          <span className="tabular-nums text-loft-green/50 normal-case font-semibold">
                            {padding}px
                          </span>
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={150}
                          value={padding}
                          onChange={(e) => setPadding(Number(e.target.value))}
                          className="w-full accent-loft-orange"
                        />
                      </div>
                    )}
                  </div>

                </section>

                <section
                  id="section-crop"
                  className="scroll-mt-24 rounded-3xl border border-white/50 bg-white/40 p-5 sm:p-6 shadow-loft backdrop-blur-md"
                >
                  <div className="grid gap-5 lg:grid-cols-2 items-stretch">
                    {cropReady && cropPreview && cropPreview.autoBounds ? (
                      <div className="flex flex-col gap-3">
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <h2 className="text-base font-bold text-loft-green">Recorte na imagem</h2>
                            <p className="text-xs text-loft-green/75 mt-1 leading-relaxed">
                              Arraste dentro da moldura para mover ou nos cantos para
                              redimensionar.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleCropChange(null)}
                            disabled={isProcessing || interactiveCropBounds === null}
                            title="Voltar ao recorte automático"
                            aria-label="Voltar ao recorte automático"
                            className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full border border-loft-green/25 bg-white/90 text-loft-green shadow-sm transition-colors hover:bg-white hover:border-loft-green/40 disabled:opacity-40 disabled:pointer-events-none"
                          >
                            <RotateCcw size={14} />
                          </button>
                        </div>
                        <div className="mt-auto">
                          <InteractiveCropEditor
                            imageSrc={cropPreview.dataUrl}
                            naturalWidth={cropPreview.width}
                            naturalHeight={cropPreview.height}
                            autoBounds={cropPreview.autoBounds}
                            cropBounds={interactiveCropBounds}
                            onCropChange={handleCropChange}
                            disabled={isProcessing}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-loft-green/10 bg-white/50 h-[280px] flex items-center justify-center text-xs text-loft-green/60">
                        Preparando recorte…
                      </div>
                    )}

                    <div
                      id="section-final-preview"
                      className="flex flex-col gap-3 scroll-mt-24"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h2 className="text-base font-bold text-loft-green">Prévia do PNG final</h2>
                          <p className="text-xs text-loft-green/70 mt-1 leading-relaxed">
                            É assim que o arquivo vai sair ao exportar (formato, margem, escala e
                            marca d&apos;água).
                          </p>
                        </div>
                        <div className="flex gap-1.5 flex-wrap justify-end">
                          {interactiveCropBounds !== null && (
                            <span className="text-[11px] font-semibold bg-loft-mint/15 text-loft-green px-2 py-0.5 rounded-full border border-loft-mint/30">
                              Recorte manual
                            </span>
                          )}
                          {watermarkEnabled && (
                            <span className="text-[11px] font-semibold bg-loft-orange/15 text-loft-green px-2 py-0.5 rounded-full border border-loft-orange/25">
                              Marca d&apos;água {watermarkOpacityPercent}%
                            </span>
                          )}
                          {upscaleMultiplier > 1 && (
                            <span className="text-[11px] font-semibold bg-white/80 text-loft-green px-2 py-0.5 rounded-full border border-loft-green/15">
                              {upscaleMultiplier}× escala
                            </span>
                          )}
                        </div>
                      </div>
                      <div
                        className="relative mt-auto flex items-center justify-center p-4 h-[280px] rounded-2xl border border-loft-green/10 overflow-hidden"
                        style={previewBackgroundStyle}
                      >
                        {showFinalPreviewBusy && (
                          <div
                            className={`absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 backdrop-blur-[2px] ${useDarkPreviewBackground ? 'bg-slate-900/55' : 'bg-white/55'}`}
                          >
                            <Loader2 size={24} className="animate-spin text-loft-orange" />
                            <span
                              className={`text-xs font-semibold ${useDarkPreviewBackground ? 'text-white' : 'text-loft-green'}`}
                            >
                              {isProcessing ? 'Processando…' : 'Atualizando prévia…'}
                            </span>
                          </div>
                        )}
                        {!showFinalPreviewBusy && !processedSrc && (
                          <div
                            className={`flex flex-col items-center gap-2 ${useDarkPreviewBackground ? 'text-white/65' : 'text-loft-green/50'}`}
                          >
                            <Maximize size={24} className="opacity-60" />
                            <span className="text-xs">Nada visível para exportar</span>
                          </div>
                        )}
                        {processedSrc && (
                          <img
                            src={processedSrc}
                            alt="Resultado"
                            className={`relative z-0 max-w-full max-h-[248px] object-contain rounded-xl shadow-lg ${showFinalPreviewBusy ? 'opacity-40' : 'opacity-100'} transition-opacity`}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                </section>

                {showPropertyPreview && (
                  <section
                    id="section-property-preview"
                    className="scroll-mt-24 space-y-3 rounded-3xl border border-white/50 bg-white/35 p-5 sm:p-6 shadow-loft backdrop-blur-md"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="text-sm font-bold text-loft-green flex items-center gap-2">
                          <Home size={14} className="text-loft-orange" />
                          Prévia em foto de imóvel
                        </h2>
                        <p className="text-xs text-loft-green/70 mt-0.5 leading-relaxed">
                          Demonstrativo — o tamanho final dependerá da foto real do cliente.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleCyclePropertySample}
                        className="inline-flex items-center gap-1.5 rounded-full border border-loft-green/15 bg-white/85 px-3 py-1.5 text-xs font-semibold text-loft-green shadow-sm transition-colors hover:bg-white"
                        title={currentProperty.label}
                      >
                        <RefreshCw size={13} className="text-loft-orange" />
                        Trocar foto ({propertyIndex + 1}/{SAMPLE_PROPERTIES.length})
                      </button>
                    </div>

                    <div className="flex flex-wrap items-end gap-x-5 gap-y-3 rounded-2xl border border-loft-green/10 bg-white/55 px-3 py-2.5">
                      <div className="space-y-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-loft-green/65">
                          Posição
                        </span>
                        <div className="flex gap-1 rounded-full bg-loft-green/5 p-1">
                          {(
                            [
                              { value: 'top-left', label: 'Sup. esq.', Icon: ArrowUpLeft },
                              { value: 'top-right', label: 'Sup. dir.', Icon: ArrowUpRight },
                              { value: 'center', label: 'Centro', Icon: Square },
                              { value: 'bottom-left', label: 'Inf. esq.', Icon: ArrowDownLeft },
                              { value: 'bottom-right', label: 'Inf. dir.', Icon: ArrowDownRight },
                            ] as { value: WatermarkPosition; label: string; Icon: typeof Square }[]
                          ).map(({ value, label, Icon }) => (
                            <button
                              key={value}
                              type="button"
                              onClick={() => setWatermarkPosition(value)}
                              title={label}
                              aria-label={label}
                              className={`px-2.5 py-1.5 rounded-full text-xs font-semibold transition-colors inline-flex items-center justify-center ${
                                watermarkPosition === value
                                  ? 'bg-white text-loft-green shadow'
                                  : 'text-loft-green/55 hover:text-loft-green'
                              }`}
                            >
                              <Icon size={14} />
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-loft-green/65">
                          Tamanho
                        </span>
                        <div className="flex gap-1 rounded-full bg-loft-green/5 p-1">
                          {(
                            [
                              { value: 'small', label: 'P' },
                              { value: 'medium', label: 'M' },
                              { value: 'large', label: 'G' },
                            ] as { value: WatermarkSize; label: string }[]
                          ).map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => setWatermarkSize(opt.value)}
                              title={WATERMARK_SIZE_LABELS[opt.value]}
                              className={`w-9 py-1.5 rounded-full text-xs font-bold transition-colors ${
                                watermarkSize === opt.value
                                  ? 'bg-white text-loft-green shadow'
                                  : 'text-loft-green/55 hover:text-loft-green'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div
                      className={`relative rounded-2xl overflow-hidden bg-loft-green/5 border border-loft-green/10 ${
                        propertyPreviewSrc
                          ? ''
                          : 'min-h-[220px] flex items-center justify-center'
                      }`}
                    >
                      {isComposingPropertyPreview && (
                        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-white/55 backdrop-blur-[2px]">
                          <Loader2 size={24} className="animate-spin text-loft-orange" />
                          <span className="text-xs font-semibold text-loft-green">
                            Compondo prévia…
                          </span>
                        </div>
                      )}
                      {!isComposingPropertyPreview && !propertyPreviewSrc && (
                        <div className="flex flex-col items-center gap-2 text-loft-green/50 px-4 py-8 text-center">
                          <ImageIcon size={28} className="opacity-60" />
                          <span className="text-sm">
                            Aguardando o PNG da marca d&apos;água ficar pronto…
                          </span>
                        </div>
                      )}
                      {propertyPreviewSrc && (
                        <img
                          src={propertyPreviewSrc}
                          alt={`Prévia da marca d'água sobre ${currentProperty.label}`}
                          className={`relative z-0 block w-full h-auto ${isComposingPropertyPreview ? 'opacity-40' : 'opacity-100'} transition-opacity`}
                        />
                      )}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>

          <aside
            id="section-sidebar-controls"
            className="order-2 space-y-8 lg:order-none lg:col-span-4 scroll-mt-24"
          >
            <section className="space-y-4">
              <h2 className={stepHeadingClass}>
                <span className="text-loft-orange">1.</span> Imagem
              </h2>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 rounded-full bg-loft-green py-3.5 px-5 font-semibold text-white shadow-md transition-colors hover:bg-loft-green/90"
              >
                <Upload size={20} /> Escolher imagem
              </button>
              <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
            </section>

            {imageSrc && (
              <>
                <section className="space-y-4 pt-2 border-t border-loft-green/10">
                  <h2 className={stepHeadingClass}>
                    <Wand2 size={14} className="text-loft-orange" />
                    <span className="text-loft-orange">2.</span> Fundo
                  </h2>
                  <div className={controlShellClass}>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        className="h-5 w-5 rounded border-loft-green/30 text-loft-orange accent-loft-orange"
                        checked={removeBackground}
                        onChange={(e) => setRemoveBackground(e.target.checked)}
                      />
                      <span className="text-sm font-semibold text-loft-green">Remover fundo (cor da borda)</span>
                    </label>
                    {removeBackground && (
                      <div className="space-y-2 pt-1">
                        <div className="flex justify-between text-sm">
                          <span className="text-loft-green/80">Tolerância</span>
                          <span className="tabular-nums text-loft-green/50">{tolerance}</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={150}
                          value={tolerance}
                          onChange={(e) => setTolerance(Number(e.target.value))}
                          className="w-full accent-loft-orange"
                        />
                        <p className="text-xs leading-relaxed text-loft-green/65">
                          Ajuste se sobrar halo claro ou se o logo perder partes finas.
                        </p>
                      </div>
                    )}
                  </div>
                </section>

                <section className="space-y-2 rounded-2xl border border-dashed border-loft-orange/35 bg-loft-orange/5 p-3 lg:hidden">
                  <p className="text-xs leading-relaxed text-loft-green/75">
                    No celular, o recorte interativo fica acima desta coluna.
                  </p>
                  <button
                    type="button"
                    onClick={() => scrollToId('section-crop')}
                    className="w-full rounded-full border border-loft-orange/40 bg-white/90 py-2 text-xs font-semibold text-loft-green shadow-sm"
                  >
                    Abrir área de recorte
                  </button>
                </section>

                <section className="space-y-4 pt-2 border-t border-loft-green/10">
                  <h2 className={stepHeadingClass}>
                    <Droplets size={14} className="text-loft-orange" />
                    <span className="text-loft-orange">3.</span> Marca d&apos;água
                  </h2>
                  <div className={controlShellClass}>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        className="h-5 w-5 rounded border-loft-green/30 text-loft-orange accent-loft-orange"
                        checked={watermarkEnabled}
                        onChange={(e) => setWatermarkEnabled(e.target.checked)}
                      />
                      <span className="text-sm font-semibold text-loft-green">Exportar como marca d&apos;água</span>
                    </label>
                    <p className="text-xs leading-relaxed text-loft-green/65">
                      Quando ativo, o PNG sai mais suave: você pode forçar branco e aplicar opacidade no canal alpha da
                      arte inteira.
                    </p>
                    {watermarkEnabled && (
                      <div className="space-y-4 rounded-2xl border border-loft-orange/20 bg-white/60 p-4">
                        <div className="grid grid-cols-2 gap-2 rounded-full bg-loft-green/5 p-1">
                          <button
                            type="button"
                            onClick={() => setWatermarkColorMode('white')}
                            className={`rounded-full py-2.5 text-xs font-semibold transition-all ${watermarkColorMode === 'white' ? 'bg-white text-loft-green shadow' : 'text-loft-green/55'}`}
                          >
                            Tudo branco
                          </button>
                          <button
                            type="button"
                            onClick={() => setWatermarkColorMode('original')}
                            className={`rounded-full py-2.5 text-xs font-semibold transition-all ${watermarkColorMode === 'original' ? 'bg-white text-loft-green shadow' : 'text-loft-green/55'}`}
                          >
                            Cores originais
                          </button>
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-loft-green/80">Opacidade</span>
                            <span className="tabular-nums text-loft-green/50">{watermarkOpacityPercent}%</span>
                          </div>
                          <input
                            type="range"
                            min={10}
                            max={100}
                            value={watermarkOpacityPercent}
                            onChange={(e) => setWatermarkOpacityPercent(Number(e.target.value))}
                            className="w-full accent-loft-orange"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                <div id="section-export" className="scroll-mt-24 space-y-3 border-t border-loft-green/10 pt-4">
                  <h2 className={stepHeadingClass}>
                    <Download size={14} className="text-loft-orange" />
                    <span className="text-loft-orange">4.</span> Exportar
                  </h2>

                  {!watermarkEnabled ? (
                    <button
                      type="button"
                      onClick={handleDownload}
                      disabled={!processedSrc || isProcessing}
                      className="w-full flex items-center justify-center gap-2 rounded-full bg-loft-orange py-3.5 px-4 font-bold text-white shadow-lg shadow-loft-orange/25 transition-colors hover:bg-[#e85f42] disabled:cursor-not-allowed disabled:bg-loft-orange/40"
                    >
                      <Download size={20} /> Baixar PNG
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <div className="space-y-1.5 rounded-2xl border border-loft-orange/20 bg-white/70 p-3">
                        <button
                          type="button"
                          onClick={handleDownload}
                          disabled={!processedSrc || isProcessing}
                          className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-loft-orange px-3 py-2.5 text-sm font-bold text-white shadow shadow-loft-orange/25 transition-colors hover:bg-[#e85f42] disabled:cursor-not-allowed disabled:bg-loft-orange/40"
                        >
                          <Droplets size={16} /> Marca d&apos;água (PNG)
                        </button>
                        <p className="text-[11px] leading-snug text-loft-green/65 px-1">
                          Logo isolado, fundo transparente — arquivo final para o cliente.
                        </p>
                      </div>

                      <div className="space-y-1.5 rounded-2xl border border-loft-green/20 bg-white/70 p-3">
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={handleDownloadPropertyPreview}
                            disabled={!propertyPreviewSrc || isComposingPropertyPreview}
                            className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-loft-green px-3 py-2.5 text-sm font-bold text-white shadow transition-colors hover:bg-loft-green/90 disabled:cursor-not-allowed disabled:bg-loft-green/40"
                          >
                            <Home size={16} /> Prévia em imóvel
                          </button>
                          <button
                            type="button"
                            onClick={handleCopyPropertyPreview}
                            disabled={!propertyPreviewSrc || isComposingPropertyPreview}
                            className="inline-flex items-center justify-center rounded-full border border-loft-green/25 bg-white px-2.5 py-2.5 text-loft-green shadow-sm transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
                            title="Copiar imagem para a área de transferência"
                            aria-label="Copiar imagem"
                          >
                            <Copy size={14} />
                          </button>
                        </div>
                        <p className="text-[11px] leading-snug text-loft-green/65 px-1">
                          Demonstrativo da marca d&apos;água aplicada sobre uma foto real.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {watermarkEnabled && (
                  <section
                    id="section-watermark-message"
                    className="scroll-mt-24 space-y-2 border-t border-loft-green/10 pt-4"
                  >
                    <h2 className={stepHeadingClass}>
                      <MessageSquareText size={14} className="text-loft-orange" />
                      <span className="text-loft-orange">5.</span> Texto para o cliente
                    </h2>
                    <p className="text-[11px] leading-snug text-loft-green/65">
                      Sincroniza com Posição, Tamanho e Opacidade. Edição manual não é
                      sobrescrita.
                    </p>
                    <textarea
                      value={watermarkClientMessage}
                      onChange={(e) => handleWatermarkMessageChange(e.target.value)}
                      rows={6}
                      spellCheck={false}
                      className="w-full resize-y rounded-2xl border border-loft-green/15 bg-white/90 p-2.5 text-xs text-loft-green outline-none focus:ring-2 focus:ring-loft-orange/40 font-mono leading-relaxed"
                    />
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={handleCopyWatermarkMessage}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full bg-loft-green px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-loft-green/90"
                      >
                        <Copy size={14} /> Copiar texto
                      </button>
                      <button
                        type="button"
                        onClick={handleResetWatermarkMessage}
                        className="inline-flex items-center justify-center rounded-full border border-loft-green/20 bg-white/80 px-2.5 py-2 text-loft-green shadow-sm transition-colors hover:bg-white"
                        title="Restaurar texto padrão"
                        aria-label="Restaurar padrão"
                      >
                        <RotateCcw size={14} />
                      </button>
                    </div>
                  </section>
                )}
              </>
            )}
          </aside>
        </div>

        <footer className="pb-6 text-center text-xs text-loft-green/55">
          Processamento local no navegador — sua imagem não é enviada a servidores de edição.
        </footer>
      </div>

      {pasteToastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full border border-white/35 bg-loft-green/95 px-5 py-2.5 text-sm font-semibold text-white shadow-loft-lg backdrop-blur-md"
        >
          {pasteToastMessage}
        </div>
      )}
    </div>
  );
}
