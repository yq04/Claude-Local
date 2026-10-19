/**
 * [INPUT]: 共享 YAML 中英文目录与各页面的操作边界。
 * [OUTPUT]: 独立本地产品说明、身份/浏览器/额度/网络/电脑五项操作说明与折叠的应用使用和账号边界。
 * [POS]: 只读帮助页；沿用 Landing 细线排版和原生 details，不调用原生命令或读取用户数据。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useI18n } from './i18n';

export function HelpPanel() {
    const { t } = useI18n();
    const topics = [
        { title: t('Claude 身份管理'), lines: [
            t('暂存和切换会结束 Claude 进程，请先保存任务。'),
            t('登录随身份保存，其他资料由你选择保留或暂存。'),
            t('空身份留出新的本地工作区；永久删除无法恢复。')
        ] },
        { title: t('浏览器环境'), lines: [
            t('先保存设置，再打开实测页。'),
            t('缓存保留登录；换指纹会重启浏览器。'),
            t('清空站点数据会删除 Cookie 和会话，不留备份。')
        ] },
        { title: t('离线额度'), lines: [
            t('额度来自本地记录与最近一次服务端快照，可能延迟。'),
            t('额度每小时自动刷新，也可手动刷新；实际可用额度以服务为准。')
        ] },
        { title: t('网络诊断'), lines: [
            t('点击开始检测后，检查四个 Claude 服务域名的连通性。'),
            t('连接对端不是公网出口 IP；检测成功不代表账号可用。')
        ] },
        { title: t('电脑环境'), lines: [
            t('分别调整时区、语言和地区，不会改变公网 IP。'),
            t('系统可能要求授权、重启或重新登录。')
        ] }
    ];
    return <section className="system-page help-page">
        <div className="cleanup-title"><h1>{t('使用说明')}</h1></div>
        <p className="help-scope">{t('Claude-Local 是独立维护的本地工具，用于管理本人的 Claude 身份、浏览器资料与离线额度。')}</p>
        <ol className="help-topics">{topics.map((topic, index) => <li className="help-row" key={index}>
            <div className="help-label"><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><h2>{topic.title}</h2></div>
            <div className="help-copy">{topic.lines.map(line => <p key={line}>{line}</p>)}</div>
        </li>)}</ol>
        <div className="landing-section-band" aria-hidden="true"/>
        <div className="help-notes">
            <details className="help-details">
                <summary>{t('应用使用')}<span aria-hidden="true"/></summary>
                <div className="help-copy">
                    <p>{t('关闭窗口后应用留在托盘；从托盘菜单退出应用。')}</p>
                    <p>{t('快捷操作中可选择地区，再执行缓存、指纹或电脑设置操作。')}</p>
                    <p>{t('主程序启动时不会自动打开浏览器；需要时从浏览器环境页打开。')}</p>
                </div>
            </details>
            <details className="help-details">
                <summary>{t('账号与数据')}<span aria-hidden="true"/></summary>
                <div className="help-copy">
                    <p>{t('本地操作不删除服务端记录，也不保证匿名或账号可用。')}</p>
                    <p>{t('绿色结果仅表示本次已测项目匹配；DNS 和 WebRTC 需另行检查。')}</p>
                    <p>{t('账号使用仍须遵守 Anthropic 的条款和支持地区要求。')}</p>
                    <p>{t('密码、密钥和令牌不要放进公开日志或仓库。')}</p>
                </div>
            </details>
            <details className="help-details">
                <summary>{t('账号受限怎么办')}<span aria-hidden="true"/></summary>
                <ol className="help-appeal">
                    <li>{t('保存页面提示和相关工单。')}</li>
                    <li>{t('用受影响的账号登录 claude.ai，按页面指引申诉。')}</li>
                    <li>{t('如页面提供导出入口，可下载数据；不要绕过限制。')}</li>
                </ol>
            </details>
        </div>
    </section>;
}
