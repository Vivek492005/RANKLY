'use strict';
// Cashfree PG helpers: order creation, order status, and webhook signature
// verification. Keys come from env; nothing here throws when they are
// absent — callers check isCashfreeConfigured() and degrade gracefully.
const crypto = require('crypto');

function clientId() { return process.env.CASHFREE_CLIENT_ID || ''; }
function clientSecret() { return process.env.CASHFREE_CLIENT_SECRET || ''; }

function envMode() {
  const m = String(process.env.CASHFREE_ENV || 'production').toLowerCase();
  return m === 'sandbox' ? 'sandbox' : 'production';
}

function apiBase() {
  return envMode() === 'sandbox'
    ? 'https://sandbox.cashfree.com/pg'
    : 'https://api.cashfree.com/pg';
}

function isCashfreeConfigured() {
  return !!(clientId() && clientSecret());
}

async function cfFetch(path, { method = 'GET', body } = {}) {
  const res = await fetch(apiBase() + path, {
    method,
    headers: {
      'x-client-id': clientId(),
      'x-client-secret': clientSecret(),
      'x-api-version': '2025-01-01',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* keep raw text for the error below */ }
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || text || ('HTTP ' + res.status);
    const err = new Error('Cashfree API ' + res.status + ': ' + String(msg).slice(0, 300));
    err.status = res.status;
    throw err;
  }
  return data;
}

function newOrderId() {
  return 'rankly_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
}

// Create a Cashfree order. Amount is in INR (e.g. 100 for ₹100 — NOT paise).
// customerPhone must be a valid 10-digit Indian mobile number (Cashfree
// requires it). Returns the Cashfree order object including
// payment_session_id and order_id.
async function createOrder({ orderId, amount, customerId, customerPhone, customerEmail, returnUrl, notifyUrl }) {
  return cfFetch('/orders', {
    method: 'POST',
    body: {
      order_id: orderId,
      order_amount: Number(amount),
      order_currency: 'INR',
      customer_details: {
        customer_id: customerId,
        customer_phone: customerPhone,
        ...(customerEmail ? { customer_email: customerEmail } : {}),
      },
      order_meta: {
        ...(returnUrl ? { return_url: returnUrl } : {}),
        ...(notifyUrl ? { notify_url: notifyUrl } : {}),
      },
      order_note: 'Rankly rank bid',
    },
  });
}

// Fetch an order's current status from Cashfree. order_status is one of
// PAID / ACTIVE / EXPIRED — only PAID is safe to fulfill.
async function fetchOrder(orderId) {
  return cfFetch('/orders/' + encodeURIComponent(String(orderId)));
}

// Verify the Cashfree webhook signature. Cashfree sends:
//   x-webhook-signature: Base64(HMAC-SHA256(x-webhook-timestamp + rawBody, client_secret))
//   x-webhook-timestamp: epoch seconds
// The raw body (exact bytes) is required — never the parsed JSON.
function verifyWebhookSignature(timestamp, rawBody, signature) {
  if (!timestamp || !rawBody || !signature || !clientSecret()) return false;
  const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  const expected = crypto.createHmac('sha256', clientSecret())
    .update(String(timestamp) + raw)
    .digest('base64');
  const a = Buffer.from(String(signature));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  isCashfreeConfigured,
  envMode,
  apiBase,
  createOrder,
  fetchOrder,
  verifyWebhookSignature,
  newOrderId,
};
