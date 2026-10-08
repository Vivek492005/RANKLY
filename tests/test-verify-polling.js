'use strict';
// jsdom test: the Cashfree checkout flow — the pay button creates an order,
// the Cashfree modal completes the payment, and /api/verify-payment flips
// the rank live. If verification fails, the verify dialog opens and polls
// /api/claim-status until the webhook applies the claim.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('/home/hatch/.tmp-jsdom/node_modules/jsdom');

const APP = path.resolve(__dirname, '../vercel-app');

function buildDom() {
  const html = `<!DOCTYPE html><html><body>
    <div id="toast"></div>
    <div id="payModeBadge"></div>
    <dialog id="checkoutDialog">
      <h2 id="checkoutTitle"></h2>
      <span id="reviewLabel1"></span><strong id="reviewValue1"></strong>
      <span id="reviewLabel2"></span><strong id="reviewValue2"></strong>
      <span id="reviewLabel3"></span><strong id="reviewValue3"></strong>
      <span id="reviewLabel4"></span><strong id="reviewValue4"></strong>
      <p id="checkoutIntroCf"></p>
      <div id="cfPaySection">
        <input id="cfPhoneInput" />
        <button id="cashfreePayBtn">Pay securely</button>
        <button id="cancelCheckoutCf"></button>
      </div>
    </dialog>
    <dialog id="verifyDialog">
      <h2 id="verifyTitle"></h2>
      <p id="verifyText"></p>
      <div id="verifySpinner"><span class="spinner"></span></div>
      <button id="verifyClose">Close</button>
      <button id="verifyViewBoard" hidden>View leaderboard</button>
    </dialog>
  </body></html>`;
  const dom = new JSDOM(html, { url: 'https://localhost/', runScripts: 'outside-only' });
  const { window } = dom;
  // dialog stubs (jsdom lacks showModal)
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
    this.dispatchEvent(new window.Event('close'));
  };
  Object.defineProperty(window.HTMLDialogElement.prototype, 'open', {
    get() { return this.hasAttribute('open'); },
  });
  // capture the polling interval
  const ticks = [];
  const cleared = [];
  window.setInterval = (fn) => { ticks.push(fn); return ticks.length; };
  window.clearInterval = (id) => { cleared.push(id); };
  // shared.js source
  const src = fs.readFileSync(path.join(APP, 'shared.js'), 'utf8');
  window.eval(src + '\n;window.__t = { initPayments, openCheckout, wireCheckout, wireVerifyDialog, openVerifyDialog, stopVerifyPolling };');
  return { window, ticks, cleared };
}

const flush = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

const claimBody = { board: 'profiles', name: 'Asha', headline: 'Dev', linkedin: 'https://linkedin.com/in/asha', bid: 5 };

function mockFetch(routes) {
  return async (url) => {
    for (const [match, resp] of routes) {
      if (url.includes(match)) return { ok: resp.ok !== false, json: async () => resp.body };
    }
    throw new Error('unexpected fetch ' + url);
  };
}

async function run() {
  let pass = 0;
  const t = async (name, fn) => { await fn(); pass++; console.log('ok -', name); };

  await t('cashfree success path verifies payment and toasts rank', async () => {
    const { window } = buildDom();
    const calls = [];
    window.fetch = async (url) => {
      calls.push(url);
      return mockFetch([
        ['/api/config', { body: { cashfreeEnabled: true, cashfreeMode: 'production', sheetsConfigured: true } }],
        ['/api/create-order', { body: { paymentSessionId: 'sess_1', orderId: 'rankly_t1' } }],
        ['/api/verify-payment', { body: { ok: true, rank: '3', board: 'profiles' } }],
      ])(url);
    };
    window.Cashfree = () => ({ checkout: async () => ({ paymentDetails: { orderId: 'rankly_t1' } }) });
    const T = window.__t;
    await T.initPayments();
    T.wireCheckout(); T.wireVerifyDialog();
    let afterData = null;
    T.openCheckout({ title: 'T', summary: [['a', 'b']], amount: 5, body: claimBody, afterSubmit: (d) => { afterData = d; } });
    assert.strictEqual(window.document.getElementById('checkoutDialog').open, true, 'checkout opens');
    window.document.getElementById('cfPhoneInput').value = '9876543210';
    window.document.getElementById('cashfreePayBtn').click();
    await flush();
    assert.ok(calls.some((u) => u.includes('/api/create-order')), 'order created');
    assert.ok(calls.some((u) => u.includes('/api/verify-payment')), 'payment verified');
    assert.strictEqual(window.document.getElementById('checkoutDialog').open, false, 'dialog closed for checkout');
    assert.match(window.document.getElementById('toast').textContent, /rank #3/, 'rank toast shown');
    assert.ok(afterData && afterData.ok, 'afterSubmit ran');
    window.document.close();
  });

  await t('failed verify opens polling dialog until webhook applies', async () => {
    const { window, ticks } = buildDom();
    const queue = [
      { found: true, status: 'awaiting payment', rank: null },
      { found: true, status: 'applied', rank: '2', board: 'profiles', name: 'Asha' },
    ];
    window.fetch = async (url) => {
      if (url.includes('/api/claim-status')) return { ok: true, json: async () => (queue.shift() || { found: false }) };
      return mockFetch([
        ['/api/config', { body: { cashfreeEnabled: true, cashfreeMode: 'production', sheetsConfigured: true } }],
        ['/api/create-order', { body: { paymentSessionId: 'sess_2', orderId: 'rankly_t2' } }],
        ['/api/verify-payment', { ok: false, body: { error: 'not paid yet' } }],
      ])(url);
    };
    window.Cashfree = () => ({ checkout: async () => ({ paymentDetails: { orderId: 'rankly_t2' } }) });
    const T = window.__t;
    await T.initPayments();
    T.wireCheckout(); T.wireVerifyDialog();
    T.openCheckout({ title: 'T', summary: [['a', 'b']], amount: 5, body: claimBody });
    window.document.getElementById('cfPhoneInput').value = '9876543210';
    window.document.getElementById('cashfreePayBtn').click();
    await flush();
    assert.strictEqual(window.document.getElementById('verifyDialog').open, true, 'verify dialog should be open');
    assert.strictEqual(window.document.getElementById('verifyTitle').textContent, 'Confirming your payment…');
    assert.strictEqual(ticks.length, 1, 'polling interval should be registered');
    const tick = ticks[0];
    await tick(); await flush(); // next poll: applied
    assert.strictEqual(window.document.getElementById('verifyTitle').textContent, 'Payment verified!');
    assert.match(window.document.getElementById('verifyText').textContent, /rank #2/);
    assert.strictEqual(window.document.getElementById('verifyViewBoard').hidden, false);
    window.document.close();
  });

  await t('bad phone blocks payment start', async () => {
    const { window } = buildDom();
    let orderCalled = false;
    window.fetch = async (url) => {
      if (url.includes('/api/create-order')) orderCalled = true;
      return { ok: true, json: async () => ({ cashfreeEnabled: true, sheetsConfigured: true }) };
    };
    const T = window.__t;
    await T.initPayments();
    T.wireCheckout();
    T.openCheckout({ title: 'T', summary: [['a', 'b']], amount: 5, body: claimBody });
    window.document.getElementById('cfPhoneInput').value = '12345';
    window.document.getElementById('cashfreePayBtn').click();
    await flush();
    assert.strictEqual(orderCalled, false, 'no order created with bad phone');
    assert.match(window.document.getElementById('toast').textContent, /mobile number/);
    window.document.close();
  });

  await t('openCheckout refuses when cashfree disabled', async () => {
    const { window } = buildDom();
    window.fetch = mockFetch([
      ['/api/config', { body: { cashfreeEnabled: false, sheetsConfigured: true } }],
    ]);
    const T = window.__t;
    await T.initPayments();
    T.wireCheckout();
    T.openCheckout({ title: 'T', summary: [['a', 'b']], amount: 5, body: claimBody });
    await flush();
    assert.strictEqual(window.document.getElementById('checkoutDialog').open, false, 'dialog stays closed');
    assert.match(window.document.getElementById('toast').textContent, /not enabled/);
    window.document.close();
  });

  await t('closing the verify dialog stops polling', async () => {
    const { window, ticks, cleared } = buildDom();
    const T = window.__t;
    T.wireVerifyDialog();
    T.openVerifyDialog('rankly_t9');
    await flush();
    assert.strictEqual(ticks.length, 1);
    window.document.getElementById('verifyClose').click();
    await flush();
    assert.deepStrictEqual(cleared, [1], 'interval should be cleared on close');
    assert.strictEqual(window.document.getElementById('verifyDialog').open, false);
    window.document.close();
  });

  console.log(`\n${pass}/5 verify-polling tests passed`);
}

run().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
