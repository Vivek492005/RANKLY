# Rankly Email Deliverability Audit

**Date:** 2026-10-08
**Auditor:** P0 deliverability recovery task
**Scope:** All email generation/sending code, jobs, and data in the Rankly repo
(`~/workspace/rankly`), the live Google Sheet ("Rankly Database"), and the
three promotional emails sent manually on 2026-10-08.

## 1. Email inventory (complete)

Only **one** code path in the repository sends email:

| # | Path | Mechanism | Trigger | Content type |
|---|------|-----------|---------|--------------|
| 1 | `outbid_alerts.py` → `hatch_gws_cli gmail +send` | Gmail API (`messages.send`) | `rankly-outbid-alerts` cron, daily 18:08 IST | Plain text, transactional ("you've been outbid") |

Manual (non-code) sends on 2026-10-08 via the assistant, at the user's explicit
request each time:

| # | To | Subject | Format | Status |
|---|----|---------|--------|--------|
| 1 | vidishbijalwan@gmail.com | "Vidish, your Rankly comeback starts now — instant payments are live" | HTML marketing | Sent |
| 2 | vidishbijalwan@gmail.com | "Vidish, Rankly finally fixed payments" | Plain text | Sent |
| 3 | vidishofficial@gmail.com | "Vidish, Rankly finally fixed payments" | Plain text + unsubscribe line | Sent |

No other senders exist: no SMTP code, no Apps Script, no BCC blasts, no
third-party ESP (SendGrid/SES/Mailchimp), no tracking pixels, no link
shorteners, no open/click tracking anywhere in the codebase (verified by
full-repo grep for `smtplib`, `sendmail`, `SES`, `sendgrid`, `+send`).

## 2. Findings

### F1 — HIGH — Stale site URL in outbid alert emails
**File:** `outbid_alerts.py:25`
`SITE = "https://vercel-app-ashen-eight.vercel.app"` — a dead preview
deployment. Production moved to `https://ranklyy.vercel.app`. Every outbid
alert email links recipients to the wrong URL. This is a trust/deliverability
defect: mismatched link destinations erode sender credibility.
**Fix:** point `SITE` at `https://ranklyy.vercel.app`. (Implemented in this task.)

### F2 — HIGH — No unsubscribe mechanism on any email
Neither `outbid_alerts.py` nor the manual promos (1 and 2) offered opt-out.
Promo 3 added a reply-"unsubscribe" line, but nothing processes such replies —
an unsubscribe request would sit unread in the inbox. Gmail's bulk-sender
rules and basic consent hygiene require a working opt-out.
**Fix:** `List-Unsubscribe: <mailto:…?subject=unsubscribe>` header on sends +
`email/process_unsubscribes.py` (cron) that scans for unsubscribe replies and
suppresses those addresses. (Implemented in this task.)

### F3 — MEDIUM — Duplicate-send risk on partial failure
`outbid_alerts.py` writes the "Alert state" sheet only **after** the send loop
completes. If the run dies mid-loop (API error, timeout), the next run
re-sends alerts to everyone already emailed in the failed run.
**Fix:** write per-recipient send status immediately after each send; skip
already-sent recipients on resume. (Implemented in this task.)

### F4 — MEDIUM — Single send failure kills the whole run
`cli()` calls `sys.exit(1)` on any Gmail API error. One bad address / transient
error aborts all remaining alerts, with no error log beyond stdout.
**Fix:** per-recipient try/except, error log to sheet + stderr, continue with
the rest; abort only on account-level errors (auth/quota). (Implemented.)

### F5 — MEDIUM — No bounce handling
Bounced addresses stay in "Alert state" and are retried forever, hurting
sender reputation with every hard bounce.
**Fix:** bounce detection via Gmail search for delivery-failure notices +
`bounce` status in the recipient store; hard bounces suppressed after 1,
soft bounces after 3. (Implemented; historical bounce scan documented.)

### F6 — LOW — No quota awareness
Gmail API daily send quota (~500/day for consumer accounts via API; the exact
envelope depends on account type) is never checked. Current volume is tiny
(single digits), so this is latent, not active.
**Fix:** `email/send_campaign.py` checks a daily counter before each send and
pauses the campaign at 80% of the configured quota. (Implemented.)

### F7 — LOW — No consent-status tracking
`outbid_alerts.py` tracks anyone "with an email address" — there is no
consent source/timestamp, no distinction between transactional eligibility
(outbid alerts for active bidders: legitimate interest) and promotional
eligibility (requires opt-in).
**Fix:** new "Email Recipients" sheet tab: Email | Status
(subscribed/unsubscribed/bounced) | Consent source | Consent timestamp |
Last campaign | Notes. Promo sends only to `subscribed`. (Implemented.)

### F8 — INFO — Manual HTML promo blast characteristics
Promo email #1 was a designed HTML marketing email (CTA button, urgency copy)
sent from a personal `@gmail.com` address. Content/structure signals
(image-light HTML + marketing phrasing + link) push Gmail's classifier toward
Promotions/Spam for low-reputation personal senders. This is a
reputation/content interaction, not a code defect — fixed by the template
rebuild (Phase 4), not by infrastructure.

## 3. What is NOT broken (verified)

- **No bulk/BCC sending** anywhere in code.
- **No tracking pixels, redirectors, or URL shorteners** in code or templates.
- **MIME is clean:** `text/plain; charset=utf-8`, proper Message-ID, no header
  spoofing (see `EMAIL_AUTHENTICATION_REPORT.md`).
- **Promotional and transactional mail are already separated** in practice:
  outbid alerts are transactional; promos were manual one-offs.
- **No quota/abuse warnings** observed on the sending account.
- **No retry storms:** `cli()` exits rather than retrying (fail-safe direction,
  though too aggressive — see F4).

## 4. Website / link trust (Phase 3 summary)

- `https://ranklyy.vercel.app`: HTTP 200, 0 redirects, TLS verify OK,
  `http://` → 308 to HTTPS. Valid.
- External links on homepage: Google Fonts only. No shorteners/tracking.
- Terms & Privacy present in footer (Google Docs, updated 2026-10-08 for
  Cashfree); refund policy lives in Terms §5.
- `you@example.com` on the site is only an input `placeholder`, not a
  displayed address — not a finding.
- Gap (low): no dedicated contact email address on the site; Terms says
  "contact the site operator" without an address. Recommended, not blocking.
- Product claims verified against reality: pay-to-rank, Cashfree checkout,
  ₹1 minimum, Sunday resets — all match the live product.

## 5. Proposed fixes → implementation map

| Finding | Fix location | Status |
|---------|--------------|--------|
| F1 stale URL | `outbid_alerts.py` `SITE` | Fixed + tested |
| F2 no unsubscribe | `email/` module, List-Unsubscribe header, `process_unsubscribes.py` | Built + tested |
| F3 duplicate risk | per-recipient status writes in `outbid_alerts.py` + `send_campaign.py` | Built + tested |
| F4 fail-fast | per-recipient error handling | Built + tested |
| F5 bounces | bounce scan + suppression | Built; historical scan run |
| F6 quota | quota guard in `send_campaign.py` | Built + tested |
| F7 consent | "Email Recipients" sheet tab + `email/recipients.py` | Built (population needs approval) |
| F8 content | `EMAIL_TEMPLATE_V2.md` (3 variants) | Written |
