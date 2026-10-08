'use strict';
// Unit tests for vercel-app/lib/cashfree.js: webhook signature verification,
// order id generation, and environment selection. No network calls.
const assert = require('assert');
const crypto = require('crypto');
const path = require('path');

const libPath = path.join(__dirname, '../vercel-app/lib/cashfree.js');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('ok -', name); };

function loadFresh(env) {
  delete require.cache[require.resolve(libPath)];
  const saved = {};
  for (const k of ['CASHFREE_CLIENT_ID', 'CASHFREE_CLIENT_SECRET', 'CASHFREE_ENV']) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  Object.assign(process.env, env);
  const lib = require(libPath);
  return { lib, restore() { for (const k of Object.keys(saved)) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  } } };
}

// ---------- webhook signature ----------
t('verifyWebhookSignature accepts a correctly signed payload', () => {
  const { lib, restore } = loadFresh({ CASHFREE_CLIENT_ID: 'id1', CASHFREE_CLIENT_SECRET: 's3cr3t' });
  try {
    const timestamp = '1759333600';
    const rawBody = '{"type":"PAYMENT_SUCCESS_WEBHOOK","data":{"order":{"order_id":"rankly_abc"}}}';
    const sig = crypto.createHmac('sha256', 's3cr3t').update(timestamp + rawBody).digest('base64');
    assert.strictEqual(lib.verifyWebhookSignature(timestamp, Buffer.from(rawBody), sig), true);
  } finally { restore(); }
});

t('verifyWebhookSignature rejects tampered body, timestamp, and signature', () => {
  const { lib, restore } = loadFresh({ CASHFREE_CLIENT_ID: 'id1', CASHFREE_CLIENT_SECRET: 's3cr3t' });
  try {
    const timestamp = '1759333600';
    const rawBody = '{"type":"PAYMENT_SUCCESS_WEBHOOK"}';
    const sig = crypto.createHmac('sha256', 's3cr3t').update(timestamp + rawBody).digest('base64');
    assert.strictEqual(lib.verifyWebhookSignature(timestamp, rawBody + 'x', sig), false, 'tampered body');
    assert.strictEqual(lib.verifyWebhookSignature('1759333601', rawBody, sig), false, 'wrong timestamp');
    assert.strictEqual(lib.verifyWebhookSignature(timestamp, rawBody, 'bogus'), false, 'bogus signature');
    assert.strictEqual(lib.verifyWebhookSignature('', rawBody, sig), false, 'missing timestamp');
  } finally { restore(); }
});

t('verifyWebhookSignature fails closed without a secret', () => {
  const { lib, restore } = loadFresh({ CASHFREE_CLIENT_ID: 'id1' });
  try {
    assert.strictEqual(lib.verifyWebhookSignature('t', 'body', 'sig'), false);
    assert.strictEqual(lib.isCashfreeConfigured(), false, 'not configured without secret');
  } finally { restore(); }
});

// ---------- order ids ----------
t('newOrderId is unique and URL/column safe', () => {
  const { lib, restore } = loadFresh({});
  try {
    const a = lib.newOrderId();
    const b = lib.newOrderId();
    assert.notStrictEqual(a, b);
    assert.match(a, /^rankly_[a-z0-9_]+$/, 'safe id: ' + a);
    assert.ok(a.length <= 32, 'fits the claim-status pattern');
  } finally { restore(); }
});

// ---------- environments ----------
t('envMode/apiBase select sandbox vs production', () => {
  const { lib, restore } = loadFresh({ CASHFREE_CLIENT_ID: 'x', CASHFREE_CLIENT_SECRET: 'y', CASHFREE_ENV: 'sandbox' });
  try {
    assert.strictEqual(lib.envMode(), 'sandbox');
    assert.strictEqual(lib.apiBase(), 'https://sandbox.cashfree.com/pg');
    assert.strictEqual(lib.isCashfreeConfigured(), true);
  } finally { restore(); }
  const p = loadFresh({ CASHFREE_CLIENT_ID: 'x', CASHFREE_CLIENT_SECRET: 'y' });
  try {
    assert.strictEqual(p.lib.envMode(), 'production', 'defaults to production');
    assert.strictEqual(p.lib.apiBase(), 'https://api.cashfree.com/pg');
  } finally { p.restore(); }
});

console.log(`\n${pass}/5 cashfree tests passed`);
