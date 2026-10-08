'use strict';
// GET /api/config — public settings the frontend needs.
const { isCashfreeConfigured, envMode } = require('../lib/cashfree');
const MIN_BID = 1;
const MAX_BID = 999;

const { applyCors } = require('../lib/cors');
module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return; // CORS for the GitHub Pages mirror
  res.setHeader('Cache-Control', 'no-store');
  const cashfree = isCashfreeConfigured();
  res.status(200).json({
    mode: 'cashfree',
    currency: 'INR',
    minBid: MIN_BID,
    maxBid: MAX_BID,
    sheetsConfigured: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    cashfreeEnabled: cashfree,
    // Tells the browser which Cashfree JS SDK mode to use
    // ('sandbox' | 'production'). The secret never leaves the server.
    cashfreeMode: envMode(),
  });
};
