#!/usr/bin/env python3
"""Initialize the Rankly Database to the fresh student/showcase schema.

Re-runnable. Creates any missing tabs (Showcase, Archive (companies),
Payment inbox), writes the canonical headers on every tab, clears data rows
on the boards, and resets Site stats (keeps the Visitors counter).

It does NOT touch Claims / Payment inbox / Activity log data rows — only
their headers. The company-era leaderboard rows are expected to have been
archived to "Archive (companies)" by the migration script before first run.

Spreadsheet: Rankly Database (1FSWiEoLh8AgADL8jiFye4wOL5lt1KwjYjwSeeTBuy0o)
"""
import json

from rankly_db import (SS, TAB_PROFILES, TAB_TODAY, TAB_SHOWCASE, TAB_ACTIVITY,
                       TAB_CLAIMS, TAB_STATS, TAB_INBOX, TAB_ARCHIVE,
                       PROFILE_HEADERS, SHOWCASE_HEADERS, CLAIM_HEADERS,
                       ACTIVITY_HEADERS, STATS_HEADERS, INBOX_HEADERS,
                       ARCHIVE_HEADERS, cli, get_values, update_values,
                       clear_values, num)

TAB_HEADERS = {
    TAB_PROFILES: PROFILE_HEADERS,
    TAB_TODAY: PROFILE_HEADERS,
    TAB_SHOWCASE: SHOWCASE_HEADERS,
    TAB_ACTIVITY: ACTIVITY_HEADERS,
    TAB_CLAIMS: CLAIM_HEADERS,
    TAB_STATS: STATS_HEADERS,
    TAB_INBOX: INBOX_HEADERS,
    TAB_ARCHIVE: ARCHIVE_HEADERS,
}

# Tabs whose data rows are cleared on init (fresh boards).
CLEAR_TABS = {
    TAB_PROFILES: "A2:L1000",
    TAB_TODAY: "A2:L1000",
    TAB_SHOWCASE: "A2:I1000",
}


def existing_tabs():
    d = cli("sheets", "spreadsheets", "get", "--params",
            json.dumps({"spreadsheetId": SS,
                        "fields": "sheets.properties.title"}))
    return [s["properties"]["title"] for s in d.get("sheets", [])]


def ensure_tabs():
    have = set(existing_tabs())
    missing = [t for t in TAB_HEADERS if t not in have]
    if not missing:
        print("all tabs present")
        return
    requests = [{"addSheet": {"properties": {"title": t}}} for t in missing]
    cli("sheets", "spreadsheets", "batchUpdate", "--params",
        json.dumps({"spreadsheetId": SS}),
        "--json", json.dumps({"requests": requests}))
    print("created tabs:", ", ".join(missing))


def write_headers():
    for tab, headers in TAB_HEADERS.items():
        update_values(tab, "A1", [headers])
        print("headers:", tab)


def clear_boards():
    for tab, rng in CLEAR_TABS.items():
        clear_values(tab, rng)
        print("cleared:", tab)


def reset_stats():
    stats = get_values(TAB_STATS, "A1:C20")
    visitors = 28640
    if len(stats) > 1:
        for r in stats[1:]:
            if r and r[0].strip() == "Visitors":
                visitors = num(r[1]) if len(r) > 1 else visitors
    update_values(TAB_STATS, "A1", [STATS_HEADERS,
        ["Visitors", str(visitors), "demo counter"],
        ["Revenue (INR)", "0", "auto: sum of live bids"],
        ["Profiles listed", "0", "auto: profile count"],
        ["Works showcased", "0", "auto: showcase count"]])
    print("stats reset (visitors kept at %d)" % visitors)


if __name__ == "__main__":
    ensure_tabs()
    write_headers()
    clear_boards()
    reset_stats()
    print("done")
