'use strict';
// Google Sheets data layer for Rankly (manual-UPI flow).
// Auth: service-account JSON in env var GOOGLE_SERVICE_ACCOUNT_JSON.
// The "Rankly Database" spreadsheet must be shared (Editor) with the
// service account's client_email.
//
const crypto = require('crypto');
const { isPublicPhotoUrl } = require('./photos');
// Real sheet layouts (must match):
//   Leaderboard (All time) / Today (student profiles):
//     Rank | Name | Headline | College | Skills | LinkedIn | GitHub |
//     Coding profile | Email | Bid (INR) | Clicks | Age | Photo
//   Showcase (ranked work):
//     Rank | Work title | Creator | Platform | Link | Description |
//     Bid (INR) | Clicks | Age
//   Claims: Timestamp | Board | Name | Headline | College | Skills | Email |
//           Link1 | Link2 | Link3 | Platform | Description | Bid (INR) |
//           Payment method | Rank achieved | Status | Payment ID | Photo
//     Photo columns hold the public Vercel Blob URL of the profile photo
//     (empty when no photo).
//     Board is "profiles" or "showcase". For profiles: Link1=LinkedIn,
//     Link2=GitHub, Link3=Coding profile, Description=portfolio URL
//     (optional). For showcase: Name=work title, Headline=creator,
//     Link1=work link.
//   Activity log: Time | Name | Action
//   Site stats: Metric | Value | Note
//   Payment inbox: Timestamp | Amount (INR) | UTR | Raw SMS | Status
//   Archive (companies): the pre-pivot company leaderboard, kept for history.
//
// Claims written here NEVER touch a board directly. They sit at
// "Awaiting payment" until the payment is confirmed — automatically by the
// Cashfree webhook (api/cashfree-webhook.js) or the /api/verify-payment
// browser callback, which flip them through "verified" straight to
// "applied". The claims cron remains as a backstop for anything stuck at
// "verified".
const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1FSWiEoLh8AgADL8jiFye4wOL5lt1KwjYjwSeeTBuy0o';
const TAB_PROFILES = 'Leaderboard (All time)';
const TAB_TODAY = 'Today';
const TAB_SHOWCASE = 'Showcase';
const TAB_CLAIMS = 'Claims';
const TAB_ACTIVITY = 'Activity log';
const TAB_STATS = 'Site stats';
const TAB_INBOX = 'Payment inbox';
const TAB_WEEKS = 'Weekly Archive';

const PROFILE_HEADERS = ['Rank', 'Name', 'Headline', 'College', 'Skills', 'LinkedIn', 'GitHub', 'Coding profile', 'Email', 'Bid (INR)', 'Clicks', 'Age', 'Photo'];
const SHOWCASE_HEADERS = ['Rank', 'Work title', 'Creator', 'Platform', 'Link', 'Description', 'Bid (INR)', 'Clicks', 'Age'];
const CLAIM_HEADERS = ['Timestamp', 'Board', 'Name', 'Headline', 'College', 'Skills', 'Email', 'Link1', 'Link2', 'Link3', 'Platform', 'Description', 'Bid (INR)', 'Payment method', 'Rank achieved', 'Status', 'Payment ID', 'Photo'];
const ACTIVITY_HEADERS = ['Time', 'Name', 'Action'];
const STATS_HEADERS = ['Metric', 'Value', 'Note'];
const INBOX_HEADERS = ['Timestamp', 'Amount (INR)', 'UTR', 'Raw SMS', 'Status'];
// Weekly Archive: one row per ranked entry at each Sunday reset. Week numbers
// only advance when a reset actually archives something (skipped on empty
// boards). Board is "profiles" or "showcase". For profiles: Name/Headline/
// College/Skills populated, Link=LinkedIn, Platform=''. For showcase:
// Name=work title, Headline=creator, Link=work link, Platform=platform.
const WEEKS_HEADERS = ['Week', 'Start date', 'End date', 'Board', 'Rank', 'Name', 'Headline', 'College', 'Skills', 'Link', 'Platform', 'Bid (INR)'];

const BOARD_PROFILES = 'profiles';
const BOARD_SHOWCASE = 'showcase';

let sheetsClient = null;
function client() {
  if (sheetsClient) return sheetsClient;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set');
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(raw),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

function stamp(d = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function getValues(tab, range) {
  const res = await client().spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${tab}!${range}` });
  return res.data.values || [];
}

async function appendValues(tab, range, values) {
  await client().spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab}!${range}`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });
}

async function updateValues(tab, range, values) {
  await client().spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab}!${range}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });
}

function num(v) {
  const n = parseInt(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}
function pad(r, n) {
  const out = r.slice();
  while (out.length < n) out.push('');
  return out;
}
function cleanStr(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

// Records a bid claim. paymentMethod defaults to 'Cashfree' and status to
// 'Awaiting payment' (the Cashfree order id is stored as the transaction
// reference).
// Returns { duplicate: true } when the transaction reference was already
// submitted.
// photoUrl (optional) is the public Blob URL of the user's profile photo,
// recorded in the Claims Photo column (R) for later application.
async function recordPendingClaim({ board, name, headline, college, skills, email, link1, link2, link3, platform, description, bid, utr, photoUrl, paymentMethod, status }) {
  const cleanBoard = board === BOARD_SHOWCASE ? BOARD_SHOWCASE : BOARD_PROFILES;
  const cleanUtr = cleanStr(utr, 32).toUpperCase();

  // Idempotency: one UTR = one claim, across both boards.
  const existing = await getValues(TAB_CLAIMS, 'A1:R500');
  for (const r of existing.slice(1)) {
    if (cleanUtr && String(r[16] || '').trim().toUpperCase() === cleanUtr) {
      return { duplicate: true };
    }
  }

  await appendValues(TAB_CLAIMS, 'A1:R1', [[
    stamp(new Date()),
    cleanBoard,
    cleanStr(name, 80),
    cleanStr(headline, 80),
    cleanStr(college, 80),
    cleanStr(skills, 200),
    cleanStr(email, 120),
    cleanStr(link1, 300),
    cleanStr(link2, 300),
    cleanStr(link3, 300),
    cleanStr(platform, 20),
    cleanStr(description, 300),
    Math.floor(Number(bid)) || 0,
    cleanStr(paymentMethod || 'UPI (manual)', 20),
    '',
    cleanStr(status || 'Awaiting verification', 40),
    cleanUtr,
    String(photoUrl || '').trim(),
  ]]);
  return { ok: true };
}

// ---------- Board writes ----------

// Hash an email into an opaque public id. Raw emails must never appear in
// public API payloads or sheet tabs readable by clients.
function hashEmail(email) {
  return crypto.createHash('sha256')
    .update(String(email || '').trim().toLowerCase())
    .digest('hex')
    .slice(0, 16);
}

// Canonicalize a profile identity key: legacy "email:…" keys (which may arrive
// from older clients) are folded into the hashed "id:…" form. "li:…" and
// "name:…" keys are already public-safe and pass through unchanged.
function canonicalKey(k) {
  const s = String(k || '');
  if (s.startsWith('email:')) return 'id:' + hashEmail(s.slice(6));
  return s;
}

// Identity key for a profile row: hashed email > LinkedIn URL > lowercased name.
function profileIdentityKey(row) {
  const email = String(row[8] || '').trim().toLowerCase();
  if (email) return 'id:' + hashEmail(email);
  const li = String(row[5] || '').trim().toLowerCase();
  if (li) return 'li:' + li;
  return 'name:' + String(row[1] || '').trim().toLowerCase();
}

function profileKeyOf({ email, linkedin, name }) {
  const e = cleanStr(email, 120).toLowerCase();
  if (e) return 'id:' + hashEmail(e);
  const li = cleanStr(linkedin, 300).toLowerCase();
  if (li) return 'li:' + li;
  return 'name:' + cleanStr(name, 80).toLowerCase();
}

// Identity key for a showcase row: lowercased work title.
function workIdentityKey(title) {
  return 'work:' + cleanStr(title, 120).toLowerCase();
}

// Minimum increment (INR) a bid must clear to take the #1 spot or to improve
// the bidder's own existing bid. Kills ₹1-sniping wars at the top.
const MIN_INCREMENT = 10;

// Minimum-increment rule (pure, unit-tested):
// - a re-bid must beat the bidder's own current bid by at least MIN_INCREMENT
//   (equal or lower re-bids are rejected);
// - a first-time bid that would take #1 must clear the top bid by MIN_INCREMENT.
// Returns an error message string, or null when the bid is acceptable.
function incrementError(ctx, bid) {
  if (ctx.existingBid != null) {
    if (bid < ctx.existingBid + MIN_INCREMENT) {
      return `You already hold a ₹${ctx.existingBid.toLocaleString('en-IN')} bid — re-bid at least ₹${(ctx.existingBid + MIN_INCREMENT).toLocaleString('en-IN')} to improve it.`;
    }
    return null;
  }
  if (ctx.topBid > 0 && bid > ctx.topBid && bid < ctx.topBid + MIN_INCREMENT) {
    return `To take the #1 spot, bid at least ₹${(ctx.topBid + MIN_INCREMENT).toLocaleString('en-IN')} — the current top bid is ₹${ctx.topBid.toLocaleString('en-IN')}.`;
  }
  return null;
}

// Bid context for the increment rule: the current top bid on the board, and
// the current bid of the entry matching this identity (null when absent).
async function getBidContext(board, { email, linkedin, name, title }) {
  const isShow = board === 'showcase';
  const tab = isShow ? TAB_SHOWCASE : TAB_PROFILES;
  const bidIdx = isShow ? 6 : 9;
  const wantKey = isShow ? workIdentityKey(title) : profileKeyOf({ email, linkedin, name });
  const vals = await getValues(tab, isShow ? 'A1:I200' : 'A1:M200');
  const rows = (vals.length > 1 ? vals.slice(1) : []).map((r) => pad(r, isShow ? 9 : 13));
  let topBid = 0;
  let existingBid = null;
  for (const r of rows) {
    const b = num(r[bidIdx]);
    if (b > topBid) topBid = b;
    const rowKey = isShow ? workIdentityKey(r[1]) : profileIdentityKey(r);
    if (rowKey === wantKey && b > 0) existingBid = b;
  }
  return { topBid, existingBid };
}

// Insert/update a student profile on the profiles board, re-sort by bid,
// refresh stats and prepend an activity entry. Returns the achieved rank.
// photoUrl (optional) is a public photo URL; when supplied it becomes the
// profile's photo, otherwise an existing photo is preserved.
async function applyProfileClaim({ name, headline, college, skills, linkedin, github, coding, email, bid, photoUrl }) {
  const cleanBid = Math.floor(Number(bid)) || 0;
  const key = profileKeyOf({ email, linkedin, name });
  const cleanPhoto = String(photoUrl || '').trim();

  const vals = await getValues(TAB_PROFILES, 'A1:M200');
  const rows = (vals.length > 1 ? vals.slice(1) : [])
    .map((r) => pad(r, 13)).filter((r) => r[1].trim());
  let target = rows.find((r) => profileIdentityKey(r) === key);
  if (target) {
    target[2] = cleanStr(headline, 80);
    target[3] = cleanStr(college, 80);
    target[4] = cleanStr(skills, 200);
    target[5] = cleanStr(linkedin, 300);
    target[6] = cleanStr(github, 300);
    target[7] = cleanStr(coding, 300);
    target[8] = cleanStr(email, 120);
    target[9] = String(cleanBid);
    target[11] = 'now';
    if (cleanPhoto) target[12] = cleanPhoto;
  } else {
    target = ['', cleanStr(name, 80), cleanStr(headline, 80), cleanStr(college, 80),
      cleanStr(skills, 200), cleanStr(linkedin, 300), cleanStr(github, 300),
      cleanStr(coding, 300), cleanStr(email, 120), String(cleanBid), '0', 'now', cleanPhoto];
    rows.push(target);
  }
  rows.sort((a, b) => num(b[9]) - num(a[9]));
  rows.forEach((r, i) => { r[0] = String(i + 1); });
  await updateValues(TAB_PROFILES, 'A1', [PROFILE_HEADERS, ...rows]);

  const rank = String(rows.findIndex((r) => profileIdentityKey(r) === key) + 1);
  await logActivity(cleanStr(name, 80), `claimed rank #${rank} with a \u20b9${cleanBid.toLocaleString('en-IN')} bid`);
  await refreshBoardStats();
  return rank;
}

// Insert/update a showcased work, re-sort by bid, refresh stats and log
// activity. Identity = the work link URL. Returns the achieved rank.
async function applyShowcaseClaim({ title, creator, platform, link, description, bid }) {
  const cleanBid = Math.floor(Number(bid)) || 0;
  const cleanLink = cleanStr(link, 300).toLowerCase();

  const vals = await getValues(TAB_SHOWCASE, 'A1:I200');
  const rows = (vals.length > 1 ? vals.slice(1) : [])
    .map((r) => pad(r, 9)).filter((r) => r[1].trim());
  let target = rows.find((r) => String(r[4] || '').trim().toLowerCase() === cleanLink);
  if (target) {
    target[1] = cleanStr(title, 80);
    target[2] = cleanStr(creator, 60);
    target[3] = cleanStr(platform, 20);
    target[5] = cleanStr(description, 300);
    target[6] = String(cleanBid);
    target[8] = 'now';
  } else {
    target = ['', cleanStr(title, 80), cleanStr(creator, 60), cleanStr(platform, 20),
      cleanStr(link, 300), cleanStr(description, 300), String(cleanBid), '0', 'now'];
    rows.push(target);
  }
  rows.sort((a, b) => num(b[6]) - num(a[6]));
  rows.forEach((r, i) => { r[0] = String(i + 1); });
  await updateValues(TAB_SHOWCASE, 'A1', [SHOWCASE_HEADERS, ...rows]);

  const rank = String(rows.findIndex((r) => String(r[4] || '').trim().toLowerCase() === cleanLink) + 1);
  await logActivity(cleanStr(title, 80), `showcased at rank #${rank} with a \u20b9${cleanBid.toLocaleString('en-IN')} bid`);
  await refreshBoardStats();
  return rank;
}

// Board-aware dispatcher. info.board is "profiles" or "showcase".
async function applyClaimToLeaderboard(info) {
  if (info && info.board === BOARD_SHOWCASE) {
    return applyShowcaseClaim({
      title: info.name, creator: info.headline, platform: info.platform,
      link: info.link1, description: info.description, bid: info.bid,
    });
  }
  return applyProfileClaim({
    name: info.name, headline: info.headline, college: info.college,
    skills: info.skills, linkedin: info.link1, github: info.link2,
    coding: info.link3, email: info.email, bid: info.bid,
    photoUrl: info.photoUrl || '',
  });
}

async function logActivity(name, action) {
  const d = new Date();
  let h = d.getHours() % 12; if (h === 0) h = 12;
  const actTime = `${h}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'am' : 'pm'}`;
  const actVals = await getValues(TAB_ACTIVITY, 'A1:C50');
  const acts = (actVals.length > 1 ? actVals.slice(1) : []).map((r) => pad(r, 3));
  acts.unshift([actTime, cleanStr(name, 80), action]);
  await updateValues(TAB_ACTIVITY, 'A1', [ACTIVITY_HEADERS, ...acts.slice(0, 20)]);
}

// Recompute Site stats from both boards. Revenue = sum of live bids.
async function refreshBoardStats() {
  const [pVals, sVals] = await Promise.all([
    getValues(TAB_PROFILES, 'A1:M200'),
    getValues(TAB_SHOWCASE, 'A1:I200').catch(() => []),
  ]);
  const pRows = (pVals.length > 1 ? pVals.slice(1) : []).filter((r) => r[1] && String(r[1]).trim());
  const sRows = (sVals.length > 1 ? sVals.slice(1) : []).filter((r) => r[1] && String(r[1]).trim());
  const revenue = pRows.reduce((s, r) => s + num(r[9]), 0) + sRows.reduce((s, r) => s + num(r[6]), 0);

  const statsVals = await getValues(TAB_STATS, 'A1:C20');
  let visitors = 28640;
  for (const r of statsVals.slice(1)) {
    if (r[0] && r[0].trim() === 'Visitors') { visitors = num(r[1]) || visitors; break; }
  }
  await updateValues(TAB_STATS, 'A1', [STATS_HEADERS,
    ['Visitors', String(visitors), 'demo counter'],
    ['Revenue (INR)', String(revenue), 'auto: sum of live bids'],
    ['Profiles listed', String(pRows.length), 'auto: profile count'],
    ['Works showcased', String(sRows.length), 'auto: showcase count'],
  ]);
  return { revenue, profiles: pRows.length, works: sRows.length };
}

// ---------- Auto-verification (bank-SMS webhook) ----------

// Find a claim still awaiting verification by UTR (case-insensitive).
async function findClaimByUtr(utr) {
  const clean = String(utr || '').trim().toUpperCase();
  if (!clean) return null;
  const rows = await getValues(TAB_CLAIMS, 'A1:R500');
  for (let i = 1; i < rows.length; i++) {
    const r = pad(rows[i], 18);
    if (String(r[16]).trim().toUpperCase() === clean) {
      return {
        rownum: i + 1,
        board: String(r[1]).trim() === BOARD_SHOWCASE ? BOARD_SHOWCASE : BOARD_PROFILES,
        name: String(r[2] || ''),
        bid: num(r[12]),
        rank: String(r[14] || ''),
        status: String(r[15] || '').trim().toLowerCase(),
      };
    }
  }
  return null;
}

async function findAwaitingClaim(utr) {
  const clean = String(utr || '').trim().toUpperCase();
  if (!clean) return null;
  const rows = await getValues(TAB_CLAIMS, 'A1:R500');
  for (let i = 1; i < rows.length; i++) {
    const r = pad(rows[i], 18);
    if (String(r[16]).trim().toUpperCase() === clean &&
        String(r[15]).trim().toLowerCase() === 'awaiting verification') {
      return { rownum: i + 1, row: r, board: String(r[1]).trim() === BOARD_SHOWCASE ? BOARD_SHOWCASE : BOARD_PROFILES };
    }
  }
  return null;
}

async function setClaimStatus(rownum, status, rank) {
  await updateValues(TAB_CLAIMS, `O${rownum}:P${rownum}`,
    [[rank == null || rank === '' ? '' : String(rank), status]]);
}

// Record the public Blob URL of an uploaded profile photo on a claim row
// (Photo column R). Best-effort: a failure here must never break the claim.
async function setClaimPhoto(rownum, photoUrl) {
  const url = String(photoUrl || '').trim();
  if (!isPublicPhotoUrl(url)) return;
  await updateValues(TAB_CLAIMS, `R${rownum}:R${rownum}`, [[url]]);
}

// Public-safe photo URL from the stored Photo value. Returns '' unless the
// stored value is one of our Blob URLs (or a legacy Drive file ID, mapped
// to its thumbnail), so raw/unexpected values never leak into API payloads
// and degrade to the initials avatar.
function photoUrlFor(stored) {
  const s = String(stored || '').trim();
  if (isPublicPhotoUrl(s)) return s;
  if (/^[A-Za-z0-9_-]{10,}$/.test(s)) return `https://drive.google.com/thumbnail?id=${s}&sz=w200`;
  return '';
}

// Verify + apply a claim by UTR, routing to the right board. Uses a
// transitional "verifying" status so the claims cron (which only accepts
// pending/verified/approved) skips it mid-flight. On failure the claim is
// left "verified" for the cron backstop. When expectedAmount is given, the
// claim's bid must match it, otherwise the claim is left untouched for
// manual review (returns { amountMismatch: true }).
async function autoVerifyAndApply(utr, expectedAmount = null) {
  const found = await findAwaitingClaim(utr);
  if (!found) return null;
  const { rownum, row, board } = found;
  const info = {
    board,
    name: row[2], headline: row[3], college: row[4], skills: row[5],
    email: row[6], link1: row[7], link2: row[8], link3: row[9],
    platform: row[10], description: row[11], bid: num(row[12]),
    photoUrl: String(row[17] || '').trim(),
  };
  if (expectedAmount != null && info.bid !== Math.floor(Number(expectedAmount))) {
    return { amountMismatch: true, paid: Math.floor(Number(expectedAmount)), bid: info.bid, board };
  }
  await setClaimStatus(rownum, 'verifying', '');
  try {
    const rank = await applyClaimToLeaderboard(info);
    await setClaimStatus(rownum, 'applied', rank);
    return { rownum, rank, board };
  } catch (e) {
    await setClaimStatus(rownum, 'verified', '');
    throw e;
  }
}

// ---------- Gateway order verification ----------

// Find a gateway claim by its order id (stored in the Transaction ID
// column Q, uppercased). Returns the row number plus the fields needed to
// verify and apply, or null.
async function findClaimByOrderId(orderId) {
  const clean = String(orderId || '').trim().toUpperCase();
  if (!clean) return null;
  const rows = await getValues(TAB_CLAIMS, 'A1:R500');
  for (let i = 1; i < rows.length; i++) {
    const r = pad(rows[i], 18);
    if (String(r[16]).trim().toUpperCase() === clean) {
      return {
        rownum: i + 1,
        board: String(r[1]).trim() === BOARD_SHOWCASE ? BOARD_SHOWCASE : BOARD_PROFILES,
        name: String(r[2] || ''),
        bid: num(r[12]),
        status: String(r[15] || '').trim().toLowerCase(),
        rank: String(r[14] || ''),
      };
    }
  }
  return null;
}

// Verify + apply a Cashfree claim by order id. Idempotent: a claim already
// 'applied' returns its rank without touching the board again, so duplicate
// verify calls and repeated webhooks can never double-apply. The paid amount
// (INR, as reported by Cashfree) must equal the claim's bid, otherwise the
// claim is left for manual review. Uses the same transitional 'verifying'
// status as the UPI path so the claims cron skips it mid-flight; on failure
// the claim is left 'verified' for the cron backstop.
async function verifyAndApplyCashfreeClaim(orderId, paidRupees) {
  const found = await findClaimByOrderId(orderId);
  if (!found) return { notFound: true };
  if (found.status === 'applied') return { alreadyApplied: true, rank: found.rank, board: found.board };
  if (found.status !== 'awaiting payment' && found.status !== 'verifying') {
    return { wrongState: true, status: found.status };
  }
  const paid = Math.round(Number(paidRupees));
  if (paid !== found.bid) return { amountMismatch: true, paid, bid: found.bid, board: found.board };

  const rows = await getValues(TAB_CLAIMS, `A${found.rownum}:R${found.rownum}`);
  const r = pad(rows[0] || [], 18);
  const info = {
    board: found.board,
    name: r[2], headline: r[3], college: r[4], skills: r[5],
    email: r[6], link1: r[7], link2: r[8], link3: r[9],
    platform: r[10], description: r[11], bid: num(r[12]),
    photoUrl: String(r[17] || '').trim(),
  };
  await setClaimStatus(found.rownum, 'verifying', '');
  try {
    const rank = await applyClaimToLeaderboard(info);
    await setClaimStatus(found.rownum, 'applied', rank);
    return { rownum: found.rownum, rank, board: found.board };
  } catch (e) {
    await setClaimStatus(found.rownum, 'verified', '');
    throw e;
  }
}

// ---------- Weekly archive (Sunday resets) ----------

async function ensureWeeksTab() {
  await ensureTab(TAB_WEEKS, WEEKS_HEADERS);
}

// Read the Weekly Archive and group it into week objects, oldest first.
// Each week carries its top 10 profiles and top 10 works plus totals.
async function getWeeklyArchive() {
  let vals;
  try {
    vals = await getValues(TAB_WEEKS, 'A1:L2000');
  } catch (e) {
    if (/Unable to parse range|not found/i.test(e.message || '')) return { weeks: [] };
    throw e;
  }
  const byWeek = new Map();
  for (const r of vals.slice(1)) {
    const p = pad(r, 12);
    const week = num(p[0]);
    if (!week) continue;
    const board = p[3] === BOARD_SHOWCASE ? BOARD_SHOWCASE : BOARD_PROFILES;
    if (!byWeek.has(week)) {
      byWeek.set(week, { week, start: String(p[1] || ''), end: String(p[2] || ''), profiles: [], works: [] });
    }
    const w = byWeek.get(week);
    const entry = board === BOARD_SHOWCASE
      ? { rank: num(p[4]) || 0, title: String(p[5] || ''), creator: String(p[6] || ''), platform: String(p[10] || ''), link: String(p[9] || ''), bid: num(p[11]) }
      : { rank: num(p[4]) || 0, name: String(p[5] || ''), headline: String(p[6] || ''), college: String(p[7] || ''), skills: String(p[8] || '').split(',').map((s) => s.trim()).filter(Boolean), bid: num(p[11]) };
    (board === BOARD_SHOWCASE ? w.works : w.profiles).push(entry);
  }
  const weeks = [...byWeek.values()]
    .sort((a, b) => a.week - b.week)
    .map((w) => {
      w.profiles.sort((a, b) => a.rank - b.rank);
      w.works.sort((a, b) => a.rank - b.rank);
      w.profileCount = w.profiles.length;
      w.workCount = w.works.length;
      w.revenue = w.profiles.reduce((s, e) => s + e.bid, 0) + w.works.reduce((s, e) => s + e.bid, 0);
      w.profiles = w.profiles.slice(0, 10);
      w.works = w.works.slice(0, 10);
      return w;
    });
  return { weeks };
}

// --- Payment inbox: inbound bank-SMS payments (shared across boards) ---

async function ensureTab(title, headers) {
  let vals = [];
  try {
    vals = await getValues(title, 'A1:Z1');
  } catch (e) {
    if (!/Unable to parse range|not found/i.test(e.message || '')) throw e;
    await client().spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] },
    });
    vals = [];
  }
  // An existing-but-empty tab still needs its headers.
  if (!vals.length) {
    await appendValues(title, 'A1:Z1', [headers]);
  }
}

async function ensureInboxTab() {
  await ensureTab(TAB_INBOX, INBOX_HEADERS);
}

// Record an inbound payment. Idempotent per UTR.
async function recordInboundPayment({ amount, utr, raw }) {
  const cleanUtr = String(utr || '').trim().toUpperCase();
  if (!cleanUtr) return null;
  await ensureInboxTab();
  const rows = await getValues(TAB_INBOX, 'A1:E500');
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][2] || '').trim().toUpperCase() === cleanUtr) {
      return { rownum: i + 1, created: false };
    }
  }
  await appendValues(TAB_INBOX, 'A1:E1', [[
    stamp(), amount == null ? '' : String(amount), cleanUtr,
    String(raw || '').slice(0, 500), 'unmatched',
  ]]);
  return { rownum: rows.length + 1, created: true };
}

async function findUnmatchedPayment(utr) {
  const cleanUtr = String(utr || '').trim().toUpperCase();
  if (!cleanUtr) return null;
  await ensureInboxTab();
  const rows = await getValues(TAB_INBOX, 'A1:E500');
  for (let i = 1; i < rows.length; i++) {
    const r = pad(rows[i], 5);
    if (String(r[2]).trim().toUpperCase() === cleanUtr &&
        String(r[4]).trim().toLowerCase() === 'unmatched') {
      return { rownum: i + 1, row: r };
    }
  }
  return null;
}

async function markPaymentMatched(rownum) {
  await updateValues(TAB_INBOX, `E${rownum}`, [['matched']]);
}

// --- New tabs: Verifications / Duels / Daily Snapshots ---
const TAB_VERIFY = 'Verifications';
const TAB_DUELS = 'Duels';
const TAB_SNAPSHOTS = 'Daily Snapshots';
const VERIFY_HEADERS = ['Key', 'GitHub user', 'GH stars', 'GH repos', 'GH followers', 'LeetCode user', 'LC rating', 'LC solved', 'Updated'];
const DUEL_HEADERS = ['Duel ID', 'Challenger', 'Challenger key', 'Opponent', 'Opponent key', 'Challenger start bid', 'Opponent start bid', 'Challenger end bid', 'Opponent end bid', 'Winner', 'Status', 'Created', 'Ends'];
const SNAPSHOT_HEADERS = ['Date', 'Board', 'Rank', 'Name', 'Extra', 'Bid'];

// Next Sunday 00:05 IST (absolute ms). Mirrors the frontend countdown math.
function nextResetAt(fromMs = Date.now()) {
  const d = new Date(fromMs);
  const istMs = fromMs + (d.getTimezoneOffset() + 330) * 60000;
  const ist = new Date(istMs);
  const add = (7 - ist.getUTCDay()) % 7;
  const target = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + add, 0, 5, 0);
  let resetUtc = target - 330 * 60000;
  if (resetUtc <= fromMs) resetUtc += 7 * 86400000;
  return resetUtc;
}

// Snipe Hour: the 60 minutes before reset are a live war room; up to 15 min
// after the most recent reset is "overtime" (the reset script extends the
// window while bids keep arriving, capped at 15 minutes). Computed against
// the most recent reset, not the upcoming one, so the overtime phase is
// actually reported.
function snipeState(nowMs = Date.now()) {
  const upcoming = nextResetAt(nowMs);
  const last = upcoming - 7 * 86400000; // most recent Sunday 00:05 IST
  const live = nowMs >= upcoming - 3600000 && nowMs < upcoming;
  const overtime = nowMs >= last && nowMs < last + 15 * 60000;
  return {
    resetAt: new Date(overtime ? last : upcoming).toISOString(),
    endsAt: new Date(upcoming).toISOString(),
    active: live || overtime,
    overtime,
  };
}

async function readProfilesNormalized() {
  const vals = await getValues(TAB_PROFILES, 'A1:M300');
  return (vals.length > 1 ? vals.slice(1) : [])
    .map((r) => pad(r, 13))
    .filter((r) => r[1].trim())
    .map((r) => ({
      key: profileIdentityKey(r),
      rank: num(r[0]), name: r[1].trim(), headline: (r[2] || '').trim(),
      college: (r[3] || '').trim(),
      skills: String(r[4] || '').split(',').map((s) => s.trim()).filter(Boolean),
      linkedin: (r[5] || '').trim(), github: (r[6] || '').trim(), coding: (r[7] || '').trim(),
      bid: num(r[9]), clicks: num(r[10]), age: (r[11] || '').trim(),
      photo: photoUrlFor(String(r[12] || '').trim()),
    }))
    .sort((a, b) => b.bid - a.bid)
    .map((p, i) => ({ ...p, rank: i + 1 }));
}

async function readWorksNormalized() {
  const vals = await getValues(TAB_SHOWCASE, 'A1:I300');
  return (vals.length > 1 ? vals.slice(1) : [])
    .map((r) => pad(r, 9))
    .filter((r) => r[1].trim())
    .map((r) => ({
      key: workIdentityKey(r[1]),
      rank: num(r[0]), title: r[1].trim(), creator: (r[2] || '').trim(),
      platform: (r[3] || '').trim(), link: (r[4] || '').trim(),
      description: (r[5] || '').trim(), bid: num(r[6]), clicks: num(r[7]), age: (r[8] || '').trim(),
    }))
    .sort((a, b) => b.bid - a.bid)
    .map((w, i) => ({ ...w, rank: i + 1 }));
}

async function getVerifications() {
  let vals = [];
  try { vals = await getValues(TAB_VERIFY, 'A1:I300'); } catch (e) { return {}; }
  const map = {};
  for (const r of vals.slice(1)) {
    const p = pad(r, 9);
    if (!p[0].trim()) continue;
    map[p[0].trim()] = {
      gh_user: p[1].trim(), gh_stars: num(p[2]), gh_repos: num(p[3]), gh_followers: num(p[4]),
      lc_user: p[5].trim(), lc_rating: num(p[6]), lc_solved: num(p[7]),
    };
  }
  return map;
}

// Insert or update a verification row by identity key. Only the provided
// fields are overwritten; existing stats are preserved.
async function upsertVerification(key, fields) {
  if (!key) return;
  await ensureTab(TAB_VERIFY, VERIFY_HEADERS);
  const vals = await getValues(TAB_VERIFY, 'A1:I300');
  let rownum = -1;
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][0] || '').trim() === key) { rownum = i + 1; break; }
  }
  const cur = rownum > 0 ? pad(vals[rownum - 1], 9) : ['', '', '', '', '', '', '', '', ''];
  const next = [
    key,
    fields.gh_user !== undefined ? fields.gh_user : cur[1],
    fields.gh_stars !== undefined ? String(fields.gh_stars) : cur[2],
    fields.gh_repos !== undefined ? String(fields.gh_repos) : cur[3],
    fields.gh_followers !== undefined ? String(fields.gh_followers) : cur[4],
    fields.lc_user !== undefined ? fields.lc_user : cur[5],
    fields.lc_rating !== undefined ? String(fields.lc_rating) : cur[6],
    fields.lc_solved !== undefined ? String(fields.lc_solved) : cur[7],
    stamp(),
  ];
  if (rownum > 0) await updateValues(TAB_VERIFY, `A${rownum}:I${rownum}`, [next]);
  else await appendValues(TAB_VERIFY, 'A1:I1', [next]);
}

// Full public board payload: profiles, works, activity, stats, verifications
// merged onto profiles, and the snipe-hour state. No emails are exposed.
async function getBoardData() {
  const [profiles, works, verifs] = await Promise.all([
    readProfilesNormalized().catch(() => []),
    readWorksNormalized().catch(() => []),
    getVerifications().catch(() => ({})),
  ]);
  let activity = [];
  try {
    const aVals = await getValues(TAB_ACTIVITY, 'A1:C21');
    activity = aVals.slice(1).map((r) => pad(r, 3))
      .filter((r) => r[1].trim())
      .map((r) => ({ time: r[0].trim(), name: r[1].trim(), action: r[2].trim() }));
  } catch (e) { /* keep empty */ }
  let stats = { visitors: 0, revenue: 0, profiles: profiles.length, works: works.length };
  try {
    const sVals = await getValues(TAB_STATS, 'A1:C10');
    for (const r of sVals.slice(1)) {
      const m = String(r[0] || '').trim();
      if (m === 'Visitors') stats.visitors = num(r[1]);
      else if (m === 'Revenue (INR)') stats.revenue = num(r[1]);
    }
    if (!stats.revenue) {
      stats.revenue = profiles.reduce((s, p) => s + p.bid, 0) + works.reduce((s, w) => s + w.bid, 0);
    }
  } catch (e) { /* keep computed */ }
  for (const p of profiles) {
    if (verifs[p.key]) p.verified = verifs[p.key];
  }
  const nowMs = Date.now();
  return {
    profiles, works, activity, stats,
    snipe: snipeState(nowMs),
    serverTime: new Date(nowMs).toISOString(),
  };
}

// ---------- Duels ----------

async function getDuels() {
  let vals = [];
  try { vals = await getValues(TAB_DUELS, 'A1:M100'); } catch (e) { return []; }
  return vals.slice(1).map((r, i) => {
    const p = pad(r, 13);
    if (!p[0].trim()) return null;
    return {
      rownum: i + 2, id: p[0].trim(), challenger: p[1].trim(), challengerKey: canonicalKey(p[2].trim()),
      opponent: p[3].trim(), opponentKey: canonicalKey(p[4].trim()),
      cStart: num(p[5]), oStart: num(p[6]), cEnd: num(p[7]), oEnd: num(p[8]),
      winner: p[9].trim(), status: p[10].trim() || 'active',
      created: p[11].trim(), ends: p[12].trim(),
    };
  }).filter(Boolean);
}

async function createDuelRow(d) {
  await ensureTab(TAB_DUELS, DUEL_HEADERS);
  const id = 'D' + Date.now().toString(36).toUpperCase();
  const challengerKey = canonicalKey(d.challengerKey);
  const opponentKey = canonicalKey(d.opponentKey);
  // Narrow the check-then-write race: re-read active duels immediately
  // before appending and refuse if either side got booked meanwhile.
  const duels = await getDuels();
  const clash = duels.some((x) => {
    if (x.status !== 'active') return false;
    const keys = [x.challengerKey, x.opponentKey];
    return keys.includes(challengerKey) || keys.includes(opponentKey);
  });
  if (clash) throw new Error('One of these profiles just entered another duel.');
  await appendValues(TAB_DUELS, 'A1:M1', [[
    id, d.challenger, challengerKey, d.opponent, opponentKey,
    String(d.cStart), String(d.oStart), '', '', '', 'active', stamp(), d.ends,
  ]]);
  return id;
}

// Update a duel's end bids / winner / status (columns H..K).
async function updateDuelRow(rownum, { cEnd, oEnd, winner, status }) {
  await updateValues(TAB_DUELS, `H${rownum}:K${rownum}`, [[
    String(cEnd), String(oEnd), winner || '', status || 'done',
  ]]);
}

// Latest claim submission time (any status), for snipe-overshoot detection.
async function latestClaimTime() {
  try {
    const vals = await getValues(TAB_CLAIMS, 'A1:R500');
    let latest = 0;
    for (const r of vals.slice(1)) {
      const t = Date.parse(String(r[0] || '').replace(' ', 'T'));
      if (Number.isFinite(t) && t > latest) latest = t;
    }
    return latest || null;
  } catch (e) { return null; }
}

// Raw Daily Snapshots rows (headers + data) for the /api/snapshots endpoint.
async function readSnapshotsRaw() {
  try {
    return await getValues(TAB_SNAPSHOTS, 'A1:F500');
  } catch (e) {
    return [];
  }
}

module.exports = {
  SPREADSHEET_ID, CLAIM_HEADERS, PROFILE_HEADERS, SHOWCASE_HEADERS,
  ACTIVITY_HEADERS, STATS_HEADERS, INBOX_HEADERS, WEEKS_HEADERS,
  VERIFY_HEADERS, DUEL_HEADERS, SNAPSHOT_HEADERS,
  TAB_PROFILES, TAB_TODAY, TAB_SHOWCASE, TAB_CLAIMS, TAB_ACTIVITY, TAB_STATS, TAB_INBOX, TAB_WEEKS,
  TAB_VERIFY, TAB_DUELS, TAB_SNAPSHOTS,
  BOARD_PROFILES, BOARD_SHOWCASE,
  recordPendingClaim,
  findAwaitingClaim, findClaimByUtr, setClaimStatus, setClaimPhoto, photoUrlFor,
  applyClaimToLeaderboard,
  applyProfileClaim, applyShowcaseClaim, logActivity, refreshBoardStats,
  autoVerifyAndApply, recordInboundPayment, findUnmatchedPayment,
  markPaymentMatched, ensureInboxTab, ensureTab,
  findClaimByOrderId, verifyAndApplyCashfreeClaim,
  ensureWeeksTab, getWeeklyArchive,
  MIN_INCREMENT, getBidContext, incrementError,
  identityKey: profileKeyOf, profileKeyOf, profileIdentityKey, workIdentityKey,
  canonicalKey, hashEmail,
  nextResetAt, snipeState,
  getBoardData, getVerifications, upsertVerification,
  getDuels, createDuelRow, updateDuelRow, latestClaimTime, readSnapshotsRaw,
};
