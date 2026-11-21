/**
 * [INPUT]: 原生 CLI 本地状态与活跃会话快照（sessions / backgroundOnly / cliRunning）、用户手动最新版本检查与更新命令、智能接力终端一键启动命令（identities_launch_relay_cli）和真实任务日志。
 * [OUTPUT]: 紧凑工具栏样式与中性终端徽标的 CLI 维护卡片、可恢复的本地状态读取、二进制路径一键复制、一键启动独立接力终端、运行中状态提示、当前/最新版本可关闭反馈、未安装时官方安装指引与命令复制、检查更新与一键更新。
 * [POS]: 身份页 CLI 程序维护区域；首次挂载只读本地状态，不联网、不结束会话、不修改身份或配置；视觉收紧样式与 identity-productivity.css 协同。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {useEffect, useRef, useState} from 'react';
import {Button} from 'cromma-ui';
import {invoke} from '@tauri-apps/api/core';
import {useI18n} from './i18n';
import {usePageRefresh} from './app-events';
import {CleanupActivity, useCleanupActivity} from './cleaner-activity';
import {
  isBackgroundOnlyState,
  type ActiveSession,
} from './identity-model';
import {
  getRelayLaunchDirs,
  getSmartRelayConfig,
  recordRelayLaunchDir,
} from './smart-relay-model';

type Status = {method: string; path: string; version: string; running: boolean};
type UpdateStatus = {current: Status; latest_version: string; update_available: boolean};
type Action = 'check' | 'update';

const OFFICIAL_INSTALL_CMD = 'irm https://claude.ai/install.ps1 | iex';

export function ClaudeCliPanel({
  blocked,
  onBusy,
  sessions,
  backgroundOnly,
  cliRunning,
}: {
  blocked: boolean;
  onBusy: (busy: boolean) => void;
  sessions?: readonly ActiveSession[] | null;
  backgroundOnly?: boolean | null;
  cliRunning?: boolean | null;
}) {
  const {t} = useI18n();
  const [status, setStatus] = useState<Status | null>(null),
    [loading, setLoading] = useState(true),
    [action, setAction] = useState<Action | null>(null),
    [update, setUpdate] = useState<UpdateStatus | null>(null),
    [error, setError] = useState(''),
    [readError, setReadError] = useState(''),
    [copyStatus, setCopyStatus] = useState<'copied' | 'failed' | null>(null),
    [copiedPath, setCopiedPath] = useState(false),
    [launchingRelay, setLaunchingRelay] = useState(false),
    [relayNotice, setRelayNotice] = useState('');
  const copyTimer = useRef<number | undefined>(undefined);
  const pathCopyTimer = useRef<number | undefined>(undefined);
  const activity = useCleanupActivity();

  useEffect(() => {
    void read();
    return () => {
      window.clearTimeout(copyTimer.current);
      window.clearTimeout(pathCopyTimer.current);
    };
  }, []);
  useEffect(() => {
    onBusy(!!action);
    return () => onBusy(false);
  }, [action, onBusy]);
  usePageRefresh(() => { if (!blocked && !loading && !action) void read(); });

  async function read() {
    setLoading(true);
    try {
      setStatus(await invoke<Status>('claude_cli_read'));
      setReadError('');
    } catch (e) {
      setReadError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function copyClipboardText(text: string): Promise<boolean> {
    try {
      await invoke('copy_result', {text});
      return true;
    } catch {
      try {
        if (!navigator.clipboard?.writeText) return false;
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        return false;
      }
    }
  }

  async function copyCommand() {
    window.clearTimeout(copyTimer.current);
    const ok = await copyClipboardText(OFFICIAL_INSTALL_CMD);
    setCopyStatus(ok ? 'copied' : 'failed');
    copyTimer.current = window.setTimeout(() => setCopyStatus(null), 2000);
  }

  async function copyPath() {
    if (!status?.path) return;
    window.clearTimeout(pathCopyTimer.current);
    const ok = await copyClipboardText(status.path);
    setCopiedPath(ok);
    pathCopyTimer.current = window.setTimeout(() => setCopiedPath(false), 1800);
  }

  async function run(selected: Action) {
    if (blocked || loading || action || readError) return;
    setAction(selected);
    setError('');
    if (selected === 'check') {
      try {
        setUpdate(null);
        const result = await invoke<UpdateStatus>('claude_cli_check');
        setStatus(result.current);
        setUpdate(result);
      } catch (e) {
        setError(String(e));
        await read();
      } finally {
        setAction(null);
      }
      return;
    }
    const onProgress = activity.start('cli');
    try {
      setUpdate(null);
      const result = await invoke<Status>('claude_cli_manage', {action: 'update', onProgress});
      setStatus(result);
      activity.finish(true, 'cli.updated');
    } catch (e) {
      setError(String(e));
      activity.finish(false, String(e));
      await read();
    } finally {
      setAction(null);
    }
  }

  async function launchRelayFromPanel() {
    if (blocked || loading || action || readError || !status?.method || launchingRelay) return;
    setLaunchingRelay(true);
    setError('');
    setRelayNotice('');
    try {
      const recentCwd = getRelayLaunchDirs()[0] || null;
      const relayCfg = getSmartRelayConfig();
      const res = await invoke<{cwd?: string | null}>('identities_launch_relay_cli', {
        cwd: recentCwd,
        autoContinue: relayCfg.autoContinueOnRelay,
      });
      if (res?.cwd) recordRelayLaunchDir(res.cwd);
      setRelayNotice('relay.launchedTerminalOk');
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/i, '').trim());
    } finally {
      setLaunchingRelay(false);
    }
  }

  const isMissing = !loading && !readError && !status?.method;
  const hasBgDaemonOnly = isBackgroundOnlyState({sessions, background_only: backgroundOnly});
  const hasInteractiveCliSession = Boolean(
    sessions?.some(s => !s.background && s.entrypoint !== 'Claude Desktop'),
  );
  const isAnyCliLive = Boolean(status?.running || cliRunning || hasBgDaemonOnly || hasInteractiveCliSession);

  return (
    <section className="identity-cli">
      <div className="identity-section-head">
        <div className="cli-app-row-info">
          <span className="settings-icon-badge cli-terminal-badge" aria-hidden="true">{'>_'}</span>
          <div className="cli-app-meta">
            <div className="cli-title-cluster">
              <h2>{t('Claude Code CLI')}</h2>
              <span className={'cli-status-pill ' + (readError ? 'unavailable' : status?.method ? 'installed' : 'missing')}>
                {loading ? t('cli.checking') : readError ? t('cli.statusUnavailable') : status?.method ? status.version || t('已安装') : t('未安装')}
              </span>
            </div>
            {status?.path && (
              <div className="cli-path-row">
                <code className="cli-path-code" title={status.path}>{status.path}</code>
                <button type="button" className="cli-path-copy" onClick={() => void copyPath()}>
                  {t(copiedPath ? 'cli.copiedPath' : 'cli.copyPath')}
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="cleanup-title-actions">
          {(readError || isMissing) && (
            <Button size="small" variant="secondary" loading={loading} disabled={blocked || loading || !!action} onClick={() => void read()}>
              {t(loading ? 'cli.checking' : isMissing ? 'cli.recheck' : 'cli.retryRead')}
            </Button>
          )}
          {!isMissing && !readError && status?.method && (
            <Button
              size="small"
              variant="secondary"
              data-cli-panel-launch-relay
              loading={launchingRelay}
              disabled={blocked || loading || !!action || launchingRelay}
              onClick={() => void launchRelayFromPanel()}
            >
              {t('relay.launchTerminalShort')}
            </Button>
          )}
          <Button size="small" variant="secondary" disabled={blocked || loading || !!action || !!readError || !status?.method} onClick={() => void run('check')}>
            {t(action === 'check' ? 'cli.checking' : 'cli.check')}
          </Button>
          <Button size="small" variant="secondary" disabled={blocked || loading || !!action || !!readError || !status?.method || Boolean(status.running) || isAnyCliLive || (!!update && !update.update_available)} onClick={() => void run('update')}>
            {t(action === 'update' ? 'cli.updating' : 'cli.update')}
          </Button>
        </div>
      </div>
      {isMissing ? (
        <div className="cli-install-guide">
          <p className="cleanup-feedback">{t('cli.installGuide')}</p>
          <div className="cli-install-command-row">
            <code className="cli-install-code">{OFFICIAL_INSTALL_CMD}</code>
            <Button size="small" variant="secondary" disabled={blocked} onClick={() => void copyCommand()}>
              {t(copyStatus === 'copied' ? 'cli.copiedInstall' : 'cli.copyInstall')}
            </Button>
          </div>
          {copyStatus === 'failed' && <p role="alert" className="cleanup-feedback error">{t('cli.copyFailed')}</p>}
        </div>
      ) : status?.running ? (
        <p className="cleanup-feedback">{t('cli.running')}</p>
      ) : null}
      {relayNotice && (
        <p className="cleanup-feedback cli-update-feedback" role="status">
          <span>{t(relayNotice)}</span>
          <Button variant="ghost" size="small" type="button" onClick={() => setRelayNotice('')}>{t('关闭记录')}</Button>
        </p>
      )}
      {update && (
        <p className="cleanup-feedback cli-update-feedback" role="status">
          <span>{t('cli.versions', {current: update.current.version, latest: update.latest_version})} · {t(update.update_available ? 'cli.available' : 'cli.current')}</span>
          <Button variant="ghost" size="small" type="button" onClick={() => setUpdate(null)}>{t('关闭记录')}</Button>
        </p>
      )}
      {error && (
        <p role="alert" className="cleanup-feedback error">
          {t(error)}
        </p>
      )}
      {readError && <p role="alert" className="cleanup-feedback error">{t(readError)}</p>}
      <CleanupActivity activity={activity.state} />
    </section>
  );
}
