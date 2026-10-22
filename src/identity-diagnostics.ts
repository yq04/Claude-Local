/**
 * [INPUT]: Bounded app version, observed timestamps and collector setup flags.
 * [OUTPUT]: JSON-safe diagnostic object containing literal allowlisted fields only.
 * [POS]: Identity diagnostics copy model; never accepts identity metadata or raw collector content.
 * [PROTOCOL]: Keep the serialized schema explicit and privacy-safe.
 */
import {quotaObservationAge} from './identity-list'

export type DiagnosticWindow = {source: string | null | undefined; observedAtMs?: number | null}
export type DiagnosticInput = {
  version: string | null
  generatedAtMs: number
  windows: { '5h': DiagnosticWindow; '7d': DiagnosticWindow }
  setup: {state: string | null; collectorBundled: boolean | null; hasStatusline: boolean | null} | null
}

const SOURCES = new Set(['server_anchor', 'local_estimate', 'reset_inferred', 'unknown'])
const SETUP = new Set(['not_configured', 'custom_statusline', 'invalid_settings_path', 'invalid_settings_json', 'invalid_statusline'])
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

export function buildIdentityDiagnostic(input: DiagnosticInput, nowMs = input.generatedAtMs) {
  const safeSource = (value: string | null | undefined) => value && SOURCES.has(value) ? value : 'unknown'
  const window = (value: DiagnosticWindow) => {
    const source = safeSource(value.source)
    const ageMinutes = quotaObservationAge(value.observedAtMs, nowMs)
    return {source, observedAtMs: ageMinutes == null ? null : value.observedAtMs!, ageMinutes}
  }
  const setup = input.setup && SETUP.has(input.setup.state || '') ? {
    state: input.setup.state,
    collectorBundled: input.setup.collectorBundled === true,
    hasStatusline: input.setup.hasStatusline === true,
    runtime: 'unverified' as const,
  } : null
  return {
    version: typeof input.version === 'string' && input.version.length <= 48 && SEMVER.test(input.version) ? input.version : null,
    generatedAtMs: Number.isFinite(input.generatedAtMs) ? input.generatedAtMs : null,
    windows: {'5h': window(input.windows['5h']), '7d': window(input.windows['7d'])},
    setup,
  }
}

export function serializeIdentityDiagnostic(input: DiagnosticInput, nowMs = input.generatedAtMs) {
  return JSON.stringify(buildIdentityDiagnostic(input, nowMs), null, 2)
}
