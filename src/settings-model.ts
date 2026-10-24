/**
 * [INPUT]: 浏览器本地存储（可选）与操作系统深色/减弱动态媒体查询。
 * [OUTPUT]: 响应式界面偏好（主题明暗、强调色、减少动画、侧栏布局、表面纹理、额度显示模式、隐私打码、界面缩放与启动默认页）；只保留确有界面消费者的选项，旧版无效键在读取时丢弃。
 * [POS]: 纯前端视图偏好层；不保存任何账号凭据或个人路径，存储不可用时安全回退默认值。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {useSyncExternalStore} from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';
export type AccentTone = 'terracotta' | 'cockpit' | 'emerald' | 'violet';
export type SidebarLayout = 'classic' | 'compact';
export type SurfaceStyle = 'cockpit' | 'hatched';
export type QuotaDisplayMode = 'remaining' | 'used';
export type UiScale = 90 | 95 | 100 | 105 | 110;
export type StartupPage = 'remember' | 'quick' | 'cleaner' | 'usage' | 'browser' | 'system' | 'vps' | 'help' | 'settings';

export const UI_SCALES: readonly UiScale[] = [90, 95, 100, 105, 110];
const STARTUP_PAGES: readonly StartupPage[] = ['remember', 'quick', 'cleaner', 'usage', 'browser', 'system', 'vps', 'help', 'settings'];

export type UiPreferences = {
  theme: ThemeMode;
  accent: AccentTone;
  reduceMotion: boolean;
  sidebarLayout: SidebarLayout;
  surfaceStyle: SurfaceStyle;
  quotaDisplay: QuotaDisplayMode;
  privacyMask: boolean;
  uiScale: UiScale;
  startupPage: StartupPage;
};

const STORAGE_KEY = 'claude-local.preferences.v1';

export const defaultPreferences: UiPreferences = {
  theme: 'light',
  accent: 'terracotta',
  reduceMotion: false,
  sidebarLayout: 'classic',
  surfaceStyle: 'cockpit',
  quotaDisplay: 'remaining',
  privacyMask: true,
  uiScale: 100,
  startupPage: 'remember',
};

function sanitizePreferences(raw: unknown): UiPreferences {
  if (!raw || typeof raw !== 'object') return {...defaultPreferences};
  const input = raw as Record<string, unknown>;
  const theme: ThemeMode = input.theme === 'system' || input.theme === 'light' || input.theme === 'dark' ? input.theme : defaultPreferences.theme;
  const accent: AccentTone = input.accent === 'terracotta' || input.accent === 'cockpit' || input.accent === 'emerald' || input.accent === 'violet' ? input.accent : defaultPreferences.accent;
  const sidebarLayout: SidebarLayout = input.sidebarLayout === 'classic' || input.sidebarLayout === 'compact' ? input.sidebarLayout : defaultPreferences.sidebarLayout;
  const surfaceStyle: SurfaceStyle = input.surfaceStyle === 'cockpit' || input.surfaceStyle === 'hatched' ? input.surfaceStyle : defaultPreferences.surfaceStyle;
  const quotaDisplay: QuotaDisplayMode = input.quotaDisplay === 'remaining' || input.quotaDisplay === 'used' ? input.quotaDisplay : defaultPreferences.quotaDisplay;
  const uiScale: UiScale = typeof input.uiScale === 'number' && (UI_SCALES as readonly number[]).includes(input.uiScale) ? (input.uiScale as UiScale) : defaultPreferences.uiScale;
  const startupPage: StartupPage = typeof input.startupPage === 'string' && (STARTUP_PAGES as readonly string[]).includes(input.startupPage) ? (input.startupPage as StartupPage) : defaultPreferences.startupPage;
  return {
    theme,
    accent,
    reduceMotion: typeof input.reduceMotion === 'boolean' ? input.reduceMotion : defaultPreferences.reduceMotion,
    sidebarLayout,
    surfaceStyle,
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
let currentPreferences: UiPreferences = {...initialPreferences, privacyMask: hasNativePrivacy() ? true : initialPreferences.privacyMask};
let privacyRevision = 0;
let privacyQueue: Promise<void> = Promise.resolve();
let privacyInitialization: Promise<boolean> | undefined;
let privacyError: string | null = null;
const listeners = new Set<() => void>();
const darkMedia = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

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
  root.setAttribute('data-reduce-motion', prefs.reduceMotion ? 'true' : 'false');
  root.setAttribute('data-ui-scale', String(prefs.uiScale));
  root.style.zoom = prefs.uiScale === 100 ? '' : `${prefs.uiScale}%`;
}

if (typeof document !== 'undefined') {
  applyPreferencesToDom(currentPreferences);
  darkMedia?.addEventListener('change', () => {
    if (currentPreferences.theme === 'system') {
      applyPreferencesToDom(currentPreferences);
      listeners.forEach(listener => listener());
    }
  });
}

export function getPreferences(): UiPreferences {
  return currentPreferences;
}

function publishPreferences(next: UiPreferences): void {
  currentPreferences = sanitizePreferences(next);
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(currentPreferences)); } catch { /* Keep the in-memory view. */ }
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
    void synchronizePrivacyPreference(privacyMask);
  } else {
    publishPreferences({...currentPreferences, ...patch});
  }
  return currentPreferences;
}

export function resetPreferences(): UiPreferences {
  // Resetting appearance never silently disables the native privacy preference.
  publishPreferences({...defaultPreferences, privacyMask: hasNativePrivacy() ? currentPreferences.privacyMask : defaultPreferences.privacyMask});
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
