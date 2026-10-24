/**
 * [INPUT]: 用户在本地文件选择器中挑选的壁纸图片（Blob / File）与浏览器 localStorage。
 * [OUTPUT]: 经过 Canvas 降采样压缩的 WebP/JPEG Data URI 壁纸存储、主色调智能提取（映射至 6 套 AccentTone）及 DOM CSS 变量同步。
 * [POS]: 纯前端本地自定义壁纸引擎；严格遵循 AGENTS.md 隐私边界，绝不记录或上传任何本地文件路径与文件名。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {useSyncExternalStore} from 'react';
import {ACCENT_TONES, type AccentTone} from './settings-model';

export type CustomWallpaperRecord = {
  dataUrl: string;
  suggestedAccent: AccentTone;
  width: number;
  height: number;
  updatedAt: number;
};

const WALLPAPER_STORAGE_KEY = 'claude-local.custom-wallpaper.v1';
const MAX_DATA_URL_LENGTH = 2_600_000;

const ACCENT_ANCHORS: ReadonlyArray<{tone: AccentTone; r: number; g: number; b: number}> = [
  {tone: 'terracotta', r: 201, g: 100, b: 66},
  {tone: 'cockpit', r: 37, g: 99, b: 235},
  {tone: 'emerald', r: 5, g: 150, b: 105},
  {tone: 'violet', r: 124, g: 58, b: 237},
  {tone: 'rose', r: 225, g: 29, b: 72},
  {tone: 'amber', r: 217, g: 119, b: 6},
];

/**
 * Maps an RGB color (0..255) to the closest AccentTone using perceptual redmean color distance.
 */
export function rgbToSuggestedAccent(r: number, g: number, b: number): AccentTone {
  const cr = Math.max(0, Math.min(255, Math.round(r)));
  const cg = Math.max(0, Math.min(255, Math.round(g)));
  const cb = Math.max(0, Math.min(255, Math.round(b)));

  let bestTone: AccentTone = 'terracotta';
  let bestDist = Number.POSITIVE_INFINITY;

  for (const anchor of ACCENT_ANCHORS) {
    const rmean = (cr + anchor.r) / 2;
    const dr = cr - anchor.r;
    const dg = cg - anchor.g;
    const db = cb - anchor.b;
    const dist =
      (2 + rmean / 256) * dr * dr +
      4 * dg * dg +
      (2 + (255 - rmean) / 256) * db * db;
    if (dist < bestDist) {
      bestDist = dist;
      bestTone = anchor.tone;
    }
  }
  return bestTone;
}

/**
 * Extracts a dominant vibrant accent tone from an RGBA pixel buffer ([R, G, B, A, ...]).
 * Pixels with higher saturation and balanced luminance receive higher weight so background greys do not dominate.
 */
export function sampleRgbaBufferForAccent(pixels: ArrayLike<number>): AccentTone {
  if (!pixels || pixels.length < 4) return 'terracotta';
  let weightedR = 0;
  let weightedG = 0;
  let weightedB = 0;
  let totalWeight = 0;

  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const a = pixels[i + 3];
    if (a < 64) continue;
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    const lum = (max + min) / 510;
    const sat = max === 0 ? 0 : delta / max;
    // Favor saturated mid-tone pixels; keep a small baseline weight so monochrome wallpapers still resolve deterministically.
    const lumWeight = 1 - Math.min(1, Math.abs(lum - 0.52) * 1.65);
    const weight = 0.05 + sat * sat * 3.5 + Math.max(0, lumWeight) * 0.4;
    weightedR += r * weight;
    weightedG += g * weight;
    weightedB += b * weight;
    totalWeight += weight;
  }

  if (totalWeight <= 0) return 'terracotta';
  return rgbToSuggestedAccent(weightedR / totalWeight, weightedG / totalWeight, weightedB / totalWeight);
}

function sanitizeWallpaperRecord(raw: unknown): CustomWallpaperRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Record<string, unknown>;
  if (typeof input.dataUrl !== 'string' || !input.dataUrl.startsWith('data:image/') || input.dataUrl.length > MAX_DATA_URL_LENGTH) {
    return null;
  }
  const suggestedAccent: AccentTone =
    typeof input.suggestedAccent === 'string' && (ACCENT_TONES as readonly string[]).includes(input.suggestedAccent)
      ? (input.suggestedAccent as AccentTone)
      : 'terracotta';
  const width = typeof input.width === 'number' && Number.isFinite(input.width) && input.width > 0 ? Math.round(input.width) : 1920;
  const height = typeof input.height === 'number' && Number.isFinite(input.height) && input.height > 0 ? Math.round(input.height) : 1080;
  const updatedAt = typeof input.updatedAt === 'number' && Number.isFinite(input.updatedAt) ? input.updatedAt : Date.now();
  return {dataUrl: input.dataUrl, suggestedAccent, width, height, updatedAt};
}

function loadCustomWallpaper(): CustomWallpaperRecord | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(WALLPAPER_STORAGE_KEY);
    if (!raw) return null;
    return sanitizeWallpaperRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

const hasNativeWallpaperHost = () =>
  typeof window !== 'undefined' &&
  Boolean(
    (window as Window & {__TAURI_INTERNALS__?: {metadata?: unknown; enableAppearanceSync?: boolean}}).__TAURI_INTERNALS__?.metadata ||
      (window as Window & {__TAURI_INTERNALS__?: {enableAppearanceSync?: boolean}}).__TAURI_INTERNALS__?.enableAppearanceSync,
  );
let currentWallpaper: CustomWallpaperRecord | null = loadCustomWallpaper();
let wallpaperQueue: Promise<void> = Promise.resolve();
let wallpaperInitialization: Promise<CustomWallpaperRecord | null> | undefined;
const listeners = new Set<() => void>();

export function syncCustomWallpaperToDom(record: CustomWallpaperRecord | null = currentWallpaper): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (record?.dataUrl) {
    root.style.setProperty('--custom-wallpaper-image', `url("${record.dataUrl}")`);
    root.setAttribute('data-has-custom-wallpaper', 'true');
  } else {
    root.style.removeProperty('--custom-wallpaper-image');
    root.setAttribute('data-has-custom-wallpaper', 'false');
  }
}

export function reloadCustomWallpaperFromStorage(): CustomWallpaperRecord | null {
  currentWallpaper = loadCustomWallpaper();
  syncCustomWallpaperToDom(currentWallpaper);
  listeners.forEach(listener => listener());
  return currentWallpaper;
}

if (typeof document !== 'undefined') {
  syncCustomWallpaperToDom(currentWallpaper);
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', event => {
      if (!event.key || event.key === WALLPAPER_STORAGE_KEY) {
        reloadCustomWallpaperFromStorage();
      }
    });
  }
}

export function getCustomWallpaper(): CustomWallpaperRecord | null {
  return currentWallpaper;
}

export function setCustomWallpaper(record: CustomWallpaperRecord): CustomWallpaperRecord {
  const sanitized = sanitizeWallpaperRecord(record);
  if (!sanitized) {
    throw new Error('settings.wallpaperInvalid');
  }
  currentWallpaper = sanitized;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(WALLPAPER_STORAGE_KEY, JSON.stringify(sanitized));
    } catch {
      // Keep in-memory wallpaper even if localStorage quota is tight.
    }
  }
  if (hasNativeWallpaperHost()) {
    wallpaperQueue = wallpaperQueue.then(async () => {
      try {
        const {invoke} = await import('@tauri-apps/api/core');
        await invoke('ui_wallpaper_write', {wallpaper: sanitized});
      } catch {
        // Keep in-memory wallpaper if native write is unavailable.
      }
    });
  }
  syncCustomWallpaperToDom(currentWallpaper);
  listeners.forEach(listener => listener());
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const ch = new BroadcastChannel('claude-local:monitor-bus');
      ch.postMessage({type: 'appearance-updated'});
      ch.close();
    } catch {
      // Ignore
    }
  }
  return sanitized;
}

export function clearCustomWallpaper(): void {
  currentWallpaper = null;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(WALLPAPER_STORAGE_KEY);
    } catch {
      // Ignore storage removal errors.
    }
  }
  if (hasNativeWallpaperHost()) {
    wallpaperQueue = wallpaperQueue.then(async () => {
      try {
        const {invoke} = await import('@tauri-apps/api/core');
        await invoke('ui_wallpaper_clear');
      } catch {
        // Ignore native removal errors.
      }
    });
  }
  syncCustomWallpaperToDom(null);
  listeners.forEach(listener => listener());
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const ch = new BroadcastChannel('claude-local:monitor-bus');
      ch.postMessage({type: 'appearance-updated'});
      ch.close();
    } catch {
      // Ignore
    }
  }
}

export function initializeCustomWallpaper(): Promise<CustomWallpaperRecord | null> {
  if (!hasNativeWallpaperHost()) return Promise.resolve(currentWallpaper);
  if (wallpaperInitialization) return wallpaperInitialization;
  wallpaperQueue = wallpaperQueue.then(async () => {
    try {
      const {invoke} = await import('@tauri-apps/api/core');
      const native = await invoke<CustomWallpaperRecord | null>('ui_wallpaper_read');
      const sanitized = sanitizeWallpaperRecord(native);
      if (sanitized) {
        currentWallpaper = sanitized;
        try {
          window.localStorage.setItem(WALLPAPER_STORAGE_KEY, JSON.stringify(sanitized));
        } catch {
          // Ignore storage quota.
        }
        syncCustomWallpaperToDom(currentWallpaper);
        listeners.forEach(listener => listener());
      } else if (currentWallpaper) {
        await invoke('ui_wallpaper_write', {wallpaper: currentWallpaper});
      }
    } catch {
      // Keep localStorage / in-memory wallpaper if native read is unavailable.
    }
  });
  wallpaperInitialization = wallpaperQueue.then(() => currentWallpaper);
  return wallpaperInitialization;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCustomWallpaper(): CustomWallpaperRecord | null {
  return useSyncExternalStore(subscribe, getCustomWallpaper, () => null);
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('settings.wallpaperReadFailed'));
      }
    };
    reader.onerror = () => reject(new Error('settings.wallpaperReadFailed'));
    reader.readAsDataURL(blob);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('settings.wallpaperReadFailed'));
    img.src = src;
  });
}

/**
 * Downsamples & compresses a local image Blob/File in-memory via HTMLCanvasElement (max 1920x1080, WebP/JPEG),
 * extracts its dominant AccentTone, and saves the sanitized record without keeping any file path or filename.
 */
export async function processWallpaperFile(file: Blob, maxWidth = 1920, maxHeight = 1080): Promise<CustomWallpaperRecord> {
  if (!file || file.size <= 0) {
    throw new Error('settings.wallpaperInvalid');
  }
  const rawDataUrl = await readBlobAsDataUrl(file);
  if (!rawDataUrl.startsWith('data:image/')) {
    throw new Error('settings.wallpaperInvalid');
  }

  const img = await loadImageElement(rawDataUrl);
  const naturalW = img.naturalWidth || img.width || 1920;
  const naturalH = img.naturalHeight || img.height || 1080;
  const scale = Math.min(1, maxWidth / naturalW, maxHeight / naturalH);
  const targetW = Math.max(1, Math.round(naturalW * scale));
  const targetH = Math.max(1, Math.round(naturalH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return setCustomWallpaper({
      dataUrl: rawDataUrl,
      suggestedAccent: 'terracotta',
      width: targetW,
      height: targetH,
      updatedAt: Date.now(),
    });
  }

  ctx.drawImage(img, 0, 0, targetW, targetH);

  // Sample a 24x24 downscaled grid for dominant accent extraction
  let suggestedAccent: AccentTone = 'terracotta';
  try {
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = 24;
    sampleCanvas.height = 24;
    const sampleCtx = sampleCanvas.getContext('2d');
    if (sampleCtx) {
      sampleCtx.drawImage(canvas, 0, 0, 24, 24);
      const imageData = sampleCtx.getImageData(0, 0, 24, 24);
      suggestedAccent = sampleRgbaBufferForAccent(imageData.data);
    }
  } catch {
    suggestedAccent = 'terracotta';
  }

  let outputDataUrl = canvas.toDataURL('image/webp', 0.84);
  if (!outputDataUrl.startsWith('data:image/webp') || outputDataUrl.length > MAX_DATA_URL_LENGTH) {
    outputDataUrl = canvas.toDataURL('image/jpeg', 0.8);
  }
  if (outputDataUrl.length > MAX_DATA_URL_LENGTH) {
    outputDataUrl = canvas.toDataURL('image/jpeg', 0.65);
  }

  return setCustomWallpaper({
    dataUrl: outputDataUrl,
    suggestedAccent,
    width: targetW,
    height: targetH,
    updatedAt: Date.now(),
  });
}
