/**
 * [INPUT]: Native browser-only warming views, IP region probe check results, independent runtime samples, dedicated warming activity state, privacy preferences and guarded parent actions.
 * [OUTPUT]: Shared card-count styling, four short steps, 166×286 cards with top-pill drag-to-reorder handle, horizontal spring wheel scrolling, region-drift hints, cross-machine anti-association handoff spec copy, inline warming activity log with dismiss support, pre-open IP region mismatch dialog, and editor SOP guidance.
 * [POS]: Free warming identity rail; subscriptions and CLI promotion reuse the identity panel's existing dialogs.
 * [PROTOCOL]: Update this header, src/CLAUDE.md and both locale catalogs when changing UI.
 */
import {useEffect, useState, type ReactNode} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {Button, Checkbox, Disclosure, Input, useReducedMotionConfig} from 'cromma-ui';
import {DropdownMenu} from 'radix-ui';
import {IdentityOperationProgress, type Activity} from './cleaner-activity';
import {AppDialog} from './dialog';
import {useI18n} from './i18n';
import {maskDisplayName, maskEmailAddress} from './settings-model';
import {isValidCalendarYmd} from './identity-online-quota';
import {
  createWarmingDraft,
  editWarmingDraft,
  localTodayYmd,
  warmingDays,
  warmingStageSopKey,
  warmingStages,
  type WarmingCard,
  type WarmingDraft,
  type WarmingFields,
  type WarmingOpenMode,
  type WarmingProbeCheckResult,
} from './warming-model';
import {browserRuntimeStatus, type BrowserRuntime} from './browser-runtime';
import {useCardRailReorder, useHorizontalRailWheelScroll, WARMING_CARD_ORDER_STORAGE_KEY} from './card-order';

type MismatchPrompt = {
  card: WarmingCard;
  mode: WarmingOpenMode;
  registeredCountry: string;
  currentCountry: string;
};
type Props = {
  cards: WarmingCard[]; blocked: boolean; promotionBlocked: boolean; busy: boolean; privacyMask: boolean; nowSec: number;
  runtime: BrowserRuntime | null;
  activity?: Activity | null;
  onModalChange: (open: boolean) => void;
  onOpen: (card: WarmingCard, mode: WarmingOpenMode) => Promise<boolean> | void;
  onProbeState?: (state: unknown) => void;
  onSave: (fields: WarmingFields, id: string | undefined, mode: WarmingOpenMode) => Promise<boolean>;
  onDelete: (card: WarmingCard, deleteBrowser: boolean) => Promise<boolean>;
  onPromote: (card: WarmingCard) => void; onExpiry: (card: WarmingCard) => void;
  renderName: (card: WarmingCard) => ReactNode;
};

export function WarmingLibrary({cards, runtime, activity, blocked, promotionBlocked, busy, privacyMask, nowSec, onModalChange, onOpen, onProbeState, onSave, onDelete, onPromote, onExpiry, renderName}: Props) {
  const {t, locale} = useI18n();
  const [editor, setEditor] = useState<WarmingDraft | null>(null);
  const [deletion, setDeletion] = useState<WarmingCard | null>(null);
  const [mismatchPrompt, setMismatchPrompt] = useState<MismatchPrompt | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false), [deleteBrowser, setDeleteBrowser] = useState(false), [formError, setFormError] = useState('');
  const [handoffNotice, setHandoffNotice] = useState('');
  const today = localTodayYmd(new Date(nowSec * 1000));
  const modalOpen = !!editor || !!deletion || !!mismatchPrompt;
  const reduceMotion = useReducedMotionConfig() ?? false;
  const warmingReorder = useCardRailReorder({
    storageKey: WARMING_CARD_ORDER_STORAGE_KEY,
    items: cards,
    getId: card => card.id,
    disabled: blocked || busy || modalOpen,
  });
  useHorizontalRailWheelScroll(warmingReorder.railRef, reduceMotion);
  useEffect(() => { onModalChange(modalOpen); return () => onModalChange(false); }, [modalOpen, onModalChange]);
  async function copyWarmingHandoffSpec(card: WarmingCard) {
    const shownLabel = maskDisplayName(card.name, card.email, privacyMask);
    const shownEmail = card.email ? maskEmailAddress(card.email, privacyMask) : t('warming.noEmail');
    const regionSpec = [
      card.registered_country || 'US',
      card.registered_timezone || 'America/Los_Angeles',
      'en-US',
    ].join(' · ');
    const expiryYmd = card.subscription_expiry_ymd || (locale === 'zh' ? '未设置' : 'Not set');
    const lines = locale === 'zh'
      ? [
          '### Claude-Local 跨机防关联环境交接卡 (养号工牌)',
          `- **养号工牌**: ${shownLabel} (${t(`warming.stage.${card.stage}`)}) · ${shownEmail}`,
          `- **固定指纹种子与槽位**: \`seed=#${String(card.seed).slice(-4)} (${card.seed})\` · \`slot=${card.slot}\``,
          `- **目标区域 / 时区 / 语言**: \`${regionSpec}\``,
          '- **推荐本地代理监听**: `socks5://127.0.0.1:7899` (独立住宅出口，CLI 不受影响)',
          `- **订阅到期日**: ${expiryYmd}`,
          '- **抗封铁律 (单机单活)**: 严禁两台设备同时打开同一养号浏览器槽位或并发登录；迁移前请先关闭源设备内置浏览器并保持住宅出口国家/时区一致。',
        ]
      : [
          '### Claude-Local Anti-Association Handoff Spec (Warming Card)',
          `- **Warming Card**: ${shownLabel} (${t(`warming.stage.${card.stage}`)}) · ${shownEmail}`,
          `- **Fingerprint Seed & Slot**: \`seed=#${String(card.seed).slice(-4)} (${card.seed})\` · \`slot=${card.slot}\``,
          `- **Target Region / Timezone / Locale**: \`${regionSpec}\``,
          '- **Recommended Local Proxy Listener**: `socks5://127.0.0.1:7899` (dedicated residential exit, CLI unaffected)',
          `- **Subscription Expiry**: ${expiryYmd}`,
          '- **Anti-Ban Rule (1-Device-at-a-Time)**: Never open the same warming browser slot on two machines simultaneously; close the companion browser on the source machine and match the registered country/timezone before opening on the target machine.',
        ];
    const text = lines.join('\n');
    try {
      await invoke('copy_result', {text});
      setHandoffNotice('warming.handoffSpecCopied');
    } catch {
      try {
        if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
        await navigator.clipboard.writeText(text);
        setHandoffNotice('warming.handoffSpecCopied');
      } catch {
        setHandoffNotice('warming.handoffSpecCopyFailed');
      }
    }
  }
  function edit(card?: WarmingCard) {
    setFormError('');
    setEditor(card ? editWarmingDraft(card) : createWarmingDraft(today));
  }
  async function requestOpen(card: WarmingCard, mode: WarmingOpenMode) {
    if (blocked || busy || checkingId) return;
    if (mode === 'switch_only') {
      await onOpen(card, mode);
      return;
    }
    if (!card.registered_country) {
      await onOpen(card, mode);
      const res = await invoke<WarmingProbeCheckResult>('identities_warming_probe_check', {id: card.id}).catch(() => null);
      if (res?.state) onProbeState?.(res.state);
      return;
    }
    setCheckingId(card.id);
    try {
      const res = await invoke<WarmingProbeCheckResult>('identities_warming_probe_check', {id: card.id}).catch(() => null);
      if (res?.state) onProbeState?.(res.state);
      if (res?.status === 'mismatch') {
        const regCountry = res.registered_country || card.registered_country || '-';
        const curCountry = res.current_country || '-';
        const regTz = res.registered_timezone || card.registered_timezone || '';
        const curTz = res.current_timezone || '';
        const showTz = regCountry === curCountry && Boolean(regTz || curTz);
        setMismatchPrompt({
          card,
          mode,
          registeredCountry: showTz && regTz ? `${regCountry} (${regTz})` : regCountry,
          currentCountry: showTz && curTz ? `${curCountry} (${curTz})` : curCountry,
        });
        return;
      }
      await onOpen(card, mode);
    } finally {
      setCheckingId(null);
    }
  }
  async function confirmUpdateRegionAndOpen() {
    if (!mismatchPrompt || busy || blocked) return;
    const {card, mode} = mismatchPrompt;
    setMismatchPrompt(null);
    const res = await invoke<WarmingProbeCheckResult>('identities_warming_probe_check', {id: card.id, lockCurrent: true}).catch(() => null);
    if (res?.state) onProbeState?.(res.state);
    await onOpen(card, mode);
  }
  async function save() {
    if (!editor || busy || blocked) return;
    if (!editor.name.trim() || !isValidCalendarYmd(editor.createdYmd)) { setFormError('warming.invalidFields'); return; }
    if (
      await onSave(
        {
          name: editor.name.trim(),
          email: editor.email.trim() || null,
          note: editor.note.trim() || null,
          stage: editor.stage,
          createdYmd: editor.createdYmd,
          ...(editor.id
            ? {
                registeredCountry: editor.registeredCountry.trim().toUpperCase(),
                registeredTimezone: editor.registeredTimezone.trim(),
              }
            : {}),
        },
        editor.id,
        editor.openMode,
      )
    ) setEditor(null);
    else setFormError('warming.operationFailed');
  }
  function patch<K extends keyof WarmingDraft>(key: K, value: WarmingDraft[K]) { setEditor(old => old ? {...old, [key]: value} : old); }
  return <section className="identity-library identity-warming-library" aria-label={t('warming.title')}>
    <div className="identity-section-head">
      <div className="identity-head-title"><h2>{t('warming.title')}</h2><span className="identity-policy-mode identity-card-count" data-card-count="warming">{t('warming.count', {v0: cards.length})}</span></div>
      <Button data-warming-create variant="secondary" size="small" disabled={blocked || busy || modalOpen} onClick={() => edit()}>{t('warming.create')}</Button>
    </div>
    <div className="identity-onboarding-bar"><div className="identity-onboarding-steps">
      <span className="identity-onboarding-badge">{t('warming.stepsTitle')}</span>
      {['create', 'configure', 'interact', 'promote'].map((step, index) => <span className="warming-step" key={step}>{index > 0 && <i aria-hidden="true">→</i>}<span className="identity-onboarding-chip">{t(`warming.step.${step}`)}</span></span>)}
    </div></div>
    {handoffNotice && <p className="identity-online-feedback identity-page-feedback" role="status" data-warming-handoff-notice><span>{t(handoffNotice)}</span><Button variant="ghost" size="small" type="button" onClick={() => setHandoffNotice('')}>{t('关闭记录')}</Button></p>}
    <div className="identity-card-rail" ref={warmingReorder.railRef} tabIndex={0} role="region" aria-label={t('warming.title')}>
      {warmingReorder.orderedItems.length === 0 && <p className="warming-empty">{t('warming.empty')}</p>}
      {warmingReorder.orderedItems.map(card => {
        const days = warmingDays(card.created_ymd, today), shownName = maskDisplayName(card.name, card.email, privacyMask);
        const runtimeStatus = browserRuntimeStatus(runtime, card.browser_active ? card.slot : null);
        const badge = card.browser_active ? `warming.browser${runtimeStatus === 'running' ? 'Running' : runtimeStatus === 'closed' ? 'Closed' : 'Unknown'}` : `warming.stage.${card.stage}`;
        const separator = locale === 'zh' ? '，' : ', ';
        const hasRegionDrift = Boolean(card.registered_country && card.last_probe_country && card.registered_country !== card.last_probe_country);
        const baseRegion = [card.region_summary?.replaceAll(' · ', separator) || t('warming.noRegion'), t(card.has_custom_proxy ? 'warming.customProxy' : 'warming.cliUnaffectedShort')].join(separator);
        const region = hasRegionDrift
          ? `${baseRegion}${separator}${t('identities.warming.regionDriftShort', {country: card.registered_country ?? ''})}`
          : baseRegion;
        const regionTitle = hasRegionDrift
          ? `${baseRegion}${separator}${t('identities.warming.regionDriftTitle', {registered: card.registered_country ?? '', current: card.last_probe_country ?? ''})}`
          : region;
        const isDragging = warmingReorder.draggingId === card.id;
        const dragStyle = isDragging
          ? {transform: `translate3d(${warmingReorder.dragOffsetX}px, -4px, 0) scale(1.025) rotate(${warmingReorder.dragTiltDeg}deg)`}
          : undefined;
        const menu = (action: string, label: string, run: () => void, danger = false, extraDisabled = false) => <DropdownMenu.Item className={`identity-menu-item${danger ? ' danger' : ''}`} data-warming-action={action} disabled={blocked || busy || extraDisabled} onSelect={run}>{t(label)}</DropdownMenu.Item>;
        return <article className={`identity-card warming-card${card.browser_active ? ' browser-selected' : ''}${runtimeStatus === 'running' ? ' browser-active' : ''}${card.stage === 'pro_ready' ? ' pro-ready' : ''}${isDragging ? ' is-dragging' : ''}`} key={card.id} data-reorder-card-id={card.id} data-warming-id={card.id} data-warming-stage={card.stage} data-browser-active={card.browser_active} data-browser-runtime={runtimeStatus} aria-label={shownName} style={dragStyle}>
          <div
            className="identity-card-drag-handle"
            data-card-drag-handle
            title={t('identityCard.dragReorderHint')}
            aria-label={t('identityCard.dragReorderHint')}
            tabIndex={0}
            onPointerDown={e => warmingReorder.startCardDrag(card.id, e)}
            onKeyDown={e => warmingReorder.handleCardKeyDown(card.id, e)}
          />
          <div className="identity-card-head">
            <div className="identity-avatar" aria-hidden="true">{Array.from(shownName)[0]?.toUpperCase()}</div>
            <span className="identity-live-badge" title={t(card.browser_active ? `${badge}Title` : `warming.stage.${card.stage}`)}>{t(badge)}</span>
            <DropdownMenu.Root><DropdownMenu.Trigger asChild><button type="button" className="identity-menu-trigger" disabled={blocked || busy} aria-label={t('warming.moreActions', {name: shownName})}>⋯</button></DropdownMenu.Trigger>
              <DropdownMenu.Portal><DropdownMenu.Content className="identity-menu-content" sideOffset={5} align="end">
                {menu('open', 'warming.openClaudeMenu', () => void requestOpen(card, 'claude_ai'))}
                {menu('verify', 'warming.openVerifyMenu', () => void requestOpen(card, 'verify'))}
                {menu('switch', 'warming.switchMenu', () => void requestOpen(card, 'switch_only'))}
                {menu('edit', 'warming.edit', () => edit(card))}
                {menu('expiry', 'warming.expiry', () => onExpiry(card))}
                {menu('copy-handoff', 'warming.copyHandoffSpec', () => void copyWarmingHandoffSpec(card))}
                {menu('promote', card.stage === 'pro_ready' ? 'warming.promote' : 'warming.promoteStageRequired', () => onPromote(card), false, promotionBlocked || card.stage !== 'pro_ready')}
                {menu('delete', 'warming.delete', () => {setDeletion(card); setAccepted(false); setDeleteBrowser(false); setFormError('');}, true)}
              </DropdownMenu.Content></DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
          {renderName(card)}
          <div className="identity-account identity-email-line saved"><span className="identity-email" title={card.email ? maskEmailAddress(card.email, privacyMask) : undefined}>{card.email ? maskEmailAddress(card.email, privacyMask) : t('warming.noEmail')}</span></div>
          <div className="identity-quota-stack">
            <div className="identity-quota-window warming-progress-window">
              <div className="identity-quota-copy"><strong title={t(`warming.stage.${card.stage}`)}>{t(`warming.stage.${card.stage}`)}</strong><span className="identity-quota-value">Day {days}</span></div>
              <span className="identity-quota-track" role="img" aria-label={t('warming.day', {v0: days})}><i style={{width: `${Math.min(100, Math.round(days / 7 * 100))}%`}} /></span>
              <div className="identity-quota-reset"><span className="identity-quota-reset-label" data-warming-today={card.last_warmed_ymd === today ? 'opened' : 'pending'}>{t(card.last_warmed_ymd === today ? 'warming.openedToday' : 'warming.pendingToday')}</span><time dateTime={card.created_ymd}>{card.created_ymd.slice(5).replace('-', '/')}</time></div>
            </div>
            <div className="identity-quota-window warming-environment-window">
              <div className="identity-quota-copy"><strong>{t('warming.fingerprint')}</strong><span className="identity-quota-value">#{String(card.seed).slice(-4)}</span></div>
              <span className="warming-region" data-region-drift={hasRegionDrift ? 'true' : undefined} title={regionTitle}>{region}</span>
              <span className="warming-note" title={privacyMask ? undefined : card.note || undefined}>{card.note ? privacyMask ? t('warming.hiddenNote') : card.note : t('warming.noNote')}</span>
            </div>
          </div>
          <div className="identity-card-footer"><Button variant="secondary" size="small" loading={checkingId === card.id} disabled={blocked || busy || checkingId === card.id} data-warming-open onClick={() => void requestOpen(card, card.stage === 'unregistered' ? 'verify' : 'claude_ai')}>{t(card.stage === 'unregistered' ? 'warming.verifyRegister' : 'warming.openClaude')}</Button></div>
        </article>;
      })}
    </div>
    {activity && <IdentityOperationProgress activity={activity} />}
    <AppDialog open={!!editor} onOpenChange={open => {if (!open && !busy) setEditor(null);}} title={t(editor?.id ? 'warming.edit' : 'warming.create')} description={t('warming.editorHint')} footer={<><Button variant="secondary" data-dialog-cancel disabled={busy} onClick={() => setEditor(null)}>{t('取消')}</Button><Button variant="secondary" disabled={busy || blocked || !editor?.name.trim()} onClick={() => void save()}>{t(editor?.id ? '保存' : 'warming.createConfirm')}</Button></>}>
      {editor && <div className="warming-editor">
        <label htmlFor="warming-name">{t('warming.name')}</label><Input id="warming-name" maxLength={64} value={editor.name} onChange={e => patch('name', e.target.value)} />
        <label htmlFor="warming-email">{t('warming.email')}</label><Input id="warming-email" type="email" maxLength={254} value={editor.email} onChange={e => patch('email', e.target.value)} />
        <label htmlFor="warming-note">{t('warming.note')}</label><Input id="warming-note" maxLength={80} value={editor.note} onChange={e => patch('note', e.target.value)} />
        <label htmlFor="warming-stage">{t('warming.stageLabel')}</label><select id="warming-stage" value={editor.stage} onChange={e => patch('stage', e.target.value as WarmingCard['stage'])}>{warmingStages.map(stage => <option key={stage} value={stage}>{t(`warming.stage.${stage}`)}</option>)}</select>
        <label htmlFor="warming-created">{t('warming.createdDate')}</label><input id="warming-created" type="date" value={editor.createdYmd} onChange={e => patch('createdYmd', e.target.value)} />
        {editor.id && <>
          <label htmlFor="warming-registered-country">{t('identities.warming.registeredCountry')}</label>
          <Input id="warming-registered-country" maxLength={16} placeholder="JP / US / SG" value={editor.registeredCountry} onChange={e => patch('registeredCountry', e.target.value)} />
          <label htmlFor="warming-registered-timezone">{t('identities.warming.registeredTimezone')}</label>
          <Input id="warming-registered-timezone" maxLength={64} placeholder="Asia/Tokyo" value={editor.registeredTimezone} onChange={e => patch('registeredTimezone', e.target.value)} />
        </>}
        {!editor.id && <><label htmlFor="warming-open-mode">{t('warming.afterCreate')}</label><select id="warming-open-mode" value={editor.openMode} onChange={e => patch('openMode', e.target.value as WarmingOpenMode)}><option value="switch_only">{t('warming.switchMenu')}</option><option value="verify">{t('warming.openVerifyMenu')}</option><option value="claude_ai">{t('warming.openClaudeMenu')}</option></select></>}
        <Disclosure className="warming-sop-disclosure" summary={t('identities.warming.sop.title')}>
          <div className="warming-sop-body" data-warming-sop={editor.stage}>
            <p>{t(warmingStageSopKey(editor.stage, warmingDays(editor.createdYmd, today)))}</p>
            <p className="warming-sop-disclaimer">{t('identities.warming.sop.disclaimer')}</p>
          </div>
        </Disclosure>
        {formError && <p role="alert" className="cleanup-feedback error">{t(formError)}</p>}
      </div>}
    </AppDialog>
    <AppDialog
      alert
      open={!!mismatchPrompt}
      onOpenChange={open => {if (!open && !busy) setMismatchPrompt(null);}}
      title={t('identities.warming.mismatchTitle')}
      description={mismatchPrompt ? t('identities.warming.mismatchBody', {registered: mismatchPrompt.registeredCountry, current: mismatchPrompt.currentCountry}) : ''}
      footer={<>
        <Button variant="secondary" data-dialog-cancel disabled={busy} onClick={() => setMismatchPrompt(null)}>{t('取消')}</Button>
        <Button variant="secondary" data-warming-mismatch-open-anyway disabled={busy || blocked} onClick={() => {
          if (!mismatchPrompt) return;
          const {card, mode} = mismatchPrompt;
          setMismatchPrompt(null);
          onOpen(card, mode);
        }}>{t('identities.warming.mismatchOpenAnyway')}</Button>
        <Button variant="secondary" data-warming-mismatch-update-open disabled={busy || blocked} onClick={() => void confirmUpdateRegionAndOpen()}>{t('identities.warming.mismatchUpdateAndOpen')}</Button>
      </>}
    >
      <div className="identity-confirm" data-warming-mismatch-dialog>
        <strong>{mismatchPrompt ? maskDisplayName(mismatchPrompt.card.name, mismatchPrompt.card.email, privacyMask) : ''}</strong>
        <p>{t('identities.warming.mismatchHint')}</p>
      </div>
    </AppDialog>
    <AppDialog alert className="identity-delete-alert" open={!!deletion} onOpenChange={open => {if (!open && !busy) setDeletion(null);}} title={t('warming.delete')} description={t('warming.deleteHint')} footer={<><Button variant="secondary" data-dialog-cancel disabled={busy} onClick={() => setDeletion(null)}>{t('取消')}</Button><Button variant="secondary" className="identity-delete-button" disabled={busy || blocked || !accepted} onClick={() => {if (deletion && accepted) void onDelete(deletion, deleteBrowser).then(ok => {if (ok) setDeletion(null); else setFormError('warming.operationFailed');});}}>{t('warming.deleteConfirm')}</Button></>}>
      <div className="identity-confirm"><strong>{deletion ? maskDisplayName(deletion.name, deletion.email, privacyMask) : ''}</strong><Checkbox checked={deleteBrowser} onCheckedChange={value => setDeleteBrowser(value === true)} label={t('warming.deleteBrowser')} /><Checkbox checked={accepted} onCheckedChange={value => setAccepted(value === true)} label={t('我知道此操作无法撤销')} />{formError && <p role="alert" className="cleanup-feedback error">{t(formError)}</p>}</div>
    </AppDialog>
  </section>;
}
