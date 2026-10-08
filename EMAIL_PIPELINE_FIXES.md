# Rankly Email Pipeline Fixes

**Date:** 2026-10-08
Each fix below maps to a finding in `EMAIL_DELIVERABILITY_AUDIT.md`.

## Code changes

### 1. `outbid_alerts.py` (existing sender)
- **F1:** `SITE` corrected `https://vercel-app-ashen-eight.vercel.app` →
  `https://ranklyy.vercel.app`. Alert links now go to production.
- **F2:** alert body gains an opt-out line: `Reply "unsubscribe" to stop
  these alerts.` Processed by `email/process_unsubscribes.py`.
- **F3:** per-recipient sheet write immediately after each successful send
  (`flush_alert`), so a mid-run crash can never cause duplicates on retry.
  The end-of-run bulk rewrite is kept as reconciliation.
- **F4:** each send is wrapped in try/except (including `SystemExit` from the
  Gmail CLI wrapper). One bad address no longer kills the run; failures are
  logged and the run continues. Final line now reports failure count.

### 2. `email/` — new consent-aware sending system
| File | Purpose |
|------|---------|
| `email/store.py` | Sheets-backed recipient store (`Email Recipients` tab) + send log (`Email Log` tab). Statuses: subscribed / unsubscribed / bounced. Re-subscribe requires an explicit flag — an opted-out address can never be re-added implicitly. |
| `email/templates.py` | v2 templates as render functions (A plain-text, B minimal HTML, C re-engagement). |
| `email/sender.py` | Quota-aware pipeline: eligibility filter, log-based dedup, 80%-of-quota guard (default 400/day), per-recipient retry-once, account-error abort, pause-file support, raw MIME with `List-Unsubscribe: <mailto:…>` header. Dry-run by default; `--confirm` required to send. |
| `email/process_unsubscribes.py` | Cron job: scans inbox for unsubscribe replies, suppresses senders. |
| `email/process_bounces.py` | Cron job: scans Mail Delivery Subsystem notices, marks hard bounces. |
| `email/dashboard.py` | Static HTML delivery report (`email/dashboard.html`). |
| `email/test_harness.py` | Controlled delivery-test framework (plan / run / record). |

### 3. `tests/test_email_system.py`
46 checks: template content rules, consent store (incl. resubscribe guard),
dedup, MIME headers, dry-run isolation, retry, per-recipient failure
isolation, account-error abort, quota guard, pause file, unsubscribe
heuristic, bounce regex. All passing. Existing
`tests/test_outbid_alerts.py` (11 checks) still passes unmodified.

## What was NOT changed
- No DNS changes (gmail.com records belong to Google).
- No Vercel production deployment in this task (needs explicit approval;
  the email code runs from this VM's cron, not Vercel).
- No live mailing-list population: the `Email Recipients` tab exists but is
  empty. Importing addresses requires the user's explicit approval per
  address source.
- No campaigns started. `send_campaign` defaults to `--dry-run`.

## Deployment notes (when approved)
1. Review the diff (`git diff`): `outbid_alerts.py`, new `email/` package.
2. The `rankly-outbid-alerts` cron (daily 18:08 IST) reads
   `~/workspace/rankly/outbid_alerts.py` at run time — the fix takes effect
   on the next run after the code lands. No cron reconfiguration needed.
3. Add two cron jobs (daily): `email/process_unsubscribes.py` and
   `email/process_bounces.py`.
4. Populate `Email Recipients` only from consent-verified sources via
   `email/store.py::upsert_recipient` (never bulk-import scraped lists).
5. First real campaign: dry-run first, review the log, then `--confirm`
   with the user watching.
