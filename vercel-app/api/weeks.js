'use strict';
// GET /api/weeks — previous weekly rankings (archived every Sunday reset).
// Returns { weeks: [{ week, start, end, profiles:[top10], works:[top10],
// profileCount, workCount, revenue }] }, oldest first. No auth needed; the
// archive holds only public leaderboard data.
const { getWeeklyArchive } = require('../lib/sheets');

const { applyCors } = require('../lib/cors');
module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return; // CORS for the GitHub Pages mirror
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const data = await getWeeklyArchive();
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: 'Could not load previous weeks.' });
  }
};
