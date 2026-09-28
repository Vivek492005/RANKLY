'use strict';
/* Rankly shared frontend: config, sheet fetching, payments, checkout, dialogs. */

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
  const res = await fetch('/api/weeks', { cache: 'no-store' });
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
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 3200);
}

// ---- Payments ----
let payConfig = { mode: 'unconfigured', sheetsConfigured: false, upiId: 'sochai@ptyes' };

async function initPayments() {
  const badge = $('#payModeBadge');
  try {
    const res = await fetch('/api/config');
    payConfig = await res.json();
  } catch { payConfig = { mode: 'unconfigured', sheetsConfigured: false, upiId: 'sochai@ptyes' }; }
  if (payConfig.upiId) {
    const t = $('#upiIdText'); if (t) t.textContent = payConfig.upiId;
    const d = $('#upiIdDetail'); if (d) d.textContent = payConfig.upiId;
  }
  if (payConfig.mode === 'upi-manual' && payConfig.sheetsConfigured) {
    badge.textContent = 'UPI PAYMENTS';
    badge.style.background = '#1a7f4b';
  } else {
    badge.textContent = 'PAYMENTS OFFLINE';
    badge.style.background = '#8a8a8a';
    const note = $('#paymentNoteText');
    if (note) note.textContent = 'Payments are being configured. Bidding opens shortly.';
  }
}

function paymentsReady() { return payConfig.mode === 'upi-manual' && payConfig.sheetsConfigured; }
function clampBid(v) { return Math.min(999, Math.max(1, Math.floor(Number(v)) || 1)); }

// ---- Checkout (UPI + UTR) ----
let checkoutBody = null;
let checkoutAfter = null;
let paying = false;

function openCheckout({ title, summary, amount, body, afterSubmit }) {
  checkoutBody = body;
  checkoutAfter = afterSubmit || null;
  if (title) $('#checkoutTitle').textContent = title;
  const labels = ['reviewLabel1', 'reviewLabel2', 'reviewLabel3', 'reviewLabel4'];
  const values = ['reviewValue1', 'reviewValue2', 'reviewValue3', 'reviewValue4'];
  summary.slice(0, 4).forEach(([label, value], i) => {
    $('#' + labels[i]).textContent = label;
    $('#' + values[i]).textContent = value;
  });
  $('#upiAmount').textContent = money(amount);
  $('#utrInput').value = '';
  $('#checkoutDialog').showModal();
}

function wireCheckout() {
  $('#cancelCheckout').addEventListener('click', () => $('#checkoutDialog').close());
  $('#checkoutDialog').addEventListener('click', (e) => { if (e.target === $('#checkoutDialog')) $('#checkoutDialog').close(); });
  const copyBtn = $('#copyUpiId');
  if (copyBtn) copyBtn.addEventListener('click', async () => {
    const id = $('#upiIdText').textContent.trim();
    try { await navigator.clipboard.writeText(id); showToast('UPI ID copied.'); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = id; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); showToast('UPI ID copied.'); }
      catch { showToast('Copy this UPI ID: ' + id); }
      ta.remove();
    }
  });
  $('#confirmCheckout').addEventListener('click', async () => {
    if (!checkoutBody || paying) return;
    const utr = $('#utrInput').value.trim().replace(/\s+/g, '');
    if (!/^[A-Za-z0-9]{6,32}$/.test(utr)) {
      showToast('Enter the UPI transaction ID from your payment app.');
      $('#utrInput').focus();
      return;
    }
    paying = true;
    const btn = $('#confirmCheckout');
    btn.disabled = true; btn.textContent = 'Submitting…';
    try {
      const res = await fetch('/api/submit-claim', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...checkoutBody, utr }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not submit your claim.');
      $('#checkoutDialog').close();
      if (data.autoApplied) {
        showToast(data.rank
          ? `Payment auto-verified — your rank #${data.rank} is live!`
          : 'Payment auto-verified — your rank is live!');
      } else if (!openVerifyDialog(utr)) {
        showToast('Claim submitted. Your payment is detected automatically and your rank goes live on its own.');
      }
      if (checkoutAfter) checkoutAfter(data);
    } catch (err) {
      showToast(err.message || 'Could not submit your claim.');
    } finally {
      btn.disabled = false; btn.textContent = 'I’ve paid — submit claim'; paying = false;
    }
  });
}

// ---- Live claim-status polling ----
// After a claim is submitted without instant verification, the verify dialog
// polls /api/claim-status until the bank-SMS webhook auto-verifies the
// payment, then flips to the success state on its own.
let verifyTimer = null;
let verifyPolls = 0;
const VERIFY_MAX_POLLS = 75; // ~5 minutes at 4s intervals

function stopVerifyPolling() {
  if (verifyTimer) { clearInterval(verifyTimer); verifyTimer = null; }
}

function openVerifyDialog(utr) {
  const dlg = $('#verifyDialog');
  if (!dlg) return false;
  stopVerifyPolling();
  verifyPolls = 0;
  $('#verifyTitle').textContent = 'Waiting for your payment…';
  $('#verifyText').textContent = 'Your claim is recorded. We’re watching for your bank’s payment confirmation — this usually takes under a minute. Keep this open.';
  $('#verifySpinner').hidden = false;
  $('#verifyViewBoard').hidden = true;
  dlg.showModal();
  const tick = async () => {
    verifyPolls++;
    try {
      const res = await fetch('/api/claim-status?utr=' + encodeURIComponent(utr), { cache: 'no-store' });
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
      $('#verifyText').textContent = 'Your payment hasn’t been detected yet. No need to resubmit — your rank will go live automatically once it arrives.';
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
  return items.slice(0, 5).map((a) => `<li class="activity-item"><span class="dot" aria-hidden="true"></span><span><strong>${escapeHTML(a.name)}</strong> ${escapeHTML(a.action)}</span><time>${escapeHTML(a.time)}</time></li>`).join('');
}
