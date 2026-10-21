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
    defaultTerminal: 'wt',
  });
  expect(updated.theme).toBe('dark');
  expect(updated.accent).toBe('cockpit');
  expect(updated.reduceMotion).toBe(true);
  expect(updated.sidebarLayout).toBe('compact');
  expect(updated.quotaDisplay).toBe('used');
  expect(updated.privacyMask).toBe(true);
  expect(updated.defaultTerminal).toBe('wt');

  const masked = maskEmailAddress('studio@example.invalid', true);
  expect(masked).toBe('stu***@example.invalid');
  expect(maskEmailAddress('studio@example.invalid', false)).toBe('studio@example.invalid');

  resetPreferences();
  expect(getPreferences()).toEqual(defaultPreferences);
});
