# Rankly — production app (Vercel)

Pay-to-rank **student leaderboard** + **work showcase**. Students list their
profiles (headline, college, skills, LinkedIn / GitHub / coding profile) and
bid ₹1–₹999 for rank; creators showcase work (GitHub / Instagram / LinkedIn /
Other) and bid for the top spots. Rank bids are paid through **Cashfree**
(UPI, cards, netbanking). The buyer pays in the Cashfree checkout; the
payment is verified server-side and the claim auto-applies — the rank goes
live with no admin step. The Cashfree webhook is the backstop for payments
completed after the browser callback, and the claims cron
(`rankly-claims-processor`, every 30 min) remains the backstop for anything
stuck at "verified".

## Layout

- `index.html` — student profiles board. Reads profile data live from Google
  Sheets (gviz CSV, with embedded offline fallback). Claim flow: profile form
  → review dialog → Cashfree checkout → `POST /api/verify-payment`
  with `order_id` → verified toast.
- `showcase.html` — work showcase board. Same design language and the same
  Cashfree checkout; claims carry `board: 'showcase'`.
- `shared.js` — common frontend: sheet fetching, payments config, checkout
  dialog, Terms/Privacy dialogs, icons.
- `styles.css` — shared stylesheet for both pages.
- `api/config.js` — public config: `cashfree` mode, min/max bid, whether
  claim recording and Cashfree are configured.
- `api/create-order.js` — board-aware validation (profiles: name + headline +
  ≥1 profile link; showcase: title + creator + work link), bid ₹1–₹999,
  10-digit mobile number, minimum-increment rule, rejects duplicate order
  ids. Creates the Cashfree order and appends the claim as "Awaiting
  payment" via `lib/sheets.js`. Never touches a board directly.
- `api/verify-payment.js` — `POST` with `{ order_id }` after checkout.
  Confirms `PAID` + exact amount with Cashfree directly, then verifies +
  applies the claim (idempotent).
- `api/cashfree-webhook.js` — `POST /api/cashfree-webhook` from Cashfree.
  Verifies the `x-webhook-signature` HMAC, confirms `PAID` via the API,
  then verifies + applies the matching claim (idempotent). Marks failed /
  dropped payments as "Payment failed".
- `lib/cashfree.js` — Cashfree PG client (order create/status, webhook
  signature verification). Sandbox vs production via `CASHFREE_ENV`.
- `lib/sheets.js` — service-account Sheets client for both boards, claims,
  activity, stats, in the exact sheet column layout.

## Sheet tabs

`Leaderboard (All time)` + `Today` (profiles) · `Showcase` (work) ·
`Claims` (incl. Board, Transaction ID = Cashfree order id) ·
`Activity log` · `Site stats` (Visitors, Revenue, Profiles listed, Works
showcased) · `Weekly Archive` · `Reset Log`.

## Environment variables (Vercel → Project → Settings → Environment Variables)

| Variable | Value |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | full service-account JSON (one line) |
| `CASHFREE_CLIENT_ID` | Cashfree dashboard → API Keys (App ID) |
| `CASHFREE_CLIENT_SECRET` | Cashfree dashboard → API Keys (Secret Key) |
| `CASHFREE_ENV` | `production` (or `sandbox` for testing) |
| `SITE_URL` | `https://ranklyy.vercel.app` (default already in code) |
| `SPREADSHEET_ID` | `1FSWiEoLh8AgADL8jiFye4wOL5lt1KwjYjwSeeTBuy0o` (default already in code) |

The Cashfree webhook URL to register (dashboard → Developers → Webhooks,
or per-order `notify_url` which the API sets automatically):
`https://ranklyy.vercel.app/api/cashfree-webhook`

## Google service account setup (one time, ~5 min)

1. https://console.cloud.google.com → create/select a project →
   **APIs & Services → Enable APIs** → enable **Google Sheets API**.
2. **IAM & Admin → Service Accounts → Create service account**
   (name e.g. `rankly-sheets`) → **Keys → Add key → JSON** → download.
3. Open the **Rankly Database** spreadsheet → **Share** → paste the
   service account's `client_email` → give **Editor** access. Keep the
   sheet's "Anyone with the link can view" sharing ON — the frontend reads
   it via the public gviz CSV endpoint.
4. Paste the whole JSON file content into `GOOGLE_SERVICE_ACCOUNT_JSON`.

## Cashfree setup (one time)

1. Sign up at cashfree.com and complete business KYC/activation.
2. Dashboard → API Keys → copy the **Client ID** and **Secret Key**
   (sandbox keys for testing, production keys for live).
3. Set `CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET`, and `CASHFREE_ENV`
   as Vercel environment variables (Production).
4. Whitelist the site domain in the Cashfree dashboard before going live.
5. The webhook URL above is sent as `notify_url` on every order; you can
   also register it under Developers → Webhooks.

## Admin: verifying a payment

Normally nothing — the verify callback + webhook apply claims
automatically. If a claim is stuck at "Awaiting payment" (webhook missed,
browser closed early): check the order status in the Cashfree dashboard;
if it is PAID for the exact bid amount, the next `/api/verify-payment`
call or webhook retry applies it. The claims cron picks up anything left
at "verified" within ~30 minutes. Never mark "applied" without confirming
the money in Cashfree.

## Deploy

```sh
cd ~/workspace/rankly/vercel-app
vercel deploy --prod        # needs `vercel login` first
```

First deploy with only the Vercel token: the site goes live, boards read
the sheet, and the claim button shows PAYMENTS OFFLINE until
`GOOGLE_SERVICE_ACCOUNT_JSON` and the Cashfree keys are set.

## Tests

```sh
cd ~/workspace/rankly
for f in tests/test-*.js; do node "$f"; done
python3 tests/test_outbid_alerts.py
```

- `tests/test-cashfree.js` — webhook signature verification (accept /
  tamper / missing secret), order-id format, sandbox vs production env.
- `tests/test-verify-polling.js` — jsdom: Cashfree checkout success path,
  phone validation, disabled-payments guard, verify-dialog polling.
- `tests/test-growth.js` — bid minimum-increment rule via
  `api/create-order` (mocked Cashfree), phone validation.
- Remaining suites cover sheets helpers, claim status, duels, weekly
  archive, photos, and outbid alerts.
