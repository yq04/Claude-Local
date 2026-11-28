/**
 * [INPUT]: scripts/e2e/lib/{types,sandbox,mock-proxy,mock-network,chrome-harness,rust-blackbox}.ts 与仓库 src/browser-verification.ts 等纯模型。
 * [OUTPUT]: 导出 cases: []（满足 run.ts loadSuites 校验）及安全/隔离/双模式判定/Rust与JS源码词法解析/沙盒 Junction/回环扩展回调/Vite 验证与风控 UI 公共辅助函数。
 * [POS]: E2 安全性与兼容性套件共享辅助模块；严格隔离执行，严禁修改宿主机或绕过真实探测。
 * [PROTOCOL]: 变更时更新此头部，然后检查 scripts/e2e/CLAUDE.md
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { join, normalize, resolve, sep } from 'node:path';
import tls from 'node:tls';
import type { Page } from 'playwright-core';
import {
  buildMockIpcShellHtml,
  launchPersistentProfile,
  launchPinnedChrome,
  openMockedAppPage,
  startViteServer,
} from '../lib/chrome-harness.ts';
import { extractProductionCsp, type MockNetworkSuite } from '../lib/mock-network.ts';
import type { MockHttpConnectProxy } from '../lib/mock-proxy.ts';
import type {
  E2ECase,
  E2ECaseOutcome,
  RunMode,
  SandboxHandle,
} from '../lib/types.ts';

// Satisfies scripts/e2e/run.ts loadSuites() contract for files in scripts/e2e/suites/
export const cases: E2ECase[] = [];

export const DANGEROUS_SETTINGS_KEYS = [
  'apiKeyHelper',
  'otelHeadersHelper',
  'awsAuthRefresh',
  'customHeaders',
  'statusLine',
] as const;

export const UNSUPPORTED_EXIT_COUNTRIES = [
  'CN',
  'HK',
  'MO',
  'RU',
  'BY',
  'KP',
  'IR',
  'SY',
  'CU',
] as const;

export function gapOrFail(
  mode: RunMode,
  summary: string,
  metrics?: Record<string, number | string | boolean>,
): E2ECaseOutcome {
  return {
    status: mode === 'baseline' ? 'baseline_gap' : 'fail',
    summary,
    ...(metrics ? { metrics } : {}),
  };
}

export function readRepoText(repoRoot: string, relPath: string): string {
  return readFileSync(resolve(repoRoot, relPath), 'utf8');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isIdentChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_]/.test(ch);
}

/**
 * Try to advance past a Rust string or char literal starting at `index`.
 * Returns the index immediately after the literal, or -1 if `src[index]` does not start a literal.
 * Never mistakes a Rust lifetime (`'a`, `'static`) for a char literal.
 */
function advanceRustLiteral(src: string, index: number): number {
  const ch = src[index];
  const prev = index > 0 ? src[index - 1] : undefined;

  // Raw string: r"...", r#"..."#, br#"..."#, cr#"..."#
  if (
    !isIdentChar(prev) &&
    (ch === 'r' || ((ch === 'b' || ch === 'c') && src[index + 1] === 'r'))
  ) {
    let p = ch === 'r' ? index + 1 : index + 2;
    let hashes = 0;
    while (src[p] === '#') {
      hashes++;
      p++;
    }
    if (src[p] === '"') {
      p++;
      while (p < src.length) {
        if (src[p] === '"') {
          let matched = 0;
          while (matched < hashes && src[p + 1 + matched] === '#') {
            matched++;
          }
          if (matched === hashes) {
            return p + 1 + hashes;
          }
        }
        p++;
      }
      return src.length;
    }
  }

  // Byte/C/normal string: "...", b"...", c"..."
  if (ch === '"' || ((ch === 'b' || ch === 'c') && src[index + 1] === '"' && !isIdentChar(prev))) {
    let p = ch === '"' ? index + 1 : index + 2;
    while (p < src.length) {
      if (src[p] === '\\') {
        p += 2;
        continue;
      }
      if (src[p] === '"') {
        return p + 1;
      }
      p++;
    }
    return src.length;
  }

  // Byte char literal: b'x' / b'\x7f'
  if (ch === 'b' && src[index + 1] === "'" && !isIdentChar(prev)) {
    const close = findRustCharLiteralEnd(src, index + 1);
    if (close !== -1) return close;
  }

  // Char literal: 'x', '\n', '\'', '\x7f', '\u{10ffff}' (distinct from lifetimes like 'a / 'static)
  if (ch === "'") {
    const close = findRustCharLiteralEnd(src, index);
    if (close !== -1) return close;
  }

  return -1;
}

function findRustCharLiteralEnd(src: string, quoteIdx: number): number {
  if (src[quoteIdx] !== "'") return -1;
  const next = src[quoteIdx + 1];
  if (next === undefined || next === '\n' || next === '\r') return -1;
  if (next === '\\') {
    let p = quoteIdx + 2;
    const limit = Math.min(src.length, quoteIdx + 16);
    if (p < limit) p++; // skip escaped char
    while (p < limit) {
      if (src[p] === '\n' || src[p] === '\r') return -1;
      if (src[p] === "'") return p + 1;
      p++;
    }
    return -1;
  }
  if (next !== "'" && src[quoteIdx + 2] === "'") {
    return quoteIdx + 3;
  }
  return -1;
}

function findRustMatchingDelim(src: string, openIdx: number, openCh: string, closeCh: string): number {
  let depth = 0;
  let i = openIdx;
  while (i < src.length) {
    const litEnd = advanceRustLiteral(src, i);
    if (litEnd !== -1) {
      i = litEnd;
      continue;
    }
    if (src[i] === openCh) {
      depth++;
    } else if (src[i] === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * Lexically strip line (`//`) and nested block comments from Rust source,
 * preserving string/raw-string/char literals and line breaks.
 */
export function stripRustComments(src: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const litEnd = advanceRustLiteral(src, i);
    if (litEnd !== -1) {
      out.push(src.slice(i, litEnd));
      i = litEnd;
      continue;
    }
    if (src[i] === '/' && src[i + 1] === '/') {
      i += 2;
      while (i < src.length && src[i] !== '\n') {
        i++;
      }
      continue;
    }
    if (src[i] === '/' && src[i + 1] === '*') {
      let depth = 1;
      i += 2;
      let hadNewline = false;
      while (i < src.length && depth > 0) {
        if (src[i] === '/' && src[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (src[i] === '*' && src[i + 1] === '/') {
          depth--;
          i += 2;
        } else {
          if (src[i] === '\n') {
            out.push('\n');
            hadNewline = true;
          }
          i++;
        }
      }
      if (!hadNewline) out.push(' ');
      continue;
    }
    out.push(src[i]);
    i++;
  }
  return out.join('');
}

/**
 * Strip Rust comments, `#[cfg(test)] mod ...` blocks/declarations, `#[cfg(test)] use ...;`,
 * and `#[test]` / `#[tokio::test]` functions so source probes never match comments or unit tests.
 */
export function stripRustCommentsAndTests(src: string): string {
  const clean = stripRustComments(src);
  const out: string[] = [];
  let i = 0;

  while (i < clean.length) {
    const litEnd = advanceRustLiteral(clean, i);
    if (litEnd !== -1) {
      out.push(clean.slice(i, litEnd));
      i = litEnd;
      continue;
    }

    if (clean[i] === '#' && clean[i + 1] === '[') {
      const attrClose = findRustMatchingDelim(clean, i + 1, '[', ']');
      if (attrClose !== -1) {
        const attrText = clean.slice(i, attrClose + 1).replace(/\s+/g, ' ');
        const isCfgTest = /^#\[cfg\((?:test|all\([^)]*\btest\b[^)]*\))\)\]$/.test(attrText);
        const isUnitTestFn = /^#\[(?:[\w:]+::)?test(?:\([^)]*\))?\]$/.test(attrText);

        if (isCfgTest || isUnitTestFn) {
          let cursor = attrClose + 1;
          // Consume any stacked attributes such as #[allow(...)]
          while (cursor < clean.length) {
            while (cursor < clean.length && /\s/.test(clean[cursor])) cursor++;
            if (clean[cursor] === '#' && clean[cursor + 1] === '[') {
              const nextClose = findRustMatchingDelim(clean, cursor + 1, '[', ']');
              if (nextClose === -1) break;
              cursor = nextClose + 1;
            } else {
              break;
            }
          }

          if (isCfgTest) {
            const modRe = /(?:pub(?:\([^)]*\))?\s+)?mod\s+[A-Za-z_][A-Za-z0-9_]*\s*/y;
            modRe.lastIndex = cursor;
            const modMatch = modRe.exec(clean);
            if (modMatch) {
              const afterMod = modRe.lastIndex;
              if (clean[afterMod] === '{') {
                const modEnd = findRustMatchingDelim(clean, afterMod, '{', '}');
                if (modEnd !== -1) {
                  out.push('\n');
                  i = modEnd + 1;
                  continue;
                }
              } else if (clean[afterMod] === ';') {
                out.push('\n');
                i = afterMod + 1;
                continue;
              }
            }
            const useRe = /(?:pub(?:\([^)]*\))?\s+)?use\s+/y;
            useRe.lastIndex = cursor;
            if (useRe.test(clean)) {
              let p = cursor;
              while (p < clean.length && clean[p] !== ';') p++;
              if (clean[p] === ';') {
                out.push('\n');
                i = p + 1;
                continue;
              }
            }
          }

          if (isUnitTestFn) {
            const fnRe =
              /(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+[A-Za-z_][A-Za-z0-9_]*\b/y;
            fnRe.lastIndex = cursor;
            if (fnRe.test(clean)) {
              const bodyOpen = findRustFnOpenBrace(clean, fnRe.lastIndex);
              if (bodyOpen !== -1) {
                const bodyEnd = findRustMatchingDelim(clean, bodyOpen, '{', '}');
                if (bodyEnd !== -1) {
                  out.push('\n');
                  i = bodyEnd + 1;
                  continue;
                }
              }
            }
          }
        }
      }
    }

    out.push(clean[i]);
    i++;
  }

  return out.join('');
}

function findRustFnOpenBrace(cleanSrc: string, afterFnNameIdx: number): number {
  let i = afterFnNameIdx;
  while (i < cleanSrc.length && /\s/.test(cleanSrc[i])) i++;
  if (cleanSrc[i] === '<') {
    let angle = 0;
    while (i < cleanSrc.length) {
      const litEnd = advanceRustLiteral(cleanSrc, i);
      if (litEnd !== -1) {
        i = litEnd;
        continue;
      }
      if (cleanSrc[i] === '<') angle++;
      else if (cleanSrc[i] === '>') {
        angle--;
        if (angle === 0) {
          i++;
          break;
        }
      }
      i++;
    }
  }
  while (i < cleanSrc.length && /\s/.test(cleanSrc[i])) i++;
  if (cleanSrc[i] !== '(') return -1;
  const closeParen = findRustMatchingDelim(cleanSrc, i, '(', ')');
  if (closeParen === -1) return -1;

  let j = closeParen + 1;
  let parenDepth = 0;
  let bracketDepth = 0;
  while (j < cleanSrc.length) {
    const litEnd = advanceRustLiteral(cleanSrc, j);
    if (litEnd !== -1) {
      j = litEnd;
      continue;
    }
    const ch = cleanSrc[j];
    if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (ch === '[') bracketDepth++;
    else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    else if (parenDepth === 0 && bracketDepth === 0) {
      if (ch === '{') return j;
      if (ch === ';') return -1;
    }
    j++;
  }
  return -1;
}

export function hasRustFn(cleanSrc: string, fnName: string): boolean {
  const sigRe = new RegExp(
    `(?:pub(?:\\([^)]*\\))?\\s+)?(?:const\\s+)?(?:async\\s+)?(?:unsafe\\s+)?(?:extern\\s+"[^"]*"\\s+)?fn\\s+${escapeRegExp(fnName)}\\b`,
    'y',
  );
  let i = 0;
  while (i < cleanSrc.length) {
    const litEnd = advanceRustLiteral(cleanSrc, i);
    if (litEnd !== -1) {
      i = litEnd;
      continue;
    }
    const prev = i > 0 ? cleanSrc[i - 1] : undefined;
    if (!isIdentChar(prev)) {
      sigRe.lastIndex = i;
      const m = sigRe.exec(cleanSrc);
      if (m) {
        const openBrace = findRustFnOpenBrace(cleanSrc, sigRe.lastIndex);
        if (openBrace !== -1 && findRustMatchingDelim(cleanSrc, openBrace, '{', '}') !== -1) {
          return true;
        }
      }
    }
    i++;
  }
  return false;
}

/**
 * Extract a Rust function (signature + `{ ... }` body) by exact function name using balanced braces.
 * Supports `pub`, `pub(crate)`, `pub(super)`, `async`, `const`, `unsafe`, and generic parameters.
 * Throws explicitly if the function cannot be found or braces are unbalanced (never returns `""`).
 */
export function extractRustFnBody(cleanSrc: string, fnName: string): string {
  const sigRe = new RegExp(
    `(?:pub(?:\\([^)]*\\))?\\s+)?(?:const\\s+)?(?:async\\s+)?(?:unsafe\\s+)?(?:extern\\s+"[^"]*"\\s+)?fn\\s+${escapeRegExp(fnName)}\\b`,
    'y',
  );
  let i = 0;
  while (i < cleanSrc.length) {
    const litEnd = advanceRustLiteral(cleanSrc, i);
    if (litEnd !== -1) {
      i = litEnd;
      continue;
    }
    const prev = i > 0 ? cleanSrc[i - 1] : undefined;
    if (!isIdentChar(prev)) {
      sigRe.lastIndex = i;
      const m = sigRe.exec(cleanSrc);
      if (m) {
        const openBrace = findRustFnOpenBrace(cleanSrc, sigRe.lastIndex);
        if (openBrace !== -1) {
          const closeBrace = findRustMatchingDelim(cleanSrc, openBrace, '{', '}');
          if (closeBrace === -1) {
            throw new Error(`extractRustFnBody: unbalanced braces in fn '${fnName}'`);
          }
          return cleanSrc.slice(i, closeBrace + 1);
        }
      }
    }
    i++;
  }
  throw new Error(`extractRustFnBody: function '${fnName}' not found`);
}

/**
 * Extract a braced Rust block (e.g. `impl Default for Config { ... }`) using balanced braces.
 * Throws explicitly if not found or unbalanced.
 */
export function extractRustBlock(cleanSrc: string, headerPattern: RegExp): string {
  const sticky = new RegExp(
    headerPattern.source.replace(/^\^/, ''),
    headerPattern.flags.replace(/g/g, '') + 'y',
  );
  let i = 0;
  while (i < cleanSrc.length) {
    const litEnd = advanceRustLiteral(cleanSrc, i);
    if (litEnd !== -1) {
      i = litEnd;
      continue;
    }
    const prev = i > 0 ? cleanSrc[i - 1] : undefined;
    if (!isIdentChar(prev)) {
      sticky.lastIndex = i;
      if (sticky.test(cleanSrc)) {
        let j = sticky.lastIndex;
        while (j < cleanSrc.length && cleanSrc[j] !== '{') {
          const innerLit = advanceRustLiteral(cleanSrc, j);
          if (innerLit !== -1) {
            j = innerLit;
            continue;
          }
          if (cleanSrc[j] === ';') break;
          j++;
        }
        if (cleanSrc[j] === '{') {
          const closeBrace = findRustMatchingDelim(cleanSrc, j, '{', '}');
          if (closeBrace === -1) {
            throw new Error(`extractRustBlock: unbalanced braces for ${headerPattern}`);
          }
          return cleanSrc.slice(i, closeBrace + 1);
        }
      }
    }
    i++;
  }
  throw new Error(`extractRustBlock: block matching ${headerPattern} not found`);
}

const JS_REGEX_PREFIX_KEYWORDS = new Set([
  'return',
  'throw',
  'case',
  'default',
  'in',
  'instanceof',
  'of',
  'typeof',
  'void',
  'delete',
  'await',
  'yield',
  'else',
  'do',
  'new',
]);

/**
 * Lexically strip line (`//`) and block comments from JavaScript source while preserving
 * string literals, template literals (`${...}`), and regex literals (`/pattern/flags`).
 */
export function stripJsComments(src: string): string {
  const out: string[] = [];
  let i = 0;
  let canStartRegex = true;
  const templateBraceStack: number[] = [];
  let braceDepth = 0;

  const scanTemplateChunk = (): void => {
    while (i < src.length) {
      const ch = src[i];
      if (ch === '\\') {
        out.push(src.slice(i, i + 2));
        i += 2;
        continue;
      }
      if (ch === '`') {
        out.push('`');
        i++;
        canStartRegex = false;
        return;
      }
      if (ch === '$' && src[i + 1] === '{') {
        out.push('${');
        i += 2;
        braceDepth++;
        templateBraceStack.push(braceDepth);
        canStartRegex = true;
        return;
      }
      out.push(ch);
      i++;
    }
  };

  while (i < src.length) {
    const ch = src[i];

    // Comments
    if (ch === '/' && src[i + 1] === '/') {
      i += 2;
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      let hadNewline = false;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') {
          out.push('\n');
          hadNewline = true;
        }
        i++;
      }
      if (i < src.length) i += 2;
      if (!hadNewline) out.push(' ');
      continue;
    }

    // String literals
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      out.push(src.slice(start, i));
      canStartRegex = false;
      continue;
    }

    // Template literal start
    if (ch === '`') {
      out.push('`');
      i++;
      scanTemplateChunk();
      continue;
    }

    // Regex literal
    if (ch === '/' && canStartRegex) {
      const start = i;
      i++;
      let inClass = false;
      while (i < src.length) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === '[') {
          inClass = true;
        } else if (src[i] === ']' && inClass) {
          inClass = false;
        } else if (src[i] === '/' && !inClass) {
          i++;
          while (i < src.length && /[a-zA-Z]/.test(src[i])) i++;
          break;
        } else if (src[i] === '\n' || src[i] === '\r') {
          break;
        }
        i++;
      }
      out.push(src.slice(start, i));
      canStartRegex = false;
      continue;
    }

    // Whitespace
    if (/\s/.test(ch)) {
      out.push(ch);
      i++;
      continue;
    }

    // Identifiers / keywords
    if (/[A-Za-z_$]/.test(ch)) {
      const start = i;
      i++;
      while (i < src.length && /[A-Za-z0-9_$]/.test(src[i])) i++;
      const word = src.slice(start, i);
      out.push(word);
      canStartRegex = JS_REGEX_PREFIX_KEYWORDS.has(word);
      continue;
    }

    // Numbers
    if (/[0-9]/.test(ch)) {
      const start = i;
      i++;
      while (i < src.length && /[0-9a-zA-Z_.]/.test(src[i])) i++;
      out.push(src.slice(start, i));
      canStartRegex = false;
      continue;
    }

    // Braces (including resuming template literal after ${...})
    if (ch === '{') {
      braceDepth++;
      out.push('{');
      i++;
      canStartRegex = true;
      continue;
    }
    if (ch === '}') {
      out.push('}');
      i++;
      if (
        templateBraceStack.length > 0 &&
        templateBraceStack[templateBraceStack.length - 1] === braceDepth
      ) {
        templateBraceStack.pop();
        braceDepth--;
        scanTemplateChunk();
        continue;
      }
      braceDepth = Math.max(0, braceDepth - 1);
      canStartRegex = true;
      continue;
    }

    if ((ch === '+' && src[i + 1] === '+') || (ch === '-' && src[i + 1] === '-')) {
      out.push(src.slice(i, i + 2));
      i += 2;
      canStartRegex = false;
      continue;
    }

    out.push(ch);
    i++;
    canStartRegex = ch !== ')' && ch !== ']' && ch !== '.';
  }

  return out.join('');
}

export function hasJsTopFrameGuard(cleanJs: string): boolean {
  return (
    /\bsender\.frameId\s*(?:!==|!=|>)\s*0\b/.test(cleanJs) ||
    /\b0\s*(?:!==|!=|<)\s*sender\.frameId\b/.test(cleanJs) ||
    /\bNumber\(\s*sender\.frameId\s*\)\s*(?:!==|!=|>)\s*0\b/.test(cleanJs) ||
    /\b(?:if|&&|\|\|)\s*\(?[^{;]*\bsender\.frameId\s*(?:===|==)\s*0\b/.test(cleanJs)
  );
}

export function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
  const nCand = normalize(resolve(candidatePath));
  const nRoot = normalize(resolve(rootPath));
  const c = process.platform === 'win32' ? nCand.toLowerCase() : nCand;
  const r = process.platform === 'win32' ? nRoot.toLowerCase() : nRoot;
  if (c === r) return true;
  const prefix = r.endsWith(sep) ? r : r + sep;
  return c.startsWith(prefix);
}

export function findDangerousSettingsKeys(obj: Record<string, unknown>): string[] {
  const found: string[] = [];
  for (const key of DANGEROUS_SETTINGS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      found.push(key);
    }
  }
  const envObj = obj.env;
  if (envObj && typeof envObj === 'object' && !Array.isArray(envObj)) {
    for (const key of DANGEROUS_SETTINGS_KEYS) {
      if (Object.prototype.hasOwnProperty.call(envObj, key)) {
        found.push(`env.${key}`);
      }
    }
  }
  return found;
}

export function createSandboxJunction(
  sb: SandboxHandle,
  junctionPath: string,
  targetDir: string,
): void {
  if (!isPathWithinRoot(junctionPath, sb.paths.root)) {
    throw new Error(`Junction path escapes sandbox: ${junctionPath}`);
  }
  if (!isPathWithinRoot(targetDir, sb.paths.root)) {
    throw new Error(`Junction target must remain inside sandbox: ${targetDir}`);
  }
  mkdirSync(targetDir, { recursive: true });
  const res = spawnSync(
    'cmd.exe',
    ['/d', '/c', 'mklink', '/J', resolve(junctionPath), resolve(targetDir)],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    },
  );
  if (res.status !== 0) {
    throw new Error(
      `mklink /J failed (${res.status}): ${res.stdout ?? ''} ${res.stderr ?? ''}`,
    );
  }
}

export function removeSandboxJunction(junctionPath: string): void {
  const resolved = resolve(junctionPath);
  let st;
  try {
    st = lstatSync(resolved);
  } catch {
    return;
  }
  if (!st.isSymbolicLink()) {
    throw new Error(`Refusing to rmdir non-reparse-point path: ${resolved}`);
  }
  const res = spawnSync('cmd.exe', ['/d', '/c', 'rmdir', resolved], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000,
  });
  if (res.status !== 0) {
    throw new Error(
      `Failed to remove sandbox junction (${res.status}): ${res.stdout ?? ''} ${res.stderr ?? ''}`,
    );
  }
}

export async function findUnusedLoopbackPort(): Promise<number> {
  return await new Promise<number>((resolvePromise, rejectPromise) => {
    const srv = net.createServer();
    srv.once('error', rejectPromise);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close(() => rejectPromise(new Error('Failed to obtain ephemeral port')));
        return;
      }
      const port = addr.port;
      srv.close((err) => {
        if (err) rejectPromise(err);
        else resolvePromise(port);
      });
    });
  });
}

export async function httpsGetViaProxy(options: {
  proxyPort: number;
  targetHost: string;
  targetPort?: number;
  path: string;
  timeoutMs?: number;
}): Promise<{ statusCode: number; headers: string; body: string }> {
  const targetPort = options.targetPort ?? 443;
  const timeoutMs = options.timeoutMs ?? 6000;
  return await new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let tlsSock: tls.TLSSocket | null = null;
    const socket = net.connect({ host: '127.0.0.1', port: options.proxyPort });
    let handshakeBuf = Buffer.alloc(0);

    const onSocketConnect = () => {
      socket.write(
        `CONNECT ${options.targetHost}:${targetPort} HTTP/1.1\r\nHost: ${options.targetHost}:${targetPort}\r\n\r\n`,
      );
    };
    const onConnectTimeout = () => {
      fail(new Error(`Proxy CONNECT timeout for ${options.targetHost}:${targetPort}`));
    };
    const onConnectPrematureEnd = () => {
      fail(new Error('Proxy socket closed before CONNECT response'));
    };
    const onConnectPrematureClose = () => {
      fail(new Error('Proxy socket closed before CONNECT response'));
    };
    const cleanupConnectListeners = () => {
      socket.off('connect', onSocketConnect);
      socket.off('data', onConnectData);
      socket.off('timeout', onConnectTimeout);
      socket.off('end', onConnectPrematureEnd);
      socket.off('close', onConnectPrematureClose);
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanupConnectListeners();
      socket.off('error', fail);
      socket.setTimeout(0);
      if (tlsSock && !tlsSock.destroyed) tlsSock.destroy();
      if (!socket.destroyed) socket.destroy();
      rejectPromise(err);
    };

    socket.setTimeout(timeoutMs);
    socket.once('timeout', onConnectTimeout);
    socket.once('error', fail);
    socket.once('end', onConnectPrematureEnd);
    socket.once('close', onConnectPrematureClose);
    socket.once('connect', onSocketConnect);

    function onConnectData(chunk: Buffer): void {
      handshakeBuf = Buffer.concat([handshakeBuf, chunk]);
      const headerEnd = handshakeBuf.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;

      cleanupConnectListeners();
      socket.setTimeout(0);
      const headerText = handshakeBuf.subarray(0, headerEnd).toString('utf8');
      const statusLine = headerText.split('\r\n')[0] ?? '';
      const statusMatch = statusLine.match(/^HTTP\/\d\.\d\s+(\d{3})/);
      const connectStatus = statusMatch ? Number(statusMatch[1]) : 0;

      if (connectStatus !== 200) {
        settled = true;
        socket.off('error', fail);
        if (!socket.destroyed) socket.destroy();
        resolvePromise({ statusCode: connectStatus, headers: headerText, body: '' });
        return;
      }

      const leftover = handshakeBuf.subarray(headerEnd + 4);
      if (leftover.length > 0) socket.unshift(leftover);

      tlsSock = tls.connect({
        socket,
        ...(net.isIP(options.targetHost) === 0 ? { servername: options.targetHost } : {}),
        rejectUnauthorized: false,
      });
      const activeTlsSock = tlsSock;
      const onTlsTimeout = () => {
        fail(new Error(`TLS timeout on ${options.targetHost}${options.path}`));
      };
      const onTlsPrematureEnd = () => {
        fail(
          new Error(
            `TLS socket ended before handshake completed on ${options.targetHost}${options.path}`,
          ),
        );
      };
      const onTlsPrematureClose = () => {
        fail(
          new Error(
            `TLS socket closed before handshake completed on ${options.targetHost}${options.path}`,
          ),
        );
      };
      activeTlsSock.setTimeout(timeoutMs);
      activeTlsSock.once('error', fail);
      activeTlsSock.once('timeout', onTlsTimeout);
      activeTlsSock.once('end', onTlsPrematureEnd);
      activeTlsSock.once('close', onTlsPrematureClose);

      activeTlsSock.once('secureConnect', () => {
        activeTlsSock.off('end', onTlsPrematureEnd);
        activeTlsSock.off('close', onTlsPrematureClose);
        const req = http.request(
          {
            hostname: options.targetHost,
            port: targetPort,
            path: options.path,
            method: 'GET',
            headers: {
              Host: options.targetHost,
              Connection: 'close',
            },
            createConnection: () => activeTlsSock,
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (d: Buffer) => chunks.push(d));
            res.on('error', fail);
            res.on('end', () => {
              if (settled) return;
              settled = true;
              activeTlsSock.off('error', fail);
              activeTlsSock.off('timeout', onTlsTimeout);
              activeTlsSock.setTimeout(0);
              socket.off('error', fail);
              if (!activeTlsSock.destroyed) activeTlsSock.destroy();
              if (!socket.destroyed) socket.destroy();
              resolvePromise({
                statusCode: res.statusCode ?? 0,
                headers: JSON.stringify(res.headers),
                body: Buffer.concat(chunks).toString('utf8'),
              });
            });
          },
        );
        req.on('error', fail);
        req.end();
      });
    }

    socket.on('data', onConnectData);
  });
}

export interface CapturedQuotaCallback {
  method: string;
  path: string;
  host: string | undefined;
  origin: string | undefined;
  contentType: string | undefined;
  rawBody: string;
  json: Record<string, unknown> | null;
  receivedAtMs: number;
}

export interface LoopbackQuotaBridgeServer {
  port: number;
  baseUrl: string;
  token: string;
  callbacks: CapturedQuotaCallback[];
  waitForCallback(count?: number, timeoutMs?: number): Promise<CapturedQuotaCallback[]>;
  close(): Promise<void>;
}

export async function startLoopbackQuotaCallbackServer(
  token: string,
): Promise<LoopbackQuotaBridgeServer> {
  const callbacks: CapturedQuotaCallback[] = [];
  const waiters: Array<() => void> = [];
  const server = http.createServer((req, res) => {
    const urlPath = (req.url ?? '/').split('?')[0];
    if (req.method === 'GET' && urlPath === `/${token}/browser.html`) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(
        '<!doctype html><html><head><meta charset="utf-8"><title>Quota Sync</title></head><body><main id="sync-bridge">Pairing</main></body></html>',
      );
      return;
    }

    if (urlPath === `/${token}/quota-sync` && req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': 'chrome-extension://ejcmmmehjkifepdoejgbaleeogcfagjg',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type',
        Vary: 'Origin',
      });
      res.end();
      return;
    }

    if (urlPath === `/${token}/quota-sync` && req.method === 'POST') {
      const chunks: Buffer[] = [];
      req.on('data', (d: Buffer) => chunks.push(d));
      req.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        let json: Record<string, unknown> | null = null;
        try {
          json = JSON.parse(rawBody) as Record<string, unknown>;
        } catch {
          json = null;
        }
        callbacks.push({
          method: req.method ?? 'POST',
          path: urlPath,
          host: req.headers.host,
          origin: req.headers.origin,
          contentType: req.headers['content-type'],
          rawBody,
          json,
          receivedAtMs: Date.now(),
        });
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': 'chrome-extension://ejcmmmehjkifepdoejgbaleeogcfagjg',
          Vary: 'Origin',
        });
        res.end('{"ok":true}');
        while (waiters.length > 0) {
          const w = waiters.shift();
          w?.();
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectPromise);
      resolvePromise();
    });
  });

  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    server.close();
    throw new Error('Failed to bind loopback quota callback server');
  }

  return {
    port: addr.port,
    baseUrl: `http://127.0.0.1:${addr.port}`,
    token,
    callbacks,
    async waitForCallback(count = 1, timeoutMs = 15_000): Promise<CapturedQuotaCallback[]> {
      const deadline = Date.now() + timeoutMs;
      while (callbacks.length < count) {
        const rem = deadline - Date.now();
        if (rem <= 0) {
          throw new Error(
            `Timed out waiting for ${count} MV3 quota-sync callback(s); got ${callbacks.length}`,
          );
        }
        await new Promise<void>((resolveWait) => {
          const timer = setTimeout(() => {
            const idx = waiters.indexOf(onSignal);
            if (idx >= 0) waiters.splice(idx, 1);
            resolveWait();
          }, Math.min(rem, 250));
          const onSignal = () => {
            clearTimeout(timer);
            resolveWait();
          };
          waiters.push(onSignal);
        });
      }
      return callbacks;
    },
    async close(): Promise<void> {
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    },
  };
}

export function resolvePowerShellBinary(): string {
  const candidates = [
    'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    'pwsh.exe',
    'powershell.exe',
  ];
  for (const bin of candidates) {
    if (bin.includes('\\')) {
      if (existsSync(bin) && statSync(bin).isFile()) return bin;
      continue;
    }
    const probe = spawnSync('where.exe', [bin], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000,
    });
    if (probe.status === 0 && (probe.stdout ?? '').trim()) {
      return bin;
    }
  }
  return 'powershell.exe';
}

export interface BrowserStartHarnessOptions {
  repoRoot: string;
  sb: SandboxHandle;
  netSuite?: MockNetworkSuite;
  seed?: number;
  uiLanguage?: 'zh' | 'en';
  exitServices?: string[];
  exitClassificationService?: string;
  useMockNetworkGeoip?: boolean;
  spoofWebglRenderer?: string;
  spoofWebdriverTrue?: boolean;
  spoofNonLocalWebrtc?: boolean;
  spoofAntiTamper?: boolean;
  spoofWorkerMismatch?: boolean;
}

export async function runBrowserStartInPinnedChrome(
  opts: BrowserStartHarnessOptions,
): Promise<{
  phase: string;
  okCount: number;
  failedCount: number;
  pendingCount: number;
  failedCheckIds: string[];
  crossContextPillCount: number;
  crossContextMetricCount: number;
  crossContextBlocking: boolean;
  bodyText: string;
  pageErrors: string[];
}> {
  const vite = await startViteServer({
    repoRoot: opts.repoRoot,
    sandbox: opts.sb,
  });
  const csp = extractProductionCsp(opts.repoRoot);

  let activePage: Page | null = null;
  const persistent = await launchPersistentProfile({
    repoRoot: opts.repoRoot,
    sandbox: opts.sb,
    profileName: `bv-${Date.now().toString(36)}`,
    headless: true,
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    argsOptions: {
      seed: opts.seed ?? 135792468,
      language: 'en-US',
      acceptLanguage: 'en-US',
      timezone: 'America/Los_Angeles',
    },
    routeHandler: async (route, abortedUrls) => {
      const url = route.request().url();
      if (url === `${vite.baseUrl}/browser.html`) {
        const response = await route.fetch();
        await route.fulfill({
          response,
          headers: {
            ...response.headers(),
            'Content-Security-Policy': `connect-src ${csp.connectSrc};`,
          },
        });
        return;
      }
      if (url === `${vite.baseUrl}/context`) {
        if (!activePage) {
          await route.abort();
          return;
        }
        const observed = await activePage.evaluate(async () => {
          const nav = navigator as unknown as {
            platform: string;
            hardwareConcurrency: number;
            userAgent: string;
            userAgentData?: {
              getHighEntropyValues?: (hints: string[]) => Promise<{
                platformVersion?: string;
                uaFullVersion?: string;
              }>;
            };
          };
          const high = await nav.userAgentData?.getHighEntropyValues?.([
            'platformVersion',
            'uaFullVersion',
          ]);
          const platform = nav.platform.toLowerCase().includes('mac')
            ? 'macos'
            : nav.platform === 'Win32'
              ? 'windows'
              : 'linux';
          return {
            platform,
            version: high?.platformVersion || '',
            cores: nav.hardwareConcurrency || 4,
            engine:
              high?.uaFullVersion ||
              nav.userAgent.match(/(?:Chrome|Chromium)\/([\d.]+)/)?.[1] ||
              '148.0.7778.215',
          };
        });
        const exitServices = opts.exitServices ?? [
          'https://api.ipquery.io/?format=json',
          'https://ipinfo.io/json',
          'https://api.ip.sb/geoip',
          'https://get.geojs.io/v1/ip/geo.json',
          'https://ipwho.is/',
        ];
        await route.fulfill({
          json: {
            identity: {
              linked: true,
              status: 'linked',
              name: 'E2E Synthetic Identity',
              email: 'e2e-browser@example.invalid',
              organization: 'E2E Org',
            },
            ui_language: opts.uiLanguage ?? 'en',
            exit_services: exitServices,
            exit_classification_service:
              opts.exitClassificationService ?? 'https://api.ipquery.io/',
            region: {
              id: 'us-la',
              label: 'US West',
              country: 'US',
              language: 'en-US',
              locale: 'en_US',
              timezone: 'America/Los_Angeles',
            },
            config: {
              seed: opts.seed ?? 135792468,
              proxy: '',
              follow_machine: false,
              language: 'en-US',
              timezone: 'America/Los_Angeles',
              native_graphics: false,
            },
            machine: {
              platform: observed.platform,
              version: observed.version,
              cores: observed.cores,
              timezone: 'America/Los_Angeles',
              languages: ['en-US'],
              locale: 'en-US',
              locale_country: 'US',
              location_enabled: false,
              timezones: ['America/Los_Angeles'],
            },
            engine_version: observed.engine,
          },
        });
        return;
      }
      if (url === `${vite.baseUrl}/report`) {
        await route.fulfill({ json: { ok: true } });
        return;
      }
      if (url.startsWith(`${vite.baseUrl}/`)) {
        await route.continue();
        return;
      }
      if (opts.netSuite && opts.useMockNetworkGeoip !== false) {
        const parsed = new URL(url);
        const geoHosts = new Set([
          'api.ipquery.io',
          'ipinfo.io',
          'api.ip.sb',
          'get.geojs.io',
          'ipwho.is',
        ]);
        if (geoHosts.has(parsed.hostname)) {
          try {
            const upstreamRes = await fetch(
              `${opts.netSuite.httpBaseUrl}${parsed.pathname}${parsed.search}`,
              {
                headers: {
                  Host: parsed.host,
                },
              },
            );
            const bodyBuf = Buffer.from(await upstreamRes.arrayBuffer());
            const headersObj: Record<string, string> = {};
            upstreamRes.headers.forEach((v, k) => {
              headersObj[k] = v;
            });
            headersObj['access-control-allow-origin'] = '*';
            await route.fulfill({
              status: upstreamRes.status,
              headers: headersObj,
              body: bodyBuf,
            });
            return;
          } catch {
            await route.abort();
            return;
          }
        }
      }
      abortedUrls.push(url);
      await route.abort();
    },
  });

  const page = await persistent.context.newPage();
  activePage = page;
  page.setDefaultTimeout(12_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.addInitScript(
    (initOpts: {
      spoofWebglRenderer?: string;
      spoofWebdriverTrue?: boolean;
      spoofNonLocalWebrtc?: boolean;
      spoofAntiTamper?: boolean;
      spoofWorkerMismatch?: boolean;
    }) => {
      const origQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (desc: PermissionDescriptor) =>
        desc.name === 'geolocation'
          ? Promise.resolve({ state: 'denied' } as PermissionStatus)
          : origQuery(desc);

      if (initOpts.spoofWebdriverTrue) {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => true,
          configurable: true,
        });
      }

      if (initOpts.spoofNonLocalWebrtc) {
        (window as unknown as Record<string, unknown>).RTCPeerConnection = class {
          onicecandidate: ((ev: { candidate: { candidate: string } | null }) => void) | null = null;
          onicegatheringstatechange: ((ev: unknown) => void) | null = null;
          iceGatheringState = 'new';
          createDataChannel() {}
          async createOffer() {
            return {};
          }
          async setLocalDescription() {
            this.onicecandidate?.({
              candidate: {
                candidate:
                  'candidate:1 1 udp 1694498815 203.0.113.55 54321 typ srflx raddr 192.168.1.2 rport 54321',
              },
            });
            this.iceGatheringState = 'complete';
            this.onicegatheringstatechange?.({});
          }
          close() {}
        };
      } else {
        (window as unknown as Record<string, unknown>).RTCPeerConnection = class {
          onicecandidate: ((ev: { candidate: { candidate: string } | null }) => void) | null = null;
          onicegatheringstatechange: ((ev: unknown) => void) | null = null;
          iceGatheringState = 'new';
          createDataChannel() {}
          async createOffer() {
            return {};
          }
          async setLocalDescription() {
            this.iceGatheringState = 'complete';
            this.onicegatheringstatechange?.({});
          }
          close() {}
        };
      }

      if (initOpts.spoofWebglRenderer) {
        const rendererOverride = initOpts.spoofWebglRenderer;
        const patchGlProto = (proto: Record<string, unknown> | undefined) => {
          if (!proto || typeof proto.getParameter !== 'function') return;
          const origGetParam = proto.getParameter as (p: number) => unknown;
          proto.getParameter = function (param: number) {
            if (param === 0x9246 || param === 0x1f01) return rendererOverride;
            if (param === 0x9245 || param === 0x1f00) return 'Google Inc. (Software)';
            return origGetParam.call(this, param);
          };
        };
        patchGlProto(
          typeof WebGLRenderingContext !== 'undefined'
            ? (WebGLRenderingContext.prototype as unknown as Record<string, unknown>)
            : undefined,
        );
        patchGlProto(
          typeof WebGL2RenderingContext !== 'undefined'
            ? (WebGL2RenderingContext.prototype as unknown as Record<string, unknown>)
            : undefined,
        );
      }

      if (initOpts.spoofAntiTamper) {
        (Error as unknown as { prepareStackTrace?: unknown }).prepareStackTrace = () => 'spoofed';
        Object.defineProperty(navigator, 'platform', {
          get: () => 'Win32',
          configurable: true,
        });
      }

      if (initOpts.spoofWorkerMismatch) {
        const OrigWorker = window.Worker;
        const onMsgDesc = Object.getOwnPropertyDescriptor(OrigWorker.prototype, 'onmessage');
        window.Worker = class extends OrigWorker {
          constructor(scriptURL: string | URL, options?: WorkerOptions) {
            super(scriptURL, options);
            if (onMsgDesc?.set) {
              const origSet = onMsgDesc.set;
              const origGet = onMsgDesc.get;
              let userHandler: ((this: Worker, ev: MessageEvent) => unknown) | null = null;
              Object.defineProperty(this, 'onmessage', {
                configurable: true,
                get() {
                  return userHandler ?? origGet?.call(this) ?? null;
                },
                set(fn: ((this: Worker, ev: MessageEvent) => unknown) | null) {
                  userHandler = fn;
                  if (!fn) {
                    origSet.call(this, null);
                    return;
                  }
                  origSet.call(this, function (this: Worker, ev: MessageEvent) {
                    const raw = ev.data && typeof ev.data === 'object' ? { ...ev.data } : ev.data;
                    if (raw && typeof raw === 'object') {
                      if ('hardwareConcurrency' in raw) {
                        (raw as Record<string, unknown>).hardwareConcurrency = 99;
                      }
                      if (
                        'snapshot' in raw &&
                        (raw as Record<string, unknown>).snapshot &&
                        typeof (raw as Record<string, unknown>).snapshot === 'object'
                      ) {
                        (raw as Record<string, unknown>).snapshot = {
                          ...((raw as Record<string, unknown>).snapshot as Record<string, unknown>),
                          hardwareConcurrency: 99,
                        };
                      }
                    }
                    return fn.call(this, new MessageEvent('message', { data: raw }));
                  });
                },
              });
            }
          }
        } as typeof Worker;
      }
    },
    {
      spoofWebglRenderer: opts.spoofWebglRenderer,
      spoofWebdriverTrue: opts.spoofWebdriverTrue,
      spoofNonLocalWebrtc: opts.spoofNonLocalWebrtc,
      spoofAntiTamper: opts.spoofAntiTamper,
      spoofWorkerMismatch: opts.spoofWorkerMismatch,
    },
  );

  try {
    await page.goto(`${vite.baseUrl}/browser.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForFunction(
      () => {
        const v = document.querySelector('[data-verification]')?.getAttribute('data-verification');
        const panelReady =
          document.querySelectorAll('[data-context-kind]').length === 6 &&
          document.querySelectorAll('[data-cross-context-metric]').length === 9;
        return (v === 'passed' || v === 'failed' || v === 'incomplete') && panelReady;
      },
      undefined,
      { timeout: 25_000 },
    );

    const summary = await page.evaluate(() => {
      const phase =
        document.querySelector('[data-verification]')?.getAttribute('data-verification') ?? 'unknown';
      const okCount = document.querySelectorAll('.verification-check.ok').length;
      const failedCount = document.querySelectorAll('.verification-check.failed').length;
      const pendingCount = document.querySelectorAll('.verification-check.pending').length;
      const failedCheckIds = [...document.querySelectorAll('.verification-check.failed')].map(
        (el) => el.getAttribute('data-check-id') ?? el.querySelector('h2')?.textContent ?? 'unknown',
      );
      const crossContextPillCount = document.querySelectorAll('[data-context-kind]').length;
      const crossContextMetricCount = document.querySelectorAll('[data-cross-context-metric]').length;
      const crossContextBlocking =
        document.querySelectorAll('[data-cross-context-blocking="true"]').length > 0;
      const bodyText = document.body.innerText;
      return {
        phase,
        okCount,
        failedCount,
        pendingCount,
        failedCheckIds,
        crossContextPillCount,
        crossContextMetricCount,
        crossContextBlocking,
        bodyText,
      };
    });

    return {
      ...summary,
      pageErrors,
    };
  } finally {
    await persistent.close();
  }
}

export async function openRiskPanelWithMockIpc(options: {
  repoRoot: string;
  sb: SandboxHandle;
  localSnapshot: Record<string, unknown>;
  probeReport?: Record<string, unknown> | null;
  onPage?: (page: Page) => Promise<void>;
}): Promise<{
  pageErrors: string[];
  telemetryRulesAttr: string | null;
  siftRulesAttr: string | null;
  bannerStatus: string | null;
  bodyText: string;
}> {
  const localJson = JSON.stringify(options.localSnapshot);
  const probeJson = JSON.stringify(options.probeReport ?? null);
  const html = buildMockIpcShellHtml({
    entryModule: '/src/main.tsx',
    title: 'Claude-Local Risk Panel E2E',
    setupScript: `
      localStorage.setItem('claude-local.page.v1', 'risk');
      localStorage.setItem('claude-local.preferences.v1', JSON.stringify({
        theme: 'light',
        accent: 'terracotta',
        reduceMotion: true,
        sidebarLayout: 'classic',
        surfaceStyle: 'cockpit',
        backdrop: 'minimal',
        privacyMask: false,
        startupPage: 'risk'
      }));
      const __localSnap = ${localJson};
      const __probeReport = ${probeJson};
      window.__e2eHandleCommand = async (cmd) => {
        if (cmd === 'ui_language_read') return 'en';
        if (cmd === 'risk_inspect_local_env') return __localSnap;
        if (cmd === 'risk_probe_consistency') return __probeReport;
        if (cmd === 'identities_list') return [];
        if (cmd === 'identities_active') return null;
        if (cmd === 'browser_kill_switch_state') return { enabled: true, triggered: false, closed_slots: [] };
        if (cmd === 'ui_preferences_read') return null;
        if (cmd === 'ui_privacy_read') return false;
        if (cmd === 'custom_wallpaper_read') return null;
        return null;
      };
    `,
  });

  const vite = await startViteServer({
    repoRoot: optsOr(options.repoRoot),
    sandbox: options.sb,
    virtualPages: { '/__e2e-risk.html': html },
  });

  const pinned = await launchPinnedChrome({
    repoRoot: options.repoRoot,
    sandbox: options.sb,
    headless: true,
  });
  const iso = await pinned.newIsolatedContext({
    allowedUrlPrefixes: [`${vite.baseUrl}/`],
  });
  const { page, pageErrors } = await openMockedAppPage({
    context: iso.context,
    url: `${vite.baseUrl}/__e2e-risk.html`,
  });

  try {
    await page.waitForSelector('.risk-audit-banner', { timeout: 12_000 });
    await page.waitForFunction(
      () => {
        const banner = document.querySelector('.risk-audit-banner');
        return banner && banner.getAttribute('data-audit-banner') !== 'pending';
      },
      { timeout: 10_000 },
    );

    if (options.onPage) {
      await options.onPage(page);
    }

    const telemetryRulesAttr = await page
      .locator('[data-risk-telemetry-rules]')
      .first()
      .getAttribute('data-risk-telemetry-rules')
      .catch(() => null);
    const siftRulesAttr = await page
      .locator('[data-risk-sift-rules]')
      .first()
      .getAttribute('data-risk-sift-rules')
      .catch(() => null);
    const bannerStatus = await page
      .locator('.risk-audit-banner')
      .getAttribute('data-audit-banner');
    const bodyText = await page.locator('body').innerText();

    assert.deepEqual(pageErrors, []);
    return {
      pageErrors,
      telemetryRulesAttr,
      siftRulesAttr,
      bannerStatus,
      bodyText,
    };
  } finally {
    await iso.close();
    await pinned.close();
  }
}

function optsOr(v: string): string {
  return v;
}

export async function runMv3QuotaBridgeSync(options: {
  repoRoot: string;
  sb: SandboxHandle;
  netSuite: MockNetworkSuite;
  proxy: MockHttpConnectProxy;
  accountUuid: string;
  email: string;
  organizationUuid: string;
  profileName?: string;
  onBeforeGoto?: (context: Awaited<ReturnType<typeof launchPersistentProfile>>['context']) => Promise<void>;
  onPageReady?: (opts: {
    page: Page;
    bridge: LoopbackQuotaBridgeServer;
    nonce: string;
    quotaIdentity: string;
  }) => Promise<void>;
  timeoutMs?: number;
}): Promise<{
  callbacks: CapturedQuotaCallback[];
  nonce: string;
  quotaIdentity: string;
  finalUrl: string;
  finalHash: string;
  sessionMarker: string | null;
  abortedUrls: string[];
}> {
  const { randomBytes } = await import('node:crypto');
  const { computeQuotaIdentitySha256 } = await import('../lib/rust-blackbox.ts');

  const token = randomBytes(24).toString('hex');
  const nonce = randomBytes(24).toString('hex');
  const quotaIdentity = computeQuotaIdentitySha256(
    options.accountUuid,
    options.email,
    options.organizationUuid,
  );

  const bridge = await startLoopbackQuotaCallbackServer(token);
  options.sb.registerCleanup(() => bridge.close());

  const extDir = resolve(options.repoRoot, 'browser-runtime', 'quota-bridge');
  const persistent = await launchPersistentProfile({
    repoRoot: options.repoRoot,
    sandbox: options.sb,
    profileName: options.profileName ?? `mv3-${token.slice(0, 8)}`,
    headless: true,
    argsOptions: {
      extensionDir: extDir,
      proxyUrl: options.proxy.url,
    },
    allowedUrlPrefixes: ['http://127.0.0.1:', 'https://claude.ai/'],
  });

  if (options.onBeforeGoto) {
    await options.onBeforeGoto(persistent.context);
  }
  const page = await persistent.context.newPage();
  page.setDefaultTimeout(options.timeoutMs ?? 15_000);

  try {
    const startUrl = `${bridge.baseUrl}/${token}/browser.html#quota-sync=${nonce}&quota_identity=${quotaIdentity}`;
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    await bridge.waitForCallback(1, options.timeoutMs ?? 15_000);

    // Allow content.js history.replaceState + sessionStorage settle
    await page.waitForTimeout(100);
    const pageInfo = await page.evaluate((n: string) => ({
      finalUrl: location.href,
      finalHash: location.hash,
      sessionMarker: sessionStorage.getItem(`claude-local-quota:${n}`),
    }), nonce);

    if (options.onPageReady) {
      await options.onPageReady({
        page,
        bridge,
        nonce,
        quotaIdentity,
      });
    }

    return {
      callbacks: [...bridge.callbacks],
      nonce,
      quotaIdentity,
      finalUrl: pageInfo.finalUrl,
      finalHash: pageInfo.finalHash,
      sessionMarker: pageInfo.sessionMarker,
      abortedUrls: [...persistent.abortedUrls],
    };
  } finally {
    await persistent.close();
    await bridge.close();
  }
}

export { assert };
