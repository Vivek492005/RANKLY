# Rankly Email Authentication Report

**Date:** 2026-10-08
**Message inspected:** Gmail ID `1a11c7b223d00087` — promo v2 sent
2026-10-08 from `sochai.hr@gmail.com` to `vidishofficial@gmail.com`
via the Gmail API (`users.messages.send`, plain text).

## 1. Headers observed (Sent copy)

| Header | Value |
|--------|-------|
| From | `sochai.hr@gmail.com` |
| To | `vidishofficial@gmail.com` |
| Subject | Vidish, Rankly finally fixed payments |
| Date | Thu, 8 Oct 2026 10:06:34 -0700 |
| Message-ID | present, `...@mail.gmail.com` |
| MIME-Version | 1.0 |
| Content-Type | `text/plain; charset="utf-8"` |
| Content-Transfer-Encoding | present |
| Received | 2× Google internal hops |

`DKIM-Signature` and `Authentication-Results` are **not** present in the Sent
copy — expected: Gmail adds DKIM at the outbound edge and
Authentication-Results is added by the *receiving* server. Neither is visible
from the sender's mailbox via the API.

## 2. Assessment per mechanism

**SPF — inferred PASS (not directly observable).**
The envelope sender for `@gmail.com` API sends is `@gmail.com`, transmitted
from Google's own MTAs. Google publishes and maintains SPF for gmail.com;
mail originating from Google infrastructure passes SPF. No custom SPF record
can or should be created by us — gmail.com DNS belongs to Google.

**DKIM — inferred PASS (not directly observable).**
Google DKIM-signs all outbound mail from gmail.com addresses with `d=gmail.com`
at the outbound edge. We cannot modify or improve this; it is Google-managed.

**DMARC — managed by Google.**
gmail.com publishes Google's DMARC policy. Nothing for us to configure.

**Alignment — PASS by construction.**
Visible `From` domain (`gmail.com`) matches the envelope/authenticated
domain. No custom `Sender`/`Return-Path` spoofing anywhere in our code or
sending path (verified in `outbid_alerts.py` and the manual sends).

## 3. Conclusion

**Authentication is not the cause of Rankly's spam placement.** The sending
identity is Google-authenticated end to end; there is no misconfiguration on
our side to repair, and per the task constraints we must not touch Google's
DNS records.

The observed spam placement is therefore driven by the higher-weighted
signals in Gmail's 2025 classifier hierarchy: **sender reputation (~40%) and
recipient engagement (~25%)**, with content (~10%) as a secondary factor —
consistent with a personal `@gmail.com` address sending marketing-style mail
to recipients with no prior engagement history.

Honest measurement status: receiver-side `Authentication-Results: pass`
cannot be confirmed without access to a receiving mailbox. If the user
provides access to the `vidishofficial@gmail.com` inbox, "Show original"
there would confirm `spf=pass`, `dkim=pass`, `dmarc=pass` directly. Until
then this remains *inferred pass*, not *measured pass* — recorded as such in
the final comparison table.
