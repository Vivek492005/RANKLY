'use strict';
// GET /api/snapshots — daily top-10 snapshots for the Week Replay page.
// Returns { snapshots: [{ date, profiles: [{rank,name,bid}], works: [...] }] },
// oldest first, covering roughly the last week.
const { readSnapshotsRaw } = require('../lib/sheets');

function parseSnapshots(vals) {
  const byDate = new Map();
  for (const r of (vals || []).slice(1)) {
    const p = (r || []).concat(['', '', '', '', '', '']);
    const date = String(p[0] || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!byDate.has(date)) byDate.set(date, { date, profiles: [], works: [] });
    const s = byDate.get(date);
    const entry = {
      rank: parseInt(p[2], 10) || 0,
      name: String(p[3] || ''),
      bid: parseInt(String(p[5]).replace(/[^0-9]/g, ''), 10) || 0,
    };
    if (String(p[1]).trim() === 'showcase') s.works.push(entry); else s.profiles.push(entry);
  }
  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-8)
    .map((s) => {
      s.profiles.sort((a, b) => a.rank - b.rank);
      s.works.sort((a, b) => a.rank - b.rank);
      return s;
    });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const vals = await readSnapshotsRaw();
    return res.status(200).json({ snapshots: parseSnapshots(vals) });
  } catch (e) {
    return res.status(200).json({ snapshots: [] });
  }
};

module.exports.parseSnapshots = parseSnapshots;
