import type { AiBrandData } from '../types/brandKit';

export type BrandKitResult =
  | { ok: true; data: AiBrandData }
  | { ok: false; userMessage: string };

const DEFAULT_MODEL = 'gemini-2.0-flash';

/**
 * Calls Gemini with the processed PNG. Requires VITE_GEMINI_API_KEY at build time.
 *
 * TODO (production): proxy this request through your backend so the API key never ships to browsers.
 * Anyone can extract keys from bundled SPA env vars or DevTools network logs.
 */
export async function requestBrandKitFromGemini(
  processedPngDataUrl: string
): Promise<BrandKitResult> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey?.trim()) {
    return {
      ok: false,
      userMessage:
        'Defina VITE_GEMINI_API_KEY no arquivo .env na raiz do projeto e reinicie o servidor de desenvolvimento.',
    };
  }

  const model =
    import.meta.env.VITE_GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const base64Data = processedPngDataUrl.split(',')[1];
  if (!base64Data) {
    return {
      ok: false,
      userMessage:
        'Não foi possível ler a imagem. Processe a logo novamente e tente de novo.',
    };
  }

  const prompt = `Você é um especialista em branding de alto padrão para o mercado imobiliário. Analise a logo anexada. Crie um kit de marca. Retorne um JSON estrito: {"slogans": ["slogan 1", "slogan 2", "slogan 3"], "aboutUs": "Parágrafo elegante.", "colors": [{"hex": "#Hex", "reason": "Motivo"}]}`;
  const payload = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          {
            inlineData: { mimeType: 'image/png', data: base64Data },
          },
        ],
      },
    ],
    generationConfig: { responseMimeType: 'application/json' },
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const rawText = await response.text();
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      return {
        ok: false,
        userMessage:
          'Resposta inválida do servidor. Verifique a chave e tente novamente.',
      };
    }

    if (!response.ok) {
      const errObj = data.error as { message?: string } | undefined;
      const detail = errObj?.message ?? rawText.slice(0, 200);
      return {
        ok: false,
        userMessage: `Erro da API (${response.status}). ${detail}`,
      };
    }

    const candidates = data.candidates as
      | Array<{ content?: { parts?: Array<{ text?: string }> } }>
      | undefined;
    const resultText = candidates?.[0]?.content?.parts?.[0]?.text;
    if (!resultText) {
      return {
        ok: false,
        userMessage:
          'A IA não retornou conteúdo. Tente outra imagem ou verifique o modelo configurado.',
      };
    }

    try {
      const parsed = JSON.parse(resultText) as AiBrandData;
      return { ok: true, data: parsed };
    } catch {
      return {
        ok: false,
        userMessage:
          'Não foi possível interpretar o JSON da IA. Tente novamente.',
      };
    }
  } catch (e) {
    if (e instanceof TypeError) {
      return {
        ok: false,
        userMessage:
          'Falha de rede. Verifique sua conexão e tente novamente.',
      };
    }
    return {
      ok: false,
      userMessage:
        e instanceof Error ? e.message : 'Erro inesperado. Tente novamente.',
    };
  }
}
