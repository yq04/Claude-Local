// [INPUT]: 已限定文件范围的完整清理快照、原子配置写入、实时进程复核与进度通道。
// [OUTPUT]: 文件删除与窄配置改写；预检失败零删除，执行中失败停止后续项目并报告已完成数量。
// [POS]: 文件残留与隔离样本回归共用引擎；拒绝钥匙串操作，身份归档仍由 identities/store.rs 编排。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use super::*;

#[cfg(unix)]
fn file_mode(meta: &fs::Metadata) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    meta.permissions().mode()
}
#[cfg(not(unix))]
fn file_mode(_meta: &fs::Metadata) -> u32 {
    0o600
}

pub(super) fn perform_items(
    root: &Path,
    items: &[Item],
    state: &Cleaner,
    check_running: impl Fn() -> Result<bool, String>,
    reporter: &Reporter,
) -> Result<CleanResult, String> {
    reporter.log(
        "validate",
        "running",
        "正在复核所选文件快照。",
        0,
        Some(items.len()),
    );
    for (index, item) in items.iter().enumerate() {
        if matches!(item.operation, Operation::Keychain(_)) {
            return Err("文件清理不支持钥匙串操作。".into());
        }
        identity(item, root)?;
        reporter.log(
            "validate",
            "running",
            "所选文件快照已复核。",
            index + 1,
            Some(items.len()),
        );
    }
    reporter.log(
        "validate",
        "ok",
        "快照核验通过，直接删除所选数据。",
        items.len(),
        Some(items.len()),
    );
    let mut cleaned = 0;
    let mut errors = Vec::new();
    for item in items {
        reporter.log(
            "clean",
            "running",
            &format!("正在清理：{}", item.title),
            cleaned,
            Some(items.len()),
        );
        let action = (|| -> Result<(), String> {
            if check_running()? {
                return Err("Claude 重新启动，已停止余下清理。".into());
            }
            identity(item, root)?;
            let path = Path::new(&item.path);
            match &item.operation {
                Operation::Delete => {
                    // 标准库目录删除不跟随符号链接；不经过废纸篓。
                    let result = if item.directory {
                        fs::remove_dir_all(path)
                    } else {
                        fs::remove_file(path)
                    };
                    result.map_err(|_| "直接删除失败；此项目可能部分删除，请重新扫描。".to_string())
                }
                Operation::Keychain(_) => Err("文件清理不支持钥匙串操作。".into()),
                Operation::Edit(kind) => {
                    let meta = fs::metadata(path).map_err(|_| "无法读取配置属性。")?;
                    let text = fs::read_to_string(path).map_err(|_| "无法读取配置。")?;
                    let (updated, names) = config::transform(&text, *kind)?;
                    if names != item.keys {
                        return Err("配置键发生变化，请重新扫描。".into());
                    }
                    identity(item, root)?;
                    file_io::atomic_write(path, updated.as_bytes(), file_mode(&meta))
                }
            }
        })();
        match action {
            Ok(()) => {
                cleaned += 1;
                reporter.log(
                    "clean",
                    "ok",
                    &format!("已清理：{}", item.title),
                    cleaned,
                    Some(items.len()),
                );
            }
            Err(error) => {
                let message = format!("{}：{error} 余下项目未执行。", item.title);
                reporter.log("clean", "error", &message, cleaned, Some(items.len()));
                errors.push(message);
                break;
            }
        }
    }
    *state.plan.lock().unwrap() = None;
    reporter.log(
        "clean",
        if errors.is_empty() { "ok" } else { "error" },
        &format!(
            "已清理 {cleaned}/{} 项；{}。",
            items.len(),
            if errors.is_empty() {
                "准备复查"
            } else {
                "后续清理已停止"
            }
        ),
        cleaned,
        Some(items.len()),
    );
    Ok(CleanResult {
        cleaned,
        completed: errors.is_empty(),
        errors,
    })
}
