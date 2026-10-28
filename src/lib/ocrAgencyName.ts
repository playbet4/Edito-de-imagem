import { createWorker } from 'tesseract.js';
import { inferAgencyName } from './inferAgencyName';

const DROP_LINE_TOKENS = new Set([
  'logo',
  'imoveis',
  'imóveis',
  'imobiliaria',
  'imobiliária',
  'negocios',
  'negócios',
  'www',
  'http',
  'https',
  'com',
  'br',
]);

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '');
}

function cleanOcrLine(line: string): string {
  return line
    .replace(/[^\p{L}\p{N}\s'’&./-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Picks the most likely agency title from OCR lines (longest meaningful line,
 * preferring ones that are not generic real-estate nouns alone).
 */
export function agencyNameFromOcrText(rawText: string): string | null {
  const lines = rawText
    .split(/\r?\n/)
    .map(cleanOcrLine)
    .filter((line) => line.length >= 2);

  if (lines.length === 0) return null;

  const scored = lines.map((line) => {
    const words = line.split(' ').filter(Boolean);
    const norm = stripDiacritics(line.toLowerCase());
    let score = line.length;
    if (words.length >= 2) score += 12;
    if (/[A-ZÁÉÍÓÚÂÊÔÃÕ]/.test(line)) score += 4;
    if (DROP_LINE_TOKENS.has(norm) && words.length === 1) score -= 30;
    if (/^\d+$/.test(line)) score -= 40;
    return { line, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < 4) return null;

  // Soft title-case via filename helper path (reuse token cleanup lightly)
  const titled = inferAgencyName(best.line.replace(/\s+/g, '_'));
  if (!titled || titled === 'Logo sem nome') {
    return best.line;
  }
  return titled;
}

let workerPromise: ReturnType<typeof createWorker> | null = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('por+eng', 1, {
      // Keep logs quiet in production UI
      logger: () => undefined,
    });
  }
  return workerPromise;
}

/**
 * Reads visible text from a logo image blob (browser-only OCR).
 * Returns null when OCR finds nothing useful — caller should keep filename fallback.
 */
export async function inferAgencyNameFromImage(
  imageBlob: Blob
): Promise<string | null> {
  try {
    const worker = await getWorker();
    const result = await worker.recognize(imageBlob);
    return agencyNameFromOcrText(result.data.text ?? '');
  } catch {
    return null;
  }
}