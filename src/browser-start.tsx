/**
 * [INPUT]: 随机令牌回环服务上下文、浏览器原生 navigator/Intl/Permissions/WebRTC/WebGL/Canvas/Audio/UA-CH、5 类跨执行上下文探针（`browser-context-probe.ts?worker&url`）与实际 HTTPS 出口与服务备援目录与宿主界面语言。
 * [OUTPUT]: 明确被测养号/CLI浏览器归属与仅环境范围的20项实测页；输出 Canvas 2D FNV-1a 像素哈希、音频节点、Sift v122 屏幕与外框校验，以及 Window/Worker/SharedWorker/ServiceWorker/同源及沙盒 Iframe 9 维跨上下文一致性（含未提前截断的 WebGL 渲染器对齐与 <300B Report 线缆截断）与防篡改矩阵和阻断级告警，未知或不支持降级保持中性。
 * [POS]: 独立 Chromium 入口，复用工具箱控件；成功状态只由真实观测决定，不接入 Tauri 权限，不伪造地理位置。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Button, MotionRoot, TooltipProvider } from 'cromma-ui';
import { useEffect, useState } from 'react';
import {setLocale,useI18n} from "./i18n";
import { createRoot } from 'react-dom/client';
import {
  classifyBrowserExitIsp,
  type BrowserContext,
  type CrossContextCellStatus,
  type CrossContextEvaluation,
  type CrossContextKind,
  type CrossContextProbeRecord,
  type CrossContextSnapshot,
  type Exit,
  type NativeIntegrityResult,
  type Report,
} from './browser-model';
import { probeBrowserExit } from './browser-network';
import {probeWebRtcLocalCandidates,type WebRtcPeer,type WebRtcProbeResult} from './browser-webrtc';
import {
  evaluateCrossContextConsistency,
  truncateUtf8Bytes,
  verifyBrowser,
} from './browser-verification';
import probeUrl from './browser-context-probe.ts?worker&url';
import browserLogo from '../assets/browser-logo.jpg';
import './index.css';
import './style.css';
import './browser-start.css';

async function api<T>(route: string, body?: unknown): Promise<T> {
    const response = await fetch(new URL(route, location.href), {
        signal: AbortSignal.timeout(3000),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error("本地核验连接失败，请从Claude-Local重新打开浏览器。");
    return response.json();
}

function probeWebRtcLeak(): Promise<WebRtcProbeResult> {
    if (typeof RTCPeerConnection === 'undefined') {
        return Promise.resolve({ ok: null, detail: 'WebRTC 接口不可用，未测量', reason: 'constructor_error', elapsedMs: 0 });
    }
    return probeWebRtcLocalCandidates(
        () => new RTCPeerConnection({ iceServers: [] }) as unknown as WebRtcPeer,
    );
}

function probeGraphics(): { ok: boolean; vendor: string; renderer: string } {
    try {
        const canvas2d = document.createElement('canvas');
        const ctx2d = canvas2d.getContext('2d');
        if (!ctx2d) return { ok: false, vendor: '', renderer: 'Canvas 2D 不可用' };
        const canvasGl = document.createElement('canvas');
        const gl = (canvasGl.getContext('webgl2') || canvasGl.getContext('webgl') || canvasGl.getContext('experimental-webgl')) as WebGLRenderingContext | null;
        if (!gl) return { ok: false, vendor: '', renderer: 'WebGL 不可用' };
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        const rawVendor = dbg
            ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || '')
            : String(gl.getParameter(gl.VENDOR) || '');
        const rawRenderer = dbg
            ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '')
            : String(gl.getParameter(gl.RENDERER) || '');
        const renderer = rawRenderer.trim() || 'WebGL Hardware';
        const isSoftware = /swiftshader|llvmpipe|software\s*rasterizer|basic\s*render\s*driver/i.test(renderer);
        return { ok: !isSoftware, vendor: rawVendor.trim(), renderer };
    } catch {
        return { ok: false, vendor: '', renderer: '图形接口异常' };
    }
}

function probeTimezoneOffset(timezone: string): { ok: boolean; detail: string } {
    try {
        const now = new Date();
        const actualOffsetMin = -now.getTimezoneOffset();
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'shortOffset' }).formatToParts(now);
        const tzPart = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT';
        if (tzPart === 'GMT' || tzPart === 'UTC') {
            return { ok: actualOffsetMin === 0, detail: actualOffsetMin === 0 ? 'UTC+00:00 (Intl 与时钟一致)' : `${tzPart} vs 本地偏移冲突` };
        }
        const match = tzPart.match(/^(?:GMT|UTC)([+-])(\d{1,2})(?::(\d{2}))?$/);
        if (!match) {
            return { ok: true, detail: `${tzPart} (Intl 正常)` };
        }
        const sign = match[1] === '-' ? -1 : 1;
        const hours = Number(match[2] || 0);
        const mins = Number(match[3] || 0);
        const expectedOffsetMin = sign * (hours * 60 + mins);
        const label = `UTC${match[1]}${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
        const ok = expectedOffsetMin === actualOffsetMin;
        return { ok, detail: ok ? `${label} (Intl 与时钟一致)` : `${label} vs 本地时钟冲突` };
    } catch {
        return { ok: false, detail: '时区偏移读取异常' };
    }
}

function probeMediaFingerprint(): { ok: boolean|null; detail: string } {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 16;
        const ctx = canvas.getContext('2d');
        if (!ctx) return { ok: false, detail: 'Canvas 2D 被禁用' };
        const grad = ctx.createLinearGradient(0, 0, 64, 16);
        grad.addColorStop(0, '#c96442');
        grad.addColorStop(1, '#2563eb');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 64, 16);
        ctx.fillStyle = '#141413';
        ctx.font = '11px sans-serif';
        ctx.fillText('Claude', 4, 12);
        const pixels = ctx.getImageData(0, 0, 64, 16).data;
        const colors = new Set<number>();
        let fnv = 0x811c9dc5;
        for (let i = 0; i < pixels.length; i++) {
            fnv ^= pixels[i];
            fnv = Math.imul(fnv, 0x01000193) >>> 0;
            if ((i & 15) === 0 && i + 2 < pixels.length) {
                const packed = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
                if (packed > 0) colors.add(packed);
            }
        }
        if (colors.size < 3) {
            return { ok: false, detail: 'Canvas 像素熵异常或被拦截' };
        }
        const hashHex = fnv.toString(16).padStart(8, '0');
        const OfflineCtx = window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
        if (!OfflineCtx) return { ok: null, detail: 'Canvas 2D 可绘制；OfflineAudioContext 不可用，音频能力未知' };
        const audio = new OfflineCtx(1, 44100, 44100);
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        gain.gain.value = 0.25;
        osc.connect(gain);
        gain.connect(audio.destination);
        const audioOk = audio.sampleRate >= 8000 && audio.sampleRate <= 192000 && gain.gain.value === 0.25;
        return { ok: audioOk, detail: `Canvas #${hashHex} · OfflineAudioContext ${audio.sampleRate}Hz 正常` };
    } catch {
        return { ok: null, detail: 'Canvas / 音频接口读取失败，结果未知' };
    }
}

function probeClientHintsAndScreen(): { ok: boolean; detail: string } {
    try {
        const nav = navigator as Navigator & {
            userAgentData?: { mobile?: boolean; platform?: string };
            pdfViewerEnabled?: boolean;
        };
        const uaData = nav.userAgentData;
        const isDesktop = uaData?.mobile !== true;
        const uaPlatform = typeof uaData?.platform === 'string' ? uaData.platform.trim().toLowerCase() : '';
        const navPlatform = typeof nav.platform === 'string' ? nav.platform.trim().toLowerCase() : '';
        const uaPlatformOk = !uaPlatform
            ? true
            : /^(android|ios|iphone|ipad|ipod)$/i.test(uaPlatform)
                ? false
                : navPlatform
                    ? (uaPlatform === 'windows' ? /^win/.test(navPlatform)
                        : uaPlatform === 'macos' ? /^mac/.test(navPlatform)
                        : uaPlatform === 'linux' ? /linux/.test(navPlatform)
                        : true)
                    : true;
        const width = window.screen?.width ?? 0;
        const height = window.screen?.height ?? 0;
        const availWidth = window.screen?.availWidth ?? 0;
        const availHeight = window.screen?.availHeight ?? 0;
        const depth = window.screen?.colorDepth ?? 0;
        const pixelDepth = window.screen?.pixelDepth ?? 0;
        const dpr = window.devicePixelRatio;
        const screenBaseOk =
            width > 0 &&
            height > 0 &&
            availWidth > 0 &&
            availHeight > 0 &&
            depth >= 24 &&
            pixelDepth === depth;
        const availConsistent = availWidth > 0 && availHeight > 0
            ? width >= availWidth && height >= availHeight
            : true;
        const dprOk = typeof dpr === 'number' && Number.isFinite(dpr) && dpr > 0;
        const primaryLang = nav.language;
        const langs = nav.languages;
        const hasLangs = Boolean(primaryLang) && Array.isArray(langs) && langs.length > 0;
        const langConsistent = hasLangs
            ? primaryLang.toLowerCase() === String(langs[0]).toLowerCase()
            : false;
        const frameOk = !(
            (window.innerWidth > 0 && typeof window.outerWidth === 'number' && window.outerWidth === 0) ||
            (window.innerHeight > 0 && typeof window.outerHeight === 'number' && window.outerHeight === 0)
        );
        const pdfOk = typeof nav.pdfViewerEnabled === 'boolean' ? nav.pdfViewerEnabled === true : true;
        const reasons: string[] = [];
        if (!isDesktop) reasons.push('UA-CH 报告移动端');
        if (!uaPlatformOk) reasons.push('UA-CH 平台非桌面或与 navigator.platform 不一致');
        if (!screenBaseOk) reasons.push('屏幕尺寸或色深异常');
        if (!availConsistent) reasons.push('availWidth/availHeight 超出屏幕尺寸');
        if (!dprOk) reasons.push('devicePixelRatio 无效');
        if (!hasLangs) reasons.push('navigator.languages 为空');
        else if (!langConsistent) reasons.push('language 与 languages[0] 不一致');
        if (!frameOk) reasons.push('outerWidth/outerHeight 为 0');
        if (!pdfOk) reasons.push('PDF 查看器未启用');
        const ok = reasons.length === 0;
        return {
            ok,
            detail: ok
                ? `${width}×${height} · ${depth}-bit · Desktop`
                : `客户端提示或屏幕异常：${reasons.join('；')}`,
        };
    } catch {
        return { ok: false, detail: '屏幕或客户端提示异常' };
    }
}

const ISOLATED_CONTEXT_KINDS: readonly Exclude<CrossContextKind, 'window'>[] = [
    'worker',
    'shared-worker',
    'service-worker',
    'same-origin-iframe',
    'sandbox-iframe',
];

const ALL_CONTEXT_PILLS: readonly { kind: CrossContextKind; labelKey: string }[] = [
    { kind: 'window', labelKey: 'browserVerify.crossContext.ctxWindow' },
    { kind: 'worker', labelKey: 'browserVerify.crossContext.ctxWorker' },
    { kind: 'shared-worker', labelKey: 'browserVerify.crossContext.ctxSharedWorker' },
    { kind: 'service-worker', labelKey: 'browserVerify.crossContext.ctxServiceWorker' },
    { kind: 'same-origin-iframe', labelKey: 'browserVerify.crossContext.ctxSameOriginIframe' },
    { kind: 'sandbox-iframe', labelKey: 'browserVerify.crossContext.ctxSandboxIframe' },
];

function escapeHtmlAttr(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function extractMainTopScriptOrigin(stack: string): string | null {
    const match = stack.match(/https?:\/\/[^/\s):]+(?::\d+)?/);
    return match ? match[0] : null;
}

function invokeMainIllegalReceiverProbe(
    fn: (this: unknown, ...args: unknown[]) => unknown,
    args: unknown[],
    allowAnonymousToString: boolean,
    expectedOrigin: string | null,
): string | null {
    try {
        fn.apply({}, args);
        return 'no_throw';
    } catch (err) {
        if (!(err instanceof TypeError) && (err as { name?: string } | null)?.name !== 'TypeError') {
            return 'non_type_error';
        }
        const stack = typeof (err as { stack?: unknown } | null)?.stack === 'string'
            ? String((err as { stack: string }).stack)
            : '';
        if (!stack) return 'empty_stack';
        if (/(?:chrome-extension|moz-extension|safari-extension):\/\/|at Proxy\.|at Object\.apply|at Reflect\.apply/i.test(stack)) {
            return 'proxy_or_extension_frame';
        }
        const frames = stack
            .split(/\r?\n/)
            .slice(1)
            .map(line => line.trim())
            .filter(Boolean);
        if (frames.length === 0) return 'missing_frames';
        let checkFrame = frames[0] || '';
        if (allowAnonymousToString && /^at (?:Object\.)?toString \(<anonymous>\)$/.test(checkFrame)) {
            checkFrame = frames[1] || '';
        }
        if (!checkFrame || /<anonymous>/.test(checkFrame)) {
            return allowAnonymousToString ? 'unexpected_tostring_stack' : 'unexpected_wrapper_frame';
        }
        if (expectedOrigin && !checkFrame.includes(expectedOrigin)) {
            return 'foreign_frame_origin';
        }
        return null;
    }
}

function collectMainNativeIntegrity(): NativeIntegrityResult {
    const details: string[] = [];
    let toStringOk = true;
    let ownPropTampered = false;
    let stackTampered = false;
    const fnToString = Function.prototype.toString;
    const checkFn = (label: string, fn: unknown) => {
        if (typeof fn !== 'function') return;
        try {
            if (!/\[native code\]/.test(fnToString.call(fn))) {
                toStringOk = false;
                details.push(`${label}:non_native_toString`);
            }
            if (Object.getOwnPropertyDescriptor(fn, 'toString') !== undefined) {
                toStringOk = false;
                details.push(`${label}:own_toString_descriptor`);
            }
        } catch {
            toStringOk = false;
            details.push(`${label}:toString_threw`);
        }
    };

    checkFn('Function.prototype.toString', fnToString);
    checkFn('Intl.DateTimeFormat', Intl?.DateTimeFormat);
    checkFn('Intl.DateTimeFormat.prototype.resolvedOptions', Intl?.DateTimeFormat?.prototype?.resolvedOptions);
    if (typeof OffscreenCanvas !== 'undefined' && OffscreenCanvas.prototype?.convertToBlob) {
        checkFn('OffscreenCanvas.prototype.convertToBlob', OffscreenCanvas.prototype.convertToBlob);
    }
    checkFn('HTMLCanvasElement.prototype.toDataURL', HTMLCanvasElement?.prototype?.toDataURL);
    checkFn('CanvasRenderingContext2D.prototype.getImageData', CanvasRenderingContext2D?.prototype?.getImageData);
    checkFn('WebGLRenderingContext.prototype.getParameter', WebGLRenderingContext?.prototype?.getParameter);
    if (typeof WebGL2RenderingContext !== 'undefined') {
        checkFn('WebGL2RenderingContext.prototype.getParameter', WebGL2RenderingContext.prototype?.getParameter);
    }
    const navProto = Navigator?.prototype as unknown as Record<string, unknown> | undefined;
    if (navProto) {
        for (const prop of ['platform', 'languages', 'language', 'hardwareConcurrency', 'deviceMemory', 'userAgent', 'webdriver']) {
            const desc = Object.getOwnPropertyDescriptor(navProto, prop);
            if (desc?.get) checkFn(`Navigator.prototype.${prop}`, desc.get);
        }
    }
    for (const key of ['platform', 'language', 'languages', 'hardwareConcurrency', 'deviceMemory', 'userAgent', 'userAgentData', 'webdriver']) {
        if (Object.getOwnPropertyDescriptor(navigator, key) !== undefined) {
            ownPropTampered = true;
            details.push(`navigator.own_${key}`);
        }
    }
    if (typeof screen !== 'undefined') {
        for (const key of ['width', 'height', 'availWidth', 'availHeight', 'colorDepth', 'pixelDepth', 'orientation']) {
            if (Object.getOwnPropertyDescriptor(screen, key) !== undefined) {
                ownPropTampered = true;
                details.push(`screen.own_${key}`);
            }
        }
    }
    if (Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace') !== undefined) {
        stackTampered = true;
        details.push('Error.prepareStackTrace_defined');
    }
    const baselineStack = new Error().stack;
    if (typeof baselineStack !== 'string') {
        stackTampered = true;
        details.push('Error.stack_missing');
    }
    const expectedOrigin = typeof baselineStack === 'string' ? extractMainTopScriptOrigin(baselineStack) : null;

    const toStringIllegal = invokeMainIllegalReceiverProbe(
        fnToString as (this: unknown, ...args: unknown[]) => unknown,
        [],
        true,
        expectedOrigin,
    );
    if (toStringIllegal) {
        stackTampered = true;
        details.push(`toString:${toStringIllegal}`);
    }
    if (navProto) {
        for (const prop of ['platform', 'languages']) {
            const getter = Object.getOwnPropertyDescriptor(navProto, prop)?.get;
            if (typeof getter === 'function') {
                const reason = invokeMainIllegalReceiverProbe(
                    getter as (this: unknown, ...args: unknown[]) => unknown,
                    [],
                    false,
                    expectedOrigin,
                );
                if (reason) {
                    stackTampered = true;
                    details.push(`nav_${prop}:${reason}`);
                }
            }
        }
    }
    if (typeof WebGLRenderingContext !== 'undefined' && typeof WebGLRenderingContext.prototype?.getParameter === 'function') {
        const reason = invokeMainIllegalReceiverProbe(
            WebGLRenderingContext.prototype.getParameter as (this: unknown, ...args: unknown[]) => unknown,
            [0x1f00],
            false,
            expectedOrigin,
        );
        if (reason) {
            stackTampered = true;
            details.push(`webgl_getParameter:${reason}`);
        }
    }
    if (typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype?.toDataURL === 'function') {
        const reason = invokeMainIllegalReceiverProbe(
            HTMLCanvasElement.prototype.toDataURL as (this: unknown, ...args: unknown[]) => unknown,
            [],
            false,
            expectedOrigin,
        );
        if (reason) {
            stackTampered = true;
            details.push(`canvas_toDataURL:${reason}`);
        }
    }

    return {
        ok: toStringOk && !ownPropTampered && !stackTampered,
        toStringOk,
        ownPropTampered,
        stackTampered,
        details: details.slice(0, 8),
    };
}

function collectMainOffscreenWebgl(): CrossContextSnapshot['offscreenWebgl'] {
    try {
        if (typeof OffscreenCanvas === 'undefined') {
            return { supported: false, vendor: '', renderer: '', debugExtension: false };
        }
        const oc = new OffscreenCanvas(16, 16);
        const gl = (oc.getContext('webgl2') || oc.getContext('webgl')) as WebGLRenderingContext | null;
        if (!gl) {
            return { supported: false, vendor: '', renderer: '', debugExtension: false };
        }
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        const vendor = dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || '') : String(gl.getParameter(gl.VENDOR) || '');
        const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : String(gl.getParameter(gl.RENDERER) || '');
        return {
            supported: true,
            vendor: vendor.trim(),
            renderer: renderer.trim(),
            debugExtension: Boolean(dbg),
        };
    } catch {
        return { supported: false, vendor: '', renderer: '', debugExtension: false };
    }
}

function collectMainSnapshot(highEntropy: {
    platformVersion?: string;
    uaFullVersion?: string;
    architecture?: string;
    bitness?: string;
    model?: string;
} | null): CrossContextSnapshot {
    const nav = navigator as Navigator & {
        deviceMemory?: number;
        userAgentData?: {
            mobile?: boolean;
            platform?: string;
            brands?: Array<{ brand?: string; version?: string }>;
        };
    };
    const dtf = new Intl.DateTimeFormat().resolvedOptions();
    const uad = nav.userAgentData
        ? {
            mobile: Boolean(nav.userAgentData.mobile),
            platform: String(nav.userAgentData.platform || ''),
            brands: Array.isArray(nav.userAgentData.brands)
                ? nav.userAgentData.brands.map(b => ({ brand: String(b?.brand || ''), version: String(b?.version || '') }))
                : [],
            highEntropy: highEntropy
                ? {
                    platformVersion: String(highEntropy.platformVersion || ''),
                    uaFullVersion: String(highEntropy.uaFullVersion || ''),
                    architecture: String(highEntropy.architecture || ''),
                    bitness: String(highEntropy.bitness || ''),
                    model: String(highEntropy.model || ''),
                }
                : null,
        }
        : null;

    return {
        kind: 'window',
        isSecureContext: Boolean(window.isSecureContext),
        platform: String(nav.platform || ''),
        language: String(nav.language || ''),
        languages: Array.isArray(nav.languages) ? nav.languages.map(String) : [],
        hardwareConcurrency: typeof nav.hardwareConcurrency === 'number' && Number.isFinite(nav.hardwareConcurrency) ? nav.hardwareConcurrency : null,
        deviceMemory: typeof nav.deviceMemory === 'number' && Number.isFinite(nav.deviceMemory) ? nav.deviceMemory : null,
        userAgentData: uad,
        intl: {
            timeZone: String(dtf.timeZone || ''),
            locale: String(dtf.locale || ''),
            timezoneOffsetMin: -new Date().getTimezoneOffset(),
        },
        screen: {
            available: typeof window.screen !== 'undefined',
            width: typeof window.screen?.width === 'number' ? window.screen.width : null,
            height: typeof window.screen?.height === 'number' ? window.screen.height : null,
            orientationType: typeof window.screen?.orientation?.type === 'string' ? window.screen.orientation.type : null,
            orientationAngle: typeof window.screen?.orientation?.angle === 'number' && Number.isFinite(window.screen.orientation.angle)
                ? window.screen.orientation.angle
                : null,
        },
        offscreenWebgl: collectMainOffscreenWebgl(),
        nativeIntegrity: collectMainNativeIntegrity(),
    };
}

function probeDedicatedWorker(url: string, isModule: boolean): Promise<CrossContextProbeRecord> {
    if (typeof Worker === 'undefined') {
        return Promise.resolve({ kind: 'worker', status: 'unsupported', reason: 'worker_unavailable', snapshot: null });
    }
    return new Promise(resolve => {
        let settled = false;
        let worker: Worker | null = null;
        const done = (rec: CrossContextProbeRecord) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { worker?.terminate(); } catch { /* ignore */ }
            resolve(rec);
        };
        const timer = setTimeout(() => done({ kind: 'worker', status: 'unsupported', reason: 'worker_timeout', snapshot: null }), 2000);
        try {
            worker = new Worker(url, isModule ? { type: 'module' } : undefined);
            worker.onmessage = ev => {
                const snap = ev.data as CrossContextSnapshot | null;
                if (snap && typeof snap === 'object') {
                    done({ kind: 'worker', status: 'ok', snapshot: { ...snap, kind: 'worker' } });
                } else {
                    done({ kind: 'worker', status: 'unsupported', reason: 'worker_invalid_payload', snapshot: null });
                }
            };
            worker.onerror = () => done({ kind: 'worker', status: 'unsupported', reason: 'worker_error', snapshot: null });
            worker.postMessage({ type: 'probe' });
        } catch {
            done({ kind: 'worker', status: 'unsupported', reason: 'worker_construct_failed', snapshot: null });
        }
    });
}

function probeSharedWorker(url: string, isModule: boolean): Promise<CrossContextProbeRecord> {
    if (typeof SharedWorker === 'undefined') {
        return Promise.resolve({ kind: 'shared-worker', status: 'unsupported', reason: 'shared_worker_unavailable', snapshot: null });
    }
    return new Promise(resolve => {
        let settled = false;
        let sw: SharedWorker | null = null;
        const done = (rec: CrossContextProbeRecord) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { sw?.port.close(); } catch { /* ignore */ }
            resolve(rec);
        };
        const timer = setTimeout(() => done({ kind: 'shared-worker', status: 'unsupported', reason: 'shared_worker_timeout', snapshot: null }), 2000);
        try {
            sw = new SharedWorker(url, isModule ? { type: 'module' } : undefined);
            sw.port.onmessage = ev => {
                const snap = ev.data as CrossContextSnapshot | null;
                if (snap && typeof snap === 'object') {
                    done({ kind: 'shared-worker', status: 'ok', snapshot: { ...snap, kind: 'shared-worker' } });
                } else {
                    done({ kind: 'shared-worker', status: 'unsupported', reason: 'shared_worker_invalid_payload', snapshot: null });
                }
            };
            sw.onerror = () => done({ kind: 'shared-worker', status: 'unsupported', reason: 'shared_worker_error', snapshot: null });
            sw.port.start();
            sw.port.postMessage({ type: 'probe' });
        } catch {
            done({ kind: 'shared-worker', status: 'unsupported', reason: 'shared_worker_construct_failed', snapshot: null });
        }
    });
}

async function probeServiceWorker(url: string, isModule: boolean): Promise<CrossContextProbeRecord> {
    if (!window.isSecureContext || !('serviceWorker' in navigator) || typeof navigator.serviceWorker?.register !== 'function') {
        return { kind: 'service-worker', status: 'unsupported', reason: 'sw_unavailable', snapshot: null };
    }
    let reg: ServiceWorkerRegistration | null = null;
    try {
        const regPromise = navigator.serviceWorker.register(url, isModule ? { type: 'module' } : undefined);
        reg = await Promise.race([
            regPromise,
            new Promise<null>(resolve => setTimeout(() => resolve(null), 2000)),
        ]);
        if (!reg) {
            return { kind: 'service-worker', status: 'unsupported', reason: 'sw_register_timeout', snapshot: null };
        }
        const sw = reg.active || reg.waiting || reg.installing;
        if (!sw) {
            return { kind: 'service-worker', status: 'unsupported', reason: 'sw_no_worker', snapshot: null };
        }
        if (sw.state !== 'activated') {
            const activated = await new Promise<boolean>(resolve => {
                let done = false;
                const finish = (ok: boolean) => {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    sw.removeEventListener('statechange', onState);
                    resolve(ok);
                };
                const onState = () => {
                    if (sw.state === 'activated') finish(true);
                    else if (sw.state === 'redundant') finish(false);
                };
                const timer = setTimeout(() => finish(false), 2000);
                sw.addEventListener('statechange', onState);
                onState();
            });
            if (!activated) {
                return { kind: 'service-worker', status: 'unsupported', reason: 'sw_activation_timeout', snapshot: null };
            }
        }
        const snap = await new Promise<CrossContextSnapshot | null>(resolve => {
            let done = false;
            const channel = new MessageChannel();
            const finish = (val: CrossContextSnapshot | null) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                channel.port1.close();
                resolve(val);
            };
            const timer = setTimeout(() => finish(null), 1500);
            channel.port1.onmessage = ev => {
                finish((ev.data as CrossContextSnapshot | null) ?? null);
            };
            channel.port1.start();
            sw.postMessage({ type: 'probe' }, [channel.port2]);
        });
        if (!snap || typeof snap !== 'object') {
            return { kind: 'service-worker', status: 'unsupported', reason: 'sw_probe_timeout', snapshot: null };
        }
        return { kind: 'service-worker', status: 'ok', snapshot: { ...snap, kind: 'service-worker' } };
    } catch {
        return { kind: 'service-worker', status: 'unsupported', reason: 'sw_register_failed', snapshot: null };
    } finally {
        if (reg) {
            await reg.unregister().catch(() => {});
        }
    }
}

function probeIframeContext(url: string, sandboxed: boolean, isModule: boolean): Promise<CrossContextProbeRecord> {
    const kind: Exclude<CrossContextKind, 'window'> = sandboxed ? 'sandbox-iframe' : 'same-origin-iframe';
    if (typeof document === 'undefined' || !document.body) {
        return Promise.resolve({ kind, status: 'unsupported', reason: 'dom_unavailable', snapshot: null });
    }
    return new Promise(resolve => {
        let settled = false;
        const iframe = document.createElement('iframe');
        const onMessage = (ev: MessageEvent) => {
            if (ev.source !== iframe.contentWindow) return;
            const payload = ev.data as { source?: string; snapshot?: CrossContextSnapshot } | null;
            if (!payload || payload.source !== 'cl-ctx-probe' || !payload.snapshot) return;
            done({ kind, status: 'ok', snapshot: { ...payload.snapshot, kind } });
        };
        const done = (rec: CrossContextProbeRecord) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            window.removeEventListener('message', onMessage);
            iframe.remove();
            resolve(rec);
        };
        const timer = setTimeout(() => done({ kind, status: 'unsupported', reason: 'iframe_timeout', snapshot: null }), 2000);
        try {
            iframe.setAttribute('aria-hidden', 'true');
            iframe.tabIndex = -1;
            iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden;pointer-events:none';
            if (sandboxed) {
                iframe.setAttribute('sandbox', 'allow-scripts');
                iframe.name = 'cl-ctx-sandbox';
            }
            window.addEventListener('message', onMessage);
            iframe.srcdoc = `<!doctype html><meta charset="utf-8"><script${isModule ? ' type="module"' : ''} src="${escapeHtmlAttr(url)}"></script>`;
            document.body.appendChild(iframe);
        } catch {
            done({ kind, status: 'unsupported', reason: 'iframe_mount_failed', snapshot: null });
        }
    });
}

async function probeAllIsolatedContexts(): Promise<CrossContextProbeRecord[]> {
    let resolvedUrl: URL;
    try {
        resolvedUrl = new URL(probeUrl, location.href);
    } catch {
        return ISOLATED_CONTEXT_KINDS.map(kind => ({ kind, status: 'unsupported', reason: 'invalid_probe_url', snapshot: null }));
    }
    if (resolvedUrl.origin !== location.origin || (resolvedUrl.protocol !== 'http:' && resolvedUrl.protocol !== 'https:')) {
        return ISOLATED_CONTEXT_KINDS.map(kind => ({ kind, status: 'unsupported', reason: 'origin_mismatch', snapshot: null }));
    }
    const href = resolvedUrl.href;
    const isModule = resolvedUrl.searchParams.get('type') === 'module';
    const budgetPromise = Promise.all([
        probeDedicatedWorker(href, isModule),
        probeSharedWorker(href, isModule),
        probeServiceWorker(href, isModule),
        probeIframeContext(href, false, isModule),
        probeIframeContext(href, true, isModule),
    ]);
    return Promise.race([
        budgetPromise,
        new Promise<CrossContextProbeRecord[]>(resolve =>
            setTimeout(
                () => resolve(ISOLATED_CONTEXT_KINDS.map(kind => ({ kind, status: 'unsupported', reason: 'budget_timeout', snapshot: null }))),
                2500,
            ),
        ),
    ]);
}

function Start() {
    const {t,locale}=useI18n();
    const [context, setContext] = useState<BrowserContext | null>(null), [report, setReport] = useState<Report | null>(null), [crossContext, setCrossContext] = useState<CrossContextEvaluation | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState(''), [linked, setLinked] = useState(false), [reportedAt, setReportedAt] = useState(0);

    async function measure() {
        setBusy(true);
        setError('');
        setReport(null);
        setCrossContext(null);
        setReportedAt(0);
        try {
            const context = await api<BrowserContext>('context');
            setContext(context);setLocale(context.ui_language);
            setLinked(true);
            const ua = (navigator as Navigator & {
                userAgentData?: {
                    getHighEntropyValues: (keys: string[]) => Promise<{
                        platformVersion?: string;
                        uaFullVersion?: string;
                        architecture?: string;
                        bitness?: string;
                        model?: string;
                    }>;
                };
            }).userAgentData;
            let exit: Exit | null = null, networkError = '';
            const exitPromise = probeBrowserExit(context.exit_services, fetch, context.exit_classification_service).catch(e => {
                networkError = e instanceof Error ? e.message : String(e);
                return null;
            });
            const [high, permission, webrtc, isolatedContexts, exitResult] = await Promise.all([
                ua?.getHighEntropyValues(['platformVersion', 'uaFullVersion', 'architecture', 'bitness', 'model']).catch(() => null),
                navigator.permissions.query({ name: 'geolocation' }).then(x => x.state).catch(() => 'unknown'),
                probeWebRtcLeak(),
                probeAllIsolatedContexts(),
                exitPromise,
            ]);
            exit = exitResult;
            const graphics = probeGraphics();
            const resolvedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const tzOffset = probeTimezoneOffset(resolvedTz);
            const mediaFp = probeMediaFingerprint();
            const clientHints = probeClientHintsAndScreen();
            const mainSnapshot = collectMainSnapshot(high ?? null);
            const crossEval = evaluateCrossContextConsistency(mainSnapshot, isolatedContexts, {
                vendor: graphics.vendor,
                renderer: graphics.renderer,
            });
            setCrossContext(crossEval);

            const hasWebglMismatch = crossEval.mismatches.some(m => m.metricId === 'ctx.offscreen-webgl');
            const hasIntlMismatch = crossEval.mismatches.some(m => m.metricId === 'ctx.intl');
            const otherMismatchIds = [...new Set(
                crossEval.mismatches
                    .filter(m => m.metricId !== 'ctx.offscreen-webgl' && m.metricId !== 'ctx.intl')
                    .map(m => m.metricId),
            )];
            const hasClientHintOrTamperMismatch = otherMismatchIds.length > 0;

            const observed: Report = {
                language: navigator.language,
                schema_version: 1,
                languages: [...navigator.languages],
                timezone: resolvedTz,
                platform: navigator.platform,
                cores: navigator.hardwareConcurrency,
                user_agent: navigator.userAgent,
                platform_version: high?.platformVersion || '',
                browser_version: high?.uaFullVersion || navigator.userAgent.match(/(?:Chrome|Chromium)\/([\d.]+)/)?.[1] || '',
                geolocation: permission,
                exit,
                error: networkError,
                webrtc_ok: webrtc.ok,
                webrtc_detail: webrtc.detail,
                webrtc_reason: webrtc.reason,
                webrtc_elapsed_ms: Number.isFinite(webrtc.elapsedMs) && webrtc.elapsedMs >= 0 && webrtc.elapsedMs <= 120000 ? Math.round(webrtc.elapsedMs) : undefined,
                webdriver: Boolean(navigator.webdriver),
                graphics_ok: hasWebglMismatch ? false : graphics.ok,
                webgl_renderer: hasWebglMismatch
                    ? truncateUtf8Bytes(`Offscreen/WebGL mismatch: ${graphics.renderer}`, 280)
                    : truncateUtf8Bytes(graphics.renderer, 280),
                tz_offset_ok: hasIntlMismatch ? false : tzOffset.ok,
                tz_offset_detail: hasIntlMismatch
                    ? truncateUtf8Bytes(`Cross-context Intl mismatch (${tzOffset.detail})`, 280)
                    : tzOffset.detail,
                media_fingerprint_ok: mediaFp.ok,
                media_fingerprint_detail: mediaFp.detail,
                client_hints_ok: hasClientHintOrTamperMismatch ? false : clientHints.ok,
                client_hints_detail: hasClientHintOrTamperMismatch
                    ? truncateUtf8Bytes(`Cross-context conflict: ${otherMismatchIds.join(', ')}`, 280)
                    : clientHints.detail,
            };
            await api('report', observed);
            setReport(observed);
            setReportedAt(Date.now());
            setLinked(true);
        }
        catch (e) {
            setLinked(false);
            setError(e instanceof Error ? e.message : String(e));
        }
        finally {
            setBusy(false);
        }
    }
    useEffect(() => { void measure(); let live = true; const timer = setInterval(() => { void api<BrowserContext>('context').then(next => { if (live) {
        setContext(next);setLocale(next.ui_language);
        setLinked(true);
    } }).catch(() => { if (live)
        setLinked(false); }); }, 10000); return () => { live = false; clearInterval(timer); }; }, []);
    const isStale = !!reportedAt && (Date.now() - reportedAt > 10 * 60 * 1000);
    const result=verifyBrowser(context,report,linked,error,busy,reportedAt,crossContext);
    const {phase,checks,problems}=result;
    const title=phase==='checking'?'检测中':phase==='passed'?'检测通过':phase==='incomplete'?'检测未完成':'检测未通过';
    const identity=context?.identity;
    const identityName=identity?.name||t(identity?.status==='empty'?'空身份':identity?.status==='unlinked'?'通用浏览器资料':'当前身份');
    const identityStatus=!context&&busy?'正在读取身份':!linked?'主应用未连接':!identity?'身份待核对':identity.status==='warming'?'warming.verificationOwner':identity.status==='unlinked'?'未联动':identity.status==='mismatch'?'身份待同步':identity.status==='unknown'?'身份待核对':'身份已联动';
    const identityReady=linked&&!!identity?.linked&&['linked','draft','empty','warming'].includes(identity.status);
    const ispKind = classifyBrowserExitIsp(report?.exit);
    const contextStatusLabel = (status: CrossContextCellStatus | 'pending') =>
        t(
            status === 'matched'
                ? 'browserVerify.crossContext.statusMatched'
                : status === 'mismatch'
                    ? 'browserVerify.crossContext.statusMismatch'
                    : status === 'unsupported'
                        ? 'browserVerify.crossContext.statusUnsupported'
                        : status === 'not_applicable'
                            ? 'browserVerify.crossContext.statusNotApplicable'
                            : 'browserVerify.crossContext.statusPending',
        );

    return <div className={`browser-verification-page is-${phase}`} data-verification={phase}>
     <main className="browser-start">
      <header className="verification-brand"><div><img src={browserLogo} width={28} height={28} alt=""/><strong>Claude-Local Browser</strong></div><span>Chromium {context?.engine_version||'—'}</span></header>
      <section className={`verification-identity${identityReady?' linked':''}`} aria-label={t('浏览器身份')} data-identity={identity?.status||'unknown'}>
       <div className="verification-identity-avatar" aria-hidden="true">{identity?.status==='empty'?'∅':Array.from(identityName)[0]?.toUpperCase()||'?'}</div>
       <div className="verification-identity-account"><span>{t(identity?.status==='warming'?'warming.verificationOwner':'浏览器身份')}</span><h2>{identityName}</h2><div>{identity?.email&&identity.email!==identityName&&<span>{identity.email}</span>}{identity?.organization&&<span>{identity.organization}</span>}</div></div>
       <span className={`verification-identity-state${identity?.status==='mismatch'||identity?.status==='unknown'?' attention':''}`} role="status">{t(identityStatus)}</span>
      </section>
      <p className="verification-scope" data-browser-verification-scope>{t('browser.verificationScope')}</p>
      <section className="verification-banner" aria-labelledby="verification-title" aria-busy={busy}>
       <div className="verification-signal" aria-hidden="true"><i/><i/><svg viewBox="0 0 96 96"><circle cx="48" cy="48" r="44" fill="currentColor"/>{phase==='passed'?<path d="m27 49 14 14 28-31"/>:phase==='failed'?<path d="m34 34 28 28m0-28L34 62"/>:<><path d="M48 27v23"/><circle cx="48" cy="65" r="3" fill="white" stroke="none"/></>}</svg></div>
       <div className="verification-title" aria-live="polite"><span>{t('浏览器环境')}</span><h1 id="verification-title">{t(title)}</h1>{!busy&&<span>{t('已通过 {v0} / {v1} 项',{v0:checks.filter(check=>check.ok).length,v1:checks.length})}</span>}</div>
       <Button variant="secondary" loading={busy} disabled={busy} onClick={()=>void measure()}>{t('重新实测')}</Button>
      </section>
      {crossContext?.blocking && (
       <section className="verification-blocking-alert" role="alert" data-cross-context-blocking="true" aria-labelledby="cross-context-blocking-title">
        <div className="verification-blocking-head">
         <span className="verification-blocking-badge">{t('browserVerify.crossContext.blockingBadge')}</span>
         <h2 id="cross-context-blocking-title">{t('browserVerify.crossContext.blockingTitle')}</h2>
        </div>
        <p>{t('browserVerify.crossContext.blockingDesc')}</p>
        <ul>
         {crossContext.mismatches.map((mismatch, index) => (
          <li key={`${mismatch.metricId}:${mismatch.context}:${index}`}>{t(mismatch.messageKey, mismatch.values)}</li>
         ))}
        </ul>
       </section>
      )}
      <div className="landing-section-band" aria-hidden="true"/>
      {phase==='failed'&&problems.length>0&&<section className="verification-reasons" aria-labelledby="verification-reasons-title"><h2 id="verification-reasons-title">{t('未通过原因')}</h2><ul>{problems.map(problem=><li key={problem}>{t(problem)}</li>)}</ul></section>}
      {checks.length>0&&<section className="verification-results" aria-label={t('逐项检测结果')}>{checks.map(check=><article className={`verification-check ${check.ok==null?'pending':check.ok?'ok':'failed'}`} key={check.label}><header><h2>{t(check.label)}</h2><span aria-label={t(check.ok==null?'尚未核验':check.ok?'检测通过':'检测未通过')}>{check.ok==null?'—':check.ok?'✓':'×'}</span></header><strong>{t(check.actual)}</strong>{!check.ok&&<p>{t('目标：{v0}',{v0:t(check.expected)})}</p>}{check.id==='probe.webrtc'&&report?.webrtc_elapsed_ms!=null&&<p>{t('browserVerify.probeElapsed',{seconds:(report.webrtc_elapsed_ms/1000).toFixed(1)})}</p>}</article>)}</section>}
      <section className="verification-cross-context" data-cross-context-panel aria-labelledby="cross-context-title">
       <header className="verification-cross-context-head">
        <h2 id="cross-context-title">{t('browserVerify.crossContext.panelTitle')}</h2>
        <p className={crossContext?.blocking ? 'is-blocking' : undefined}>
         {!crossContext
           ? t('browserVerify.crossContext.statusPending')
           : crossContext.blocking
             ? t('browserVerify.crossContext.panelFailedSummary', { mismatches: crossContext.mismatches.length })
             : t('browserVerify.crossContext.panelSummary', { matched: crossContext.matchedContexts, unsupported: crossContext.unsupportedContexts })}
        </p>
       </header>
       <div className="verification-context-pills">
        {ALL_CONTEXT_PILLS.map(pill => {
          const pillStatus = crossContext ? crossContext.contextStates[pill.kind].status : 'pending';
          return (
           <div className="verification-context-pill" key={pill.kind} data-context-kind={pill.kind} data-context-status={pillStatus}>
            <strong>{t(pill.labelKey)}</strong>
            <span>{contextStatusLabel(pillStatus)}</span>
           </div>
          );
        })}
       </div>
       {crossContext && (
        <div className="verification-cross-matrix">
         {crossContext.metrics.map(metric => (
          <article className={`verification-cross-row${metric.status === 'mismatch' ? ' is-blocking-mismatch' : ''}`} key={metric.id} data-cross-context-metric={metric.id} data-metric-status={metric.status}>
           <div className="verification-cross-metric">
            <strong>{t(metric.labelKey)}</strong>
            <span className="verification-cross-scope">{t(metric.scopeKey)}</span>
           </div>
           <div className="verification-cross-baseline" title={metric.baseline}>{metric.baseline}</div>
           {ISOLATED_CONTEXT_KINDS.map(kind => {
             const cell = metric.cells[kind];
             const shortKind = ALL_CONTEXT_PILLS.find(p => p.kind === kind)?.labelKey ?? kind;
             return (
              <div className="verification-cross-cell" key={kind} data-cell-context={kind} data-cell-status={cell.status} title={cell.value || contextStatusLabel(cell.status)}>
               <em>{t(shortKind)}</em>
               <span>{cell.status === 'matched' || cell.status === 'mismatch' ? (cell.value || contextStatusLabel(cell.status)) : contextStatusLabel(cell.status)}</span>
              </div>
             );
           })}
          </article>
         ))}
        </div>
       )}
      </section>
      {phase==='checking'&&<div className="verification-loading" role="status">{t('正在读取浏览器与网络…')}</div>}
      {report?.exit&&(
       <section className="verification-network">
        <div><span>{t('出口 IP')}</span><strong>{report.exit.ip}</strong></div>
        <div><span>{t('国家 / 城市')}</span><strong>{report.exit.country} / {report.exit.city||'—'}</strong></div>
        <div><span>{t('browserVerify.ispAndAsn')}</span><strong>{[report.exit.asn, report.exit.isp].filter(Boolean).join(' · ') || '—'}</strong></div>
        {report.exit.hosting_source==='ipquery'&&<div><span>{t('browserVerify.classificationSource')}</span><strong>{t('browserVerify.ipquerySource')}</strong></div>}
        {ispKind !== 'unknown' && <div><span>{t('browserVerify.ipAttribute')}</span><strong>{ispKind === 'hosting' ? t('browserVerify.ispHosting') : t('browserVerify.ispResidential')}</strong></div>}
       </section>
      )}
      <footer className="verification-footer"><span className={linked?'connected':'disconnected'}>{t(linked?'已连接 Claude-Local':'主应用未连接')}</span><time>{reportedAt ? (isStale ? (t('browserSafety.staleResult', { v0: new Date(reportedAt).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US') }) || `结果已过时（>10分钟）· 测于 ${new Date(reportedAt).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US')}`) : t('结果回传成功 {v0}', { v0: new Date(reportedAt).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US') })) : t('等待检测回传')}</time></footer>
     </main>
    </div>;

}
createRoot(document.getElementById('app')!).render(<MotionRoot><TooltipProvider><Start /></TooltipProvider></MotionRoot>);
