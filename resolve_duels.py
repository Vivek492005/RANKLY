#!/usr/bin/env python3
"""Duel resolver (runs hourly).

Finds active duels whose 24h window has ended, compares each side's current
board bid against the bid recorded at duel start, and writes the outcome:
- bigger bid increase wins;
- tie on increase -> higher final bid wins;
- still tied -> "draw".
Done duels feed the Duel Hall of Fame on the profiles page.
"""
import sys
from datetime import datetime

sys.path.insert(0, "/home/hatch/workspace/rankly")
import rankly_db as db


def parse_ts(s):
    s = str(s).strip()
    # ISO-8601 (what /api/duels now writes) or the legacy "YYYY-MM-DD HH:MM:SS".
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except (ValueError, TypeError):
        pass
    try:
        return datetime.strptime(s, "%Y-%m-%d %H:%M:%S").timestamp()
    except (ValueError, TypeError):
        return 0


def decide_winner(d):
    c_gain = d["c_end"] - d["c_start"]
    o_gain = d["o_end"] - d["o_start"]
    if c_gain != o_gain:
        return d["challenger"] if c_gain > o_gain else d["opponent"]
    if d["c_end"] != d["o_end"]:
        return d["challenger"] if d["c_end"] > d["o_end"] else d["opponent"]
    return "draw"


def main():
    db.ensure_tab(db.TAB_DUELS, db.DUEL_HEADERS)
    duels = db.read_duels()
    if not duels:
        print("duel resolver: no duels on record")
        return
    now = datetime.now().timestamp()
    profiles = {db.profile_key(r): db.num(r[9]) for r in db.read_profiles()}
    resolved = 0
    for d in duels:
        if d["status"] != "active":
            continue
        if parse_ts(d["ends"]) > now:
            continue
        d["c_end"] = profiles.get(d["challenger_key"], d["c_start"])
        d["o_end"] = profiles.get(d["opponent_key"], d["o_start"])
        winner = decide_winner(d)
        db.update_duel(d["rownum"], d["c_end"], d["o_end"], winner)
        db.log_activity("Rankly",
                        f"duel result: {d['challenger']} vs {d['opponent']} — "
                        f"{'draw' if winner == 'draw' else winner + ' wins'}",
                        datetime.now().strftime("%-I:%M %p").lower())
        print(f"resolved {d['id']}: {winner}")
        resolved += 1
    print(f"duel resolver ok: {resolved} resolved, "
          f"{sum(1 for d in duels if d['status'] == 'active')} still active")


if __name__ == "__main__":
    main()
