"""Rankly consent-aware email system.

Modules:
  store      - Sheets-backed recipient consent store + send log
  templates  - v2 email templates (plain-text, minimal HTML, re-engagement)
  sender     - quota-aware sending pipeline (dedup, retry, pause/resume)
  dashboard  - static HTML delivery report generator
  test_harness - controlled delivery-test framework (Phase 7)

Scripts (run by cron or manually):
  process_unsubscribes.py - scan inbox for unsubscribe replies, suppress
  process_bounces.py      - scan for delivery failures, mark bounced
"""
