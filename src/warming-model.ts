/**
 * [INPUT]: Bounded native warming-card views, IP region probe check results and the user's local calendar date.
 * [OUTPUT]: Browser-only warming contracts, persistent slot selection, four stages, SOP stage mapping, region lock fields and calendar-day progress.
 * [POS]: Identity warming presentation model; never contains CLI credentials or proxy values.
 * [PROTOCOL]: Update this header and src/CLAUDE.md when changing contracts.
 */
import type {IdentitySubscriptionMetadata} from './identity-model';

export const warmingStages = ['unregistered', 'kyc_passed', 'warming_free', 'pro_ready'] as const;
export type WarmingStage = typeof warmingStages[number];
export type WarmingOpenMode = 'switch_only' | 'verify' | 'claude_ai';
export type WarmingCard = IdentitySubscriptionMetadata & {
  id: string; name: string; email?: string | null; note?: string | null;
  stage: WarmingStage; created_ymd: string; last_warmed_ymd?: string | null;
  created_at: number; updated_at: number; slot: string; seed: number;
  /** Persisted browser selection; process/window runtime is sampled independently. */
  browser_active: boolean; region_summary?: string | null; has_custom_proxy?: boolean;
  subscription_expires_at?: number | null;
  registered_country?: string | null;
  registered_timezone?: string | null;
  last_probe_country?: string | null;
  last_probe_timezone?: string | null;
  last_probe_at?: number | null;
};
export type WarmingFields = {
  name: string;
  email: string | null;
  note: string | null;
  stage: WarmingStage;
  createdYmd: string;
  registeredCountry?: string | null;
  registeredTimezone?: string | null;
};
export type WarmingDraft = {
  id?: string;
  name: string;
  email: string;
  note: string;
  stage: WarmingStage;
  createdYmd: string;
  openMode: WarmingOpenMode;
  registeredCountry: string;
  registeredTimezone: string;
};
export interface WarmingProbeCheckResult {
  status: 'matched' | 'locked_initial' | 'mismatch' | 'probe_skipped';
  registered_country?: string | null;
  registered_timezone?: string | null;
  current_country?: string | null;
  current_timezone?: string | null;
  message?: string | null;
  state?: unknown;
}
export function createWarmingDraft(todayYmd = localTodayYmd()): WarmingDraft {
  return {
    name: '',
    email: '',
    note: '',
    stage: 'unregistered',
    createdYmd: todayYmd,
    openMode: 'switch_only',
    registeredCountry: '',
    registeredTimezone: '',
  };
}
export function editWarmingDraft(card: WarmingCard): WarmingDraft {
  return {
    id: card.id,
    name: card.name,
    email: card.email || '',
    note: card.note || '',
    stage: card.stage,
    createdYmd: card.created_ymd,
    openMode: 'switch_only',
    registeredCountry: card.registered_country || '',
    registeredTimezone: card.registered_timezone || '',
  };
}
export function warmingStageSopKey(stage: WarmingStage, days: number): string {
  switch (stage) {
    case 'unregistered':
      return 'identities.warming.sop.unregistered';
    case 'kyc_passed':
      return days <= 3 ? 'identities.warming.sop.kycEarly' : 'identities.warming.sop.kycPassed';
    case 'warming_free':
      return days <= 3 ? 'identities.warming.sop.kycEarly' : 'identities.warming.sop.warmingFree';
    case 'pro_ready':
      return 'identities.warming.sop.proReady';
  }
}
export function localTodayYmd(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function warmingDays(createdYmd: string, todayYmd: string): number {
  // UTC calendar arithmetic avoids DST and time-zone offset shifts between local dates.
  const start = Date.parse(`${createdYmd}T12:00:00Z`), today = Date.parse(`${todayYmd}T12:00:00Z`);
  return Number.isFinite(start) && Number.isFinite(today) ? Math.max(1, Math.floor((today - start) / 86400000) + 1) : 1;
}
