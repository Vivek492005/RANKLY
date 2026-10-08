#!/usr/bin/env python3
"""Lightweight admin delivery dashboard.

Generates a static HTML report from the recipient store + send log:
  email/dashboard.html

Shows: eligible subscribed recipients, suppressed contacts (unsubscribed /
bounced), recent send log with per-recipient status, quota usage. No tracking
pixels, no external requests — open the file locally.

An API-accepted send is reported as "sent (api accepted)" — never as
"delivered to inbox". Inbox placement is only ever recorded from the
controlled test harness (Phase 7), never inferred.
"""
import html
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from email import store
from email import sender

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "dashboard.html")


def main():
    store.ensure_tabs()
    recs = store._read_recipients()
    eligible = [e for e, (_, r) in recs.items() if r[1].strip() == "subscribed"]
    suppressed = [(e, r[1].strip(), r[6]) for e, (_, r) in recs.items()
                  if r[1].strip() in ("unsubscribed", "bounced")]
    log = store.get_log(limit=100)
    quota_used = sender.quota_used_today()

    def row(cells):
        return "<tr>" + "".join(
            f"<td>{html.escape(str(c))}</td>" for c in cells) + "</tr>"

    body = f"""
<h1>Rankly email delivery dashboard</h1>
<p>Generated {datetime.now(timezone.utc):%Y-%m-%d %H:%M UTC} &middot;
sending account: {html.escape(sender.SENDER)}</p>

<h2>Recipients</h2>
<ul>
<li><b>{len(eligible)}</b> subscribed (eligible to receive)</li>
<li><b>{len(suppressed)}</b> suppressed (unsubscribed / bounced)</li>
</ul>

<h2>Suppressed contacts</h2>
<table border="1" cellpadding="6">
<tr><th>Email</th><th>Status</th><th>Notes</th></tr>
{''.join(row([e, s, n]) for e, s, n in sorted(suppressed))}
</table>

<h2>Quota today</h2>
<p>{quota_used} / {sender.DAILY_QUOTA} sends counted by this pipeline
(conservative cap; manual sends are not counted).</p>

<h2>Recent send log (latest {len(log)})</h2>
<table border="1" cellpadding="6">
<tr><th>Timestamp</th><th>Campaign</th><th>To</th><th>Template</th>
<th>Status</th><th>Detail</th></tr>
{''.join(row(r) for r in reversed(log))}
</table>

<p><i>"sent" means accepted by the Gmail API. Inbox placement is never
inferred — see the Phase 7 test harness for measured placement.</i></p>
"""
    page = ("<!doctype html><html><head><meta charset='utf-8'>"
            "<title>Rankly email dashboard</title></head><body>"
            + body + "</body></html>")
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(page)
    print(f"wrote {OUT} ({len(eligible)} eligible, {len(suppressed)} "
          f"suppressed, {len(log)} log rows)")


if __name__ == "__main__":
    main()
