/**
 * [INPUT]: Cromma UI 表单、原生电脑环境快照、经核验的设置命令、本地刷新事件与共享 YAML 文案。
 * [OUTPUT]: 时区/语言并排的紧凑圆角卡片，当前状态与目标选择分层；定位为下方紧凑长条；保留执行记录、授权入口与任务锁。
 * [POS]: 系统设置的交互边界；草稿与当前状态分离，不在页面加载时修改电脑；兼容未含 platform 的旧 macOS 快照。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {Button, Select} from 'cromma-ui';
import {ClockDefault as ClockIcon, Translate as TranslateIcon, MapPin as MapPinIcon, Refresh as ArrowClockwiseIcon} from 'cromma-ui/pika';
import {useEffect, useRef, useState} from 'react';
import {useI18n} from './i18n';
import {invoke} from '@tauri-apps/api/core';
import {CleanupActivity, useCleanupActivity} from './cleaner-activity';
import {usePageRefresh} from './app-events';
import {AppDialog} from './dialog';

type SystemState = {
  platform?: string;
  timezone: string;
  timezones: string[];
  automatic_timezone: boolean | null;
  languages: string[];
  location_enabled: boolean | null;
  accessibility: boolean;
};
type SystemResult = {
  state: SystemState;
  message: string;
};
type ChangeRecord = {id: string; operation: string; before: Record<string, unknown>; after: Record<string, unknown>; restorable: string[]; completed: boolean; message: string; changedAt: string};
type RestoreField = {field: string; before: unknown; appWritten: unknown; current: unknown; conflict: boolean};
type RestorePlan = {record: ChangeRecord; fields: RestoreField[]};
const languages: Record<string, string> = {
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
  en: 'English',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
  it: 'Italiano',
  'pt-BR': 'Português (Brasil)',
  ja: '日本語',
  ko: '한국어',
  ru: 'Русский',
  ar: 'العربية',
};
function languageChoice(code: string) {
  return Object.keys(languages).find(key => code === key || code.startsWith(key + '-'));
}
export function SystemPanel({onBusy}: {onBusy?: (busy: boolean) => void}) {
  const {t} = useI18n();
  const [state, setState] = useState<SystemState | null>(null);
  const [zone, setZone] = useState('');
  const [language, setLanguage] = useState('en');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<ChangeRecord[]>([]);
  const [restorePlan, setRestorePlan] = useState<RestorePlan | null>(null);
  const [restoreFields, setRestoreFields] = useState<string[]>([]);
  const busyRef = useRef(false);
  const live = useRef(true);
  const activity = useCleanupActivity();
  useEffect(() => {
    onBusy?.(busy !== null);
    return () => onBusy?.(false);
  }, [busy, onBusy]);
  async function refresh(initial = false) {
    const next = await invoke<SystemState>('system_read');
    if (!live.current) return;
    setState(next);
    if (initial) {
      setZone(next.timezone);
      setLanguage(languageChoice(next.languages[0] || 'en') || 'en');
    }
    return next;
  }
  usePageRefresh(() => {
    if (!busyRef.current)
      void refresh().catch(e => setError(String(e)));
  });
  useEffect(() => {
    live.current = true;
    void refresh(true).catch(e => {
      if (live.current) setError(String(e));
    });
    const onFocus = () => {
      if (!busyRef.current) void refresh().catch(e => setError(String(e)));
    };
    window.addEventListener('focus', onFocus);
    return () => {
      live.current = false;
      window.removeEventListener('focus', onFocus);
    };
  }, []);
  async function apply(kind: 'timezone' | 'language' | 'location') {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(kind);
    setError('');
    activity.start('system');
    activity.log(
      'system',
      'running',
      kind === 'timezone' ? `正在应用 ${zone}，请完成系统管理员授权。` : kind === 'language' ? `正在保存首选语言：${languages[language]}。` : '正在关闭定位；需要时请完成系统设置授权。',
    );
    try {
      const result = await invoke<SystemResult>(
        kind === 'timezone' ? 'system_set_timezone' : kind === 'language' ? 'system_set_language' : 'system_disable_location',
        kind === 'timezone' ? {timezone: zone} : kind === 'language' ? {language} : {},
      );
      setState(result.state);
      const confirmed = kind !== 'location' || result.state.location_enabled === false;
      activity.log('system', confirmed ? 'ok' : 'warning', result.message);
      activity.finish(confirmed, result.message);
    } catch (e) {
      const message = String(e);
      setError(message);
      activity.log('system', 'error', message);
      activity.finish(false, message);
      try {
        await refresh();
      } catch {
        setState(null);
      }
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }
  async function reload() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy('read');
    setError('');
    try {
      await refresh(!zone);
    } catch (e) {
      setState(null);
      setError(String(e));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }
  async function open(pane: string) {
    try {
      await invoke('system_open_settings', {pane});
    } catch (e) {
      setError(String(e));
    }
  }
  async function openHistory() {
    try {
      setHistory(await invoke<ChangeRecord[]>('system_change_history'));
      setRestorePlan(null);
      setHistoryOpen(true);
    } catch (e) { setError(String(e)); }
  }
  async function prepareRestore(id: string) {
    try {
      const plan = await invoke<RestorePlan>('system_change_restore_plan', {id});
      setRestorePlan(plan);
      const pairedConflict = plan.fields.some(field => field.conflict && (field.field === 'language' || field.field === 'locale'));
      setRestoreFields(plan.fields.filter(field => !field.conflict && !(pairedConflict && (field.field === 'language' || field.field === 'locale'))).map(field => field.field));
    } catch (e) { setError(String(e)); }
  }
  async function restoreSelected() {
    if (!restorePlan || !restoreFields.length || busyRef.current) return;
    busyRef.current = true; setBusy('restore'); setError('');
    try {
      await invoke('system_change_restore', {id: restorePlan.record.id, fields: restoreFields});
      await refresh();
      setHistory(await invoke<ChangeRecord[]>('system_change_history'));
      setRestorePlan(null);
    } catch (e) { setError(String(e)); try { await refresh(); } catch { setState(null); } }
    finally { busyRef.current = false; setBusy(null); }
  }
  const zones = state ? Object.fromEntries(state.timezones.map(value => [value, value.replaceAll('_', ' ')])) : {};
  const disabled = busy !== null || !state;
  // The legacy macOS snapshot omits platform; Windows and Linux always provide it.
  const isMacOS = !!state && (!state.platform || state.platform === 'macos');
  return (
    <section className="system-page system-environment-page">
      <div className="cleanup-title">
        <div>
          <h1>{t('电脑环境')}</h1>
        </div>
        <div className="cleanup-title-actions">
          <Button variant="secondary" size="small" disabled={busy !== null} onClick={() => void openHistory()}>{t('查看/恢复本次环境修改')}</Button>
          {isMacOS && (
            <Button
              variant="ghost"
              size="small"
              disabled={busy !== null}
              loading={busy === 'keychain'}
              onClick={async () => {
                if (busyRef.current) return;
                busyRef.current = true;
                setBusy('keychain');
                setError('');
                activity.start('system');
                try {
                  activity.finish(true, await invoke<string>('unlock_keychain'));
                } catch (e) {
                  setError(String(e));
                  activity.finish(false, String(e));
                } finally {
                  busyRef.current = false;
                  setBusy(null);
                }
              }}
            >
              {t('解锁清理钥匙串')}
            </Button>
          )}
          <Button
            variant="secondary"
            size="small"
            disabled={busy !== null}
            onClick={async () => {
              try {
                await invoke('open_permissions');
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            {t('系统授权设置')}
          </Button>
          <Button variant="secondary" size="small" loading={busy === 'read'} disabled={busy !== null} leftIcon={<ArrowClockwiseIcon size={16} aria-hidden="true" />} onClick={() => void reload()}>
            {t('刷新状态')}
          </Button>
        </div>
      </div>
      {error && (
        <p className="system-feedback error" role="alert">
          {t(error)}
        </p>
      )}
      <p className="system-page-intro">{t('computer.subtitle')}</p>
      <div className="system-sections system-settings-list">
        <article className="system-setting-card" data-system-setting="timezone" aria-labelledby="system-timezone-title">
          <div className="system-setting-header">
            <span className="settings-icon-badge" aria-hidden="true"><ClockIcon size={20} /></span>
            <div className="system-setting-copy">
              <div className="system-heading-line"><h2 id="system-timezone-title">{t('设备时区')}</h2><span className="system-state-label">{!state ? t('等待系统状态') : state.automatic_timezone == null ? t('computer.autoUnknown') : state.automatic_timezone ? t('computer.automatic') : t('computer.manual')}</span></div>
              <p className="system-current-value"><span>{t('computer.current')}</span><strong>{state?.timezone || t('读取中…')}</strong></p>
            </div>
          </div>
          <div className="system-inline-controls">
            <div className="system-inline-field system-inline-select">
              <span className="system-field-label">{t('目标时区')}</span>
              <Select
                aria-label={t('目标时区')}
                size="small"
                value={zone || undefined}
                onValueChange={value => {if (value) setZone(value);}}
                items={Object.entries(zones).map(([value, label]) => ({value, label: t(label)}))}
                disabled={disabled}
              />
            </div>
            <Button size="small" variant="secondary" disabled={busy !== null} onClick={() => void open('timezone')}>{t('系统设置')}</Button>
            <Button variant="secondary" size="small" loading={busy === 'timezone'} disabled={disabled || !zone || (zone === state?.timezone && state?.automatic_timezone !== true)} onClick={() => void apply('timezone')}>{t('应用时区')}</Button>
          </div>
        </article>

        <article className="system-setting-card" data-system-setting="language" aria-labelledby="system-language-title">
          <div className="system-setting-header">
            <span className="settings-icon-badge" aria-hidden="true"><TranslateIcon size={20} /></span>
            <div className="system-setting-copy">
              <h2 id="system-language-title">{t('系统语言')}</h2>
              <p className="system-current-value"><span>{t('computer.current')}</span><strong>{state ? t(languages[languageChoice(state.languages[0] || '') || ''] || state.languages[0] || '未设置') : t('读取中…')}</strong>{state?.languages.length ? <span className="system-language-code" title={state.languages.join(' → ')}>{state.languages.join(' → ')}</span> : null}</p>
            </div>
          </div>
          <div className="system-inline-controls">
            <div className="system-inline-field system-inline-select">
              <span className="system-field-label">{t('目标语言')}</span>
              <Select
                aria-label={t('目标语言')}
                size="small"
                value={language}
                onValueChange={value => {if (value) setLanguage(value);}}
                items={Object.entries(languages).map(([value, label]) => ({value, label: t(label)}))}
                disabled={disabled}
              />
            </div>
            <Button size="small" variant="secondary" disabled={busy !== null} onClick={() => void open('language')}>{t('系统设置')}</Button>
            <Button variant="secondary" size="small" loading={busy === 'language'} disabled={disabled || language === languageChoice(state?.languages[0] || 'en')} onClick={() => void apply('language')}>{t('应用语言')}</Button>
          </div>
          <p className="system-setting-note">{t('应用重启后生效；系统完整切换可能需要注销。')}</p>
        </article>

        <article className="system-setting-card" data-system-setting="location" aria-labelledby="system-location-title">
          <div className="system-location-row">
            <div className="system-setting-header">
              <span className="settings-icon-badge" aria-hidden="true"><MapPinIcon size={20} /></span>
              <div className="system-setting-copy">
                <div className="system-heading-line"><h2 id="system-location-title">{t('地理位置')}</h2><span className={'system-state-label' + (state?.location_enabled === false ? ' verified' : '')}>{!state ? t('读取中…') : state.location_enabled == null ? t('尚未核验') : state.location_enabled ? t('开启') : t('已关闭')}</span></div>
                <p className="system-location-description">{isMacOS && !state?.accessibility ? t('需要辅助功能权限，或在系统设置中手动关闭。') : t('computer.locationHint')}</p>
              </div>
            </div>
            <div className="system-inline-controls system-location-controls">
              <Button size="small" variant="secondary" disabled={busy !== null} onClick={() => void open('location')}>{t('打开定位设置')}</Button>
              <Button variant="secondary" size="small" loading={busy === 'location'} disabled={disabled || state?.location_enabled === false} onClick={() => void apply('location')}>{state?.location_enabled === false ? t('已关闭定位') : t('关闭地理位置')}</Button>
            </div>
          </div>
        </article>
      </div>
      <p className="system-page-note">{t(isMacOS ? '需要管理员授权。' : '需要时请完成系统授权。')}</p>
      <CleanupActivity activity={activity.state} />
      <AppDialog open={historyOpen} onOpenChange={setHistoryOpen} title={t('查看/恢复本次环境修改')} description={t('恢复前会比较当前值；发生冲突的字段不会覆盖。')} width={640} footer={<><Button variant="secondary" data-dialog-cancel onClick={() => setHistoryOpen(false)}>{t('关闭')}</Button>{restorePlan && <Button variant="secondary" disabled={!restoreFields.length || busy !== null} loading={busy === 'restore'} onClick={() => void restoreSelected()}>{t('恢复所选字段')}</Button>}</>}>
        {!restorePlan ? <div className="system-change-history">{history.length ? history.map(record => <article key={record.id} className="system-change-entry"><div><strong>{t(record.operation === 'timezone' ? '设备时区' : record.operation === 'language' ? '系统语言' : record.operation === 'region' ? '语言与区域' : record.operation === 'align' ? '环境对齐' : '地理位置')}</strong><small>{record.changedAt}</small></div><p>{record.message}</p><div className="system-change-values">{Object.entries(record.before).map(([field, value]) => <span key={field}>{t(field === 'timezone' ? '设备时区' : field === 'language' ? '系统语言' : field === 'locale' ? '区域格式' : '地理位置')}：{String(value)} → {String(record.after[field] ?? t('未核验'))}</span>)}</div><Button size="small" variant="secondary" disabled={!record.restorable.length} onClick={() => void prepareRestore(record.id)}>{t('查看/恢复')}</Button></article>) : <p>{t('尚无本次环境修改记录。')}</p>}</div> : <div className="system-change-restore"><p>{restorePlan.record.message}</p>{restorePlan.fields.length ? restorePlan.fields.map(field => <label key={field.field} className="system-change-field"><input type="checkbox" checked={restoreFields.includes(field.field)} disabled={field.conflict || (restorePlan.fields.some(item => item.conflict && (item.field === 'language' || item.field === 'locale')) && (field.field === 'language' || field.field === 'locale'))} onChange={event => setRestoreFields(current => event.target.checked ? [...current, field.field] : current.filter(value => value !== field.field))}/><span><strong>{t(field.field === 'timezone' ? '设备时区' : field.field === 'language' ? '系统语言' : '区域格式')}</strong><span>{t('恢复值')}：{String(field.before)}</span><span>{t('应用修改后')}：{String(field.appWritten)}</span><span>{t('当前值')}：{String(field.current)}</span>{field.conflict && <em>{t('当前值已变化，存在冲突；请手动处理。')}</em>}</span></label>) : <p>{t('没有可安全恢复的字段。')}</p>}<Button variant="ghost" size="small" onClick={() => setRestorePlan(null)}>{t('返回修改记录')}</Button></div>}
      </AppDialog>
    </section>
  );
}
