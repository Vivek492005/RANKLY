'use strict';
// POST /api/submit-claim — records a manual-UPI bid claim as
// "Awaiting verification". It does NOT touch any board directly.
// The bank-SMS webhook auto-verifies + auto-applies matching claims; the
// claims cron remains the backstop for anything stuck at "verified".
//
// Body (board: "profiles" | "showcase"):
//
//   profiles: { board, name, headline, college, skills, email,
//               linkedin, github, coding, bid, utr }
//     - name + headline required; at least one of linkedin/github/coding
//       required; email optional (validated when present).
//   showcase: { board, name (work title), headline (creator), platform,
//               link, description, bid, utr }
//     - work title + creator + work link required;
//       platform in GitHub/Instagram/LinkedIn/Other.
const { recordPendingClaim, findUnmatchedPayment, markPaymentMatched, autoVerifyAndApply, getBidContext, MIN_INCREMENT, incrementError, upsertVerification, identityKey, findClaimByUtr, setClaimPhoto } = require('../lib/sheets');
const { validatePhoto, uploadProfilePhoto } = require('../lib/photos');
const { validateClaimBody, extractUser } = require('../lib/claimValidation');

const { applyCors } = require('../lib/cors');
module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return; // CORS for the GitHub Pages mirror
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (body == null || typeof body !== 'object') body = {};

  let claim;
  try {
    ({ claim } = validateClaimBody(body, { requireUtr: true }));
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message || 'Invalid claim.' });
  }
  const board = claim.board;
  const bid = claim.bid;
  const utr = claim.utr;

  // Optional profile photo (profiles board only). Validated up front so a
  // bad upload is rejected before the claim is recorded; the Drive upload
  // itself happens after the claim is safely stored and is best-effort.
  let photoUpload = null;
  if (board === 'profiles' && body.photo) {
    try {
      photoUpload = validatePhoto(body.photo);
    } catch (e) {
      return res.status(400).json({ error: e.message || 'That photo could not be used. Try a JPEG, PNG, or WebP under 1.5MB.' });
    }
  }

  // Minimum-increment rule: a re-bid must beat the bidder's own current bid by
  // at least MIN_INCREMENT (equal or lower re-bids are rejected); a new bid
  // that would take the #1 spot must clear the top bid by MIN_INCREMENT.
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

  try {
    const result = await recordPendingClaim(claim);
    if (result.duplicate) {
      return res.status(409).json({ error: 'This transaction ID was already submitted.' });
    }
    // Profile photo upload (best-effort): the claim is already recorded, so
    // a Drive failure here must never break it. On success the Drive file ID
    // is stored on the claim row (column R) before any auto-verification, so
    // an SMS-arrived-first payment still applies the photo to the profile.
    // The response carries only a safe boolean — never the file ID.
    let photoSaved = false;
    if (photoUpload) {
      try {
        const { photoUrl } = await uploadProfilePhoto({
          userKey: identityKey({ email: claim.email, linkedin: claim.link1, name: claim.name }),
          buffer: photoUpload.buffer, ext: photoUpload.ext,
        });
        const found = await findClaimByUtr(utr);
        if (found) await setClaimPhoto(found.rownum, photoUrl);
        photoSaved = true;
      } catch (e) {
        console.error('profile photo upload failed (claim kept):', e.message);
      }
    }
    // Auto-verification: if the bank SMS already arrived (payment inbox),
    // verify + apply immediately so the rank goes live with no admin step.
    // On any failure the claim simply stays "Awaiting verification" and the
    // claims cron remains the backstop.
    let autoApplied = false;
    let autoRank = null;
    try {
      const inbox = await findUnmatchedPayment(utr);
      if (inbox) {
        const paid = Math.floor(Number(String(inbox.row[1]).replace(/[^0-9.\-]/g, '')) || 0);
        if (paid === bid) {
          const done = await autoVerifyAndApply(utr);
          if (done) {
            autoApplied = true;
            autoRank = done.rank;
            await markPaymentMatched(inbox.rownum);
          }
        }
      }
    } catch (e) {
      console.error('auto-verify on submit failed:', e.message);
    }
    // Queue proof verification: pull GitHub / LeetCode usernames out of the
    // profile links so the daily verifier can fetch public stats into the
    // Verifications tab (shown as verified chips on the board).
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
    res.status(200).json({ ok: true, board, autoApplied, rank: autoRank, photoSaved });
  } catch (e) {
    console.error('submit-claim failed:', e.message);
    const msg = /GOOGLE_SERVICE_ACCOUNT_JSON/.test(e.message)
      ? 'Claim recording is not configured yet. Please try again later.'
      : 'Could not record your claim. Please try again.';
    res.status(500).json({ error: msg });
  }
};
