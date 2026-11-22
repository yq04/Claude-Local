/**
 * [INPUT]: Controlled state and action callbacks for return-to-CLI browser, snapshot, switch/promote/recover review, deletion, browser review, rename, and subscription expiry/plan calibration dialogs.
 * [OUTPUT]: `IdentityActionDialogs` rendering all seven action modals for `IdentityPanel` with zero internal ownership of mutations.
 * [POS]: Submodule of `src/identities.tsx`; preserves exact `data-*` selectors, AlertDialog focus/cancel contracts, and `fallbackFocusRef={quotaOpenerRef}` on the expiry editor.
 * [PROTOCOL]: Update this header and `src/CLAUDE.md` when adding or modifying identity action dialogs.
 */
import type {Dispatch, RefObject, SetStateAction} from 'react';
import {Button, Checkbox, Input} from 'cromma-ui';
import {AppDialog} from '../dialog';
import type {Identity, IdentityPolicy, IdentityState, IdentitySummary} from '../identity-model';
import {addOneCalendarMonthYmd, epochSecToCalendarYmd, formatYmdAsShortMd} from '../identity-online-quota';
import type {evaluateQuota} from '../identity-quota';
import {maskDisplayName, maskEmailAddress} from '../settings-model';
import {CANONICAL_MANUAL_PLANS, normalizePlanSlug} from '../smart-relay-model';
import type {WarmingCard} from '../warming-model';
import type {ExpiryEditorState, Target, TranslateFn} from './IdentityCardPrimitives';

type EvaluatedQuota = ReturnType<typeof evaluateQuota>;

export interface IdentityActionDialogsProps {
  state: IdentityState | null;
  active: Identity | undefined;
  current: IdentityState['current'] | undefined;
  currentQuota: EvaluatedQuota;
  targetSummary: IdentitySummary | undefined;
  targetQuota: EvaluatedQuota;
  targetSlotBusy: boolean;
  recoveryRecord: Identity | undefined;
  policy: IdentityPolicy;
  kept: string[];
  removed: string[];
  proxyChanged: boolean;
  hasBackgroundDaemonOnly: boolean;
  hasInteractiveChildShells: boolean;
  interactiveChildShells: string[];
  hasLiveClaudeProcess: boolean;
  activeAdoptJobs: string[];
  resumeShellCmd: string;
  copiedBgResume: boolean;
  recentLaunchDirs: string[];
  launchRelayBusy: boolean;
  syncCliBrowserOnSwitch: boolean;
  onSyncCliBrowserOnSwitchChange: (checked: boolean) => void;
  quotaOpenerRef: RefObject<HTMLElement | null>;
  busy: boolean;
  loading: boolean;
  error: string;
  privacyMask: boolean;
  returnCliBrowser: {expectedIdentity: string; name: string} | null;
  onReturnCliBrowserClose: () => void;
  onReturnToCliBrowser: (openMode?: 'verify' | 'claude_ai') => Promise<void>;
  snapshot: boolean;
  onSnapshotClose: () => void;
  onSaveSnapshot: () => Promise<void>;
  name: string;
  onNameChange: (value: string) => void;
  review: Target | null;
  warmingPromotion: WarmingCard | null;
  onReviewClose: () => void;
  onChangeIdentity: () => Promise<void>;
  deletion: Identity | 'current' | null;
  accepted: boolean;
  onAcceptedChange: (checked: boolean) => void;
  deleteBrowser: boolean;
  onDeleteBrowserChange: (checked: boolean) => void;
  onDeletionClose: () => void;
  onRemoveIdentity: () => Promise<void>;
  browserReview: boolean | null;
  useExisting: boolean;
  onUseExistingChange: (checked: boolean) => void;
  onBrowserReviewClose: () => void;
  onConfigureBrowser: () => Promise<void>;
  rename: Identity | null;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onRenameClose: () => void;
  onSaveName: () => Promise<void>;
  expiryEditor: ExpiryEditorState | null;
  setExpiryEditor: Dispatch<SetStateAction<ExpiryEditorState | null>>;
  onSaveSubscriptionExpiry: (clear?: boolean) => Promise<void>;
  onCopyBgResumeCommand: (cmd: string) => Promise<void>;
  onLaunchRelayTerminal: (explicitCwd?: string) => Promise<void>;
  t: TranslateFn;
}

function LiveCliContinuityCallouts({
  hasBackgroundDaemonOnly,
  hasInteractiveChildShells,
  interactiveChildShells,
  hasLiveClaudeProcess,
  resumeShellCmd,
  copiedBgResume,
  launchRelayBusy,
  busy,
  copyMode,
  onCopyBgResumeCommand,
  onLaunchRelay,
  t,
}: {
  hasBackgroundDaemonOnly: boolean;
  hasInteractiveChildShells: boolean;
  interactiveChildShells: string[];
  hasLiveClaudeProcess: boolean;
  resumeShellCmd: string;
  copiedBgResume: boolean;
  launchRelayBusy: boolean;
  busy: boolean;
  copyMode: 'snapshot' | 'switch';
  onCopyBgResumeCommand: (cmd: string) => Promise<void>;
  onLaunchRelay: () => void;
  t: TranslateFn;
}) {
  if (hasBackgroundDaemonOnly) {
    return (
      <div className="identity-live-relay-callout" role="status" data-bg-daemon-continuity>
        <div className="identity-live-relay-copy">
          <strong>{t('identities.bgDaemonContinuityTitle')}</strong>
          <span>{t('identities.bgDaemonContinuityDesc', {cmd: resumeShellCmd})}</span>
        </div>
        <Button
          variant="secondary"
          size="small"
          data-snapshot-copy-resume-cmd={copyMode === 'snapshot' ? '' : undefined}
          data-switch-copy-resume-cmd={copyMode === 'switch' ? '' : undefined}
          disabled={busy}
          onClick={() => void onCopyBgResumeCommand(resumeShellCmd)}
        >
          {copiedBgResume
            ? t('identities.copiedResumeCmd', {cmd: resumeShellCmd})
            : t('identities.copyResumeCmdBtn', {cmd: resumeShellCmd})}
        </Button>
      </div>
    );
  }
  return (
    <>
      {hasInteractiveChildShells && (
        <div
          className="identity-unsaved-pool-hint"
          role="alert"
          data-child-shells-warn={interactiveChildShells.join(',')}
        >
          <div style={{display: 'grid', gap: '2px', flex: '1 1 240px', minWidth: 0}}>
            <strong>{t('identities.childShellsWarnTitle', {shells: interactiveChildShells.join(', ')})}</strong>
            <span>{t('identities.childShellsWarnDesc')}</span>
          </div>
        </div>
      )}
      {hasLiveClaudeProcess && (
        <div className="identity-live-relay-callout" role="note" data-live-cli-safe-relay>
          <div className="identity-live-relay-copy">
            <strong>{t('identities.liveCliSafeRelayTitle')}</strong>
            <span>{t('identities.liveCliSafeRelayDesc')}</span>
          </div>
          <Button
            variant="secondary"
            size="small"
            data-switch-launch-relay
            loading={launchRelayBusy}
            disabled={launchRelayBusy || busy}
            onClick={onLaunchRelay}
          >
            {t('identities.liveCliSafeRelayBtn')}
          </Button>
        </div>
      )}
    </>
  );
}

export function IdentityActionDialogs({
  state,
  active,
  current,
  currentQuota,
  targetSummary,
  targetQuota,
  targetSlotBusy,
  recoveryRecord,
  policy,
  kept,
  removed,
  proxyChanged,
  hasBackgroundDaemonOnly,
  hasInteractiveChildShells,
  interactiveChildShells,
  hasLiveClaudeProcess,
  activeAdoptJobs,
  resumeShellCmd,
  copiedBgResume,
  recentLaunchDirs,
  launchRelayBusy,
  syncCliBrowserOnSwitch,
  onSyncCliBrowserOnSwitchChange,
  quotaOpenerRef,
  busy,
  loading,
  error,
  privacyMask,
  returnCliBrowser,
  onReturnCliBrowserClose,
  onReturnToCliBrowser,
  snapshot,
  onSnapshotClose,
  onSaveSnapshot,
  name,
  onNameChange,
  review,
  warmingPromotion,
  onReviewClose,
  onChangeIdentity,
  deletion,
  accepted,
  onAcceptedChange,
  deleteBrowser,
  onDeleteBrowserChange,
  onDeletionClose,
  onRemoveIdentity,
  browserReview,
  useExisting,
  onUseExistingChange,
  onBrowserReviewClose,
  onConfigureBrowser,
  rename,
  renameValue,
  onRenameValueChange,
  onRenameClose,
  onSaveName,
  expiryEditor,
  setExpiryEditor,
  onSaveSubscriptionExpiry,
  onCopyBgResumeCommand,
  onLaunchRelayTerminal,
  t,
}: IdentityActionDialogsProps) {
  return (
    <>
      <AppDialog
        alert
        open={!!returnCliBrowser}
        onOpenChange={open => {
          if (!open && !busy) onReturnCliBrowserClose();
        }}
        title={t('browser.returnToCliConfirmTitle')}
        description={t('browser.returnToCliConfirm')}
        footer={
          <>
            <Button variant="secondary" data-dialog-cancel disabled={busy} onClick={onReturnCliBrowserClose}>
              {t('取消')}
            </Button>
            <Button
              variant="secondary"
              data-return-cli-claude
              disabled={busy || !returnCliBrowser}
              onClick={() => void onReturnToCliBrowser('claude_ai')}
            >
              {t('browser.enterClaudeAi')}
            </Button>
            <Button
              variant="secondary"
              data-return-cli-confirm
              disabled={busy || !returnCliBrowser}
              onClick={() => void onReturnToCliBrowser('verify')}
            >
              {t('browser.returnToCli')}
            </Button>
          </>
        }
      >
        <div data-return-cli-dialog className="identity-confirm">
          <strong>{returnCliBrowser?.name}</strong>
          <p>{t('browser.verificationScope')}</p>
        </div>
      </AppDialog>

      <AppDialog
        open={snapshot}
        onOpenChange={open => {
          if (!open && !busy) onSnapshotClose();
        }}
        title={t(active ? '更新备份' : '保存备份')}
        description={t('将当前 Claude Code 与 Desktop 登录状态加密保存到身份保险库，不清空当前工作区，也不关闭关联浏览器。')}
        footer={
          <>
            <Button variant="secondary" onClick={onSnapshotClose}>
              {t('取消')}
            </Button>
            <Button
              variant="secondary"
              disabled={busy || loading || !state || !name.trim() || !!state.recovery || !state.current.present}
              onClick={() => void onSaveSnapshot()}
            >
              {t('确认保存备份')}
            </Button>
          </>
        }
      >
        <div className="identity-confirm">
          <label htmlFor="identity-snapshot-name">{t('当前身份保存为')}</label>
          <Input id="identity-snapshot-name" maxLength={64} value={name} onChange={e => onNameChange(e.target.value)} />
          {current?.email && (
            <div className="identity-confirm-target">
              <span>{t('当前身份')}</span>
              <strong>
                {maskEmailAddress(current.email, privacyMask)}
                {current.plan ? ` (${current.plan})` : ''}
              </strong>
            </div>
          )}
          {currentQuota && (
            <div className="identity-confirm-target">
              <span>{t('当前剩余额度')}</span>
              <code>{currentQuota.detail}</code>
            </div>
          )}
          {current?.proxy && (
            <div className="identity-confirm-target">
              <span>{t('当前专属代理')}</span>
              <code>{current.proxy}</code>
            </div>
          )}
          <LiveCliContinuityCallouts
            hasBackgroundDaemonOnly={hasBackgroundDaemonOnly}
            hasInteractiveChildShells={hasInteractiveChildShells}
            interactiveChildShells={interactiveChildShells}
            hasLiveClaudeProcess={hasLiveClaudeProcess}
            resumeShellCmd={resumeShellCmd}
            copiedBgResume={copiedBgResume}
            launchRelayBusy={launchRelayBusy}
            busy={busy}
            copyMode="snapshot"
            onCopyBgResumeCommand={onCopyBgResumeCommand}
            onLaunchRelay={() => {
              onSnapshotClose();
              void onLaunchRelayTerminal(recentLaunchDirs[0] || '');
            }}
            t={t}
          />
          {(state?.sessions?.length ?? 0) > 0 && (
            <div className="identity-confirm-sessions">
              <span>{t(hasBackgroundDaemonOnly ? 'identities.bgDaemonSessionsLabel' : '活跃 Claude 会话（保存时将自动结束）')}</span>
              <ul>
                {state!.sessions.map(s => (
                  <li key={s.pid}>
                    <code>PID {s.pid}</code>
                    <span>{s.entrypoint}{s.background ? ` · ${t('identities.sessionBackgroundTag')}` : ''}</span>
                    {s.workspace && <strong>{s.workspace}</strong>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </AppDialog>

      <AppDialog
        open={!!review}
        onOpenChange={open => {
          if (!open && !busy) onReviewClose();
        }}
        title={warmingPromotion ? t('warming.promote') : review === 'recovery' ? t('恢复原身份') : review === 'empty' ? t('切换到空身份') : t('切换身份')}
        description={t(
          review === 'recovery'
            ? 'identitySafety.recoveryHint'
            : !warmingPromotion && hasBackgroundDaemonOnly
              ? 'identities.switchBgDaemonDesc'
              : (state?.running || (state?.sessions?.length ?? 0) > 0)
                ? '先压缩暂存当前 Claude Code 与 Desktop 状态，再切换。将结束已识别的 Claude 进程，未保存任务会中断。'
                : 'identitySafety.switchIdleHint',
        )}
        footer={
          <>
            <Button variant="secondary" onClick={onReviewClose}>
              {t('取消')}
            </Button>
            <Button
              variant="secondary"
              disabled={busy || loading || !state || !name.trim() || targetSlotBusy || (review !== 'recovery' && !!state.recovery)}
              onClick={() => void onChangeIdentity()}
            >
              {review === 'recovery'
                ? t('确认恢复')
                : !warmingPromotion && hasBackgroundDaemonOnly
                  ? t('identities.confirmParkDaemonAndSwitch')
                  : t('确认暂存并切换')}
            </Button>
          </>
        }
      >
        <div className="identity-confirm">
          {targetSlotBusy && (
            <p role="alert" className="cleanup-feedback error">
              {t('relay.error.targetSlotBusy')}
            </p>
          )}
          {warmingPromotion && (
            <div className="identity-confirm-target warming-promote-target">
              <span>{t('warming.promoteHint')}</span>
              <strong>{maskDisplayName(warmingPromotion.name, warmingPromotion.email, privacyMask)}</strong>
              <p>{t('warming.promotionContinuity')}</p>
            </div>
          )}
          {current?.present !== false || review === 'recovery' ? (
            <>
              <label htmlFor="identity-current-name">{t('当前身份保存为')}</label>
              <Input id="identity-current-name" maxLength={64} value={name} onChange={e => onNameChange(e.target.value)} />
            </>
          ) : (
            <div className="identity-confirm-target">
              <span>{t('当前工作区')}</span>
              <strong>{t('待登录')}</strong>
            </div>
          )}
          {review === 'recovery' && (
            <div className="identity-confirm-target">
              <span>{t('identitySafety.restoreIdentity')}</span>
              <strong>{maskDisplayName(recoveryRecord?.name, undefined, privacyMask) || t('identitySafety.originalUnavailable')}</strong>
            </div>
          )}
          {typeof review === 'object' && review && (
            <div className="identity-confirm-target">
              <span>{t('目标身份')}</span>
              <strong>
                {maskDisplayName(review.name, targetSummary?.email, privacyMask)}
                {targetSummary?.email ? ` · ${maskEmailAddress(targetSummary.email, privacyMask)}` : ''}
                {targetSummary?.plan ? ` (${targetSummary.plan})` : ''}
              </strong>
            </div>
          )}
          {currentQuota && review !== 'recovery' && (
            <div className="identity-confirm-target">
              <span>{t('当前剩余额度')}</span>
              <code>{currentQuota.detail}</code>
            </div>
          )}
          {targetQuota && (
            <div className="identity-confirm-target">
              <span>{t('目标剩余额度')}</span>
              <code>{targetQuota.detail}</code>
            </div>
          )}
          {typeof review === 'object' && review && (
            <div className="identity-confirm-target">
              <span>{t('quota.isolationStatus')}</span>
              <strong>
                {state?.browser.enabled
                  ? (state.browser.bound_ids.includes(review.id) ? t('quota.isolatedBrowserActive') : t('quota.isolatedBrowserPending'))
                  : t('quota.isolatedBrowserOff')}
              </strong>
            </div>
          )}
          {current?.proxy && (
            <div className="identity-confirm-target">
              <span>{t('当前专属代理')}</span>
              <code>{current.proxy}</code>
            </div>
          )}
          {targetSummary?.proxy && (
            <div className="identity-confirm-target">
              <span>{t('目标专属代理')}</span>
              <code>{targetSummary.proxy}</code>
            </div>
          )}
          <div className="identity-confirm-keep">
            <span>{t('留在工作区')}</span>
            <strong>{kept.join(' · ') || t('无')}</strong>
          </div>
          {!policy.history && review !== 'recovery' && (hasBackgroundDaemonOnly || activeAdoptJobs.length > 0) && (
            <p className="identity-proxy-notice" role="note">
              {t('identities.adoptHistoryDisabledHint')}
            </p>
          )}
          {review === 'empty' && (
            <div className="identity-confirm-guide">
              <strong>{t('切换后添加新号步骤：')}</strong>
              <ol>
                <li>{t('identitySafety.browserSignIn')}</li>
                <li>{t('identitySafety.cliStep')}</li>
                <li>{t('返回本页面点击「刷新」与「保存备份」即可随时一键切号。')}</li>
              </ol>
            </div>
          )}
          {review !== 'recovery' && !warmingPromotion && (
            <LiveCliContinuityCallouts
              hasBackgroundDaemonOnly={hasBackgroundDaemonOnly}
              hasInteractiveChildShells={hasInteractiveChildShells}
              interactiveChildShells={interactiveChildShells}
              hasLiveClaudeProcess={hasLiveClaudeProcess}
              resumeShellCmd={resumeShellCmd}
              copiedBgResume={copiedBgResume}
              launchRelayBusy={launchRelayBusy}
              busy={busy}
              copyMode="switch"
              onCopyBgResumeCommand={onCopyBgResumeCommand}
              onLaunchRelay={() => {
                onReviewClose();
                void onLaunchRelayTerminal(recentLaunchDirs[0] || '');
              }}
              t={t}
            />
          )}
          {(state?.sessions?.length ?? 0) > 0 && (
            <div className="identity-confirm-sessions">
              <span>
                {t(
                  hasBackgroundDaemonOnly && review !== 'recovery' && !warmingPromotion
                    ? 'identities.bgDaemonSessionsLabel'
                    : '活跃 Claude 会话（切换时将自动结束）',
                )}
              </span>
              <ul>
                {state!.sessions.map(s => (
                  <li key={s.pid}>
                    <code>PID {s.pid}</code>
                    <span>{s.entrypoint}{s.background ? ` · ${t('identities.sessionBackgroundTag')}` : ''}</span>
                    {s.workspace && <strong>{s.workspace}</strong>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {proxyChanged && <p className="identity-proxy-notice">{t('代理环境提醒：目标身份与当前身份的独立代理配置不同，请确认出口 IP 与目标账号一致。')}</p>}
          {state?.browser.enabled && state.warming_cards?.some(card => card.browser_active) && !warmingPromotion && review !== 'recovery' && !state.recovery && (
            <Checkbox
              label={t('warming.syncCliBrowserOnSwitch')}
              checked={syncCliBrowserOnSwitch}
              disabled={busy}
              onCheckedChange={value => onSyncCliBrowserOnSwitchChange(value === true)}
            />
          )}
          {state?.browser.enabled && <p>{t(state.warming_cards?.some(card => card.browser_active) && !warmingPromotion && review !== 'recovery' && !state.recovery && !syncCliBrowserOnSwitch ? 'warming.cliSwitchKeepsBrowser' : '将关闭并重开关联浏览器，请先保存网页任务。')}</p>}
        </div>
      </AppDialog>

      <AppDialog
        alert
        className="identity-delete-alert"
        open={!!deletion}
        onOpenChange={open => {
          if (!open && !busy) onDeletionClose();
        }}
        title={deletion === 'current' ? t('直接删除当前身份') : t('删除暂存身份')}
        description={deletion === 'current' ? t('将结束 Claude 进程并删除所选本地数据。不会新增备份，已有暂存身份不受影响。') : t('永久删除这份暂存文件。当前工作区不受影响。')}
        footer={
          <>
            <Button variant="secondary" data-dialog-cancel onClick={onDeletionClose}>
              {t('取消')}
            </Button>
            <Button className="identity-delete-button" variant="secondary" disabled={busy || !accepted} onClick={() => void onRemoveIdentity()}>
              {t('确认直接删除')}
            </Button>
          </>
        }
      >
        <div className="identity-confirm">
          <div className="identity-delete-warning">
            <span aria-hidden="true">!</span>
            <strong>{t('警告：此操作不可撤销，不会创建新备份。')}</strong>
          </div>
          {deletion === 'current' ? (
            <>
              <div className="identity-confirm-keep">
                <span>{t('删除范围')}</span>
                <strong>{[t('登录与身份数据'), ...removed].join(' · ')}</strong>
              </div>
              {(state?.sessions?.length ?? 0) > 0 && (
                <div className="identity-confirm-sessions">
                  <span>{t('identitySafety.deleteSessions')}</span>
                  <ul>
                    {state!.sessions.map(session => (
                      <li key={session.pid}>
                        <code>PID {session.pid}</code>
                        <span>{session.entrypoint}</span>
                        {session.workspace && <strong>{session.workspace}</strong>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="identity-confirm-keep">
                <span>{t('留在工作区')}</span>
                <strong>{kept.join(' · ') || t('无')}</strong>
              </div>
            </>
          ) : (
            <strong>{maskDisplayName(deletion?.name, undefined, privacyMask)}</strong>
          )}
          {typeof deletion === 'object' && deletion && state?.browser.bound_ids.includes(deletion.id) && (
            <Checkbox
              label={t('同时永久删除关联浏览器资料')}
              checked={deleteBrowser}
              onCheckedChange={value => onDeleteBrowserChange(value === true)}
            />
          )}
          <Checkbox checked={accepted} onCheckedChange={onAcceptedChange} label={t('我知道此操作无法撤销')} />
        </div>
      </AppDialog>

      <AppDialog
        open={browserReview !== null}
        onOpenChange={open => {
          if (!open && !busy) onBrowserReviewClose();
        }}
        title={t(browserReview ? '联动浏览器' : '关闭浏览器联动')}
        description={t('将正常关闭并重开浏览器，请先保存网页任务。')}
        footer={
          <>
            <Button variant="secondary" disabled={busy} onClick={onBrowserReviewClose}>
              {t('取消')}
            </Button>
            <Button variant="secondary" disabled={busy} loading={busy} onClick={() => void onConfigureBrowser()}>
              {t('确认')}
            </Button>
          </>
        }
      >
        <div className="identity-confirm">
          <p>{t(browserReview ? '每个身份使用独立网页资料和稳定指纹，切换时自动恢复。首次仍需登录网站。' : '恢复使用原有通用浏览器资料。各身份的独立资料会保留。')}</p>
          {browserReview && (
            <Checkbox
              label={t('将现有浏览器资料关联给当前身份')}
              checked={useExisting}
              disabled={busy}
              onCheckedChange={value => onUseExistingChange(value === true)}
            />
          )}
          <p>{t('默认创建新资料，现有资料不会删除。资料隔离不会改变出口 IP。')}</p>
          {error && <p role="alert">{t(error)}</p>}
        </div>
      </AppDialog>

      <AppDialog
        open={!!rename}
        onOpenChange={open => {
          if (!open && !busy) onRenameClose();
        }}
        title={t('重命名身份')}
        description={t('identityCard.renameHint')}
        footer={
          <>
            <Button variant="secondary" onClick={onRenameClose}>
              {t('取消')}
            </Button>
            <Button variant="secondary" disabled={busy || !renameValue.trim()} onClick={() => void onSaveName()}>
              {t('保存')}
            </Button>
          </>
        }
      >
        <Input aria-label={t('身份名称')} maxLength={64} value={renameValue} onChange={e => onRenameValueChange(e.target.value)} />
        {error && <p role="alert">{t(error)}</p>}
      </AppDialog>

      <AppDialog
        open={expiryEditor !== null}
        onOpenChange={open => {
          if (!open && !busy) setExpiryEditor(null);
        }}
        title={t('identityCard.expiryDialogTitle', {name: maskDisplayName(expiryEditor?.label, expiryEditor?.email, privacyMask)})}
        description={t('identityCard.expiryDialogDesc')}
        fallbackFocusRef={quotaOpenerRef}
        footer={
          <>
            {expiryEditor?.hasManual && (
              <Button variant="secondary" disabled={busy} onClick={() => void onSaveSubscriptionExpiry(true)}>
                {t('identityCard.clearManualExpiry')}
              </Button>
            )}
            <Button variant="secondary" disabled={busy} onClick={() => setExpiryEditor(null)}>
              {t('取消')}
            </Button>
            <Button
              variant="secondary"
              loading={busy}
              disabled={
                busy ||
                (!expiryEditor?.expiryYmd.trim() &&
                  !expiryEditor?.rechargeYmd.trim() &&
                  expiryEditor?.manualPlan === expiryEditor?.initialManualPlan &&
                  (expiryEditor?.expiryYmd.trim() ?? '') === (expiryEditor?.initialExpiryYmd ?? '') &&
                  (expiryEditor?.rechargeYmd.trim() ?? '') === (expiryEditor?.initialRechargeYmd ?? ''))
              }
              onClick={() => void onSaveSubscriptionExpiry(false)}
            >
              {t('保存')}
            </Button>
          </>
        }
      >
        {expiryEditor && (() => {
          const previewExpiryYmd = expiryEditor.expiryYmd.trim() || addOneCalendarMonthYmd(expiryEditor.rechargeYmd.trim());
          const previewShort = formatYmdAsShortMd(previewExpiryYmd) || expiryEditor.browserSyncedShortMd;
          const previewName = maskDisplayName(expiryEditor.label, expiryEditor.email, privacyMask);
          const effectivePreviewPlan = expiryEditor.manualPlan || (expiryEditor.plan && expiryEditor.plan.trim() ? expiryEditor.plan : 'Pro');
          return (
            <div className="identity-expiry-dialog">
              <div className="identity-expiry-field">
                <label>{t('identityCard.planCalibrationTitle')}</label>
                <div className="identity-plan-calibration-chips" role="group" aria-label={t('identityCard.planCalibrationTitle')}>
                  <button
                    type="button"
                    className={`wakeup-preset-chip${expiryEditor.manualPlan === '' ? ' active' : ''}`}
                    data-manual-plan="auto"
                    onClick={() => setExpiryEditor(prev => (prev ? {...prev, manualPlan: '', error: ''} : prev))}
                  >
                    {t('identityCard.planAutoDetect')}
                  </button>
                  {CANONICAL_MANUAL_PLANS.map(tier => (
                    <button
                      key={tier}
                      type="button"
                      className={`wakeup-preset-chip${expiryEditor.manualPlan === tier ? ' active' : ''}`}
                      data-manual-plan={tier}
                      onClick={() => setExpiryEditor(prev => (prev ? {...prev, manualPlan: tier, error: ''} : prev))}
                    >
                      {tier}
                    </button>
                  ))}
                </div>
                <p className="identity-plan-calibration-hint">{t('identityCard.planCalibrationHint')}</p>
              </div>
              <div className="identity-expiry-field">
                <label htmlFor="identity-recharge-date">{t('identityCard.rechargeDateLabel')}</label>
                <div className="identity-expiry-date-row">
                  <input
                    id="identity-recharge-date"
                    type="date"
                    min="2020-01-01"
                    max="2100-12-31"
                    className="identity-expiry-date-input"
                    value={expiryEditor.rechargeYmd}
                    onChange={e => {
                      const nextRecharge = e.target.value;
                      const computedExpiry = addOneCalendarMonthYmd(nextRecharge);
                      setExpiryEditor(prev =>
                        prev
                          ? {
                              ...prev,
                              rechargeYmd: nextRecharge,
                              expiryYmd: computedExpiry ?? prev.expiryYmd,
                              error: '',
                            }
                          : prev,
                      );
                    }}
                  />
                  <Button
                    variant="secondary"
                    size="small"
                    disabled={busy}
                    onClick={() => {
                      const today = epochSecToCalendarYmd(Math.floor(Date.now() / 1000)) ?? '';
                      const computedExpiry = addOneCalendarMonthYmd(today) ?? '';
                      setExpiryEditor(prev =>
                        prev
                          ? {
                              ...prev,
                              rechargeYmd: today,
                              expiryYmd: computedExpiry,
                              error: '',
                            }
                          : prev,
                      );
                    }}
                  >
                    {t('identityCard.rechargedToday')}
                  </Button>
                </div>
              </div>
              <div className="identity-expiry-field">
                <label htmlFor="identity-expiry-date">{t('identityCard.expiryDateLabel')}</label>
                <div className="identity-expiry-date-row">
                  <input
                    id="identity-expiry-date"
                    type="date"
                    min="2020-01-01"
                    max="2100-12-31"
                    className="identity-expiry-date-input"
                    value={expiryEditor.expiryYmd}
                    onChange={e => {
                      const nextExpiry = e.target.value;
                      setExpiryEditor(prev => (prev ? {...prev, expiryYmd: nextExpiry, error: ''} : prev));
                    }}
                  />
                </div>
                {!expiryEditor.expiryYmd.trim() && !expiryEditor.rechargeYmd.trim() && expiryEditor.browserSyncedFullYmd && (
                  <p className="identity-plan-calibration-hint">
                    {t('identityCard.browserDatePreservedHint', {date: expiryEditor.browserSyncedFullYmd})}
                  </p>
                )}
              </div>
              <div className="identity-expiry-preview">
                <span>{t('identityCard.cardPreviewLabel')}</span>
                <span className="identity-expiry-preview-badge">
                  <span>{previewName}</span>
                  <span className="identity-plan-pill" data-plan-tier={normalizePlanSlug(effectivePreviewPlan)}>
                    {effectivePreviewPlan}
                  </span>
                  {previewShort && <span className="identity-expiry-tag">{previewShort}</span>}
                </span>
              </div>
              {expiryEditor.error && <p role="alert" className="cleanup-feedback error">{t(expiryEditor.error)}</p>}
            </div>
          );
        })()}
      </AppDialog>
    </>
  );
}
