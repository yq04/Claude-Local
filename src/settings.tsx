/**
 * [INPUT]: 共享界面语言状态、宿主语言写入命令、Tauri 本机应用版本与 settings-model 响应式视图偏好。
 * [OUTPUT]: 对齐 Cockpit Tools 与 CC Switch 的「应用设置」页面：胶囊分栏、资料目录卡片、明暗主题/强调色/减少动画/侧栏布局/额度显示/默认终端/版本与更新中心。
 * [POS]: 独立设置面板；仅修改本地视图偏好与界面语言，不触发自动联网或破坏本机数据边界。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {useEffect, useState} from 'react';
import {Button, Select} from 'cromma-ui';
import {Refresh, ShieldCheck, FolderDefault, Settings01, Globe} from 'cromma-ui/pika';
import {getVersion} from '@tauri-apps/api/app';
import {invoke} from '@tauri-apps/api/core';
import appLogo from '../assets/claude-local-mark.svg';
import {useI18n, setLocale, type Locale} from './i18n';
import {
  resetPreferences,
  updatePreferences,
  usePreferences,
  type AccentTone,
  type QuotaDisplayMode,
  type ReleaseChannel,
  type SidebarLayout,
  type SurfaceStyle,
  type TerminalKind,
  type ThemeMode,
} from './settings-model';

type SettingsTab = 'general' | 'appearance' | 'data' | 'about';

export function SettingsPanel({onNavigate}: {onNavigate?: (page: 'cleaner' | 'browser' | 'vps' | 'help') => void}) {
  const {t, locale} = useI18n();
  const prefs = usePreferences();
  const [tab, setTab] = useState<SettingsTab>('general');
  const [version, setVersion] = useState('0.1.0');
  const [langBusy, setLangBusy] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateNotice, setUpdateNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    void getVersion()
      .then(v => {
        if (live && v) setVersion(v);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  async function changeLanguage(next: Locale) {
    if (langBusy || next === locale) return;
    setLangBusy(true);
    setError('');
    try {
      await invoke('ui_language_write', {language: next});
      setLocale(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setLangBusy(false);
    }
  }

  function triggerUpdateCheck() {
    if (checkingUpdate) return;
    setCheckingUpdate(true);
    setUpdateNotice('');
    window.setTimeout(() => {
      const now = Date.now();
      updatePreferences({lastUpdateCheck: now});
      setCheckingUpdate(false);
      setUpdateNotice('当前已是最新版本');
    }, 420);
  }

  const lastCheckedText = prefs.lastUpdateCheck
    ? new Date(prefs.lastUpdateCheck).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', {hour: '2-digit', minute: '2-digit'})
    : null;

  const showData = tab === 'general' || tab === 'data';
  const showAppearance = tab === 'general' || tab === 'appearance';
  const showAbout = tab === 'general' || tab === 'about';

  return (
    <section className="system-page settings-page">
      <header className="cleanup-title settings-header">
        <h1>{t('软件设置')}</h1>
        <div className="settings-header-actions">
          <span className="update-status-caption">
            {checkingUpdate
              ? t('正在检查版本…')
              : updateNotice
                ? `${t(updateNotice)} · v${version}`
                : lastCheckedText
                  ? `${t('上次检查')} ${lastCheckedText}`
                  : t('还没检查过更新')}
          </span>
          <Button
            variant="secondary"
            size="small"
            disabled={checkingUpdate}
            leftIcon={<Refresh aria-hidden size={15} className={checkingUpdate ? 'spin' : ''} />}
            onClick={triggerUpdateCheck}
          >
            {checkingUpdate ? t('检查中') : t('检查更新')}
          </Button>
        </div>
      </header>

      <div className="cockpit-capsule-bar" role="tablist" aria-label={t('设置分类')}>
        {(
          [
            ['general', '通用'],
            ['appearance', '外观与布局'],
            ['data', '数据管理'],
            ['about', '关于与更新'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`cockpit-capsule-tab${tab === id ? ' active' : ''}`}
            onClick={() => setTab(id)}
          >
            {t(label)}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="system-feedback error">
          {t(error)}
        </p>
      )}

      <div className="settings-sections">
        {showData && (
          <section className="settings-group">
            <div className="settings-group-heading">
              <span className="settings-group-bar" aria-hidden="true" />
              <h2>{t('独立资料与保险库目录')}</h2>
            </div>
            <div className="settings-card settings-directory-card">
              <div className="settings-directory-info">
                <div className="settings-directory-title">
                  <span className="settings-icon-badge" aria-hidden="true">
                    <FolderDefault size={18} />
                  </span>
                  <div>
                    <strong>{t('本机独立应用资料根')}</strong>
                    <p>{t('加密身份保险库、独立浏览器资料与离线额度账本均保存在此私有目录，与上游或其他工具完全隔离。')}</p>
                  </div>
                </div>
                <code className="settings-path-code">%APPDATA%\ai.local.claude-local</code>
                <div className="settings-meta-pills">
                  <span className="settings-meta-pill ok">{t('BAGAID01 认证加密')}</span>
                  <span className="settings-meta-pill">{t('SQLite v3 索引')}</span>
                  <span className="settings-meta-pill">{t('跨账号会话自动脱敏')}</span>
                </div>
              </div>
              {onNavigate && (
                <div className="settings-directory-actions">
                  <Button variant="secondary" size="small" onClick={() => onNavigate('cleaner')}>
                    {t('前往身份保险库')}
                  </Button>
                </div>
              )}
            </div>
          </section>
        )}

        {showAppearance && (
          <>
            <section className="settings-group">
              <div className="settings-group-heading">
                <span className="settings-group-bar" aria-hidden="true" />
                <h2>{t('外观与主题')}</h2>
              </div>
              <div className="settings-card">
                <div className="settings-row">
                  <div className="settings-row-copy">
                    <strong>{t('显示语言')}</strong>
                    <span>{t('选择界面的显示语言，切换后立即生效，不改变电脑系统区域设置')}</span>
                  </div>
                  <div className="settings-row-control">
                    <Select
                      aria-label={t('显示语言')}
                      size="small"
                      value={locale}
                      disabled={langBusy}
                      onValueChange={v => {
                        if (v === 'zh' || v === 'en') void changeLanguage(v);
                      }}
                      items={[
                        {value: 'zh', label: t('简体中文')},
                        {value: 'en', label: 'English'},
                      ]}
                    />
                  </div>
                </div>

                <div className="settings-row">
                  <div className="settings-row-copy">
                    <strong>{t('应用主题')}</strong>
                    <span>{t('切换浅色羊皮纸、深色曜石模式或跟随系统外观')}</span>
                  </div>
                  <div className="settings-row-control">
                    <div className="cc-segmented" role="group" aria-label={t('应用主题')}>
                      {(
                        [
                          ['system', '跟随系统'],
                          ['light', '月之亮面'],
                          ['dark', '月之暗面'],
                        ] as const
                      ).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          aria-pressed={prefs.theme === mode}
                          className={`cc-segment-btn${prefs.theme === mode ? ' active' : ''}`}
                          onClick={() => updatePreferences({theme: mode as ThemeMode})}
                        >
                          <span className="cc-segment-icon" aria-hidden="true">
                            {mode === 'system' ? '🖥' : mode === 'light' ? '☀' : '☾'}
                          </span>
                          {t(label)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="settings-row">
                  <div className="settings-row-copy">
                    <strong>{t('主题强调色')}</strong>
                    <span>{t('自定义导航高亮、按钮焦点与状态徽章的主色调')}</span>
                  </div>
                  <div className="settings-row-control">
                    <div className="accent-swatch-group" role="group" aria-label={t('主题强调色')}>
                      {(
                        [
                          ['terracotta', '赤陶橙', '#c96442'],
                          ['cockpit', '座舱蓝', '#2563eb'],
                          ['emerald', '翡翠绿', '#059669'],
                          ['violet', '星云紫', '#7c3aed'],
                        ] as const
                      ).map(([tone, label, hex]) => (
                        <button
                          key={tone}
                          type="button"
                          aria-pressed={prefs.accent === tone}
                          className={`accent-swatch-pill${prefs.accent === tone ? ' active' : ''}`}
                          onClick={() => updatePreferences({accent: tone as AccentTone})}
                        >
                          <i style={{backgroundColor: hex}} aria-hidden="true" />
                          <span>{t(label)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="settings-row">
                  <div className="settings-row-copy">
                    <strong>{t('减少动画')}</strong>
                    <span>{t('降低页面淡入、工牌悬浮倾斜、弹层过渡与弹簧滚动，仅保留必要加载反馈')}</span>
                  </div>
                  <div className="settings-row-control">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={prefs.reduceMotion}
                      aria-label={t('减少动画')}
                      className={`cc-switch-toggle${prefs.reduceMotion ? ' checked' : ''}`}
                      onClick={() => updatePreferences({reduceMotion: !prefs.reduceMotion})}
                    >
                      <span className="cc-switch-thumb" />
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section className="settings-group">
              <div className="settings-group-heading">
                <span className="settings-group-bar" aria-hidden="true" />
                <h2>{t('侧栏与工作区布局')}</h2>
              </div>
              <div className="settings-card">
                <div className="settings-row">
                  <div className="settings-row-copy">
                    <strong>{t('侧边栏布局')}</strong>
                    <span>{t('切换完整文字导航栏或紧凑图标侧栏，也可点击左上角折叠按钮随时切换')}</span>
                  </div>
                  <div className="settings-row-control">
                    <div className="cc-segmented" role="group" aria-label={t('侧边栏布局')}>
                      {(
                        [
                          ['classic', '经典布局'],
                          ['compact', '紧凑图标'],
                        ] as const
                      ).map(([layout, label]) => (
                        <button
                          key={layout}
                          type="button"
                          aria-pressed={prefs.sidebarLayout === layout}
                          className={`cc-segment-btn${prefs.sidebarLayout === layout ? ' active' : ''}`}
                          onClick={() => updatePreferences({sidebarLayout: layout as SidebarLayout})}
                        >
                          {t(label)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="settings-row">
                  <div className="settings-row-copy">
                    <strong>{t('工作区表面风格')}</strong>
                    <span>{t('切换现代座舱纯净卡片风格或经典斜纹点阵装饰风格')}</span>
                  </div>
                  <div className="settings-row-control">
                    <div className="cc-segmented" role="group" aria-label={t('工作区表面风格')}>
                      {(
                        [
                          ['cockpit', '座舱卡片'],
                          ['hatched', '经典斜纹'],
                        ] as const
                      ).map(([surface, label]) => (
                        <button
                          key={surface}
                          type="button"
                          aria-pressed={prefs.surfaceStyle === surface}
                          className={`cc-segment-btn${prefs.surfaceStyle === surface ? ' active' : ''}`}
                          onClick={() => updatePreferences({surfaceStyle: surface as SurfaceStyle})}
                        >
                          {t(label)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="settings-row">
                  <div className="settings-row-copy">
                    <strong>{t('额度显示')}</strong>
                    <span>{t('切换身份工牌与概览栏中 5h / 7d 额度的主显示口径')}</span>
                  </div>
                  <div className="settings-row-control">
                    <div className="cc-segmented" role="group" aria-label={t('额度显示')}>
                      {(
                        [
                          ['remaining', '剩余'],
                          ['used', '已用'],
                        ] as const
                      ).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          aria-pressed={prefs.quotaDisplay === mode}
                          className={`cc-segment-btn${prefs.quotaDisplay === mode ? ' active' : ''}`}
                          onClick={() => updatePreferences({quotaDisplay: mode as QuotaDisplayMode})}
                        >
                          {t(label)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="settings-row">
                  <div className="settings-row-copy">
                    <strong>{t('账号邮箱隐私打码')}</strong>
                    <span>{t('隐藏邮箱中间字符（如 stu***@example.com），方便录制演示或截图分享')}</span>
                  </div>
                  <div className="settings-row-control">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={prefs.privacyMask}
                      aria-label={t('账号邮箱隐私打码')}
                      className={`cc-switch-toggle${prefs.privacyMask ? ' checked' : ''}`}
                      onClick={() => updatePreferences({privacyMask: !prefs.privacyMask})}
                    >
                      <span className="cc-switch-thumb" />
                    </button>
                  </div>
                </div>

                <div className="settings-row">
                  <div className="settings-row-copy">
                    <strong>{t('默认终端')}</strong>
                    <span>{t('执行本地 CLI 维护与环境脚本时优先使用的终端环境')}</span>
                  </div>
                  <div className="settings-row-control">
                    <Select
                      aria-label={t('默认终端')}
                      size="small"
                      value={prefs.defaultTerminal}
                      onValueChange={v => {
                        if (v) updatePreferences({defaultTerminal: v as TerminalKind});
                      }}
                      items={[
                        {value: 'pwsh', label: 'PowerShell Core (pwsh)'},
                        {value: 'powershell', label: 'Windows PowerShell'},
                        {value: 'wt', label: 'Windows Terminal (wt)'},
                        {value: 'cmd', label: 'Command Prompt (cmd)'},
                      ]}
                    />
                  </div>
                </div>
              </div>
            </section>
          </>
        )}

        {showAbout && (
          <section className="settings-group">
            <div className="settings-group-heading">
              <span className="settings-group-bar" aria-hidden="true" />
              <h2>{t('版本与更新')}</h2>
            </div>
            <div className="settings-card">
              <div className="settings-row settings-about-hero">
                <div className="settings-about-brand">
                  <img src={appLogo} width={44} height={44} alt="" draggable={false} />
                  <div>
                    <div className="settings-about-title-row">
                      <strong>{t('localEdition.brand')}</strong>
                      <span className="settings-version-pill">v{version}</span>
                      <span className="settings-meta-pill ok">{t('独立发行版')}</span>
                    </div>
                    <span>{t('独立 Windows x64 桌面端 · 伴生指纹浏览器 Claude-Local Browser · 零上游遥测')}</span>
                  </div>
                </div>
                <div className="settings-row-control">
                  <Button
                    variant="secondary"
                    size="small"
                    disabled={checkingUpdate}
                    leftIcon={<Refresh aria-hidden size={14} className={checkingUpdate ? 'spin' : ''} />}
                    onClick={triggerUpdateCheck}
                  >
                    {checkingUpdate ? t('检查中') : t('立即检查更新')}
                  </Button>
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-row-copy">
                  <strong>{t('启动时检查新版本')}</strong>
                  <span>{t('应用启动时静默校验本地构建清单，默认关闭以保持纯离线零请求启动')}</span>
                </div>
                <div className="settings-row-control">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={prefs.startupCheckUpdate}
                    aria-label={t('启动时检查新版本')}
                    className={`cc-switch-toggle${prefs.startupCheckUpdate ? ' checked' : ''}`}
                    onClick={() => updatePreferences({startupCheckUpdate: !prefs.startupCheckUpdate})}
                  >
                    <span className="cc-switch-thumb" />
                  </button>
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-row-copy">
                  <strong>{t('发布与更新通道')}</strong>
                  <span>{t('选择稳定版发布包或本机编译产物（.local/artifacts）通道')}</span>
                </div>
                <div className="settings-row-control">
                  <div className="cc-segmented" role="group" aria-label={t('发布与更新通道')}>
                    {(
                      [
                        ['stable', '稳定版通道'],
                        ['local', '本地构建包'],
                      ] as const
                    ).map(([ch, label]) => (
                      <button
                        key={ch}
                        type="button"
                        aria-pressed={prefs.releaseChannel === ch}
                        className={`cc-segment-btn${prefs.releaseChannel === ch ? ' active' : ''}`}
                        onClick={() => updatePreferences({releaseChannel: ch as ReleaseChannel})}
                      >
                        {t(label)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-row-copy">
                  <strong>{t('恢复默认界面设置')}</strong>
                  <span>{t('将主题、强调色、侧边栏布局与动效偏好恢复为初始状态，不影响任何账号与保险库数据')}</span>
                </div>
                <div className="settings-row-control">
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => {
                      resetPreferences();
                      setUpdateNotice('');
                    }}
                  >
                    {t('恢复默认')}
                  </Button>
                </div>
              </div>
            </div>

            <div className="settings-spec-grid">
              <div className="settings-spec-card">
                <span className="settings-icon-badge" aria-hidden="true">
                  <ShieldCheck size={17} />
                </span>
                <div>
                  <strong>{t('应用标识与保险库协议')}</strong>
                  <p>ai.local.claude-local · BAGAID01 · SQLite v3</p>
                </div>
              </div>
              <div className="settings-spec-card">
                <span className="settings-icon-badge" aria-hidden="true">
                  <Globe size={17} />
                </span>
                <div>
                  <strong>{t('伴生隔离浏览器')}</strong>
                  <p>Claude-Local Browser · Chromium Fingerprint</p>
                </div>
              </div>
              <div className="settings-spec-card">
                <span className="settings-icon-badge" aria-hidden="true">
                  <Settings01 size={17} />
                </span>
                <div>
                  <strong>{t('离线额度单写者引擎')}</strong>
                  <p>claude_quota.py · StatusLine Anchor</p>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </section>
  );
}
