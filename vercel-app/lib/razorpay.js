'use strict';
// Razorpay helpers: lazy client, payment-signature verification, and webhook
// signature verification. Nothing here throws when the keys are absent —
// callers check isRazorpayConfigured() and degrade gracefully.
const crypto = require('crypto');

function keyId() { return process.env.RAZORPAY_KEY_ID || ''; }
function keySecret() { return process.env.RAZORPAY_KEY_SECRET || ''; }
function webhookSecret() { return process.env.RAZORPAY_WEBHOOK_SECRET || ''; }

function isRazorpayConfigured() {
  return !!(keyId() && keySecret());
}

let client = null;
// Lazily require the SDK so unit tests and non-payment paths never pay for
// it (and so a missing install can't break unrelated endpoints).
function getClient() {
  if (!isRazorpayConfigured()) return null;
  if (!client) {
    const Razorpay = require('razorpay');
    client = new Razorpay({ key_id: keyId(), key_secret: keySecret() });
  }
  return client;
}

// Verify the signature Razorpay Checkout hands the browser after a payment:
// HMAC-SHA256("<order_id>|<payment_id>", key_secret). Uses timing-safe
// comparison so a wrong signature can't be probed byte-by-byte.
function verifyPaymentSignature(orderId, paymentId, signature) {
  if (!orderId || !paymentId || !signature || !keySecret()) return false;
  const expected = crypto.createHmac('sha256', keySecret())
    .update(String(orderId) + '|' + String(paymentId))
    .digest('hex');
  const a = Buffer.from(String(signature));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Verify the X-Razorpay-Signature header on a webhook: HMAC-SHA256 of the
// exact raw request body, keyed with the webhook secret.
function verifyWebhookSignature(rawBody, signature) {
  if (!rawBody || !signature || !webhookSecret()) return false;
  const expected = crypto.createHmac('sha256', webhookSecret())
    .update(rawBody)
    .digest('hex');
  const a = Buffer.from(String(signature));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Short, unique receipt for a Razorpay order (max 40 chars).
function newReceipt() {
  return 'rankly_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
}

module.exports = {
  isRazorpayConfigured,
  getClient,
  verifyPaymentSignature,
  verifyWebhookSignature,
  newReceipt,
  keyId,
};
