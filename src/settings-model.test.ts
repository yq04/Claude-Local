import {expect, test} from 'bun:test';
import {
  applyThemePreset,
  defaultPreferences,
  getPreferences,
  initializePrivacyPreference,
  maskDisplayName,
  maskEmailAddress,
  resetPreferences,
  startSmoothTransition,
  stepUiScale,
  updatePreferences,
} from './settings-model';

test('settings model updates, sanitizes and resets preferences safely', () => {
  resetPreferences();
  expect(getPreferences()).toEqual(defaultPreferences);

  const updated = updatePreferences({
    theme: 'dark',
    accent: 'rose',
    reduceMotion: true,
    sidebarLayout: 'compact',
    surfaceStyle: 'glass',
    backdrop: 'aurora',
    fontFamily: 'modern',
    monoFont: 'jetbrains',
    quotaDisplay: 'used',
    privacyMask: true,
    uiScale: 110,
    startupPage: 'usage',
  });
  expect(updated.theme).toBe('dark');
  expect(updated.accent).toBe('rose');
  expect(updated.reduceMotion).toBe(true);
  expect(updated.sidebarLayout).toBe('compact');
  expect(updated.surfaceStyle).toBe('glass');
  expect(updated.backdrop).toBe('aurora');
  expect(updated.fontFamily).toBe('modern');
  expect(updated.monoFont).toBe('jetbrains');
  expect(updated.quotaDisplay).toBe('used');
  expect(updated.privacyMask).toBe(true);
  expect(updated.uiScale).toBe(110);
  expect(updated.startupPage).toBe('usage');
  expect(stepUiScale('reset').uiScale).toBe(100);
  expect(stepUiScale('in').uiScale).toBe(105);
  expect(stepUiScale('out').uiScale).toBe(100);

  startSmoothTransition(() => {
    applyThemePreset('nebulaDark');
  });
  expect(getPreferences().theme).toBe('dark');
  expect(getPreferences().accent).toBe('violet');
  expect(getPreferences().surfaceStyle).toBe('glass');
  expect(getPreferences().backdrop).toBe('nebula');

  applyThemePreset('duneGlass');
  expect(getPreferences().accent).toBe('amber');
  expect(getPreferences().surfaceStyle).toBe('glass');
  expect(getPreferences().backdrop).toBe('dune');

  // Optical glass & custom wallpaper tuning clamps out-of-range values
  const clamped = updatePreferences({
    backdrop: 'custom',
    glassBlur: 99,
    glassOpacity: 10,
    wallpaperDim: -12,
  });
  expect(clamped.backdrop).toBe('custom');
  expect(clamped.glassBlur).toBe(40);
  expect(clamped.glassOpacity).toBe(45);
  expect(clamped.wallpaperDim).toBe(0);

  // 旧版无界面消费者的偏好键（版本检查、通道、终端）读取后被丢弃，不再回写。
  const legacy = updatePreferences({startupCheckUpdate: true, releaseChannel: 'local', defaultTerminal: 'wt'} as never);
  expect(Object.keys(legacy).sort()).toEqual(Object.keys(defaultPreferences).sort());

  const masked = maskEmailAddress('studio@example.invalid', true);
  expect(masked).toBe('stu***@example.invalid');
  expect(maskEmailAddress('studio@example.invalid', false)).toBe('studio@example.invalid');

  // 单字符用户名必须打码，不可漏出原始字符
  expect(maskEmailAddress('a@example.invalid', true)).toBe('*@example.invalid');
  expect(maskEmailAddress('ab@example.invalid', true)).toBe('a***@example.invalid');

  // 兜底名称命中邮箱或包含邮箱特征时安全打码
  expect(maskDisplayName('studio', 'studio@example.invalid', true)).toBe('stu***@example.invalid');
  expect(maskDisplayName('work-space@example.invalid', null, true)).toBe('wor***@example.invalid');
  expect(maskDisplayName('自定义名称', 'studio@example.invalid', true)).toBe('自定义名称');

  resetPreferences();
  expect(getPreferences()).toEqual(defaultPreferences);
  expect(getPreferences().privacyMask).toBe(true);
});

test('initializePrivacyPreference safely falls back in non-Tauri test runtime', async () => {
  const result = await initializePrivacyPreference();
  expect(typeof result).toBe('boolean');
});
