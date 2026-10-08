#!/usr/bin/env python3
"""Consent-aware recipient store + send log, backed by Google Sheets tabs.

Tabs (auto-created on first use):
  "Email Recipients": Email | Status | Consent source | Consent timestamp |
                      Last campaign | Sent count | Notes
  "Email Log": Timestamp | Campaign | To | Template | Status | Detail

Status is one of: subscribed | unsubscribed | bounced.
Only `subscribed` recipients are ever emailed by the sending pipeline.
An `unsubscribed` address can only return to `subscribed` via an explicit
resubscribe (never implicitly), so a mistaken re-import cannot re-add someone
who opted out.
"""
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import rankly_db as db

TAB_RECIPIENTS = "Email Recipients"
RECIPIENT_HEADERS = ["Email", "Status", "Consent source", "Consent timestamp",
                     "Last campaign", "Sent count", "Notes"]
TAB_LOG = "Email Log"
LOG_HEADERS = ["Timestamp", "Campaign", "To", "Template", "Status", "Detail"]

VALID_STATUSES = ("subscribed", "unsubscribed", "bounced")


def _norm(email):
    return (email or "").strip().lower()


def _now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def ensure_tabs():
    for tab, headers in ((TAB_RECIPIENTS, RECIPIENT_HEADERS),
                         (TAB_LOG, LOG_HEADERS)):
        try:
            vals = db.get_values(tab, "A1:G1")
        except SystemExit:
            vals = None  # tab does not exist yet
        if vals is None:
            db.cli("sheets", "spreadsheets", "batchUpdate", "--params",
                   json.dumps({"spreadsheetId": db.SS}),
                   "--json", json.dumps(
                       {"requests": [{"addSheet":
                                      {"properties": {"title": tab}}}]}))
            db.update_values(tab, "A1", [headers])
            print(f"created tab {tab}")
        elif not vals or [c.strip() for c in vals[0]] != headers:
            db.update_values(tab, "A1", [headers])
            print(f"wrote headers on {tab}")


def _read_recipients():
    """Return {email: (1-based row, padded row list)}."""
    vals = db.get_values(TAB_RECIPIENTS, "A1:G5000")
    out = {}
    for i, r in enumerate(vals[1:], start=2):
        r = db.pad(r, 7)
        if r[0].strip():
            out[_norm(r[0])] = (i, r)
    return out


def get_recipient(email):
    return _read_recipients().get(_norm(email))


def upsert_recipient(email, status="subscribed", consent_source="",
                     notes="", resubscribe=False):
    """Add or update a recipient. Never flips unsubscribed->subscribed unless
    resubscribe=True is passed explicitly."""
    email = _norm(email)
    if not email or "@" not in email:
        raise ValueError(f"invalid email: {email!r}")
    if status not in VALID_STATUSES:
        raise ValueError(f"invalid status: {status!r}")
    recs = _read_recipients()
    if email in recs:
        idx, row = recs[email]
        if row[1].strip() == "unsubscribed" and status == "subscribed" \
                and not resubscribe:
            raise PermissionError(
                f"{email} is unsubscribed; pass resubscribe=True to re-add")
        row[1] = status
        if consent_source:
            row[2] = consent_source
        if not row[3].strip():
            row[3] = _now()
        if notes:
            row[5] = (row[5] + "; " + notes).strip("; ") if row[5].strip() \
                else notes
        db.update_values(TAB_RECIPIENTS, f"A{idx}:G{idx}", [row])
    else:
        row = [email, status, consent_source, _now(), "", "0", notes]
        idx = max((i for i, _ in recs.values()), default=1) + 1
        db.update_values(TAB_RECIPIENTS, f"A{idx}:G{idx}", [row])
    return email


def set_status(email, status, notes=""):
    if status not in VALID_STATUSES:
        raise ValueError(f"invalid status: {status!r}")
    email = _norm(email)
    rec = get_recipient(email)
    if not rec:
        # Suppression for an unknown address: record it so future imports
        # cannot accidentally subscribe it.
        upsert_recipient(email, status=status,
                         consent_source="suppression-only", notes=notes)
        return
    idx, row = rec
    row[1] = status
    if notes:
        row[6] = (row[6] + "; " + notes).strip("; ") if row[6].strip() else notes
    db.update_values(TAB_RECIPIENTS, f"A{idx}:G{idx}", [row])


def record_sent(email, campaign):
    email = _norm(email)
    rec = get_recipient(email)
    if not rec:
        return
    idx, row = rec
    row[4] = campaign
    try:
        row[5] = str(int(row[5] or 0) + 1)
    except ValueError:
        row[5] = "1"
    db.update_values(TAB_RECIPIENTS, f"A{idx}:G{idx}", [row])


def list_eligible():
    """Emails with status == subscribed (the only ones the pipeline may send
    promotional mail to)."""
    return sorted(e for e, (_, r) in _read_recipients().items()
                  if r[1].strip() == "subscribed")


def log_send(campaign, to, template, status, detail=""):
    # ensure_tabs() is called once by the pipeline at startup; headers exist.
    vals = db.get_values(TAB_LOG, "A1:A5000")
    idx = len(vals) + 1 if vals else 2
    db.update_values(
        TAB_LOG, f"A{idx}:F{idx}",
        [[_now(), campaign, _norm(to), template, status, detail[:500]]])


def already_sent(campaign, to):
    """Dedup check: was this campaign already sent to this address?"""
    vals = db.get_values(TAB_LOG, "A1:F5000")
    to = _norm(to)
    for r in vals[1:]:
        r = db.pad(r, 6)
        if r[1].strip() == campaign and _norm(r[2]) == to \
                and r[4].strip() == "sent":
            return True
    return False


def get_log(campaign=None, limit=200):
    vals = db.get_values(TAB_LOG, "A1:F5000")
    rows = [db.pad(r, 6) for r in vals[1:]]
    if campaign:
        rows = [r for r in rows if r[1].strip() == campaign]
    return rows[-limit:]
