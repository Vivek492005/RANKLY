'use strict';
// POST /api/verify-payment — Cashfree path, step 2 (browser callback).
// The frontend calls this with the Cashfree order id after the checkout
// completes. We ask Cashfree directly for the order status and only apply
// the claim when it reports PAID for the exact bid amount. Never trusts the
// browser's word alone. Idempotent: repeated calls for the same order
// return the stored rank.
//
// Body: { order_id }
// Response: { ok, rank, board } — or { ok, alreadyApplied, rank, board }.
const { verifyAndApplyCashfreeClaim } = require('../lib/sheets');
const { isCashfreeConfigured, fetchOrder } = require('../lib/cashfree');

const { applyCors } = require('../lib/cors');
module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return; // CORS for the GitHub Pages mirror
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isCashfreeConfigured()) {
    return res.status(503).json({ error: 'Online payments are not enabled yet.' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (body == null || typeof body !== 'object') body = {};

  const orderId = String(body.order_id || '').trim();
  if (!orderId) {
    return res.status(400).json({ error: 'Incomplete payment response. Please try again.' });
  }

  // Confirm with Cashfree directly: only PAID means the money arrived.
  // The order amount was set server-side at creation, so a mismatch here
  // means something is wrong — never apply.
  let order;
  try {
    order = await fetchOrder(orderId);
  } catch (e) {
    console.error('verify-payment: order fetch failed:', e.message);
    return res.status(502).json({ error: 'Could not confirm the payment. Please try again.' });
  }
  if (!order || String(order.order_id) !== orderId) {
    return res.status(400).json({ error: 'Payment does not match this order.' });
  }
  if (order.order_status !== 'PAID') {
    return res.status(402).json({ error: 'Payment was not completed.', paymentStatus: order.order_status });
  }

  // Verify + apply the claim (idempotent — safe to retry).
  try {
    const done = await verifyAndApplyCashfreeClaim(orderId, order.order_amount);
    if (done.notFound) return res.status(404).json({ error: 'No claim found for this order.' });
    if (done.wrongState) return res.status(409).json({ error: 'This claim is no longer payable.' });
    if (done.amountMismatch) {
      console.error('verify-payment: amount mismatch', orderId, 'paid', done.paid, 'bid', done.bid);
      return res.status(409).json({ error: 'Paid amount does not match the bid. It will be reviewed manually.' });
    }
    return res.status(200).json({
      ok: true,
      rank: done.rank === '' ? null : Number(done.rank),
      board: done.board,
      alreadyApplied: !!done.alreadyApplied,
    });
  } catch (e) {
    console.error('verify-payment apply failed:', e.message);
    return res.status(500).json({ error: 'Payment received but the rank could not be published yet. It will be applied automatically.' });
  }
};
