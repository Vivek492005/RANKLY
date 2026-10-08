# Rankly Email Test Results

**Date:** 2026-10-08

## 1. Automated tests (all passing)

| Suite | Checks | Result |
|-------|--------|--------|
| `tests/test_email_system.py` (new) | 46 — templates, consent store, dedup, MIME headers, dry-run isolation, retry, failure isolation, account-error abort, quota guard, pause file, unsubscribe heuristic, bounce regex | PASS |
| `tests/test_outbid_alerts.py` (existing) | 11 — alert decision logic | PASS (unmodified) |

## 2. Component verification (manual, with evidence)

| Component | Test | Evidence |
|-----------|------|----------|
| `store.ensure_tabs` | creates missing tabs | `created tab Email Recipients` / `created tab Email Log` in live sheet |
| `test_harness.py plan` | prints plan, sends nothing | 4-send plan printed, zero API calls |
| `test_harness.py run` (dry-run) | exercises pipeline end-to-end | campaign `baseline-v1-va`: sent=1 (dry-run), logged |
| `dashboard.py` | generates report | `email/dashboard.html` written (0 eligible, 0 suppressed, 1 log row) |
| Raw MIME builder | headers present | `List-Unsubscribe`, `From`, `To`, `Subject`, `Message-ID` verified in built .eml |
| `outbid_alerts.py --dry-run` path | logic unchanged | existing 11 checks green |

## 3. Controlled delivery test (Phase 7) — BLOCKED, documented honestly

**Status:** harness built and dry-run verified; live test NOT run.

**Blocked step:** the test needs 2+ consenting test inboxes (addresses whose
owners explicitly agree to receive the test) plus voluntary placement
reports (inbox / promotions / spam) from those owners. The user has not yet
provided test inboxes.

**Procedure when unblocked:**
1. `python3 email/test_harness.py plan --to <inboxes> --variants a b`
2. Baseline: send the OLD format live (`run --live --campaign baseline-old`),
   record placements via `record`.
3. Send v2 templates (`run --live --campaign baseline-v2`), record placements.
4. Compare under identical conditions; report honestly.

**What is NOT claimed:** API acceptance ("sent") is not inbox delivery.
No placement numbers are reported anywhere in this task without an observed
report. The comparison table below marks unmeasured items explicitly.

## 4. Before / after comparison (honest)

| Metric | Before | After |
|--------|--------|-------|
| SPF/DKIM authentication | Not measured (inferred pass — Google infra) | Not measured (inferred pass — Google infra; receiver-side confirmation still needs inbox access) |
| Sending implementation issues | 8 findings audited (F1–F8) | F1–F4 fixed in code and tested; F5–F7 built and unit-tested; F8 addressed via templates |
| Duplicate sends | Possible on partial failure (F3) | Prevented by per-recipient persist + log dedup; verified by test |
| Bounce/rejection count | Not tracked | Tracked in Email Log; hard bounces auto-suppressed (pipeline built; no live campaign run yet) |
| Opt-out handling | None existed | List-Unsubscribe header + reply-based processor built and unit-tested; not yet run against live inbox |
| Spam placement in consenting test inboxes | Not measured | Not measured — blocked on test inboxes (see §3) |
| Inbox/Promotions placement | Not measured | Not measured — blocked on test inboxes (see §3) |

## 5. Remaining limitations and risks

1. **Reputation cannot be rewritten by code.** The `@gmail.com` sender's
   reputation and the recipients' engagement history dominate Gmail's
   classifier (~65% combined weight). New templates improve the odds; they
   do not guarantee inbox placement. Anyone promising otherwise is wrong.
2. **Authentication is Google-managed.** No improvement possible or needed
   on our side for the `@gmail.com` identity.
3. **Volume discipline required.** The pipeline caps at 400/day with an 80%
   guard, but healthy practice for this account is far below that —
   one-to-one, consent-based sends.
4. **Unsubscribe processor is heuristic.** Ambiguous replies are left alone
   and logged; a human should review the log periodically.
5. **Manual sends bypass the pipeline.** Emails sent by hand (like the three
   on 2026-10-08) are not quota-counted, not logged, and not deduped.
   Route all future sends through `email/sender.py`.
6. **No open/click tracking by design.** Placement and engagement are
   measured only via voluntary reports, never pixels.
