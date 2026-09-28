'use strict';
// GET /api/leaderboard — the full public board payload, served server-side
// (service account) so the site no longer depends on public gviz access.
// { profiles, works, activity, stats, snipe, serverTime }. No emails exposed.
const { getBoardData } = require('../lib/sheets');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const data = await getBoardData();
    res.setHeader('Cache-Control', 'public, max-age=10, s-maxage=10');
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: 'Could not load the leaderboard.' });
  }
};
