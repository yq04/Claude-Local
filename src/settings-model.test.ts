import {expect, test} from 'bun:test';
import {
  defaultPreferences,
  getPreferences,
  maskEmailAddress,
  resetPreferences,
  updatePreferences,
} from './settings-model';

test('settings model updates, sanitizes and resets preferences safely', () => {
  resetPreferences();
  expect(getPreferences()).toEqual(defaultPreferences);

  const updated = updatePreferences({
    theme: 'dark',
    accent: 'cockpit',
    reduceMotion: true,
    sidebarLayout: 'compact',
    quotaDisplay: 'used',
    privacyMask: true,
  });
  expect(updated.theme).toBe('dark');
  expect(updated.accent).toBe('cockpit');
  expect(updated.reduceMotion).toBe(true);
  expect(updated.sidebarLayout).toBe('compact');
  expect(updated.quotaDisplay).toBe('used');
  expect(updated.privacyMask).toBe(true);

  // 旧版无界面消费者的偏好键（版本检查、通道、终端）读取后被丢弃，不再回写。
  const legacy = updatePreferences({startupCheckUpdate: true, releaseChannel: 'local', defaultTerminal: 'wt'} as never);
  expect(Object.keys(legacy).sort()).toEqual(Object.keys(defaultPreferences).sort());

  const masked = maskEmailAddress('studio@example.invalid', true);
  expect(masked).toBe('stu***@example.invalid');
  expect(maskEmailAddress('studio@example.invalid', false)).toBe('studio@example.invalid');

  resetPreferences();
  expect(getPreferences()).toEqual(defaultPreferences);
});
