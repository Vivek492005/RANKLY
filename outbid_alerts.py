#!/usr/bin/env python3
"""Rankly outbid alerts (daily).

Emails claimants whose board rank dropped since the last check. State lives
in the "Alert state" sheet tab: Email | Board | Name | Link | Last rank | Updated.

Rules:
- Only claims with an email address are tracked.
- First sighting (or return after the weekly reset cleared the board) only
  sets the baseline silently — never an alert.
- An alert fires only when the current rank is worse (higher number) than the
  recorded rank. Rank improvements update the baseline silently.
- At most one email per person per run; the daily cron bounds it to one a day.
"""
import json
import subprocess
import sys
from datetime import datetime

sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import rankly_db as db

TAB_ALERTS = "Alert state"
ALERT_HEADERS = ["Email", "Board", "Name", "Link", "Last rank", "Updated"]
SITE = "https://vercel-app-ashen-eight.vercel.app"
BOARD_LABEL = {"profiles": "Student Leaderboard", "showcase": "Showcase board"}


def cli(*args):
    p = subprocess.run(["hatch_gws_cli", *args], capture_output=True, text=True)
    if p.returncode != 0:
        print("COMMAND FAILED:", " ".join(args[:8]), file=sys.stderr)
        print(p.stderr[:600], file=sys.stderr)
        sys.exit(1)
    return json.loads(p.stdout)


def ensure_alerts_tab():
    missing = False
    try:
        vals = db.get_values(TAB_ALERTS, "A1:F1")
    except SystemExit:
        vals = None
        missing = True
    if missing:
        cli("sheets", "spreadsheets", "batchUpdate", "--params",
            json.dumps({"spreadsheetId": db.SS}),
            "--json", json.dumps({"requests": [
                {"addSheet": {"properties": {"title": TAB_ALERTS}}}]}))
        db.update_values(TAB_ALERTS, "A1", [ALERT_HEADERS])
        print(f"created tab {TAB_ALERTS}")
    elif not vals or [c.strip() for c in vals[0]] != ALERT_HEADERS:
        db.update_values(TAB_ALERTS, "A1", [ALERT_HEADERS])
        print(f"wrote headers on {TAB_ALERTS}")


def claim_key(row):
    """Identity key for a claim row: email > link1 > name (mirrors boards).
    Folded through db.canonical_key so legacy 'email:…' keys match the
    hashed 'id:…' keys the boards now use."""
    email = row[6].strip().lower() if len(row) > 6 else ""
    if email:
        return db.canonical_key("email:" + email)
    li = row[7].strip().lower() if len(row) > 7 else ""
    if li:
        return "li:" + li
    return "name:" + (row[2].strip().lower() if len(row) > 2 else "")


def send_alert(email, name, board, old_rank, new_rank, dry_run):
    label = BOARD_LABEL.get(board, board)
    subject = f"You've been outbid on Rankly — now #{new_rank}"
    body = (
        f"Hi {name},\n\n"
        f"Heads up: your rank on Rankly just dropped. You're now #{new_rank} on the "
        f"{label} (was #{old_rank}).\n\n"
        f"Reclaim your spot: {SITE}\n\n"
        f"You're getting this because you claimed a rank with this email address.\n"
        f"— Rankly"
    )
    if dry_run:
        print(f"[dry-run] would email {email}: {subject}")
        return
    cli("gmail", "+send", "--to", email, "--subject", subject, "--body", body)
    print(f"alerted {email} ({board} #{old_rank} -> #{new_rank})")


def main():
    dry_run = "--dry-run" in sys.argv
    ensure_alerts_tab()

    profiles = db.read_profiles()
    works = db.read_showcase()

    prof_rank = {}
    for r in profiles:
        prof_rank[db.profile_key(r)] = int(r[0] or 0)
    work_rank = {}
    for r in works:
        link = r[4].strip().lower() if len(r) > 4 else ""
        if link:
            work_rank["link:" + link] = int(r[0] or 0)

    claim_vals = db.get_values(db.TAB_CLAIMS, "A1:R2000")
    claim_rows = [db.pad(r, 18) for r in claim_vals[1:]] if len(claim_vals) > 1 else []
    latest = {}
    for r in claim_rows:
        email = r[6].strip().lower()
        board = r[1].strip().lower()
        if not email or board not in ("profiles", "showcase"):
            continue
        latest[(email, board)] = r

    alert_vals = db.get_values(TAB_ALERTS, "A1:F2000")
    state = {}
    for r in (db.pad(x, 6) for x in alert_vals[1:] if len(alert_vals) > 1):
        if r[0].strip():
            state[(r[0].strip().lower(), r[1].strip().lower())] = r

    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    alerts = 0
    for (email, board), claim in sorted(latest.items()):
        key = claim_key(claim)
        board_map = prof_rank if board == "profiles" else work_rank
        rank = board_map.get(key)
        prev = state.get((email, board))
        prev_rank = db.num(prev[4]) if prev and prev[4].strip() else 0
        name = claim[2].strip() or "there"
        link = claim[7].strip()

        if not rank:
            # Off the board (e.g. after the Sunday reset): clear baseline silently.
            if prev_rank:
                state[(email, board)] = [email, board, name, link, "", now]
            continue
        if prev_rank and rank > prev_rank:
            send_alert(email, name, board, prev_rank, rank, dry_run)
            alerts += 1
        state[(email, board)] = [email, board, name, link, str(rank), now]

    if not dry_run:
        rows = [state[k] for k in sorted(state)]
        db.update_values(TAB_ALERTS, "A1", [ALERT_HEADERS] + rows)
    print(f"checked {len(latest)} tracked claims, sent {alerts} alerts")


if __name__ == "__main__":
    main()
