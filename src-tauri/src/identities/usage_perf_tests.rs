// [INPUT]: Temporary synthetic Claude Code project trees and ledgers sized like a heavy local workstation; no real identity, home or process access.
// [OUTPUT]: Ignored wall-clock benchmark of cold/steady usage scans, period aggregation and HUD telemetry for performance regression review.
// [POS]: Unit-only child of usage; run explicitly with `cargo test --bin claude-local usage_perf -- --ignored --nocapture`.
// [PROTOCOL]: Temporary data only; test cleanup never targets a user directory.
use super::*;
use std::io::Write;
use std::time::Instant;

const PROJECTS: usize = 280;
const FILES_PER_PROJECT: usize = 2;
const EVENTS_PER_FILE: usize = 215;

fn fixture() -> (std::path::PathBuf, std::path::PathBuf, std::path::PathBuf) {
    let path = std::env::temp_dir().join(format!(
        "claude-local-usage-perf-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let vault = path.join("vault");
    let home = path.join("home");
    private::directory(&vault).unwrap();
    private::directory(&home.join(".claude/projects")).unwrap();
    private::write(&vault.join("key.bin"), &[41; 32]).unwrap();
    let value = serde_json::json!({"oauthAccount":{"accountUuid":"perf-account","organizationUuid":"perf-org","displayName":"perf","emailAddress":"perf@example.invalid"}});
    fs::write(home.join(".claude.json"), value.to_string()).unwrap();
    (path, vault, home)
}

fn iso(ts: u64) -> String {
    DateTime::<Utc>::from_timestamp(ts as i64, 0)
        .unwrap()
        .to_rfc3339()
}

fn populate(home: &Path, clock: u64) -> usize {
    let span = 120 * 86_400u64;
    let models = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"];
    let efforts = ["low", "medium", "high"];
    let mut total = 0;
    for p in 0..PROJECTS {
        let dir = home.join(format!(".claude/projects/project-{p:03}"));
        private::directory(&dir).unwrap();
        for f in 0..FILES_PER_PROJECT {
            let session = format!("session-{p:03}-{f}");
            let mut body = String::with_capacity(EVENTS_PER_FILE * 420);
            let base = clock - span + ((p * FILES_PER_PROJECT + f) as u64 * span)
                / (PROJECTS * FILES_PER_PROJECT) as u64;
            body.push_str(&serde_json::json!({"type":"user","sessionId":session,"parentUuid":null,"timestamp":iso(base),"message":{"content":"synthetic"}}).to_string());
            body.push('\n');
            if (p * FILES_PER_PROJECT + f) % 50 == 0 {
                // Like real logs: a crash-truncated or oversized record is permanently invalid.
                body.push_str("{\"type\":\"assistant\",\"truncated\n");
            }
            for e in 0..EVENTS_PER_FILE {
                let ts = (base + e as u64 * 37).min(clock - 1);
                let id = format!("m-{p}-{f}-{e}");
                body.push_str(&serde_json::json!({"type":"assistant","sessionId":session,"timestamp":iso(ts),"requestId":format!("r-{id}"),"isSidechain":false,"effort":{"level":efforts[e % 3]},"message":{"id":id,"model":models[e % 3],"usage":{"input_tokens":12 + e,"output_tokens":340,"cache_creation_input_tokens":1200,"cache_read_input_tokens":45_000}}}).to_string());
                body.push('\n');
                total += 1;
            }
            let mut file = File::create(dir.join(format!("{session}.jsonl"))).unwrap();
            file.write_all(body.as_bytes()).unwrap();
        }
    }
    total
}

fn timed<T>(label: &str, f: impl FnOnce() -> T) -> T {
    let start = Instant::now();
    let value = f();
    eprintln!("[usage-perf] {label:<34} {:>8.1} ms", start.elapsed().as_secs_f64() * 1000.0);
    value
}

#[test]
#[ignore]
fn usage_perf_heavy_workstation() {
    let (dir, vault, home) = fixture();
    let clock = now();
    let events = timed("populate synthetic tree", || populate(&home, clock));
    eprintln!("[usage-perf] events={events} files={}", PROJECTS * FILES_PER_PROJECT);
    let read = |period: &str| {
        read_at_with_timezone_now(
            &vault,
            &home,
            period,
            None,
            0,
            None,
            Some("America/New_York"),
            now(),
        )
        .unwrap()
    };
    let cold = timed("cold read all (full parse)", || read("all"));
    assert_eq!(cold.totals.requests as usize, events);
    timed("steady read all", || read("all"));
    timed("steady read all (repeat)", || read("all"));
    timed("steady read month", || read("month"));
    timed("steady read week", || read("week"));
    timed("steady read today", || read("today"));
    timed("open_ledger", || open_ledger(&vault.join("usage.sqlite")).unwrap());
    let base = now();
    timed("monitor_usage (scan due)", || monitor_usage(&vault, &home, base + 10).unwrap());
    timed("monitor_usage (throttled)", || monitor_usage(&vault, &home, base + 11).unwrap());
    timed("observe_current", || observe_current(&vault, &home));
    let projects = home.join(".claude").join("projects");
    let conn = open_ledger(&vault.join("usage.sqlite")).unwrap();
    let known = load_cursors(&conn);
    timed("scan_dir unchanged tree", || {
        let (mut ev, mut warn, mut cache) = (HashMap::new(), Vec::new(), Vec::new());
        scan_dir(&projects, 0, &mut ev, &mut warn, &mut cache, &known);
        assert!(ev.is_empty(), "unchanged (including damaged) files must not be re-parsed");
        assert!(cache.is_empty());
        assert!(warn.contains(&"invalid_records".to_string()));
    });
    timed("persist_scan empty", || {
        persist_scan(&conn, HashMap::new(), &[], &[]).unwrap()
    });
    for n in 0..5 {
        timed(&format!("identities Database::open #{n}"), || {
            crate::identities::database::Database::open(&vault).unwrap()
        });
    }
    // Append one complete line to the newest file like a live CLI turn.
    let live = projects.join(format!("project-{:03}/session-{:03}-1.jsonl", PROJECTS - 1, PROJECTS - 1));
    let mut file = fs::OpenOptions::new().append(true).open(&live).unwrap();
    writeln!(file, "{}", serde_json::json!({"type":"assistant","sessionId":format!("session-{:03}-1", PROJECTS - 1),"timestamp":iso(now() - 1),"requestId":"r-live","message":{"id":"m-live","model":"claude-sonnet-5-5","usage":{"input_tokens":1,"output_tokens":2,"cache_creation_input_tokens":3,"cache_read_input_tokens":4}}})).unwrap();
    drop(file);
    timed("read today after live append", || read("today"));
    drop(conn);
    fs::remove_dir_all(dir).unwrap();
}
