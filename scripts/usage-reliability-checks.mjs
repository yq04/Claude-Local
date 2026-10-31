// [INPUT]: Real usage page, shared fictional IPC fixture and an isolated local browser context.
// [OUTPUT]: Token/cost/model conservation, concise dynamic account selection, scoped TSV and bilingual light/dark 760x640 / 1280x900 evidence.
// [POS]: Focused --usage-reliability-only helper; no real identities, session files or native mutations.
// [PROTOCOL]: Update this header and scripts/CLAUDE.md with changes.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function runUsageReliabilityChecks({page, output, base, errors}) {
  await page.clock.install({time: new Date('2026-10-20T10:35:00-04:00')});
  await page.goto(base + '/__usage-fixture.html');
  const ready = () => page.locator('.usage-overview[aria-busy="false"]').waitFor();
  await ready();
  const chooseAccount = async name => {
    const control = page.locator('.usage-account-filter').getByRole('combobox');
    await control.click();
    await page.getByRole('option', {name, exact: true}).click();
    await ready();
  };
  const refresh = async () => {
    await page.locator('.usage-action-group button').last().click();
    await ready();
  };
  const copyTsv = async () => {
    const before = await page.evaluate(() => window.usageFixture.copied.length);
    await page.locator('.usage-action-group button').first().click();
    await page.waitForFunction(n => window.usageFixture.copied.length > n, before);
    return page.evaluate(() => window.usageFixture.copied.at(-1));
  };
  const summaryRow = text => {
    const lines = text.split(/\r?\n/).map(line => line.split('\t'));
    const header = lines.findIndex(line => line.includes('会话数') || line.includes('Sessions'));
    assert.ok(header >= 0, 'Visible activity columns must be included in TSV');
    return {header: lines[header], values: lines[header + 1]};
  };
  const hiddenAccountTerms = /未归属|兜底|unattributed|fallback|ownership evidence/i;
  const assertSimpleAccountUi = async allLabel => {
    assert.equal(await page.locator('.usage-history-note,.usage-attribution-card').count(), 0);
    const visible = await page.locator('.usage-page').evaluate(node => [node.innerText, ...[...node.querySelectorAll('[title],[aria-label]')].flatMap(child => [child.title, child.getAttribute('aria-label')])].filter(Boolean).join('\n'));
    assert.doesNotMatch(visible, hiddenAccountTerms, 'Page copy and accessible labels must stay concise');
    const expected = await page.evaluate(label => [label, ...window.usageFixture.lastSnapshot.accounts.map(row => row.name)], allLabel);
    await page.locator('.usage-account-filter').getByRole('combobox').click();
    assert.deepEqual(await page.getByRole('option').allTextContents(), expected, 'Only All and dynamic ordinary account names belong in the selector');
    await page.getByRole('option', {name:allLabel, exact:true}).click();
    await ready();
    assert.equal(await page.locator('.usage-table tbody tr').count(), expected.length - 1, 'Account details must contain only ordinary accounts');
  };
  const totals = await page.evaluate(() => window.usageFixture.lastSnapshot);
  const counterKeys = ['input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens', 'total_tokens', 'requests', 'sessions'];
  for (const key of counterKeys) {
    assert.equal(totals.totals[key], totals.accounts.reduce((sum, row) => sum + row.totals[key], 0) + totals.unattributed[key], `All must conserve known + unknown ${key}`);
  }
  assert.equal(totals.totals.total_tokens, 3100);
  assert.equal(totals.activity.sessions, 6);
  assert.equal(await page.locator('.usage-total-value').getAttribute('title'), '3,100');
  assert.match(await page.locator('[data-usage-metric="cost"] > strong').innerText(), /^(<\$|\$)/);
  assert.match(await page.locator('[data-usage-metric="savings"] > strong').innerText(), /^(<\$|\$)/);
  assert.match(await page.locator('[data-usage-metric="cache"] > strong').innerText(), /%/);
  assert.match(await page.locator('[data-usage-metric="pace"] > strong').innerText(), /^(<\$|\$)/);
  const composition = await page.locator('.usage-total-card .usage-composition-details > div').evaluateAll(nodes => nodes.map(node => ({kind: node.dataset.tokenKind, tokens: node.querySelector('dd').title})));
  assert.deepEqual(composition, [{kind:'input', tokens:'740'}, {kind:'output', tokens:'410'}, {kind:'cacheWrite', tokens:'300'}, {kind:'cacheRead', tokens:'1,650'}]);
  const widths = await page.locator('.usage-total-card .usage-composition-track > span').evaluateAll(nodes => nodes.map(node => parseFloat(node.style.width)));
  assert.ok(Math.abs(widths.reduce((a, b) => a + b, 0) - 100) < 0.001, 'Four token shares must sum to 100%');
  assert.equal(await page.locator('.usage-model-row').count(), 8, 'Every model must render, including seventh/eighth rows');
  assert.equal(await page.locator('.usage-model-row .usage-composition-track').count(), 8);
  await page.getByText('third-party-model-zeta', {exact: true}).waitFor();
  await page.getByText('未记录模型', {exact: true}).waitFor();
  await page.locator('.usage-method-trigger').click();
  await assertSimpleAccountUi('全部');
  const alignment = await page.locator('.usage-page').evaluate(node => ({title:node.querySelector('h1').getBoundingClientRect().left, overview:node.querySelector('.usage-overview').getBoundingClientRect().left}));
  assert.ok(Math.abs(alignment.title - alignment.overview) <= 1);
  const allTsv = summaryRow(await copyTsv());
  assert.deepEqual(allTsv.values.slice(0, 10), ['全部','3100','740','410','300','1650','134','6',String(totals.activity.active_days)]);
  assert.equal(allTsv.header.length, allTsv.values.length, 'TSV summary column headings must align with values');

  const alpha = totals.accounts[0];
  await chooseAccount(alpha.name);
  assert.equal(await page.locator('.usage-total-value').getAttribute('title'), '1,000');
  assert.match(await page.locator('[data-usage-metric="cost"] > strong').innerText(), /^(<\$|\$)/);
  assert.equal((await page.evaluate(() => window.usageFixture.requests.at(-1))).accountId, alpha.id);
  const accountExport = await copyTsv();
  const accountTsv = summaryRow(accountExport);
  assert.deepEqual(accountTsv.values.slice(0, 8), [alpha.name,'1000','200','100','100','600','48','2']);
  assert.equal(accountTsv.values.includes('3100'), false, 'Scoped TSV must not leak all-account totals');
  assert.doesNotMatch(accountExport, hiddenAccountTerms, 'Exported labels must use ordinary account scope');
  await chooseAccount('Gamma workspace');
  assert.equal(await page.locator('.usage-total-value').getAttribute('title'), '0');
  assert.equal(await page.locator('[data-usage-metric="cost"] > strong').innerText(), '$0.00', 'Zero usage must show $0.00');
  assert.equal(await page.locator('[data-usage-metric="savings"] > strong').innerText(), '$0.00');
  await chooseAccount('全部');

  const layouts = [];
  for (const locale of ['zh', 'en']) for (const theme of ['light', 'dark']) {
    await page.evaluate(async ({locale, theme}) => {
      (await import('/src/i18n.ts')).setLocale(locale);
      (await import('/src/settings-model.ts')).updatePreferences({theme, sidebarLayout: 'classic', reduceMotion: true});
      window.usageFixture.longNames = true;
    }, {locale, theme});
    await refresh();
    await assertSimpleAccountUi(locale === 'zh' ? '全部' : 'All');
    for (const viewport of [{width:760,height:640}, {width:1280,height:900}]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const geometry = await page.locator('.usage-page').evaluate(node => ({
        theme:document.documentElement.classList.contains('dark')?'dark':'light',
        width:node.clientWidth, scrollWidth:node.scrollWidth,
        documentWidth:document.documentElement.clientWidth, documentScrollWidth:document.documentElement.scrollWidth,
        panels:[...node.querySelectorAll('.usage-overview,.usage-total-card,.usage-summary,.usage-metric,.usage-model-card,.usage-chart-card')].map(panel=>({className:panel.className,width:panel.clientWidth,scrollWidth:panel.scrollWidth})),
        modelCount:node.querySelectorAll('.usage-model-row').length,
      }));
      const label = `${locale}/${theme}/${viewport.width}x${viewport.height}`;
      assert.equal(geometry.theme, theme, label + ': chosen theme must apply');
      assert.ok(geometry.scrollWidth <= geometry.width + 1, label + ': page must fit horizontally');
      assert.ok(geometry.documentScrollWidth <= geometry.documentWidth + 1, label + ': document must fit horizontally');
      for (const panel of geometry.panels) assert.ok(panel.scrollWidth <= panel.width + 1, label + ': panel must fit: ' + panel.className);
      assert.equal(geometry.modelCount, 8);
      assert.match(await page.locator('.usage-page').innerText(), /\$|API 等效花费|缓存节省|Cache savings|Est\. API cost/);
      await page.locator('.usage-overview').screenshot({path:join(output, `usage-${locale}-${theme}-${viewport.width}x${viewport.height}.png`)});
      layouts.push({label, geometry});
    }
  }
  await page.evaluate(() => {window.usageFixture.legacyActivity = true;});
  await refresh();
  const legacyTsv = summaryRow(await copyTsv());
  assert.deepEqual(legacyTsv.values.slice(-2), ['', ''], 'Missing legacy activity must remain blank in TSV');
  await page.locator('.usage-overview').screenshot({path:join(output,'usage-legacy-activity-unknown-en-dark.png')});
  await page.evaluate(() => {window.usageFixture.legacyActivity = false;});
  await refresh();
  await page.setViewportSize({width:1280,height:900});
  await page.locator('.usage-model-card').screenshot({path:join(output,'usage-all-models-en-dark.png')});
  await page.locator('.usage-account-filter').getByRole('combobox').click();
  await page.screenshot({path:join(output,'usage-account-selector-en-dark.png')});
  await page.getByRole('option', {name:'All',exact:true}).click();
  assert.deepEqual(errors, [], 'Focused usage checks must not trigger runtime errors');
  const commands = await page.evaluate(() => window.usageFixture.commands);
  assert.equal(commands.some(({command}) => /^identities_(stop|save|switch|delete)$|^system_(set|disable)|^browser_(launch|quit|clear|save|align|set)/.test(command)), false, 'Checks must remain synthetic and read-only');
  const requests = await page.evaluate(() => window.usageFixture.requests);
  assert.equal(requests.some(({accountId}) => accountId === 'unattributed'), false, 'UI must only query All or ordinary account IDs');
  const result = {status:'passed', checks:['all = confirmed accounts + remaining recorded counters','four token categories and shares','USD API cost and cache savings','zero versus legacy activity TSV','all eight model rows including unrecorded model','All plus dynamic ordinary accounts only','ordinary account-scoped TSV without extra labels','aligned TSV summary columns','no historical-rule or extra account UI','bilingual light/dark narrow/default geometry','no runtime errors or native mutations'], layouts, screenshots:output};
  await writeFile(join(output,'usage-reliability-results.json'), JSON.stringify(result,null,2));
  console.log(JSON.stringify({status:result.status, checks:result.checks.length, layouts:layouts.length, screenshots:output}));
}
