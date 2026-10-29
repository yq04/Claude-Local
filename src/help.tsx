/**
 * [INPUT]: 共享 YAML 中英文目录与各页面的操作边界。
 * [OUTPUT]: 独立本地产品说明、环境优先配置顺序、新用户授权步骤与身份/浏览器/本地额度同步/网络/电脑操作说明和账号边界。
 * [POS]: 帮助与安全边界说明；沿用 Landing 排版和 Cromma Disclosure，不自动读取用户资料。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Disclosure } from 'cromma-ui';
import { useI18n } from './i18n';

export function HelpPanel() {
    const { t } = useI18n();
    const topics = [
        { title: t('identitySafety.environmentTitle'), lines: [t('identitySafety.environmentFirst')] },
        { title: t('新用户与添加新号'), lines: [
            t('第一步：在「身份管理」点击右上角「新身份」，系统会自动加密归档旧号并切入全新隔离环境。'),
            t('第二步：在内置浏览器（确认环境实测全部通过后）登录已充值的 Claude 网页版账号。'),
            t('identitySafety.cliAuthorization')
        ] },
        { title: t('身份管理'), lines: [
            t('暂存和切换会结束 Claude 进程，请先保存任务。'),
            t('登录随身份保存，其他资料由你选择保留或暂存。'),
            t('空身份留出新的本地工作区；永久删除无法恢复。')
        ] },
        { title: t('浏览环境'), lines: [
            t('先保存设置，再打开实测页。'),
            t('identitySafety.browserCacheHint'),
            t('清空站点数据会删除 Cookie 和会话，不留备份。')
        ] },
        { title: t('离线额度'), lines: [
            t('额度来自本地记录与最近一次服务端快照，可能延迟。'),
            t('identityCard.localQuotaGuide')
        ] },
        { title: t('网络诊断'), lines: [
            t('点击开始检测后，检查四个 Claude 服务域名的连通性。'),
            t('连接对端不是公网出口 IP；检测成功不代表账号可用。')
        ] },
        { title: t('风控验证'), lines: [
            t('help.riskLine1'),
            t('help.riskLine2'),
            t('help.riskLine3')
        ] },
        { title: t('电脑环境'), lines: [
            t('分别调整时区、语言和地区，不会改变公网 IP。'),
            t('系统可能要求授权、重启或重新登录。')
        ] },
        { title: t('排障与缓存清理'), lines: [
            t('identitySafety.troubleshootHelp')
        ] }
    ];
    return <section className="system-page help-page">
        <div className="cleanup-title"><h1>{t('使用说明')}</h1></div>
        <p className="help-scope">{t('Claude-Local 是独立维护的本地工具，用于管理本人的 Claude 身份、浏览器资料与离线额度。')}</p>
        <ol className="help-topics">{topics.map((topic, index) => <li className="help-row" key={index}>
            <div className="help-label"><span className="settings-group-bar" aria-hidden="true"/><h2>{topic.title}</h2></div>
            <div className="help-copy">{topic.lines.map(line => <p key={line}>{line}</p>)}</div>
        </li>)}</ol>
        <div className="landing-section-band" aria-hidden="true"/>
        <div className="help-notes">
            <Disclosure className="help-details" triggerClassName="help-details-trigger" summary={t('应用使用')}>
                <div className="help-copy">
                    <p>{t('关闭窗口后应用留在托盘；从托盘菜单退出应用。')}</p>
                    <p>{t('identitySafety.quickHelp')}</p>
                    <p>{t('主程序启动时不会自动打开浏览器；需要时从浏览环境页打开。')}</p>
                </div>
            </Disclosure>
            <Disclosure className="help-details" triggerClassName="help-details-trigger" summary={t('账号与数据')}>
                <div className="help-copy">
                    <p>{t('本地操作不删除服务端记录，也不保证匿名或账号可用。')}</p>
                    <p>{t('绿色结果仅表示本次已测项目匹配；DNS 和 WebRTC 需另行检查。')}</p>
                    <p>{t('账号使用仍须遵守 Anthropic 的条款和支持地区要求。')}</p>
                    <p>{t('密码、密钥和令牌不要放进公开日志或仓库。')}</p>
                </div>
            </Disclosure>
            <Disclosure className="help-details" triggerClassName="help-details-trigger" summary={t('账号受限怎么办')}>
                <ol className="help-appeal">
                    <li>{t('保存页面提示和相关工单。')}</li>
                    <li>{t('用受影响的账号登录 claude.ai，按页面指引申诉。')}</li>
                    <li>{t('如页面提供导出入口，可下载数据；不要绕过限制。')}</li>
                </ol>
            </Disclosure>
        </div>
    </section>;
}
