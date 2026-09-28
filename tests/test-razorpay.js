'use strict';
// Razorpay integration tests: signature verification, webhook auth,
// shared claim validation, and handler-level rejection paths.
// (Happy-path apply is covered by the live test-mode E2E once keys exist.)
const assert = require('assert');
const crypto = require('crypto');
const { Readable } = require('stream');

const rzp = require('../vercel-app/lib/razorpay');
const cv = require('../vercel-app/lib/claimValidation');
const webhook = require('../vercel-app/api/razorpay-webhook');
const verifyPayment = require('../vercel-app/api/verify-payment');

let pass = 0;
const queue = [];
// Queued and run SEQUENTIALLY at the bottom: several tests mutate
// process.env, which is process-global, so they must never overlap.
const t = (name, fn) => queue.push({ name, fn });

async function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) { prev[k] = process.env[k]; process.env[k] = vars[k]; }
  // lib/razorpay caches nothing except the SDK client; reset it between cases.
  delete require.cache[require.resolve('../vercel-app/lib/razorpay')];
  try { return await fn(require('../vercel-app/lib/razorpay')); }
  finally {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k];
    }
    delete require.cache[require.resolve('../vercel-app/lib/razorpay')];
  }
}

function mockReq(raw, headers) {
  const r = new Readable({ read() {} });
  r.headers = headers || {};
  r.method = 'POST';
  process.nextTick(() => { if (raw != null) r.push(Buffer.from(raw)); r.push(null); });
  return r;
}
function mockRes() {
  const res = {};
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  return res;
}

// ---------- Payment signature verification ----------
t('verifyPaymentSignature accepts a correctly computed signature', () => {
  return withEnv({ RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 's3cr3t' }, (m) => {
    const sig = crypto.createHmac('sha256', 's3cr3t').update('order_1|pay_1').digest('hex');
    assert.strictEqual(m.verifyPaymentSignature('order_1', 'pay_1', sig), true);
  });
});

t('verifyPaymentSignature rejects tampered fields and bad signatures', () => {
  return withEnv({ RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 's3cr3t' }, (m) => {
    const sig = crypto.createHmac('sha256', 's3cr3t').update('order_1|pay_1').digest('hex');
    assert.strictEqual(m.verifyPaymentSignature('order_1', 'pay_2', sig), false);
    assert.strictEqual(m.verifyPaymentSignature('order_1', 'pay_1', 'deadbeef'), false);
    assert.strictEqual(m.verifyPaymentSignature('order_1', 'pay_1', sig.toUpperCase()), false);
    assert.strictEqual(m.verifyPaymentSignature('', 'pay_1', sig), false);
  });
});

t('verifyPaymentSignature is false when the secret is missing', () => {
  return withEnv({ RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: '' }, (m) => {
    assert.strictEqual(m.verifyPaymentSignature('order_1', 'pay_1', 'abc'), false);
  });
});

// ---------- Webhook signature verification ----------
t('verifyWebhookSignature accepts the true header and rejects fakes', () => {
  return withEnv({ RAZORPAY_WEBHOOK_SECRET: 'whsec' }, (m) => {
    const raw = Buffer.from(JSON.stringify({ event: 'payment.captured' }));
    const sig = crypto.createHmac('sha256', 'whsec').update(raw).digest('hex');
    assert.strictEqual(m.verifyWebhookSignature(raw, sig), true);
    assert.strictEqual(m.verifyWebhookSignature(raw, 'nope'), false);
    assert.strictEqual(m.verifyWebhookSignature(Buffer.from('{}'), sig), false);
  });
});

t('isRazorpayConfigured reflects the key env vars', () => {
  return withEnv({ RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '' }, (m) => {
    assert.strictEqual(m.isRazorpayConfigured(), false);
  });
  withEnv({ RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 's' }, (m) => {
    assert.strictEqual(m.isRazorpayConfigured(), true);
  });
});

t('newReceipt is short and unique', () => {
  const a = rzp.newReceipt();
  const b = rzp.newReceipt();
  assert.ok(a.startsWith('rankly_') && a.length <= 40, a);
  assert.notStrictEqual(a, b);
});

// ---------- Shared claim validation ----------
const goodProfile = {
  board: 'profiles', name: 'Asha', headline: 'Full-stack dev',
  linkedin: 'https://linkedin.com/in/asha', bid: 150,
};
const goodShowcase = {
  board: 'showcase', name: 'Cool App', headline: 'Asha',
  link: 'https://github.com/asha/app', bid: 200,
};

t('validateClaimBody accepts good profiles and showcase claims', () => {
  const p = cv.validateClaimBody({ ...goodProfile });
  assert.strictEqual(p.claim.board, 'profiles');
  assert.strictEqual(p.claim.bid, 150);
  const s = cv.validateClaimBody({ ...goodShowcase });
  assert.strictEqual(s.claim.board, 'showcase');
  assert.strictEqual(s.claim.platform, 'Other');
});

t('validateClaimBody rejects missing/invalid fields with 400', () => {
  assert.throws(() => cv.validateClaimBody({ ...goodProfile, name: '' }), /name is required/);
  assert.throws(() => cv.validateClaimBody({ ...goodProfile, linkedin: '', github: '', coding: '' }), /at least one profile link/);
  assert.throws(() => cv.validateClaimBody({ ...goodProfile, linkedin: 'notaurl' }), /valid URL/);
  assert.throws(() => cv.validateClaimBody({ ...goodProfile, email: 'bad' }), /email/);
  assert.throws(() => cv.validateClaimBody({ ...goodProfile, bid: 0 }), /Minimum bid/);
  assert.throws(() => cv.validateClaimBody({ ...goodProfile, bid: 1000 }), /Maximum bid/);
  assert.throws(() => cv.validateClaimBody({ ...goodShowcase, link: '' }), /valid link/);
});

t('validateClaimBody enforces UTR only when required', () => {
  const noUtr = cv.validateClaimBody({ ...goodProfile });
  assert.strictEqual(noUtr.claim.utr, undefined);
  assert.throws(() => cv.validateClaimBody({ ...goodProfile }, { requireUtr: true }), /transaction ID/);
  const withUtr = cv.validateClaimBody({ ...goodProfile, utr: ' 412345678901 ' }, { requireUtr: true });
  assert.strictEqual(withUtr.claim.utr, '412345678901');
});

// ---------- Webhook handler: auth layer ----------
t('razorpay-webhook rejects a bad signature with 401 and touches nothing', async () => {
  const res = mockRes();
  await webhook(mockReq('{"event":"payment.captured"}', { 'x-razorpay-signature': 'bad' }), res);
  assert.strictEqual(res.statusCode, 401);
});

t('razorpay-webhook 405s non-POST', async () => {
  const req = mockReq(null, {});
  req.method = 'GET';
  const res = mockRes();
  await webhook(req, res);
  assert.strictEqual(res.statusCode, 405);
});

t('razorpay-webhook acks unknown events with 200 (no-op)', async () => {
  await withEnv({ RAZORPAY_WEBHOOK_SECRET: 'whsec' }, async (m) => {
    // Re-require the handler so it picks up the same env (it reads the
    // secret lazily per request, so the shared instance is fine).
    const raw = JSON.stringify({ event: 'order.paid', payload: {} });
    const sig = crypto.createHmac('sha256', 'whsec').update(Buffer.from(raw)).digest('hex');
    const res = mockRes();
    await webhook(mockReq(raw, { 'x-razorpay-signature': sig }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.ok, true);
    assert.ok(m, 'env guard');
  });
});

// ---------- verify-payment handler: rejection paths (no sheets touched) ----------
t('verify-payment 503s when Razorpay is not configured', async () => {
  const res = mockRes();
  await verifyPayment({ method: 'POST', body: {} }, res);
  // Keys are absent in this test env → 503 before anything else.
  assert.strictEqual(res.statusCode, 503);
});

t('verify-payment rejects incomplete and forged responses', async () => {
  await withEnv({ RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 's3cr3t' }, async () => {
    let res = mockRes();
    await verifyPayment({ method: 'POST', body: { razorpay_order_id: 'order_1' } }, res);
    assert.strictEqual(res.statusCode, 400);

    res = mockRes();
    await verifyPayment({
      method: 'POST',
      body: { razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'forged' },
    }, res);
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.body.error, /verification failed/i);
  });
});



// ---------- jsdom: checkout dialog toggles Razorpay vs manual UPI ----------
queue.push({ name: 'checkout dialog shows Razorpay section when enabled, manual otherwise', fn: async () => {
  const { JSDOM } = require('/home/hatch/.tmp-jsdom/node_modules/jsdom');
  const fs = require('fs');
  const path = require('path');
  const APP = path.resolve(__dirname, '../vercel-app');
  const html = `<!DOCTYPE html><html><body>
    <span id="payModeBadge"></span><span id="paymentNoteText"></span>
    <div id="toast"></div>
    <dialog id="checkoutDialog">
      <h2 id="checkoutTitle"></h2>
      <span id="reviewLabel1"></span><strong id="reviewValue1"></strong>
      <span id="reviewLabel2"></span><strong id="reviewValue2"></strong>
      <span id="reviewLabel3"></span><strong id="reviewValue3"></strong>
      <span id="reviewLabel4"></span><strong id="reviewValue4"></strong>
      <p id="checkoutIntroManual"></p><p id="checkoutIntroRzp" hidden></p>
      <div id="rzpPaySection" hidden>
        <button id="razorpayPayBtn">Pay securely</button>
        <button id="cancelCheckoutRzp"></button>
      </div>
      <div id="manualPaySection">
        <strong id="upiIdText">sochai@ptyes</strong><span id="upiAmount"></span>
        <input id="utrInput" />
        <button id="cancelCheckout"></button>
        <button id="confirmCheckout">go</button>
      </div>
    </dialog>
  </body></html>`;
  const dom = new JSDOM(html, { url: 'https://localhost/', runScripts: 'outside-only' });
  const { window } = dom;
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  const src = fs.readFileSync(path.join(APP, 'shared.js'), 'utf8');
  window.eval(src + '\n;window.__t = { openCheckout, initPayments };');
  const T = window.__t;
  const doc = window.document;

  // Razorpay enabled → Razorpay section visible, manual hidden, amount on button.
  window.fetch = async () => ({ ok: true, json: async () => ({ mode: 'upi-manual', razorpayEnabled: true, razorpayKeyId: 'rzp_test_x', upiId: 'sochai@ptyes' }) });
  await T.initPayments();
  T.openCheckout({ title: 'T', summary: [['a', 'b']], amount: 250, body: { board: 'profiles', bid: 250 } });
  assert.strictEqual(doc.getElementById('rzpPaySection').hidden, false, 'rzp section visible');
  assert.strictEqual(doc.getElementById('manualPaySection').hidden, true, 'manual section hidden');
  assert.strictEqual(doc.getElementById('checkoutIntroRzp').hidden, false, 'rzp intro visible');
  assert.strictEqual(doc.getElementById('checkoutIntroManual').hidden, true, 'manual intro hidden');
  assert.ok(doc.getElementById('razorpayPayBtn').textContent.includes('250'), 'button shows amount: ' + doc.getElementById('razorpayPayBtn').textContent);
  doc.getElementById('checkoutDialog').close();

  // Razorpay disabled → manual UPI section visible as before.
  window.fetch = async () => ({ ok: true, json: async () => ({ mode: 'upi-manual', razorpayEnabled: false, upiId: 'sochai@ptyes' }) });
  await T.initPayments();
  T.openCheckout({ title: 'T', summary: [['a', 'b']], amount: 250, body: { board: 'profiles', bid: 250 } });
  assert.strictEqual(doc.getElementById('rzpPaySection').hidden, true, 'rzp section hidden');
  assert.strictEqual(doc.getElementById('manualPaySection').hidden, false, 'manual section visible');
  assert.strictEqual(doc.getElementById('upiAmount').textContent, '₹250', 'manual amount set');
} });

(async () => {
  for (const { name, fn } of queue) {
    try { await fn(); pass++; console.log('ok -', name); }
    catch (e) { console.error('FAIL -', name, '\n', e); process.exitCode = 1; }
  }
  console.log(`\n${pass} razorpay checks passed`);
})();
