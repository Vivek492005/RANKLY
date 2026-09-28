#!/usr/bin/env python3
"""Shared helpers for Rankly database automation (Google Sheets via hatch_gws_cli).

Schema (post-pivot): student profiles board + showcase board.
  Leaderboard (All time) / Today: Rank | Name | Headline | College | Skills |
      LinkedIn | GitHub | Coding profile | Email | Bid (INR) | Clicks | Age
  Showcase: Rank | Work title | Creator | Platform | Link | Description |
      Bid (INR) | Clicks | Age
  Claims: Timestamp | Board | Name | Headline | College | Skills | Email |
      Link1 | Link2 | Link3 | Platform | Description | Bid (INR) |
      Payment method | Rank achieved | Status | Payment ID
  Activity log: Time | Name | Action
  Site stats: Metric | Value | Note
  Payment inbox: Timestamp | Amount (INR) | UTR | Raw SMS | Status
  Archive (companies): pre-pivot company leaderboard (history only).
"""
import hashlib
import json
import subprocess
import sys

SS = "1FSWiEoLh8AgADL8jiFye4wOL5lt1KwjYjwSeeTBuy0o"
TAB_PROFILES = "Leaderboard (All time)"
TAB_TODAY = "Today"
TAB_SHOWCASE = "Showcase"
TAB_ACTIVITY = "Activity log"
TAB_CLAIMS = "Claims"
TAB_STATS = "Site stats"
TAB_INBOX = "Payment inbox"
TAB_ARCHIVE = "Archive (companies)"
TAB_WEEKS = "Weekly Archive"

PROFILE_HEADERS = ["Rank", "Name", "Headline", "College", "Skills", "LinkedIn",
                   "GitHub", "Coding profile", "Email", "Bid (INR)", "Clicks", "Age",
                   "Photo"]
SHOWCASE_HEADERS = ["Rank", "Work title", "Creator", "Platform", "Link",
                    "Description", "Bid (INR)", "Clicks", "Age"]
CLAIM_HEADERS = ["Timestamp", "Board", "Name", "Headline", "College", "Skills",
                 "Email", "Link1", "Link2", "Link3", "Platform", "Description",
                 "Bid (INR)", "Payment method", "Rank achieved", "Status",
                 "Payment ID", "Photo"]
ACTIVITY_HEADERS = ["Time", "Name", "Action"]
STATS_HEADERS = ["Metric", "Value", "Note"]
INBOX_HEADERS = ["Timestamp", "Amount (INR)", "UTR", "Raw SMS", "Status"]
ARCHIVE_HEADERS = ["Rank", "Product name", "URL", "Category", "Description",
                   "Bid (INR)", "Clicks", "Age"]
# Weekly Archive: snapshot of both boards at each Sunday reset. Week numbers
# only advance when a reset archives something (skipped on empty boards).
WEEKS_HEADERS = ["Week", "Start date", "End date", "Board", "Rank", "Name",
                 "Headline", "College", "Skills", "Link", "Platform", "Bid (INR)"]
# Proof verifications (GitHub / LeetCode public stats), keyed by the same
# identity key the web backend uses (email:… / li:… / name:…).
VERIFY_HEADERS = ["Key", "GitHub user", "GH stars", "GH repos", "GH followers",
                  "LeetCode user", "LC rating", "LC solved", "Updated"]
TAB_VERIFY = "Verifications"
# Head-to-head 24h bid duels between two profiles.
DUEL_HEADERS = ["Duel ID", "Challenger", "Challenger key", "Opponent", "Opponent key",
                "Challenger start bid", "Opponent start bid", "Challenger end bid",
                "Opponent end bid", "Winner", "Status", "Created", "Ends"]
TAB_DUELS = "Duels"
# Daily top-10 snapshots of both boards (drives the Week Replay page).
SNAPSHOT_HEADERS = ["Date", "Board", "Rank", "Name", "Extra", "Bid"]
TAB_SNAPSHOTS = "Daily Snapshots"

BOARD_PROFILES = "profiles"
BOARD_SHOWCASE = "showcase"


def cli(*args):
    p = subprocess.run(["hatch_gws_cli", *args], capture_output=True, text=True)
    if p.returncode != 0:
        print("COMMAND FAILED:", " ".join(args[:8]), file=sys.stderr)
        print(p.stderr[:600], file=sys.stderr)
        sys.exit(1)
    return json.loads(p.stdout)


def num(s):
    return int(float("".join(c for c in str(s or "") if c.isdigit() or c in ".-") or 0))


def pad(r, n):
    while len(r) < n:
        r.append("")
    return r


def get_values(tab, rng):
    d = cli("sheets", "spreadsheets", "values", "get", "--params",
            json.dumps({"spreadsheetId": SS, "range": f"{tab}!{rng}"}))
    return d.get("values", [])


def update_values(tab, rng, values):
    cli("sheets", "spreadsheets", "values", "update", "--params",
        json.dumps({"spreadsheetId": SS, "range": f"{tab}!{rng}",
                    "valueInputOption": "USER_ENTERED"}),
        "--json", json.dumps({"values": values}))


def clear_values(tab, rng):
    cli("sheets", "spreadsheets", "values", "clear", "--params",
        json.dumps({"spreadsheetId": SS, "range": f"{tab}!{rng}"}))


def _hash_email(email):
    return hashlib.sha256(email.strip().lower().encode()).hexdigest()[:16]


def canonical_key(k):
    """Fold legacy 'email:…' keys into the hashed 'id:…' form."""
    s = str(k or "")
    if s.startswith("email:"):
        return "id:" + _hash_email(s[6:])
    return s


def profile_key(row):
    """Identity key for a profile row: hashed email > LinkedIn URL > lowercased name."""
    email = row[8].strip().lower() if len(row) > 8 else ""
    if email:
        return "id:" + _hash_email(email)
    li = row[5].strip().lower() if len(row) > 5 else ""
    if li:
        return "li:" + li
    name = row[1].strip().lower() if len(row) > 1 else ""
    return "name:" + name


def work_key(title):
    """Identity key for a showcase row: lowercased work title."""
    return "work:" + str(title or "").strip().lower()


def read_profiles():
    vals = get_values(TAB_PROFILES, "A1:M200")
    rows = [pad(r, 13) for r in vals[1:]] if len(vals) > 1 else []
    return [r for r in rows if len(r) > 2 and r[1].strip()]


def write_profiles(rows):
    rows = sorted(rows, key=lambda r: num(r[9]), reverse=True)
    for i, r in enumerate(rows, 1):
        pad(r, 13)
        r[0] = str(i)
    update_values(TAB_PROFILES, "A1", [PROFILE_HEADERS] + rows)
    return rows


def read_showcase():
    vals = get_values(TAB_SHOWCASE, "A1:I200")
    rows = [pad(r, 9) for r in vals[1:]] if len(vals) > 1 else []
    return [r for r in rows if len(r) > 2 and r[1].strip()]


def ensure_tab(title, headers):
    """Create a tab with headers if missing; add headers to an existing-but-empty tab."""
    try:
        vals = get_values(title, "A1:Z1")
    except SystemExit:
        vals = None
    if vals:
        return False
    if vals is None:
        # Tab does not exist — create it.
        cli("sheets", "spreadsheets", "batchUpdate", "--params",
            json.dumps({"spreadsheetId": SS}),
            "--json", json.dumps({"requests": [
                {"addSheet": {"properties": {"title": title}}}]}))
        print(f"created tab {title}")
    else:
        print(f"tab {title} exists but is empty — writing headers")
    update_values(title, "A1", [headers])
    return True


def latest_claim_time():
    """Newest Claims timestamp as epoch seconds, or None."""
    from datetime import datetime
    try:
        vals = get_values(TAB_CLAIMS, "A1:A500")
    except SystemExit:
        return None
    latest = 0
    for r in vals[1:]:
        try:
            t = datetime.strptime(str(r[0]).strip(), "%Y-%m-%d %H:%M:%S").timestamp()
        except (ValueError, IndexError):
            continue
        if t > latest:
            latest = t
    return latest or None


def read_duels():
    try:
        vals = get_values(TAB_DUELS, "A1:M100")
    except SystemExit:
        return []
    duels = []
    for i, r in enumerate(vals[1:]):
        p = pad(r, 13)
        if not p[0].strip():
            continue
        duels.append({
            "rownum": i + 2, "id": p[0].strip(), "challenger": p[1].strip(),
            "challenger_key": canonical_key(p[2].strip()), "opponent": p[3].strip(),
            "opponent_key": canonical_key(p[4].strip()), "c_start": num(p[5]), "o_start": num(p[6]),
            "c_end": num(p[7]), "o_end": num(p[8]), "winner": p[9].strip(),
            "status": p[10].strip() or "active", "created": p[11].strip(),
            "ends": p[12].strip(),
        })
    return duels


def update_duel(rownum, c_end, o_end, winner, status="done"):
    update_values(TAB_DUELS, f"H{rownum}:K{rownum}",
                  [[str(c_end), str(o_end), winner or "", status]])


def read_verifications():
    try:
        vals = get_values(TAB_VERIFY, "A1:I300")
    except SystemExit:
        return {}
    out = {}
    for r in vals[1:]:
        p = pad(r, 9)
        if p[0].strip():
            out[p[0].strip()] = {
                "gh_user": p[1].strip(), "gh_stars": num(p[2]),
                "gh_repos": num(p[3]), "gh_followers": num(p[4]),
                "lc_user": p[5].strip(), "lc_rating": num(p[6]),
                "lc_solved": num(p[7]),
            }
    return out


def upsert_verification(key, fields):
    """fields: dict with any of gh_user/gh_stars/gh_repos/gh_followers/
    lc_user/lc_rating/lc_solved. Missing fields keep their current values."""
    from datetime import datetime
    ensure_tab(TAB_VERIFY, VERIFY_HEADERS)
    vals = get_values(TAB_VERIFY, "A1:I300")
    rownum = None
    cur = [""] * 9
    for i, r in enumerate(vals[1:]):
        if r and str(r[0]).strip() == key:
            rownum = i + 2
            cur = pad(list(r), 9)
            break
    order = ["gh_user", "gh_stars", "gh_repos", "gh_followers",
             "lc_user", "lc_rating", "lc_solved"]
    nxt = [key] + [str(fields.get(k, cur[i + 1] or "")) for i, k in enumerate(order)]
    nxt.append(datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    if rownum:
        update_values(TAB_VERIFY, f"A{rownum}:I{rownum}", [nxt])
    else:
        cli("sheets", "spreadsheets", "values", "append", "--params",
            json.dumps({"spreadsheetId": SS, "range": f"{TAB_VERIFY}!A1:I1",
                        "valueInputOption": "USER_ENTERED",
                        "insertDataOption": "INSERT_ROWS"}),
            "--json", json.dumps({"values": [nxt]}))


def write_showcase(rows):
    rows = sorted(rows, key=lambda r: num(r[6]), reverse=True)
    for i, r in enumerate(rows, 1):
        pad(r, 9)
        r[0] = str(i)
    update_values(TAB_SHOWCASE, "A1", [SHOWCASE_HEADERS] + rows)
    return rows


def log_activity(name, action, now):
    acts = get_values(TAB_ACTIVITY, "A1:C50")
    acts = [pad(r, 3) for r in acts[1:]] if len(acts) > 1 else []
    acts.insert(0, [now, name, action])
    update_values(TAB_ACTIVITY, "A1", [ACTIVITY_HEADERS] + acts[:20])


def refresh_stats(profiles, works):
    revenue = sum(num(r[9]) for r in profiles) + sum(num(r[6]) for r in works)
    stats = get_values(TAB_STATS, "A1:C20")
    visitors = 28640
    if len(stats) > 1:
        for r in stats[1:]:
            if r and r[0].strip() == "Visitors":
                visitors = num(r[1]) if len(r) > 1 else visitors
    update_values(TAB_STATS, "A1", [STATS_HEADERS,
        ["Visitors", str(visitors), "demo counter"],
        ["Revenue (INR)", str(revenue), "auto: sum of live bids"],
        ["Profiles listed", str(len(profiles)), "auto: profile count"],
        ["Works showcased", str(len(works)), "auto: showcase count"]])
    return revenue
