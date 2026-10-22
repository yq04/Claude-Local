// [INPUT]: Real application shell, shared fictional IPC fixture and an isolated browser context.
// [OUTPUT]: Bilingual classic/compact geometry, readable narrow onboarding and stable synthetic screenshots across eight pages and narrow/default/wide windows.
// [POS]: Focused layout verification selected by test-usage-statistics.mjs --layout-only; no real native commands or network access.
// [PROTOCOL]: Update scripts/CLAUDE.md when changing this helper.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function runWindowLayoutChecks({page, output, base, errors}) {
  await page.goto(base + '/__usage-fixture.html');
  await page.locator('.workspace-nav').last().waitFor();
  const pages = ['quick', 'browser', 'system', 'network', 'identities', 'usage', 'help', 'settings'];
  const viewports = [{width: 760, height: 640}, {width: 1040, height: 820}, {width: 1440, height: 900}];
  const results = [];
  for (const locale of ['zh', 'en']) {
    await page.getByRole('radio', {name: locale === 'zh' ? 'CN' : 'EN', exact: true}).click();
    for (const mode of ['classic', 'compact']) {
      await page.evaluate(async ({mode, locale}) => {
        const preferences = await import('/src/settings-model.ts');
        preferences.updatePreferences({sidebarLayout: mode, theme: locale === 'en' ? 'dark' : 'light', reduceMotion: true});
      }, {mode, locale});
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        for (let index = 0; index < pages.length; index++) {
          await page.locator('.workspace-nav').nth(index).click();
          await page.locator('.workspace h1').waitFor();
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const geometry = await page.evaluate(() => {
            const rect = node => {const r = node.getBoundingClientRect(); return {x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height};};
            const sidebar = document.querySelector('.app-sidebar');
            const workspace = document.querySelector('.workspace');
            const content = document.querySelector('.cleaner-slot > *');
            const title = document.querySelector('.app-brand-copy strong');
            return {
              sidebar: rect(sidebar), workspace: rect(workspace), documentWidth: document.documentElement.clientWidth,
              documentScrollWidth: document.documentElement.scrollWidth,
              content: content ? {width: content.clientWidth, scrollWidth: content.scrollWidth} : null,
              title: {width: title.clientWidth, scrollWidth: title.scrollWidth},
              nav: [...document.querySelectorAll('.workspace-nav')].map(node => ({...rect(node), label: node.lastElementChild.textContent, labelWidth: node.lastElementChild.clientWidth, labelScrollWidth: node.lastElementChild.scrollWidth})),
              footer: [...document.querySelectorAll('.sidebar-bottom button,.sidebar-collapse-btn')].map(rect),
              cards: [...document.querySelectorAll('.identity-card:not(.empty)')].map(rect),
              onboarding: document.querySelector('.identity-onboarding-steps') ? {
                box: rect(document.querySelector('.identity-onboarding-steps')),
                wrap: getComputedStyle(document.querySelector('.identity-onboarding-steps')).flexWrap,
                steps: [...document.querySelector('.identity-onboarding-steps').children].map(rect),
              } : null,
            };
          });
          const label = `${locale}/${mode}/${viewport.width}x${viewport.height}/${pages[index]}`;
          assert.ok(geometry.documentScrollWidth <= geometry.documentWidth + 1, label + ': document must fit horizontally');
          assert.ok(geometry.workspace.right <= viewport.width + 1, label + ': workspace must stay inside window');
          assert.ok(geometry.workspace.width > 0, label + ': content must retain usable width');
          assert.ok(geometry.content && geometry.content.scrollWidth <= geometry.content.width + 1, label + ': page must fit without clipping horizontal content');
          assert.equal(geometry.nav.length, 8, label + ': all navigation destinations remain available');
          for (const button of [...geometry.nav, ...geometry.footer]) {
            assert.ok(button.width > 0 && button.height > 0, label + ': shell controls remain visible');
            assert.ok(button.x >= geometry.sidebar.x - 1 && button.right <= geometry.sidebar.right + 1, label + ': shell controls stay inside sidebar');
            assert.ok(button.bottom <= viewport.height + 1, label + ': short-window controls remain reachable');
          }
          if (mode === 'classic') {
            assert.ok(geometry.sidebar.width <= 196, label + ': classic navigation should release content space');
            assert.ok(geometry.title.scrollWidth <= geometry.title.width + 1, label + ': product name must remain readable');
            for (const nav of geometry.nav) assert.ok(nav.labelScrollWidth <= nav.labelWidth + 1, label + ': navigation labels must not be clipped: ' + nav.label);
          } else {
            assert.equal(geometry.sidebar.width, 72, label + ': chosen compact navigation retains its existing width');
          }
          for (const card of geometry.cards) {
            assert.equal(card.width, 180, label + ': identity card width is preserved');
            assert.equal(card.height, 286, label + ': identity card height is preserved');
          }
          if (geometry.onboarding?.wrap === 'wrap') {
            for (const step of geometry.onboarding.steps) {
              assert.ok(step.x >= geometry.onboarding.box.x - 1 && step.right <= geometry.onboarding.box.right + 1, label + ': narrow onboarding must show every step without horizontal scrolling');
            }
          }
          results.push({label, sidebarWidth: geometry.sidebar.width, workspaceWidth: geometry.workspace.width});
          if (pages[index] === 'identities' && mode === 'classic' && viewport.width !== 1440) {
            await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.cleaner-slot')).opacity) >= 0.99);
            await page.screenshot({path: join(output, `identities-${locale}-${viewport.width}.png`)});
          }
        }
      }
    }
  }
  // Resizing must not rewrite a user's explicit sidebar preference.
  await page.setViewportSize({width: 640, height: 520});
  await page.locator('.workspace-nav').nth(4).click();
  const chosen = await page.evaluate(() => JSON.parse(localStorage.getItem('claude-local.preferences.v1')).sidebarLayout);
  assert.equal(chosen, 'compact');
  assert.deepEqual(errors, [], 'Layout navigation must not trigger runtime errors');
  const commands = await page.evaluate(() => window.usageFixture.commands);
  assert.equal(commands.some(({command}) => /^identities_(stop|save|switch|delete)$|^system_(set|disable)|^browser_(launch|quit|clear|save|align|set)/.test(command)), false, 'Layout checks must remain read-only');
  const summary = {checks: results.length, locales: ['zh', 'en'], sidebarModes: ['classic', 'compact'], viewports, results};
  await writeFile(join(output, 'window-layout-results.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({checks: results.length, screenshots: output, status: 'passed'}));
}
