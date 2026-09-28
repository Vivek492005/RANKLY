#!/usr/bin/env python3
"""Logic tests for outbid_alerts.py — stub sheets + gmail, verify decisions."""
import importlib.util
import sys

spec = importlib.util.spec_from_file_location(
    "outbid_alerts", "/home/hatch/workspace/rankly/outbid_alerts.py")
oa = importlib.util.module_from_spec(spec)
sys.modules["outbid_alerts"] = oa
spec.loader.exec_module(oa)

SENT = []


class FakeDB:
    SS = "x"
    TAB_CLAIMS = "Claims"
    profiles = []
    works = []
    claims = []
    alerts = []
    written = None

    @staticmethod
    def num(s):
        return REAL_DB.num(s)

    @staticmethod
    def pad(r, n):
        return REAL_DB.pad(r, n)

    @staticmethod
    def profile_key(row):
        return REAL_DB.profile_key(row)

    @staticmethod
    def canonical_key(k):
        return REAL_DB.canonical_key(k)

    @staticmethod
    def read_profiles():
        return [list(r) for r in FakeDB.profiles]

    @staticmethod
    def read_showcase():
        return [list(r) for r in FakeDB.works]

    @staticmethod
    def get_values(tab, rng):
        if tab == "Claims":
            return [[]] + [list(r) for r in FakeDB.claims] if FakeDB.claims else []
        if tab == oa.TAB_ALERTS:
            return [oa.ALERT_HEADERS] + [list(r) for r in FakeDB.alerts]
        if tab == "Alert state":
            return []
        return []

    @staticmethod
    def update_values(tab, rng, values):
        FakeDB.written = (tab, values)


def fake_cli(*args):
    if args[1] == "+send":
        SENT.append(args)
        return {}
    raise AssertionError("unexpected cli call: " + " ".join(args[:4]))


oa.db = FakeDB
oa.cli = fake_cli
REAL_DB = sys.modules.get("rankly_db")


def claim(email, name, link, board="profiles"):
    r = [""] * 17
    r[1] = board
    r[2] = name
    r[6] = email
    r[7] = link
    return r


def profile_row(rank, name, email, linkedin, bid):
    r = [""] * 12
    r[0] = str(rank)
    r[1] = name
    r[5] = linkedin
    r[8] = email
    r[9] = str(bid)
    return r


def reset():
    FakeDB.profiles, FakeDB.works, FakeDB.claims, FakeDB.alerts = [], [], [], []
    FakeDB.written = None
    SENT.clear()


def run():
    sys.argv = ["outbid_alerts.py"]
    oa.main()


passed = 0


def check(name, cond):
    global passed
    assert cond, "FAILED: " + name
    passed += 1
    print("ok -", name)


# 1. Rank drop -> one email, state updated
reset()
FakeDB.claims = [claim("a@x.com", "Asha", "https://li/a")]
FakeDB.profiles = [profile_row(1, "Ravi", "r@x.com", "https://li/r", 900),
                   profile_row(2, "Asha", "a@x.com", "https://li/a", 500)]
FakeDB.alerts = [["a@x.com", "profiles", "Asha", "https://li/a", "1", "old"]]
run()
check("drop sends exactly one email", len(SENT) == 1 and "a@x.com" in SENT[0])
check("email subject has new rank", any("#2" in a for a in SENT[0]))
tab, values = FakeDB.written
check("state updated to rank 2", values[1][4] == "2")

# 2. Same rank -> no email
reset()
FakeDB.claims = [claim("a@x.com", "Asha", "https://li/a")]
FakeDB.profiles = [profile_row(2, "Asha", "a@x.com", "https://li/a", 500)]
FakeDB.alerts = [["a@x.com", "profiles", "Asha", "https://li/a", "2", "old"]]
run()
check("unchanged rank sends nothing", len(SENT) == 0)

# 3. Improved rank -> no email, baseline moves
reset()
FakeDB.claims = [claim("a@x.com", "Asha", "https://li/a")]
FakeDB.profiles = [profile_row(1, "Asha", "a@x.com", "https://li/a", 900)]
FakeDB.alerts = [["a@x.com", "profiles", "Asha", "https://li/a", "2", "old"]]
run()
check("improved rank sends nothing", len(SENT) == 0)
check("baseline follows improvement", FakeDB.written[1][1][4] == "1")

# 4. First sighting -> silent baseline
reset()
FakeDB.claims = [claim("b@x.com", "Bina", "https://li/b")]
FakeDB.profiles = [profile_row(3, "Bina", "b@x.com", "https://li/b", 100)]
run()
check("first sighting sends nothing", len(SENT) == 0)
check("baseline recorded", FakeDB.written[1][1][4] == "3")

# 5. Off the board (post-reset) -> state cleared, no email
reset()
FakeDB.claims = [claim("a@x.com", "Asha", "https://li/a")]
FakeDB.profiles = []
FakeDB.alerts = [["a@x.com", "profiles", "Asha", "https://li/a", "1", "old"]]
run()
check("off-board sends nothing", len(SENT) == 0)
check("off-board clears rank", FakeDB.written[1][1][4] == "")

# 6. Claim without email -> not tracked
reset()
FakeDB.claims = [claim("", "NoMail", "https://li/n")]
FakeDB.profiles = [profile_row(5, "NoMail", "", "https://li/n", 50)]
run()
check("email-less claim not tracked", FakeDB.written is None or len(FakeDB.written[1]) == 1)

print(f"\n{passed} outbid-alert checks passed")
