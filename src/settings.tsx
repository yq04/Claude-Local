/**
 * [INPUT]: 共享界面语言状态、宿主语言写入命令、Tauri 本机应用版本、settings-model 响应式视图偏好与主题预设、wallpaper-store 本地自定义壁纸与主色调提取引擎、身份备份组件与 Cromma UI 控件。
 * [OUTPUT]: 对齐 Cockpit Tools 悬浮胶囊分栏且四分页完全正交解耦的「软件设置」页面：通用（目录摘要+语言/默认页/额度口径/隐私打码/目录快捷操作）、外观与布局（一键主题预设/主题/6色强调色/表面玻璃化/艺术与自定义本地壁纸上传+主色调智能提取+五层光学毛玻璃3项无级滑块/减少动画+字体与排版预览+侧栏布局/界面缩放）、数据管理（独立资料目录+加密备份/恢复+界面偏好重置）与关于（只读版本信息与架构规格）。
 * [POS]: 独立设置面板；视图偏好与身份备份均由用户手动触发，不联网、不检查或安装更新、不替换当前身份库。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {useEffect, useRef, useState, type ChangeEvent, type ReactNode} from 'react';
import {Button, Select, SegmentedControl, Switch, Tabs} from 'cromma-ui';
import {ShieldCheck, FolderDefault, Settings01, Globe} from 'cromma-ui/pika';
import {getVersion} from '@tauri-apps/api/app';
import {invoke} from '@tauri-apps/api/core';
import appLogo from '../assets/claude-local-mark.svg';
import {useI18n, setLocale, type Locale} from './i18n';
import {
  applyThemePreset,
  resetPreferences,
  startSmoothTransition,
  THEME_PRESETS,
  UI_SCALES,
  updatePreferences,
  usePreferences,
  usePrivacySyncError,
  type AccentTone,
  type BackdropStyle,
  type FontFamily,
  type MonoFontFamily,
  type StartupPage,
  type ThemePresetId,
  type UiScale,
} from './settings-model';
import {clearCustomWallpaper, processWallpaperFile, useCustomWallpaper} from './wallpaper-store';
import {BackupPanel} from './backup-panel';
import type {Page} from './navigation';

type SettingsTab = 'general' | 'appearance' | 'data' | 'about';

const accents: readonly [AccentTone, string, string][] = [
  ['terracotta', '赤陶橙', '#c96442'],
  ['cockpit', '座舱蓝', '#2563eb'],
  ['emerald', '翡翠绿', '#059669'],
  ['violet', '星云紫', '#7c3aed'],
  ['rose', '暮光玫', '#e11d48'],
  ['amber', '琥珀金', '#d97706'],
];

const presetButtons: readonly [ThemePresetId, string, string][] = [
  ['parchment', 'settings.preset.parchment', '#c96442'],
  ['auroraGlass', 'settings.preset.auroraGlass', '#2563eb'],
  ['sunsetGlass', 'settings.preset.sunsetGlass', '#d97757'],
  ['duneGlass', 'settings.preset.duneGlass', '#d97706'],
  ['nebulaDark', 'settings.preset.nebulaDark', '#8b5cf6'],
];

const backdrops: readonly [BackdropStyle, string][] = [
  ['minimal', 'settings.backdrop.minimal'],
  ['aurora', 'settings.backdrop.aurora'],
  ['sunset', 'settings.backdrop.sunset'],
  ['ocean', 'settings.backdrop.ocean'],
  ['nebula', 'settings.backdrop.nebula'],
  ['dune', 'settings.backdrop.dune'],
  ['fuji', 'settings.backdrop.fuji'],
  ['custom', 'settings.backdrop.custom'],
];

const fontFamilies: readonly [FontFamily, string][] = [
  ['system', 'settings.font.system'],
  ['modern', 'settings.font.modern'],
  ['humanist', 'settings.font.humanist'],
  ['serif', 'settings.font.serif'],
];

const monoFonts: readonly [MonoFontFamily, string][] = [
  ['cascadia', 'settings.mono.cascadia'],
  ['jetbrains', 'settings.mono.jetbrains'],
  ['consolas', 'settings.mono.consolas'],
];

const startupOptions: readonly [StartupPage, string][] = [
  ['remember', 'settings.startupRemember'],
  ['cleaner', '身份管理'],
  ['quick', '快速配置'],
  ['browser', '浏览环境'],
  ['system', '电脑环境'],
  ['vps', '网络环境'],
  ['usage', 'usage.title'],
  ['help', '使用说明'],
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

export function SettingsPanel({onNavigate}: {onNavigate?: (page: Page) => void}) {
  const {t, locale} = useI18n();
  const prefs = usePreferences();
  const customWallpaper = useCustomWallpaper();
  const privacyError = usePrivacySyncError();
  const [tab, setTab] = useState<SettingsTab>('general');
  const [version, setVersion] = useState('');
  const [dataDir] = useState('%APPDATA%\\ai.local.claude-local');
  const [copiedPath, setCopiedPath] = useState(false);
  const [langBusy, setLangBusy] = useState(false);
  const [wallpaperBusy, setWallpaperBusy] = useState(false);
  const [error, setError] = useState('');
  const wallpaperInputRef = useRef<HTMLInputElement | null>(null);

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
      startSmoothTransition(() => setLocale(next));
    } catch (e) {
      setError(String(e));
    } finally {
      setLangBusy(false);
    }
  }

  async function openDataDir() {
    setError('');
    try {
      await invoke('identities_backup_open_location');
    } catch (e) {
      setError(String(e));
    }
  }

  async function copyDataDir() {
    setError('');
    try {
      await invoke('copy_result', {text: dataDir});
      setCopiedPath(true);
      window.setTimeout(() => setCopiedPath(false), 1800);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleWallpaperUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setWallpaperBusy(true);
    setError('');
    try {
      const record = await processWallpaperFile(file);
      startSmoothTransition(() => {
        updatePreferences({
          backdrop: 'custom',
          surfaceStyle: 'glass',
          accent: record.suggestedAccent,
        });
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWallpaperBusy(false);
    }
  }

  function handleClearWallpaper() {
    clearCustomWallpaper();
    if (prefs.backdrop === 'custom') {
      startSmoothTransition(() => updatePreferences({backdrop: 'aurora'}));
    }
  }

  const showDirectoryCard = tab === 'general' || tab === 'data';
  const showBackupForm = tab === 'data';
  const showGeneral = tab === 'general';
  const showAppearance = tab === 'appearance';
  const showAbout = tab === 'about';

  const generalRows = (
    <>
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
      <SettingsRow title={t('settings.startupPage')} detail={t('settings.startupPageDetail')}>
        <Select
          aria-label={t('settings.startupPage')}
          size="small"
          value={prefs.startupPage}
          onValueChange={v => updatePreferences({startupPage: v as StartupPage})}
          items={startupOptions.map(([val, labelKey]) => ({
            value: val,
            label: t(labelKey),
          }))}
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
      <SettingsRow title={t('settings.dataDirRow')} detail={t('settings.dataDirRowDetail')}>
        <Button variant="secondary" size="small" leftIcon={<FolderDefault size={14} />} onClick={() => void openDataDir()}>
          {t('settings.openFolderShort')}
        </Button>
        <Button variant="secondary" size="small" onClick={() => void copyDataDir()}>
          {t(copiedPath ? 'settings.copiedPath' : 'settings.copyPathShort')}
        </Button>
      </SettingsRow>
    </>
  );

  const appearanceRows = (
    <>
      <SettingsRow title={t('settings.themePresets')} detail={t('settings.themePresetsDetail')}>
        <div className="theme-preset-pills">
          {presetButtons.map(([presetId, labelKey, dotHex]) => {
            const preset = THEME_PRESETS[presetId];
            const active =
              prefs.theme === preset.theme &&
              prefs.accent === preset.accent &&
              prefs.surfaceStyle === preset.surfaceStyle &&
              prefs.backdrop === preset.backdrop;
            return (
              <button
                key={presetId}
                type="button"
                className={`theme-preset-btn${active ? ' active' : ''}`}
                aria-pressed={active}
                onClick={() => startSmoothTransition(() => applyThemePreset(presetId))}
              >
                <i className="accent-dot" style={{backgroundColor: dotHex}} aria-hidden="true" />
                <span>{t(labelKey)}</span>
              </button>
            );
          })}
        </div>
      </SettingsRow>
      <SettingsRow title={t('应用主题')} detail={t('切换浅色羊皮纸、深色曜石模式或跟随系统外观')}>
        <SegmentedControl
          aria-label={t('应用主题')}
          size="small"
          value={prefs.theme}
          onValueChange={theme => startSmoothTransition(() => updatePreferences({theme}))}
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
          onValueChange={accent => startSmoothTransition(() => updatePreferences({accent}))}
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
      <SettingsRow title={t('工作区表面风格')} detail={t('切换现代座舱纯净卡片风格或经典斜纹点阵装饰风格')}>
        <SegmentedControl
          aria-label={t('工作区表面风格')}
          size="small"
          value={prefs.surfaceStyle}
          onValueChange={surfaceStyle => startSmoothTransition(() => updatePreferences({surfaceStyle}))}
          items={[
            {value: 'cockpit', label: t('座舱卡片')},
            {value: 'glass', label: t('亚克力毛玻璃')},
            {value: 'hatched', label: t('经典斜纹')},
          ]}
        />
      </SettingsRow>
      <SettingsRow title={t('settings.backdrop')} detail={t('settings.backdropDetail')}>
        <Select
          aria-label={t('settings.backdrop')}
          size="small"
          value={prefs.backdrop}
          onValueChange={v => startSmoothTransition(() => updatePreferences({backdrop: v as BackdropStyle}))}
          items={backdrops.map(([val, labelKey]) => ({
            value: val,
            label: t(labelKey),
          }))}
        />
      </SettingsRow>
      <SettingsRow title={t('settings.customWallpaper')} detail={t('settings.customWallpaperDetail')}>
        <div className="custom-wallpaper-controls">
          <input
            ref={wallpaperInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            className="sr-only-input"
            aria-label={t('settings.uploadWallpaper')}
            onChange={e => void handleWallpaperUpload(e)}
          />
          {customWallpaper && (
            <div className="wallpaper-preview-chip" title={`${customWallpaper.width}×${customWallpaper.height}`}>
              <span
                className="wallpaper-thumb-preview"
                style={{backgroundImage: `url("${customWallpaper.dataUrl}")`}}
                aria-hidden="true"
              />
              <span className="wallpaper-resolution-label">{customWallpaper.width}×{customWallpaper.height}</span>
            </div>
          )}
          <Button
            variant="secondary"
            size="small"
            disabled={wallpaperBusy}
            onClick={() => wallpaperInputRef.current?.click()}
          >
            {t(wallpaperBusy ? 'settings.uploadingWallpaper' : 'settings.uploadWallpaper')}
          </Button>
          {customWallpaper && (
            <>
              <Button
                variant="secondary"
                size="small"
                onClick={() =>
                  startSmoothTransition(() =>
                    updatePreferences({
                      accent: customWallpaper.suggestedAccent,
                      backdrop: 'custom',
                      surfaceStyle: 'glass',
                    }),
                  )
                }
              >
                <i
                  className="accent-dot"
                  style={{
                    backgroundColor:
                      accents.find(a => a[0] === customWallpaper.suggestedAccent)?.[2] ?? '#c96442',
                  }}
                  aria-hidden="true"
                />
                <span>{t('settings.matchWallpaperAccent')}</span>
              </Button>
              <Button variant="ghost" size="small" onClick={handleClearWallpaper}>
                {t('settings.clearWallpaper')}
              </Button>
            </>
          )}
        </div>
      </SettingsRow>
      <SettingsRow title={t('减少动画')} detail={t('降低页面淡入、工牌悬浮倾斜、弹层过渡与弹簧滚动，仅保留必要加载反馈')}>
        <Switch aria-label={t('减少动画')} checked={prefs.reduceMotion} onCheckedChange={reduceMotion => updatePreferences({reduceMotion})} />
      </SettingsRow>
    </>
  );

  const glassStudioRows = (
    <>
      <SettingsRow title={t('settings.glassBlur')} detail={t('settings.glassBlurDetail')}>
        <div className="settings-slider-control">
          <input
            type="range"
            aria-label={t('settings.glassBlur')}
            className="settings-range-slider"
            min={8}
            max={40}
            step={1}
            value={prefs.glassBlur}
            onChange={e => updatePreferences({glassBlur: Number(e.target.value), surfaceStyle: 'glass'})}
          />
          <span className="settings-slider-value">{prefs.glassBlur}px</span>
        </div>
      </SettingsRow>
      <SettingsRow title={t('settings.glassOpacity')} detail={t('settings.glassOpacityDetail')}>
        <div className="settings-slider-control">
          <input
            type="range"
            aria-label={t('settings.glassOpacity')}
            className="settings-range-slider"
            min={45}
            max={92}
            step={1}
            value={prefs.glassOpacity}
            onChange={e => updatePreferences({glassOpacity: Number(e.target.value), surfaceStyle: 'glass'})}
          />
          <span className="settings-slider-value">{prefs.glassOpacity}%</span>
        </div>
      </SettingsRow>
      <SettingsRow title={t('settings.wallpaperDim')} detail={t('settings.wallpaperDimDetail')}>
        <div className="settings-slider-control">
          <input
            type="range"
            aria-label={t('settings.wallpaperDim')}
            className="settings-range-slider"
            min={0}
            max={65}
            step={1}
            value={prefs.wallpaperDim}
            onChange={e => updatePreferences({wallpaperDim: Number(e.target.value)})}
          />
          <span className="settings-slider-value">{prefs.wallpaperDim}%</span>
        </div>
      </SettingsRow>
    </>
  );

  const typographyRows = (
    <>
      <SettingsRow title={t('settings.fontFamily')} detail={t('settings.fontFamilyDetail')}>
        <Select
          aria-label={t('settings.fontFamily')}
          size="small"
          value={prefs.fontFamily}
          onValueChange={v => updatePreferences({fontFamily: v as FontFamily})}
          items={fontFamilies.map(([val, labelKey]) => ({
            value: val,
            label: t(labelKey),
          }))}
        />
      </SettingsRow>
      <SettingsRow title={t('settings.monoFont')} detail={t('settings.monoFontDetail')}>
        <Select
          aria-label={t('settings.monoFont')}
          size="small"
          value={prefs.monoFont}
          onValueChange={v => updatePreferences({monoFont: v as MonoFontFamily})}
          items={monoFonts.map(([val, labelKey]) => ({
            value: val,
            label: t(labelKey),
          }))}
        />
      </SettingsRow>
      <SettingsRow title={t('settings.fontPreview')} detail={t('settings.fontPreviewDetail')}>
        <div className="settings-font-preview">
          <span className="settings-font-preview-sans">{t('settings.fontPreviewSample')}</span>
          <code className="settings-font-preview-mono">claude --version · 2.1.304</code>
        </div>
      </SettingsRow>
    </>
  );

  const layoutRows = (
    <>
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
      <SettingsRow title={t('settings.uiScale')} detail={t('settings.uiScaleDetail')}>
        <Select
          aria-label={t('settings.uiScale')}
          size="small"
          value={String(prefs.uiScale)}
          onValueChange={v => updatePreferences({uiScale: Number(v) as UiScale})}
          items={UI_SCALES.map(scale => ({
            value: String(scale),
            label: `${scale}%`,
          }))}
        />
      </SettingsRow>
    </>
  );

  return (
    <section className="system-page settings-page">
      <header className="cleanup-title settings-header">
        <h1>{t('软件设置')}</h1>
        <Tabs
          aria-label={t('设置分类')}
          className="settings-tabs"
          itemClassName="settings-tab-item"
          value={tab}
          onValueChange={value => setTab(value as SettingsTab)}
          tabs={[
            {value: 'general', label: t('通用')},
            {value: 'appearance', label: t('外观与布局')},
            {value: 'data', label: t('数据管理')},
            {value: 'about', label: t('关于')},
          ]}
        />
      </header>
      {privacyError && <p className="system-feedback error" role="alert">{t(privacyError)}</p>}

      {error && (
        <p role="alert" className="system-feedback error">
          {t(error)}
        </p>
      )}

      <div key={tab} className="settings-sections settings-tab-panel">
        {showDirectoryCard && (
          <section className="settings-group">
            <GroupHeading>{t(tab === 'general' ? 'settings.backupAndVaultDir' : '独立资料与保险库目录')}</GroupHeading>
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
                <code className="settings-path-code">{dataDir}</code>
                <div className="settings-meta-pills">
                  <span className="settings-meta-pill ok">{t('BAGAID01 认证加密')}</span>
                  <span className="settings-meta-pill">{t('SQLite v3 索引')}</span>
                  <span className="settings-meta-pill">{t('identitySafety.historyPreserved')}</span>
                </div>
              </div>
              <div className="settings-directory-actions">
                <Button variant="secondary" size="small" leftIcon={<FolderDefault size={14} />} onClick={() => void openDataDir()}>
                  {t('settings.openDataDir')}
                </Button>
                {tab === 'general' && (
                  <Button variant="secondary" size="small" onClick={() => setTab('data')}>
                    {t('settings.manageBackup')}
                  </Button>
                )}
                {onNavigate && (
                  <Button variant="secondary" size="small" onClick={() => onNavigate('cleaner')}>
                    {t('前往身份保险库')}
                  </Button>
                )}
              </div>
            </div>
          </section>
        )}

        {showBackupForm && (
          <>
            <BackupPanel locale={locale} />
            <section className="settings-group">
              <GroupHeading>{t('settings.preferenceResetGroup')}</GroupHeading>
              <div className="settings-card">
                <SettingsRow title={t('恢复默认界面设置')} detail={t('将主题、强调色、侧边栏布局与动效偏好恢复为初始状态，不影响任何账号与保险库数据')}>
                  <Button variant="ghost" size="small" onClick={() => resetPreferences()}>
                    {t('恢复默认')}
                  </Button>
                </SettingsRow>
              </div>
            </section>
          </>
        )}

        {showGeneral && (
          <section className="settings-group">
            <GroupHeading>{t('settings.generalSection')}</GroupHeading>
            <div className="settings-card">
              {generalRows}
            </div>
          </section>
        )}

        {showAppearance && (
          <>
            <section className="settings-group">
              <GroupHeading>{t('外观与主题')}</GroupHeading>
              <div className="settings-card">{appearanceRows}</div>
            </section>
            <section className="settings-group">
              <GroupHeading>{t('settings.glassStudioSection')}</GroupHeading>
              <div className="settings-card">{glassStudioRows}</div>
            </section>
            <section className="settings-group">
              <GroupHeading>{t('settings.typographySection')}</GroupHeading>
              <div className="settings-card">{typographyRows}</div>
            </section>
            <section className="settings-group">
              <GroupHeading>{t('侧栏与工作区布局')}</GroupHeading>
              <div className="settings-card">{layoutRows}</div>
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
