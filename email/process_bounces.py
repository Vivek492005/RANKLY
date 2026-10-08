#!/usr/bin/env python3
"""Bounce handling (run daily by cron).

Scans the sending mailbox for Gmail delivery-failure notices
("Mail Delivery Subsystem" / mailer-daemon) and marks the failed recipients
as `bounced` in the recipient store so they are never mailed again.

A permanent-failure notice ("failed permanently") suppresses immediately.
Anything else is logged for human review.
"""
import base64
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from email import store

FAIL_RE = re.compile(
    r"Delivery to the following recipient failed permanently:\s*([\w.+-]+@[\w-]+\.[\w.]+)",
    re.IGNORECASE)


def cli(*args):
    p = subprocess.run(["hatch_gws_cli", *args], capture_output=True,
                       text=True)
    if p.returncode != 0:
        print("COMMAND FAILED:", " ".join(args[:6]), file=sys.stderr)
        print(p.stderr[:400], file=sys.stderr)
        sys.exit(1)
    return json.loads(p.stdout)


def _body_text(payload):
    """Extract plain-text body from a message payload."""
    parts = [payload]
    out = []
    while parts:
        p = parts.pop(0)
        mime = p.get("mimeType", "")
        body = p.get("body", {})
        if mime.startswith("text/plain") and body.get("data"):
            out.append(base64.urlsafe_b64decode(body["data"]).decode(
                "utf-8", "replace"))
        parts.extend(p.get("parts", []))
    return "\n".join(out)


def main():
    store.ensure_tabs()
    res = cli("gmail", "+triage", "--query",
              "from:mailer-daemon newer_than:14d", "--max", "50",
              "--format", "json")
    msgs = res.get("messages", res if isinstance(res, list) else [])
    marked, unclear = 0, 0
    seen = set()
    for m in msgs:
        mid = m.get("id")
        if not mid or mid in seen:
            continue
        seen.add(mid)
        full = cli("gmail", "users", "messages", "get", "--params",
                   json.dumps({"userId": "me", "id": mid, "format": "full"}))
        text = _body_text(full.get("payload", {}))
        hit = FAIL_RE.search(text)
        if hit:
            addr = hit.group(1).lower()
            store.set_status(addr, "bounced",
                             notes="hard bounce: delivery failed permanently")
            print(f"bounced {addr} (msg {mid})")
            marked += 1
        else:
            print(f"unclear DSN, left alone (msg {mid})")
            unclear += 1
    print(f"done: {marked} bounced, {unclear} unclear")


if __name__ == "__main__":
    main()
