'use strict';
// POST /api/razorpay-webhook — Razorpay path, backstop.
// Razorpay calls this when a payment is captured (or fails), covering the
// case where the user closes the browser before /api/verify-payment runs.
// The X-Razorpay-Signature header is verified against the raw request body;
// anything that fails verification gets a 401 and is ignored.
//
// Events handled:
//   payment.captured → verify + apply the matching claim (idempotent)
//   payment.failed   → mark the claim "Payment failed"
// Everything else → 200, ignored.
const { verifyAndApplyRazorpayClaim, findClaimByOrderId, setClaimStatus } = require('../lib/sheets');
const { verifyWebhookSignature } = require('../lib/razorpay');

// Webhook signature verification needs the exact raw bytes, so body parsing
// is disabled for this route.
module.exports.config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let raw;
  try {
    raw = await readRawBody(req);
  } catch (e) {
    return res.status(400).json({ error: 'Could not read request.' });
  }
  const signature = req.headers['x-razorpay-signature'];
  if (!verifyWebhookSignature(raw, signature)) {
    return res.status(401).json({ error: 'Bad signature.' });
  }

  let event;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Bad payload.' });
  }

  try {
    if (event.event === 'payment.captured') {
      const p = (event.payload && event.payload.payment && event.payload.payment.entity) || {};
      const orderId = String(p.order_id || '');
      if (orderId && p.status === 'captured') {
        const done = await verifyAndApplyRazorpayClaim(orderId, p.amount);
        console.log('razorpay-webhook payment.captured:', orderId,
          done.alreadyApplied ? 'already applied' : (done.rank != null ? 'rank ' + done.rank : JSON.stringify(done)));
      }
    } else if (event.event === 'payment.failed') {
      const p = (event.payload && event.payload.payment && event.payload.payment.entity) || {};
      const orderId = String(p.order_id || '');
      if (orderId) {
        const found = await findClaimByOrderId(orderId);
        if (found && (found.status === 'awaiting payment' || found.status === 'verifying')) {
          await setClaimStatus(found.rownum, 'Payment failed', '');
          console.log('razorpay-webhook payment.failed:', orderId);
        }
      }
    }
  } catch (e) {
    // Never 500 a webhook over an apply failure — the claim is left
    // 'verified' for the cron backstop; Razorpay would otherwise retry
    // a body that can never succeed.
    console.error('razorpay-webhook handling failed:', e.message);
  }
  res.status(200).json({ ok: true });
};
