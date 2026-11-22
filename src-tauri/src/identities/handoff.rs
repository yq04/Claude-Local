// [INPUT]: 只读 ~/.claude/{projects,todos,tasks,teams,plans,jobs}、Store 切换上下文与 <app_data_dir>/handoff/ 持久化目录。
// [OUTPUT]: 零配置扰动防封交接检查点（捕获只读 HandoffDraft 与至多 1200 字符会话进度摘要、硬防封脱敏防火墙剥离账号/组织/邮箱/UUID/路径/凭据/思考签名、结构化/有界横幅 429 识别免正文误报、可选 handoffReason 触发归因、原子提交 latest-handoff.{json,md} 与 subagent-outputs/sub-XX.md）、identities_latest_handoff 与 identities_dismiss_handoff 命令。
// [POS]: 身份切换后的跨账号断点续接与防封隔离防火墙；绝不写入 ~/.claude/settings.json 或 ~/.claude/projects/*.jsonl。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
use super::{private, profile};
use crate::cleaner;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashSet,
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

const HANDOFF_DIR: &str = "handoff";
const HANDOFF_OUTPUTS_DIR: &str = "subagent-outputs";
const HANDOFF_JSON_FILE: &str = "latest-handoff.json";
const HANDOFF_MD_FILE: &str = "latest-handoff.md";
pub(crate) const HANDOFF_TTL_SEC: u64 = 12 * 3600;
const MAX_JSONL_SESSIONS: usize = 3;
const MAX_ITEMS: usize = 12;
const MAX_HEAD_BYTES: usize = 16 * 1024;
const MAX_TAIL_BYTES: usize = 256 * 1024;
const MAX_AUX_FILE_BYTES: u64 = 64 * 1024;
const MAX_JSON_READ_BYTES: u64 = 256 * 1024;
const MAX_OUTPUT_CHARS: usize = 2048;
const MAX_TOTAL_OUTPUT_BYTES: usize = 24 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffItem {
    pub id: String,
    pub status: String,
    pub title: String,
    pub output_path: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffSummary {
    pub created_at_sec: u64,
    pub dismissed: bool,
    pub handoff_md_path: String,
    pub handoff_dir: String,
    pub session_count: usize,
    pub output_ready_count: usize,
    pub interrupted_count: usize,
    pub external_running_count: usize,
    pub copy_prompt: String,
    pub items: Vec<HandoffItem>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handoff_reason: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct HandoffDraftItem {
    pub id: String,
    pub status: String,
    pub title: String,
    pub instruction: String,
    pub output_body: Option<String>,
    pub touched_files: Vec<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct HandoffSessionBrief {
    pub label: String,
    pub goal: String,
    pub last_progress: String,
    pub touched_files: Vec<String>,
    pub rate_limited: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct HandoffDraft {
    pub created_at_sec: u64,
    pub sessions: Vec<HandoffSessionBrief>,
    pub context_notes: Vec<String>,
    pub items: Vec<HandoffDraftItem>,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct ScrubContext {
    home_variants: Vec<String>,
    exact_literals: Vec<String>,
    alias_literals: Vec<String>,
}

impl ScrubContext {
    pub(crate) fn from_home_and_metadata(
        home: &Path,
        extra_exact: &[String],
        extra_aliases: &[String],
    ) -> Self {
        let mut home_variants = Vec::new();
        let raw = home.to_string_lossy().trim_end_matches(['/', '\\']).to_string();
        if !raw.is_empty() {
            let fwd = raw.replace('\\', "/");
            let bwd = raw.replace('/', "\\");
            home_variants.push(fwd);
            if bwd != raw.replace('\\', "/") {
                home_variants.push(bwd);
            }
        }
        let mut exact_set = HashSet::new();
        for lit in extra_exact {
            let t = lit.trim();
            if t.len() >= 4 {
                exact_set.insert(t.to_string());
            }
        }
        let mut exact_literals: Vec<String> = exact_set.into_iter().collect();
        exact_literals.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.cmp(b)));

        let mut alias_set = HashSet::new();
        for alias in extra_aliases {
            let t = alias.trim();
            if t.chars().count() >= 3 {
                alias_set.insert(t.to_string());
            }
        }
        let mut alias_literals: Vec<String> = alias_set.into_iter().collect();
        alias_literals.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.cmp(b)));

        Self {
            home_variants,
            exact_literals,
            alias_literals,
        }
    }

    pub(crate) fn add_exact(&mut self, value: &str) {
        let t = value.trim();
        if t.len() >= 4 && !self.exact_literals.iter().any(|x| x == t) {
            self.exact_literals.push(t.to_string());
            self.exact_literals
                .sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.cmp(b)));
        }
    }
}

fn now_epoch_sec() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn file_mtime_sec(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn safe_regular_file(path: &Path, max_bytes: Option<u64>) -> Option<fs::Metadata> {
    let meta = fs::symlink_metadata(path).ok()?;
    if cleaner::linked(&meta) || !meta.is_file() {
        return None;
    }
    if let Some(limit) = max_bytes {
        if meta.len() > limit {
            return None;
        }
    }
    if private::safe(path).is_err() {
        return None;
    }
    Some(meta)
}

fn safe_dir(path: &Path) -> bool {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return false;
    };
    !cleaner::linked(&meta) && meta.is_dir() && private::safe(path).is_ok()
}

fn strip_system_reminder_blocks(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(start) = rest.find("<system-reminder>") {
        out.push_str(&rest[..start]);
        let after = &rest[start + "<system-reminder>".len()..];
        if let Some(end) = after.find("</system-reminder>") {
            let inner = &after[..end];
            if !inner.contains("email address") && !inner.contains('@') {
                // Even non-email reminders are internal prompt plumbing; strip cleanly.
            }
            rest = &after[end + "</system-reminder>".len()..];
        } else {
            rest = "";
            break;
        }
    }
    out.push_str(rest);
    let mut cleaned_lines = Vec::new();
    for line in out.lines() {
        if line.contains("The user's email address is ") {
            continue;
        }
        cleaned_lines.push(line);
    }
    cleaned_lines.join("\n")
}

fn replace_case_insensitive_ascii(haystack: &str, needle: &str, replacement: &str) -> String {
    if needle.is_empty() || haystack.len() < needle.len() {
        return haystack.to_string();
    }
    let h_lower = haystack.to_ascii_lowercase();
    let n_lower = needle.to_ascii_lowercase();
    if h_lower.len() != haystack.len() || n_lower.len() != needle.len() {
        return haystack.replace(needle, replacement);
    }
    let mut out = String::with_capacity(haystack.len());
    let mut pos = 0usize;
    while let Some(rel) = h_lower[pos..].find(&n_lower) {
        let idx = pos + rel;
        out.push_str(&haystack[pos..idx]);
        out.push_str(replacement);
        pos = idx + needle.len();
    }
    out.push_str(&haystack[pos..]);
    out
}

fn is_token_ident_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'-'
}

fn redact_prefixed_ids(input: &str, prefix: &str, replacement: &str) -> String {
    if !input.contains(prefix) {
        return input.to_string();
    }
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i..].starts_with(prefix.as_bytes())
            && (i == 0 || !bytes[i - 1].is_ascii_alphanumeric())
        {
            let mut end = i + prefix.len();
            while end < bytes.len() && is_token_ident_char(bytes[end]) {
                end += 1;
            }
            if end > i + prefix.len() {
                out.push_str(replacement);
                i = end;
                continue;
            }
        }
        let ch = input[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn redact_bearer_tokens(input: &str) -> String {
    let lower = input.to_ascii_lowercase();
    if !lower.contains("bearer ") {
        return input.to_string();
    }
    let bytes = input.as_bytes();
    let lower_bytes = lower.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut i = 0usize;
    while i < bytes.len() {
        if lower_bytes.len() == bytes.len()
            && lower_bytes[i..].starts_with(b"bearer ")
            && (i == 0 || !bytes[i - 1].is_ascii_alphanumeric())
        {
            let mut end = i + 7;
            while end < bytes.len()
                && (bytes[end].is_ascii_alphanumeric()
                    || matches!(bytes[end], b'.' | b'_' | b'-' | b'+' | b'/' | b'=' | b'~'))
            {
                end += 1;
            }
            if end > i + 7 {
                out.push_str("Bearer [redacted-token]");
                i = end;
                continue;
            }
        }
        let ch = input[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn is_b64url_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'-' || b == b'_'
}

fn redact_jwts(input: &str) -> String {
    if !input.contains("eyJ") {
        return input.to_string();
    }
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i..].starts_with(b"eyJ") && (i == 0 || !is_b64url_char(bytes[i - 1])) {
            let mut p1 = i + 3;
            while p1 < bytes.len() && is_b64url_char(bytes[p1]) {
                p1 += 1;
            }
            if p1 - i >= 8 && p1 < bytes.len() && bytes[p1] == b'.' {
                let s2 = p1 + 1;
                if bytes[s2..].starts_with(b"eyJ") {
                    let mut p2 = s2 + 3;
                    while p2 < bytes.len() && is_b64url_char(bytes[p2]) {
                        p2 += 1;
                    }
                    if p2 - s2 >= 8 && p2 < bytes.len() && bytes[p2] == b'.' {
                        let s3 = p2 + 1;
                        let mut p3 = s3;
                        while p3 < bytes.len() && is_b64url_char(bytes[p3]) {
                            p3 += 1;
                        }
                        if p3 - s3 >= 8 {
                            out.push_str("[redacted-jwt]");
                            i = p3;
                            continue;
                        }
                    }
                }
            }
        }
        let ch = input[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn is_uuid_bytes(slice: &[u8]) -> bool {
    if slice.len() != 36 {
        return false;
    }
    for (idx, &b) in slice.iter().enumerate() {
        if matches!(idx, 8 | 13 | 18 | 23) {
            if b != b'-' {
                return false;
            }
        } else if !b.is_ascii_hexdigit() {
            return false;
        }
    }
    true
}

fn redact_uuids(input: &str) -> String {
    if input.len() < 36 || !input.contains('-') {
        return input.to_string();
    }
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut i = 0usize;
    while i < bytes.len() {
        if i + 36 <= bytes.len()
            && is_uuid_bytes(&bytes[i..i + 36])
            && (i == 0 || !bytes[i - 1].is_ascii_hexdigit())
            && (i + 36 == bytes.len() || !bytes[i + 36].is_ascii_hexdigit())
        {
            out.push_str("[redacted-uuid]");
            i += 36;
            continue;
        }
        let ch = input[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn redact_hex64(input: &str) -> String {
    if input.len() < 64 {
        return input.to_string();
    }
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i].is_ascii_hexdigit() && (i == 0 || !bytes[i - 1].is_ascii_hexdigit()) {
            let mut end = i;
            while end < bytes.len() && bytes[end].is_ascii_hexdigit() {
                end += 1;
            }
            if end - i == 64 {
                out.push_str("[redacted-hex]");
                i = end;
                continue;
            }
        }
        let ch = input[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn is_email_local(b: u8) -> bool {
    b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'%' | b'+' | b'-')
}

fn is_email_domain(b: u8) -> bool {
    b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-')
}

fn redact_emails(input: &str) -> String {
    if !input.contains('@') {
        return input.to_string();
    }
    let bytes = input.as_bytes();
    let mut ranges: Vec<(usize, usize)> = Vec::new();
    for (at_idx, &b) in bytes.iter().enumerate() {
        if b != b'@' {
            continue;
        }
        let mut start = at_idx;
        while start > 0 && is_email_local(bytes[start - 1]) {
            start -= 1;
        }
        let mut end = at_idx + 1;
        while end < bytes.len() && is_email_domain(bytes[end]) {
            end += 1;
        }
        if start < at_idx && end > at_idx + 3 {
            let domain = &bytes[at_idx + 1..end];
            if let Some(dot_pos) = domain.iter().rposition(|&c| c == b'.') {
                let tld_len = domain.len() - dot_pos - 1;
                if dot_pos >= 1 && tld_len >= 2 && domain[dot_pos + 1..].iter().all(|c| c.is_ascii_alphabetic()) {
                    ranges.push((start, end));
                }
            }
        }
    }
    if ranges.is_empty() {
        return input.to_string();
    }
    let mut out = String::with_capacity(input.len());
    let mut cursor = 0usize;
    for (s, e) in ranges {
        if s < cursor {
            continue;
        }
        out.push_str(&input[cursor..s]);
        out.push_str("[redacted-email]");
        cursor = e;
    }
    out.push_str(&input[cursor..]);
    out
}

fn redact_claude_transcript_paths(input: &str, ctx: &ScrubContext) -> String {
    let mut out = input.to_string();
    for home in &ctx.home_variants {
        out = replace_case_insensitive_ascii(&out, home, "~");
    }
    // Strip any Windows/Unix workstation home prefix like C:\Users\Name\ or /Users/Name/ or /home/Name/
    out = redact_workstation_home_prefixes(&out);
    // Redact ~/.claude/projects/.../*.jsonl or .claude/projects/.../*.jsonl or cli-slots/.../*.jsonl
    for needle in [
        "~/.claude/projects/",
        "~\\.claude\\projects\\",
        ".claude/projects/",
        ".claude\\projects\\",
        "cli-slots/",
        "cli-slots\\",
    ] {
        while let Some(pos) = out.to_ascii_lowercase().find(&needle.to_ascii_lowercase()) {
            let tail = &out[pos..];
            let end = tail
                .find(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | ')' | ']' | '}' | ',' | ';' | '`'))
                .unwrap_or(tail.len());
            let segment = &out[pos..pos + end];
            let replacement = if segment.ends_with(".jsonl") || segment.contains("subagents") {
                "[redacted-transcript]"
            } else {
                "[redacted-claude-path]"
            };
            out.replace_range(pos..pos + end, replacement);
        }
    }
    out
}

fn redact_workstation_home_prefixes(input: &str) -> String {
    let mut out = input.to_string();
    for prefix in [":\\Users\\", ":/Users/", "/Users/", "/home/"] {
        let mut search_from = 0usize;
        while let Some(rel) = out[search_from..].find(prefix) {
            let idx = search_from + rel;
            let start = if prefix.starts_with(':') && idx >= 1 && out.as_bytes()[idx - 1].is_ascii_alphabetic() {
                idx - 1
            } else {
                idx
            };
            let after_prefix = idx + prefix.len();
            let user_len = out[after_prefix..]
                .find(|c: char| c == '/' || c == '\\' || c.is_whitespace() || matches!(c, '"' | '\'' | ',' | ';'))
                .unwrap_or(out[after_prefix..].len());
            if user_len > 0 && after_prefix + user_len <= out.len() {
                let end = after_prefix + user_len;
                out.replace_range(start..end, "~");
                search_from = start + 1;
            } else {
                search_from = after_prefix;
            }
        }
    }
    out
}

fn redact_json_field_values(input: &str) -> String {
    const SENSITIVE_KEYS: &[&str] = &[
        "accountUuid",
        "organizationUuid",
        "emailAddress",
        "userEmail",
        "sessionId",
        "agentId",
        "userID",
        "anonymousId",
        "machineID",
        "thinking",
        "signature",
        "accessToken",
        "refreshToken",
        "redacted_thinking",
        "pid",
        "ppid",
    ];
    let mut out = input.to_string();
    for key in SENSITIVE_KEYS {
        let pat_dq = format!("\"{key}\"");
        let mut search_from = 0usize;
        while let Some(rel) = out[search_from..].find(&pat_dq) {
            let key_pos = search_from + rel;
            let after_key = key_pos + pat_dq.len();
            let rest = &out[after_key..];
            let trimmed_ws = rest.len() - rest.trim_start().len();
            let after_ws = after_key + trimmed_ws;
            if out.as_bytes().get(after_ws) == Some(&b':') {
                let after_colon = after_ws + 1;
                let rest2 = &out[after_colon..];
                let ws2 = rest2.len() - rest2.trim_start().len();
                let val_start = after_colon + ws2;
                if out.as_bytes().get(val_start) == Some(&b'"') {
                    let mut val_end = val_start + 1;
                    let bytes = out.as_bytes();
                    let mut escaped = false;
                    while val_end < bytes.len() {
                        let b = bytes[val_end];
                        if escaped {
                            escaped = false;
                        } else if b == b'\\' {
                            escaped = true;
                        } else if b == b'"' {
                            break;
                        }
                        val_end += 1;
                    }
                    if val_end < bytes.len() && bytes[val_end] == b'"' {
                        out.replace_range(val_start + 1..val_end, "[redacted]");
                        search_from = val_start + 1 + "[redacted]".len() + 1;
                        continue;
                    }
                } else if (*key == "pid" || *key == "ppid")
                    && out
                        .as_bytes()
                        .get(val_start)
                        .is_some_and(u8::is_ascii_digit)
                {
                    let mut val_end = val_start;
                    let bytes = out.as_bytes();
                    while val_end < bytes.len() && bytes[val_end].is_ascii_digit() {
                        val_end += 1;
                    }
                    out.replace_range(val_start..val_end, "0");
                    search_from = val_start + 1;
                    continue;
                }
            }
            search_from = after_key;
        }
    }
    out
}

pub(crate) fn scrub_text(input: &str, ctx: &ScrubContext) -> String {
    if input.is_empty() {
        return String::new();
    }
    let mut s = strip_system_reminder_blocks(input);
    s = redact_json_field_values(&s);
    for lit in &ctx.exact_literals {
        s = replace_case_insensitive_ascii(&s, lit, "[redacted]");
    }
    for alias in &ctx.alias_literals {
        s = replace_case_insensitive_ascii(&s, alias, "[account]");
    }
    s = redact_claude_transcript_paths(&s, ctx);
    s = redact_prefixed_ids(&s, "sk-ant-", "[redacted-token]");
    s = redact_bearer_tokens(&s);
    s = redact_jwts(&s);
    for (prefix, repl) in [
        ("toolu_", "[redacted-id]"),
        ("msg_", "[redacted-id]"),
        ("req_", "[redacted-id]"),
        ("sig_", "[redacted-id]"),
        ("agent-", "[redacted-agent]"),
        ("claude-cli-v1-", "[redacted-device-id]"),
    ] {
        s = redact_prefixed_ids(&s, prefix, repl);
    }
    s = redact_uuids(&s);
    s = redact_hex64(&s);
    s = redact_emails(&s);
    s
}

fn scrub_single_line(input: &str, ctx: &ScrubContext, max_chars: usize) -> String {
    let scrubbed = scrub_text(input, ctx);
    let collapsed = scrubbed
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    truncate_chars(&collapsed, max_chars)
}

fn truncate_chars(s: &str, max_chars: usize) -> String {
    let trimmed = s.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    let mut out = String::new();
    for (idx, ch) in trimmed.chars().enumerate() {
        if idx >= max_chars.saturating_sub(1) {
            out.push('…');
            break;
        }
        out.push(ch);
    }
    out
}

fn read_bounded_head_tail(path: &Path) -> Option<Vec<String>> {
    let meta = safe_regular_file(path, None)?;
    let len = meta.len() as usize;
    if len == 0 {
        return Some(Vec::new());
    }
    let mut file = fs::File::open(path).ok()?;
    let mut lines = Vec::new();
    if len <= MAX_HEAD_BYTES + MAX_TAIL_BYTES {
        let mut buf = Vec::with_capacity(len);
        file.read_to_end(&mut buf).ok()?;
        let text = String::from_utf8_lossy(&buf);
        for line in text.lines() {
            if !line.trim().is_empty() {
                lines.push(line.to_string());
            }
        }
        return Some(lines);
    }
    let mut head = vec![0u8; MAX_HEAD_BYTES];
    let n_head = file.read(&mut head).ok()?;
    head.truncate(n_head);
    let head_text = String::from_utf8_lossy(&head);
    let mut head_lines: Vec<&str> = head_text.lines().collect();
    if !head_text.ends_with('\n') && head_lines.len() > 1 {
        head_lines.pop();
    }
    for line in head_lines {
        if !line.trim().is_empty() {
            lines.push(line.to_string());
        }
    }
    let tail_start = (len - MAX_TAIL_BYTES) as u64;
    if file.seek(SeekFrom::Start(tail_start)).is_ok() {
        let mut tail = Vec::with_capacity(MAX_TAIL_BYTES);
        if file.take(MAX_TAIL_BYTES as u64).read_to_end(&mut tail).is_ok() {
            let tail_text = String::from_utf8_lossy(&tail);
            let mut iter = tail_text.lines();
            let _ = iter.next(); // drop partial first line from mid-seek
            for line in iter {
                if !line.trim().is_empty() {
                    lines.push(line.to_string());
                }
            }
        }
    }
    Some(lines)
}

fn collect_relative_path_candidate(raw: &str, home: &Path, out: &mut Vec<String>) {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > 240 {
        return;
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.contains(".claude/projects")
        || lower.contains(".claude\\projects")
        || lower.contains("cli-slots")
        || lower.ends_with(".jsonl")
    {
        return;
    }
    let p = Path::new(trimmed);
    let normalized = if p.is_absolute() {
        if let Ok(rel) = p.strip_prefix(home) {
            rel.to_string_lossy().replace('\\', "/")
        } else if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
            name.to_string()
        } else {
            return;
        }
    } else {
        trimmed.replace('\\', "/")
    };
    if !normalized.is_empty() && !out.contains(&normalized) && out.len() < 12 {
        out.push(normalized);
    }
}

fn extract_visible_text_from_message(val: &Value) -> Option<String> {
    let content = val.pointer("/message/content").or_else(|| val.get("content"))?;
    if let Some(s) = content.as_str() {
        let t = s.trim();
        return (!t.is_empty()).then(|| t.to_string());
    }
    if let Some(arr) = content.as_array() {
        let mut parts = Vec::new();
        for item in arr {
            let kind = item.get("type").and_then(Value::as_str).unwrap_or("");
            if matches!(kind, "thinking" | "redacted_thinking") {
                continue;
            }
            if kind == "text" {
                if let Some(t) = item.get("text").and_then(Value::as_str) {
                    let trimmed = t.trim();
                    if !trimmed.is_empty() {
                        parts.push(trimmed.to_string());
                    }
                }
            }
        }
        if !parts.is_empty() {
            return Some(parts.join("\n"));
        }
    }
    None
}

fn is_rate_limit_banner(raw: &str) -> bool {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 400 {
        return false;
    }
    let normalized = trimmed
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();
    let prefixes = [
        "api error: 429",
        "api error : 429",
        "apierrorstatus: 429",
        "you've hit your limit",
        "you have hit your limit",
        "you've hit your 5-hour limit",
        "you have hit your 5-hour limit",
        "you've hit your weekly limit",
        "you have hit your weekly limit",
        "5-hour limit",
        "5h limit",
        "weekly limit",
        "usage limit reached",
        "session limit reached",
        "spend limit",
        "out of extra usage",
        "exceeded your current quota",
        "usage credits required",
        "rate_limit",
        "rate limit",
        "billing_error",
        "overloaded_error",
        "continuing automatically",
    ];
    prefixes.iter().any(|p| normalized.starts_with(p))
}

fn line_has_rate_limit(v: &Value) -> bool {
    if v.get("isApiErrorMessage").and_then(Value::as_bool) == Some(true)
        || v.get("apiErrorStatus").and_then(Value::as_u64) == Some(429)
        || v.get("error").and_then(Value::as_str).is_some_and(|e| {
            matches!(
                e,
                "rate_limit" | "rate_limit_error" | "billing_error" | "overloaded_error"
            )
        })
        || v.pointer("/error/type").and_then(Value::as_str).is_some_and(|e| {
            matches!(
                e,
                "rate_limit" | "rate_limit_error" | "billing_error" | "overloaded_error"
            )
        })
    {
        return true;
    }
    let kind = v.get("type").and_then(Value::as_str).unwrap_or("");
    if matches!(kind, "assistant" | "system") {
        if let Some(txt) = extract_visible_text_from_message(v) {
            if is_rate_limit_banner(&txt) {
                return true;
            }
        }
        if let Some(msg) = v.get("message").and_then(Value::as_str) {
            if is_rate_limit_banner(msg) {
                return true;
            }
        }
    } else if kind == "result" {
        if let Some(txt) = v.get("result").and_then(Value::as_str) {
            if is_rate_limit_banner(txt) {
                return true;
            }
        }
    }
    false
}

fn is_external_agent_type(agent_type: &str) -> bool {
    let lower = agent_type.to_ascii_lowercase();
    lower.contains("gemini")
        || lower.contains("gpt")
        || lower.contains("codex")
        || lower.contains("argon")
        || lower.contains("carbon")
        || lower.contains("hydrogen")
        || lower.contains("external")
        || lower.contains("agy")
}

fn collect_live_secrets_from_claude_json(home: &Path, ctx: &mut ScrubContext) {
    let cj = home.join(".claude.json");
    if safe_regular_file(&cj, Some(8 * 1024 * 1024)).is_none() {
        return;
    }
    let Ok(bytes) = fs::read(&cj) else {
        return;
    };
    let Ok(val) = serde_json::from_slice::<Value>(&bytes) else {
        return;
    };
    for key in ["userID", "anonymousId", "machineID"] {
        if let Some(s) = val.get(key).and_then(Value::as_str) {
            ctx.add_exact(s);
        }
    }
    if let Some(oauth) = val.get("oauthAccount").and_then(Value::as_object) {
        for key in ["accountUuid", "organizationUuid", "emailAddress", "displayName", "organizationName"] {
            if let Some(s) = oauth.get(key).and_then(Value::as_str) {
                ctx.add_exact(s);
            }
        }
    }
}

fn inspect_jsonl_lines(
    lines: &[String],
    home: &Path,
    ctx: &mut ScrubContext,
) -> (String, String, Vec<String>, bool, bool) {
    let mut first_user = String::new();
    let mut last_assistant = String::new();
    let mut last_progress = String::new();
    let mut touched_files = Vec::new();
    let mut saw_rate_limit = false;
    let mut saw_real_assistant_after_rl = false;

    for line in lines {
        let parsed = serde_json::from_str::<Value>(line).ok();
        if let Some(ref val) = parsed {
            for id_key in ["sessionId", "accountUuid", "organizationUuid", "agentId"] {
                if let Some(s) = val.get(id_key).and_then(Value::as_str) {
                    ctx.add_exact(s);
                }
            }
            if let Some(att) = val.get("attachment") {
                for id_key in ["organizationUuid", "accountUuid"] {
                    if let Some(s) = att.get(id_key).and_then(Value::as_str) {
                        ctx.add_exact(s);
                    }
                }
            }
        }
        let Some(val) = parsed else {
            continue;
        };
        let kind = val.get("type").and_then(Value::as_str).unwrap_or("");
        if matches!(
            kind,
            "api-request"
                | "api-request-shape"
                | "api-request-blob"
                | "bridge-session"
                | "session-owner"
        ) {
            continue;
        }
        if kind == "user" {
            if let Some(txt) = extract_visible_text_from_message(&val) {
                if first_user.is_empty() && !txt.contains("The user's email address is ") {
                    first_user = txt;
                }
            }
            continue;
        }
        let is_rl = line_has_rate_limit(&val);
        if is_rl {
            saw_rate_limit = true;
            saw_real_assistant_after_rl = false;
        }
        if kind == "assistant" {
            if let Some(arr) = val.pointer("/message/content").and_then(Value::as_array) {
                for item in arr {
                    if item.get("type").and_then(Value::as_str) == Some("tool_use") {
                        if let Some(fp) = item
                            .pointer("/input/file_path")
                            .or_else(|| item.pointer("/input/path"))
                            .and_then(Value::as_str)
                        {
                            collect_relative_path_candidate(fp, home, &mut touched_files);
                        }
                    }
                }
            }
            if !is_rl {
                if let Some(txt) = extract_visible_text_from_message(&val) {
                    last_assistant = txt.clone();
                    last_progress = txt;
                    if saw_rate_limit {
                        saw_real_assistant_after_rl = true;
                    }
                }
            }
        } else if kind == "result" && !is_rl {
            if let Some(txt) = val.get("result").and_then(Value::as_str) {
                if !txt.trim().is_empty() {
                    last_assistant = txt.trim().to_string();
                    last_progress = last_assistant.clone();
                    if saw_rate_limit {
                        saw_real_assistant_after_rl = true;
                    }
                }
            }
        }
    }
    let effective_rl = saw_rate_limit && !saw_real_assistant_after_rl;
    (
        first_user,
        if !last_assistant.is_empty() {
            last_assistant
        } else {
            last_progress
        },
        touched_files,
        effective_rl,
        saw_real_assistant_after_rl,
    )
}

fn scan_recent_sessions(home: &Path, now_sec: u64) -> Vec<(u64, PathBuf, PathBuf)> {
    let projects_dir = home.join(".claude/projects");
    if !safe_dir(&projects_dir) {
        return Vec::new();
    }
    let Ok(proj_entries) = fs::read_dir(&projects_dir) else {
        return Vec::new();
    };
    let mut found: Vec<(u64, PathBuf, PathBuf)> = Vec::new();
    for proj_entry in proj_entries.flatten() {
        let proj_path = proj_entry.path();
        if !safe_dir(&proj_path) {
            continue;
        }
        let Ok(entries) = fs::read_dir(&proj_path) else {
            continue;
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let Some(meta) = safe_regular_file(&p, None) else {
                continue;
            };
            let mtime = file_mtime_sec(&meta);
            if now_sec.saturating_sub(mtime) <= HANDOFF_TTL_SEC {
                found.push((mtime, proj_path.clone(), p));
            }
        }
    }
    found.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.2.cmp(&b.2)));
    found.truncate(MAX_JSONL_SESSIONS);
    found
}

fn collect_recent_aux_notes(home: &Path, now_sec: u64, ctx: &ScrubContext) -> Vec<String> {
    let mut notes = Vec::new();
    for (rel, label, ext) in [
        (".claude/plans", "Plan", "md"),
        (".claude/todos", "Todo", "json"),
        (".claude/tasks", "Task", "json"),
        (".claude/teams", "Team", "json"),
    ] {
        let dir = home.join(rel);
        if !safe_dir(&dir) {
            continue;
        }
        let mut files: Vec<(u64, PathBuf)> = Vec::new();
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if let Some(meta) = safe_regular_file(&p, Some(MAX_AUX_FILE_BYTES)) {
                if p.extension().and_then(|e| e.to_str()) == Some(ext) || ext == "json" {
                    let mtime = file_mtime_sec(&meta);
                    if now_sec.saturating_sub(mtime) <= HANDOFF_TTL_SEC {
                        files.push((mtime, p));
                    }
                }
            } else if safe_dir(&p) && notes.len() < 8 {
                if let Ok(sub_entries) = fs::read_dir(&p) {
                    for sub in sub_entries.flatten() {
                        let sp = sub.path();
                        if let Some(meta) = safe_regular_file(&sp, Some(MAX_AUX_FILE_BYTES)) {
                            let mtime = file_mtime_sec(&meta);
                            if now_sec.saturating_sub(mtime) <= HANDOFF_TTL_SEC {
                                files.push((mtime, sp));
                            }
                        }
                    }
                }
            }
        }
        files.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
        for (_, path) in files.into_iter().take(3) {
            if let Ok(raw) = fs::read_to_string(&path) {
                let snippet = scrub_single_line(&raw, ctx, 240);
                if !snippet.is_empty() && snippet != "[]" && snippet != "{}" {
                    notes.push(format!("{label}: {snippet}"));
                }
            }
        }
    }
    notes.truncate(8);
    notes
}

fn collect_adopt_job_items(
    home: &Path,
    ctx: &mut ScrubContext,
    next_idx: &mut usize,
    items: &mut Vec<HandoffDraftItem>,
) {
    let jobs_dir = home.join(".claude/jobs");
    if !safe_dir(&jobs_dir) {
        return;
    }
    let Ok(entries) = fs::read_dir(&jobs_dir) else {
        return;
    };
    let mut dirs: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
    dirs.sort();
    for job_dir in dirs {
        if items.len() >= MAX_ITEMS {
            break;
        }
        if !safe_dir(&job_dir) {
            continue;
        }
        let adopt_path = job_dir.join("adopt.json");
        if safe_regular_file(&adopt_path, Some(MAX_JSON_READ_BYTES)).is_none() {
            continue;
        }
        if !profile::job_dir_has_live_adopt(home, &job_dir) {
            continue;
        }
        let Ok(bytes) = fs::read(&adopt_path) else {
            continue;
        };
        let Ok(val) = serde_json::from_slice::<Value>(&bytes) else {
            continue;
        };
        if let Some(sid) = val.get("sessionId").and_then(Value::as_str) {
            ctx.add_exact(sid);
        }
        let mut desc_parts = Vec::new();
        if let Some(shells) = val.get("shells").and_then(Value::as_array) {
            for sh in shells {
                if let Some(cmd) = sh
                    .get("command")
                    .or_else(|| sh.get("label"))
                    .or_else(|| sh.get("description"))
                    .and_then(Value::as_str)
                {
                    let clean = scrub_single_line(cmd, ctx, 100);
                    if !clean.is_empty() {
                        desc_parts.push(clean);
                    }
                }
            }
        }
        if let Some(agents) = val.get("agents").and_then(Value::as_array) {
            for ag in agents {
                if let Some(aid) = ag.get("agentId").and_then(Value::as_str) {
                    ctx.add_exact(aid);
                }
                if let Some(desc) = ag
                    .get("description")
                    .or_else(|| ag.get("task"))
                    .or_else(|| ag.get("agentType"))
                    .and_then(Value::as_str)
                {
                    let clean = scrub_single_line(desc, ctx, 100);
                    if !clean.is_empty() {
                        desc_parts.push(clean);
                    }
                }
            }
        }
        let title = if desc_parts.is_empty() {
            "Detached background worker running".to_string()
        } else {
            truncate_chars(&desc_parts.join("; "), 120)
        };
        let id = format!("sub-{:02}", *next_idx);
        *next_idx += 1;
        items.push(HandoffDraftItem {
            id,
            status: "external_running".into(),
            title,
            instruction: "Monitor/collect result when detached background worker completes; do not spawn duplicate worker.".into(),
            output_body: None,
            touched_files: Vec::new(),
        });
    }
}

pub(crate) fn capture_handoff_draft(
    home: &Path,
    extra_exact: &[String],
    extra_aliases: &[String],
) -> Option<HandoffDraft> {
    let now_sec = now_epoch_sec();
    let mut ctx = ScrubContext::from_home_and_metadata(home, extra_exact, extra_aliases);
    collect_live_secrets_from_claude_json(home, &mut ctx);

    let recent_sessions = scan_recent_sessions(home, now_sec);
    let mut sessions = Vec::new();
    let mut items = Vec::new();
    let mut next_idx = 1usize;

    for (sess_idx, (_mtime, proj_path, jsonl_path)) in recent_sessions.iter().enumerate() {
        let Some(stem) = jsonl_path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(str::to_string)
        else {
            continue;
        };
        ctx.add_exact(&stem);

        let lines = read_bounded_head_tail(jsonl_path).unwrap_or_default();
        let (first_user, last_progress, touched_files, rate_limited, _) =
            inspect_jsonl_lines(&lines, home, &mut ctx);

        let goal = scrub_single_line(&first_user, &ctx, 220);
        let progress = scrub_single_line(&last_progress, &ctx, 1200);
        sessions.push(HandoffSessionBrief {
            label: format!("session-{:02}", sess_idx + 1),
            goal: if goal.is_empty() {
                "Active Claude Code session".into()
            } else {
                goal
            },
            last_progress: if progress.is_empty() {
                "No assistant summary captured".into()
            } else {
                progress
            },
            touched_files,
            rate_limited,
        });

        let subagents_dir = proj_path.join(&stem).join("subagents");
        if !safe_dir(&subagents_dir) {
            continue;
        }
        let Ok(sub_entries) = fs::read_dir(&subagents_dir) else {
            continue;
        };
        let mut sub_stems: HashSet<String> = HashSet::new();
        let mut sub_candidates: Vec<(u64, String)> = Vec::new();
        for entry in sub_entries.flatten() {
            let p = entry.path();
            let Some(name) = p.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            let candidate_stem = name
                .strip_suffix(".meta.json")
                .or_else(|| name.strip_suffix(".jsonl"));
            let Some(sub_stem) = candidate_stem else {
                continue;
            };
            if !sub_stems.insert(sub_stem.to_string()) {
                continue;
            }
            let mtime = safe_regular_file(&p, None)
                .map(|m| file_mtime_sec(&m))
                .unwrap_or(0);
            if now_sec.saturating_sub(mtime) <= HANDOFF_TTL_SEC {
                sub_candidates.push((mtime, sub_stem.to_string()));
            }
        }
        sub_candidates.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));

        for (_sub_mtime, sub_stem) in sub_candidates {
            if items.len() >= MAX_ITEMS {
                break;
            }
            ctx.add_exact(&sub_stem);
            if let Some(stripped) = sub_stem.strip_prefix("agent-") {
                ctx.add_exact(stripped);
            }
            let meta_path = subagents_dir.join(format!("{sub_stem}.meta.json"));
            let sub_jsonl_path = subagents_dir.join(format!("{sub_stem}.jsonl"));
            let meta_val = safe_regular_file(&meta_path, Some(MAX_JSON_READ_BYTES))
                .and_then(|_| fs::read(&meta_path).ok())
                .and_then(|b| serde_json::from_slice::<Value>(&b).ok());
            if let Some(ref mv) = meta_val {
                for id_key in ["agentId", "sessionId", "accountUuid", "organizationUuid"] {
                    if let Some(s) = mv.get(id_key).and_then(Value::as_str) {
                        ctx.add_exact(s);
                    }
                }
            }
            let sub_lines = read_bounded_head_tail(&sub_jsonl_path).unwrap_or_default();
            let (sub_goal, sub_last, sub_touched, sub_rl, _) =
                inspect_jsonl_lines(&sub_lines, home, &mut ctx);

            let agent_type = meta_val
                .as_ref()
                .and_then(|v| v.get("agentType"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let finished_opt = meta_val
                .as_ref()
                .and_then(|v| v.get("finished"))
                .and_then(Value::as_bool);
            let finished = finished_opt.unwrap_or(false);
            let meta_desc = meta_val
                .as_ref()
                .and_then(|v| {
                    v.get("description")
                        .or_else(|| v.get("task"))
                        .or_else(|| v.get("title"))
                })
                .and_then(Value::as_str)
                .unwrap_or("");
            let raw_title = if !meta_desc.trim().is_empty() {
                meta_desc
            } else if !sub_goal.is_empty() {
                &sub_goal
            } else if !agent_type.is_empty() {
                agent_type
            } else {
                "Subagent task"
            };
            let title = scrub_single_line(raw_title, &ctx, 120);
            let clean_output = scrub_text(&sub_last, &ctx).trim().to_string();

            let external = is_external_agent_type(agent_type);
            let has_output = !clean_output.is_empty();
            let (status, instruction, output_body) = if (finished
                || (finished_opt.is_none() && external))
                && has_output
                && !sub_rl
            {
                let body = truncate_chars(&clean_output, MAX_OUTPUT_CHARS);
                (
                    "output_ready".to_string(),
                    "Read subagent output file directly; DO NOT re-run external agent.".to_string(),
                    Some(body),
                )
            } else if sub_rl || rate_limited {
                (
                    "interrupted_429".to_string(),
                    "Spawn a fresh independent subagent (or pro-pool-worker); NEVER call Agent(resume:).".to_string(),
                    None,
                )
            } else if finished_opt == Some(false) || !finished {
                (
                    "incomplete".to_string(),
                    "Spawn a fresh independent subagent (or pro-pool-worker); NEVER call Agent(resume:).".to_string(),
                    None,
                )
            } else if has_output {
                let body = truncate_chars(&clean_output, MAX_OUTPUT_CHARS);
                (
                    "output_ready".to_string(),
                    "Read subagent output file directly; DO NOT re-run external agent.".to_string(),
                    Some(body),
                )
            } else {
                (
                    "incomplete".to_string(),
                    "Spawn a fresh independent subagent (or pro-pool-worker); NEVER call Agent(resume:).".to_string(),
                    None,
                )
            };

            let id = format!("sub-{:02}", next_idx);
            next_idx += 1;
            items.push(HandoffDraftItem {
                id,
                status,
                title: if title.is_empty() {
                    "Subagent task".into()
                } else {
                    title
                },
                instruction,
                output_body,
                touched_files: sub_touched,
            });
        }
    }

    collect_adopt_job_items(home, &mut ctx, &mut next_idx, &mut items);
    let context_notes = collect_recent_aux_notes(home, now_sec, &ctx);

    Some(HandoffDraft {
        created_at_sec: now_sec,
        sessions,
        context_notes,
        items,
    })
}

fn clear_stale_subagent_outputs(outputs_dir: &Path) -> Result<(), String> {
    if !outputs_dir.exists() {
        return Ok(());
    }
    private::safe(outputs_dir)?;
    let entries = fs::read_dir(outputs_dir).map_err(|_| "无法清理旧的交接子代理输出。")?;
    for entry in entries.flatten() {
        let p = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with("sub-") && name.ends_with(".md") {
            private::safe(&p)?;
            let meta = fs::symlink_metadata(&p).map_err(|_| "无法检查交接输出文件。")?;
            if meta.is_file() {
                crate::cleaner::file_io::remove_file_retry(&p)
                    .map_err(|_| "无法移除旧的交接输出文件。")?;
            }
        }
    }
    Ok(())
}

pub(crate) fn commit_handoff_draft(
    app_data_dir: &Path,
    draft: &HandoffDraft,
) -> Result<(PathBuf, PathBuf), String> {
    let handoff_dir = app_data_dir.join(HANDOFF_DIR);
    let outputs_dir = handoff_dir.join(HANDOFF_OUTPUTS_DIR);
    private::directory(&handoff_dir)?;
    private::directory(&outputs_dir)?;
    clear_stale_subagent_outputs(&outputs_dir)?;

    let mut total_output_bytes = 0usize;
    let mut summary_items = Vec::with_capacity(draft.items.len());
    let mut output_ready_count = 0usize;
    let mut interrupted_count = 0usize;
    let mut external_running_count = 0usize;

    for item in &draft.items {
        let mut output_path = None;
        if item.status == "output_ready" {
            output_ready_count += 1;
            if let Some(ref body) = item.output_body {
                let capped_body = truncate_chars(body, MAX_OUTPUT_CHARS);
                let md_content = format!(
                    "# {}\n\n- Status: `{}`\n- Task: {}\n- Instruction: {}\n\n{}\n",
                    item.id, item.status, item.title, item.instruction, capped_body
                );
                let bytes = md_content.as_bytes();
                if total_output_bytes.saturating_add(bytes.len()) <= MAX_TOTAL_OUTPUT_BYTES {
                    let out_file = outputs_dir.join(format!("{}.md", item.id));
                    private::write(&out_file, bytes)?;
                    total_output_bytes += bytes.len();
                    output_path = Some(out_file.to_string_lossy().into_owned());
                }
            }
        } else if matches!(item.status.as_str(), "interrupted_429" | "incomplete") {
            interrupted_count += 1;
        } else if item.status == "external_running" {
            external_running_count += 1;
        }
        summary_items.push(HandoffItem {
            id: item.id.clone(),
            status: item.status.clone(),
            title: item.title.clone(),
            output_path,
        });
    }

    let md_path = handoff_dir.join(HANDOFF_MD_FILE);
    let json_path = handoff_dir.join(HANDOFF_JSON_FILE);

    let mut md = String::new();
    md.push_str("# Account Switch Handoff Checkpoint\n\n");
    md.push_str(&format!(
        "- CreatedAtSec: `{}`\n- SessionsCaptured: `{}`\n- OutputReady: `{}`\n- InterruptedOrIncomplete: `{}`\n- ExternalRunning: `{}`\n\n",
        draft.created_at_sec,
        draft.sessions.len(),
        output_ready_count,
        interrupted_count,
        external_running_count
    ));
    md.push_str("## Anti-Ban Rules\n\n");
    md.push_str("- NEVER call `Agent(resume:)` on a pre-switch subagent or foreign account session.\n");
    md.push_str("- For `output_ready` items, read the listed `sub-XX.md` file directly and DO NOT re-run external agents.\n");
    md.push_str("- For `interrupted_429` or `incomplete` items, spawn a fresh independent subagent (or `pro-pool-worker`).\n\n");

    if !draft.sessions.is_empty() {
        md.push_str("## Recent Sessions\n\n");
        for sess in &draft.sessions {
            md.push_str(&format!("### {}\n", sess.label));
            md.push_str(&format!("- Goal: {}\n", sess.goal));
            md.push_str(&format!("- LastProgress: {}\n", sess.last_progress));
            if sess.rate_limited {
                md.push_str("- RateLimited: `true`\n");
            }
            if !sess.touched_files.is_empty() {
                md.push_str(&format!(
                    "- TouchedFiles: {}\n",
                    sess.touched_files.join(", ")
                ));
            }
            md.push('\n');
        }
    }

    if !draft.items.is_empty() {
        md.push_str("## Worker Items\n\n");
        for (idx, item) in draft.items.iter().enumerate() {
            md.push_str(&format!(
                "### {} (`{}`) — {}\n",
                item.id, item.status, item.title
            ));
            md.push_str(&format!("- Instruction: {}\n", item.instruction));
            if let Some(ref path_str) = summary_items[idx].output_path {
                md.push_str(&format!("- OutputFile: `{path_str}`\n"));
            }
            if !item.touched_files.is_empty() {
                md.push_str(&format!(
                    "- TouchedFiles: {}\n",
                    item.touched_files.join(", ")
                ));
            }
            md.push('\n');
        }
    }

    if !draft.context_notes.is_empty() {
        md.push_str("## Workspace Notes\n\n");
        for note in &draft.context_notes {
            md.push_str(&format!("- {note}\n"));
        }
        md.push('\n');
    }

    private::write(&md_path, md.as_bytes())?;

    let md_path_str = md_path.to_string_lossy().into_owned();
    let handoff_dir_str = handoff_dir.to_string_lossy().into_owned();
    let copy_prompt = format!(
        "Read the clean account-switch handoff checkpoint at `{md_path_str}` and continue from there. \
For any `output_ready` item, read its `subagent-outputs/sub-XX.md` directly and do NOT re-run external agents. \
For any `interrupted_429` or `incomplete` item, spawn a fresh independent subagent (or `pro-pool-worker`) without calling `Agent(resume:)`."
    );

    let summary = HandoffSummary {
        created_at_sec: draft.created_at_sec,
        dismissed: false,
        handoff_md_path: md_path_str,
        handoff_dir: handoff_dir_str,
        session_count: draft.sessions.len(),
        output_ready_count,
        interrupted_count,
        external_running_count,
        copy_prompt,
        items: summary_items,
        handoff_reason: None,
    };

    let json_bytes = serde_json::to_vec_pretty(&summary)
        .map_err(|_| "无法序列化交接摘要。".to_string())?;
    private::write(&json_path, &json_bytes)?;

    Ok((md_path, json_path))
}

pub(crate) fn set_handoff_reason_in(app_data_dir: &Path, reason: &str) -> Result<(), String> {
    let clean = reason.trim();
    if clean.is_empty()
        || clean.len() > 64
        || !clean
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'))
    {
        return Ok(());
    }
    let handoff_dir = app_data_dir.join(HANDOFF_DIR);
    let json_path = handoff_dir.join(HANDOFF_JSON_FILE);
    let meta = match fs::symlink_metadata(&json_path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err("无法读取交接状态。".into()),
    };
    if cleaner::linked(&meta) || !meta.is_file() || meta.len() > MAX_JSON_READ_BYTES {
        return Err("交接文件状态异常。".into());
    }
    private::parents(&handoff_dir)?;
    private::safe(&handoff_dir)?;
    private::safe(&json_path)?;
    let bytes = crate::cleaner::file_io::read_bytes_retry(&json_path)
        .map_err(|_| "无法读取交接摘要。".to_string())?;
    let Ok(mut summary) = serde_json::from_slice::<HandoffSummary>(&bytes) else {
        return Ok(());
    };
    summary.handoff_reason = Some(clean.to_string());
    let updated = serde_json::to_vec_pretty(&summary)
        .map_err(|_| "无法更新交接摘要。".to_string())?;
    private::write(&json_path, &updated)?;
    Ok(())
}

pub(crate) fn latest_handoff_in(
    app_data_dir: &Path,
    now_sec: u64,
) -> Result<Option<HandoffSummary>, String> {
    let handoff_dir = app_data_dir.join(HANDOFF_DIR);
    let json_path = handoff_dir.join(HANDOFF_JSON_FILE);
    let meta = match fs::symlink_metadata(&json_path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("无法读取交接状态。".into()),
    };
    if cleaner::linked(&meta) || !meta.is_file() || meta.len() > MAX_JSON_READ_BYTES {
        return Err("交接文件状态异常。".into());
    }
    private::parents(&handoff_dir)?;
    private::safe(&handoff_dir)?;
    private::safe(&json_path)?;
    let bytes = crate::cleaner::file_io::read_bytes_retry(&json_path)
        .map_err(|_| "无法读取交接摘要。".to_string())?;
    let Ok(summary) = serde_json::from_slice::<HandoffSummary>(&bytes) else {
        return Ok(None);
    };
    if summary.dismissed || now_sec.saturating_sub(summary.created_at_sec) > HANDOFF_TTL_SEC {
        return Ok(None);
    }
    Ok(Some(summary))
}

pub(crate) fn dismiss_handoff_in(app_data_dir: &Path) -> Result<(), String> {
    let handoff_dir = app_data_dir.join(HANDOFF_DIR);
    let json_path = handoff_dir.join(HANDOFF_JSON_FILE);
    let meta = match fs::symlink_metadata(&json_path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err("无法读取交接状态。".into()),
    };
    if cleaner::linked(&meta) || !meta.is_file() || meta.len() > MAX_JSON_READ_BYTES {
        return Err("交接文件状态异常。".into());
    }
    private::parents(&handoff_dir)?;
    private::safe(&handoff_dir)?;
    private::safe(&json_path)?;
    let bytes = crate::cleaner::file_io::read_bytes_retry(&json_path)
        .map_err(|_| "无法读取交接摘要。".to_string())?;
    let Ok(mut summary) = serde_json::from_slice::<HandoffSummary>(&bytes) else {
        return Ok(());
    };
    if !summary.dismissed {
        summary.dismissed = true;
        let updated = serde_json::to_vec_pretty(&summary)
            .map_err(|_| "无法更新交接摘要。".to_string())?;
        private::write(&json_path, &updated)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn identities_latest_handoff(
    app: tauri::AppHandle,
) -> Result<Option<HandoffSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let app_dir = app
            .path()
            .app_data_dir()
            .map_err(|_| "身份保险库无法定位。".to_string())?;
        latest_handoff_in(&app_dir, now_epoch_sec())
    })
    .await
    .map_err(|_| "交接摘要读取被中断。".to_string())?
}

#[tauri::command]
pub async fn identities_dismiss_handoff(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let app_dir = app
            .path()
            .app_data_dir()
            .map_err(|_| "身份保险库无法定位。".to_string())?;
        dismiss_handoff_in(&app_dir)
    })
    .await
    .map_err(|_| "交接摘要关闭被中断。".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct TempHandoffFixture {
        root: PathBuf,
        app_data: PathBuf,
        home: PathBuf,
    }

    impl TempHandoffFixture {
        fn new(tag: &str) -> Self {
            let base = dunce::canonicalize(std::env::temp_dir()).unwrap();
            let unique = format!(
                "cl-handoff-{tag}-{}-{}",
                std::process::id(),
                super::super::new_id().unwrap()
            );
            let root = base.join(unique);
            let app_data = root.join("app_data");
            let home = root.join("home");
            private::directory(&app_data).unwrap();
            private::directory(&home.join(".claude")).unwrap();
            Self {
                root,
                app_data,
                home,
            }
        }

        fn write(&self, rel: &str, bytes: &[u8]) {
            let p = self.home.join(rel);
            if let Some(parent) = p.parent() {
                private::directory(parent).unwrap();
            }
            private::write(&p, bytes).unwrap();
        }
    }

    impl Drop for TempHandoffFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn antiban_firewall_scrubs_all_identifiers_secrets_and_paths() {
        let fx = TempHandoffFixture::new("scrub");
        let ctx = ScrubContext::from_home_and_metadata(
            &fx.home,
            &[
                "acct-uuid-secret".into(),
                "org-uuid-secret".into(),
                "alice@example.invalid".into(),
            ],
            &["AccountAlpha".into(), "OrgDisplayAlias".into()],
        );
        let raw = concat!(
            "<system-reminder>\nThe user's email address is alice@example.invalid. Use it only.\n</system-reminder>\n",
            "User AccountAlpha in OrgDisplayAlias (bob@example.invalid) had ",
            "accountUuid: \"acct-uuid-secret\", organizationUuid: \"org-uuid-secret\", ",
            "session 11111111-2222-4333-8444-555555555555, agent-abc123def, ",
            "toolu_01XYZ, msg_02ABC, req_03DEF, sig_04GHI, ",
            "\"userID\":\"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\", ",
            "\"anonymousId\":\"claude-cli-v1-11111111-2222-4333-8444-555555555555\", ",
            "\"machineID\":\"abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789\", ",
            "\"thinking\":\"hidden-cot\",\"signature\":\"sig-secret-abc\", ",
            "token sk-ant-api03-secretvalue123, Bearer secret_bearer_tok, ",
            "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3OCJ9.sigpart12345678, ",
            "transcript ~/.claude/projects/demo-proj/11111111-2222-4333-8444-555555555555.jsonl, ",
            "workstation C:\\Users\\FakeTester\\repo\\file.rs"
        );
        let cleaned = scrub_text(raw, &ctx);
        for forbidden in [
            "alice@example.invalid",
            "bob@example.invalid",
            "acct-uuid-secret",
            "org-uuid-secret",
            "AccountAlpha",
            "OrgDisplayAlias",
            "11111111-2222-4333-8444-555555555555",
            "agent-abc123def",
            "toolu_01XYZ",
            "msg_02ABC",
            "req_03DEF",
            "sig_04GHI",
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            "claude-cli-v1-",
            "hidden-cot",
            "sig-secret-abc",
            "sk-ant-api03-secretvalue123",
            "secret_bearer_tok",
            "eyJhbGciOiJIUzI1NiJ9",
            ".claude/projects/demo-proj",
            "FakeTester",
            "The user's email address is",
            "<system-reminder>",
        ] {
            assert!(
                !cleaned.contains(forbidden),
                "scrubbed output leaked `{forbidden}`: {cleaned}"
            );
        }
    }

    #[test]
    fn capture_commit_classify_ttl_and_dismiss_roundtrip() {
        let fx = TempHandoffFixture::new("roundtrip");
        fx.write(
            ".claude.json",
            serde_json::to_vec(&json!({
                "userID": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                "oauthAccount": {
                    "accountUuid": "aaaa1111-2222-4333-8444-555555555555",
                    "organizationUuid": "bbbb1111-2222-4333-8444-555555555555",
                    "emailAddress": "fictional-alpha@example.invalid",
                    "displayName": "AlphaAlias"
                }
            }))
            .unwrap()
            .as_slice(),
        );
        let sess_id = "cccc1111-2222-4333-8444-555555555555";
        let main_lines = [
            json!({
                "type": "user",
                "sessionId": sess_id,
                "message": { "role": "user", "content": "Implement clean handoff for AlphaAlias" }
            })
            .to_string(),
            json!({
                "type": "assistant",
                "message": {
                    "role": "assistant",
                    "content": [
                        { "type": "thinking", "thinking": "secret internal thought", "signature": "sig_secret_99" },
                        { "type": "tool_use", "id": "toolu_12345", "name": "Edit", "input": { "file_path": fx.home.join("repo/src/lib.rs").to_string_lossy() } },
                        { "type": "text", "text": "Updated repo/src/lib.rs; hit 429 rate_limit" }
                    ]
                },
                "apiErrorStatus": 429,
                "isApiErrorMessage": true
            })
            .to_string(),
        ]
        .join("\n")
            + "\n";
        fx.write(
            &format!(".claude/projects/demo-slug/{sess_id}.jsonl"),
            main_lines.as_bytes(),
        );

        // Subagent 1: completed external agent -> output_ready
        fx.write(
            &format!(".claude/projects/demo-slug/{sess_id}/subagents/agent-ext111.meta.json"),
            serde_json::to_vec(&json!({
                "agentType": "gemini",
                "finished": true,
                "description": "Audit API schema for fictional-alpha@example.invalid"
            }))
            .unwrap()
            .as_slice(),
        );
        let long_output = format!(
            "{} token sk-ant-api99-leak",
            "A".repeat(2500)
        );
        fx.write(
            &format!(".claude/projects/demo-slug/{sess_id}/subagents/agent-ext111.jsonl"),
            format!(
                "{}\n",
                json!({
                    "type": "assistant",
                    "message": {
                        "role": "assistant",
                        "content": [
                            { "type": "thinking", "thinking": "sub-thinking" },
                            { "type": "text", "text": long_output }
                        ]
                    }
                })
            )
            .as_bytes(),
        );

        // Subagent 2: interrupted by 429 -> interrupted_429
        fx.write(
            &format!(".claude/projects/demo-slug/{sess_id}/subagents/agent-sub222.meta.json"),
            serde_json::to_vec(&json!({
                "agentType": "Explore",
                "finished": false,
                "description": "Inspect cache module"
            }))
            .unwrap()
            .as_slice(),
        );
        fx.write(
            &format!(".claude/projects/demo-slug/{sess_id}/subagents/agent-sub222.jsonl"),
            format!(
                "{}\n",
                json!({
                    "type": "assistant",
                    "error": "rate_limit",
                    "isApiErrorMessage": true,
                    "message": { "role": "assistant", "content": [{ "type": "text", "text": "Usage limit reached" }] }
                })
            )
            .as_bytes(),
        );

        // Pre-existing stale output file must be cleared on commit.
        let stale_out = fx.app_data.join("handoff/subagent-outputs/sub-99.md");
        private::directory(stale_out.parent().unwrap()).unwrap();
        private::write(&stale_out, b"stale output").unwrap();

        let draft = capture_handoff_draft(
            &fx.home,
            &[],
            &["AlphaAlias".into()],
        )
        .expect("draft captured");
        assert_eq!(draft.sessions.len(), 1);
        let (md_path, json_path) = commit_handoff_draft(&fx.app_data, &draft).unwrap();
        assert!(md_path.is_file());
        assert!(json_path.is_file());
        assert!(!stale_out.exists(), "stale sub-99.md must be purged");

        let summary = latest_handoff_in(&fx.app_data, draft.created_at_sec + 60)
            .unwrap()
            .expect("fresh summary");
        assert_eq!(summary.session_count, 1);
        assert_eq!(summary.output_ready_count, 1);
        assert_eq!(summary.interrupted_count, 1);
        assert_eq!(summary.items.len(), 2);
        assert_eq!(summary.items[0].id, "sub-01");
        assert_eq!(summary.items[1].id, "sub-02");

        let ready_item = summary
            .items
            .iter()
            .find(|i| i.status == "output_ready")
            .unwrap();
        let ready_path = PathBuf::from(ready_item.output_path.as_ref().unwrap());
        let ready_text = fs::read_to_string(&ready_path).unwrap();
        assert!(ready_text.contains("DO NOT re-run external agent"));
        assert!(!ready_text.contains("sk-ant-api99-leak"));
        assert!(ready_text.chars().count() <= 2300);

        let md_text = fs::read_to_string(&md_path).unwrap();
        assert!(md_text.contains("NEVER call `Agent(resume:)`"));
        assert!(!md_text.contains("AlphaAlias"));
        assert!(!md_text.contains("fictional-alpha@example.invalid"));
        assert!(!md_text.contains(sess_id));
        assert!(!md_text.contains("agent-ext111"));
        assert!(!md_text.contains("secret internal thought"));
        assert!(!md_text.contains("sig_secret_99"));

        // Expired (> 12h) returns None
        assert!(latest_handoff_in(&fx.app_data, draft.created_at_sec + HANDOFF_TTL_SEC + 1)
            .unwrap()
            .is_none());

        // Dismiss marks dismissed=true and subsequent reads return None
        dismiss_handoff_in(&fx.app_data).unwrap();
        assert!(latest_handoff_in(&fx.app_data, draft.created_at_sec + 60)
            .unwrap()
            .is_none());
        // Dismiss on missing handoff succeeds cleanly
        let missing_dir = fx.root.join("missing_app");
        private::directory(&missing_dir).unwrap();
        dismiss_handoff_in(&missing_dir).unwrap();
        assert!(latest_handoff_in(&missing_dir, draft.created_at_sec).unwrap().is_none());
    }

    #[test]
    fn bounded_head_tail_reads_large_transcript_without_full_load() {
        let fx = TempHandoffFixture::new("bounded");
        let p = fx.home.join(".claude/projects/demo/sess-large.jsonl");
        private::directory(p.parent().unwrap()).unwrap();
        let mut content = String::new();
        content.push_str(&format!(
            "{}\n",
            json!({ "type": "user", "message": { "role": "user", "content": "HEAD_GOAL_MARKER" } })
        ));
        for idx in 0..4500 {
            content.push_str(&format!(
                "{{\"type\":\"assistant\",\"idx\":{idx},\"pad\":\"{}\"}}\n",
                "x".repeat(64)
            ));
        }
        content.push_str(&format!(
            "{}\n",
            json!({ "type": "assistant", "message": { "role": "assistant", "content": [{ "type": "text", "text": "TAIL_PROGRESS_MARKER" }] } })
        ));
        assert!(content.len() > MAX_HEAD_BYTES + MAX_TAIL_BYTES);
        private::write(&p, content.as_bytes()).unwrap();

        let lines = read_bounded_head_tail(&p).unwrap();
        let ctx = ScrubContext::default();
        let (goal, progress, _, _, _) = inspect_jsonl_lines(&lines, &fx.home, &mut ctx.clone());
        assert_eq!(goal, "HEAD_GOAL_MARKER");
        assert_eq!(progress, "TAIL_PROGRESS_MARKER");
    }

    #[test]
    fn session_progress_allows_structured_1200_chars_and_bounds_overflow() {
        let fx = TempHandoffFixture::new("progress-cap");
        let summary_900 = format!(
            "Completed step 1 and step 2 ({}). Next: verify sk-ant-api03-secret999.",
            "detail ".repeat(118).trim()
        );
        assert!(summary_900.chars().count() > 800 && summary_900.chars().count() <= 1000);
        fx.write(
            ".claude/projects/demo/11111111-2222-4333-8444-555555555555.jsonl",
            format!(
                "{}\n{}\n",
                json!({ "type": "user", "message": { "role": "user", "content": "Run handoff" } }),
                json!({
                    "type": "assistant",
                    "message": { "role": "assistant", "content": [{ "type": "text", "text": summary_900 }] }
                })
            )
            .as_bytes(),
        );

        let draft = capture_handoff_draft(&fx.home, &[], &[]).expect("draft");
        assert_eq!(draft.sessions.len(), 1);
        let captured = &draft.sessions[0].last_progress;
        assert!(
            captured.chars().count() > 300,
            "structured summary must not be clipped at 300 chars: len={}",
            captured.chars().count()
        );
        assert!(!captured.ends_with('…'));
        assert!(!captured.contains("sk-ant-api03-secret999"));

        let over_1200 = "P".repeat(1400);
        fx.write(
            ".claude/projects/demo/11111111-2222-4333-8444-555555555555.jsonl",
            format!(
                "{}\n{}\n",
                json!({ "type": "user", "message": { "role": "user", "content": "Run handoff" } }),
                json!({
                    "type": "assistant",
                    "message": { "role": "assistant", "content": [{ "type": "text", "text": over_1200 }] }
                })
            )
            .as_bytes(),
        );
        let capped_draft = capture_handoff_draft(&fx.home, &[], &[]).expect("capped draft");
        let capped = &capped_draft.sessions[0].last_progress;
        assert_eq!(capped.chars().count(), 1200);
        assert!(capped.ends_with('…'));
    }

    #[test]
    fn inspect_jsonl_ignores_rate_limit_prose_user_and_api_blobs_and_tracks_handoff_reason() {
        let fx = TempHandoffFixture::new("rl-filter");
        let ctx = &mut ScrubContext::default();
        let long_prose = format!(
            "During diagnostics we inspected HTTP 429 rate_limit_error handling and hit your 5-hour limit recovery notes in detail. {}",
            "context ".repeat(60)
        );
        assert!(long_prose.len() > 400);
        let benign_lines = vec![
            json!({ "type": "api-request-blob", "body": "API Error: 429 rate_limit_error You've hit your limit" }).to_string(),
            json!({ "type": "user", "message": { "role": "user", "content": "API Error: 429 rate_limit_error hit your limit" } }).to_string(),
            json!({ "type": "assistant", "message": { "role": "assistant", "content": [{ "type": "text", "text": long_prose }] } }).to_string(),
        ];
        let (_goal, _prog, _files, saw_rl_false, _after) =
            inspect_jsonl_lines(&benign_lines, &fx.home, ctx);
        assert!(!saw_rl_false, "api-request-blob, user prompt, and >400-char prose must not trigger saw_rate_limit");

        let short_banner_lines = vec![
            json!({ "type": "user", "message": { "role": "user", "content": "Run task" } }).to_string(),
            json!({ "type": "assistant", "message": { "role": "assistant", "content": [{ "type": "text", "text": "API Error: 429 rate_limit_error" }] } }).to_string(),
        ];
        let (_g2, _p2, _f2, saw_rl_true, _a2) =
            inspect_jsonl_lines(&short_banner_lines, &fx.home, ctx);
        assert!(saw_rl_true);

        // Optional handoffReason is omitted when None and serialized when set via set_handoff_reason_in.
        fx.write(
            ".claude/projects/demo/22222222-3333-4444-8555-666666666666.jsonl",
            format!(
                "{}\n{}\n",
                json!({ "type": "user", "message": { "role": "user", "content": "Implement feature" } }),
                json!({ "type": "assistant", "message": { "role": "assistant", "content": [{ "type": "text", "text": "Implemented step 1." }] } })
            )
            .as_bytes(),
        );
        let draft = capture_handoff_draft(&fx.home, &[], &[]).expect("draft");
        commit_handoff_draft(&fx.root, &draft).expect("commit");
        let raw_before: serde_json::Value = serde_json::from_slice(
            &fs::read(fx.root.join("handoff/latest-handoff.json")).unwrap(),
        )
        .unwrap();
        assert!(!raw_before.as_object().unwrap().contains_key("handoffReason"));

        set_handoff_reason_in(&fx.root, "forced_stop").expect("set reason");
        let raw_after: serde_json::Value = serde_json::from_slice(
            &fs::read(fx.root.join("handoff/latest-handoff.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(raw_after["handoffReason"], "forced_stop");
        let loaded = latest_handoff_in(&fx.root, draft.created_at_sec)
            .unwrap()
            .expect("loaded");
        assert_eq!(loaded.handoff_reason.as_deref(), Some("forced_stop"));
    }
}

