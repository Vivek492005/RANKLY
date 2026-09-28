'use strict';
// GET /api/claim-status?utr=XXXX — public status check for a submitted claim.
// Lets the claim dialog poll until the bank-SMS webhook auto-verifies the
// payment, then flip to "verified" live. Returns only the claim's own
// status/rank/board/name — no PII beyond what the submitter provided.
const { findClaimByUtr } = require('../lib/sheets');

const { applyCors } = require('../lib/cors');
module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return; // CORS for the GitHub Pages mirror
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const utr = String(req.query.utr || '').trim().replace(/\s+/g, '');
  // Razorpay order ids (stored in the same column) contain underscores.
  if (!/^[A-Za-z0-9_]{6,32}$/.test(utr)) {
    return res.status(400).json({ error: 'A valid transaction ID is required.' });
  }
  try {
    const claim = await findClaimByUtr(utr);
    if (!claim) return res.status(200).json({ found: false });
    res.status(200).json({
      found: true,
      status: claim.status,          // e.g. "awaiting verification" | "verifying" | "applied"
      rank: claim.rank || null,
      board: claim.board,
      name: claim.name,
    });
  } catch (e) {
    console.error('claim-status failed:', e.message);
    res.status(500).json({ error: 'Could not check claim status. Please try again.' });
  }
};
