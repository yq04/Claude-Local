/**
 * [INPUT]: 浏览器本地存储（可选）与操作系统深色/减弱动态媒体查询。
 * [OUTPUT]: 响应式界面偏好（主题明暗、强调色、减少动画、侧栏布局、表面纹理、额度显示模式、隐私打码、默认终端与版本检查状态）。
 * [POS]: 纯前端视图偏好层；不保存任何账号凭据或个人路径，存储不可用时安全回退默认值。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {useSyncExternalStore} from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';
export type AccentTone = 'terracotta' | 'cockpit' | 'emerald' | 'violet';
export type SidebarLayout = 'classic' | 'compact';
export type SurfaceStyle = 'cockpit' | 'hatched';
export type QuotaDisplayMode = 'remaining' | 'used';
export type TerminalKind = 'pwsh' | 'powershell' | 'wt' | 'cmd';
export type ReleaseChannel = 'stable' | 'local';

export type UiPreferences = {
  theme: ThemeMode;
  accent: AccentTone;
  reduceMotion: boolean;
  sidebarLayout: SidebarLayout;
  surfaceStyle: SurfaceStyle;
  quotaDisplay: QuotaDisplayMode;
  showDashboardKpi: boolean;
  privacyMask: boolean;
  defaultTerminal: TerminalKind;
  startupCheckUpdate: boolean;
  releaseChannel: ReleaseChannel;
  lastUpdateCheck: number | null;
};

const STORAGE_KEY = 'claude-local.preferences.v1';

export const defaultPreferences: UiPreferences = {
  theme: 'light',
  accent: 'terracotta',
  reduceMotion: false,
  sidebarLayout: 'classic',
  surfaceStyle: 'cockpit',
  quotaDisplay: 'remaining',
  showDashboardKpi: true,
  privacyMask: false,
  defaultTerminal: 'pwsh',
  startupCheckUpdate: false,
  releaseChannel: 'stable',
  lastUpdateCheck: null,
};

function sanitizePreferences(raw: unknown): UiPreferences {
  if (!raw || typeof raw !== 'object') return {...defaultPreferences};
  const input = raw as Record<string, unknown>;
  const theme: ThemeMode = input.theme === 'system' || input.theme === 'light' || input.theme === 'dark' ? input.theme : defaultPreferences.theme;
  const accent: AccentTone = input.accent === 'terracotta' || input.accent === 'cockpit' || input.accent === 'emerald' || input.accent === 'violet' ? input.accent : defaultPreferences.accent;
  const sidebarLayout: SidebarLayout = input.sidebarLayout === 'classic' || input.sidebarLayout === 'compact' ? input.sidebarLayout : defaultPreferences.sidebarLayout;
  const surfaceStyle: SurfaceStyle = input.surfaceStyle === 'cockpit' || input.surfaceStyle === 'hatched' ? input.surfaceStyle : defaultPreferences.surfaceStyle;
  const quotaDisplay: QuotaDisplayMode = input.quotaDisplay === 'remaining' || input.quotaDisplay === 'used' ? input.quotaDisplay : defaultPreferences.quotaDisplay;
  const defaultTerminal: TerminalKind = input.defaultTerminal === 'pwsh' || input.defaultTerminal === 'powershell' || input.defaultTerminal === 'wt' || input.defaultTerminal === 'cmd' ? input.defaultTerminal : defaultPreferences.defaultTerminal;
  const releaseChannel: ReleaseChannel = input.releaseChannel === 'stable' || input.releaseChannel === 'local' ? input.releaseChannel : defaultPreferences.releaseChannel;
  return {
    theme,
    accent,
    reduceMotion: typeof input.reduceMotion === 'boolean' ? input.reduceMotion : defaultPreferences.reduceMotion,
    sidebarLayout,
    surfaceStyle,
    quotaDisplay,
    showDashboardKpi: typeof input.showDashboardKpi === 'boolean' ? input.showDashboardKpi : defaultPreferences.showDashboardKpi,
    privacyMask: typeof input.privacyMask === 'boolean' ? input.privacyMask : defaultPreferences.privacyMask,
    defaultTerminal,
    startupCheckUpdate: typeof input.startupCheckUpdate === 'boolean' ? input.startupCheckUpdate : defaultPreferences.startupCheckUpdate,
    releaseChannel,
    lastUpdateCheck: typeof input.lastUpdateCheck === 'number' && Number.isFinite(input.lastUpdateCheck) ? input.lastUpdateCheck : null,
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

let currentPreferences: UiPreferences = loadPreferences();
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

export function updatePreferences(patch: Partial<UiPreferences>): UiPreferences {
  currentPreferences = sanitizePreferences({...currentPreferences, ...patch});
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(currentPreferences));
    } catch {
      /* Storage unavailable; keep in-memory state. */
    }
  }
  applyPreferencesToDom(currentPreferences);
  listeners.forEach(listener => listener());
  return currentPreferences;
}

export function resetPreferences(): UiPreferences {
  currentPreferences = {...defaultPreferences};
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* Ignore storage error. */
    }
  }
  applyPreferencesToDom(currentPreferences);
  listeners.forEach(listener => listener());
  return currentPreferences;
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
  if (atIndex <= 1) return email;
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex);
  const visible = local.slice(0, Math.min(3, Math.max(1, Math.floor(local.length / 2))));
  return `${visible}***${domain}`;
}
