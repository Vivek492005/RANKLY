#!/usr/bin/env python3
"""Unsubscribe workflow (run daily by cron).

Scans the sending mailbox for replies asking to opt out and suppresses those
addresses in the recipient store so no future promotional mail goes to them.

Heuristic (documented, conservative): a message counts as an unsubscribe
request when its subject, stripped of "re:"/"fwd:" prefixes, is exactly
"unsubscribe" or "unsubscribed", or starts with "unsubscribe ". The sender
address is taken from the From header. Anything ambiguous is logged and left
alone for human review.

The List-Unsubscribe: <mailto:…?subject=unsubscribe> header on our sends
makes compliant mail clients generate exactly such replies.
"""
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from email import store

SELF = os.environ.get("RANKLY_SENDER_EMAIL", "sochai.hr@gmail.com").lower()


def cli(*args):
    p = subprocess.run(["hatch_gws_cli", *args], capture_output=True,
                       text=True)
    if p.returncode != 0:
        print("COMMAND FAILED:", " ".join(args[:6]), file=sys.stderr)
        print(p.stderr[:400], file=sys.stderr)
        sys.exit(1)
    return json.loads(p.stdout)


def is_unsubscribe_request(subject):
    s = (subject or "").strip().lower()
    s = re.sub(r"^(re|fwd?)\s*:\s*", "", s)
    return s in ("unsubscribe", "unsubscribed") or s.startswith("unsubscribe ")


def from_address(headers):
    for h in headers:
        if h["name"].lower() == "from":
            m = re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", h["value"])
            return m.group(0).lower() if m else ""
    return ""


def main():
    store.ensure_tabs()
    res = cli("gmail", "+triage", "--query",
              "subject:unsubscribe newer_than:14d", "--max", "50",
              "--format", "json")
    msgs = res.get("messages", res if isinstance(res, list) else [])
    processed, ambiguous = 0, 0
    seen = set()
    for m in msgs:
        mid = m.get("id")
        if not mid or mid in seen:
            continue
        seen.add(mid)
        full = cli("gmail", "users", "messages", "get", "--params",
                   json.dumps({"userId": "me", "id": mid, "format": "metadata",
                               "metadataHeaders": ["From", "Subject"]}))
        headers = full.get("payload", {}).get("headers", [])
        subj = next((h["value"] for h in headers
                     if h["name"].lower() == "subject"), "")
        addr = from_address(headers)
        if not addr or addr == SELF:
            continue
        if is_unsubscribe_request(subj):
            store.set_status(addr, "unsubscribed",
                             notes="via unsubscribe reply")
            print(f"unsubscribed {addr} (msg {mid})")
            processed += 1
        else:
            print(f"ambiguous, left alone: {addr} subject={subj!r}")
            ambiguous += 1
    print(f"done: {processed} unsubscribed, {ambiguous} ambiguous")


if __name__ == "__main__":
    main()
