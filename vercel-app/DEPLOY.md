# Rankly — production app (Vercel)

Pay-to-rank **student leaderboard** + **work showcase**. Students list their
profiles (headline, college, skills, LinkedIn / GitHub / coding profile) and
bid ₹1–₹999 for rank; creators showcase work (GitHub / Instagram / LinkedIn /
Other) and bid for the top spots. Rank bids are paid by manual UPI to the
published QR/UPI ID. The buyer submits their UPI transaction ID (UTR); the
claim is recorded as "Awaiting verification" in the "Rankly Database" Google
Sheet, and the bank-SMS webhook auto-verifies + auto-applies it — the rank
goes live with no admin step. The claims cron (`rankly-claims-processor`,
every 30 min) remains the backstop for anything stuck at "verified".

## Layout

- `index.html` — student profiles board. Reads profile data live from Google
  Sheets (gviz CSV, with embedded offline fallback). Claim flow: profile form
  → review dialog (UPI QR + UPI ID + UTR field) → `POST /api/submit-claim`
  with `board: 'profiles'` → auto-verified toast.
- `showcase.html` — work showcase board. Same design language and the same
  UPI checkout; claims carry `board: 'showcase'`.
- `shared.js` — common frontend: sheet fetching, payments config, checkout
  dialog, Terms/Privacy dialogs, icons.
- `styles.css` — shared stylesheet for both pages.
- `upi-qr.png` — the UPI QR code shown at checkout.
- `api/config.js` — public config: `upi-manual` mode, UPI ID, min bid,
  and whether claim recording is configured.
- `api/submit-claim.js` — board-aware validation (profiles: name + headline +
  ≥1 profile link; showcase: title + creator + work link), bid ₹1–₹999, UTR
  format, rejects duplicate UTRs, appends the claim via `lib/sheets.js`.
  Never touches a board directly. Also auto-applies when the bank SMS
  already arrived (payment inbox).
- `api/upi-webhook.js` — `POST /api/upi-webhook?key=SECRET` with
  `{sms}` from the phone's SMS forwarder. Parses amount + UTR, logs to
  "Payment inbox", auto-verifies + auto-applies the matching claim on the
  right board. Amount must equal the bid or the claim stays manual.
- `lib/sheets.js` — service-account Sheets client for both boards, claims,
  activity, stats, and the payment inbox, in the exact sheet column layout.

## Sheet tabs

`Leaderboard (All time)` + `Today` (profiles) · `Showcase` (work) ·
`Claims` (17 cols incl. Board) · `Activity log` · `Site stats` (Visitors,
Revenue, Profiles listed, Works showcased) · `Payment inbox` ·
`Archive (companies)` (pre-pivot history).

## Environment variables (Vercel → Project → Settings → Environment Variables)

| Variable | Value |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | full service-account JSON (one line) |
| `UPI_WEBHOOK_SECRET` | random secret; the phone posts to `/api/upi-webhook?key=…` |
| `UPI_ID` | `sochai@ptyes` (default already in code) |
| `SPREADSHEET_ID` | `1FSWiEoLh8AgADL8jiFye4wOL5lt1KwjYjwSeeTBuy0o` (default already in code) |

No payment-gateway keys needed — UPI is manual.

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

## Phone: bank-SMS auto-verification (one time)

On the phone whose number is registered with the bank account behind
`sochai@ptyes`: Tasker (or any SMS-to-webhook app) → profile on received
bank credit SMS → HTTP POST to
`https://<your-vercel-domain>/api/upi-webhook?key=<UPI_WEBHOOK_SECRET>`
with body `{"sms":"%SMSRB"}`. The phone needs internet at payment time.

## Admin: verifying a payment

Normally nothing — the webhook auto-verifies. If a claim is stuck at
"Awaiting verification" (amount mismatch, SMS didn't arrive): check your
UPI app for a matching payment (amount + UTR); if it matches, change Status
to **verified** and the claims cron applies the rank within ~30 minutes.
Never set "verified" without confirming the money.

## One-time migration (company → student schema)

`~/workspace/rankly/migrate-to-students.js` — run once with
`GOOGLE_SERVICE_ACCOUNT_JSON` set after Google access is restored. Archives
the company rows, writes the new headers, creates the Showcase tab, resets
stats. Do NOT run after going live.

## Deploy

```sh
cd ~/workspace/rankly/vercel-app
vercel deploy --prod        # needs `vercel login` first
```

First deploy with only the Vercel token: the site goes live, boards read
the sheet, and the claim button shows PAYMENTS OFFLINE until
`GOOGLE_SERVICE_ACCOUNT_JSON` is set.

## Tests

- `/tmp/test-backend.js` — mock-Sheets E2E of `api/submit-claim` +
  `api/upi-webhook` + `lib/sheets.js`: validation, claim→SMS, SMS→claim,
  amount mismatch, duplicate UTR/SMS, re-bids, stats. (44 checks)
- `/tmp/jsdom-test/smoke.js` — jsdom smoke test of both pages + shared.js:
  offline fallback render, filters, nav, claim wiring. (25 checks)
