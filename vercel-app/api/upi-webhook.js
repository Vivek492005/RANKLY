'use strict';
// POST /api/upi-webhook?key=SECRET — inbound bank-SMS forwarder.
//
// UPI offers no webhooks for personal VPAs, so the automation signal is the
// bank's "money credited" SMS: the user's phone forwards it here (Tasker or
// any SMS-to-webhook app). We parse amount + UTR, log the payment in the
// "Payment inbox" sheet tab, and auto-verify + auto-apply any matching
// "Awaiting verification" claim — routed to the right board (student
// profiles or showcase) from the claim's Board column. No manual admin step
// needed.
//
// Auth: ?key= query param (or JSON body { key }) must equal the
// UPI_WEBHOOK_SECRET env var. Body: { sms: "<full sms text>" }.
const {
  recordInboundPayment, autoVerifyAndApply, markPaymentMatched,
} = require('../lib/sheets');

function parseSms(text) {
  const t = String(text || '');
  const amounts = [];
  const amtRe = /(?:rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/gi;
  let m;
  while ((m = amtRe.exec(t))) {
    const v = parseFloat(m[1].replace(/,/g, ''));
    if (Number.isFinite(v) && v > 0) amounts.push(v);
  }
  // Prefer UTRs written next to ref/utr/txn keywords; fall back to any
  // 12-digit run (UPI UTRs are 12 digits).
  let utrs = [];
  const kwRe = /(?:\butr\b|ref(?:erence)?(?:\s*no\.?)?|txn(?:\s*(?:id|no\.?))?|transaction\s*(?:id|no\.?)?)\s*[:#\-]?\s*(\d{12})/gi;
  while ((m = kwRe.exec(t))) utrs.push(m[1]);
  if (!utrs.length) {
    const anyRe = /\b(\d{12})\b/g;
    while ((m = anyRe.exec(t))) if (!utrs.includes(m[1])) utrs.push(m[1]);
  }
  return { amount: amounts.length ? amounts[0] : null, utrs };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.UPI_WEBHOOK_SECRET;
  if (!secret) return res.status(500).json({ error: 'Webhook not configured.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (body == null || typeof body !== 'object') body = {};
  const key = req.query && req.query.key ? String(req.query.key) : String(body.key || '');
  if (key !== secret) return res.status(401).json({ error: 'Unauthorized.' });

  const sms = String(body.sms || body.text || body.message || '');
  if (!sms.trim()) return res.status(400).json({ error: 'Missing sms text.' });

  const { amount, utrs } = parseSms(sms);
  const results = [];
  for (const utr of utrs) {
    let inbound = null;
    let applied = null;
    let error = null;
    try {
      inbound = await recordInboundPayment({ amount, utr, raw: sms });
      applied = await autoVerifyAndApply(utr, amount);
      if (applied && applied.rank && inbound) await markPaymentMatched(inbound.rownum);
    } catch (e) {
      error = e.message;
    }
    results.push({
      utr, amount, logged: !!inbound,
      matched: !!(applied && applied.rank), rank: applied && applied.rank ? applied.rank : null,
      board: applied && applied.board ? applied.board : null,
      amountMismatch: !!(applied && applied.amountMismatch), error,
    });
  }
  console.log('upi-webhook:', JSON.stringify({
    amount, utrCount: utrs.length,
    summary: results.map((r) => ({ utr: r.utr, matched: r.matched, board: r.board, rank: r.rank, error: r.error })),
  }));
  res.status(200).json({ ok: true, amount, results });
};
