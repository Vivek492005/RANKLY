'use strict';
// Shared claim-body validation for the Cashfree payment path:
//   - POST /api/create-order  (Cashfree order creation)
// Returns { claim } on success, or throws { status, error } for a 4xx.
// The UTR option is legacy (manual-UPI path, removed); create-order never
// requires it — the Cashfree order id is stored as the transaction id.
const MIN_BID = 1;
const MAX_BID = 999;
const PLATFORMS = ['GitHub', 'Instagram', 'LinkedIn', 'Other'];

function normalizeUrl(u) {
  let s = String(u || '').trim().slice(0, 300);
  if (s && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) s = 'https://' + s;
  return s;
}

function validUrl(u) {
  try {
    const x = new URL(u);
    return (x.protocol === 'http:' || x.protocol === 'https:') && !!x.hostname.includes('.');
  } catch { return false; }
}

function validEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
}

// UPI transaction IDs (UTR) are typically 12 digits; accept a sane range so
// no legitimate reference is rejected.
function validUtr(u) {
  return /^[A-Za-z0-9]{6,32}$/.test(u);
}

function fail(status, error) {
  const e = new Error(error);
  e.status = status;
  throw e;
}

// Extract a username from a profile URL, e.g. github.com/USER or
// leetcode.com/u/USER. Returns '' when it doesn't look like one.
function extractUser(u, hosts) {
  try {
    const x = new URL(u);
    const host = x.hostname.replace(/^www\./, '').toLowerCase();
    if (!hosts.some((h) => host === h || host.endsWith('.' + h))) return '';
    const segs = x.pathname.split('/').filter(Boolean)
      .filter((s) => !/^(u|users|in|profile|problems)$/i.test(s));
    const cand = segs[0] || '';
    return /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,38}[A-Za-z0-9])?$/.test(cand) ? cand : '';
  } catch { return ''; }
}

function validateClaimBody(body, { requireUtr = false } = {}) {
  if (body == null || typeof body !== 'object') fail(400, 'Invalid request.');
  const board = body.board === 'showcase' ? 'showcase' : 'profiles';
  const name = String(body.name || '').trim().slice(0, 80);
  const headline = String(body.headline || '').trim().slice(0, 80);
  const bid = Math.floor(Number(body.bid));

  let claim;
  if (board === 'showcase') {
    const creator = headline;
    const platform = PLATFORMS.includes(body.platform) ? body.platform : 'Other';
    const link = normalizeUrl(body.link || body.link1);
    const description = String(body.description || '').trim().slice(0, 300);
    if (!name) fail(400, 'Work title is required.');
    if (!creator) fail(400, 'Creator name is required.');
    if (!validUrl(link)) fail(400, 'A valid link to the work is required.');
    claim = { board, name, headline: creator, college: '', skills: '', email: '', link1: link, link2: '', link3: '', platform, description, bid };
  } else {
    const college = String(body.college || '').trim().slice(0, 80);
    const skills = String(body.skills || '').trim().slice(0, 200);
    const email = String(body.email || '').trim().slice(0, 120);
    const linkedin = normalizeUrl(body.linkedin || body.link1);
    const github = normalizeUrl(body.github || body.link2);
    const coding = normalizeUrl(body.coding || body.link3);
    if (!name) fail(400, 'Your name is required.');
    if (!headline) fail(400, 'A headline is required (e.g. "Full-stack developer").');
    if (!linkedin && !github && !coding) {
      fail(400, 'Add at least one profile link — LinkedIn, GitHub, or a coding profile.');
    }
    for (const [label, u] of [['LinkedIn', linkedin], ['GitHub', github], ['Coding profile', coding]]) {
      if (u && !validUrl(u)) fail(400, `The ${label} link doesn't look like a valid URL.`);
    }
    if (email && !validEmail(email)) fail(400, 'That email address doesn\u2019t look valid.');
    claim = { board, name, headline, college, skills, email, link1: linkedin, link2: github, link3: coding, platform: '', description: '', bid };
  }

  if (!Number.isFinite(bid) || bid < MIN_BID) fail(400, `Minimum bid is ₹${MIN_BID.toLocaleString('en-IN')}.`);
  if (bid > MAX_BID) fail(400, `Maximum bid is ₹${MAX_BID.toLocaleString('en-IN')}.`);
  claim.bid = bid;

  if (requireUtr) {
    const utr = String(body.utr || '').trim().replace(/\s+/g, '');
    if (!validUtr(utr)) fail(400, 'Enter the UPI transaction ID from your payment app.');
    claim.utr = utr;
  }
  return { claim };
}

module.exports = {
  MIN_BID, MAX_BID, PLATFORMS,
  normalizeUrl, validUrl, validEmail, validUtr, extractUser,
  validateClaimBody,
};
