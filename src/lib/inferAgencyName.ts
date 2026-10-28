const DROP_TOKENS = new Set([
  'logo',
  'logos',
  'marca',
  'marcadagua',
  'marcaagua',
  'watermark',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'svg',
  'final',
  'oficial',
  'vetor',
  'vector',
  'rgb',
  'cmyk',
  'horizontal',
  'vertical',
  'branco',
  'preto',
  'transparent',
  'transparente',
  'fundo',
  'bg',
  'copy',
  'copia',
  'edited',
  'editado',
  'export',
  'exportacao',
]);

const TITLE_FIX: Record<string, string> = {
  imoveis: 'Imóveis',
  imovel: 'Imóvel',
  negociacoes: 'Negociações',
  negociacao: 'Negociação',
  solucoes: 'Soluções',
  solucao: 'Solução',
  gestao: 'Gestão',
  and: 'e',
};

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '');
}

function toTitleWord(raw: string): string {
  const lower = raw.toLowerCase();
  if (TITLE_FIX[stripDiacritics(lower)]) {
    return TITLE_FIX[stripDiacritics(lower)];
  }
  if (lower.length <= 2 && /^[a-z]+$/i.test(lower)) {
    return lower.toUpperCase();
  }
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Derives a short agency-style label from a logo file name.
 * Example: `RISKE_IMOVEIS_logo.png` → `Riske Imóveis`.
 */
export function inferAgencyName(fileName: string | null | undefined): string {
  if (!fileName || !fileName.trim()) return 'Logo sem nome';

  let base = fileName.trim();
  const slash = Math.max(base.lastIndexOf('/'), base.lastIndexOf('\\'));
  if (slash >= 0) base = base.slice(slash + 1);

  base = base.replace(/\.[a-z0-9]{1,5}$/i, '');
  base = base.replace(/[_\-.]+/g, ' ');
  base = base.replace(/\s+/g, ' ').trim();
  if (!base) return 'Logo sem nome';

  const parts = base
    .split(' ')
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !DROP_TOKENS.has(stripDiacritics(p.toLowerCase())));

  const words = (parts.length > 0 ? parts : base.split(' ').filter(Boolean)).map(toTitleWord);
  const name = words.join(' ').trim();
  return name || 'Logo sem nome';
}

/** Case/accent-insensitive match for history filter. */
export function matchesHistoryQuery(
  query: string,
  displayName: string,
  sourceFileName: string | null
): boolean {
  const q = stripDiacritics(query.trim().toLowerCase());
  if (!q) return true;
  const hay = stripDiacritics(
    `${displayName} ${sourceFileName ?? ''}`.toLowerCase()
  );
  return hay.includes(q);
}