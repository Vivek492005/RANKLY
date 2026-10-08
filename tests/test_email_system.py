#!/usr/bin/env python3
"""Tests for the Rankly email system (email/ module).

Stubs: Sheets (in-memory), Gmail CLI, quota state. No real sends.
"""
import importlib.util
import os
import re
import sys

ROOT = "/home/hatch/workspace/rankly"
sys.path.insert(0, ROOT)

from email import store, templates, sender
from email.process_unsubscribes import is_unsubscribe_request
from email.process_bounces import FAIL_RE

passed = 0


def check(name, cond):
    global passed
    assert cond, "FAILED: " + name
    passed += 1
    print("ok -", name)


# ---------- fake sheets ----------
class FakeSheets:
    tabs = {}

    @staticmethod
    def get_values(tab, rng):
        return [list(r) for r in FakeSheets.tabs.get(tab, [])]

    @staticmethod
    def update_values(tab, rng, values):
        m = re.match(r"A(\d+)", rng)
        start = int(m.group(1))
        rows = FakeSheets.tabs.setdefault(tab, [])
        for i, v in enumerate(values):
            idx = start - 1 + i
            while len(rows) <= idx:
                rows.append([])
            rows[idx] = list(v)

    @staticmethod
    def pad(r, n):
        r = list(r)
        while len(r) < n:
            r.append("")
        return r


store.db = FakeSheets
store.ensure_tabs = lambda: FakeSheets.tabs.setdefault(
    store.TAB_RECIPIENTS, [store.RECIPIENT_HEADERS]) or FakeSheets.tabs.setdefault(
    store.TAB_LOG, [store.LOG_HEADERS])


def reset_store():
    FakeSheets.tabs = {}


def reset_quota():
    try:
        os.unlink(sender._quota_path())
    except OSError:
        pass


reset_quota()


# ---------- templates ----------
s, b, h = templates.variant_a_product_update("Asha")
check("A subject accurate", s == "Rankly update: instant payments are live")
check("A has opt-out", "unsubscribe" in b.lower())
check("A personalizes name", "Hi Asha," in b)
check("A single direct link", b.count("https://ranklyy.vercel.app") == 1)
check("A no shorteners", "bit.ly" not in b and "tinyurl" not in b)
check("A plain text", h is False)

s, b, h = templates.variant_b_minimal_html("Asha")
check("B is html", h is True)
check("B no tracking pixel", "<img" not in b.lower())
check("B has opt-out", "unsubscribe" in b.lower())

s, b, h = templates.variant_c_reengagement("Asha", "claimed a rank last month")
check("C references real event", "claimed a rank last month" in b)
check("C has opt-out", "unsubscribe" in b.lower())
check("C no invented claims", "recruiter" not in b.lower())

# ---------- store: consent ----------
reset_store()
store.upsert_recipient("A@x.com", consent_source="test")
check("upsert normalizes", store.get_recipient("a@x.com") is not None)
check("eligible lists subscribed", store.list_eligible() == ["a@x.com"])
store.set_status("a@x.com", "unsubscribed", notes="test")
check("unsubscribed not eligible", store.list_eligible() == [])
try:
    store.upsert_recipient("a@x.com", status="subscribed")
    check("resubscribe blocked", False)
except PermissionError:
    check("resubscribe blocked without flag", True)
store.upsert_recipient("a@x.com", status="subscribed", resubscribe=True)
check("explicit resubscribe works", store.list_eligible() == ["a@x.com"])
store.set_status("ghost@x.com", "bounced", notes="test")
check("unknown bounced recorded", store.get_recipient("ghost@x.com")[1][1] == "bounced")
check("bounced not eligible", "ghost@x.com" not in store.list_eligible())
try:
    store.upsert_recipient("not-an-email")
    check("invalid email rejected", False)
except ValueError:
    check("invalid email rejected", True)

# ---------- store: dedup via log ----------
reset_store()
check("not sent initially", store.already_sent("c1", "a@x.com") is False)
store.log_send("c1", "a@x.com", "a", "sent", "ok")
check("sent recorded", store.already_sent("c1", "a@x.com") is True)
check("other campaign not deduped", store.already_sent("c2", "a@x.com") is False)
check("other address not deduped", store.already_sent("c1", "b@x.com") is False)

# ---------- sender: MIME ----------
calls = []


def fake_cli_ok(*args):
    calls.append(args)
    return {}


sender._cli = fake_cli_ok
sender.SENDER = "sochai.hr@gmail.com"
path = sender.build_mime("to@x.com", "Subj", "Hello", is_html=False)
eml = open(path, encoding="utf-8").read()
os.unlink(path)
check("mime has List-Unsubscribe",
      "List-Unsubscribe: <mailto:sochai.hr@gmail.com?subject=unsubscribe>" in eml)
check("mime has From/To/Subject",
      "From: sochai.hr@gmail.com" in eml and "To: to@x.com" in eml
      and "Subject: Subj" in eml)
check("mime has Message-ID", "Message-ID:" in eml)
st, _ = sender.send_one("bad-address", "s", "b")
check("invalid address skipped", st == "skipped")

# ---------- sender: campaign dry-run + dedup ----------
reset_store()
calls.clear()
store.upsert_recipient("a@x.com", consent_source="t")
store.upsert_recipient("b@x.com", consent_source="t")


def render(to):
    return templates.variant_a_product_update("T")


stats = sender.send_campaign("camp1", ["a@x.com", "b@x.com"], render, "a",
                             dry_run=True)
check("dry-run sends both", stats["sent"] == 2 and stats["failed"] == 0)
check("dry-run makes no cli calls", len(calls) == 0)
stats2 = sender.send_campaign("camp1", ["a@x.com", "b@x.com"], render, "a",
                              dry_run=False)
check("dry-run does not block real send",
      stats2["sent"] == 2 and stats2["skipped"] == 0)
check("real send uses raw api", len(calls) == 2)
stats3 = sender.send_campaign("camp1", ["a@x.com", "b@x.com"], render, "a",
                              dry_run=False)
check("re-run dedups via log",
      stats3["sent"] == 0 and stats3["skipped"] == 2)

# ---------- sender: per-recipient failure continues ----------
reset_store()
store.upsert_recipient("a@x.com", consent_source="t")
store.upsert_recipient("b@x.com", consent_source="t")
attempts = []


def flaky_cli(*args):
    attempts.append(1)
    if len(attempts) == 1:
        raise RuntimeError("transient boom")
    return {}


sender._cli = flaky_cli
stats = sender.send_campaign("camp2", ["a@x.com", "b@x.com"], render, "a",
                             dry_run=False)
check("transient failure retried and sent", stats["sent"] == 2)
check("no hard failures", stats["failed"] == 0)


def dead_cli(*args):
    raise RuntimeError("permanent boom")


sender._cli = dead_cli
stats = sender.send_campaign("camp3", ["a@x.com", "b@x.com"], render, "a",
                             dry_run=False)
check("persistent failure logged per-recipient, continues",
      stats["failed"] == 2 and stats["sent"] == 0
      and stats["aborted"] is None)


def acct_cli(*args):
    raise sender.AccountError("quotaExceeded")


sender._cli = acct_cli
stats = sender.send_campaign("camp4", ["a@x.com", "b@x.com"], render, "a",
                             dry_run=False)
check("account error aborts campaign",
      stats["aborted"] is not None and stats["sent"] == 0)

# ---------- sender: quota guard ----------
reset_store()
reset_quota()
store.upsert_recipient("a@x.com", consent_source="t")
store.upsert_recipient("b@x.com", consent_source="t")
store.upsert_recipient("c@x.com", consent_source="t")
sender._cli = fake_cli_ok
# quota=2 -> guard trips at int(2*0.8)=1 send
stats = sender.send_campaign("camp5", ["a@x.com", "b@x.com", "c@x.com"],
                             render, "a", dry_run=False, quota=2)
check("quota guard pauses campaign",
      stats["sent"] == 1 and stats["paused"] is True
      and stats["aborted"] is not None)

# ---------- sender: pause file ----------
reset_store()
store.upsert_recipient("a@x.com", consent_source="t")
os.makedirs(sender.STATE_DIR, exist_ok=True)
open(os.path.join(sender.STATE_DIR, "camp6.pause"), "w").write("x")
stats = sender.send_campaign("camp6", ["a@x.com"], render, "a", dry_run=False)
check("pause file stops campaign", stats["paused"] is True and stats["sent"] == 0)
os.unlink(os.path.join(sender.STATE_DIR, "camp6.pause"))

# ---------- unsubscribe heuristic ----------
check("plain unsubscribe", is_unsubscribe_request("unsubscribe") is True)
check("re: unsubscribe", is_unsubscribe_request("Re: unsubscribe") is True)
check("unsubscribed variant", is_unsubscribe_request("Unsubscribed") is True)
check("promo not matched",
      is_unsubscribe_request("Rankly update: instant payments") is False)
check("empty not matched", is_unsubscribe_request("") is False)

# ---------- bounce regex ----------
dsn = ("Delivery to the following recipient failed permanently:\n\n"
       "    dead@x.com\n\nTechnical details...")
m = FAIL_RE.search(dsn)
check("bounce regex extracts address", m and m.group(1) == "dead@x.com")
check("bounce regex no false positive",
      FAIL_RE.search("hello world") is None)

print(f"\n{passed} email-system checks passed")
