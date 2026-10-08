#!/usr/bin/env python3
"""v2 email templates as render functions.

Each returns (subject, body, is_html). Personalization uses only real data
passed in by the caller — never invented. Every promotional variant carries
an opt-out line.
"""
SITE = "https://ranklyy.vercel.app"


def _name(n):
    return (n or "there").strip() or "there"


def variant_a_product_update(name):
    """A. Plain-text product update (subscribed recipients)."""
    name = _name(name)
    subject = "Rankly update: instant payments are live"
    body = (
        f"Hi {name},\n\n"
        f"A quick update from Rankly ({SITE}).\n\n"
        "We've replaced manual payment verification with Cashfree checkout. "
        "You can now pay with UPI, cards, or netbanking, and your rank goes "
        "live within minutes of a successful payment. Bids still start at "
        "\u20b91, and the leaderboard still resets every Sunday.\n\n"
        "Full details are on the site \u2014 nothing else has changed about "
        "how ranking works.\n\n"
        "Cheers,\nTeam Rankly\n\n"
        "---\n"
        "You're receiving this because you subscribed to Rankly updates. "
        "If you'd rather not get these, just reply \"unsubscribe\" and "
        "we'll remove you.\n"
    )
    return subject, body, False


def variant_b_minimal_html(name):
    """B. Minimal HTML product update (subscribed recipients). No images,
    no tracking pixels, one direct link."""
    name = _name(name)
    subject = "Rankly update: instant payments are live"
    body = (
        f"<p>Hi {name},</p>\n\n"
        f"<p>A quick update from <a href=\"{SITE}\">Rankly</a>.</p>\n\n"
        "<p>We've replaced manual payment verification with Cashfree "
        "checkout. You can now pay with UPI, cards, or netbanking, and your "
        "rank goes live within minutes of a successful payment. Bids still "
        "start at &#8377;1, and the leaderboard still resets every "
        "Sunday.</p>\n\n"
        "<p>Full details are on the site &mdash; nothing else has changed "
        "about how ranking works.</p>\n\n"
        "<p>Cheers,<br>Team Rankly</p>\n\n"
        "<hr>\n"
        "<p style=\"font-size:12px;color:#666;\">You're receiving this "
        "because you subscribed to Rankly updates. If you'd rather not get "
        "these, just reply \"unsubscribe\" and we'll remove you.</p>\n"
    )
    return subject, body, True


def variant_c_reengagement(name, prior_event):
    """C. Re-engagement for someone with a real prior Rankly relationship.
    prior_event must describe the actual interaction (e.g. 'claimed a rank
    last month') — never invented by the caller."""
    name = _name(name)
    subject = f"{name}, your Rankly rank from last month"
    body = (
        f"Hi {name},\n\n"
        f"You {prior_event} on Rankly, so I wanted you to hear this from me "
        "directly: the payment process you used is gone.\n\n"
        "We've moved to Cashfree checkout \u2014 UPI, cards, or netbanking, "
        "done in about 30 seconds, rank live within minutes. No manual "
        "verification, no waiting.\n\n"
        f"If you want to try again: {SITE}\n\n"
        "The boards reset every Sunday, so there's always a fresh shot.\n\n"
        "Cheers,\nTeam Rankly\n\n"
        "---\n"
        "Getting this because of your earlier Rankly activity. Reply "
        "\"unsubscribe\" any time and we won't email you again.\n"
    )
    return subject, body, False


VARIANTS = {
    "a": ("Plain-text product update", variant_a_product_update),
    "b": ("Minimal HTML product update", variant_b_minimal_html),
    "c": ("Re-engagement", variant_c_reengagement),
}
