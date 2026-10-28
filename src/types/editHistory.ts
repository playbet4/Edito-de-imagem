import type {
  ContentBounds,
  OutputFormat,
  WatermarkColorMode,
  WatermarkPosition,
  WatermarkSize,
} from './imagePipeline';

/** Snapshot of editor controls restored with a history entry. */
export interface EditHistorySettings {
  removeBackground: boolean;
  tolerance: number;
  padding: number;
  roundedCorners: boolean;
  cornerRadiusPercent: number;
  interactiveCropBounds: ContentBounds | null;
  watermarkEnabled: boolean;
  watermarkColorMode: WatermarkColorMode;
  watermarkOpacityPercent: number;
  liquidGlassOpacityPercent: number;
  selectedFormat: OutputFormat;
  upscaleMultiplier: number;
  watermarkPosition: WatermarkPosition;
  watermarkSize: WatermarkSize;
  previewBackgroundOverride: 'light' | 'dark' | null;
  /** When true, restore the custom client message below. */
  watermarkClientMessageDirty: boolean;
  watermarkClientMessage: string | null;
}

export type EditHistoryNameSource = 'file' | 'ocr' | 'user';

export interface EditHistoryEntry {
  id: string;
  createdAt: number;
  updatedAt: number;
  displayName: string;
  /** How displayName was set — user renames are never overwritten by OCR. */
  nameSource?: EditHistoryNameSource;
  sourceFileName: string | null;
  /** Original uploaded logo (before watermark / export look). */
  imageBlob: Blob;
  thumbnailBlob: Blob;
  settings: EditHistorySettings;
}

/** Lightweight row for the sidebar list (no full image blob). */
export interface EditHistoryListItem {
  id: string;
  createdAt: number;
  updatedAt: number;
  displayName: string;
  sourceFileName: string | null;
  thumbnailUrl: string;
}

export const EDIT_HISTORY_MAX_ITEMS = 40;