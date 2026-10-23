/**
 * [INPUT]: 原生 CLI 本地状态、用户手动最新版本检查与更新命令和真实任务日志。
 * [OUTPUT]: 紧凑品牌维护卡片、可恢复的本地状态读取、当前/最新版本、未安装时官方安装指引与命令复制、检查更新与一键更新；读取失败不误报未安装，运行中明确阻断更新。
 * [POS]: 身份页 CLI 程序维护区域；首次挂载只读本地状态，不联网、不结束会话、不修改身份或配置。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {useEffect, useRef, useState} from 'react';
import {Button} from 'cromma-ui';
import {invoke} from '@tauri-apps/api/core';
import appLogo from '../assets/claude-local-mark.svg';
import {useI18n} from './i18n';
import {CleanupActivity, useCleanupActivity} from './cleaner-activity';

type Status = {method: string; path: string; version: string; running: boolean};
type UpdateStatus = {current: Status; latest_version: string; update_available: boolean};
type Action = 'check' | 'update';

const OFFICIAL_INSTALL_CMD = 'irm https://claude.ai/install.ps1 | iex';

export function ClaudeCliPanel({blocked, onBusy}: {blocked: boolean; onBusy: (busy: boolean) => void}) {
  const {t} = useI18n();
  const [status, setStatus] = useState<Status | null>(null),
    [loading, setLoading] = useState(true),
    [action, setAction] = useState<Action | null>(null),
    [update, setUpdate] = useState<UpdateStatus | null>(null),
    [error, setError] = useState(''),
    [readError, setReadError] = useState(''),
    [copyStatus, setCopyStatus] = useState<'copied' | 'failed' | null>(null);
  const copyTimer = useRef<number | undefined>(undefined);
  const activity = useCleanupActivity();

  useEffect(() => {
    void read();
    return () => window.clearTimeout(copyTimer.current);
  }, []);
  useEffect(() => {
    onBusy(!!action);
    return () => onBusy(false);
  }, [action, onBusy]);

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

  async function copyCommand() {
    window.clearTimeout(copyTimer.current);
    try {
      await invoke('copy_result', {text: OFFICIAL_INSTALL_CMD});
      setCopyStatus('copied');
    } catch {
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(OFFICIAL_INSTALL_CMD);
        setCopyStatus('copied');
      } catch {
        setCopyStatus('failed');
      }
    }
    copyTimer.current = window.setTimeout(() => setCopyStatus(null), 2000);
  }

  async function run(selected: Action) {
    if (blocked || loading || action || readError) return;
    setAction(selected);
    setError('');
    const onProgress = activity.start('cli');
    try {
      if (selected === 'check') {
        setUpdate(null);
        const result = await invoke<UpdateStatus>('claude_cli_check');
        setStatus(result.current);
        setUpdate(result);
        activity.finish(true, result.update_available ? 'cli.available' : 'cli.current');
      } else {
        setUpdate(null)
        const result = await invoke<Status>('claude_cli_manage', {action: 'update', onProgress});
        setStatus(result);
        activity.finish(true, 'cli.updated');
      }
    } catch (e) {
      setError(String(e));
      activity.finish(false, String(e));
      await read();
    } finally {
      setAction(null);
    }
  }

  const isMissing = !loading && !readError && !status?.method;

  return (
    <section className="identity-cli">
      <div className="identity-section-head">
        <div className="cli-app-row-info">
          <img src={appLogo} width={34} height={34} alt="" aria-hidden="true" className="cli-app-icon" />
          <div>
            <div className="cli-title-cluster">
              <h2>{t('Claude Code CLI')}</h2>
              <span className={'cli-status-pill ' + (readError ? 'unavailable' : status?.method ? 'installed' : 'missing')}>
                {loading ? t('cli.checking') : readError ? t('cli.statusUnavailable') : status?.method ? status.version || t('已安装') : t('未安装')}
              </span>
            </div>
            {status?.path && <code className="cli-path-code">{status.path}</code>}
          </div>
        </div>
        <div className="cleanup-title-actions">
          {(readError || isMissing) && (
            <Button size="small" variant="secondary" loading={loading} disabled={blocked || loading || !!action} onClick={() => void read()}>
              {t(loading ? 'cli.checking' : isMissing ? 'cli.recheck' : 'cli.retryRead')}
            </Button>
          )}
          <Button size="small" variant="secondary" disabled={blocked || loading || !!action || !!readError || !status?.method} onClick={() => void run('check')}>
            {t(action === 'check' ? 'cli.checking' : 'cli.check')}
          </Button>
          <Button size="small" variant="secondary" disabled={blocked || loading || !!action || !!readError || !status?.method || status.running || (!!update && !update.update_available)} onClick={() => void run('update')}>
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
      ) : (
        <p className="cleanup-feedback">{t(status?.running ? 'cli.running' : 'cli.scope')}</p>
      )}
      {update && <p className="cleanup-feedback" role="status">{t('cli.versions', {current: update.current.version, latest: update.latest_version})} · {t(update.update_available ? 'cli.available' : 'cli.current')}</p>}
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
