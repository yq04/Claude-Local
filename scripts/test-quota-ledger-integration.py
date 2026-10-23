# [INPUT]: A synthetic normalized native quota snapshot and a fresh temporary fixture root.
# [OUTPUT]: Python's real browser-snapshot importer result plus persisted ledger/metadata readback.
# [POS]: Isolated child-process integration fixture invoked only by test-quota-integration.mjs.
# [PROTOCOL]: Never use workstation identities or network; root is created by the parent test.
import importlib.util
import json
import os
import sys
import time
from pathlib import Path

root = Path(sys.argv[1]).resolve()
app = root / "app-data"
home = root / "claude-home"
vault = app / "identity-vault"
vault.mkdir(parents=True, exist_ok=True)
(home / ".claude").mkdir(parents=True, exist_ok=True)
account = {
    "accountUuid": "11111111-1111-4111-8111-111111111111",
    "emailAddress": "synthetic@example.invalid",
    "organizationUuid": "22222222-2222-4222-8222-222222222222",
}
(home / ".claude.json").write_text(json.dumps({"oauthAccount": account}), encoding="utf-8")
(home / ".claude" / ".credentials.json").write_text(json.dumps({"claudeAiOauth": {
    "accessToken": "synthetic-integration-token",
    "expiresAt": int(time.time() * 1000) + 3_600_000,
    "subscriptionType": "pro",
}}), encoding="utf-8")
resource_root = Path(os.environ["CLAUDE_LOCAL_RESOURCE_ROOT"]).resolve()
online_script = resource_root / "scripts" / "claude_quota_online.py"
sys.path.insert(0, str(online_script.parent))
spec = importlib.util.spec_from_file_location("quota_online", online_script)
online = importlib.util.module_from_spec(spec)
spec.loader.exec_module(online)
snapshot = json.load(sys.stdin)
expected = online.quota.quota_identity(account)
result = online.import_browser_snapshot(app, home, "current", snapshot, expected)
metadata = json.loads((vault / "quota_web_metadata.json").read_text(encoding="utf-8"))
ledger = json.loads((app / "quota_ledger.json").read_text(encoding="utf-8"))
identity = expected
entry = metadata["accounts"][identity]
quota_entry = ledger["accounts"][account["emailAddress"]]
print(json.dumps({
    "result": result,
    "metadata": entry,
    "quota_windows": quota_entry["server_anchor"]["utilization"],
    "identity_bound": identity == expected,
}, separators=(",", ":")))
