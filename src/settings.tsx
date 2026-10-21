/**
 * [INPUT]: 共享界面语言状态、宿主语言写入命令、Tauri 本机应用版本、settings-model 响应式视图偏好与 Cromma UI 的 Tabs / SegmentedControl / Switch / Select。
 * [OUTPUT]: 「软件设置」页面：分段分栏、资料目录卡片、显示语言/明暗主题/强调色/减少动画/侧栏布局/表面风格/额度口径/隐私打码与只读版本信息。
 * [POS]: 独立设置面板；仅修改本地视图偏好与界面语言，不联网、不检查或安装更新，不触碰本机数据边界。所有选择控件复用 Cromma 原语，不另写分段、开关或页签。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {useEffect, useState, type ReactNode} from 'react';
import {Button, Select, SegmentedControl, Switch, Tabs} from 'cromma-ui';
import {ShieldCheck, FolderDefault, Settings01, Globe} from 'cromma-ui/pika';
import {getVersion} from '@tauri-apps/api/app';
import {invoke} from '@tauri-apps/api/core';
import appLogo from '../assets/claude-local-mark.svg';
import {useI18n, setLocale, type Locale} from './i18n';
import {resetPreferences, updatePreferences, usePreferences, usePrivacySyncError, type AccentTone} from './settings-model';

type SettingsTab = 'general' | 'appearance' | 'data' | 'about';

const accents: readonly [AccentTone, string, string][] = [
  ['terracotta', '赤陶橙', '#c96442'],
  ['cockpit', '座舱蓝', '#2563eb'],
  ['emerald', '翡翠绿', '#059669'],
  ['violet', '星云紫', '#7c3aed'],
];

function SettingsRow({title, detail, children}: {title: string; detail: string; children: ReactNode}) {
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

function GroupHeading({children}: {children: ReactNode}) {
  return (
    <div className="settings-group-heading">
      <span className="settings-group-bar" aria-hidden="true" />
      <h2>{children}</h2>
    </div>
  );
}

export function SettingsPanel({onNavigate}: {onNavigate?: (page: 'cleaner' | 'browser' | 'vps' | 'help') => void}) {
  const {t, locale} = useI18n();
  const prefs = usePreferences();
  const privacyError = usePrivacySyncError();
  const [tab, setTab] = useState<SettingsTab>('general');
  const [version, setVersion] = useState('');
  const [langBusy, setLangBusy] = useState(false);
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

  const showData = tab === 'general' || tab === 'data';
  const showAppearance = tab === 'general' || tab === 'appearance';
  const showAbout = tab === 'general' || tab === 'about';

  return (
    <section className="system-page settings-page">
      <header className="cleanup-title settings-header">
        <h1>{t('软件设置')}</h1>
      </header>
      {privacyError && <p className="system-feedback error" role="alert">{t(privacyError)}</p>}

      <Tabs
        aria-label={t('设置分类')}
        className="settings-tabs"
        value={tab}
        onValueChange={value => setTab(value as SettingsTab)}
        tabs={[
          {value: 'general', label: t('通用')},
          {value: 'appearance', label: t('外观与布局')},
          {value: 'data', label: t('数据管理')},
          {value: 'about', label: t('关于')},
        ]}
      />

      {error && (
        <p role="alert" className="system-feedback error">
          {t(error)}
        </p>
      )}

      <div className="settings-sections">
        {showData && (
          <section className="settings-group">
            <GroupHeading>{t('独立资料与保险库目录')}</GroupHeading>
            <div className="settings-card settings-directory-card">
              <div className="settings-directory-info">
                <div className="settings-directory-title">
                  <span className="settings-icon-badge" aria-hidden="true">
                    <FolderDefault size={18} />
                  </span>
                  <div>
                    <strong>{t('本机独立应用资料根')}</strong>
                    <p>{t('identitySafety.dataBoundary')}</p>
                  </div>
                </div>
                <code className="settings-path-code">%APPDATA%\ai.local.claude-local</code>
                <div className="settings-meta-pills">
                  <span className="settings-meta-pill ok">{t('BAGAID01 认证加密')}</span>
                  <span className="settings-meta-pill">{t('SQLite v3 索引')}</span>
                  <span className="settings-meta-pill">{t('identitySafety.historyPreserved')}</span>
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
              <GroupHeading>{t('外观与主题')}</GroupHeading>
              <div className="settings-card">
                <SettingsRow title={t('显示语言')} detail={t('选择界面的显示语言，切换后立即生效，不改变电脑系统区域设置')}>
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
                </SettingsRow>
                <SettingsRow title={t('应用主题')} detail={t('切换浅色羊皮纸、深色曜石模式或跟随系统外观')}>
                  <SegmentedControl
                    aria-label={t('应用主题')}
                    size="small"
                    value={prefs.theme}
                    onValueChange={theme => updatePreferences({theme})}
                    items={[
                      {value: 'system', label: t('跟随系统')},
                      {value: 'light', label: t('月之亮面')},
                      {value: 'dark', label: t('月之暗面')},
                    ]}
                  />
                </SettingsRow>
                <SettingsRow title={t('主题强调色')} detail={t('自定义导航高亮、按钮焦点与状态徽章的主色调')}>
                  <SegmentedControl
                    aria-label={t('主题强调色')}
                    size="small"
                    value={prefs.accent}
                    onValueChange={accent => updatePreferences({accent})}
                    items={accents.map(([tone, label, hex]) => ({
                      value: tone,
                      label: (
                        <>
                          <i className="accent-dot" style={{backgroundColor: hex}} aria-hidden="true" />
                          {t(label)}
                        </>
                      ),
                    }))}
                  />
                </SettingsRow>
                <SettingsRow title={t('减少动画')} detail={t('降低页面淡入、工牌悬浮倾斜、弹层过渡与弹簧滚动，仅保留必要加载反馈')}>
                  <Switch aria-label={t('减少动画')} checked={prefs.reduceMotion} onCheckedChange={reduceMotion => updatePreferences({reduceMotion})} />
                </SettingsRow>
              </div>
            </section>

            <section className="settings-group">
              <GroupHeading>{t('侧栏与工作区布局')}</GroupHeading>
              <div className="settings-card">
                <SettingsRow title={t('侧边栏布局')} detail={t('切换完整文字导航栏或紧凑图标侧栏，也可点击左上角折叠按钮随时切换')}>
                  <SegmentedControl
                    aria-label={t('侧边栏布局')}
                    size="small"
                    value={prefs.sidebarLayout}
                    onValueChange={sidebarLayout => updatePreferences({sidebarLayout})}
                    items={[
                      {value: 'classic', label: t('经典布局')},
                      {value: 'compact', label: t('紧凑图标')},
                    ]}
                  />
                </SettingsRow>
                <SettingsRow title={t('工作区表面风格')} detail={t('切换现代座舱纯净卡片风格或经典斜纹点阵装饰风格')}>
                  <SegmentedControl
                    aria-label={t('工作区表面风格')}
                    size="small"
                    value={prefs.surfaceStyle}
                    onValueChange={surfaceStyle => updatePreferences({surfaceStyle})}
                    items={[
                      {value: 'cockpit', label: t('座舱卡片')},
                      {value: 'hatched', label: t('经典斜纹')},
                    ]}
                  />
                </SettingsRow>
                <SettingsRow title={t('额度显示')} detail={t('切换身份工牌与概览栏中 5h / 7d 额度的主显示口径')}>
                  <SegmentedControl
                    aria-label={t('额度显示')}
                    size="small"
                    value={prefs.quotaDisplay}
                    onValueChange={quotaDisplay => updatePreferences({quotaDisplay})}
                    items={[
                      {value: 'remaining', label: t('剩余')},
                      {value: 'used', label: t('已用')},
                    ]}
                  />
                </SettingsRow>
                <SettingsRow title={t('账号邮箱隐私打码')} detail={t('隐藏邮箱中间字符（如 stu***@example.com），方便录制演示或截图分享')}>
                  <Switch aria-label={t('账号邮箱隐私打码')} checked={prefs.privacyMask} onCheckedChange={privacyMask => updatePreferences({privacyMask})} />
                </SettingsRow>
              </div>
            </section>
          </>
        )}

        {showAbout && (
          <section className="settings-group">
            <GroupHeading>{t('版本信息')}</GroupHeading>
            <div className="settings-card">
              <div className="settings-row settings-about-hero">
                <div className="settings-about-brand">
                  <img src={appLogo} width={44} height={44} alt="" draggable={false} />
                  <div>
                    <div className="settings-about-title-row">
                      <strong>{t('localEdition.brand')}</strong>
                      {version && <span className="settings-version-pill">v{version}</span>}
                      <span className="settings-meta-pill ok">{t('独立发行版')}</span>
                    </div>
                    <span>{t('identitySafety.productScope')}</span>
                    <span>{t('本地独立版不联网检查更新；新版本以安装包形式交付。')}</span>
                  </div>
                </div>
              </div>
              <SettingsRow title={t('恢复默认界面设置')} detail={t('将主题、强调色、侧边栏布局与动效偏好恢复为初始状态，不影响任何账号与保险库数据')}>
                <Button variant="ghost" size="small" onClick={() => resetPreferences()}>
                  {t('恢复默认')}
                </Button>
              </SettingsRow>
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
