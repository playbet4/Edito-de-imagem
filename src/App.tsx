import React, { useCallback, useState, useRef } from 'react';
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
} from 'lucide-react';
import { useImagePipeline } from './hooks/useImagePipeline';
import { usePreparedCropPreview } from './hooks/usePreparedCropPreview';
import { InteractiveCropEditor } from './components/InteractiveCropEditor';
import type { ContentBounds, OutputFormat, WatermarkColorMode } from './types/imagePipeline';

export default function App() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);

  const [removeBackground, setRemoveBackground] = useState(true);
  const [tolerance, setTolerance] = useState(15);
  const [padding, setPadding] = useState(40);
  const [interactiveCropBounds, setInteractiveCropBounds] = useState<ContentBounds | null>(null);

  const [watermarkEnabled, setWatermarkEnabled] = useState(false);
  const [watermarkColorMode, setWatermarkColorMode] = useState<WatermarkColorMode>('white');
  const [watermarkOpacityPercent, setWatermarkOpacityPercent] = useState(40);

  const [selectedFormat, setSelectedFormat] = useState<OutputFormat>('custom');
  const [upscaleMultiplier, setUpscaleMultiplier] = useState(1);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const cropPreview = usePreparedCropPreview(imageSrc, removeBackground, tolerance);

  const { processedSrc, isProcessing } = useImagePipeline(imageSrc, {
    tolerance,
    padding,
    interactiveCropBounds,
    removeBackground,
    selectedFormat,
    upscaleMultiplier,
    watermarkEnabled,
    watermarkColorMode,
    watermarkOpacityPercent,
  });

  const handleCropChange = useCallback((bounds: ContentBounds | null) => {
    setInteractiveCropBounds(bounds);
  }, []);

  const checkeredStyle: React.CSSProperties = {
    backgroundColor: '#f9fafb',
    backgroundImage: `linear-gradient(45deg, #e5e7eb 25%, transparent 25%),
                      linear-gradient(-45deg, #e5e7eb 25%, transparent 25%),
                      linear-gradient(45deg, transparent 75%, #e5e7eb 75%),
                      linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)`,
    backgroundSize: '20px 20px',
    backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        setImageSrc(result);
        setInteractiveCropBounds(null);
      };
      reader.readAsDataURL(file);
    }
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

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100/80 text-gray-800">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-10">
        <header className="text-center space-y-3 max-w-2xl mx-auto">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Imobiliário</p>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
            Processador de logo
          </h1>
          <p className="text-slate-600 text-sm sm:text-base leading-relaxed">
            Remova fundo no navegador, defina o recorte direto na imagem, escolha formatos de exportação e marca
            d&apos;água — tudo em um fluxo só.
          </p>
        </header>

        <div className="bg-white/90 backdrop-blur rounded-2xl shadow-lg shadow-slate-200/60 border border-slate-200/80 p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10">
          <aside className="lg:col-span-4 space-y-8">
            <section className="space-y-4">
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">1. Imagem</h2>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-950 text-white py-3.5 px-4 rounded-xl transition-colors font-medium shadow-md shadow-slate-900/15"
              >
                <Upload size={20} /> Escolher imagem
              </button>
              <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
            </section>

            {imageSrc && (
              <>
                <section className="space-y-4 pt-2 border-t border-slate-100">
                  <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                    <Wand2 size={14} className="text-slate-600" /> Fundo
                  </h2>
                  <div className="space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-200/80">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        className="w-5 h-5 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                        checked={removeBackground}
                        onChange={(e) => setRemoveBackground(e.target.checked)}
                      />
                      <span className="text-sm font-semibold text-slate-800">Remover fundo (cor da borda)</span>
                    </label>
                    {removeBackground && (
                      <div className="space-y-2 pt-1">
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-600">Tolerância</span>
                          <span className="text-slate-400 tabular-nums">{tolerance}</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={150}
                          value={tolerance}
                          onChange={(e) => setTolerance(Number(e.target.value))}
                          className="w-full accent-slate-900"
                        />
                        <p className="text-xs text-slate-500 leading-relaxed">
                          Ajuste se sobrar halo claro ou se o logo perder partes finas.
                        </p>
                      </div>
                    )}
                  </div>
                </section>

                <section className="space-y-4 pt-2 border-t border-slate-100">
                  <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                    <Crop size={14} className="text-slate-600" /> Saída
                  </h2>
                  <div className="space-y-3">
                    <label className="text-sm font-medium text-slate-700">Formato</label>
                    <select
                      value={selectedFormat}
                      onChange={(e) => setSelectedFormat(e.target.value as OutputFormat)}
                      className="w-full p-3 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-slate-900/15 outline-none"
                    >
                      <option value="custom">Livre / automático</option>
                      <option value="relatorio">Relatório (200×80)</option>
                      <option value="site">Site (500×500)</option>
                      <option value="favicon">Favicon (30×30)</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <span
                      className="text-sm font-medium text-slate-700 flex items-center gap-2"
                      title="Interpolação do canvas, não IA."
                    >
                      <MonitorUp size={14} /> Escala
                    </span>
                    <select
                      value={upscaleMultiplier}
                      onChange={(e) => setUpscaleMultiplier(Number(e.target.value))}
                      className="w-full p-3 border border-slate-200 rounded-xl text-sm bg-white"
                    >
                      <option value={1}>1×</option>
                      <option value={2}>2×</option>
                      <option value={4}>4×</option>
                    </select>
                  </div>

                  {selectedFormat !== 'favicon' && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">Margem</span>
                        <span className="text-slate-400 tabular-nums">{padding}px</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={150}
                        value={padding}
                        onChange={(e) => setPadding(Number(e.target.value))}
                        className="w-full accent-slate-900"
                      />
                    </div>
                  )}
                </section>

                <section className="space-y-4 pt-2 border-t border-slate-100">
                  <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                    <Droplets size={14} className="text-slate-600" /> Marca d&apos;água
                  </h2>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-5 h-5 rounded border-slate-300 text-slate-900"
                      checked={watermarkEnabled}
                      onChange={(e) => setWatermarkEnabled(e.target.checked)}
                    />
                    <span className="text-sm font-semibold text-slate-800">Exportar como marca d&apos;água</span>
                  </label>
                  {watermarkEnabled && (
                    <div className="space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-200/80">
                      <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100/80 rounded-lg">
                        <button
                          type="button"
                          onClick={() => setWatermarkColorMode('white')}
                          className={`text-xs font-semibold py-2.5 rounded-md transition-all ${watermarkColorMode === 'white' ? 'bg-white shadow text-slate-900' : 'text-slate-500'}`}
                        >
                          Tudo branco
                        </button>
                        <button
                          type="button"
                          onClick={() => setWatermarkColorMode('original')}
                          className={`text-xs font-semibold py-2.5 rounded-md transition-all ${watermarkColorMode === 'original' ? 'bg-white shadow text-slate-900' : 'text-slate-500'}`}
                        >
                          Cores originais
                        </button>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-600">Opacidade</span>
                          <span className="text-slate-400 tabular-nums">{watermarkOpacityPercent}%</span>
                        </div>
                        <input
                          type="range"
                          min={10}
                          max={100}
                          value={watermarkOpacityPercent}
                          onChange={(e) => setWatermarkOpacityPercent(Number(e.target.value))}
                          className="w-full accent-slate-900"
                        />
                      </div>
                    </div>
                  )}
                </section>

                <div className="pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={handleDownload}
                    disabled={!processedSrc || isProcessing}
                    className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300/80 text-white py-3.5 px-4 rounded-xl font-semibold shadow-md shadow-emerald-900/10 transition-colors"
                  >
                    <Download size={20} /> Exportar PNG
                  </button>
                </div>
              </>
            )}
          </aside>

          <div className="lg:col-span-8 flex flex-col gap-8">
            {!imageSrc ? (
              <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 min-h-[280px] flex flex-col items-center justify-center text-slate-400 p-8">
                <ImageIcon size={52} className="mb-3 opacity-40" strokeWidth={1.25} />
                <p className="text-sm font-medium text-slate-500">Envie uma imagem para começar</p>
                <p className="text-xs text-slate-400 mt-1 text-center max-w-xs">
                  PNG ou JPG com fundo sólido costuma dar melhor resultado na remoção automática.
                </p>
              </div>
            ) : (
              <>
                {cropReady && cropPreview && cropPreview.autoBounds && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
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
                )}

                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 overflow-hidden flex flex-col min-h-[280px] shadow-inner">
                  <div className="bg-white/90 px-4 py-3 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-700">Prévia final</span>
                    <div className="flex gap-2 flex-wrap justify-end">
                      {interactiveCropBounds !== null && (
                        <span className="text-xs font-medium bg-emerald-50 text-emerald-900 px-2.5 py-1 rounded-md border border-emerald-200/80">
                          Recorte manual
                        </span>
                      )}
                      {watermarkEnabled && (
                        <span className="text-xs font-medium bg-slate-100 text-slate-700 px-2.5 py-1 rounded-md border border-slate-200">
                          Marca d&apos;água {watermarkOpacityPercent}%
                        </span>
                      )}
                      {upscaleMultiplier > 1 && (
                        <span className="text-xs font-medium bg-sky-50 text-sky-800 px-2.5 py-1 rounded-md border border-sky-200">
                          {upscaleMultiplier}× escala
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 flex items-center justify-center p-6 min-h-[240px]" style={checkeredStyle}>
                    {isProcessing && (
                      <div className="flex flex-col items-center gap-3 text-slate-400">
                        <Loader2 size={32} className="animate-spin" />
                        <span className="text-sm font-medium">Processando…</span>
                      </div>
                    )}
                    {!isProcessing && processedSrc && (
                      <img
                        src={processedSrc}
                        alt="Resultado"
                        className="max-w-full max-h-[min(420px,50vh)] object-contain drop-shadow-lg rounded-lg"
                      />
                    )}
                    {!isProcessing && !processedSrc && (
                      <div className="flex flex-col items-center gap-2 text-slate-400">
                        <Maximize size={28} className="opacity-50" />
                        <span className="text-sm">Nada visível para exportar</span>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <footer className="text-center text-xs text-slate-400 pb-4">
          Processamento local no navegador — sua imagem não é enviada a servidores de edição.
        </footer>
      </div>
    </div>
  );
}
