# Rankly — pay-to-rank student leaderboard

Rankly is a live leaderboard where students bid for rank positions. The site
reads live data from a Google Sheet ("Rankly Database"), accepts bids through
serverless claim endpoints, and runs on Vercel.

**Live site:** https://ranklyy.vercel.app

## Layout

| Path | What it is |
|---|---|
| `vercel-app/` | The deployed site (Vercel project root). Static pages (`index.html` student board, `showcase.html`, `replay.html`) + serverless APIs under `api/` and shared code under `lib/`. |
| `*.py` (repo root) | Automation scripts run on a schedule: `process_claims.py` (applies pending claims every 30 min), `daily_maintenance.py` (re-sort ranks, recompute stats), `weekly_reset.py` (Sunday archive + board reset — data is never deleted), `resolve_duels.py` (settles 24h bid duels), `outbid_alerts.py` (email alerts), `daily_snapshot.py`, `seed_sheets.py` (rebuild sheet tabs), `verify_profiles.py`, `rankly_db.py` (shared Sheets helper). |
| `tests/` | JS suites (`test-*.js`) and Python suites (`test_*.py`) covering backend logic, payments, photos, weekly archive, duels, and UI flows. |
| `docs/` | Terms & Privacy sources (`rankly-terms.docx`, `rankly-privacy.docx`, `build_docs.py`). The live site loads the published Google Docs versions. |
| `backups/2026-09-22-design/` | Pre-redesign snapshot of the frontend (kept for easy revert). |
| `site-build/`, `rankly-2-backup-2026-09-21.html` | Earlier static builds, kept for reference. |
| `migrate-to-students.js` | One-off migration helper. |
| `config.json` | Project wiring: Google Sheet / Drive folder / Docs IDs, tab names, cron inventory. IDs only — no credentials. |

## Deploy (Vercel)

Vercel project root directory: `vercel-app/`. Deploy with the Vercel CLI
from that directory, or connect this repo and set the root accordingly.

### Required environment variables (Production)

| Variable | Purpose |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Service-account key JSON for Sheets access |
| `UPI_WEBHOOK_SECRET` | Shared secret for the bank-SMS forwarder (`/api/upi-webhook`) |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Razorpay API credentials (test or live) |
| `RAZORPAY_WEBHOOK_SECRET` | Signs `/api/razorpay-webhook` requests |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token for optional profile photos |

Set these in the Vercel dashboard — never commit them.

## Payments

Two flows exist. Razorpay checkout (`create-order` → Checkout → `verify-payment`,
`razorpay-webhook` as backstop) and the manual-UPI fallback (`submit-claim` +
bank-SMS auto-verification via `/api/upi-webhook`). See `vercel-app/api/`
and `vercel-app/lib/`.

## Data & privacy

The leaderboard database is a private Google Sheet; this repo contains its
structure and automation, not its data. Claim identity keys are opaque
hashes — emails never appear in API payloads or the frontend.
