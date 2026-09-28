#!/usr/bin/env python3
"""Daily board snapshot (runs ~23:55 IST).

Appends the day's top-10 profiles and top-10 works to the "Daily Snapshots"
tab. Drives the Week Replay page. Idempotent: skips when today's date is
already recorded.
"""
import sys
from datetime import date

sys.path.insert(0, "/home/hatch/workspace/rankly")
import rankly_db as db


def main():
    db.ensure_tab(db.TAB_SNAPSHOTS, db.SNAPSHOT_HEADERS)
    today = date.today().isoformat()
    try:
        vals = db.get_values(db.TAB_SNAPSHOTS, "A1:A5000")
    except SystemExit:
        vals = []
    if any(vals[1:]) and any(str(r[0]).strip() == today for r in vals[1:] if r):
        print(f"daily snapshot: {today} already recorded, skipping")
        return

    profiles = sorted(db.read_profiles(), key=lambda r: db.num(r[9]), reverse=True)[:10]
    works = sorted(db.read_showcase(), key=lambda r: db.num(r[6]), reverse=True)[:10]
    rows = []
    for i, r in enumerate(profiles, 1):
        rows.append([today, db.BOARD_PROFILES, str(i), r[1].strip(),
                     r[3].strip(), str(db.num(r[9]))])
    for i, r in enumerate(works, 1):
        rows.append([today, db.BOARD_SHOWCASE, str(i), r[1].strip(),
                     r[2].strip(), str(db.num(r[6]))])
    if not rows:
        print("daily snapshot: boards empty, nothing recorded")
        return
    db.cli("sheets", "spreadsheets", "values", "append", "--params",
           __import__("json").dumps({"spreadsheetId": db.SS,
                                     "range": f"{db.TAB_SNAPSHOTS}!A1:F1",
                                     "valueInputOption": "USER_ENTERED",
                                     "insertDataOption": "INSERT_ROWS"}),
           "--json", __import__("json").dumps({"values": rows}))
    print(f"daily snapshot ok: {today} ({len(profiles)} profiles, {len(works)} works)")


if __name__ == "__main__":
    main()
