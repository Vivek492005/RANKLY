# Rankly — pay-to-rank student leaderboard

Rankly is a live leaderboard where students bid for rank positions. The site
reads live data from a Google Sheet ("Rankly Database"), accepts bids through
serverless claim endpoints, and runs on Vercel. A static mirror of the
frontend is also served from GitHub Pages (APIs stay on Vercel).

**Live site:** https://ranklyy.vercel.app
**Pages mirror:** https://vivek492005.github.io/RANKLY/

## Layout

| Path | What it is |
|---|---|
| `vercel-app/` | The deployed site (Vercel project root). Static pages (`index.html` student board, `showcase.html`, `replay.html`) + serverless APIs under `api/` and shared code under `lib/`. |
| `.github/workflows/deploy-pages.yml` | Deploys `vercel-app/` to GitHub Pages on every push touching it. |
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
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token for optional profile photos |
| `CASHFREE_CLIENT_ID` / `CASHFREE_CLIENT_SECRET` | Cashfree dashboard → API Keys (App ID / Secret Key) |
| `CASHFREE_ENV` | `production` (or `sandbox` for testing) |

Set these in the Vercel dashboard — never commit them.

## Deploy (GitHub Pages)

Pushes to `main` that touch `vercel-app/**` auto-deploy the static frontend
to `https://vivek492005.github.io/RANKLY/` via the `deploy-pages` workflow
(manual runs: Actions → "Deploy Rankly to GitHub Pages" → Run workflow).

GitHub Pages can't run the serverless APIs, so on `github.io` the frontend
calls `https://ranklyy.vercel.app/api/*` cross-origin. `vercel-app/lib/cors.js`
adds the exact Pages origin to the nine frontend-facing APIs (no wildcard).

First-time setup: repo **Settings → Pages → Source: GitHub Actions**, then
run the workflow once.

## Payments

The working path is **Cashfree**: the bidder pays in the Cashfree checkout
(UPI, cards, netbanking) opened from the review dialog. `POST
/api/create-order` validates the claim and creates the Cashfree order; after
payment, `POST /api/verify-payment` confirms `PAID` + the exact amount with
Cashfree directly and applies the claim. The Cashfree webhook
(`POST /api/cashfree-webhook`, HMAC-verified) is the backstop for payments
completed after the browser callback. Webhook URL:
`https://ranklyy.vercel.app/api/cashfree-webhook`.

Manual UPI + bank-SMS auto-verification was the previous path and has been
fully retired. Razorpay was never a live option (business activation
rejected); its code and test keys have been removed.

## Data & privacy

The leaderboard database is a private Google Sheet; this repo contains its
structure and automation, not its data. Claim identity keys are opaque
hashes — emails never appear in API payloads or the frontend.

Rankings reset every Sunday ~00:05 IST into a permanent weekly archive —
nothing is ever deleted.
