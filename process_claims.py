#!/usr/bin/env python3
"""Apply verified Claims rows to the Rankly boards (profiles + showcase).

For every Claims row whose Status is "pending", "verified" or "approved":
route by the Board column ("profiles" -> Leaderboard (All time),
"showcase" -> Showcase), update the identity's bid (or insert), re-sort the
board, recompute ranks + stats, prepend an Activity log entry, and mark the
claim applied with its rank.

Rows at "Awaiting verification" (manual-UPI claims not yet confirmed) are
NEVER touched here — the bank-SMS webhook flips Status to "verified" after
confirming the payment, or an admin does it manually. Safe to re-run:
applied rows are skipped.

Claims layout: Timestamp | Board | Name | Headline | College | Skills |
Email | Link1 | Link2 | Link3 | Platform | Description | Bid (INR) |
Payment method | Rank achieved | Status | Payment ID | Photo

A claim with a Photo (Drive file ID) sets the profile's photo; a re-bid
with no photo keeps the profile's existing photo.
"""
from datetime import datetime

from rankly_db import (TAB_CLAIMS, CLAIM_HEADERS, BOARD_PROFILES, BOARD_SHOWCASE,
                       get_values, update_values, read_profiles, write_profiles,
                       read_showcase, write_showcase, refresh_stats,
                       log_activity, profile_key, canonical_key, num, pad)

# Explicit allowlist. Anything else ("awaiting verification", "", typos…)
# is left alone for a human to review.
APPLY_STATUSES = ("pending", "verified", "approved")


def claim_key(c, board):
    if board == BOARD_SHOWCASE:
        return c[7].strip().lower()  # Link1 = work link
    email = c[6].strip().lower()
    if email:
        return canonical_key("email:" + email)
    li = c[7].strip().lower()
    if li:
        return "li:" + li
    return "name:" + c[2].strip().lower()


def main():
    claims = get_values(TAB_CLAIMS, "A1:R500")
    pending = []
    for i, r in enumerate(claims[1:], 2):  # (sheet row number, row)
        if len(r) > 2 and r[2].strip():
            status = r[15].strip().lower() if len(r) > 15 else ""
            if status in APPLY_STATUSES:
                pending.append((i, pad(r, 18)))
    if not pending:
        print("no pending claims")
        return

    profiles = read_profiles()
    works = read_showcase()
    by_profile = {profile_key(r): r for r in profiles}
    by_work = {r[4].strip().lower(): r for r in works if len(r) > 4 and r[4].strip()}

    now = datetime.now().strftime("%-I:%M %p").lower()
    applied = 0
    for rownum, c in pending:
        board = c[1].strip().lower() or BOARD_PROFILES
        name, bid = c[2].strip(), num(c[12])
        key = claim_key(c, board)
        if board == BOARD_SHOWCASE:
            title, creator, platform = name, c[3].strip(), c[10].strip() or "Other"
            link, desc = c[7].strip(), c[11].strip()
            if key in by_work:
                r = by_work[key]
                r[1], r[2], r[3] = title, creator, platform
                r[5], r[6], r[8] = desc, str(bid), "now"
            else:
                r = ["", title, creator, platform, link, desc, str(bid), "0", "now"]
                works.append(r)
                by_work[key] = r
            works = write_showcase(works)
            rank = next((str(i) for i, r in enumerate(works, 1)
                         if r[4].strip().lower() == key), "?")
            log_activity(title, f"showcased at rank #{rank} with a \u20b9{bid:,} bid", now)
        else:
            headline, college, skills = c[3].strip(), c[4].strip(), c[5].strip()
            email, li, gh, coding = (c[6].strip(), c[7].strip(), c[8].strip(), c[9].strip())
            photo = c[17].strip()
            if key in by_profile:
                r = by_profile[key]
                r[2], r[3], r[4] = headline, college, skills
                r[5], r[6], r[7], r[8] = li, gh, coding, email
                r[9], r[11] = str(bid), "now"
                if photo:
                    r[12] = photo  # new photo replaces; empty keeps existing
            else:
                r = ["", name, headline, college, skills, li, gh, coding,
                     email, str(bid), "0", "now", photo]
                profiles.append(r)
                by_profile[profile_key(r)] = r
            profiles = write_profiles(profiles)
            rank = next((str(i) for i, r in enumerate(profiles, 1)
                         if profile_key(r) == key), "?")
            log_activity(name, f"claimed rank #{rank} with a \u20b9{bid:,} bid", now)
        update_values(TAB_CLAIMS, f"O{rownum}:P{rownum}", [[rank, "applied"]])
        applied += 1

    revenue = refresh_stats(profiles, works)
    print(f"applied {applied} claim(s); {len(profiles)} profiles, "
          f"{len(works)} works; revenue \u20b9{revenue:,}")


if __name__ == "__main__":
    main()
