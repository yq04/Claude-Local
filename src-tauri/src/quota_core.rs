// [INPUT]: Bounded, credential-free window states and an explicit caller-supplied clock.
// [OUTPUT]: Pure expiry/merge/provenance decisions and schema-1 JSON stdin/stdout responses.
// [POS]: Shared quota rules for the read-only GUI and Python ledger writer; no file/network access.
// [PROTOCOL]: Update this header and src/CLAUDE.md when changing the interface.
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};

const MAX_INPUT_BYTES: u64 = 1024 * 1024;
const MAX_ITEMS: usize = 256;
const MAX_TIME_SEC: u64 = 253_402_300_799;
const MAX_TIME_MS: u64 = MAX_TIME_SEC * 1000 + 999;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QuotaSource {
    ServerAnchor,
    LocalEstimate,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct WindowState {
    pub used: Option<u8>,
    pub reset_at: Option<u64>,
    pub source: QuotaSource,
    pub observed_at_ms: Option<u64>,
}

impl WindowState {
    pub(crate) fn normalized(mut self, now_sec: u64) -> Self {
        self.observed_at_ms = self.observed_at_ms.filter(|time| *time > 0);
        if self.source == QuotaSource::Unknown
            || self.used.is_none()
            || self.reset_at.is_none_or(|reset| reset <= now_sec)
        {
            self.used = None;
            self.reset_at = None;
            self.source = QuotaSource::Unknown;
        }
        self
    }

    fn valid(&self) -> bool {
        self.used.is_none_or(|used| used <= 100)
            && self.reset_at.is_none_or(|time| time <= MAX_TIME_SEC)
            && self.observed_at_ms.is_none_or(|time| time <= MAX_TIME_MS)
    }
}

pub(crate) fn max_observation(a: Option<u64>, b: Option<u64>) -> Option<u64> {
    match (a, b) {
        (Some(a), Some(b)) => Some(a.max(b)),
        (Some(a), None) | (None, Some(a)) => Some(a),
        (None, None) => None,
    }
}

pub(crate) fn aggregate_source(
    a: Option<QuotaSource>,
    b: Option<QuotaSource>,
) -> Option<QuotaSource> {
    match (a, b) {
        (Some(a), Some(b)) if a == b => Some(a),
        (None, None) => None,
        _ => Some(QuotaSource::Unknown),
    }
}

pub(crate) fn expire_window(
    used: &mut Option<u8>,
    reset: &mut Option<u64>,
    source: &mut Option<QuotaSource>,
    now_sec: u64,
) {
    if reset.is_some_and(|time| now_sec >= time) {
        *used = None;
        *reset = None;
        *source = Some(QuotaSource::Unknown);
    }
}

/// Missing/expired windows cannot claim zero usage or a fabricated reset.
/// A local value without observation metadata remains conservative: another
/// calculation cannot silently replace it with an unrelated anchor.
pub(crate) fn merge_window(
    current: WindowState,
    candidate: Option<WindowState>,
    now_sec: u64,
) -> WindowState {
    let current = current.normalized(now_sec);
    let Some(candidate) = candidate.map(|state| state.normalized(now_sec)) else {
        return current;
    };
    if candidate.source == QuotaSource::Unknown {
        return current;
    }
    if current.source == QuotaSource::Unknown {
        return candidate;
    }
    if current.observed_at_ms.is_none() && current.source == QuotaSource::LocalEstimate {
        return current;
    }
    match (current.observed_at_ms, candidate.observed_at_ms) {
        (Some(current_ms), Some(candidate_ms)) if candidate_ms < current_ms => return current,
        (Some(_), None) => return current,
        (Some(current_ms), Some(candidate_ms))
            if candidate_ms == current_ms && candidate.reset_at != current.reset_at =>
        {
            return current;
        }
        // A changed reset without a newer observation does not prove a new window.
        (None, None) if candidate.reset_at != current.reset_at => return current,
        _ => {}
    }
    if candidate.reset_at == current.reset_at && current.used > candidate.used {
        // The retained larger value still comes from its original source.
        // In particular, a lower server value cannot certify a local estimate.
        WindowState {
            observed_at_ms: max_observation(current.observed_at_ms, candidate.observed_at_ms),
            ..current
        }
    } else {
        candidate
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MergeItem {
    current: WindowState,
    candidate: Option<WindowState>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    schema: u8,
    op: String,
    now_sec: u64,
    items: Vec<MergeItem>,
}

#[derive(Serialize)]
struct Response {
    schema: u8,
    items: Vec<WindowState>,
}

fn respond(input: &[u8]) -> Result<Vec<u8>, ()> {
    let request: Request = serde_json::from_slice(input).map_err(|_| ())?;
    if request.schema != 1
        || request.op != "merge_windows"
        || request.now_sec > MAX_TIME_SEC
        || request.items.len() > MAX_ITEMS
        || request
            .items
            .iter()
            .any(|item| !item.current.valid() || item.candidate.is_some_and(|state| !state.valid()))
    {
        return Err(());
    }
    let items = request
        .items
        .into_iter()
        .map(|item| merge_window(item.current, item.candidate, request.now_sec))
        .collect();
    serde_json::to_vec(&Response { schema: 1, items }).map_err(|_| ())
}

fn run(reader: impl Read, mut writer: impl Write) -> Result<(), ()> {
    let mut input = Vec::new();
    reader
        .take(MAX_INPUT_BYTES + 1)
        .read_to_end(&mut input)
        .map_err(|_| ())?;
    if input.len() as u64 > MAX_INPUT_BYTES {
        return Err(());
    }
    let response = respond(&input)?;
    writer.write_all(&response).map_err(|_| ())?;
    writer.write_all(b"\n").map_err(|_| ())?;
    writer.flush().map_err(|_| ())
}

/// Return before all GUI/single-instance initialization. Errors never echo input.
pub(crate) fn headless(args: &[String]) -> Option<i32> {
    if !args
        .iter()
        .skip(1)
        .any(|arg| arg == "--quota-core" || arg.starts_with("--quota-core="))
    {
        return None;
    }
    let result = if args.len() == 2 && args[1] == "--quota-core" {
        run(std::io::stdin().lock(), std::io::stdout().lock())
    } else {
        Err(())
    };
    Some(if result.is_ok() {
        0
    } else {
        let _ = std::io::stderr().write_all(b"quota-core: invalid request\n");
        2
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(used: u8, reset: u64, source: QuotaSource, observed: Option<u64>) -> WindowState {
        WindowState {
            used: Some(used),
            reset_at: Some(reset),
            source,
            observed_at_ms: observed,
        }
    }

    #[test]
    fn observation_order_and_new_window() {
        let current = state(100, 200, QuotaSource::ServerAnchor, Some(2000));
        assert_eq!(
            merge_window(
                current,
                Some(state(5, 200, QuotaSource::ServerAnchor, Some(1000))),
                100
            ),
            current
        );
        assert_eq!(
            merge_window(
                current,
                Some(state(5, 300, QuotaSource::ServerAnchor, Some(2000))),
                100
            ),
            current
        );
        assert_eq!(
            merge_window(
                current,
                Some(state(5, 300, QuotaSource::ServerAnchor, Some(3000))),
                100
            )
            .used,
            Some(5)
        );
        assert_eq!(
            merge_window(
                current,
                Some(state(5, 200, QuotaSource::ServerAnchor, Some(3000))),
                100
            )
            .used,
            Some(100)
        );
    }

    #[test]
    fn retained_local_value_is_not_a_server_observation() {
        let local = state(90, 200, QuotaSource::LocalEstimate, Some(1000));
        let merged = merge_window(
            local,
            Some(state(80, 200, QuotaSource::ServerAnchor, Some(2000))),
            100,
        );
        assert_eq!(merged.used, Some(90));
        assert_eq!(merged.source, QuotaSource::LocalEstimate);
        assert_eq!(merged.observed_at_ms, Some(2000));
    }

    #[test]
    fn missing_observation_and_unknown_candidates_are_conservative() {
        let current = state(80, 200, QuotaSource::ServerAnchor, Some(2000));
        assert_eq!(
            merge_window(
                current,
                Some(state(90, 200, QuotaSource::ServerAnchor, None)),
                100
            ),
            current
        );
        assert_eq!(
            merge_window(
                current,
                Some(state(90, 200, QuotaSource::Unknown, Some(3000))),
                100
            ),
            current
        );
        let local = state(80, 200, QuotaSource::LocalEstimate, None);
        assert_eq!(merge_window(local, Some(current), 100), local);
    }

    #[test]
    fn expiry_missing_values_and_aggregate_provenance() {
        let expired = merge_window(
            state(100, 100, QuotaSource::ServerAnchor, Some(1000)),
            None,
            100,
        );
        assert_eq!(expired.used, None);
        assert_eq!(expired.reset_at, None);
        assert_eq!(expired.source, QuotaSource::Unknown);
        assert_eq!(expired.observed_at_ms, Some(1000));
        let missing = WindowState {
            reset_at: None,
            ..state(20, 200, QuotaSource::ServerAnchor, Some(1000))
        };
        assert_eq!(missing.normalized(100).source, QuotaSource::Unknown);
        assert_eq!(
            aggregate_source(
                Some(QuotaSource::ServerAnchor),
                Some(QuotaSource::LocalEstimate)
            ),
            Some(QuotaSource::Unknown)
        );
        assert_eq!(max_observation(Some(1000), Some(2000)), Some(2000));
    }

    #[test]
    fn bounded_protocol_and_one_json_response() {
        let request = br#"{"schema":1,"op":"merge_windows","now_sec":100,"items":[{"current":{"used":20,"reset_at":200,"source":"server_anchor","observed_at_ms":1000},"candidate":null}]}"#;
        let mut output = Vec::new();
        run(&request[..], &mut output).unwrap();
        let result: serde_json::Value = serde_json::from_slice(&output).unwrap();
        assert_eq!(result["schema"], 1);
        assert_eq!(result["items"][0]["used"], 20);
        for invalid in [
            br#"{"schema":2,"op":"merge_windows","now_sec":0,"items":[]}"#.as_slice(),
            br#"{"schema":1,"op":"write","now_sec":0,"items":[]}"#.as_slice(),
            br#"{"schema":1,"op":"merge_windows","now_sec":18446744073709551615,"items":[]}"#.as_slice(),
            br#"{"schema":1,"op":"merge_windows","now_sec":0,"items":[{"current":{"used":101,"reset_at":200,"source":"server_anchor","observed_at_ms":1},"candidate":null}]}"#.as_slice(),
            b"not json".as_slice(),
        ] {
            assert!(respond(invalid).is_err());
        }
        let too_many = serde_json::json!({"schema":1,"op":"merge_windows","now_sec":0,"items":(0..257).map(|_| serde_json::json!({"current":state(20,200,QuotaSource::ServerAnchor,Some(1)),"candidate":null})).collect::<Vec<_>>()});
        assert!(respond(&serde_json::to_vec(&too_many).unwrap()).is_err());
        assert!(run(&vec![b' '; MAX_INPUT_BYTES as usize + 1][..], Vec::new()).is_err());
        assert_eq!(
            headless(&["app".into(), "--quota-core".into(), "--browser".into()]),
            Some(2)
        );
    }
}
