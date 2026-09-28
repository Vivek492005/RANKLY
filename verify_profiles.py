#!/usr/bin/env python3
"""Proof verifier (runs daily ~06:30 IST).

For every profile on the board, pulls public stats into the "Verifications"
tab, shown as verified chips on the leaderboard:
- GitHub: stars (summed across repos), repo count, followers.
- LeetCode: contest rating + total problems solved.

Usernames come from the profile's GitHub / coding-profile links (queued by
/api/submit-claim) or from existing verification rows. All APIs are public
and unauthenticated; failures leave the row untouched.
"""
import json
import re
import sys
import urllib.request
from urllib.parse import urlparse

sys.path.insert(0, "/home/hatch/workspace/rankly")
import rankly_db as db

UA = {"User-Agent": "Rankly-verify/1.0"}


def get_json(url, data=None, timeout=20):
    req = urllib.request.Request(url, data=data, headers={**UA, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def github_stats(user):
    u = get_json(f"https://api.github.com/users/{user}")
    stars, repos, page = 0, 0, 1
    while page <= 2:  # cap at 200 repos
        rs = get_json(f"https://api.github.com/users/{user}/repos?per_page=100&page={page}")
        if not rs:
            break
        repos += len(rs)
        stars += sum(int(x.get("stargazers_count") or 0) for x in rs)
        if len(rs) < 100:
            break
        page += 1
    return {"gh_stars": stars, "gh_repos": repos or int(u.get("public_repos") or 0),
            "gh_followers": int(u.get("followers") or 0)}


LC_QUERY = ("query($u:String!){matchedUser(username:$u){"
            "userContestRanking{rating attendedContestsCount} "
            "submitStatsGlobal{acSubmissionNum{difficulty count}}}}")


def leetcode_stats(user):
    try:
        d = get_json("https://leetcode.com/graphql",
                     data=json.dumps({"query": LC_QUERY, "variables": {"u": user}}).encode())
        mu = (d.get("data") or {}).get("matchedUser") or {}
        contest = mu.get("userContestRanking") or {}
        nums = (mu.get("submitStatsGlobal") or {}).get("acSubmissionNum") or []
        solved = next((x.get("count") or 0 for x in nums if x.get("difficulty") == "All"), 0)
        return {"lc_rating": int(contest.get("rating") or 0), "lc_solved": int(solved or 0)}
    except Exception as e:
        print(f"  leetcode fetch failed for {user}: {e}")
        return {}


def username_from_url(url, host):
    try:
        p = urlparse(url if "://" in url else "https://" + url)
        if host not in p.hostname.replace("www.", ""):
            return ""
        segs = [s for s in p.path.split("/") if s
                and s.lower() not in ("u", "users", "in", "profile", "problems")]
        return segs[0] if segs and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,38}", segs[0]) else ""
    except Exception:
        return ""


def main():
    profiles = db.read_profiles()
    if not profiles:
        print("verify: board empty, nothing to do")
        return
    verifs = db.read_verifications()
    done, failed = 0, 0
    for r in profiles:
        key = db.profile_key(r)
        cur = verifs.get(key, {})
        gh_user = cur.get("gh_user") or username_from_url(r[6] if len(r) > 6 else "", "github.com")
        lc_user = cur.get("lc_user") or username_from_url(r[7] if len(r) > 7 else "", "leetcode.com")
        if not gh_user and not lc_user:
            continue
        fields = {}
        if gh_user:
            fields["gh_user"] = gh_user
            try:
                fields.update(github_stats(gh_user))
            except Exception as e:
                print(f"  github fetch failed for {gh_user}: {e}")
                failed += 1
        if lc_user:
            fields["lc_user"] = lc_user
            lc = leetcode_stats(lc_user)
            if lc:
                fields.update(lc)
            elif "lc_rating" not in cur:
                failed += 1
        if fields:
            db.upsert_verification(key, fields)
            done += 1
            print(f"  verified {r[1].strip()}: " +
                  " ".join(f"{k}={v}" for k, v in fields.items() if k not in ("gh_user", "lc_user")))
    print(f"verify ok: {done} updated, {failed} failed")


if __name__ == "__main__":
    main()
