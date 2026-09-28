'use strict';
// GET /api/config — public settings the frontend needs.
const { isRazorpayConfigured, keyId } = require('../lib/razorpay');
const UPI_ID = process.env.UPI_ID || 'sochai@ptyes';
const MIN_BID = 1;
const MAX_BID = 999;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const razorpay = isRazorpayConfigured();
  res.status(200).json({
    mode: 'upi-manual',
    currency: 'INR',
    minBid: MIN_BID,
    maxBid: MAX_BID,
    upiId: UPI_ID,
    sheetsConfigured: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    razorpayEnabled: razorpay,
    // The public key id is meant for the browser (Razorpay Checkout). The
    // secret never leaves the server.
    razorpayKeyId: razorpay ? keyId() : null,
  });
};
