'use strict';
// jsdom test: after a claim submit WITHOUT instant verification, the verify
// dialog opens and polls /api/claim-status until the payment is applied,
// then flips to the success state on its own.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('/home/hatch/.tmp-jsdom/node_modules/jsdom');

const APP = path.resolve(__dirname, '../vercel-app');

function buildDom() {
  const html = `<!DOCTYPE html><html><body>
    <div id="toast"></div>
    <dialog id="checkoutDialog">
      <h2 id="checkoutTitle"></h2>
      <span id="reviewLabel1"></span><strong id="reviewValue1"></strong>
      <span id="reviewLabel2"></span><strong id="reviewValue2"></strong>
      <span id="reviewLabel3"></span><strong id="reviewValue3"></strong>
      <span id="reviewLabel4"></span><strong id="reviewValue4"></strong>
      <p id="checkoutIntroManual"></p>
      <p id="checkoutIntroRzp" hidden></p>
      <div id="rzpPaySection" hidden>
        <button id="razorpayPayBtn">Pay securely</button>
        <button id="cancelCheckoutRzp"></button>
      </div>
      <div id="manualPaySection">
      <strong id="upiIdText">sochai@ptyes</strong>
      <span id="upiAmount"></span>
      <input id="utrInput" />
      <button id="cancelCheckout"></button>
      <button id="confirmCheckout">I've paid — submit claim</button>
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
  window.eval(src + '\n;window.__t = { openCheckout, wireCheckout, wireVerifyDialog, openVerifyDialog, stopVerifyPolling };');
  return { window, ticks, cleared };
}

const flush = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

async function run() {
  let pass = 0;
  const t = async (name, fn) => { await fn(); pass++; console.log('ok -', name); };

  await t('verify dialog opens on submit without instant verification', async () => {
    const { window, ticks } = buildDom();
    window.fetch = async (url) => ({
      ok: true,
      json: async () => ({ ok: true, board: 'profiles', autoApplied: false, rank: null }),
    });
    const T = window.__t;
    T.wireCheckout(); T.wireVerifyDialog();
    T.openCheckout({ title: 'T', summary: [['a', 'b']], amount: 5, body: { board: 'profiles', name: 'Asha', headline: 'Dev', linkedin: 'https://linkedin.com/in/asha', bid: 5 } });
    window.document.getElementById('utrInput').value = 'ABC123456';
    window.document.getElementById('confirmCheckout').click();
    await flush();
    assert.strictEqual(window.document.getElementById('verifyDialog').open, true, 'verify dialog should be open');
    assert.strictEqual(window.document.getElementById('verifyTitle').textContent, 'Waiting for your payment…');
    assert.strictEqual(ticks.length, 1, 'polling interval should be registered');
  });

  await t('dialog flips to verified when claim-status reports applied', async () => {
    const { window, ticks } = buildDom();
    const statusQueue = [
      { found: true, status: 'awaiting verification', rank: null },
      { found: true, status: 'applied', rank: '2', board: 'profiles', name: 'Asha' },
    ];
    window.fetch = async (url) => ({
      ok: true,
      json: async () => url.includes('/api/claim-status')
        ? (statusQueue.shift() || { found: false })
        : { ok: true, board: 'profiles', autoApplied: false, rank: null },
    });
    const T = window.__t;
    T.wireCheckout(); T.wireVerifyDialog();
    T.openCheckout({ title: 'T', summary: [['a', 'b']], amount: 5, body: { board: 'profiles', name: 'Asha', headline: 'Dev', linkedin: 'https://linkedin.com/in/asha', bid: 5 } });
    window.document.getElementById('utrInput').value = 'ABC123456';
    window.document.getElementById('confirmCheckout').click();
    await flush();
    // openVerifyDialog fires one tick immediately (consumes 'awaiting')
    assert.strictEqual(window.document.getElementById('verifyTitle').textContent, 'Waiting for your payment…');
    const tick = ticks[0];
    await tick(); await flush(); // next poll: applied
    assert.strictEqual(window.document.getElementById('verifyTitle').textContent, 'Payment verified!');
    assert.match(window.document.getElementById('verifyText').textContent, /rank #2/);
    assert.strictEqual(window.document.getElementById('verifyViewBoard').hidden, false);
  });

  await t('closing the dialog stops polling', async () => {
    const { window, ticks, cleared } = buildDom();
    window.fetch = async () => ({ ok: true, json: async () => ({ ok: true, autoApplied: false, rank: null }) });
    const T = window.__t;
    T.wireCheckout(); T.wireVerifyDialog();
    T.openCheckout({ title: 'T', summary: [['a', 'b']], amount: 5, body: { board: 'profiles', name: 'A', headline: 'D', linkedin: 'https://x.io', bid: 5 } });
    window.document.getElementById('utrInput').value = 'ABC123456';
    window.document.getElementById('confirmCheckout').click();
    await flush();
    assert.strictEqual(ticks.length, 1);
    window.document.getElementById('verifyClose').click();
    await flush();
    assert.deepStrictEqual(cleared, [1], 'interval should be cleared on close');
    assert.strictEqual(window.document.getElementById('verifyDialog').open, false);
  });

  await t('no verify dialog falls back to toast (no crash)', async () => {
    const { window } = buildDom();
    window.document.getElementById('verifyDialog').remove();
    window.fetch = async () => ({ ok: true, json: async () => ({ ok: true, autoApplied: false, rank: null }) });
    const T = window.__t;
    T.wireCheckout();
    // wireVerifyDialog must tolerate the missing dialog
    T.wireVerifyDialog();
    T.openCheckout({ title: 'T', summary: [['a', 'b']], amount: 5, body: { board: 'profiles', name: 'A', headline: 'D', linkedin: 'https://x.io', bid: 5 } });
    window.document.getElementById('utrInput').value = 'ABC123456';
    window.document.getElementById('confirmCheckout').click();
    await flush();
    assert.match(window.document.getElementById('toast').textContent, /detected automatically/);
  });

  console.log(`\n${pass}/4 verify-polling UI tests passed`);
}

run().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
