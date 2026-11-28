/**
 * [INPUT]: 宿主上下文、共用有效时区/语言、版本化浏览器观测、回报状态与跨执行上下文一致性评估结果。
 * [OUTPUT]: 固定 20 项指标目录中的通过/失败/未完成检查、UTF-8 有界截断辅助与 `evaluateCrossContextConsistency`（9 维跨上下文与防篡改评估）；仅未知或不支持降级保持中性，存在真实冲突/篡改时阻断。
 * [POS]: 起始页纯核验模型，与 DOM/网络分离；结果只描述已完成的有限测量。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {
  classifyBrowserExitIsp,
  effectiveBrowserTarget,
  matchesDevice,
  type BrowserContext,
  type CrossContextCellStatus,
  type CrossContextEvaluation,
  type CrossContextKind,
  type CrossContextMetricId,
  type CrossContextMetricResult,
  type CrossContextMismatch,
  type CrossContextProbeRecord,
  type CrossContextProbeStatus,
  type CrossContextSnapshot,
  type Report,
} from './browser-model';
export type VerificationPhase='checking'|'failed'|'passed'|'incomplete';
export type VerificationCheck={id:string;label:string;actual:string;expected:string;ok:boolean|null;applicable:boolean};
export const REPORT_SCHEMA_VERSION = 1;
export const REQUIRED_CHECK_IDS = [
 'exit.country','exit.provider','page.timezone','exit.timezone','machine.timezone','page.language',
 'page.languages','machine.language','machine.locale','device.platform','device.cores','browser.version',
 'page.geolocation','machine.location','probe.webrtc','probe.webdriver','probe.graphics','probe.tz-offset',
 'probe.canvas-audio','probe.client-hints',
] as const;
export const REPORT_MAX_AGE_MS = 10 * 60 * 1000;

const CONTEXT_KINDS: readonly CrossContextKind[] = [
  'window',
  'worker',
  'shared-worker',
  'service-worker',
  'same-origin-iframe',
  'sandbox-iframe',
];

const ISOLATED_CONTEXT_KINDS: readonly Exclude<CrossContextKind, 'window'>[] = [
  'worker',
  'shared-worker',
  'service-worker',
  'same-origin-iframe',
  'sandbox-iframe',
];

const CONTEXT_LABEL_KEYS: Record<CrossContextKind, string> = {
  window: 'browserVerify.crossContext.ctxWindow',
  worker: 'browserVerify.crossContext.ctxWorker',
  'shared-worker': 'browserVerify.crossContext.ctxSharedWorker',
  'service-worker': 'browserVerify.crossContext.ctxServiceWorker',
  'same-origin-iframe': 'browserVerify.crossContext.ctxSameOriginIframe',
  'sandbox-iframe': 'browserVerify.crossContext.ctxSandboxIframe',
};

const VALID_ORIENTATION_TYPES = new Set([
  'landscape-primary',
  'landscape-secondary',
  'portrait-primary',
  'portrait-secondary',
]);

const VALID_ORIENTATION_ANGLES = new Set([0, 90, 180, 270]);
const SOFTWARE_RENDERER_RE = /swiftshader|llvmpipe|software\s*rasterizer|basic\s*render\s*driver/i;

export function truncateUtf8Bytes(text: string, maxBytes = 280): string {
  if (!text) return '';
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= maxBytes) return text;
  let out = '';
  let used = 0;
  for (const ch of text) {
    const chBytes = encoder.encode(ch).length;
    if (used + chBytes + 3 > maxBytes) {
      return out + '...';
    }
    out += ch;
    used += chBytes;
  }
  return out;
}

function desktopPlatformMatches(uaPlatform: string, navPlatform: string): boolean {
  const ua = uaPlatform.trim().toLowerCase();
  const nav = navPlatform.trim().toLowerCase();
  if (!ua || !nav) return true;
  if (/^(android|ios|iphone|ipad|ipod)$/i.test(ua)) return false;
  if (ua === 'windows') return /^win/.test(nav);
  if (ua === 'macos') return /^mac/.test(nav);
  if (ua === 'linux') return /linux/.test(nav);
  return true;
}

function formatUaDataBaseline(snap: CrossContextSnapshot): string {
  const uad = snap.userAgentData;
  if (!uad) return '—';
  const base = `${uad.platform || '?'} · mobile=${String(uad.mobile)}`;
  if (uad.highEntropy) {
    const ver = uad.highEntropy.uaFullVersion || uad.highEntropy.platformVersion;
    return ver ? `${base} (${ver})` : base;
  }
  return base;
}

function normalizeBrands(brands: { brand: string; version: string }[]): string {
  return brands.map(b => `${b.brand.trim()}:${b.version.trim()}`).join('|');
}

function normalizeLangs(langs: string[]): string {
  return langs.map(item => item.trim().toLowerCase()).join(',');
}

function isPositiveIntCores(value: number | null): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1024;
}

export function evaluateCrossContextConsistency(
  main: CrossContextSnapshot,
  contexts: CrossContextProbeRecord[],
  mainCanvasWebgl?: { vendor?: string; renderer?: string } | null,
): CrossContextEvaluation {
  const recordMap = new Map<Exclude<CrossContextKind, 'window'>, CrossContextProbeRecord>();
  for (const item of contexts) {
    recordMap.set(item.kind, item);
  }

  const allMismatches: CrossContextMismatch[] = [];
  const metrics: CrossContextMetricResult[] = [];

  const createEmptyCells = (): Record<CrossContextKind, { status: CrossContextCellStatus; value: string }> => ({
    window: { status: 'matched', value: '—' },
    worker: { status: 'unsupported', value: '' },
    'shared-worker': { status: 'unsupported', value: '' },
    'service-worker': { status: 'unsupported', value: '' },
    'same-origin-iframe': { status: 'unsupported', value: '' },
    'sandbox-iframe': { status: 'unsupported', value: '' },
  });

  const buildMetric = (
    id: CrossContextMetricId,
    labelKey: string,
    scope: 'all' | 'secure' | 'window_iframe_only',
    scopeKey: string,
    baseline: string,
    evalContext: (kind: CrossContextKind, snap: CrossContextSnapshot) => { status: CrossContextCellStatus; value: string; mismatch?: CrossContextMismatch },
    allUnsupportedCheck?: (cells: Record<CrossContextKind, { status: CrossContextCellStatus; value: string }>) => boolean,
  ) => {
    const cells = createEmptyCells();
    const metricMismatches: CrossContextMismatch[] = [];

    const mainRes = evalContext('window', main);
    cells.window = { status: mainRes.status, value: mainRes.value };
    if (mainRes.mismatch) {
      metricMismatches.push(mainRes.mismatch);
      allMismatches.push(mainRes.mismatch);
    }

    for (const kind of ISOLATED_CONTEXT_KINDS) {
      const rec = recordMap.get(kind);
      if (!rec || rec.status !== 'ok' || !rec.snapshot) {
        cells[kind] = { status: 'unsupported', value: '' };
        continue;
      }
      const res = evalContext(kind, rec.snapshot);
      cells[kind] = { status: res.status, value: res.value };
      if (res.mismatch) {
        metricMismatches.push(res.mismatch);
        allMismatches.push(res.mismatch);
      }
    }

    const status: CrossContextMetricResult['status'] =
      metricMismatches.length > 0
        ? 'mismatch'
        : allUnsupportedCheck?.(cells)
          ? 'unsupported'
          : 'matched';

    metrics.push({
      id,
      labelKey,
      scope,
      scopeKey,
      baseline,
      status,
      cells,
      mismatches: metricMismatches,
    });
  };

  // 1. navigator.platform
  buildMetric(
    'ctx.platform',
    'browserVerify.crossContext.metricPlatform',
    'all',
    'browserVerify.crossContext.scopeAll',
    main.platform || '—',
    (kind, snap) => {
      const actual = snap.platform.trim();
      const expected = main.platform.trim();
      if (kind === 'window') {
        const uadOk = !snap.userAgentData?.platform || desktopPlatformMatches(snap.userAgentData.platform, actual);
        if (!actual || !uadOk) {
          return {
            status: 'mismatch',
            value: actual || 'empty',
            mismatch: {
              metricId: 'ctx.platform',
              context: kind,
              messageKey: 'browserVerify.crossContext.mismatchLine',
              values: {
                metric: 'browserVerify.crossContext.metricPlatform',
                context: CONTEXT_LABEL_KEYS[kind],
                expected: snap.userAgentData?.platform || 'desktop',
                actual: actual || 'empty',
              },
            },
          };
        }
        return { status: 'matched', value: actual };
      }
      if (!actual || actual !== expected) {
        return {
          status: 'mismatch',
          value: actual || 'empty',
          mismatch: {
            metricId: 'ctx.platform',
            context: kind,
            messageKey: 'browserVerify.crossContext.mismatchLine',
            values: {
              metric: 'browserVerify.crossContext.metricPlatform',
              context: CONTEXT_LABEL_KEYS[kind],
              expected: expected || 'non-empty',
              actual: actual || 'empty',
            },
          },
        };
      }
      return { status: 'matched', value: actual };
    },
  );

  // 2. navigator.languages & language
  const mainLangSeq = normalizeLangs(main.languages);
  buildMetric(
    'ctx.languages',
    'browserVerify.crossContext.metricLanguages',
    'all',
    'browserVerify.crossContext.scopeAll',
    main.languages.join(', ') || main.language || '—',
    (kind, snap) => {
      const seq = normalizeLangs(snap.languages);
      const primaryOk =
        snap.languages.length > 0 &&
        snap.language.trim().toLowerCase() === snap.languages[0].trim().toLowerCase();
      const actualDisplay = snap.languages.join(', ') || snap.language || 'empty';
      if (kind === 'window') {
        if (!primaryOk) {
          return {
            status: 'mismatch',
            value: actualDisplay,
            mismatch: {
              metricId: 'ctx.languages',
              context: kind,
              messageKey: 'browserVerify.crossContext.mismatchLine',
              values: {
                metric: 'browserVerify.crossContext.metricLanguages',
                context: CONTEXT_LABEL_KEYS[kind],
                expected: snap.language || 'non-empty',
                actual: actualDisplay,
              },
            },
          };
        }
        return { status: 'matched', value: actualDisplay };
      }
      if (!primaryOk || seq !== mainLangSeq) {
        return {
          status: 'mismatch',
          value: actualDisplay,
          mismatch: {
            metricId: 'ctx.languages',
            context: kind,
            messageKey: 'browserVerify.crossContext.mismatchLine',
            values: {
              metric: 'browserVerify.crossContext.metricLanguages',
              context: CONTEXT_LABEL_KEYS[kind],
              expected: main.languages.join(', ') || 'non-empty',
              actual: actualDisplay,
            },
          },
        };
      }
      return { status: 'matched', value: actualDisplay };
    },
  );

  // 3. navigator.hardwareConcurrency
  buildMetric(
    'ctx.cores',
    'browserVerify.crossContext.metricCores',
    'all',
    'browserVerify.crossContext.scopeAll',
    main.hardwareConcurrency != null ? String(main.hardwareConcurrency) : '—',
    (kind, snap) => {
      const actual = snap.hardwareConcurrency;
      if (!isPositiveIntCores(actual) || (kind !== 'window' && actual !== main.hardwareConcurrency)) {
        return {
          status: 'mismatch',
          value: String(actual ?? 'null'),
          mismatch: {
            metricId: 'ctx.cores',
            context: kind,
            messageKey: 'browserVerify.crossContext.mismatchLine',
            values: {
              metric: 'browserVerify.crossContext.metricCores',
              context: CONTEXT_LABEL_KEYS[kind],
              expected: main.hardwareConcurrency != null ? String(main.hardwareConcurrency) : '1..1024',
              actual: String(actual ?? 'null'),
            },
          },
        };
      }
      return { status: 'matched', value: String(actual) };
    },
  );

  // 4. navigator.deviceMemory (secure contexts only; missing across all -> unsupported)
  buildMetric(
    'ctx.device-memory',
    'browserVerify.crossContext.metricDeviceMemory',
    'secure',
    'browserVerify.crossContext.scopeSecure',
    main.deviceMemory != null ? `${main.deviceMemory} GB` : '—',
    (kind, snap) => {
      if (main.deviceMemory == null) {
        if (!snap.isSecureContext || snap.deviceMemory == null) {
          return { status: snap.isSecureContext ? 'unsupported' : 'not_applicable', value: '' };
        }
        return {
          status: 'mismatch',
          value: `${snap.deviceMemory} GB`,
          mismatch: {
            metricId: 'ctx.device-memory',
            context: kind,
            messageKey: 'browserVerify.crossContext.mismatchLine',
            values: {
              metric: 'browserVerify.crossContext.metricDeviceMemory',
              context: CONTEXT_LABEL_KEYS[kind],
              expected: 'unavailable',
              actual: `${snap.deviceMemory} GB`,
            },
          },
        };
      }
      if (!snap.isSecureContext && snap.deviceMemory == null) {
        return { status: 'not_applicable', value: '' };
      }
      if (snap.deviceMemory == null || snap.deviceMemory !== main.deviceMemory) {
        return {
          status: 'mismatch',
          value: snap.deviceMemory != null ? `${snap.deviceMemory} GB` : 'null',
          mismatch: {
            metricId: 'ctx.device-memory',
            context: kind,
            messageKey: 'browserVerify.crossContext.mismatchLine',
            values: {
              metric: 'browserVerify.crossContext.metricDeviceMemory',
              context: CONTEXT_LABEL_KEYS[kind],
              expected: `${main.deviceMemory} GB`,
              actual: snap.deviceMemory != null ? `${snap.deviceMemory} GB` : 'null',
            },
          },
        };
      }
      return { status: 'matched', value: `${snap.deviceMemory} GB` };
    },
    cells => cells.window.status === 'unsupported' && ISOLATED_CONTEXT_KINDS.every(k => cells[k].status === 'unsupported' || cells[k].status === 'not_applicable'),
  );

  // 5. navigator.userAgentData
  const mainBrands = main.userAgentData ? normalizeBrands(main.userAgentData.brands) : '';
  buildMetric(
    'ctx.ua-data',
    'browserVerify.crossContext.metricUaData',
    'all',
    'browserVerify.crossContext.scopeAll',
    formatUaDataBaseline(main),
    (kind, snap) => {
      if (!main.userAgentData) {
        if (!snap.userAgentData) {
          return { status: 'unsupported', value: '' };
        }
        return {
          status: 'mismatch',
          value: formatUaDataBaseline(snap),
          mismatch: {
            metricId: 'ctx.ua-data',
            context: kind,
            messageKey: 'browserVerify.crossContext.mismatchLine',
            values: {
              metric: 'browserVerify.crossContext.metricUaData',
              context: CONTEXT_LABEL_KEYS[kind],
              expected: 'unsupported',
              actual: formatUaDataBaseline(snap),
            },
          },
        };
      }
      const uad = snap.userAgentData;
      if (!uad) {
        return {
          status: 'mismatch',
          value: 'missing',
          mismatch: {
            metricId: 'ctx.ua-data',
            context: kind,
            messageKey: 'browserVerify.crossContext.mismatchLine',
            values: {
              metric: 'browserVerify.crossContext.metricUaData',
              context: CONTEXT_LABEL_KEYS[kind],
              expected: formatUaDataBaseline(main),
              actual: 'missing',
            },
          },
        };
      }
      const lowMatch =
        uad.mobile === main.userAgentData.mobile &&
        uad.platform === main.userAgentData.platform &&
        normalizeBrands(uad.brands) === mainBrands;
      let highMatch = true;
      if (main.userAgentData.highEntropy && uad.highEntropy) {
        const mh = main.userAgentData.highEntropy;
        const sh = uad.highEntropy;
        highMatch =
          mh.platformVersion === sh.platformVersion &&
          mh.uaFullVersion === sh.uaFullVersion &&
          mh.architecture === sh.architecture &&
          mh.bitness === sh.bitness &&
          mh.model === sh.model;
      }
      if (!lowMatch || !highMatch) {
        return {
          status: 'mismatch',
          value: formatUaDataBaseline(snap),
          mismatch: {
            metricId: 'ctx.ua-data',
            context: kind,
            messageKey: 'browserVerify.crossContext.mismatchLine',
            values: {
              metric: 'browserVerify.crossContext.metricUaData',
              context: CONTEXT_LABEL_KEYS[kind],
              expected: formatUaDataBaseline(main),
              actual: formatUaDataBaseline(snap),
            },
          },
        };
      }
      return { status: 'matched', value: uad.platform || 'ok' };
    },
    cells => cells.window.status === 'unsupported',
  );

  // 6. Intl.DateTimeFormat & timezoneOffsetMin
  const formatIntl = (snap: CrossContextSnapshot) =>
    `${snap.intl.timeZone || '?'} · ${snap.intl.locale || '?'} (UTC${snap.intl.timezoneOffsetMin >= 0 ? '+' : ''}${snap.intl.timezoneOffsetMin}m)`;
  buildMetric(
    'ctx.intl',
    'browserVerify.crossContext.metricIntl',
    'all',
    'browserVerify.crossContext.scopeAll',
    formatIntl(main),
    (kind, snap) => {
      const ok =
        Boolean(snap.intl.timeZone) &&
        Boolean(snap.intl.locale) &&
        (kind === 'window' ||
          (snap.intl.timeZone === main.intl.timeZone &&
            snap.intl.locale === main.intl.locale &&
            snap.intl.timezoneOffsetMin === main.intl.timezoneOffsetMin));
      if (!ok) {
        return {
          status: 'mismatch',
          value: formatIntl(snap),
          mismatch: {
            metricId: 'ctx.intl',
            context: kind,
            messageKey: 'browserVerify.crossContext.mismatchLine',
            values: {
              metric: 'browserVerify.crossContext.metricIntl',
              context: CONTEXT_LABEL_KEYS[kind],
              expected: formatIntl(main),
              actual: formatIntl(snap),
            },
          },
        };
      }
      return { status: 'matched', value: snap.intl.timeZone };
    },
  );

  // 7. screen.orientation (Window + Iframe ONLY; Workers lack screen -> not_applicable)
  const formatScreen = (snap: CrossContextSnapshot) => {
    if (!snap.screen.available) return 'N/A';
    const dims = `${snap.screen.width ?? '?'}×${snap.screen.height ?? '?'}`;
    return snap.screen.orientationType
      ? `${dims} · ${snap.screen.orientationType} (${snap.screen.orientationAngle ?? '?'}°)`
      : dims;
  };
  buildMetric(
    'ctx.screen-orientation',
    'browserVerify.crossContext.metricScreenOrientation',
    'window_iframe_only',
    'browserVerify.crossContext.scopeWindowIframe',
    formatScreen(main),
    (kind, snap): { status: CrossContextCellStatus; value: string; mismatch?: CrossContextMismatch } => {
      if (kind === 'worker' || kind === 'shared-worker' || kind === 'service-worker') {
        return { status: 'not_applicable', value: '' };
      }
      if (!snap.screen.available || snap.screen.width == null || snap.screen.height == null) {
        return {
          status: 'mismatch',
          value: 'unavailable',
          mismatch: {
            metricId: 'ctx.screen-orientation',
            context: kind,
            messageKey: 'browserVerify.crossContext.mismatchLine',
            values: {
              metric: 'browserVerify.crossContext.metricScreenOrientation',
              context: CONTEXT_LABEL_KEYS[kind],
              expected: formatScreen(main),
              actual: 'unavailable',
            },
          },
        };
      }
      if (main.screen.orientationType == null && snap.screen.orientationType == null) {
        return { status: 'unsupported', value: '' };
      }
      const type = snap.screen.orientationType || '';
      const angle = snap.screen.orientationAngle;
      const validType = VALID_ORIENTATION_TYPES.has(type);
      const validAngle = angle !== null && VALID_ORIENTATION_ANGLES.has(angle);
      const w = snap.screen.width;
      const h = snap.screen.height;
      const geometryContradicts =
        (w > h && type.startsWith('portrait-')) ||
        (h > w && type.startsWith('landscape-'));
      if (!validType || !validAngle || geometryContradicts) {
        return {
          status: 'mismatch',
          value: formatScreen(snap),
          mismatch: {
            metricId: 'ctx.screen-orientation',
            context: kind,
            messageKey: 'browserVerify.crossContext.orientationGeometryMismatch',
            values: {
              orientation: type ? `${type} (${angle ?? '?'}°)` : 'invalid',
              size: `${w}×${h}`,
            },
          },
        };
      }
      const dimensionsMismatch =
        kind === 'same-origin-iframe' &&
        (w !== main.screen.width || h !== main.screen.height);
      if (
        kind !== 'window' &&
        (dimensionsMismatch ||
          type !== main.screen.orientationType ||
          angle !== main.screen.orientationAngle)
      ) {
        return {
          status: 'mismatch',
          value: formatScreen(snap),
          mismatch: {
            metricId: 'ctx.screen-orientation',
            context: kind,
            messageKey: 'browserVerify.crossContext.mismatchLine',
            values: {
              metric: 'browserVerify.crossContext.metricScreenOrientation',
              context: CONTEXT_LABEL_KEYS[kind],
              expected: formatScreen(main),
              actual: formatScreen(snap),
            },
          },
        };
      }
      return { status: 'matched', value: `${type} (${angle}°)` };
    },
    cells => cells.window.status === 'unsupported',
  );

  // 8. OffscreenCanvas WebGL (UNMASKED_VENDOR_WEBGL / UNMASKED_RENDERER_WEBGL)
  buildMetric(
    'ctx.offscreen-webgl',
    'browserVerify.crossContext.metricOffscreenWebgl',
    'all',
    'browserVerify.crossContext.scopeAll',
    main.offscreenWebgl.supported ? (main.offscreenWebgl.renderer || 'WebGL') : '—',
    (kind, snap) => {
      if (!snap.offscreenWebgl.supported) {
        return { status: 'unsupported', value: '' };
      }
      const renderer = snap.offscreenWebgl.renderer.trim();
      const vendor = snap.offscreenWebgl.vendor.trim();
      if (SOFTWARE_RENDERER_RE.test(renderer)) {
        return {
          status: 'mismatch',
          value: renderer,
          mismatch: {
            metricId: 'ctx.offscreen-webgl',
            context: kind,
            messageKey: 'browserVerify.crossContext.mismatchLine',
            values: {
              metric: 'browserVerify.crossContext.metricOffscreenWebgl',
              context: CONTEXT_LABEL_KEYS[kind],
              expected: main.offscreenWebgl.renderer || 'hardware GPU',
              actual: renderer,
            },
          },
        };
      }
      if (kind === 'window') {
        if (
          mainCanvasWebgl?.renderer &&
          mainCanvasWebgl.renderer.trim() &&
          renderer !== mainCanvasWebgl.renderer.trim()
        ) {
          return {
            status: 'mismatch',
            value: renderer,
            mismatch: {
              metricId: 'ctx.offscreen-webgl',
              context: kind,
              messageKey: 'browserVerify.crossContext.mismatchLine',
              values: {
                metric: 'browserVerify.crossContext.metricOffscreenWebgl',
                context: CONTEXT_LABEL_KEYS[kind],
                expected: mainCanvasWebgl.renderer.trim(),
                actual: renderer || 'empty',
              },
            },
          };
        }
        return { status: 'matched', value: renderer || 'WebGL' };
      }
      if (main.offscreenWebgl.supported) {
        const sameVendor = vendor === main.offscreenWebgl.vendor.trim();
        const sameRenderer = renderer === main.offscreenWebgl.renderer.trim();
        if (!sameVendor || !sameRenderer) {
          return {
            status: 'mismatch',
            value: renderer || vendor || 'empty',
            mismatch: {
              metricId: 'ctx.offscreen-webgl',
              context: kind,
              messageKey: 'browserVerify.crossContext.mismatchLine',
              values: {
                metric: 'browserVerify.crossContext.metricOffscreenWebgl',
                context: CONTEXT_LABEL_KEYS[kind],
                expected: `${main.offscreenWebgl.vendor} / ${main.offscreenWebgl.renderer}`,
                actual: `${vendor} / ${renderer}`,
              },
            },
          };
        }
      }
      return { status: 'matched', value: renderer || 'WebGL' };
    },
    cells => cells.window.status === 'unsupported' && ISOLATED_CONTEXT_KINDS.every(k => cells[k].status === 'unsupported'),
  );

  // 9. Function.prototype.toString & Error.stack native integrity
  buildMetric(
    'ctx.anti-tamper',
    'browserVerify.crossContext.metricAntiTamper',
    'all',
    'browserVerify.crossContext.scopeAll',
    main.nativeIntegrity.ok ? 'native' : main.nativeIntegrity.details.join(', ') || 'tampered',
    (kind, snap) => {
      if (!snap.nativeIntegrity.ok) {
        const detail = snap.nativeIntegrity.details.join(', ') || 'prototype_or_stack_tampered';
        return {
          status: 'mismatch',
          value: detail,
          mismatch: {
            metricId: 'ctx.anti-tamper',
            context: kind,
            messageKey: 'browserVerify.crossContext.tamperDetected',
            values: {
              context: CONTEXT_LABEL_KEYS[kind],
              detail,
            },
          },
        };
      }
      return { status: 'matched', value: 'native' };
    },
  );

  const contextStates = {} as Record<CrossContextKind, { status: CrossContextProbeStatus; reason?: string }>;
  for (const kind of CONTEXT_KINDS) {
    if (kind === 'window') {
      const hasMainMismatch = allMismatches.some(m => m.context === 'window');
      contextStates.window = { status: hasMainMismatch ? 'mismatch' : 'matched' };
      continue;
    }
    const rec = recordMap.get(kind);
    if (!rec || rec.status !== 'ok' || !rec.snapshot) {
      contextStates[kind] = { status: 'unsupported', reason: rec?.reason || 'unsupported' };
      continue;
    }
    const hasMismatch = allMismatches.some(m => m.context === kind);
    contextStates[kind] = { status: hasMismatch ? 'mismatch' : 'matched' };
  }

  let matchedContexts = 0;
  let unsupportedContexts = 0;
  for (const kind of ISOLATED_CONTEXT_KINDS) {
    const st = contextStates[kind].status;
    if (st === 'matched') matchedContexts++;
    else if (st === 'unsupported') unsupportedContexts++;
  }

  const blocking = allMismatches.length > 0;
  return {
    status: blocking ? 'failed' : 'passed',
    blocking,
    matchedContexts,
    unsupportedContexts,
    contextStates,
    metrics,
    mismatches: allMismatches,
  };
}

export function verifyBrowser(
  context:BrowserContext|null,
  report:Report|null,
  linked:boolean,
  error:string,
  busy:boolean,
  reportedAt?:number|null,
  crossContext?:CrossContextEvaluation|null,
) {
 const checks:VerificationCheck[]=[];
 const problems:string[]=[];
 if(error)problems.push(error);
 if(report?.error)problems.push(report.error);
 if(!linked&&!busy)problems.push('与 Claude-Local的连接已断开，请在清理器内重新打开实测页。');
 if(!context?.region&&!busy)problems.push('请先在主应用选择目标地区。');
 if(!report&&!busy&&!error)problems.push('尚未取得完整检测结果。');
 if(reportedAt && (Date.now() - reportedAt > REPORT_MAX_AGE_MS)) problems.push('检测结果已超过 10 分钟（已过时），请点击「重新实测」更新。');
 if(crossContext && crossContext.mismatches.length > 0) {
  problems.push('browserVerify.crossContext.blockingTitle');
 }
 if(context&&report){
  const {machine,region,config}=context, exit=report.exit;
  const target=effectiveBrowserTarget(context);
  const first=machine.languages[0]||'';
  const language=target.language;
  const add=(id:string,label:string,actual:string|number|undefined|null,expected:string|number|undefined|null,ok:boolean|null,applicable=true)=>checks.push({id,label,actual:actual==null||actual===''?'尚未核验':String(actual),expected:expected==null||expected===''?'尚未核验':String(expected),ok:applicable?ok:null,applicable});
  const current=report.schema_version===REPORT_SCHEMA_VERSION;
  const observed=(value:boolean|undefined|null):boolean|null=>current&&(value===true||value===false)?value:null;
  if(!exit)problems.push('无法验证网络出口，请检查连接后重测。');
  add('exit.country','出口国家',exit?.country,region?.country,region&&exit?exit.country===region.country:null);
  const ispKind=classifyBrowserExitIsp(exit);
  const classificationFailures:Record<string,string>={rate_limited:'browserVerify.classificationError.rate_limited',timeout:'browserVerify.classificationError.timeout',http_error:'browserVerify.classificationError.http_error',network_error:'browserVerify.classificationError.network_error',invalid_response:'browserVerify.classificationError.invalid_response',ip_mismatch:'browserVerify.classificationError.ip_mismatch',response_too_large:'browserVerify.classificationError.response_too_large'};
  add('exit.provider','出口 IP 属性',ispKind==='hosting'?'已识别机房特征':ispKind==='isp'?'分类数据源未标记为机房':classificationFailures[exit?.hosting_error||'']||'运营商信息或机房分类不足，结果未知', '机房特征识别结果', ispKind==='hosting'?false:ispKind==='isp'?true:null);
  add('page.timezone','网页时区',report.timezone,target.timezone,!!report.timezone&&report.timezone===target.timezone);
  add('exit.timezone','出口时区',exit?.timezone,report.timezone,!!exit?.timezone&&exit.timezone===report.timezone);
  add('machine.timezone','本机时区',machine.timezone,report.timezone,!!machine.timezone&&machine.timezone===report.timezone);
  add('page.language','网页语言',report.language,language,language&&report.language?report.language===language:null);
  const targetIsZh=language.toLowerCase().startsWith('zh');
  const leakedZh=!targetIsZh&&report.languages.some(item=>item.toLowerCase().startsWith('zh'));
  add('page.languages','语言列表纯净度',report.languages.join(', '),targetIsZh?`${language} 序列`:`仅 ${language} 系`,report.languages.length>0&&!leakedZh&&report.languages[0]===language);
  add('machine.language','本机首选语言',first,language,first&&language?first===language||first.startsWith(language+'-')||(config.follow_machine&&first==='en'&&language==='en-US'):null);
  add('machine.locale','本机区域',machine.locale,region?.country,region&&machine.locale_country?machine.locale_country===region.country:null);
  add('device.platform','设备平台 / 版本',`${report.platform} / ${report.platform_version||'—'}`,`${machine.platform} / ${machine.version}`,matchesDevice({...machine,cores:report.cores},report));
  add('device.cores','逻辑 CPU',report.cores,machine.cores,report.cores>0&&report.cores===machine.cores);
  add('browser.version','浏览器实际版本',report.browser_version,context.engine_version,!!report.browser_version&&report.browser_version===context.engine_version);
  add('page.geolocation','网页定位权限',report.geolocation,'denied',report.geolocation==='denied');
  add('machine.location','本机定位',machine.location_enabled==null?'尚未核验':machine.location_enabled?'开启':'关闭','关闭',machine.location_enabled==null?null:machine.location_enabled===false);
  add('probe.webrtc','WebRTC 本地候选',current?report.webrtc_detail:undefined,'无非本地候选',observed(report.webrtc_ok));
  add('probe.webdriver','自动化接口状态',report.webdriver?'navigator.webdriver = true':report.webdriver===false?'navigator.webdriver = false':undefined,'navigator.webdriver = false',current&&report.webdriver!==undefined?report.webdriver===false:null);
  add('probe.graphics','图形接口状态',report.webgl_renderer, 'WebGL 可读取且非已知软件渲染',observed(report.graphics_ok));
  add('probe.tz-offset','时区偏移读取',current?report.tz_offset_detail:undefined,'可比较的偏移值',observed(report.tz_offset_ok));
  add('probe.canvas-audio','Canvas / 音频接口能力',current?report.media_fingerprint_detail:undefined,'Canvas 绘制与音频接口能力',observed(report.media_fingerprint_ok));
  add('probe.client-hints','客户端提示与屏幕',current?report.client_hints_detail:undefined,'桌面端 UA-CH 与有效屏幕信息',observed(report.client_hints_ok));
  if(!current)problems.push('检测报告版本过旧或无法识别，请重新实测。');
 }
 const hasRealFailure=checks.some(check=>check.ok===false);
 const complete=checks.length===REQUIRED_CHECK_IDS.length&&REQUIRED_CHECK_IDS.every(id=>checks.some(check=>check.id===id&&check.applicable&&check.ok!==null));
 const phase:VerificationPhase=busy
  ?'checking'
  :problems.length>0||hasRealFailure
   ?'failed'
   :complete&&checks.every(check=>check.ok===true)
    ?'passed'
    :'incomplete';
 return {phase,checks,problems:[...new Set(problems)],failures:checks.filter(check=>check.ok!==true)};
}
