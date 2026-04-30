import React, { useState, useRef } from 'react';
import {
  Upload,
  Download,
  Image as ImageIcon,
  Maximize,
  Sparkles,
  Palette,
  MessageSquare,
  Loader2,
  Quote,
  Crop,
  MonitorUp,
  Wand2,
  KeyRound,
} from 'lucide-react';
import { useImagePipeline } from './hooks/useImagePipeline';
import { requestBrandKitFromGemini } from './lib/brandKitGemini';
import type { OutputFormat } from './types/imagePipeline';
import type { AiBrandData } from './types/brandKit';

export default function App() {
  const [originalImageSrc, setOriginalImageSrc] = useState<string | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);

  const [bgRemovalMethod, setBgRemovalMethod] = useState<'canvas' | 'removebg'>('canvas');
  const [removeBgApiKey, setRemoveBgApiKey] = useState('');
  const [isRemovingBgApi, setIsRemovingBgApi] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const [removeBackground, setRemoveBackground] = useState(true);
  const [tolerance, setTolerance] = useState(15);
  const [padding, setPadding] = useState(40);

  const [selectedFormat, setSelectedFormat] = useState<OutputFormat>('custom');
  const [upscaleMultiplier, setUpscaleMultiplier] = useState(1);

  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiBrandData, setAiBrandData] = useState<AiBrandData | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { processedSrc, isProcessing } = useImagePipeline(imageSrc, {
    tolerance,
    padding,
    removeBackground,
    selectedFormat,
    upscaleMultiplier,
    bgRemovalMethod,
  });

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
        setOriginalImageSrc(result);
        setImageSrc(result);
        setAiBrandData(null);
        setAiError(null);
        setApiError(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveBgApiCall = async () => {
    if (!originalImageSrc || !removeBgApiKey) {
      setApiError('Insira sua API Key do Remove.bg primeiro.');
      return;
    }

    setIsRemovingBgApi(true);
    setApiError(null);

    /**
     * Security: any API key used from the browser can be copied from the client bundle, DevTools, or
     * network traffic. For production, call Remove.bg from your own backend and keep the key server-side.
     */
    try {
      const base64Data = originalImageSrc.split(',')[1];

      const response = await fetch('https://api.remove.bg/v1.0/removebg', {
        method: 'POST',
        headers: {
          'X-Api-Key': removeBgApiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          image_file_b64: base64Data,
          size: 'auto',
        }),
      });

      if (!response.ok) {
        throw new Error(`Erro API: ${response.status} - Verifique sua chave.`);
      }

      const data = await response.json();
      const transparentImageBase64 = `data:image/png;base64,${data.data.result_b64}`;

      setImageSrc(transparentImageBase64);
      setBgRemovalMethod('canvas');
      setRemoveBackground(false);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Erro desconhecido');
    } finally {
      setIsRemovingBgApi(false);
    }
  };

  const resetImage = () => {
    setImageSrc(originalImageSrc);
    setRemoveBackground(true);
  };

  const handleDownload = () => {
    if (!processedSrc) return;
    const link = document.createElement('a');
    link.href = processedSrc;

    let filename = 'logo_imobiliaria.png';
    if (selectedFormat === 'relatorio') filename = 'relatorio.png';
    else if (selectedFormat === 'site') filename = 'LOGO_SITE.png';
    else if (selectedFormat === 'favicon') filename = 'favicon.png';

    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const generateBrandKit = async () => {
    if (!processedSrc) return;
    setIsAiLoading(true);
    setAiBrandData(null);
    setAiError(null);
    const result = await requestBrandKitFromGemini(processedSrc);
    if (result.ok) {
      setAiBrandData(result.data);
    } else {
      setAiError(result.userMessage);
    }
    setIsAiLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 font-sans text-gray-800">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Processador de Logo Imobiliário</h1>
          <p className="text-gray-500 max-w-2xl mx-auto">
            Remova fundos, centralize, escolha formatos fixos e amplie a saída com redimensionamento de alta
            qualidade no navegador (suavização do canvas — não é modelo de IA de upscaling).
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-4 space-y-6">
            <div className="space-y-4">
              <label className="block text-sm font-semibold text-gray-700 uppercase tracking-wider">Passo 1: Upload</label>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-900 text-white py-3 px-4 rounded-xl transition-colors font-medium"
              >
                <Upload size={20} /> Escolher Imagem
              </button>
              <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
            </div>

            {imageSrc && (
              <>
                <div className="space-y-5 pt-6 border-t border-gray-100">
                  <label className="block text-sm font-semibold text-gray-700 uppercase tracking-wider flex items-center gap-2">
                    <Wand2 size={16} /> Remoção de Fundo
                  </label>

                  <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setBgRemovalMethod('canvas')}
                      className={`text-xs font-semibold py-2 rounded-md transition-all ${bgRemovalMethod === 'canvas' ? 'bg-white shadow-sm text-slate-800' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      Canvas (Local)
                    </button>
                    <button
                      type="button"
                      onClick={() => setBgRemovalMethod('removebg')}
                      className={`text-xs font-semibold py-2 rounded-md transition-all ${bgRemovalMethod === 'removebg' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      Remove.bg API
                    </button>
                  </div>

                  {bgRemovalMethod === 'canvas' ? (
                    <div className="space-y-4 bg-gray-50 p-4 rounded-xl border border-gray-200">
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          className="w-5 h-5 accent-slate-800"
                          checked={removeBackground}
                          onChange={(e) => setRemoveBackground(e.target.checked)}
                        />
                        <span className="text-sm font-bold text-gray-800">Remoção Automática</span>
                      </label>

                      {removeBackground && (
                        <div className="space-y-2 pt-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Tolerância de Cor</span>
                            <span className="text-gray-400">{tolerance}</span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={150}
                            value={tolerance}
                            onChange={(e) => setTolerance(Number(e.target.value))}
                            className="w-full accent-slate-800"
                          />
                          <p className="text-xs text-gray-500 leading-tight">
                            A cor de fundo é estimada pelas bordas e cantos da imagem (mediana por canal) e os
                            pixels próximos são tornados transparentes. Ajuste a régua se sobrar halo ou se apagar
                            partes do logo.
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3 bg-blue-50/50 p-4 rounded-xl border border-blue-100">
                      <div className="flex items-center gap-2 text-sm text-blue-800 font-medium mb-1">
                        <KeyRound size={16} /> Chave da API (Opcional)
                      </div>
                      <input
                        type="text"
                        placeholder="Ex: aB3cD4eF5..."
                        value={removeBgApiKey}
                        onChange={(e) => setRemoveBgApiKey(e.target.value)}
                        className="w-full text-sm p-2 border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleRemoveBgApiCall}
                        disabled={isRemovingBgApi || !removeBgApiKey}
                        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium py-2 rounded-lg transition-colors flex justify-center items-center gap-2"
                      >
                        {isRemovingBgApi ? <Loader2 size={16} className="animate-spin" /> : 'Processar com Inteligência'}
                      </button>
                      {apiError && <p className="text-xs text-red-600 mt-1">{apiError}</p>}
                      <button type="button" onClick={resetImage} className="w-full text-xs text-blue-600 underline">
                        Voltar Imagem Original
                      </button>
                    </div>
                  )}
                </div>

                <div className="space-y-5 pt-6 border-t border-gray-100">
                  <label className="block text-sm font-semibold text-gray-700 uppercase tracking-wider flex items-center gap-2">
                    <Crop size={16} /> Formato e Saída
                  </label>

                  <div className="space-y-2">
                    <span className="text-sm font-medium text-gray-600 block">Tamanho Final:</span>
                    <select
                      value={selectedFormat}
                      onChange={(e) => setSelectedFormat(e.target.value as OutputFormat)}
                      className="w-full p-2.5 border border-gray-200 rounded-lg text-sm outline-none"
                    >
                      <option value="custom">Livre / Ajuste Automático</option>
                      <option value="relatorio">Relatório (200x80)</option>
                      <option value="site">LOGO SITE (500x500)</option>
                      <option value="favicon">Favicon (30x30)</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <span
                      className="text-sm font-medium text-gray-600 flex items-center gap-2"
                      title="Multiplica largura e altura no canvas com interpolação de alta qualidade (não é upscaling por IA)."
                    >
                      <MonitorUp size={14} /> Escala de saída (canvas):
                    </span>
                    <select
                      title="Redimensiona o resultado final no canvas com suavização. Não usa modelo de super-resolução."
                      value={upscaleMultiplier}
                      onChange={(e) => setUpscaleMultiplier(Number(e.target.value))}
                      className="w-full p-2.5 border border-gray-200 rounded-lg text-sm outline-none"
                    >
                      <option value={1}>1× — tamanho base</option>
                      <option value={2}>2× — arquivo maior, bordas mais suaves</option>
                      <option value={4}>4× — arquivo grande (interpolação)</option>
                    </select>
                    <p className="text-xs text-gray-500">
                      Aumenta pixels via canvas do navegador (suavização), útil para logos pequenos — não é o mesmo
                      que ferramentas de super-resolução com IA.
                    </p>
                  </div>

                  {selectedFormat !== 'favicon' && (
                    <div className="space-y-2 pt-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Margem (Respiro)</span>
                        <span className="text-gray-400">{padding}px</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={150}
                        value={padding}
                        onChange={(e) => setPadding(Number(e.target.value))}
                        className="w-full accent-slate-800"
                      />
                    </div>
                  )}
                </div>

                <div className="pt-6 border-t border-gray-100 space-y-4">
                  <button
                    type="button"
                    onClick={handleDownload}
                    disabled={!processedSrc || isProcessing}
                    className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white py-3 px-4 rounded-xl transition-colors font-medium"
                  >
                    <Download size={20} /> Exportar {selectedFormat !== 'custom' && `(${selectedFormat})`}
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="lg:col-span-8 flex flex-col gap-6">
            <div className="bg-gray-50 rounded-xl border border-gray-200 overflow-hidden flex flex-col h-[500px]">
              {!imageSrc ? (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-12">
                  <ImageIcon size={48} className="mb-4 opacity-50" />
                  <p>Faça upload para ver o preview.</p>
                </div>
              ) : (
                <>
                  <div className="bg-gray-100 px-4 py-2 border-b border-gray-200 text-sm font-medium text-gray-500 flex justify-between items-center">
                    <span>Resultado Final (PNG)</span>
                    <div className="flex gap-2">
                      <div className="flex items-center gap-1 text-xs bg-white px-2 py-1 rounded border shadow-sm">
                        <Crop size={12} /> Auto-recorte
                      </div>
                      {upscaleMultiplier > 1 && (
                        <div
                          className="flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded border border-blue-200 shadow-sm"
                          title="Escala via canvas, não IA"
                        >
                          <MonitorUp size={12} /> {upscaleMultiplier}× escala
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 flex items-center justify-center p-8 overflow-auto" style={checkeredStyle}>
                    {isProcessing && (
                      <div className="flex flex-col items-center gap-3 text-gray-400">
                        <Loader2 size={32} className="animate-spin" />
                        <span className="text-sm">Processando...</span>
                      </div>
                    )}
                    {!isProcessing && processedSrc && (
                      <img src={processedSrc} alt="Logo" className="max-w-full max-h-full object-contain drop-shadow-md" />
                    )}
                    {!isProcessing && !processedSrc && (
                      <div className="flex flex-col items-center gap-3 text-gray-400">
                        <Maximize size={32} className="opacity-50" />
                        <span className="text-sm">Nenhum pixel visível detectado.</span>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {imageSrc && (
              <div className="flex flex-col items-center mt-4 gap-2">
                <button
                  type="button"
                  onClick={generateBrandKit}
                  disabled={!processedSrc || isAiLoading}
                  className="flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 disabled:opacity-50 text-white py-3 px-6 rounded-full shadow-md font-medium hover:scale-105 transition-transform"
                >
                  {isAiLoading ? <Loader2 size={20} className="animate-spin" /> : <><Sparkles size={20} /> Analisar Marca com IA</>}
                </button>
                {aiError && <p className="text-sm text-red-600 text-center max-w-lg">{aiError}</p>}
              </div>
            )}

            {aiBrandData && (
              <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-100 rounded-xl p-6 md:p-8 mt-4">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-amber-100 rounded-lg text-amber-600">
                    <Sparkles size={24} />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900">Kit de Marca</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <h4 className="font-semibold text-gray-800 flex items-center gap-2">
                      <MessageSquare size={18} className="text-amber-500" /> Slogans Sugeridos
                    </h4>
                    <ul className="space-y-3">
                      {aiBrandData.slogans?.map((s, idx) => (
                        <li key={idx} className="bg-white px-4 py-3 rounded-lg border border-amber-100 shadow-sm text-gray-700 italic">
                          &ldquo;{s}&rdquo;
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="space-y-4">
                    <h4 className="font-semibold text-gray-800 flex items-center gap-2">
                      <Quote size={18} className="text-amber-500" /> &ldquo;Sobre Nós&rdquo;
                    </h4>
                    <div className="bg-white p-5 rounded-lg border border-amber-100 shadow-sm text-gray-600 leading-relaxed text-sm">{aiBrandData.aboutUs}</div>
                  </div>
                  <div className="md:col-span-2 space-y-4 pt-4 border-t border-amber-200/50">
                    <h4 className="font-semibold text-gray-800 flex items-center gap-2">
                      <Palette size={18} className="text-amber-500" /> Paleta Web
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      {aiBrandData.colors?.map((c, idx) => (
                        <div key={idx} className="flex flex-col bg-white rounded-lg border border-amber-100 shadow-sm overflow-hidden">
                          <div className="h-20 w-full" style={{ backgroundColor: c.hex }} />
                          <div className="p-4">
                            <span className="font-mono font-bold text-gray-900 block mb-1">{c.hex}</span>
                            <span className="text-xs text-gray-500">{c.reason}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
