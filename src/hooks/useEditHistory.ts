import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createThumbnailBlob,
  dataUrlToBlob,
  deleteHistoryEntry,
  getHistoryEntry,
  isQuotaExceededError,
  listHistoryEntries,
  putHistoryEntry,
  refreshAllHistoryThumbnails,
  renameHistoryEntry,
} from '../lib/historyDb';
import { inferAgencyName, matchesHistoryQuery } from '../lib/inferAgencyName';
import { inferAgencyNameFromImage } from '../lib/ocrAgencyName';
import type {
  EditHistoryEntry,
  EditHistoryListItem,
  EditHistorySettings,
} from '../types/editHistory';

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `hist_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function revokeAll(urls: Map<string, string>) {
  for (const url of urls.values()) {
    URL.revokeObjectURL(url);
  }
  urls.clear();
}

export interface UseEditHistoryResult {
  items: EditHistoryListItem[];
  filterQuery: string;
  setFilterQuery: (q: string) => void;
  filteredItems: EditHistoryListItem[];
  currentHistoryId: string | null;
  isLoadingList: boolean;
  isRestoring: boolean;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  beginSessionFromFile: (file: File, settings: EditHistorySettings) => Promise<string | null>;
  upsertActiveSession: (
    imageSrc: string,
    settings: EditHistorySettings,
    meta?: { sourceFileName?: string | null; displayName?: string }
  ) => Promise<void>;
  restoreEntry: (id: string) => Promise<{
    imageUrl: string;
    entry: EditHistoryEntry;
  } | null>;
  removeEntry: (id: string) => Promise<void>;
  renameEntry: (id: string, displayName: string) => Promise<void>;
  setCurrentHistoryId: (id: string | null) => void;
}

export function useEditHistory(): UseEditHistoryResult {
  const [items, setItems] = useState<EditHistoryListItem[]>([]);
  const [filterQuery, setFilterQuery] = useState('');
  const [currentHistoryId, setCurrentHistoryId] = useState<string | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isRestoring, setIsRestoring] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const thumbUrlsRef = useRef(new Map<string, string>());

  const refreshList = useCallback(async () => {
    try {
      const rows = await listHistoryEntries();
      const nextUrls = new Map<string, string>();
      const list: EditHistoryListItem[] = rows.map((row) => {
        // Bust thumbnail URL when the blob changes (e.g. after OCR rename refresh)
        const cacheKey = `${row.id}:${row.updatedAt}`;
        const prevKey = [...thumbUrlsRef.current.keys()].find((k) => k.startsWith(`${row.id}:`));
        let url = prevKey ? thumbUrlsRef.current.get(prevKey) : undefined;
        if (!url || !prevKey || prevKey !== cacheKey) {
          if (prevKey) {
            const old = thumbUrlsRef.current.get(prevKey);
            if (old) URL.revokeObjectURL(old);
            thumbUrlsRef.current.delete(prevKey);
          }
          url = URL.createObjectURL(row.thumbnailBlob);
        }
        nextUrls.set(cacheKey, url);
        return {
          id: row.id,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          displayName: row.displayName,
          sourceFileName: row.sourceFileName,
          thumbnailUrl: url,
        };
      });
      for (const [key, url] of thumbUrlsRef.current) {
        if (!nextUrls.has(key)) URL.revokeObjectURL(url);
      }
      thumbUrlsRef.current = nextUrls;
      setItems(list);
    } catch {
      setItems([]);
    } finally {
      setIsLoadingList(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await refreshList();
      // Migrate once per browser: older thumbs may still use a light panel on white logos
      const migrateKey = 'logo-history-thumb-v2';
      try {
        if (localStorage.getItem(migrateKey) !== '1') {
          await refreshAllHistoryThumbnails();
          localStorage.setItem(migrateKey, '1');
          if (!cancelled) await refreshList();
        }
      } catch {
        // Ignore migrate / private-mode errors
      }
    })();
    return () => {
      cancelled = true;
      revokeAll(thumbUrlsRef.current);
    };
  }, [refreshList]);

  const filteredItems = useMemo(
    () =>
      items.filter((item) =>
        matchesHistoryQuery(filterQuery, item.displayName, item.sourceFileName)
      ),
    [items, filterQuery]
  );

  const applyOcrName = useCallback(
    async (id: string, imageBlob: Blob) => {
      const ocrName = await inferAgencyNameFromImage(imageBlob);
      if (!ocrName) return;
      const existing = await getHistoryEntry(id);
      if (!existing) return;
      // Never overwrite a manual rename
      if (existing.nameSource === 'user') return;
      if (existing.displayName === ocrName) return;
      await putHistoryEntry({
        ...existing,
        displayName: ocrName,
        nameSource: 'ocr',
        updatedAt: Date.now(),
      });
      await refreshList();
    },
    [refreshList]
  );

  const beginSessionFromFile = useCallback(
    async (file: File, settings: EditHistorySettings): Promise<string | null> => {
      try {
        const imageBlob = file.slice(0, file.size, file.type || 'image/png');
        const thumbnailBlob = await createThumbnailBlob(imageBlob);
        const now = Date.now();
        const id = newId();
        const entry: EditHistoryEntry = {
          id,
          createdAt: now,
          updatedAt: now,
          displayName: inferAgencyName(file.name),
          nameSource: 'file',
          sourceFileName: file.name,
          imageBlob,
          thumbnailBlob,
          settings,
        };
        await putHistoryEntry(entry);
        setCurrentHistoryId(id);
        await refreshList();
        // OCR in background — updates label when text is found on the logo
        void applyOcrName(id, imageBlob);
        return id;
      } catch (error) {
        if (isQuotaExceededError(error)) {
          throw new Error('quota');
        }
        throw error;
      }
    },
    [applyOcrName, refreshList]
  );

  const upsertActiveSession = useCallback(
    async (
      imageSrc: string,
      settings: EditHistorySettings,
      meta?: { sourceFileName?: string | null; displayName?: string }
    ) => {
      if (!imageSrc) return;
      try {
        const now = Date.now();
        const existingId = currentHistoryId;
        const existing = existingId ? await getHistoryEntry(existingId) : null;

        // Keep the ORIGINAL artwork blob/thumbnail; only refresh settings on upsert.
        // Replacing imageBlob from imageSrc is fine when creating a brand-new row.
        if (existing) {
          await putHistoryEntry({
            ...existing,
            updatedAt: now,
            displayName: meta?.displayName?.trim() || existing.displayName,
            nameSource: meta?.displayName?.trim()
              ? 'user'
              : existing.nameSource ?? 'file',
            sourceFileName:
              meta?.sourceFileName !== undefined
                ? meta.sourceFileName
                : existing.sourceFileName,
            settings,
          });
          await refreshList();
          return;
        }

        const imageBlob = await dataUrlToBlob(imageSrc);
        const thumbnailBlob = await createThumbnailBlob(imageBlob);
        const entry: EditHistoryEntry = {
          id: newId(),
          createdAt: now,
          updatedAt: now,
          displayName:
            meta?.displayName?.trim() ||
            inferAgencyName(meta?.sourceFileName ?? null),
          nameSource: meta?.displayName?.trim() ? 'user' : 'file',
          sourceFileName: meta?.sourceFileName ?? null,
          imageBlob,
          thumbnailBlob,
          settings,
        };
        await putHistoryEntry(entry);
        setCurrentHistoryId(entry.id);
        await refreshList();
        void applyOcrName(entry.id, imageBlob);
      } catch (error) {
        if (isQuotaExceededError(error)) {
          throw new Error('quota');
        }
        throw error;
      }
    },
    [applyOcrName, currentHistoryId, refreshList]
  );

  const restoreEntry = useCallback(async (id: string) => {
    setIsRestoring(true);
    try {
      const entry = await getHistoryEntry(id);
      if (!entry) return null;
      // Refresh thumbnail with adaptive backdrop (cheap; helps older history rows)
      try {
        const thumbnailBlob = await createThumbnailBlob(entry.imageBlob);
        await putHistoryEntry({
          ...entry,
          thumbnailBlob,
          updatedAt: Date.now(),
        });
        await refreshList();
      } catch {
        // Keep previous thumb if regenerate fails
      }
      const imageUrl = URL.createObjectURL(entry.imageBlob);
      setCurrentHistoryId(entry.id);
      return { imageUrl, entry };
    } finally {
      setIsRestoring(false);
    }
  }, [refreshList]);

  const removeEntry = useCallback(
    async (id: string) => {
      await deleteHistoryEntry(id);
      if (currentHistoryId === id) setCurrentHistoryId(null);
      for (const [key, url] of [...thumbUrlsRef.current.entries()]) {
        if (key.startsWith(`${id}:`)) {
          URL.revokeObjectURL(url);
          thumbUrlsRef.current.delete(key);
        }
      }
      await refreshList();
    },
    [currentHistoryId, refreshList]
  );

  const renameEntry = useCallback(
    async (id: string, displayName: string) => {
      await renameHistoryEntry(id, displayName);
      await refreshList();
    },
    [refreshList]
  );

  return {
    items,
    filterQuery,
    setFilterQuery,
    filteredItems,
    currentHistoryId,
    isLoadingList,
    isRestoring,
    collapsed,
    setCollapsed,
    beginSessionFromFile,
    upsertActiveSession,
    restoreEntry,
    removeEntry,
    renameEntry,
    setCurrentHistoryId,
  };
}