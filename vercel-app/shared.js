'use strict';
/* Rankly shared frontend: config, sheet fetching, payments, checkout, dialogs. */

// GitHub Pages mirror: the static copy on <user>.github.io has no /api/*
// functions, so its frontend calls the Vercel deployment cross-origin
// (the APIs send CORS headers for the Pages origin). Same-origin elsewhere.
const API_BASE = /github\.io$/.test(location.hostname) ? 'https://ranklyy.vercel.app' : '';

// ---- Live database: Google Sheets + Docs ----
const RANKLY_DB = {
  spreadsheetId: '1FSWiEoLh8AgADL8jiFye4wOL5lt1KwjYjwSeeTBuy0o',
  tabs: {
    allTime: 'Leaderboard (All time)', today: 'Today', showcase: 'Showcase',
    activity: 'Activity log', stats: 'Site stats'
  },
  docs: {
    terms: '1rv2YuPhiQFR6YPYnHCTSxpRkO1ZkcwiBOpPPBPNBIK0',
    privacy: '1pARNfBffHMZu3RBUrEHNi-phw-qWPWPzAUiieIxoSPk'
  }
};

const $ = (s) => document.querySelector(s);
const money = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(n));
const escapeHTML = (str) => String(str).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const toNum = (s) => Number(String(s ?? '').replace(/[^0-9.\-]/g, '')) || 0;

function parseCSV(text) {
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); field = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = []; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function fetchSheet(tab) {
  const url = `https://docs.google.com/spreadsheets/d/${RANKLY_DB.spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Sheet fetch failed: ' + res.status);
  return parseCSV(await res.text());
}

// ---- Previous weeks (weekly archive) ----
async function fetchWeeks() {
  const res = await fetch(API_BASE + '/api/weeks', { cache: 'no-store' });
  if (!res.ok) throw new Error('Weeks fetch failed: ' + res.status);
  return res.json();
}

function fmtWeekDate(iso) {
  if (!iso) return '';
  const d = new Date(String(iso) + 'T00:00:00');
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function setDataPill(state, text) {
  const pill = $('#dataPill');
  if (!pill) return;
  pill.dataset.state = state;
  $('#dataPillText').textContent = text;
}

function showToast(message) {
  const toastEl = $('#toast');
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toastEl.classList.remove('show'), 3200);
}

// Global shorthand used by page scripts (duels, share fallbacks).
function toast(message) { showToast(message); }

// ---- Presentation helpers (outbid-style design) ----
const AVATAR_COLORS = [
  ['#E8A87C', '#fff'], ['#C38D9E', '#fff'], ['#41B3A3', '#fff'],
  ['#85CDCA', '#3A4A4D'], ['#F9D56B', '#5A4A2A'], ['#8EA9DB', '#fff'],
  ['#E5989B', '#fff'], ['#B5838D', '#fff'],
];
function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function avatarStyle(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [bg, fg] = AVATAR_COLORS[h % AVATAR_COLORS.length];
  return `background:${bg};color:${fg};`;
}

// Avatar markup: a real photo when the profile has one, otherwise the
// initials fallback. The <img> sits on top of the initials and removes
// itself on error, so a broken thumbnail degrades gracefully.
function avatarHTML(name, photo) {
  const fallback = `<div class="avatar" style="${avatarStyle(name)}" aria-hidden="true">${escapeHTML(initialsOf(name))}</div>`;
  const src = String(photo || '').trim();
  // Only render photos from our own Vercel Blob store (rankly-photos path);
  // anything else falls back to initials, so a tampered value can never
  // become an avatar.
  if (/^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/rankly-photos\/[A-Za-z0-9_.\-]+\.(jpg|jpeg|png|webp)$/.test(src)) {
    return `<div class="avatar-photo-wrap" aria-hidden="true">${fallback}<img class="avatar-img" src="${escapeHTML(src)}" alt="" loading="lazy" onerror="this.remove()"></div>`;
  }
  return fallback;
}

// ---- Payments ----
let payConfig = { mode: 'unconfigured', sheetsConfigured: false, upiId: 'sochai@ptyes' };

async function initPayments() {
  const badge = $('#payModeBadge');
  try {
    const res = await fetch(API_BASE + '/api/config');
    payConfig = await res.json();
  } catch { payConfig = { mode: 'unconfigured', sheetsConfigured: false }; }
  if (payConfig.cashfreeEnabled && payConfig.sheetsConfigured) {
    badge.textContent = 'SECURE PAYMENTS';
    badge.style.background = '#1a7f4b';
  } else {
    badge.textContent = 'PAYMENTS OFFLINE';
    badge.style.background = '#8a8a8a';
    const note = $('#paymentNoteText');
    if (note) note.textContent = 'Payments are being configured. Bidding opens shortly.';
  }
}

function paymentsReady() { return !!payConfig.cashfreeEnabled && payConfig.sheetsConfigured; }
function clampBid(v) { return Math.min(999, Math.max(1, Math.floor(Number(v)) || 1)); }

// ---- Checkout (Cashfree) ----
let checkoutBody = null;
let checkoutAfter = null;
let paying = false;

function openCheckout({ title, summary, amount, body, afterSubmit }) {
  checkoutBody = body;
  checkoutAfter = afterSubmit || null;
  paying = false;
  if (!payConfig.cashfreeEnabled) {
    showToast('Online payments are not enabled yet. Please try again later.');
    return;
  }
  if (title) $('#checkoutTitle').textContent = title;
  const labels = ['reviewLabel1', 'reviewLabel2', 'reviewLabel3', 'reviewLabel4'];
  const values = ['reviewValue1', 'reviewValue2', 'reviewValue3', 'reviewValue4'];
  summary.slice(0, 4).forEach(([label, value], i) => {
    $('#' + labels[i]).textContent = label;
    $('#' + values[i]).textContent = value;
  });
  const btn = $('#cashfreePayBtn');
  btn.disabled = false;
  btn.innerHTML = 'Pay ' + escapeHTML(money(amount)) + ' securely';
  const phoneInput = $('#cfPhoneInput');
  if (phoneInput) phoneInput.value = '';
  $('#checkoutDialog').showModal();
}

function wireCheckout() {
  const dlg = $('#checkoutDialog');
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  const cfCancel = $('#cancelCheckoutCf');
  if (cfCancel) cfCancel.addEventListener('click', () => dlg.close());
  const cfBtn = $('#cashfreePayBtn');
  if (cfBtn) cfBtn.addEventListener('click', payWithCashfree);
}

// ---- Cashfree Checkout ----
let cfScriptPromise = null;
function loadCashfreeScript() {
  if (window.Cashfree) return Promise.resolve();
  if (!cfScriptPromise) {
    cfScriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      const fail = (msg) => {
        clearTimeout(timer);
        s.remove();
        cfScriptPromise = null; // allow a retry to load it again
        reject(new Error(msg));
      };
      const timer = setTimeout(() => fail('The payment window took too long to load. Check your connection and try again.'), 20000);
      s.src = 'https://sdk.cashfree.com/js/v3/cashfree.js';
      s.onload = () => { clearTimeout(timer); resolve(); };
      s.onerror = () => fail('Could not load the payment window. Check your connection and try again.');
      document.head.appendChild(s);
    });
  }
  return cfScriptPromise;
}

async function payWithCashfree() {
  if (!checkoutBody || paying) return;
  const phoneInput = $('#cfPhoneInput');
  const phone = (phoneInput.value || '').replace(/\D/g, '');
  if (!/^[6-9]\d{9}$/.test(phone)) {
    showToast('Enter your 10-digit mobile number for the payment.');
    phoneInput.focus();
    return;
  }
  paying = true;
  const btn = $('#cashfreePayBtn');
  const origLabel = btn.innerHTML;
  btn.disabled = true; btn.textContent = 'Starting payment…';
  try {
    await loadCashfreeScript();
    const res = await fetch(API_BASE + '/api/create-order', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...checkoutBody, phone }),
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not start the payment.');
    // Hand off to the Cashfree modal: our review dialog renders above the
    // checkout overlay, so close it first and reset the pay button. The
    // checkout promise below still settles and shows its toasts.
    const dlg = $('#checkoutDialog');
    if (dlg && dlg.open) dlg.close();
    btn.disabled = false; btn.innerHTML = origLabel; paying = false;
    const cashfree = Cashfree({ mode: payConfig.cashfreeMode === 'sandbox' ? 'sandbox' : 'production' });
    const result = await cashfree.checkout({ paymentSessionId: data.paymentSessionId, redirectTarget: '_modal' });
    if (result.error) {
      showToast(result.error.message || 'Payment failed — no money was taken. You can try again.');
      return;
    }
    if (result.paymentDetails) {
      await handleCashfreeSuccess(data.orderId, btn, origLabel);
    } else {
      showToast('Payment not completed — your bid was not placed and no money was taken.');
    }
  } catch (err) {
    showToast(err.message || 'Could not start the payment.');
    btn.disabled = false; btn.innerHTML = origLabel; paying = false;
  }
}

async function handleCashfreeSuccess(orderId, btn, origLabel) {
  btn.disabled = true; btn.textContent = 'Verifying payment…';
  try {
    const res = await fetch(API_BASE + '/api/verify-payment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Payment verification failed.');
    showToast(data.rank
      ? `Payment verified — your rank #${data.rank} is live!`
      : 'Payment verified — your rank is live!');
    if (checkoutAfter) checkoutAfter(data);
  } catch (err) {
    // The money may still have been captured (e.g. our verify call failed
    // on the network) — the Cashfree webhook backstop applies the claim, so
    // poll the claim status by order id and flip to success when it lands.
    showToast('Payment received — confirming your rank…');
    openVerifyDialog(orderId);
  } finally {
    btn.disabled = false; btn.innerHTML = origLabel; paying = false;
  }
}

// ---- Live claim-status polling ----
// After a Cashfree payment completes, the verify dialog polls
// /api/claim-status until the webhook (or the verify call) applies the
// claim, then flips to the success state on its own.
let verifyTimer = null;
let verifyPolls = 0;
const VERIFY_MAX_POLLS = 75; // ~5 minutes at 4s intervals

function stopVerifyPolling() {
  if (verifyTimer) { clearInterval(verifyTimer); verifyTimer = null; }
}

function openVerifyDialog(orderId) {
  const dlg = $('#verifyDialog');
  if (!dlg) return false;
  stopVerifyPolling();
  verifyPolls = 0;
  $('#verifyTitle').textContent = 'Confirming your payment…';
  $('#verifyText').textContent = 'Your payment reached us — we’re publishing your rank now. Keep this open.';
  $('#verifySpinner').hidden = false;
  $('#verifyViewBoard').hidden = true;
  dlg.showModal();
  const tick = async () => {
    verifyPolls++;
    try {
      const res = await fetch(API_BASE + '/api/claim-status?utr=' + encodeURIComponent(orderId), { cache: 'no-store' });
      const data = await res.json();
      if (data.found && data.status === 'applied') {
        stopVerifyPolling();
        $('#verifyTitle').textContent = 'Payment verified!';
        $('#verifyText').textContent = data.rank
          ? `Your rank #${data.rank} is live on the leaderboard.`
          : 'Your rank is live on the leaderboard.';
        $('#verifySpinner').hidden = true;
        $('#verifyViewBoard').hidden = false;
        showToast(data.rank
          ? `Payment auto-verified — your rank #${data.rank} is live!`
          : 'Payment auto-verified — your rank is live!');
        return;
      }
    } catch { /* transient error: keep polling */ }
    if (verifyPolls >= VERIFY_MAX_POLLS) {
      stopVerifyPolling();
      $('#verifyTitle').textContent = 'Still verifying…';
      $('#verifyText').textContent = 'Your payment is taking longer than usual to confirm. No need to repay — your rank will go live automatically once it arrives.';
      $('#verifySpinner').hidden = true;
    }
  };
  verifyTimer = setInterval(tick, 4000);
  tick();
  return true;
}

function wireVerifyDialog() {
  const dlg = $('#verifyDialog');
  if (!dlg) return;
  $('#verifyClose').addEventListener('click', () => { stopVerifyPolling(); dlg.close(); });
  $('#verifyViewBoard').addEventListener('click', () => { stopVerifyPolling(); dlg.close(); location.reload(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) { stopVerifyPolling(); dlg.close(); } });
  dlg.addEventListener('close', stopVerifyPolling);
}

// ---- Terms / Privacy dialogs ----
function wireInfoDialogs() {
  const info = {
    terms: ['Rankly terms', 'Bids buy public rank placement on this leaderboard. They are not purchases of goods or services and carry no guarantee beyond the public rank. Rank bids are non-refundable once published. Full policy opens above.'],
    privacy: ['Privacy overview', 'Rankly stores your submitted profile details, links, bid amount, and UPI transaction ID to verify your payment. You pay directly via UPI — we never see your bank or card details. Full policy opens above.']
  };
  document.querySelectorAll('[data-info]').forEach((btn) => btn.addEventListener('click', () => {
    const [title, body] = info[btn.dataset.info];
    $('#infoTitle').textContent = title; $('#infoBody').textContent = body;
    const docId = RANKLY_DB.docs[btn.dataset.info];
    if (docId) {
      $('#infoDocFrame').src = `https://docs.google.com/document/d/${docId}/preview`;
      $('#infoDocLink').href = `https://docs.google.com/document/d/${docId}/edit`;
      $('#infoDocWrap').hidden = false;
    } else {
      $('#infoDocWrap').hidden = true;
    }
    $('#infoDialog').showModal();
  }));
  $('#closeInfo').addEventListener('click', () => $('#infoDialog').close());
  $('#infoDialog').addEventListener('click', (e) => { if (e.target === $('#infoDialog')) $('#infoDialog').close(); });
}

// ---- Icons ----
const eyeIcon = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="2.5" stroke="currentColor" stroke-width="1.8"/></svg>';
const arrowIcon = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const linkedinIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z"/></svg>';
const githubIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.7 5.38-5.26 5.66.41.35.77 1.05.77 2.12 0 1.53-.01 2.76-.01 3.14 0 .3.2.67.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z"/></svg>';
const codeIcon = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m8 8-5 4 5 4M16 8l5 4-5 4M13 4l-2 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function profileLinksHTML(p) {
  const links = [];
  if (p.linkedin) links.push(`<a class="plink" href="${escapeHTML(p.linkedin)}" target="_blank" rel="noopener">${linkedinIcon}LinkedIn</a>`);
  if (p.github) links.push(`<a class="plink" href="${escapeHTML(p.github)}" target="_blank" rel="noopener">${githubIcon}GitHub</a>`);
  if (p.coding) links.push(`<a class="plink" href="${escapeHTML(p.coding)}" target="_blank" rel="noopener">${codeIcon}Coding profile</a>`);
  return links.length ? `<div class="profile-links">${links.join('')}</div>` : '';
}

function rankClass(rank) { return rank === 1 ? 'top' : rank === 2 ? 'second' : rank === 3 ? 'third' : ''; }

function activityHTML(items) {
  return items.slice(0, 6).map((a) =>
    `<span class="act-chip"><span class="act-dot" aria-hidden="true"></span><span><strong>${escapeHTML(a.name)}</strong> ${escapeHTML(a.action)}</span><span class="act-time">${escapeHTML(a.time)}</span></span>`
  ).join('');
}

// Pulse the activity strip when new items arrive (design-refresh feature #6, kept).
let lastActivitySig = '';
function pulseNewActivity(items) {
  const sig = items && items.length
    ? [items[0].name, items[0].action, items[0].time].join('|') : '';
  const isNew = Boolean(lastActivitySig && sig && sig !== lastActivitySig);
  lastActivitySig = sig;
  renderLiveTicker(items);
  if (!isNew) return;
  const list = document.getElementById('activityList');
  if (list) {
    const first = list.querySelector('.act-chip') || list.querySelector('.activity-item');
    if (first) first.classList.add('flash-new');
  }
  const ticker = document.querySelector('.ticker');
  if (ticker) {
    ticker.classList.remove('pulse');
    void ticker.offsetWidth;
    ticker.classList.add('pulse');
  }
  boostAmbient(); // glow blobs + bid rain react to the real bid
}

// ---- Ambient live background (all six effects, decorative only) ----
const prefersReducedMotion = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// rAF with a setTimeout fallback (jsdom / non-visual environments).
const raf = (fn) => (typeof requestAnimationFrame === 'function'
  ? requestAnimationFrame(fn)
  : setTimeout(fn, 16));

// 1+2+4: spotlight follows the cursor; bid-rain canvas particles.
function initAmbient() {
  if (prefersReducedMotion()) return;
  const root = document.documentElement;

  // Mouse spotlight (rAF-throttled).
  let spotQueued = false, mx = innerWidth / 2, my = innerHeight * 0.3;
  addEventListener('mousemove', (e) => {
    mx = e.clientX; my = e.clientY;
    if (spotQueued) return;
    spotQueued = true;
    raf(() => {
      root.style.setProperty('--mx', mx + 'px');
      root.style.setProperty('--my', my + 'px');
      spotQueued = false;
    });
  }, { passive: true });

  // Bid rain: faint ₹ glyphs + dots drifting upward.
  const canvas = document.getElementById('bidRain');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return; // no 2d canvas (e.g. jsdom) — skip rain, keep spotlight
  let W = 0, H = 0, parts = [], running = true, energy = 1;
  const dpr = Math.min(2, devicePixelRatio || 1);
  function size() {
    W = innerWidth; H = innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function spawn(top) {
    const glyph = Math.random() < 0.45;
    return {
      x: Math.random() * W,
      y: top ? Math.random() * H : H + 20,
      vy: -(0.18 + Math.random() * 0.5),
      vx: (Math.random() - 0.5) * 0.22,
      r: glyph ? 11 + Math.random() * 9 : 1 + Math.random() * 2.2,
      glyph,
      a: 0.05 + Math.random() * 0.08,
      coral: Math.random() < 0.4,
      wob: Math.random() * Math.PI * 2,
    };
  }
  function reset() {
    const n = Math.min(42, Math.max(18, Math.floor(W / 34)));
    parts = Array.from({ length: n }, () => spawn(true));
  }
  size(); reset();
  addEventListener('resize', () => { size(); reset(); });
  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) loop();
  });
  // Called on real bid events: rain briefly gets denser + faster.
  window.__rainBoost = () => {
    energy = 2.4;
    for (let i = 0; i < 10; i++) parts.push(spawn(false));
    if (parts.length > 70) parts.splice(0, parts.length - 70);
  };
  function loop() {
    if (!running) return;
    energy += (1 - energy) * 0.03;
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.wob += 0.012;
      p.y += p.vy * energy;
      p.x += p.vx + Math.sin(p.wob) * 0.18;
      if (p.y < -30) Object.assign(p, spawn(false));
      if (p.x < -30) p.x = W + 20; else if (p.x > W + 30) p.x = -20;
      ctx.globalAlpha = Math.min(0.16, p.a * energy);
      ctx.fillStyle = p.coral ? '#FF6A4D' : '#6B7280';
      if (p.glyph) {
        ctx.font = `700 ${p.r}px Inter, system-ui, sans-serif`;
        ctx.fillText('₹', p.x, p.y);
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    raf(loop);
  }
  loop();
}

// 6: blobs glow + a ring radiates from the hero when a real bid lands.
function boostAmbient() {
  if (prefersReducedMotion()) return;
  const blobs = document.getElementById('ambientBlobs');
  if (blobs) {
    blobs.classList.add('boost');
    clearTimeout(blobs.__t);
    blobs.__t = setTimeout(() => blobs.classList.remove('boost'), 3200);
  }
  if (window.__rainBoost) window.__rainBoost();
  const hero = document.querySelector('.hero-claim');
  if (hero) {
    const r = hero.getBoundingClientRect();
    const ring = document.createElement('div');
    ring.className = 'pulse-ring';
    const d = Math.max(r.width, 220);
    ring.style.cssText = `left:${r.left + r.width / 2 - d / 2}px;top:${r.top + window.scrollY - d / 4}px;width:${d}px;height:${d}px;`;
    document.body.appendChild(ring);
    raf(() => ring.classList.add('go'));
    setTimeout(() => ring.remove(), 2000);
  }
}

// 5: live ticker tape fed by the real activity feed.
function renderLiveTicker(items) {
  const track = document.getElementById('liveTickerTrack');
  if (!track) return;
  if (!items || !items.length) {
    track.innerHTML = '<span class="tick"><span class="tick-dot"></span><span>Live board — new bids stream here in real time</span></span>';
    return;
  }
  const ticks = items.slice(0, 8).map((a) =>
    `<span class="tick"><span class="tick-dot"></span><strong>${escapeHTML(a.name)}</strong><span class="tick-bid">${escapeHTML(a.action)}</span><span>${escapeHTML(a.time)}</span></span>`
  ).join('');
  track.innerHTML = ticks + ticks; // duplicate for a seamless loop
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAmbient);
} else {
  initAmbient();
}

// ---- Weekly reset countdown (resets Sunday 00:05 IST) ----
function msUntilSundayReset(now) {
  const n = now || new Date();
  const istMs = n.getTime() + (n.getTimezoneOffset() + 330) * 60000;
  const ist = new Date(istMs);
  const target = new Date(ist);
  target.setHours(0, 5, 0, 0);
  let add = (7 - target.getDay()) % 7;
  if (add === 0 && ist.getTime() >= target.getTime()) add = 7;
  target.setDate(target.getDate() + add);
  return Math.max(0, target.getTime() - ist.getTime());
}

function formatCountdown(ms) {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

function startResetCountdown(el) {
  if (!el) return null;
  const tick = () => { el.textContent = 'Rankings reset in ' + formatCountdown(msUntilSundayReset()); };
  tick();
  return setInterval(tick, 30000);
}

// ---- Shareable rank card (canvas PNG -> Web Share, fallback download) ----
async function shareRankCard({ rank, name, sub, bid, boardLabel }) {
  const W = 1080, H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d');
  c.fillStyle = '#FDF9F0'; c.fillRect(0, 0, W, H);
  // coral corner accents
  c.fillStyle = '#FF6A4D';
  c.fillRect(0, 0, W, 14);
  c.save(); c.translate(W - 120, 120); c.rotate(-0.06);
  c.font = '900 300px Arial'; c.globalAlpha = 0.08;
  c.fillStyle = '#FF6A4D';
  c.fillText('#' + rank, -260, 90); c.restore(); c.globalAlpha = 1;
  // brand
  c.fillStyle = '#2E2A26'; c.font = '800 44px Arial'; c.textAlign = 'center';
  c.fillText('R A N K L Y', W / 2, 130);
  c.fillStyle = '#FF6A4D'; c.font = '900 120px Arial';
  c.fillText('RANK #' + rank, W / 2, 320);
  c.fillStyle = '#2E2A26'; c.font = '800 72px Arial';
  wrapText(c, String(name || '').slice(0, 40), W / 2, 460, W - 160, 80);
  c.fillStyle = '#7A756E'; c.font = '400 44px Arial';
  wrapText(c, String(sub || '').slice(0, 80), W / 2, 600, W - 200, 54);
  c.fillStyle = '#2E2A26'; c.font = '900 96px Arial';
  c.fillText(money(bid), W / 2, 830);
  c.fillStyle = '#7A756E'; c.font = '400 40px Arial';
  c.fillText('rank bid', W / 2, 885);
  c.fillStyle = '#FF6A4D'; c.font = '800 44px Arial';
  c.fillText(String(boardLabel || 'This week') + '  ·  vercel-app-ashen-eight.vercel.app', W / 2, 1180);
  c.fillStyle = '#7A756E'; c.font = '400 36px Arial';
  c.fillText('Outbid for the top spot.', W / 2, 1240);

  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('Could not render the rank card.');
  const file = new File([blob], 'rankly-rank.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: 'My Rankly rank', text: `I'm ranked #${rank} on Rankly!` });
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'rankly-rank.png';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Rank card downloaded — share it anywhere!');
  }
}

function wrapText(c, text, x, y, maxWidth, lineHeight) {
  const words = String(text).split(' ');
  const lines = []; let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (c.measureText(t).width > maxWidth && line) { lines.push(line); line = w; }
    else line = t;
  }
  if (line) lines.push(line);
  lines.slice(0, 3).forEach((l, i) => c.fillText(l, x, y + i * lineHeight));
}

// ---- Snipe Hour (pure helpers) ----
// resetAtISO: ISO string of the upcoming Sunday 00:05 IST reset (from
// /api/leaderboard). Returns the current snipe phase for display.
function snipeView(resetAtISO, nowMs) {
  const resetAt = new Date(resetAtISO).getTime();
  const now = nowMs == null ? Date.now() : nowMs;
  if (!Number.isFinite(resetAt)) return { phase: 'idle', msLeft: 0 };
  const msLeft = resetAt - now;
  if (msLeft > 3600000 || msLeft < -20 * 60000) return { phase: 'idle', msLeft };
  if (msLeft >= 0) return { phase: 'live', msLeft };
  return { phase: 'overtime', msLeft };
}

function formatSnipeLeft(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

function snipeBannerHTML(v) {
  if (v.phase === 'idle') return '';
  if (v.phase === 'overtime') {
    return `<span class="snipe-live"><span class="live-dot"></span>OVERTIME</span>
      <span class="snipe-text">Last-minute bids are holding the reset open — bid now to snipe the crown!</span>`;
  }
  return `<span class="snipe-live"><span class="live-dot"></span>SNIPE HOUR · LIVE</span>
    <span class="snipe-text">Rankings lock in <strong>${formatSnipeLeft(v.msLeft)}</strong> — every bid in the final minutes extends the window.</span>`;
}

// ---- College Clash (pure) ----
function collegeStandings(profiles) {
  const map = new Map();
  for (const p of profiles || []) {
    const c = String(p.college || '').trim() || 'Independent';
    if (!map.has(c)) map.set(c, { college: c, total: 0, count: 0 });
    const s = map.get(c);
    s.total += Number(p.bid) || 0;
    s.count += 1;
  }
  return [...map.values()].sort((a, b) => b.total - a.total || b.count - a.count);
}

// ---- Duels (pure) ----
function duelBars(cBid, oBid) {
  const max = Math.max(Number(cBid) || 0, Number(oBid) || 0, 1);
  return {
    cPct: Math.max(4, Math.round(((Number(cBid) || 0) / max) * 100)),
    oPct: Math.max(4, Math.round(((Number(oBid) || 0) / max) * 100)),
  };
}

// Duel Champion badges: winners of finished duels get a badge on their rank
// row. Call after rendering the leaderboard and after duels load; re-renders
// of the board wipe badges, so both call sites are needed.
function applyDuelChampionBadges(duels) {
  const winners = new Set();
  for (const d of duels || []) {
    if (d.status === 'active' || !d.winner || d.winner === 'draw') continue;
    const wk = d.winner === d.challenger ? d.challengerKey
      : d.winner === d.opponent ? d.opponentKey : null;
    if (wk) winners.add(wk);
  }
  document.querySelectorAll('.rank-row[data-key]').forEach(row => {
    const has = winners.has(row.dataset.key);
    let badge = row.querySelector('.duel-champ-badge');
    if (has && !badge) {
      badge = document.createElement('span');
      badge.className = 'duel-champ-badge';
      badge.textContent = '⚔ Duel Champion';
      const line = row.querySelector('.listing-title-line');
      if (line) line.appendChild(badge); else row.prepend(badge);
    } else if (!has && badge) {
      badge.remove();
    }
  });
}
// Client-side fallback identity key. Deliberately never email-based: raw
// emails must not appear in the DOM or in outgoing requests. The server
// canonicalizes any key it receives, so these fallbacks degrade safely.
function profileKeyOf(p) {
  const li = String(p.linkedin || '').trim().toLowerCase();
  if (li) return 'li:' + li;
  return 'name:' + String(p.name || '').trim().toLowerCase();
}

// Client-side showcase identity key (mirrors the server).
function workKeyOf(w) {
  return 'work:' + String(w.title || '').trim().toLowerCase();
}

// ---- Verified proof chips ----
function verifiedChipsHTML(v) {
  if (!v) return '';
  const chips = [];
  if (v.gh_user && (v.gh_stars || v.gh_repos)) {
    chips.push(`<span class="verify-chip" title="GitHub: ${escapeHTML(v.gh_user)} — verified public stats">★ ${Number(v.gh_stars).toLocaleString('en-IN')} stars · ${Number(v.gh_repos).toLocaleString('en-IN')} repos</span>`);
  } else if (v.gh_user) {
    chips.push(`<span class="verify-chip pending" title="GitHub: ${escapeHTML(v.gh_user)} — stats incoming">◔ GitHub · verifying…</span>`);
  }
  if (v.lc_user && (v.lc_solved || v.lc_rating)) {
    const parts = [];
    if (v.lc_solved) parts.push(`${Number(v.lc_solved).toLocaleString('en-IN')} solved`);
    if (v.lc_rating) parts.push(`${Number(v.lc_rating).toLocaleString('en-IN')} contest`);
    chips.push(`<span class="verify-chip" title="LeetCode: ${escapeHTML(v.lc_user)} — verified public stats">◈ ${parts.join(' · ')}</span>`);
  } else if (v.lc_user) {
    chips.push(`<span class="verify-chip pending" title="LeetCode: ${escapeHTML(v.lc_user)} — stats incoming">◔ LeetCode · verifying…</span>`);
  }
  return chips.join('');
}
