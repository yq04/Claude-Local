/**
 * [INPUT]: Sanitized usage attribution snapshot data, account catalogs and privacy preferences.
 * [OUTPUT]: Masked account labels, scope previews, confirm states, and IANA timezone/DST context badges.
 * [POS]: Pure attribution and timezone presentation model; no raw credentials, tokens or database access.
 * [PROTOCOL]: Keep presentation logic pure and testable.
 */
import type {UsageAttributionConfig} from './usage-model';
import {maskDisplayName, maskEmailAddress} from './settings-model';

export type AttributionScopePreview = {
  targetId: string;
  targetName: string;
  requests: number;
  tokens: number;
  isCurrent: boolean;
};

export function maskAccountLabel(
  account: {id: string; name: string; email?: string | null},
  privacyMask: boolean
): string {
  const name = maskDisplayName(account.name, account.email, privacyMask);
  if (!privacyMask || !account.email) return name;
  const maskedEmail = maskEmailAddress(account.email, true);
  if (name === maskedEmail || account.name.toLowerCase() === account.email.toLowerCase()) {
    return name;
  }
  return name + ' (' + maskedEmail + ')';
}

export function previewAttributionScope(
  config: UsageAttributionConfig | undefined | null,
  targetId: string,
  accounts: {id: string; name: string}[]
): AttributionScopePreview | null {
  if (!config || !targetId) return null;
  const target = accounts.find(a => a.id === targetId);
  if (!target) return null;
  return {
    targetId,
    targetName: target.name,
    requests: config.unassigned_requests,
    tokens: config.unassigned_tokens,
    isCurrent: config.fallback_account_id === targetId,
  };
}

export function getDstDayType(
  days: {day: string; start_at?: number; end_at?: number}[]
): '23h' | '25h' | null {
  const hourly = days.filter(d => d.start_at != null && d.end_at != null);
  if (hourly.length === 23) return '23h';
  if (hourly.length === 25) return '25h';
  return null;
}

export function formatTimezoneContext(ianaZone?: string, now = new Date()): string {
  if (!ianaZone) {
    const offsetMin = -now.getTimezoneOffset();
    const sign = offsetMin >= 0 ? '+' : '-';
    const hours = String(Math.floor(Math.abs(offsetMin) / 60)).padStart(2, '0');
    const mins = String(Math.floor(Math.abs(offsetMin) % 60)).padStart(2, '0');
    return 'UTC' + sign + hours + ':' + mins;
  }
  try {
    const shortName = new Intl.DateTimeFormat('en-US', {
      timeZone: ianaZone,
      timeZoneName: 'short',
    })
      .formatToParts(now)
      .find(p => p.type === 'timeZoneName')?.value;
    if (shortName && !ianaZone.includes(shortName)) {
      return ianaZone + ' (' + shortName + ')';
    }
    return ianaZone;
  } catch {
    return ianaZone;
  }
}
