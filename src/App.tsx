import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  Upload,
  Download,
  Image as ImageIcon,
  Maximize,
  Crop,
  MonitorUp,
  Wand2,
  Droplets,
  Loader2,
  ChevronDown,
} from 'lucide-react';
import { useImagePipeline } from './hooks/useImagePipeline';
import { usePreparedCropPreview } from './hooks/usePreparedCropPreview';
import { useDebouncedValue } from './hooks/useDebouncedValue';
import { InteractiveCropEditor } from './components/InteractiveCropEditor';
import type { ContentBounds, OutputFormat, WatermarkColorMode } from './types/imagePipeline';

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
  const [watermarkColorMode, setWatermarkColorMode] = useState<WatermarkColorMode>('white');
  const [watermarkOpacityPercent, setWatermarkOpacityPercent] = useState(40);

  const [selectedFormat, setSelectedFormat] = useState<OutputFormat>('custom');
  const [upscaleMultiplier, setUpscaleMultiplier] = useState(1);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pasteToastMessage, setPasteToastMessage] = useState<string | null>(null);

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

  const checkeredStyle: React.CSSProperties = {
    backgroundColor: '#f8fafc',
    backgroundImage: `linear-gradient(45deg, #e2e8f0 25%, transparent 25%),
                      linear-gradient(-45deg, #e2e8f0 25%, transparent 25%),
                      linear-gradient(45deg, transparent 75%, #e2e8f0 75%),
                      linear-gradient(-45deg, transparent 75%, #e2e8f0 75%)`,
    backgroundSize: '20px 20px',
    backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
  };

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
    else if (selectedFormat === 'site') filename = 'LOGO_SITE.png';
    else if (selectedFormat === 'favicon') filename = 'favicon.png';
    if (watermarkEnabled) filename = `marca_dagua_${filename}`;

    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-8">
        <header className="text-center space-y-3 max-w-2xl mx-auto glass-panel px-6 py-6 sm:px-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-loft-orange">Loft · Imobiliário</p>
          <h1 className="text-3xl sm:text-4xl font-bold text-loft-green tracking-tight">Processador de logo</h1>
          <p className="text-loft-green/80 text-sm sm:text-base leading-relaxed">
            Remova fundo no navegador, ajuste o recorte na imagem, escolha o formato e exporte com ou sem marca
            d&apos;água — tudo em um fluxo só.
          </p>
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
                {cropReady && cropPreview && cropPreview.autoBounds && (
                  <section
                    id="section-crop"
                    className="scroll-mt-24 space-y-3 rounded-3xl border border-white/50 bg-white/40 p-5 sm:p-6 shadow-loft backdrop-blur-md"
                  >
                    <div>
                      <h2 className="text-lg font-bold text-loft-green">Recorte na imagem</h2>
                      <p className="text-sm text-loft-green/75 mt-1 leading-relaxed">
                        Ajuste a moldura aqui: arraste o centro para mover ou os cantos para refinar o que entra no
                        arquivo final.
                      </p>
                    </div>
                    <InteractiveCropEditor
                      imageSrc={cropPreview.dataUrl}
                      naturalWidth={cropPreview.width}
                      naturalHeight={cropPreview.height}
                      autoBounds={cropPreview.autoBounds}
                      cropBounds={interactiveCropBounds}
                      onCropChange={handleCropChange}
                      disabled={isProcessing}
                    />
                  </section>
                )}

                <section
                  id="section-final-preview"
                  className="scroll-mt-24 rounded-3xl border border-white/50 bg-white/35 overflow-hidden flex flex-col min-h-[280px] shadow-loft backdrop-blur-md"
                >
                  <div className="border-b border-loft-green/10 bg-white/50 px-4 py-3 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-bold text-loft-green">Prévia do PNG final</h2>
                      <p className="text-xs text-loft-green/70 mt-0.5">
                        É assim que o arquivo vai sair ao exportar (formato, margem, escala e marca d&apos;água).
                      </p>
                    </div>
                    <div className="flex gap-2 flex-wrap justify-end">
                      {interactiveCropBounds !== null && (
                        <span className="text-xs font-semibold bg-loft-mint/15 text-loft-green px-2.5 py-1 rounded-full border border-loft-mint/30">
                          Recorte manual
                        </span>
                      )}
                      {watermarkEnabled && (
                        <span className="text-xs font-semibold bg-loft-orange/15 text-loft-green px-2.5 py-1 rounded-full border border-loft-orange/25">
                          Marca d&apos;água {watermarkOpacityPercent}%
                        </span>
                      )}
                      {upscaleMultiplier > 1 && (
                        <span className="text-xs font-semibold bg-white/80 text-loft-green px-2.5 py-1 rounded-full border border-loft-green/15">
                          {upscaleMultiplier}× escala
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="relative flex-1 flex items-center justify-center p-6 min-h-[240px]" style={checkeredStyle}>
                    {showFinalPreviewBusy && (
                      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-white/55 backdrop-blur-[2px]">
                        <Loader2 size={28} className="animate-spin text-loft-orange" />
                        <span className="text-xs font-semibold text-loft-green">
                          {isProcessing ? 'Processando…' : 'Atualizando prévia…'}
                        </span>
                      </div>
                    )}
                    {!showFinalPreviewBusy && !processedSrc && (
                      <div className="flex flex-col items-center gap-2 text-loft-green/50">
                        <Maximize size={28} className="opacity-60" />
                        <span className="text-sm">Nada visível para exportar</span>
                      </div>
                    )}
                    {processedSrc && (
                      <img
                        src={processedSrc}
                        alt="Resultado"
                        className={`relative z-0 max-w-full max-h-[min(420px,50vh)] object-contain rounded-2xl shadow-lg ${showFinalPreviewBusy ? 'opacity-40' : 'opacity-100'} transition-opacity`}
                      />
                    )}
                  </div>
                </section>
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

                <section className="space-y-3 rounded-2xl border border-dashed border-loft-orange/35 bg-loft-orange/5 p-4 lg:hidden">
                  <h2 className={stepHeadingClass}>
                    <Crop size={14} className="text-loft-orange" />
                    <span className="text-loft-orange">3.</span> Recorte
                  </h2>
                  <p className="text-xs leading-relaxed text-loft-green/75">
                    No celular, o recorte interativo fica acima desta coluna. Toque em &quot;Ir para o recorte&quot; no
                    topo ou role a página.
                  </p>
                  <button
                    type="button"
                    onClick={() => scrollToId('section-crop')}
                    className="w-full rounded-full border border-loft-orange/40 bg-white/90 py-2 text-xs font-semibold text-loft-green shadow-sm"
                  >
                    Abrir área de recorte
                  </button>
                </section>

                <section className="hidden space-y-2 rounded-2xl border border-loft-green/10 bg-white/40 p-4 lg:block">
                  <h2 className={stepHeadingClass}>
                    <Crop size={14} className="text-loft-orange" />
                    <span className="text-loft-orange">3.</span> Recorte
                  </h2>
                  <p className="text-xs leading-relaxed text-loft-green/70">
                    Use a área à esquerda para mover ou redimensionar a moldura na arte já sem fundo.
                  </p>
                </section>

                <section className="space-y-4 pt-2 border-t border-loft-green/10">
                  <h2 className={stepHeadingClass}>
                    <Crop size={14} className="text-loft-orange" />
                    <span className="text-loft-orange">4.</span> Saída
                  </h2>
                  <div className={controlShellClass}>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-loft-green">Formato</label>
                      <select
                        value={selectedFormat}
                        onChange={(e) => setSelectedFormat(e.target.value as OutputFormat)}
                        className="w-full rounded-2xl border border-loft-green/15 bg-white/90 p-3 text-sm text-loft-green outline-none ring-loft-orange/40 focus:ring-2"
                      >
                        <option value="custom">Livre / automático</option>
                        <option value="relatorio">Relatório (200×80)</option>
                        <option value="site">Site (500×500)</option>
                        <option value="favicon">Favicon (30×30)</option>
                      </select>
                    </div>

                    <div className="space-y-2">
                      <span className="flex items-center gap-2 text-sm font-semibold text-loft-green">
                        <MonitorUp size={14} /> Escala
                      </span>
                      <select
                        value={upscaleMultiplier}
                        onChange={(e) => setUpscaleMultiplier(Number(e.target.value))}
                        className="w-full rounded-2xl border border-loft-green/15 bg-white/90 p-3 text-sm text-loft-green outline-none focus:ring-2 focus:ring-loft-orange/40"
                      >
                        <option value={1}>1×</option>
                        <option value={2}>2×</option>
                        <option value={4}>4×</option>
                      </select>
                      <p className="text-xs leading-relaxed text-loft-green/65">
                        Aumenta o tamanho em pixels no canvas com suavização — não é super-resolução por IA.
                      </p>
                    </div>

                    {selectedFormat !== 'favicon' && (
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-loft-green/80">Margem</span>
                          <span className="tabular-nums text-loft-green/50">{padding}px</span>
                        </div>
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

                <section className="space-y-4 pt-2 border-t border-loft-green/10">
                  <h2 className={stepHeadingClass}>
                    <Droplets size={14} className="text-loft-orange" />
                    <span className="text-loft-orange">5.</span> Marca d&apos;água
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

                <div id="section-export" className="scroll-mt-24 space-y-2 border-t border-loft-green/10 pt-4">
                  <h2 className={stepHeadingClass}>
                    <Download size={14} className="text-loft-orange" />
                    <span className="text-loft-orange">6.</span> Exportar
                  </h2>
                  <button
                    type="button"
                    onClick={handleDownload}
                    disabled={!processedSrc || isProcessing}
                    className="w-full flex items-center justify-center gap-2 rounded-full bg-loft-orange py-3.5 px-4 font-bold text-white shadow-lg shadow-loft-orange/25 transition-colors hover:bg-[#e85f42] disabled:cursor-not-allowed disabled:bg-loft-orange/40"
                  >
                    <Download size={20} /> Baixar PNG
                  </button>
                </div>
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
