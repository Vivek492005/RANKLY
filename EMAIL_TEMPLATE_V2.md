# Rankly Email Templates v2

**Date:** 2026-10-08
**Rules followed:** accurate subject lines, clear Rankly identification, one
direct link (`https://ranklyy.vercel.app`, no shorteners/redirects), no
misleading urgency, no exaggerated claims, no false personalization, clear
opt-out on every promotional variant. Transactional variant (C) is sent only
for the event it describes.

"Recruiter visibility" wording is kept because the live site itself states
"recruiters see the top first" — the claim is product-supported, not invented
for email.

---

## Variant A — Plain-text product update

*Use for: announcements to subscribed recipients. Best inbox odds from a
personal Gmail (reads as correspondence, not bulk mail).*

Subject: Rankly update: instant payments are live

```
Hi [Name],

A quick update from Rankly (https://ranklyy.vercel.app).

We've replaced manual payment verification with Cashfree checkout. You can
now pay with UPI, cards, or netbanking, and your rank goes live within
minutes of a successful payment. Bids still start at ₹1, and the leaderboard
still resets every Sunday.

Full details are on the site — nothing else has changed about how ranking
works.

Cheers,
Team Rankly

---
You're receiving this because you subscribed to Rankly updates. If you'd
rather not get these, just reply "unsubscribe" and we'll remove you.
```

## Variant B — Minimal HTML product update

*Use for: the same audience when light formatting is wanted. Minimal markup
only — no images, no buttons-as-images, no tracking pixels.*

Subject: Rankly update: instant payments are live

```html
<p>Hi [Name],</p>

<p>A quick update from <a href="https://ranklyy.vercel.app">Rankly</a>.</p>

<p>We've replaced manual payment verification with Cashfree checkout. You can
now pay with UPI, cards, or netbanking, and your rank goes live within minutes
of a successful payment. Bids still start at &#8377;1, and the leaderboard
still resets every Sunday.</p>

<p>Full details are on the site &mdash; nothing else has changed about how
ranking works.</p>

<p>Cheers,<br>Team Rankly</p>

<hr>
<p style="font-size:12px;color:#666;">You're receiving this because you
subscribed to Rankly updates. If you'd rather not get these, just reply
"unsubscribe" and we'll remove you.</p>
```

## Variant C — Existing-user re-engagement (transactional-adjacent)

*Use for: people with a real prior Rankly relationship (e.g. an earlier claim
or bid). References only the interaction that actually happened — never
invent one. One send per person per campaign; suppressed on unsubscribe.*

Subject: [Name], your Rankly rank from last month

```
Hi [Name],

You claimed a rank on Rankly last month, so I wanted you to hear this from
me directly: the payment process you used is gone.

We've moved to Cashfree checkout — UPI, cards, or netbanking, done in about
30 seconds, rank live within minutes. No manual verification, no waiting.

If you want to try again: https://ranklyy.vercel.app

The boards reset every Sunday, so there's always a fresh shot.

Cheers,
Team Rankly

---
Getting this because of your earlier Rankly claim. Reply "unsubscribe" any
time and we won't email you again.
```

## Segmentation rules (not random selection)

- **A/B:** subscribed recipients who opted in to product updates.
- **C:** recipients with a verified prior claim/bid AND still subscribed.
- **Never:** website visitors with no email relationship, purchased/scraped
  lists, or anyone with `unsubscribed`/`bounced` status in the recipient
  store (see `email/recipients.py`).

## What these templates deliberately avoid

- "Free", "guaranteed", "limited time", countdown-style urgency.
- Claiming inbox placement or deliverability.
- Personalization fields that aren't backed by real data.
- More than one link; no shortened or redirected URLs.
- HTML images or tracking pixels (variant B has neither).
