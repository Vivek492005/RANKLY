#!/usr/bin/env python3
"""Daily Rankly database maintenance.

- Re-sorts both boards (profiles + showcase) by bid (desc), rewrites ranks.
- Recomputes Site stats from live board data.
- Verifies every tab still has its header row; restores any missing header.
Prints a one-line health summary.
"""
from rankly_db import (TAB_PROFILES, TAB_TODAY, TAB_SHOWCASE, TAB_ACTIVITY,
                       TAB_CLAIMS, TAB_STATS, TAB_INBOX, TAB_ARCHIVE, TAB_WEEKS,
                       PROFILE_HEADERS, SHOWCASE_HEADERS, CLAIM_HEADERS,
                       ACTIVITY_HEADERS, STATS_HEADERS, INBOX_HEADERS,
                       ARCHIVE_HEADERS, WEEKS_HEADERS, get_values, update_values,
                       read_profiles, write_profiles, read_showcase,
                       write_showcase, refresh_stats)


def ensure_headers():
    for tab, headers in (
            (TAB_PROFILES, PROFILE_HEADERS), (TAB_TODAY, PROFILE_HEADERS),
            (TAB_SHOWCASE, SHOWCASE_HEADERS), (TAB_ACTIVITY, ACTIVITY_HEADERS),
            (TAB_CLAIMS, CLAIM_HEADERS), (TAB_STATS, STATS_HEADERS),
            (TAB_INBOX, INBOX_HEADERS), (TAB_ARCHIVE, ARCHIVE_HEADERS),
            (TAB_WEEKS, WEEKS_HEADERS)):
        try:
            vals = get_values(tab, "A1:Z1")
        except SystemExit:
            raise
        except Exception:
            print(f"WARNING: could not read tab {tab}; skipping header check")
            continue
        if not vals or [c.strip() for c in vals[0]] != headers:
            update_values(tab, "A1", [headers])
            print(f"restored headers on {tab}")


def main():
    ensure_headers()
    profiles = write_profiles(read_profiles())
    works = write_showcase(read_showcase())
    revenue = refresh_stats(profiles, works)
    top = f", top profile bid \u20b9{profiles[0][9]} ({profiles[0][1]})" if profiles else ""
    print(f"maintenance ok: {len(profiles)} profiles, {len(works)} works, "
          f"revenue \u20b9{revenue:,}{top}")


if __name__ == "__main__":
    main()
