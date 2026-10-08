'use strict';
// POST /api/create-order — Cashfree path, step 1.
// Validates the bid claim (same rules as the shared claim validation, plus
// the minimum-increment check), creates a Cashfree order for the bid amount,
// and records the claim as "Awaiting payment" with the Cashfree order id in
// the Transaction ID column. It does NOT touch any board.
//
// Body: claim fields (board: "profiles" | "showcase") WITHOUT utr, PLUS
// phone (10-digit Indian mobile — Cashfree requires it) and optional photo.
// Response: { paymentSessionId, orderId } for Cashfree Checkout.
const crypto = require('crypto');
const { recordPendingClaim, getBidContext, incrementError, identityKey, findClaimByOrderId, setClaimPhoto } = require('../lib/sheets');
const { validatePhoto, uploadProfilePhoto } = require('../lib/photos');
const { validateClaimBody, extractUser } = require('../lib/claimValidation');
const { isCashfreeConfigured, createOrder, newOrderId } = require('../lib/cashfree');
const { upsertVerification } = require('../lib/sheets');
const { applyCors } = require('../lib/cors');

const SITE_URL = (process.env.SITE_URL || 'https://ranklyy.vercel.app').replace(/\/$/, '');

// Deterministic, PII-free Cashfree customer id derived from the claim's
// identity key (Cashfree wants a stable id per customer).
function customerIdFor(claim) {
  const key = identityKey(claim.board === 'showcase'
    ? { name: claim.name }
    : { email: claim.email, linkedin: claim.link1, name: claim.name });
  return 'rankly_' + crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 24);
}

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return; // CORS for the GitHub Pages mirror
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isCashfreeConfigured()) {
    return res.status(503).json({ error: 'Online payments are not enabled yet. Please try again later.' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (body == null || typeof body !== 'object') body = {};

  // Cashfree requires the payer's 10-digit Indian mobile number.
  const phone = String(body.phone || '').replace(/\D/g, '');
  if (!/^[6-9]\d{9}$/.test(phone)) {
    return res.status(400).json({ error: 'Enter a valid 10-digit mobile number for the payment.' });
  }

  let claim;
  try {
    ({ claim } = validateClaimBody(body));
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message || 'Invalid claim.' });
  }
  const board = claim.board;
  const bid = claim.bid;

  // Optional profile photo (profiles board only), validated up front.
  let photoUpload = null;
  if (board === 'profiles' && body.photo) {
    try {
      photoUpload = validatePhoto(body.photo);
    } catch (e) {
      return res.status(400).json({ error: e.message || 'That photo could not be used. Try a JPEG, PNG, or WebP under 1.5MB.' });
    }
  }

  // Same minimum-increment rule as the manual path.
  try {
    const ctx = await getBidContext(board, board === 'showcase'
      ? { title: claim.name }
      : { email: claim.email, linkedin: claim.link1, name: claim.name });
    const incErr = incrementError(ctx, bid);
    if (incErr) return res.status(400).json({ error: incErr });
  } catch (e) {
    console.error('bid-context check failed:', e.message);
    return res.status(500).json({ error: 'Could not check current bids. Please try again.' });
  }

  // Create the Cashfree order (amount in INR, not paise).
  const orderId = newOrderId();
  let order;
  try {
    order = await createOrder({
      orderId,
      amount: bid,
      customerId: customerIdFor(claim),
      customerPhone: phone,
      customerEmail: claim.email || undefined,
      returnUrl: SITE_URL + '/',
      notifyUrl: SITE_URL + '/api/cashfree-webhook',
    });
  } catch (e) {
    console.error('cashfree order creation failed:', e.message);
    return res.status(502).json({ error: 'Could not start the payment. Please try again.' });
  }
  if (!order || !order.payment_session_id) {
    console.error('cashfree order creation returned no payment_session_id');
    return res.status(502).json({ error: 'Could not start the payment. Please try again.' });
  }

  try {
    // Record the claim as "Awaiting payment", keyed by the Cashfree order id.
    // The order id is unique per attempt, so no duplicate conflict is
    // possible here; the lookup below is a safety net.
    const dupe = await findClaimByOrderId(orderId);
    if (!dupe) {
      await recordPendingClaim({ ...claim, utr: orderId, paymentMethod: 'Cashfree', status: 'Awaiting payment' });
    }
    let photoSaved = false;
    if (photoUpload) {
      try {
        const { photoUrl } = await uploadProfilePhoto({
          userKey: identityKey({ email: claim.email, linkedin: claim.link1, name: claim.name }),
          buffer: photoUpload.buffer, ext: photoUpload.ext,
        });
        const found = await findClaimByOrderId(orderId);
        if (found) await setClaimPhoto(found.rownum, photoUrl);
        photoSaved = true;
      } catch (e) {
        console.error('profile photo upload failed (claim kept):', e.message);
      }
    }
    // Queue proof verification (same as the manual path).
    if (board === 'profiles') {
      try {
        const ghUser = extractUser(claim.link2, ['github.com']);
        const lcUser = extractUser(claim.link3, ['leetcode.com']);
        if (ghUser || lcUser) {
          const key = identityKey({ email: claim.email, linkedin: claim.link1, name: claim.name });
          await upsertVerification(key, {
            ...(ghUser ? { gh_user: ghUser } : {}),
            ...(lcUser ? { lc_user: lcUser } : {}),
          });
        }
      } catch (e) {
        console.error('verification queue failed:', e.message);
      }
    }
    res.status(200).json({ paymentSessionId: order.payment_session_id, orderId, photoSaved });
  } catch (e) {
    console.error('create-order claim recording failed:', e.message);
    res.status(500).json({ error: 'Could not record your claim. Please try again.' });
  }
};
