/**
 * [INPUT]: Node.js 标准管道、playwright-core、Vite 与 tests/handoff.html 隔离入口。
 * [OUTPUT]: 验证 TaskHandoff 的真实 File input 交互、64KiB 大小截断、模板解析、纯文本预览与非空草稿替换 AlertDialog 确认。
 * [POS]: Phase 6E 合成前端 UI 回归脚本；无真实网络、无账号、无会话读写。
 * [PROTOCOL]: 变更时更新头部。
 */
import {strict as assert} from 'node:assert';
import {resolve, join} from 'node:path';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
import {HANDOFF_VERSION_MARKER} from '../src/handoff-model.ts';

const engine = process.platform === 'darwin'
  ? 'Browser.app/Contents/MacOS/Chromium'
  : process.platform === 'win32'
    ? 'WindowsBrowser/chrome.exe'
    : 'LinuxBrowser/chrome';

const server = await createServer({
  server: {
    host: '127.0.0.1',
    port: 0,
    strictPort: false,
    watch: {
      ignored: ['**/src-tauri/**', '**/browser-runtime/**', '**/releases/**', '**/dist/**'],
    },
  },
  optimizeDeps: {
    include: ['@tauri-apps/api/mocks'],
  },
});

await server.listen();
const address = server.httpServer!.address() as {port: number};
const base = `http://127.0.0.1:${address.port}`;
console.log('Server running at', base);

const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('APPLE_') && !key.startsWith('TAURI_SIGNING_PRIVATE_KEY'))
) as Record<string, string>;

const temporary = await mkdtemp(join(tmpdir(), 'claude-local-handoff-ui-'));
for (const name of ['config', 'cache']) await mkdir(join(temporary, name));
Object.assign(env, {HOME: temporary, XDG_CONFIG_HOME: join(temporary, 'config'), XDG_CACHE_HOME: join(temporary, 'cache')});

let browser;
try {
  console.log('Launching browser...');
  browser = await chromium.launch({
    executablePath: resolve('browser-runtime', engine),
    headless: true,
    env,
  });
  console.log('Browser launched. Navigating to', `${base}/tests/handoff.html`);

  const context = await browser.newContext({viewport: {width: 1040, height: 820}, reducedMotion: 'no-preference'});
  await context.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('console', msg => console.log('BROWSER LOG:', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  page.on('response', res => { if (res.status() >= 400) console.log('HTTP ERROR:', res.status(), res.url()); });
  await page.goto(`${base}/tests/handoff.html`, {waitUntil: 'domcontentloaded', timeout: 30000});
  console.log('Waiting for .task-handoff...');
  const handoff = page.locator('.task-handoff');
  await handoff.waitFor({state: 'visible', timeout: 15000});
  console.log('Found .task-handoff!');

  const taskInput = handoff.locator('input[id$="task"]');
  const goalTextarea = handoff.locator('textarea[id$="goal"]');
  assert.equal(await taskInput.count(), 1, 'Task input should be present');
  assert.equal(await goalTextarea.count(), 1, 'Goal textarea should be present');

  const preview = handoff.locator('pre.task-handoff-preview');
  const initialPreview = await preview.innerText();
  assert.ok(initialPreview.includes(HANDOFF_VERSION_MARKER), 'Preview must contain version marker');
  assert.ok(initialPreview.includes('To be filled in') || initialPreview.includes('待补充'), 'Preview must contain placeholders');

  const fileInput = page.locator('input[data-testid="handoff-file-input"]');
  assert.equal(await fileInput.count(), 1, 'Hidden file input should exist');

  // Step 2: Import into empty draft (should populate without confirmation dialog)
  const validDoc1 = `${HANDOFF_VERSION_MARKER}
# 任务交接模板

## 任务 <!-- handoff:task -->

First imported task

## 目标 <!-- handoff:goal -->

First imported goal

## 当前进展与验证状态 <!-- handoff:progress -->

First imported progress

## 下一步 <!-- handoff:next -->

First imported next

## 验证状态与未覆盖项 <!-- handoff:verification -->

待补充

## 约束与已定决策 <!-- handoff:constraints -->

First imported constraints`;

  await fileInput.setInputFiles({
    name: 'handoff-1.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(validDoc1, 'utf-8'),
  });

  // Verify status is loaded
  const statusSpan = handoff.locator('.task-handoff-actions > span');
  await statusSpan.waitFor({state: 'visible'});
  const statusText1 = await statusSpan.innerText();
  assert.ok(
    statusText1.includes('已载入') || statusText1.includes('loaded') || statusText1.includes('Handoff notes loaded'),
    `Status should indicate loaded, got: "${statusText1}"`
  );

  // Verify field values
  assert.equal(await taskInput.inputValue(), 'First imported task', 'Task should be populated');
  assert.equal(await goalTextarea.inputValue(), 'First imported goal', 'Goal should be populated');
  assert.equal(await handoff.locator('textarea[id$="verification"]').inputValue(), '', 'Placeholder maps to empty string');

  // Step 3: Test oversize file rejection (> 64 KiB)
  const oversizeBuffer = Buffer.alloc(66 * 1024, 65); // 66 KiB
  await fileInput.setInputFiles({
    name: 'oversize.md',
    mimeType: 'text/markdown',
    buffer: oversizeBuffer,
  });

  const statusTextOversize = await statusSpan.innerText();
  assert.ok(
    statusTextOversize.includes('文件过大') || statusTextOversize.includes('fileTooLarge') || statusTextOversize.includes('File too large'),
    `Oversize error expected, got: "${statusTextOversize}"`
  );
  // Fields must remain untouched
  assert.equal(await taskInput.inputValue(), 'First imported task', 'Task remains unchanged after oversize rejection');

  // Step 4: Test malformed/unknown markdown rejection
  const unknownMd = `# Random Note\n\n## Installation\n\nrun npm install\n\n## Usage\n\nrun test`;
  await fileInput.setInputFiles({
    name: 'readme.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(unknownMd, 'utf-8'),
  });
  await page.waitForTimeout(150);

  const statusTextUnknown = await statusSpan.innerText();
  assert.ok(
    statusTextUnknown.includes('不支持') || statusTextUnknown.includes('unknownTemplate') || statusTextUnknown.includes('Unsupported'),
    `Unknown template rejection expected, got: "${statusTextUnknown}"`
  );
  assert.equal(await taskInput.inputValue(), 'First imported task', 'Task remains unchanged after unknown rejection');

  // Step 5: Import into non-empty draft -> MUST trigger review and confirmation AlertDialog!
  const validDoc2 = `${HANDOFF_VERSION_MARKER}
# Task handoff template

## Task <!-- handoff:task -->

Second incoming task

## Goal <!-- handoff:goal -->

Second incoming goal

## Current progress and verification <!-- handoff:progress -->

Second incoming progress

## Next steps <!-- handoff:next -->

Second incoming next

## Verification and unchecked items <!-- handoff:verification -->

Second incoming verification

## Constraints and decisions <!-- handoff:constraints -->

Second incoming constraints`;

  await fileInput.setInputFiles({
    name: 'handoff-second.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(validDoc2, 'utf-8'),
  });

  // Verify confirmation dialog opened
  const confirmDialog = page.locator('.task-handoff-confirm-dialog');
  await confirmDialog.waitFor({state: 'visible'});

  // Verify confirmation dialog renders plain text preview and file name
  const confirmPreview = confirmDialog.locator('pre.task-handoff-preview');
  assert.ok(await confirmPreview.isVisible(), 'Confirmation dialog must show plain text preview');
  const confirmPreviewText = await confirmPreview.innerText();
  assert.ok(confirmPreviewText.includes('Second incoming task'), 'Preview must show incoming content');
  assert.ok((await confirmDialog.innerText()).includes('handoff-second.md'), 'Must display file name');

  // Test Cancel button keeps existing draft
  const cancelButton = confirmDialog.locator('[data-dialog-cancel]');
  await cancelButton.click();
  await confirmDialog.waitFor({state: 'hidden'});

  // Verify original draft was NOT replaced
  assert.equal(await taskInput.inputValue(), 'First imported task', 'Draft must be preserved after Cancel');

  // Now trigger import again and click Confirm
  await fileInput.setInputFiles({
    name: 'handoff-second.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(validDoc2, 'utf-8'),
  });

  await confirmDialog.waitFor({state: 'visible'});
  const confirmButton = confirmDialog.locator('button:has-text("确认替换"), button:has-text("Replace draft")');
  await confirmButton.click();
  await confirmDialog.waitFor({state: 'hidden'});

  // Verify draft is now replaced
  assert.equal(await taskInput.inputValue(), 'Second incoming task', 'Task must be replaced after Confirm');
  assert.equal(await goalTextarea.inputValue(), 'Second incoming goal', 'Goal must be replaced after Confirm');

  console.log('PASS: Synthetic UI handoff test passed completely.');
} finally {
  if (browser) await browser.close();
  await server.close();
  await rm(temporary, {recursive: true, force: true});
}
