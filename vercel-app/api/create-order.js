'use strict';
// POST /api/create-order — Razorpay path, step 1.
// Validates the bid claim exactly like /api/submit-claim (same rules, same
// minimum-increment check), creates a Razorpay order for the bid amount, and
// records the claim as "Awaiting payment" with the Razorpay order id in the
// Transaction ID column. It does NOT touch any board.
//
// Body: same as /api/submit-claim but WITHOUT utr (plus optional photo).
// Response: { orderId, keyId, amount, currency } for Razorpay Checkout.
const { recordPendingClaim, getBidContext, incrementError, identityKey, findClaimByOrderId, setClaimPhoto } = require('../lib/sheets');
const { validatePhoto, uploadProfilePhoto } = require('../lib/photos');
const { validateClaimBody, extractUser } = require('../lib/claimValidation');
const { isRazorpayConfigured, getClient, newReceipt, keyId } = require('../lib/razorpay');
const { upsertVerification } = require('../lib/sheets');
const { applyCors } = require('../lib/cors');
module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return; // CORS for the GitHub Pages mirror
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isRazorpayConfigured()) {
    return res.status(503).json({ error: 'Online payments are not enabled yet. Please try again later.' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (body == null || typeof body !== 'object') body = {};

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

  // Create the Razorpay order (amount in paise).
  let order;
  try {
    order = await getClient().orders.create({
      amount: bid * 100,
      currency: 'INR',
      receipt: newReceipt(),
      notes: { board, claim_name: claim.name.slice(0, 60) },
    });
  } catch (e) {
    console.error('razorpay order creation failed:', e.message);
    return res.status(502).json({ error: 'Could not start the payment. Please try again.' });
  }

  try {
    // Record the claim as "Awaiting payment", keyed by the Razorpay order id.
    // The order id is unique per attempt, so no duplicate conflict is
    // possible here; the lookup below is a safety net.
    const dupe = await findClaimByOrderId(order.id);
    if (!dupe) {
      await recordPendingClaim({ ...claim, utr: order.id, paymentMethod: 'Razorpay', status: 'Awaiting payment' });
    }
    let photoSaved = false;
    if (photoUpload) {
      try {
        const { photoUrl } = await uploadProfilePhoto({
          userKey: identityKey({ email: claim.email, linkedin: claim.link1, name: claim.name }),
          buffer: photoUpload.buffer, ext: photoUpload.ext,
        });
        const found = await findClaimByOrderId(order.id);
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
    res.status(200).json({ orderId: order.id, keyId: keyId(), amount: order.amount, currency: order.currency, photoSaved });
  } catch (e) {
    console.error('create-order claim recording failed:', e.message);
    res.status(500).json({ error: 'Could not record your claim. Please try again.' });
  }
};
