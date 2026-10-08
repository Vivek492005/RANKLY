#!/usr/bin/env python3
"""Phase 7 — controlled Gmail delivery test framework.

A delivery test needs two halves this harness cannot fabricate:

1. CONSENTING TEST INBOXES — addresses whose owners have explicitly agreed
   to receive the test (e.g. the user's own alternate accounts). Provide via
   --to. The harness refuses to run without them.
2. PLACEMENT REPORTS — where each message actually landed
   (inbox / promotions / spam), reported voluntarily by the inbox owners via
   `record_placement`, or read from an inbox we have access to.

What the harness does:
  plan   - print the test plan (templates x inboxes) without sending
  run    - send the plan through the real pipeline (needs --live; otherwise
           dry-run). Every send is logged like a normal campaign.
  record - manually record an observed placement for a (campaign, address)

Baseline procedure: run the OLD implementation first (e.g. the previous HTML
blast), record placements, then run the v2 templates and compare under the
same conditions. Never claim a placement that was not observed.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from email import sender, store, templates

PLACEMENTS = ("inbox", "promotions", "spam", "missing")


def build_plan(test_inboxes, variants):
    plan = []
    for inbox in test_inboxes:
        for v in variants:
            plan.append((inbox, v))
    return plan


def cmd_plan(args):
    plan = build_plan(args.to, args.variants)
    print(f"test plan: {len(plan)} sends "
          f"({len(args.to)} inboxes x {args.variants})")
    for inbox, v in plan:
        label, _ = templates.VARIANTS[v]
        print(f"  {inbox} <- variant {v} ({label})")
    print("\nNo messages sent. Re-run with `run --live` to execute.")


def cmd_run(args):
    if not args.live:
        print("dry-run: no messages will be sent. Add --live to execute.")
    plan = build_plan(args.to, args.variants)
    campaign = args.campaign

    def render(to_email):
        name = to_email.split("@")[0]
        v = _current_variant[0]
        if v == "b":
            return templates.variant_b_minimal_html(name)
        if v == "c":
            return templates.variant_c_reengagement(name, "had a Rankly claim")
        return templates.variant_a_product_update(name)

    for inbox, v in plan:
        _current_variant[0] = v
        stats = sender.send_campaign(
            f"{campaign}-v{v}", [inbox], render, f"test-{v}",
            dry_run=not args.live)
        print(f"{inbox} v{v}: {stats}")


def cmd_record(args):
    if args.placement not in PLACEMENTS:
        raise SystemExit(f"placement must be one of {PLACEMENTS}")
    store.ensure_tabs()
    store.log_send(args.campaign, args.to, "placement-report",
                   f"placed:{args.placement}",
                   f"voluntarily reported by inbox owner")
    print(f"recorded: {args.to} -> {args.placement} "
          f"(campaign {args.campaign})")


_current_variant = ["a"]


def main():
    ap = argparse.ArgumentParser(description="Rankly delivery test harness")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("plan", help="print test plan without sending")
    p.add_argument("--to", required=True,
                   help="comma-separated consenting test inboxes")
    p.add_argument("--variants", nargs="+", default=["a", "b"],
                   choices=["a", "b", "c"])
    p.set_defaults(fn=lambda a: cmd_plan(_ns(a)))

    r = sub.add_parser("run", help="execute the test plan")
    r.add_argument("--to", required=True)
    r.add_argument("--variants", nargs="+", default=["a", "b"],
                   choices=["a", "b", "c"])
    r.add_argument("--campaign", required=True)
    r.add_argument("--live", action="store_true")
    r.set_defaults(fn=lambda a: cmd_run(_ns(a)))

    c = sub.add_parser("record", help="record an observed placement")
    c.add_argument("--campaign", required=True)
    c.add_argument("--to", required=True)
    c.add_argument("--placement", required=True, choices=PLACEMENTS)
    c.set_defaults(fn=lambda a: cmd_record(_ns(a)))

    args = ap.parse_args()
    args.fn(args)


def _ns(args):
    args.to = [e.strip().lower() for e in args.to.split(",") if e.strip()]
    if not args.to:
        raise SystemExit("refusing to run: no consenting test inboxes given")
    return args


if __name__ == "__main__":
    main()
