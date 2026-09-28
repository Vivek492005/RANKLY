#!/usr/bin/env python3
"""Weekly Rankly reset (runs every Sunday ~00:05 IST).

- Archives the current profiles + showcase boards into the "Weekly Archive"
  tab (Week N, with start/end dates), so no ranking data is ever deleted.
- Clears both boards (and Today) back to headers-only: a fresh ranking week.
- Recomputes Site stats (revenue/profiles/works reset to 0) and logs the
  reset in the Activity log.

Week numbers only advance when a reset actually archives something: if both
boards are already empty, the run is a no-op (also makes it idempotent).
"""
from datetime import date, timedelta
import json
import subprocess
import sys

from rankly_db import (SS, TAB_PROFILES, TAB_TODAY, TAB_SHOWCASE, TAB_ACTIVITY,
                       TAB_WEEKS, PROFILE_HEADERS, SHOWCASE_HEADERS,
                       WEEKS_HEADERS, BOARD_PROFILES, BOARD_SHOWCASE,
                       read_profiles, read_showcase, log_activity,
                       refresh_stats, num, latest_claim_time, ensure_tab,
                       clear_values)

TAB_RESET_LOG = "Reset Log"
RESET_LOG_HEADERS = ["Week", "Start date", "End date", "Completed at", "Profiles", "Works"]


def cli(*args):
    p = subprocess.run(["hatch_gws_cli", *args], capture_output=True, text=True)
    if p.returncode != 0:
        print("COMMAND FAILED:", " ".join(args[:8]), file=sys.stderr)
        print(p.stderr[:600], file=sys.stderr)
        sys.exit(1)
    return json.loads(p.stdout)


def ensure_weeks_tab():
    ensure_tab(TAB_WEEKS, WEEKS_HEADERS)


def append_rows(values):
    cli("sheets", "spreadsheets", "values", "append", "--params",
        json.dumps({"spreadsheetId": SS, "range": f"{TAB_WEEKS}!A1:L1",
                    "valueInputOption": "USER_ENTERED",
                    "insertDataOption": "INSERT_ROWS"}),
        "--json", json.dumps({"values": values}))


def append_log_row(values):
    cli("sheets", "spreadsheets", "values", "append", "--params",
        json.dumps({"spreadsheetId": SS, "range": f"{TAB_RESET_LOG}!A1:F1",
                    "valueInputOption": "USER_ENTERED",
                    "insertDataOption": "INSERT_ROWS"}),
        "--json", json.dumps({"values": [values]}))


def main():
    from rankly_db import get_values, update_values
    from datetime import datetime
    import time

    ensure_weeks_tab()

    # Snipe protection: if any claim landed in the last 120 seconds, hold the
    # reset until 120 seconds pass with no new claims (max 15 min overtime).
    # The site shows an "OVERTIME" state while this runs.
    waited = 0
    while True:
        last = latest_claim_time()
        now = datetime.now().timestamp()
        if last is None or now - last >= 120 or waited >= 900:
            break
        if waited == 0:
            print("snipe detected: holding reset until bidding cools down")
        time.sleep(30)
        waited += 30
    if waited:
        mins = waited // 60
        print(f"snipe overtime: reset delayed {mins}m {waited % 60}s")
        log_activity("Rankly",
                     f"snipe overtime: Week reset delayed {mins}m {waited % 60}s by last-minute bidding",
                     datetime.now().strftime("%-I:%M %p").lower())

    profiles = read_profiles()
    works = read_showcase()

    end = date.today()
    start = end - timedelta(days=7)
    start_s, end_s = start.isoformat(), end.isoformat()

    vals = get_values(TAB_WEEKS, "A1:C2000")
    archived_weeks = [int(r[0]) for r in vals[1:]
                      if len(r) > 1 and r[1] == start_s and str(r[0]).isdigit()]
    if archived_weeks:
        # A previous run archived this week but crashed before clearing the
        # boards: reuse its week number and skip re-archiving (no duplicates).
        week = archived_weeks[0]
        print(f"weekly reset: week {week} ({start_s}) already archived — skipping re-archive")
    elif not profiles and not works:
        print("weekly reset: boards already empty, nothing to archive")
        return
    else:
        week = max([num(r[0]) for r in vals[1:]] + [0]) + 1
        rows = []
        for r in sorted(profiles, key=lambda x: num(x[9]), reverse=True):
            rows.append([week, start_s, end_s, BOARD_PROFILES, r[0], r[1], r[2],
                         r[3], r[4], r[5], "", r[9]])
        for r in sorted(works, key=lambda x: num(x[6]), reverse=True):
            rows.append([week, start_s, end_s, BOARD_SHOWCASE, r[0], r[1], r[2],
                         "", "", r[4], r[3], r[6]])
        append_rows([[str(c) for c in row] for row in rows])

    # Clear boards back to headers-only. clear_values is required:
    # update_values("A1", [headers]) alone would leave old rows 2..N intact.
    # Clearing is idempotent, so a rerun after a crash is safe.
    for tab, headers in ((TAB_PROFILES, PROFILE_HEADERS),
                         (TAB_TODAY, PROFILE_HEADERS),
                         (TAB_SHOWCASE, SHOWCASE_HEADERS)):
        clear_values(tab, "A2:Z2000")
        update_values(tab, "A1", [headers])
    refresh_stats([], [])
    ensure_tab(TAB_RESET_LOG, RESET_LOG_HEADERS)
    log_vals = get_values(TAB_RESET_LOG, "A1:C200")
    if not any(len(r) > 1 and r[1] == start_s for r in log_vals[1:]):
        append_log_row([str(week), start_s, end_s,
                        datetime.now().isoformat(timespec="seconds"),
                        str(len(profiles)), str(len(works))])
    now = datetime.now().strftime("%-I:%M %p").lower()
    log_activity("Rankly", f"Week {week} archived ({start_s} to {end_s}) - fresh rankings begin", now)
    print(f"weekly reset ok: archived week {week} "
          f"({len(profiles)} profiles, {len(works)} works), boards cleared")


if __name__ == "__main__":
    main()
