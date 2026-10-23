# [INPUT]: Native fixture CLI paths pointing exclusively to a fresh synthetic resource/home/app tree.
# [OUTPUT]: Actual installed collector CLI protocol with deterministic profile/usage transport.
# [POS]: Test-only launcher; never packaged. Binding, route resolution, grants and writers stay real.
# [PROTOCOL]: No external requests, real profiles, environment path overrides or credential logging.
import json
import socket
import time
from pathlib import Path

import quota_collector as online


def reject_network(*args, **kwargs):
    raise AssertionError("external transport is forbidden in this fixture")


socket.create_connection = reject_network
socket.socket = reject_network


def fetch(token, endpoint=online.ENDPOINT, route=None):
    assert token == "synthetic-native-chain-token"
    assert route is not None
    with (Path(__file__).parent / "transport-calls.jsonl").open("a", encoding="utf-8") as output:
        output.write(json.dumps({"endpoint": endpoint, "route_mode": route[0]}) + "\n")
    if endpoint == online.PROFILE_ENDPOINT:
        payload = {
            "account": {"uuid": "11111111-1111-4111-8111-111111111111", "email": "synthetic@example.invalid"},
            "organization": {"uuid": "22222222-2222-4222-8222-222222222222"},
        }
    elif endpoint == online.ENDPOINT:
        payload = {"five_hour": {"utilization": 21, "resets_at": int(time.time()) + 3600}}
    else:
        raise AssertionError("collector requested an unapproved endpoint")
    return 200, json.dumps(payload).encode("utf-8"), {}


online._fetch = fetch
online.main()
