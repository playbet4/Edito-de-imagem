import type { EditHistoryEntry } from '../types/editHistory';
import { EDIT_HISTORY_MAX_ITEMS } from '../types/editHistory';

const DB_NAME = 'logo-processor-history';
const DB_VERSION = 1;
const STORE = 'sessions';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexeddb_open_failed'));
  });
}

function reqToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexeddb_request_failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('indexeddb_tx_failed'));
    tx.onabort = () => reject(tx.error ?? new Error('indexeddb_tx_aborted'));
  });
}

export function isQuotaExceededError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: string; message?: string };
  if (e.name === 'QuotaExceededError') return true;
  const msg = (e.message ?? '').toLowerCase();
  return msg.includes('quota') || msg.includes('storage');
}

export async function listHistoryEntries(): Promise<EditHistoryEntry[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const index = store.index('updatedAt');
    const rows = await reqToPromise(index.getAll());
    await txDone(tx);
    return (rows as EditHistoryEntry[]).slice().sort((a, b) => b.updatedAt - a.updatedAt);
  } finally {
    db.close();
  }
}

export async function getHistoryEntry(id: string): Promise<EditHistoryEntry | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const row = await reqToPromise(tx.objectStore(STORE).get(id));
    await txDone(tx);
    return (row as EditHistoryEntry | undefined) ?? null;
  } finally {
    db.close();
  }
}

export async function putHistoryEntry(entry: EditHistoryEntry): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.put(entry);

    const index = store.index('updatedAt');
    const all = await reqToPromise(index.getAll());
    const sorted = (all as EditHistoryEntry[]).slice().sort((a, b) => b.updatedAt - a.updatedAt);
    if (sorted.length > EDIT_HISTORY_MAX_ITEMS) {
      for (const stale of sorted.slice(EDIT_HISTORY_MAX_ITEMS)) {
        store.delete(stale.id);
      }
    }
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function renameHistoryEntry(id: string, displayName: string): Promise<void> {
  const existing = await getHistoryEntry(id);
  if (!existing) return;
  await putHistoryEntry({
    ...existing,
    displayName: displayName.trim() || existing.displayName,
    nameSource: 'user',
    updatedAt: Date.now(),
  });
}

type ThumbBackdrop = { fill: string; accent: string };

const DARK_BACKDROP: ThumbBackdrop = { fill: '#0b1220', accent: '#1e293b' };
const LIGHT_BACKDROP: ThumbBackdrop = { fill: '#f4f7f5', accent: '#e5ece8' };

/**
 * Samples opaque pixels: mostly white/pale → dark stage; otherwise light stage.
 * Uses a light-pixel ratio (not only averages) so thin white wordmarks are caught.
 */
function pickThumbnailBackdrop(data: Uint8ClampedArray): ThumbBackdrop {
  let lumSum = 0;
  let satSum = 0;
  let lightCount = 0;
  let count = 0;

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 28) continue;
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const sat = max === 0 ? 0 : (max - min) / max;
    const w = a / 255;
    lumSum += lum * w;
    satSum += sat * w;
    count += 1;
    // Near-white ink (typical of “tudo branco” / removed-bg logos)
    if (lum >= 0.78 && sat <= 0.35) lightCount += 1;
  }

  if (count < 6) return DARK_BACKDROP;

  const avgLum = lumSum / count;
  const avgSat = satSum / count;
  const lightRatio = lightCount / count;

  if (lightRatio >= 0.35 || (avgLum >= 0.62 && avgSat <= 0.32)) {
    return DARK_BACKDROP;
  }
  return LIGHT_BACKDROP;
}

/**
 * Builds a small PNG thumbnail from the ORIGINAL logo blob with an adaptive
 * backdrop (dark for white marks, light for colorful/dark marks).
 */
export async function createThumbnailBlob(imageBlob: Blob, maxEdge = 96): Promise<Blob> {
  const bitmap = await createImageBitmap(imageBlob);
  try {
    const pad = 8;
    const scale = Math.min(1, (maxEdge - pad * 2) / Math.max(bitmap.width, bitmap.height, 1));
    const drawW = Math.max(1, Math.round(bitmap.width * scale));
    const drawH = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = maxEdge;
    canvas.height = maxEdge;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return imageBlob.slice(0, imageBlob.size, imageBlob.type || 'image/png');
    }

    const probeCanvas = document.createElement('canvas');
    probeCanvas.width = drawW;
    probeCanvas.height = drawH;
    const probeCtx = probeCanvas.getContext('2d', { willReadFrequently: true });
    if (!probeCtx) {
      return imageBlob.slice(0, imageBlob.size, imageBlob.type || 'image/png');
    }
    probeCtx.clearRect(0, 0, drawW, drawH);
    probeCtx.drawImage(bitmap, 0, 0, drawW, drawH);
    const backdrop = pickThumbnailBackdrop(
      probeCtx.getImageData(0, 0, drawW, drawH).data
    );

    ctx.fillStyle = backdrop.fill;
    ctx.fillRect(0, 0, maxEdge, maxEdge);
    const cell = 6;
    ctx.fillStyle = backdrop.accent;
    for (let y = 0; y < maxEdge; y += cell) {
      for (let x = 0; x < maxEdge; x += cell) {
        if ((x / cell + y / cell) % 2 === 0) {
          ctx.fillRect(x, y, cell, cell);
        }
      }
    }

    const dx = Math.round((maxEdge - drawW) / 2);
    const dy = Math.round((maxEdge - drawH) / 2);
    ctx.drawImage(probeCanvas, dx, dy);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png')
    );
    return blob ?? imageBlob.slice(0, imageBlob.size, imageBlob.type || 'image/png');
  } finally {
    bitmap.close();
  }
}

/** Regenerates thumbnails for existing history rows (adaptive backdrop). */
export async function refreshAllHistoryThumbnails(): Promise<number> {
  const rows = await listHistoryEntries();
  let updated = 0;
  for (const row of rows) {
    try {
      const thumbnailBlob = await createThumbnailBlob(row.imageBlob);
      await putHistoryEntry({
        ...row,
        thumbnailBlob,
        updatedAt: Date.now(),
      });
      updated += 1;
    } catch {
      // Skip broken rows
    }
  }
  return updated;
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}