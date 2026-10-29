/**
 * [INPUT]: 浏览器本地存储（可选）与操作系统深色/减弱动态媒体查询。
 * [OUTPUT]: 响应式界面偏好（主题明暗、6 色强调色、减少动画、侧栏布局、表面风格含五层光学毛玻璃、背景氛围/艺术/自定义壁纸、毛玻璃磨砂浓度/面板透光度/壁纸暗化度无级滑块、正文/等宽字体栈、额度显示模式、隐私打码、界面缩放、启动默认页与一键主题预设）及 View Transitions 平滑切换辅助。
 * [POS]: 纯前端视图偏好层；不保存任何账号凭据或个人路径，存储不可用时安全回退默认值。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {useSyncExternalStore} from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';
export type AccentTone = 'terracotta' | 'cockpit' | 'emerald' | 'violet' | 'rose' | 'amber';
export type SidebarLayout = 'classic' | 'compact';
export type SurfaceStyle = 'cockpit' | 'glass' | 'hatched';
export type BackdropStyle = 'minimal' | 'aurora' | 'sunset' | 'ocean' | 'nebula' | 'dune' | 'fuji' | 'custom';
export type FontFamily = 'system' | 'modern' | 'humanist' | 'serif';
export type MonoFontFamily = 'cascadia' | 'jetbrains' | 'consolas';
export type QuotaDisplayMode = 'remaining' | 'used';
export type UiScale = 90 | 95 | 100 | 105 | 110;
export type StartupPage = 'remember' | 'quick' | 'cleaner' | 'usage' | 'browser' | 'system' | 'vps' | 'risk' | 'help' | 'settings';
export type ThemePresetId = 'parchment' | 'auroraGlass' | 'sunsetGlass' | 'nebulaDark' | 'duneGlass';

export const UI_SCALES: readonly UiScale[] = [90, 95, 100, 105, 110];
export const ACCENT_TONES: readonly AccentTone[] = ['terracotta', 'cockpit', 'emerald', 'violet', 'rose', 'amber'];
export const SURFACE_STYLES: readonly SurfaceStyle[] = ['cockpit', 'glass', 'hatched'];
export const BACKDROP_STYLES: readonly BackdropStyle[] = ['minimal', 'aurora', 'sunset', 'ocean', 'nebula', 'dune', 'fuji', 'custom'];
export const FONT_FAMILIES: readonly FontFamily[] = ['system', 'modern', 'humanist', 'serif'];
export const MONO_FONT_FAMILIES: readonly MonoFontFamily[] = ['cascadia', 'jetbrains', 'consolas'];
const STARTUP_PAGES: readonly StartupPage[] = ['remember', 'quick', 'cleaner', 'usage', 'browser', 'system', 'vps', 'risk', 'help', 'settings'];

export type UiPreferences = {
  theme: ThemeMode;
  accent: AccentTone;
  reduceMotion: boolean;
  sidebarLayout: SidebarLayout;
  surfaceStyle: SurfaceStyle;
  backdrop: BackdropStyle;
  glassBlur: number;
  glassOpacity: number;
  wallpaperDim: number;
  fontFamily: FontFamily;
  monoFont: MonoFontFamily;
  quotaDisplay: QuotaDisplayMode;
  privacyMask: boolean;
  uiScale: UiScale;
  startupPage: StartupPage;
};

export const THEME_PRESETS: Record<ThemePresetId, Pick<UiPreferences, 'theme' | 'accent' | 'surfaceStyle' | 'backdrop'>> = {
  parchment: {theme: 'light', accent: 'terracotta', surfaceStyle: 'cockpit', backdrop: 'minimal'},
  auroraGlass: {theme: 'light', accent: 'cockpit', surfaceStyle: 'glass', backdrop: 'aurora'},
  sunsetGlass: {theme: 'light', accent: 'terracotta', surfaceStyle: 'glass', backdrop: 'sunset'},
  duneGlass: {theme: 'light', accent: 'amber', surfaceStyle: 'glass', backdrop: 'dune'},
  nebulaDark: {theme: 'dark', accent: 'violet', surfaceStyle: 'glass', backdrop: 'nebula'},
};

const STORAGE_KEY = 'claude-local.preferences.v1';

export const defaultPreferences: UiPreferences = {
  theme: 'light',
  accent: 'terracotta',
  reduceMotion: false,
  sidebarLayout: 'classic',
  surfaceStyle: 'cockpit',
  backdrop: 'minimal',
  glassBlur: 22,
  glassOpacity: 72,
  wallpaperDim: 15,
  fontFamily: 'system',
  monoFont: 'cascadia',
  quotaDisplay: 'remaining',
  privacyMask: true,
  uiScale: 100,
  startupPage: 'remember',
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function sanitizePreferences(raw: unknown): UiPreferences {
  if (!raw || typeof raw !== 'object') return {...defaultPreferences};
  const input = raw as Record<string, unknown>;
  const theme: ThemeMode = input.theme === 'system' || input.theme === 'light' || input.theme === 'dark' ? input.theme : defaultPreferences.theme;
  const accent: AccentTone = typeof input.accent === 'string' && (ACCENT_TONES as readonly string[]).includes(input.accent) ? (input.accent as AccentTone) : defaultPreferences.accent;
  const sidebarLayout: SidebarLayout = input.sidebarLayout === 'classic' || input.sidebarLayout === 'compact' ? input.sidebarLayout : defaultPreferences.sidebarLayout;
  const surfaceStyle: SurfaceStyle = typeof input.surfaceStyle === 'string' && (SURFACE_STYLES as readonly string[]).includes(input.surfaceStyle) ? (input.surfaceStyle as SurfaceStyle) : defaultPreferences.surfaceStyle;
  const backdrop: BackdropStyle = typeof input.backdrop === 'string' && (BACKDROP_STYLES as readonly string[]).includes(input.backdrop) ? (input.backdrop as BackdropStyle) : defaultPreferences.backdrop;
  const glassBlur = clampInt(input.glassBlur, 8, 40, defaultPreferences.glassBlur);
  const glassOpacity = clampInt(input.glassOpacity, 45, 92, defaultPreferences.glassOpacity);
  const wallpaperDim = clampInt(input.wallpaperDim, 0, 65, defaultPreferences.wallpaperDim);
  const fontFamily: FontFamily = typeof input.fontFamily === 'string' && (FONT_FAMILIES as readonly string[]).includes(input.fontFamily) ? (input.fontFamily as FontFamily) : defaultPreferences.fontFamily;
  const monoFont: MonoFontFamily = typeof input.monoFont === 'string' && (MONO_FONT_FAMILIES as readonly string[]).includes(input.monoFont) ? (input.monoFont as MonoFontFamily) : defaultPreferences.monoFont;
  const quotaDisplay: QuotaDisplayMode = input.quotaDisplay === 'remaining' || input.quotaDisplay === 'used' ? input.quotaDisplay : defaultPreferences.quotaDisplay;
  const uiScale: UiScale = typeof input.uiScale === 'number' && (UI_SCALES as readonly number[]).includes(input.uiScale) ? (input.uiScale as UiScale) : defaultPreferences.uiScale;
  const startupPage: StartupPage = typeof input.startupPage === 'string' && (STARTUP_PAGES as readonly string[]).includes(input.startupPage) ? (input.startupPage as StartupPage) : defaultPreferences.startupPage;
  return {
    theme,
    accent,
    reduceMotion: typeof input.reduceMotion === 'boolean' ? input.reduceMotion : defaultPreferences.reduceMotion,
    sidebarLayout,
    surfaceStyle,
    backdrop,
    glassBlur,
    glassOpacity,
    wallpaperDim,
    fontFamily,
    monoFont,
    quotaDisplay,
    privacyMask: typeof input.privacyMask === 'boolean' ? input.privacyMask : defaultPreferences.privacyMask,
    uiScale,
    startupPage,
  };
}

function loadPreferences(): UiPreferences {
  if (typeof window === 'undefined') return {...defaultPreferences};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {...defaultPreferences};
    return sanitizePreferences(JSON.parse(raw));
  } catch {
    return {...defaultPreferences};
  }
}

const initialPreferences = loadPreferences();
const legacyPrivacyMask = initialPreferences.privacyMask;
const hasNativePrivacy = () => typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
const hasNativeAppearanceHost = () =>
  typeof window !== 'undefined' &&
  Boolean(
    (window as Window & {__TAURI_INTERNALS__?: {metadata?: unknown; enableAppearanceSync?: boolean}}).__TAURI_INTERNALS__?.metadata ||
      (window as Window & {__TAURI_INTERNALS__?: {enableAppearanceSync?: boolean}}).__TAURI_INTERNALS__?.enableAppearanceSync,
  );
let currentPreferences: UiPreferences = {...initialPreferences, privacyMask: hasNativePrivacy() ? true : initialPreferences.privacyMask};
let privacyRevision = 0;
let privacyQueue: Promise<void> = Promise.resolve();
let privacyInitialization: Promise<boolean> | undefined;
let privacyError: string | null = null;
let appearanceQueue: Promise<void> = Promise.resolve();
let appearanceInitialization: Promise<UiPreferences> | undefined;
const listeners = new Set<() => void>();
const darkMedia = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function toAppearanceDto(prefs: UiPreferences): Omit<UiPreferences, 'privacyMask'> {
  const {privacyMask: _ignored, ...dto} = prefs;
  return dto;
}

function persistAppearanceToRust(prefs: UiPreferences): void {
  if (!hasNativeAppearanceHost()) return;
  const dto = toAppearanceDto(prefs);
  appearanceQueue = appearanceQueue.then(async () => {
    try {
      const {invoke} = await import('@tauri-apps/api/core');
      await invoke('ui_appearance_write', {prefs: dto});
    } catch {
      // Keep localStorage / in-memory preferences if native write is unavailable.
    }
  });
}

export function applyPreferencesToDom(prefs: UiPreferences = currentPreferences): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const isDark = prefs.theme === 'dark' || (prefs.theme === 'system' && (darkMedia?.matches ?? false));
  root.classList.toggle('dark', isDark);
  root.style.colorScheme = isDark ? 'dark' : 'light';
  root.setAttribute('data-theme-mode', prefs.theme);
  root.setAttribute('data-accent', prefs.accent);
  root.setAttribute('data-sidebar', prefs.sidebarLayout);
  root.setAttribute('data-surface', prefs.surfaceStyle);
  root.setAttribute('data-backdrop', prefs.backdrop);
  root.setAttribute('data-font', prefs.fontFamily);
  root.setAttribute('data-mono-font', prefs.monoFont);
  root.setAttribute('data-reduce-motion', prefs.reduceMotion ? 'true' : 'false');
  root.setAttribute('data-ui-scale', String(prefs.uiScale));
  root.style.setProperty('--glass-blur', `${prefs.glassBlur}px`);
  root.style.setProperty('--glass-opacity', `${prefs.glassOpacity}%`);
  root.style.setProperty('--wallpaper-dim', `${prefs.wallpaperDim}%`);
  root.style.zoom = prefs.uiScale === 100 ? '' : `${prefs.uiScale}%`;
}

export function startSmoothTransition(work: () => void): void {
  if (
    typeof document === 'undefined' ||
    currentPreferences.reduceMotion ||
    (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) ||
    typeof (document as Document & {startViewTransition?: (cb: () => void) => unknown}).startViewTransition !== 'function'
  ) {
    work();
    return;
  }
  try {
    (document as Document & {startViewTransition: (cb: () => void) => unknown}).startViewTransition(() => {
      work();
    });
  } catch {
    work();
  }
}

export function applyThemePreset(presetId: ThemePresetId): UiPreferences {
  const preset = THEME_PRESETS[presetId];
  if (!preset) return currentPreferences;
  return updatePreferences(preset);
}

export function reloadPreferencesFromStorage(): UiPreferences {
  const loaded = loadPreferences();
  currentPreferences = loaded;
  applyPreferencesToDom(currentPreferences);
  listeners.forEach(listener => listener());
  return currentPreferences;
}

if (typeof document !== 'undefined') {
  applyPreferencesToDom(currentPreferences);
  darkMedia?.addEventListener('change', () => {
    if (currentPreferences.theme === 'system') {
      applyPreferencesToDom(currentPreferences);
      listeners.forEach(listener => listener());
    }
  });
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', event => {
      if (!event.key || event.key === STORAGE_KEY) {
        reloadPreferencesFromStorage();
      }
    });
  }
}

export function getPreferences(): UiPreferences {
  return currentPreferences;
}

function publishPreferences(next: UiPreferences): void {
  currentPreferences = sanitizePreferences(next);
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(currentPreferences)); } catch { /* Keep the in-memory view. */ }
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
  applyPreferencesToDom(currentPreferences);
  listeners.forEach(listener => listener());
}

export function synchronizePrivacyPreference(masked: boolean): Promise<boolean> {
  const revision = ++privacyRevision;
  privacyError = null;
  if (!hasNativePrivacy()) {
    publishPreferences({...currentPreferences, privacyMask: masked});
    return Promise.resolve(masked);
  }
  // Enabling hides immediately; disabling waits for persistence. Writes are serialized.
  publishPreferences({...currentPreferences, privacyMask: masked || currentPreferences.privacyMask});
  privacyQueue = privacyQueue.then(async () => {
    try {
      const {invoke} = await import('@tauri-apps/api/core');
      await invoke('ui_privacy_write', {masked});
      if (revision === privacyRevision) {
        privacyError = null;
        publishPreferences({...currentPreferences, privacyMask: masked});
      }
    } catch {
      if (revision === privacyRevision) {
        privacyError = 'privacy.saveFailed';
        publishPreferences({...currentPreferences, privacyMask: true});
      }
    }
  });
  return privacyQueue.then(() => currentPreferences.privacyMask);
}

export function updatePreferences(patch: Partial<UiPreferences>): UiPreferences {
  if (hasNativePrivacy() && typeof patch.privacyMask === 'boolean') {
    const {privacyMask, ...viewPatch} = patch;
    publishPreferences({...currentPreferences, ...viewPatch});
    if (Object.keys(viewPatch).length > 0) {
      persistAppearanceToRust(currentPreferences);
    }
    void synchronizePrivacyPreference(privacyMask);
  } else {
    publishPreferences({...currentPreferences, ...patch});
    persistAppearanceToRust(currentPreferences);
  }
  return currentPreferences;
}

export function resetPreferences(): UiPreferences {
  // Resetting appearance never silently disables the native privacy preference.
  publishPreferences({...defaultPreferences, privacyMask: hasNativePrivacy() ? currentPreferences.privacyMask : defaultPreferences.privacyMask});
  persistAppearanceToRust(currentPreferences);
  return currentPreferences;
}

export function stepUiScale(direction: 'in' | 'out' | 'reset'): UiPreferences {
  if (direction === 'reset') return updatePreferences({uiScale: 100});
  const index = UI_SCALES.indexOf(currentPreferences.uiScale);
  const currentIdx = index >= 0 ? index : UI_SCALES.indexOf(100);
  const nextIdx = direction === 'in' ? Math.min(UI_SCALES.length - 1, currentIdx + 1) : Math.max(0, currentIdx - 1);
  return updatePreferences({uiScale: UI_SCALES[nextIdx]});
}

export function usePrivacySyncError(): string | null {
  return useSyncExternalStore(subscribe, () => privacyError, () => null);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePreferences(): UiPreferences {
  return useSyncExternalStore(subscribe, getPreferences, () => defaultPreferences);
}

export function maskEmailAddress(email: string | null | undefined, mask: boolean): string {
  if (!email) return '';
  if (!mask) return email;
  const atIndex = email.indexOf('@');
  if (atIndex < 0) return '***';
  if (atIndex === 0) return "***" + email;
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex);
  if (local.length <= 1) {
    return "*" + domain;
  }
  const visible = local.slice(0, Math.min(3, Math.max(1, Math.floor(local.length / 2))));
  return visible + "***" + domain;
}

export function maskDisplayName(name: string | null | undefined, email: string | null | undefined, mask: boolean): string {
  if (!name) return email ? maskEmailAddress(email, mask) : "";
  if (!mask) return name;
  if (name.includes("@")) return maskEmailAddress(name, true);
  if (email) {
    const at = email.indexOf("@");
    const local = at > 0 ? email.slice(0, at) : email;
    if (name.toLowerCase() === local.toLowerCase()) {
      return maskEmailAddress(email, true);
    }
  }
  return name;
}

export function initializePrivacyPreference(): Promise<boolean> {
  if (!hasNativePrivacy()) return Promise.resolve(currentPreferences.privacyMask);
  if (privacyInitialization) return privacyInitialization;
  const revision = privacyRevision;
  publishPreferences({...currentPreferences, privacyMask: true});
  privacyQueue = privacyQueue.then(async () => {
    try {
      const {invoke} = await import('@tauri-apps/api/core');
      const native = await invoke<boolean | null>('ui_privacy_read');
      if (revision !== privacyRevision) return;
      if (native !== null && typeof native !== 'boolean') throw new Error('Invalid privacy preference');
      const masked = native === null ? legacyPrivacyMask : native;
      if (native === null) await invoke('ui_privacy_write', {masked});
      if (revision === privacyRevision) {
        privacyError = null;
        publishPreferences({...currentPreferences, privacyMask: masked});
      }
    } catch {
      if (revision === privacyRevision) {
        privacyError = 'privacy.saveFailed';
        publishPreferences({...currentPreferences, privacyMask: true});
      }
    }
  });
  privacyInitialization = privacyQueue.then(() => currentPreferences.privacyMask);
  return privacyInitialization;
}

export function initializeAppearancePreferences(): Promise<UiPreferences> {
  if (!hasNativeAppearanceHost()) return Promise.resolve(currentPreferences);
  if (appearanceInitialization) return appearanceInitialization;
  appearanceQueue = appearanceQueue.then(async () => {
    try {
      const {invoke} = await import('@tauri-apps/api/core');
      const native = await invoke<Partial<UiPreferences> | null>('ui_appearance_read');
      if (native && typeof native === 'object') {
        publishPreferences({
          ...currentPreferences,
          ...native,
          privacyMask: currentPreferences.privacyMask,
        });
      } else {
        await invoke('ui_appearance_write', {prefs: toAppearanceDto(currentPreferences)});
      }
    } catch {
      // Keep localStorage / in-memory preferences if native read is unavailable.
    }
  });
  appearanceInitialization = appearanceQueue.then(() => currentPreferences);
  return appearanceInitialization;
}
