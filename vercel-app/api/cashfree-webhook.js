'use strict';
// POST /api/cashfree-webhook — Cashfree path, backstop.
// Cashfree calls this when a payment succeeds, fails, or is dropped,
// covering the case where the user closes the browser before
// /api/verify-payment runs. The x-webhook-signature header is verified
// against the raw request body (HMAC-SHA256 of
// x-webhook-timestamp + rawBody, keyed with the client secret); anything
// that fails verification gets a 401 and is ignored.
//
// Events handled:
//   PAYMENT_SUCCESS_WEBHOOK     → confirm PAID via the API, then verify +
//                                 apply the matching claim (idempotent)
//   PAYMENT_FAILED_WEBHOOK      → mark the claim "Payment failed"
//   PAYMENT_USER_DROPPED_WEBHOOK → mark the claim "Payment failed"
// Everything else → 200, ignored.
const { verifyAndApplyCashfreeClaim, findClaimByOrderId, setClaimStatus } = require('../lib/sheets');
const { verifyWebhookSignature, fetchOrder } = require('../lib/cashfree');

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

function orderIdOf(event) {
  const d = (event && event.data) || {};
  const o = d.order || {};
  return String(o.order_id || '');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let raw;
  try {
    raw = await readRawBody(req);
  } catch (e) {
    return res.status(400).json({ error: 'Could not read request.' });
  }
  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-webhook-timestamp'];
  if (!verifyWebhookSignature(timestamp, raw, signature)) {
    return res.status(401).json({ error: 'Bad signature.' });
  }

  let event;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Bad payload.' });
  }

  try {
    const type = String(event.type || '');
    if (type === 'PAYMENT_SUCCESS_WEBHOOK') {
      const orderId = orderIdOf(event);
      if (orderId) {
        // Never trust the webhook alone — confirm PAID with Cashfree
        // directly before applying anything.
        const order = await fetchOrder(orderId);
        if (order && order.order_status === 'PAID') {
          const done = await verifyAndApplyCashfreeClaim(orderId, order.order_amount);
          console.log('cashfree-webhook PAYMENT_SUCCESS:', orderId,
            done.alreadyApplied ? 'already applied' : (done.rank != null ? 'rank ' + done.rank : JSON.stringify(done)));
        } else {
          console.log('cashfree-webhook PAYMENT_SUCCESS but order not PAID:', orderId,
            order ? order.order_status : 'fetch failed');
        }
      }
    } else if (type === 'PAYMENT_FAILED_WEBHOOK' || type === 'PAYMENT_USER_DROPPED_WEBHOOK') {
      const orderId = orderIdOf(event);
      if (orderId) {
        const found = await findClaimByOrderId(orderId);
        if (found && (found.status === 'awaiting payment' || found.status === 'verifying')) {
          await setClaimStatus(found.rownum, 'Payment failed', '');
          console.log('cashfree-webhook', type + ':', orderId);
        }
      }
    }
  } catch (e) {
    // Never 500 a webhook over an apply failure — the claim is left
    // 'verified' for the cron backstop; Cashfree would otherwise retry
    // a body that can never succeed.
    console.error('cashfree-webhook handling failed:', e.message);
  }
  res.status(200).json({ ok: true });
};
