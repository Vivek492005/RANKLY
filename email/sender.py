#!/usr/bin/env python3
"""Quota-aware sending pipeline for Rankly email.

Guarantees:
- Only `subscribed` recipients are ever sent to (see store.list_eligible).
- Dedup: an address already logged as `sent` for this campaign id is skipped,
  so re-running a campaign resumes instead of duplicating.
- Quota guard: pauses the campaign at 80% of DAILY_QUOTA (default 400/day,
  deliberately conservative — the Gmail API consumer limit is higher, but the
  brief forbids treating the maximum as a target).
- Per-recipient errors are logged and skipped; the pipeline continues.
- Account-level errors (auth / quota / rate-limit) abort the campaign at once.
- Pause/resume: touching `email/state/<campaign>.pause` pauses between sends;
  deleting it and re-running resumes via the send log.
- Every send goes out as raw MIME with a `List-Unsubscribe: <mailto:…>`
  header so recipients can opt out in one step from their mail client.

Nothing is sent without an explicit campaign id + --confirm. Default is
--dry-run.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from email import store

SENDER = os.environ.get("RANKLY_SENDER_EMAIL", "sochai.hr@gmail.com")
DAILY_QUOTA = int(os.environ.get("RANKLY_DAILY_QUOTA", "400"))
STATE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "state")

ACCOUNT_ERROR_MARKERS = (
    "invalid_grant", "unauthorized", "rateLimitExceeded", "quotaExceeded",
    "userRateLimitExceeded", "dailyLimitExceeded", "403", "429",
)


class AccountError(RuntimeError):
    """Auth / quota / rate-limit failure: abort the whole campaign."""


def _cli(*args):
    p = subprocess.run(["hatch_gws_cli", *args],
                       capture_output=True, text=True)
    if p.returncode != 0:
        err = (p.stderr or "")[:500]
        if any(m in err for m in ACCOUNT_ERROR_MARKERS):
            raise AccountError(err)
        raise RuntimeError(err)
    return json.loads(p.stdout) if p.stdout.strip() else {}


def _rfc2822_date():
    return datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")


def build_mime(to_email, subject, body, is_html=False):
    """Build a raw .eml file (manual MIME — avoids clashing with the stdlib
    `email` package name). Returns the file path (caller deletes it)."""
    if not subject.isascii():
        raise ValueError("subject must be ASCII for manual MIME building")
    boundary = "rankly-" + uuid.uuid4().hex
    lines = [
        f"From: {SENDER}",
        f"To: {to_email}",
        f"Subject: {subject}",
        f"Date: {_rfc2822_date()}",
        f"Message-ID: <{uuid.uuid4().hex}@gmail.com>",
        "MIME-Version: 1.0",
        f"List-Unsubscribe: <mailto:{SENDER}?subject=unsubscribe>",
    ]
    if is_html:
        lines.append(f'Content-Type: multipart/alternative; boundary="{boundary}"')
        lines.append("")
        lines.append(f"--{boundary}")
        lines.append('Content-Type: text/plain; charset="utf-8"')
        lines.append("Content-Transfer-Encoding: 8bit")
        lines.append("")
        lines.append("This message requires an HTML-capable mail client. "
                     "Visit https://ranklyy.vercel.app for the Rankly update.")
        lines.append("")
        lines.append(f"--{boundary}")
        lines.append('Content-Type: text/html; charset="utf-8"')
        lines.append("Content-Transfer-Encoding: 8bit")
        lines.append("")
        lines.append(body)
        lines.append("")
        lines.append(f"--{boundary}--")
    else:
        lines.append('Content-Type: text/plain; charset="utf-8"')
        lines.append("Content-Transfer-Encoding: 8bit")
        lines.append("")
        lines.append(body)
    fd, path = tempfile.mkstemp(suffix=".eml", prefix="rankly-mail-")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write("\r\n".join(lines) + "\r\n")
    return path


def send_one(to_email, subject, body, is_html=False, dry_run=False):
    """Send a single message. Returns (status, detail)."""
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", to_email):
        return "skipped", "invalid address format"
    if dry_run:
        return "sent", "dry-run"
    path = build_mime(to_email, subject, body, is_html)
    try:
        _cli("gmail", "users", "messages", "send",
             "--params", json.dumps({"userId": "me"}),
             "--upload", path)
        return "sent", "api accepted"
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def _quota_path():
    os.makedirs(STATE_DIR, exist_ok=True)
    return os.path.join(STATE_DIR, "quota.json")


def quota_used_today():
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    try:
        with open(_quota_path()) as f:
            d = json.load(f)
        return d.get("count", 0) if d.get("date") == today else 0
    except (OSError, ValueError):
        return 0


def quota_bump():
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    used = quota_used_today()
    with open(_quota_path(), "w") as f:
        json.dump({"date": today, "count": used + 1}, f)


def pause_requested(campaign_id):
    return os.path.exists(os.path.join(STATE_DIR, campaign_id + ".pause"))


def send_campaign(campaign_id, recipients, render, template_name,
                  dry_run=True, quota=None):
    """Send one campaign. `render(email)` -> (display_name, subject, body,
    is_html) or (subject, body, is_html). Returns a stats dict.

    recipients: iterable of email addresses (already eligibility-filtered by
    the caller via store.list_eligible()).
    """
    quota = DAILY_QUOTA if quota is None else quota
    store.ensure_tabs()
    stats = {"campaign": campaign_id, "sent": 0, "failed": 0, "skipped": 0,
             "paused": False, "aborted": None}
    seen = set()
    for to_email in recipients:
        to_email = to_email.strip().lower()
        if not to_email or to_email in seen:
            stats["skipped"] += 1
            continue
        seen.add(to_email)
        if pause_requested(campaign_id):
            stats["paused"] = True
            print(f"[{campaign_id}] pause file present — stopping")
            break
        if store.already_sent(campaign_id, to_email):
            stats["skipped"] += 1
            store.log_send(campaign_id, to_email, template_name,
                           "skipped", "duplicate: already sent")
            continue
        if not dry_run and quota_used_today() >= int(quota * 0.8):
            stats["paused"] = True
            stats["aborted"] = f"quota guard: {quota_used_today()}/{quota}"
            print(f"[{campaign_id}] {stats['aborted']} — stopping")
            break
        rendered = render(to_email)
        if len(rendered) == 4:
            _, subject, body, is_html = rendered
        else:
            subject, body, is_html = rendered
        try:
            status, detail = send_one(to_email, subject, body, is_html,
                                      dry_run=dry_run)
        except AccountError as e:
            stats["aborted"] = f"account error: {e}"
            store.log_send(campaign_id, to_email, template_name,
                           "failed", f"account error: {e}"[:500])
            print(f"[{campaign_id}] ABORT: {e}")
            break
        except Exception as e:  # transient / per-recipient failure: retry once
            try:
                time.sleep(5)
                status, detail = send_one(to_email, subject, body, is_html,
                                          dry_run=dry_run)
                detail = "retry: " + detail
            except AccountError as e2:
                stats["aborted"] = f"account error on retry: {e2}"
                store.log_send(campaign_id, to_email, template_name,
                               "failed", f"account error: {e2}"[:500])
                break
            except Exception as e2:
                status, detail = "failed", f"after retry: {e2}"[:500]
        store.log_send(campaign_id, to_email, template_name,
                       "dry-run" if dry_run and status == "sent" else status,
                       detail)
        if status == "sent":
            stats["sent"] += 1
            if not dry_run:
                quota_bump()
                store.record_sent(to_email, campaign_id)
        elif status == "failed":
            stats["failed"] += 1
        else:
            stats["skipped"] += 1
    print(f"[{campaign_id}] done: {stats}")
    return stats


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="Rankly quota-aware mail sender")
    ap.add_argument("--campaign", required=True)
    ap.add_argument("--template", choices=["a", "b", "c"], default="a")
    ap.add_argument("--to", help="comma-separated override recipients "
                                 "(must still be subscribed)")
    ap.add_argument("--dry-run", action="store_true", default=True)
    ap.add_argument("--confirm", action="store_true",
                    help="actually send (default is dry-run)")
    ap.add_argument("--quota", type=int, default=DAILY_QUOTA)
    args = ap.parse_args()

    from email import templates as t
    if args.to:
        wanted = [e.strip().lower() for e in args.to.split(",")]
        eligible = set(store.list_eligible())
        recips = [e for e in wanted if e in eligible]
        skipped = [e for e in wanted if e not in eligible]
        if skipped:
            print(f"refusing to send to non-subscribed: {skipped}")
    else:
        recips = store.list_eligible()

    def render(to_email):
        if args.template == "b":
            return t.variant_b_minimal_html(to_email.split("@")[0])
        if args.template == "c":
            return t.variant_c_reengagement(
                to_email.split("@")[0], "had a Rankly claim")
        return t.variant_a_product_update(to_email.split("@")[0])

    send_campaign(args.campaign, recips, render, args.template,
                  dry_run=not args.confirm, quota=args.quota)
