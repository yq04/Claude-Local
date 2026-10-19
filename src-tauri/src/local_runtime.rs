// [INPUT]: 本进程的启动参数，不读取配置、凭据或任意外部路径。
// [OUTPUT]: 配套浏览器仅在用户明确选择浏览器入口时启动。
// [POS]: Windows 本地产品启动策略；普通宿主启动不打开浏览器或访问核验服务。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
pub(crate) fn wants_browser(args: &[String]) -> bool {
    args.iter().skip(1).any(|argument| argument == "--browser")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn browser_requires_an_explicit_launch_request() {
        for arguments in [
            vec!["claude-local.exe"],
            vec!["claude-local.exe", "https://example.invalid"],
            vec!["claude-local.exe", "--browser=false"],
        ] {
            assert!(!wants_browser(
                &arguments.into_iter().map(String::from).collect::<Vec<_>>()
            ));
        }
        assert!(wants_browser(&[
            "claude-local.exe".into(),
            "--browser".into()
        ]));
    }
}
