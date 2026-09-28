'use strict';
// CORS for the GitHub Pages mirror of the site.
//
// The static copy served from https://vivek492005.github.io/RANKLY/
// has no serverless functions, so its frontend calls these APIs cross-origin
// on the Vercel deployment. This helper adds the CORS headers for exactly
// that origin (not `*`) and short-circuits OPTIONS preflights.
//
// Usage — first line inside every frontend-facing handler:
//   const { applyCors } = require('../lib/cors');
//   ...
//   if (applyCors(req, res)) return;
const PAGES_ORIGIN = 'https://vivek492005.github.io';

function applyCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', PAGES_ORIGIN);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true; // preflight handled
  }
  return false;
}

module.exports = { applyCors, PAGES_ORIGIN };
