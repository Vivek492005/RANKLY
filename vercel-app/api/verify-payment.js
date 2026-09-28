'use strict';
// POST /api/verify-payment — Razorpay path, step 2 (browser callback).
// The frontend calls this with the Razorpay Checkout response after the
// user pays. We verify the signature, confirm the payment is captured for
// the exact bid amount via the Razorpay API, then verify + apply the claim.
// Idempotent: repeated calls for the same order return the stored rank.
//
// Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
// Response: { ok, rank, board } — or { ok, alreadyApplied, rank, board }.
const { verifyAndApplyRazorpayClaim } = require('../lib/sheets');
const { isRazorpayConfigured, getClient, verifyPaymentSignature } = require('../lib/razorpay');

const { applyCors } = require('../lib/cors');
module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return; // CORS for the GitHub Pages mirror
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isRazorpayConfigured()) {
    return res.status(503).json({ error: 'Online payments are not enabled yet.' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (body == null || typeof body !== 'object') body = {};

  const orderId = String(body.razorpay_order_id || '').trim();
  const paymentId = String(body.razorpay_payment_id || '').trim();
  const signature = String(body.razorpay_signature || '').trim();
  if (!orderId || !paymentId || !signature) {
    return res.status(400).json({ error: 'Incomplete payment response. Please try again.' });
  }

  // 1) The signature must match — this proves Razorpay issued this payment
  //    for this order and the browser didn't tamper with it.
  if (!verifyPaymentSignature(orderId, paymentId, signature)) {
    console.error('verify-payment: bad signature for order', orderId);
    return res.status(400).json({ error: 'Payment verification failed. Please contact support if money was deducted.' });
  }

  // 2) Confirm with Razorpay directly: captured + exact amount. The order
  //    amount was set server-side at creation, so a mismatch here means
  //    something is wrong — never apply.
  let payment;
  try {
    payment = await getClient().payments.fetch(paymentId);
  } catch (e) {
    console.error('verify-payment: payment fetch failed:', e.message);
    return res.status(502).json({ error: 'Could not confirm the payment. Please try again.' });
  }
  if (!payment || payment.order_id !== orderId) {
    return res.status(400).json({ error: 'Payment does not match this order.' });
  }
  if (payment.status !== 'captured') {
    return res.status(402).json({ error: 'Payment was not completed.', paymentStatus: payment.status });
  }

  // 3) Verify + apply the claim (idempotent — safe to retry).
  try {
    const done = await verifyAndApplyRazorpayClaim(orderId, payment.amount);
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
