/**
 * [INPUT]: 浏览器执行上下文原生 API（Window、DedicatedWorker、SharedWorker、ServiceWorker、同源/沙盒 Iframe）的只读环境属性与原型链。
 * [OUTPUT]: 自包含、零 import/export 的经典同源探测脚本（供 `?worker&url` 打包），采集 6 类上下文的硬件/语言/UA-CH/Intl/Screen/OffscreenCanvas WebGL 快照及 `Function.prototype.toString` / `Error.stack` 防篡改完整性。
 * [POS]: R5 域 2 伴生浏览器跨上下文一致性检测的隔离探针载荷；不依赖 DOM 外部模块、不发起网络请求、不持有用户凭据。
 * [PROTOCOL]: 变更时更新此头部，然后检查 `src/CLAUDE.md`
 */
(() => {
  type ProbeContextKind =
    | 'window'
    | 'worker'
    | 'shared-worker'
    | 'service-worker'
    | 'same-origin-iframe'
    | 'sandbox-iframe';

  interface ProbeBrand {
    brand: string;
    version: string;
  }

  interface ProbeUserAgentData {
    mobile: boolean;
    platform: string;
    brands: ProbeBrand[];
    highEntropy: {
      platformVersion: string;
      uaFullVersion: string;
      architecture: string;
      bitness: string;
      model: string;
    } | null;
  }

  interface ProbeSnapshot {
    kind: ProbeContextKind;
    isSecureContext: boolean;
    platform: string;
    language: string;
    languages: string[];
    hardwareConcurrency: number | null;
    deviceMemory: number | null;
    userAgentData: ProbeUserAgentData | null;
    intl: {
      timeZone: string;
      locale: string;
      timezoneOffsetMin: number;
    };
    screen: {
      available: boolean;
      width: number | null;
      height: number | null;
      orientationType: string | null;
      orientationAngle: number | null;
    };
    offscreenWebgl: {
      supported: boolean;
      vendor: string;
      renderer: string;
      debugExtension: boolean;
    };
    nativeIntegrity: {
      ok: boolean;
      toStringOk: boolean;
      ownPropTampered: boolean;
      stackTampered: boolean;
      details: string[];
    };
  }

  type NavigatorLike = {
    platform?: unknown;
    language?: unknown;
    languages?: unknown;
    hardwareConcurrency?: unknown;
    deviceMemory?: unknown;
    userAgentData?: {
      mobile?: unknown;
      platform?: unknown;
      brands?: Array<{ brand?: unknown; version?: unknown }>;
      getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>;
    };
  };

  function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
    return new Promise(resolve => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      }, ms);
      promise.then(
        val => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(val);
          }
        },
        () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(null);
          }
        },
      );
    });
  }

  function extractTopScriptOrigin(stack: string): string | null {
    const match = stack.match(/https?:\/\/[^/\s):]+(?::\d+)?/);
    return match ? match[0] : null;
  }

  function invokeIllegalReceiverProbe(
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

  function collectNativeIntegrity(): ProbeSnapshot['nativeIntegrity'] {
    const details: string[] = [];
    let toStringOk = true;
    let ownPropTampered = false;
    let stackTampered = false;

    const fnToString = Function.prototype.toString;
    const checkNativeFn = (label: string, fn: unknown) => {
      if (typeof fn !== 'function') return;
      try {
        const text = fnToString.call(fn);
        if (!/\[native code\]/.test(text)) {
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

    checkNativeFn('Function.prototype.toString', fnToString);
    checkNativeFn('Intl.DateTimeFormat', Intl?.DateTimeFormat);
    checkNativeFn('Intl.DateTimeFormat.prototype.resolvedOptions', Intl?.DateTimeFormat?.prototype?.resolvedOptions);
    const g = globalThis as Record<string, unknown>;
    const OffscreenCtor = g.OffscreenCanvas as { prototype?: { convertToBlob?: unknown } } | undefined;
    if (OffscreenCtor?.prototype?.convertToBlob) {
      checkNativeFn('OffscreenCanvas.prototype.convertToBlob', OffscreenCtor.prototype.convertToBlob);
    }

    const navProto =
      (g.Navigator as { prototype?: Record<string, unknown> } | undefined)?.prototype ||
      (g.WorkerNavigator as { prototype?: Record<string, unknown> } | undefined)?.prototype;
    if (navProto) {
      for (const prop of ['platform', 'languages', 'language', 'hardwareConcurrency', 'deviceMemory', 'userAgent', 'webdriver']) {
        const desc = Object.getOwnPropertyDescriptor(navProto, prop);
        if (desc?.get) {
          checkNativeFn(`Navigator.prototype.${prop}`, desc.get);
        }
      }
    }

    if (typeof window !== 'undefined') {
      const htmlCanvasProto = (g.HTMLCanvasElement as { prototype?: Record<string, unknown> } | undefined)?.prototype;
      const ctx2dProto = (g.CanvasRenderingContext2D as { prototype?: Record<string, unknown> } | undefined)?.prototype;
      const webglProto = (g.WebGLRenderingContext as { prototype?: Record<string, unknown> } | undefined)?.prototype;
      const webgl2Proto = (g.WebGL2RenderingContext as { prototype?: Record<string, unknown> } | undefined)?.prototype;
      checkNativeFn('HTMLCanvasElement.prototype.toDataURL', htmlCanvasProto?.toDataURL);
      checkNativeFn('CanvasRenderingContext2D.prototype.getImageData', ctx2dProto?.getImageData);
      checkNativeFn('WebGLRenderingContext.prototype.getParameter', webglProto?.getParameter);
      checkNativeFn('WebGL2RenderingContext.prototype.getParameter', webgl2Proto?.getParameter);
    }

    if (typeof navigator !== 'undefined') {
      for (const key of ['platform', 'language', 'languages', 'hardwareConcurrency', 'deviceMemory', 'userAgent', 'userAgentData', 'webdriver']) {
        if (Object.getOwnPropertyDescriptor(navigator, key) !== undefined) {
          ownPropTampered = true;
          details.push(`navigator.own_${key}`);
        }
      }
    }
    if (typeof window !== 'undefined' && typeof screen !== 'undefined') {
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
    const expectedOrigin = typeof baselineStack === 'string' ? extractTopScriptOrigin(baselineStack) : null;

    const toStringIllegal = invokeIllegalReceiverProbe(
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
          const reason = invokeIllegalReceiverProbe(
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

    if (typeof window !== 'undefined') {
      const glProto = (g.WebGLRenderingContext as { prototype?: { getParameter?: (pname: number) => unknown } } | undefined)?.prototype;
      if (typeof glProto?.getParameter === 'function') {
        const reason = invokeIllegalReceiverProbe(
          glProto.getParameter as (this: unknown, ...args: unknown[]) => unknown,
          [0x1f00],
          false,
          expectedOrigin,
        );
        if (reason) {
          stackTampered = true;
          details.push(`webgl_getParameter:${reason}`);
        }
      }
      const canvasProto = (g.HTMLCanvasElement as { prototype?: { toDataURL?: () => unknown } } | undefined)?.prototype;
      if (typeof canvasProto?.toDataURL === 'function') {
        const reason = invokeIllegalReceiverProbe(
          canvasProto.toDataURL as (this: unknown, ...args: unknown[]) => unknown,
          [],
          false,
          expectedOrigin,
        );
        if (reason) {
          stackTampered = true;
          details.push(`canvas_toDataURL:${reason}`);
        }
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

  function collectOffscreenWebgl(): ProbeSnapshot['offscreenWebgl'] {
    try {
      const g = globalThis as { OffscreenCanvas?: new (w: number, h: number) => { getContext: (id: string) => unknown } };
      if (typeof g.OffscreenCanvas === 'undefined') {
        return { supported: false, vendor: '', renderer: '', debugExtension: false };
      }
      const oc = new g.OffscreenCanvas(16, 16);
      const gl = (oc.getContext('webgl2') || oc.getContext('webgl')) as {
        VENDOR: number;
        RENDERER: number;
        getExtension: (name: string) => { UNMASKED_VENDOR_WEBGL: number; UNMASKED_RENDERER_WEBGL: number } | null;
        getParameter: (pname: number) => unknown;
      } | null;
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

  async function collectContextSnapshot(kind: ProbeContextKind): Promise<ProbeSnapshot> {
    const g = globalThis as { isSecureContext?: boolean; navigator?: NavigatorLike };
    const nav: NavigatorLike = g.navigator || {};
    const langs = Array.isArray(nav.languages) ? nav.languages.map(item => String(item)) : [];
    const hc = typeof nav.hardwareConcurrency === 'number' && Number.isFinite(nav.hardwareConcurrency)
      ? nav.hardwareConcurrency
      : null;
    const dm = typeof nav.deviceMemory === 'number' && Number.isFinite(nav.deviceMemory)
      ? nav.deviceMemory
      : null;

    let userAgentData: ProbeUserAgentData | null = null;
    if (nav.userAgentData) {
      const uad = nav.userAgentData;
      const brands = Array.isArray(uad.brands)
        ? uad.brands.map(b => ({ brand: String(b?.brand || ''), version: String(b?.version || '') }))
        : [];
      let highEntropy: ProbeUserAgentData['highEntropy'] = null;
      if (typeof uad.getHighEntropyValues === 'function') {
        const high = await raceTimeout(
          uad.getHighEntropyValues(['platformVersion', 'uaFullVersion', 'architecture', 'bitness', 'model']),
          800,
        );
        if (high && typeof high === 'object') {
          highEntropy = {
            platformVersion: String(high.platformVersion || ''),
            uaFullVersion: String(high.uaFullVersion || ''),
            architecture: String(high.architecture || ''),
            bitness: String(high.bitness || ''),
            model: String(high.model || ''),
          };
        }
      }
      userAgentData = {
        mobile: Boolean(uad.mobile),
        platform: String(uad.platform || ''),
        brands,
        highEntropy,
      };
    }

    const dtf = new Intl.DateTimeFormat().resolvedOptions();
    const screenData: ProbeSnapshot['screen'] =
      typeof screen !== 'undefined'
        ? {
            available: true,
            width: typeof screen.width === 'number' ? screen.width : null,
            height: typeof screen.height === 'number' ? screen.height : null,
            orientationType: typeof screen.orientation?.type === 'string' ? screen.orientation.type : null,
            orientationAngle: typeof screen.orientation?.angle === 'number' && Number.isFinite(screen.orientation.angle)
              ? screen.orientation.angle
              : null,
          }
        : {
            available: false,
            width: null,
            height: null,
            orientationType: null,
            orientationAngle: null,
          };

    return {
      kind,
      isSecureContext: Boolean(g.isSecureContext),
      platform: String(nav.platform || ''),
      language: String(nav.language || ''),
      languages: langs,
      hardwareConcurrency: hc,
      deviceMemory: dm,
      userAgentData,
      intl: {
        timeZone: String(dtf.timeZone || ''),
        locale: String(dtf.locale || ''),
        timezoneOffsetMin: -new Date().getTimezoneOffset(),
      },
      screen: screenData,
      offscreenWebgl: collectOffscreenWebgl(),
      nativeIntegrity: collectNativeIntegrity(),
    };
  }

  const g = globalThis as Record<string, unknown>;
  if (typeof window !== 'undefined' && window.parent !== window) {
    const kind: ProbeContextKind =
      window.name === 'cl-ctx-sandbox' || window.location.origin === 'null'
        ? 'sandbox-iframe'
        : 'same-origin-iframe';
    void collectContextSnapshot(kind).then(snapshot => {
      window.parent.postMessage({ source: 'cl-ctx-probe', snapshot }, '*');
    });
  } else if (typeof g.SharedWorkerGlobalScope === 'function' && self instanceof (g.SharedWorkerGlobalScope as new () => unknown)) {
    (self as unknown as { onconnect: (ev: { ports: MessagePort[] }) => void }).onconnect = ev => {
      const port = ev.ports[0];
      if (!port) return;
      port.onmessage = () => {
        void collectContextSnapshot('shared-worker').then(snapshot => port.postMessage(snapshot));
      };
      port.start();
    };
  } else if (typeof g.ServiceWorkerGlobalScope === 'function' && self instanceof (g.ServiceWorkerGlobalScope as new () => unknown)) {
    self.addEventListener('message', (ev: Event) => {
      const msgEv = ev as MessageEvent & { waitUntil?: (p: Promise<unknown>) => void };
      const replyPort = msgEv.ports?.[0];
      if (!replyPort) return;
      const task = collectContextSnapshot('service-worker').then(snapshot => replyPort.postMessage(snapshot));
      if (typeof msgEv.waitUntil === 'function') {
        msgEv.waitUntil(task);
      }
    });
  } else if (typeof window === 'undefined' && typeof (self as unknown as { postMessage?: unknown }).postMessage === 'function') {
    self.addEventListener('message', () => {
      void collectContextSnapshot('worker').then(snapshot => {
        (self as unknown as { postMessage: (msg: unknown) => void }).postMessage(snapshot);
      });
    });
  }
})();
