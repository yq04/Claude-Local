/**
 * [INPUT]: SCOPE.md 与 TEST_INFRA.md 定义的 E2E 特性清单、4-Tier 用例结构与沙盒隔离契约。
 * [OUTPUT]: 导出 ALL_FEATURE_IDS, FeatureId, ALL_TIERS, Tier, RunMode, CaseStatus, E2ECaseOutcome, E2ECase, E2EContext, SuiteModule, SandboxPaths, SandboxEnvOptions, HostSafetyAuditResult, SandboxSpawnOptions, SandboxSpawnResult, SandboxHandle, CaseExecutionRecord, CoverageValidationResult, E2ERunReport。
 * [POS]: scripts/e2e/ 唯一共享类型契约源，解耦 runner、harness 与各 suites 套件，无运行时外部依赖。
 * [PROTOCOL]: 变更时更新此头部，然后检查 scripts/e2e/CLAUDE.md
 */

export const ALL_FEATURE_IDS = [
  'E2E-01',
  'E2E-02',
  'E2E-03',
  'E2E-04',
  'E2E-05',
  'E2E-06',
  'E2E-07',
  'E2E-08',
  'E2E-09',
  'E2E-10',
  'E2E-11',
  'E2E-12',
] as const;

export type FeatureId = (typeof ALL_FEATURE_IDS)[number];

export const ALL_TIERS = [1, 2, 3, 4] as const;
export type Tier = (typeof ALL_TIERS)[number];

export type RunMode = 'baseline' | 'target';
export type CaseStatus = 'pass' | 'fail' | 'baseline_gap';

export interface E2ECaseOutcome {
  status: CaseStatus;
  summary: string;
  metrics?: Record<string, number | string | boolean>;
}

export interface SandboxPaths {
  root: string;
  homeDir: string;
  appDataDir: string;
  localAppDataDir: string;
  xdgConfigDir: string;
  xdgCacheDir: string;
  tempDir: string;
  profilesDir: string;
}

export interface SandboxEnvOptions {
  extraEnv?: Record<string, string>;
  proxyUrl?: string;
  allowDirect?: boolean;
  skipProxyPreflight?: boolean;
  claudeConfigDir?: string;
  keepSystemProxy?: false;
}

export interface HostSafetyAuditResult {
  ok: boolean;
  checkedAt: string;
  violations: string[];
  checkedSentinels: number;
  escapedLinks: string[];
  lingeringPids: number[];
}

export interface SandboxSpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
  timeoutMs?: number;
  allowNonZero?: boolean;
}

export interface SandboxSpawnResult {
  pid: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface SandboxHandle {
  readonly label: string;
  readonly paths: SandboxPaths;
  readonly trackedPids: ReadonlySet<number>;
  buildEnv(options?: SandboxEnvOptions): Record<string, string>;
  profileDir(name: string): string;
  trackPid(pid: number | undefined | null): void;
  registerCleanup(fn: () => Promise<void> | void): void;
  spawn(command: string, args: string[], options?: SandboxSpawnOptions): Promise<SandboxSpawnResult>;
  assertNoSymlinkEscape(dir?: string): Promise<string[]>;
  assertHostUntouched(): Promise<HostSafetyAuditResult>;
  cleanup(): Promise<void>;
}

export interface E2ECase {
  id: string;
  tier: Tier;
  features: FeatureId[];
  title: string;
  targetModeOnly?: boolean;
  run(ctx: E2EContext): Promise<E2ECaseOutcome>;
}

export interface E2EContext {
  mode: RunMode;
  repoRoot: string;
  reportDir: string;
  createSandbox(label: string): Promise<SandboxHandle>;
}

export interface SuiteModule {
  cases: E2ECase[];
}

export interface CaseExecutionRecord {
  id: string;
  tier: Tier;
  features: FeatureId[];
  title: string;
  suiteFile: string;
  status: CaseStatus;
  summary: string;
  metrics?: Record<string, number | string | boolean>;
  durationMs: number;
  error?: string;
  hostAudit: HostSafetyAuditResult;
}

export interface CoverageValidationResult {
  ok: boolean;
  errors: string[];
  byTier: Record<Tier, number>;
  byFeatureTier1: Record<FeatureId, number>;
  byFeatureTier2: Record<FeatureId, number>;
  tier3CoveredFeatures: FeatureId[];
  totalCases: number;
}

export interface E2ERunReport {
  schema: 1;
  runId: string;
  mode: RunMode;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  filters: {
    tiers: Tier[];
    features: FeatureId[] | null;
    selfCheck: boolean;
  };
  counts: {
    total: number;
    pass: number;
    fail: number;
    baseline_gap: number;
  };
  coverage: CoverageValidationResult | null;
  hostSafety: HostSafetyAuditResult;
  results: CaseExecutionRecord[];
}
