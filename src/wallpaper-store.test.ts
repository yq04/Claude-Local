import {describe, expect, test} from 'bun:test';
import {
  clearCustomWallpaper,
  getCustomWallpaper,
  rgbToSuggestedAccent,
  sampleRgbaBufferForAccent,
  setCustomWallpaper,
} from './wallpaper-store';

describe('wallpaper-store', () => {
  test('maps dominant RGB values to the closest AccentTone', () => {
    expect(rgbToSuggestedAccent(205, 102, 68)).toBe('terracotta');
    expect(rgbToSuggestedAccent(40, 105, 240)).toBe('cockpit');
    expect(rgbToSuggestedAccent(12, 165, 110)).toBe('emerald');
    expect(rgbToSuggestedAccent(130, 62, 235)).toBe('violet');
    expect(rgbToSuggestedAccent(230, 35, 80)).toBe('rose');
    expect(rgbToSuggestedAccent(225, 130, 12)).toBe('amber');
  });

  test('extracts vibrant accent from mixed RGBA buffers while ignoring transparent or dull grey pixels', () => {
    // 3 dull grey pixels + 2 saturated emerald pixels
    const rgba = [
      120, 120, 120, 255,
      118, 122, 120, 255,
      10, 10, 10, 0, // transparent
      8, 162, 108, 255,
      12, 155, 104, 255,
    ];
    expect(sampleRgbaBufferForAccent(rgba)).toBe('emerald');
  });

  test('stores, sanitizes and clears custom wallpaper Data URI records without leaking paths', () => {
    const sampleDataUrl = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
    const saved = setCustomWallpaper({
      dataUrl: sampleDataUrl,
      suggestedAccent: 'violet',
      width: 1600,
      height: 900,
      updatedAt: 1700000000000,
    });
    expect(saved.dataUrl).toBe(sampleDataUrl);
    expect(saved.suggestedAccent).toBe('violet');
    expect(getCustomWallpaper()?.width).toBe(1600);

    clearCustomWallpaper();
    expect(getCustomWallpaper()).toBeNull();
  });

  test('rejects non-image or invalid data URLs', () => {
    expect(() =>
      setCustomWallpaper({
        dataUrl: 'file:///C:/Users/example/wallpaper.png',
        suggestedAccent: 'cockpit',
        width: 1920,
        height: 1080,
        updatedAt: Date.now(),
      }),
    ).toThrow('settings.wallpaperInvalid');
  });

  test('synchronizes custom wallpaper with Rust ui_wallpaper_read/write/clear when running in Tauri host', async () => {
    const globalObj = globalThis as unknown as {window?: unknown};
    const previous = globalObj.window;
    const calls: Array<{command: string; args: unknown}> = [];
    const sampleDataUrl = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
    let rustStored: unknown = {
      dataUrl: sampleDataUrl,
      suggestedAccent: 'amber',
      width: 1920,
      height: 1080,
      updatedAt: 1700000000999,
    };
    const values = new Map<string, string>();
    globalObj.window = {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, val: string) => values.set(key, val),
        removeItem: (key: string) => values.delete(key),
      },
      __TAURI_INTERNALS__: {
        enableAppearanceSync: true,
        invoke: async (command: string, args: unknown) => {
          calls.push({command, args});
          if (command === 'ui_wallpaper_read') return rustStored;
          if (command === 'ui_wallpaper_write') {
            rustStored = (args as {wallpaper: unknown}).wallpaper;
            return rustStored;
          }
          if (command === 'ui_wallpaper_clear') {
            rustStored = null;
            return null;
          }
          return null;
        },
      },
    };
    try {
      const mod = await import('./wallpaper-store');
      const loaded = await mod.initializeCustomWallpaper();
      expect(loaded?.suggestedAccent).toBe('amber');
      expect(calls.some(c => c.command === 'ui_wallpaper_read')).toBe(true);
      mod.clearCustomWallpaper();
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(calls.some(c => c.command === 'ui_wallpaper_clear')).toBe(true);
    } finally {
      if (previous === undefined) delete globalObj.window;
      else globalObj.window = previous;
    }
  });
});
