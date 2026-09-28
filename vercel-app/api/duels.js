'use strict';
// /api/duels — head-to-head 24h bid duels.
// GET  -> { duels: [...] } active first, then recently finished (max 12).
// POST -> { challengerKey, opponentKey } creates a duel when both profiles
//         exist on the board, differ, and neither is already duelling.
// Keys are canonical identity keys ("id:…" hashed, "li:…", "name:…",
// "work:…"); legacy "email:…" keys are folded into the hashed form.
// Duel end times are ISO-8601 UTC so every client parses the same instant.
const sheets = require('../lib/sheets');

function activeDuelFor(duels, key) {
  return duels.find((d) => d.status === 'active' && (d.challengerKey === key || d.opponentKey === key));
}

// Best-effort per-instance rate limit for duel creation: 5 per IP per hour.
const bucket = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (bucket.get(ip) || []).filter((t) => now - t < 3600000);
  if (arr.length >= 5) return true;
  arr.push(now);
  bucket.set(ip, arr);
  if (bucket.size > 5000) bucket.clear();
  return false;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const duels = await sheets.getDuels();
      duels.sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1)
        || String(b.ends).localeCompare(String(a.ends)));
      return res.status(200).json({ duels: duels.slice(0, 12) });
    }
    if (req.method === 'POST') {
      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
      if (rateLimited(ip)) {
        return res.status(429).json({ error: 'Too many duels — try again in a while.' });
      }
      const body = req.body || {};
      const challengerKey = sheets.canonicalKey(String(body.challengerKey || '').trim());
      const opponentKey = sheets.canonicalKey(String(body.opponentKey || '').trim());
      if (!challengerKey || !opponentKey) {
        return res.status(400).json({ error: 'Pick your profile and an opponent.' });
      }
      if (challengerKey === opponentKey) {
        return res.status(400).json({ error: 'You cannot duel yourself.' });
      }
      const { profiles, showcase } = await sheets.getBoardData();
      const byKey = new Map([
        ...profiles.map((p) => [p.key, { name: p.name, bid: p.bid }]),
        ...(showcase || []).map((w) => [w.key, { name: w.title, bid: w.bid }]),
      ]);
      const c = byKey.get(challengerKey);
      const o = byKey.get(opponentKey);
      if (!c || !o) return res.status(400).json({ error: 'Both entries must be on the live board.' });
      const duels = await sheets.getDuels();
      if (activeDuelFor(duels, challengerKey) || activeDuelFor(duels, opponentKey)) {
        return res.status(409).json({ error: 'One of these entries is already in a duel.' });
      }
      const ends = new Date(Date.now() + 24 * 3600000).toISOString();
      const id = await sheets.createDuelRow({
        challenger: c.name, challengerKey, opponent: o.name, opponentKey,
        cStart: c.bid, oStart: o.bid, ends,
      });
      await sheets.logActivity(c.name, `challenged ${o.name} to a 24-hour bid duel`);
      return res.status(200).json({ ok: true, id });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    if (e && /already in a duel|just entered another duel/i.test(e.message)) {
      return res.status(409).json({ error: e.message });
    }
    return res.status(500).json({ error: 'Duel service is unavailable right now.' });
  }
};

module.exports.activeDuelFor = activeDuelFor;
