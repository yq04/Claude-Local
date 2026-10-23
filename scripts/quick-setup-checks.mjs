// [INPUT]: Isolated browser page, synthetic fixture hooks and output directory.
// [OUTPUT]: Verified quick-setup progressive loading, partial failure reporting, follow_machine targets, safe unmount and responsive geometry.
// [POS]: Focused quick-setup regression helper for --quick-only mode.
// [PROTOCOL]: Update this header and scripts/CLAUDE.md with changes.

import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function runQuickSetupChecks({page, context, output, base, errors}) {
  page.setDefaultTimeout(15000);

  // 1. Cold start: verify directly landing on quick setup without prior identity or browser visit
  await page.goto(base + '/__usage-fixture.html');
  await page.getByRole('heading', {name: '快速配置', exact: true}).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('claude-local.page.v1')), 'quick', 'Must cold start directly on quick page');

  const initialCommands = await page.evaluate(() => window.usageFixture.commands);
  const mutatingInitial = initialCommands.some(item =>
    ['identities_stop', 'browser_launch', 'network_diagnose_domains'].includes(item.command)
  );
  assert.equal(mutatingInitial, false, 'Cold start must not execute mutating commands');
  assert.equal(await page.locator('.identity-card, .browser-console').count(), 0, 'Cold start must not mount identity cards or browser console');

  // Verify alignment and initial overview structure
  await page.locator('.quick-overview[aria-busy="false"]').waitFor();
  assert.equal(await page.locator('[data-quick-destination]').count(), 7, 'Must render exactly 7 destination cards');
  const quickAlignment = await page.locator('.quick-page').evaluate(node => ({
    title: node.querySelector('h1').getBoundingClientRect().left,
    card: node.querySelector('.quick-overview').getBoundingClientRect().left,
  }));
  assert.ok(Math.abs(quickAlignment.title - quickAlignment.card) <= 1, 'Quick setup card must align with title margin');

  assert.match(await page.locator('[data-quick-state="identity"]').innerText(), /已保存 3 个身份/);
  assert.match(await page.locator('[data-quick-state="system"]').innerText(), /America\/New_York/);
  assert.match(await page.locator('[data-quick-state="cli"]').innerText(), /2\.1\.303/);
  assert.match(await page.locator('[data-quick-state="browser"]').innerText(), /引擎已就绪/);

  await page.screenshot({path: join(output, 'quick-setup-zh-light.png'), fullPage: true});

  // 2. Slow browser read simulation: verify progressive individual readiness
  // Identity, system, and CLI must display their observed state while browser read is held.
  await page.evaluate(() => {
    window.usageFixture.holdBrowser = true;
  });
  await page.locator('.quick-page').getByRole('button', {name: '刷新状态', exact: true}).click();
  await page.locator('.quick-overview[aria-busy="true"]').waitFor();
  assert.equal(
    await page.locator('.quick-header button').isDisabled(),
    true,
    'Refresh button must be disabled while any state read is busy'
  );

  // Progressive rendering: wait for non-held observed text to arrive without fixed sleep
  await page.locator('[data-quick-state="identity"]').filter({hasText: /已保存 3 个身份/}).waitFor();
  await page.locator('[data-quick-state="system"]').filter({hasText: /America\/New_York/}).waitFor();
  await page.locator('[data-quick-state="cli"]').filter({hasText: /2\.1\.303/}).waitFor();

  assert.equal(await page.locator('[data-quick-state="browser"]').getAttribute('data-read-state'), 'pending');
  const browserTextWhileHeld = await page.locator('[data-quick-state="browser"]').innerText();
  assert.doesNotMatch(
    browserTextWhileHeld,
    /引擎缺失/,
    'Pending browser read must not display fake missing engine state'
  );

  await page.screenshot({path: join(output, 'quick-setup-partial-loading.png'), fullPage: true});

  // Release browser read and verify full settlement
  await page.evaluate(() => window.usageFixture.releaseBrowser());
  await page.locator('.quick-overview[aria-busy="false"]').waitFor();
  assert.equal(await page.locator('.quick-header button').isDisabled(), false, 'Refresh button must re-enable when all states settle');
  assert.match(await page.locator('[data-quick-state="browser"]').innerText(), /引擎已就绪/);

  // 3. Partial failure reporting: specific failed item name & remaining items visible
  await page.evaluate(() => {
    window.usageFixture.failedReads = ['identities_read'];
  });
  await page.locator('.quick-page').getByRole('button', {name: '刷新状态', exact: true}).click();
  await page.locator('.quick-page [role="alert"]').waitFor();

  const alertText = await page.locator('.quick-page [role="alert"]').innerText();
  assert.match(
    alertText,
    /身份管理/,
    `Partial failure alert must mention the specific failed component (actual: "${alertText}")`
  );

  // Remaining states must stay visible and observed
  assert.match(await page.locator('[data-quick-state="identity"]').innerText(), /无法读取/);
  assert.match(await page.locator('[data-quick-state="browser"]').innerText(), /引擎已就绪/, 'Browser state must remain visible on identity failure');
  assert.match(await page.locator('[data-quick-state="system"]').innerText(), /America\/New_York/, 'System state must remain visible on identity failure');
  assert.match(await page.locator('[data-quick-state="cli"]').innerText(), /2\.1\.303/, 'CLI state must remain visible on identity failure');

  // Recovery after clearing failure
  await page.evaluate(() => {
    window.usageFixture.failedReads = [];
  });
  await page.locator('.quick-page').getByRole('button', {name: '刷新状态', exact: true}).click();
  await page.waitForFunction(() => !document.querySelector('.quick-page [role="alert"]') && !document.querySelector('.quick-header button')?.disabled);
  assert.match(await page.locator('[data-quick-state="identity"]').innerText(), /已保存 3 个身份/);

  await page.evaluate(() => { window.usageFixture.failedReads = ['browser_read']; });
  await page.locator('.quick-header button').click();
  await page.locator('.quick-overview[aria-busy="false"]').waitFor();
  assert.match(await page.locator('.quick-page [role="alert"]').innerText(), /浏览环境/);
  assert.match(await page.locator('.quick-target strong').innerText(), /无法读取/);
  assert.match(await page.locator('[data-quick-state="identity"]').innerText(), /已保存 3 个身份/);
  await page.screenshot({path: join(output, 'quick-setup-partial-error.png'), fullPage: true});
  await page.evaluate(() => { window.usageFixture.failedReads = []; });

  // 4. Target follow_machine resolution
  // 4a. follow_machine = false: uses config timezone and language
  await page.evaluate(() => {
    window.usageFixture.browserConfig = {
      seed: 123456, proxy: '', follow_machine: false, language: 'en-US', timezone: 'America/Los_Angeles', native_graphics: true
    };
  });
  await page.locator('.quick-page').getByRole('button', {name: '刷新状态', exact: true}).click();
  await page.locator('.quick-overview[aria-busy="false"]').waitFor();
  assert.match(await page.locator('.quick-target strong').innerText(), /America\/Los_Angeles · en-US/);

  // 4b. follow_machine = true: uses browser.machine actual timezone and normalized language (en -> en-US)
  await page.evaluate(() => {
    window.usageFixture.browserConfig = {
      seed: 123456, proxy: '', follow_machine: true, language: 'en-GB', timezone: 'Europe/London', native_graphics: true
    };
    window.usageFixture.browserMachine = {
      platform: 'windows', version: '15.0.0', cores: 8, timezone: 'America/Chicago', languages: ['en'], locale: 'en', location_enabled: false, timezones: ['America/Chicago']
    };
  });
  await page.locator('.quick-page').getByRole('button', {name: '刷新状态', exact: true}).click();
  await page.locator('.quick-overview[aria-busy="false"]').waitFor();
  const targetResolved = await page.locator('.quick-target strong').innerText();
  assert.match(targetResolved, /America\/Chicago/, `Target must resolve machine timezone when follow_machine is true (actual: "${targetResolved}")`);
  assert.match(targetResolved, /en-US/, `Target must normalize primary language 'en' to 'en-US' (actual: "${targetResolved}")`);
  assert.doesNotMatch(targetResolved, /Europe\/London|en-GB/, 'Target must not use config fields when follow_machine is true');

  // 5. Safe unmount without response pollution
  await page.evaluate(() => {
    window.usageFixture.holdBrowser = true;
  });
  await page.locator('.quick-page').getByRole('button', {name: '刷新状态', exact: true}).click();
  await page.locator('.quick-overview[aria-busy="true"]').waitFor();
  // Navigate away while browser read is pending
  await page.locator('[data-quick-destination="vps"]').getByRole('button').click();
  await page.getByRole('heading', {name: 'Claude 服务连通性', exact: true}).waitFor();
  // Release browser read while unmounted
  await page.evaluate(() => window.usageFixture.releaseBrowser());
  await page.waitForTimeout(50);
  // Return to quick setup
  await page.getByRole('button', {name: '快速配置', exact: true}).click();
  await page.locator('.quick-overview[aria-busy="false"]').waitFor();
  assert.equal(await page.locator('.quick-page [role="alert"]').count(), 0, 'Late resolved response from unmounted cycle must not leave error alerts');

  // 6. Six destinations navigation without confirmation dialog
  for (const [dest, title] of [
    ['vps', '网络环境'],
    ['cleaner', '身份管理'],
    ['browser', '浏览环境'],
    ['system', '电脑环境'],
    ['usage', '用量分析'],
    ['settings', '软件设置'],
  ]) {
    const card = dest === 'cleaner'
      ? page.locator('[data-quick-destination="cleaner"]').first()
      : page.locator(`[data-quick-destination="${dest}"]`);
    await card.getByRole('button').click();
    await page.getByRole('heading', {name: title, exact: true}).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0, `Navigating to ${dest} must not open a confirmation dialog`);
    assert.equal(await page.evaluate(() => localStorage.getItem('claude-local.page.v1')), dest);
    await page.getByRole('button', {name: '快速配置', exact: true}).click();
    await page.locator('.quick-overview[aria-busy="false"]').waitFor();
  }

  // 6b. Troubleshooting destination navigation: navigates to cleaner, locates residue, never calls scan/clean
  const initialTroubleshootCmds = await page.evaluate(() => window.usageFixture.commands.length);
  const troubleshootCard = page.locator('.quick-setup-card').filter({hasText: /系统与缓存排障|Troubleshoot/});
  assert.equal(await troubleshootCard.count(), 1, 'Troubleshooting card must be rendered');
  await troubleshootCard.getByRole('button').click();
  await page.getByRole('heading', {name: '身份管理', exact: true}).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('claude-local.page.v1')), 'cleaner');
  const residueSection = page.locator('.claude-residue');
  await residueSection.waitFor({state: 'visible'});
  assert.equal(await residueSection.count(), 1, 'Residue section must be located and visible');

  // Verify that troubleshooting navigation never calls scan or clean commands
  const postTroubleshootCmds = await page.evaluate(() => window.usageFixture.commands);
  const newCmds = postTroubleshootCmds.slice(initialTroubleshootCmds);
  const scanOrCleanCmds = newCmds.filter(c => c.command.includes('scan') || c.command.includes('clean'));
  assert.deepEqual(scanOrCleanCmds, [], 'Troubleshooting card click must never invoke scan or clean commands');

  // Return to quick setup
  await page.getByRole('button', {name: '快速配置', exact: true}).click();
  await page.locator('.quick-overview[aria-busy="false"]').waitFor();

  // 6c. CLI missing guide, copy command, and recheck verification
  await page.evaluate(() => {
    window.usageFixture.cliMissing = true;
  });
  await page.locator('[data-quick-destination="cleaner"]').first().getByRole('button').click();
  await page.getByRole('heading', {name: '身份管理', exact: true}).waitFor();
  const cliPanel = page.locator('.identity-cli');
  await cliPanel.locator('.cli-install-guide').waitFor({state: 'visible'});
  assert.match(await cliPanel.locator('.cli-install-code').innerText(), /irm https:\/\/claude\.ai\/install\.ps1 \| iex/);

  // Test copy command
  const copyBtn = cliPanel.getByRole('button', {name: /复制命令|Copy command/});
  await copyBtn.click();
  const copied = await page.evaluate(() => window.usageFixture.copied);
  assert.ok(copied.includes('irm https://claude.ai/install.ps1 | iex'), 'Copy button must invoke copy_result with official install command');

  // Restore CLI installed and test recheck
  await page.evaluate(() => {
    window.usageFixture.cliMissing = false;
  });
  const recheckBtn = cliPanel.getByRole('button', {name: /重新检查|Recheck/});
  await recheckBtn.click();
  await page.locator('.cli-install-guide').waitFor({state: 'detached'});
  assert.match(await cliPanel.locator('.cli-status-pill').innerText(), /2\.1\.303/);

  // Return to quick setup
  await page.getByRole('button', {name: '快速配置', exact: true}).click();
  await page.locator('.quick-overview[aria-busy="false"]').waitFor();

  // 7. English, Dark Theme, 720px narrow window, sidebar modes & geometry
  await page.getByRole('radio', {name: 'EN', exact: true}).click();
  await page.getByRole('heading', {name: 'Quick setup', exact: true}).waitFor();
  await page.evaluate(async () => {
    const prefs = await import('/src/settings-model.ts');
    prefs.updatePreferences({theme: 'dark'});
  });
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), true, 'Dark theme must set .dark class on root');

  await page.setViewportSize({width: 900, height: 720});
  assert.match(await page.locator('[data-quick-state="cli"]').innerText(), /2\.1\.303/);

  // 720px narrow window with classic sidebar
  await page.setViewportSize({width: 720, height: 720});
  const geoClassic = await page.locator('.quick-page').evaluate(node => ({
    width: node.clientWidth,
    scrollWidth: node.scrollWidth,
    docWidth: document.documentElement.clientWidth,
    docScrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(geoClassic.scrollWidth <= geoClassic.width + 1, 'Quick page must not overflow horizontally in 720px classic sidebar');
  assert.ok(geoClassic.docScrollWidth <= geoClassic.docWidth + 1, 'Document must not widen in 720px classic sidebar');
  const cardBoundariesClassic = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.settings-card')];
    return cards.map(c => {
      const rect = c.getBoundingClientRect();
      const elements = [...c.querySelectorAll('h1,h2,h3,p,span,strong,small,button')];
      const overflow = elements.some(el => {
        const r = el.getBoundingClientRect();
        return r.right > rect.right + 2 || r.left < rect.left - 2;
      });
      return {className: c.className, scrollWidth: c.scrollWidth, clientWidth: c.clientWidth, overflow};
    });
  });
  for (const card of cardBoundariesClassic) {
    assert.ok(card.scrollWidth <= card.clientWidth + 1, `Card scrollWidth must fit clientWidth (${card.className})`);
    assert.equal(card.overflow, false, `Card content must stay within card horizontal boundaries in classic sidebar (${card.className})`);
  }
  await page.screenshot({path: join(output, 'quick-setup-en-dark-narrow.png'), fullPage: true});

  // 720px narrow window with compact sidebar
  await page.getByRole('button', {name: 'Collapse sidebar', exact: true}).click();
  await page.locator('.sidebar-compact').waitFor();
  const geoCompact = await page.locator('.quick-page').evaluate(node => ({
    width: node.clientWidth,
    scrollWidth: node.scrollWidth,
    docWidth: document.documentElement.clientWidth,
    docScrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(geoCompact.scrollWidth <= geoCompact.width + 1, 'Quick page must not overflow horizontally in 720px compact sidebar');
  assert.ok(geoCompact.docScrollWidth <= geoCompact.docWidth + 1, 'Document must not widen in 720px compact sidebar');
  const cardBoundariesCompact = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.settings-card')];
    return cards.map(c => {
      const rect = c.getBoundingClientRect();
      const elements = [...c.querySelectorAll('h1,h2,h3,p,span,strong,small,button')];
      const overflow = elements.some(el => {
        const r = el.getBoundingClientRect();
        return r.right > rect.right + 2 || r.left < rect.left - 2;
      });
      return {className: c.className, scrollWidth: c.scrollWidth, clientWidth: c.clientWidth, overflow};
    });
  });
  for (const card of cardBoundariesCompact) {
    assert.ok(card.scrollWidth <= card.clientWidth + 1, `Card scrollWidth must fit clientWidth (${card.className})`);
    assert.equal(card.overflow, false, `Card content must stay within card horizontal boundaries in compact sidebar (${card.className})`);
  }
  await page.screenshot({path: join(output, 'quick-setup-en-dark-compact.png'), fullPage: true});

  // Restore sidebar, viewport, locale and theme
  await page.getByRole('button', {name: 'Expand sidebar', exact: true}).click();
  await page.setViewportSize({width: 1040, height: 820});
  await page.getByRole('radio', {name: 'CN', exact: true}).click();
  await page.getByRole('heading', {name: '快速配置', exact: true}).waitFor();
  await page.evaluate(async () => {
    const prefs = await import('/src/settings-model.ts');
    prefs.updatePreferences({theme: 'light'});
  });

  // 8. Command allowlist and error checks
  assert.deepEqual(errors, [], 'No unexpected browser page errors should occur');
  const commands = await page.evaluate(() => window.usageFixture.commands);
  const allowedCommands = new Set([
    'identities_read',
    'browser_read',
    'system_read',
    'claude_cli_read',
    'usage_statistics_read',
    'ui_language_read',
    'ui_language_write',
    'plugin:app|version',
    'get_regions',
    'browser_default_read',
    'plugin:event|listen',
    'plugin:event|unlisten',
    'copy_result',
    'quota_setup_status',
    'ui_privacy_read',
    'identities_quota_revision',
    'identities_quota_batch_state',
    'identities_backup_location',
  ]);
  const disallowed = commands.filter(item => !allowedCommands.has(item.command));
  assert.deepEqual(disallowed, [], `All invoked commands must be within read-only allowlist: ${disallowed.map(d => d.command).join(', ')}`);

  const result = {
    checks: [
      'cold-start-direct-quick-setup',
      'individual-readiness-during-slow-browser',
      'partial-failure-identifies-failed-item',
      'browser-failure-keeps-identities-visible-and-target-unavailable',
      'remaining-states-visible-on-partial-failure',
      'browser-pending-does-not-show-fake-missing',
      'target-follow-machine-resolves-machine-timezone-and-normalized-language',
      'target-not-follow-machine-uses-config',
      'unmount-during-pending-read-does-not-pollute',
      'six-destinations-navigation-without-dialog',
      'bilingual-zh-and-en-labels',
      'dark-theme-via-preferences-api',
      '720-narrow-classic-sidebar-geometry',
      '720-narrow-compact-sidebar-geometry',
      'no-horizontal-overflow',
      'read-only-command-allowlist',
    ],
    commandsCount: commands.length,
    geometry: {classic: geoClassic, compact: geoCompact},
    screenshots: output,
  };

  await writeFile(join(output, 'quick-setup-results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
