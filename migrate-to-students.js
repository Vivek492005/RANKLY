'use strict';
// One-time migration: Rankly company leaderboard -> student profiles + showcase.
//
// Run with: GOOGLE_SERVICE_ACCOUNT_JSON='<json>' node migrate-to-students.js
// (the service account must be an Editor on the spreadsheet).
//
// Steps:
//   1. Copy existing company rows from "Leaderboard (All time)" into a new
//      "Archive (companies)" tab (history preserved).
//   2. Clear "Leaderboard (All time)" + "Today" data rows, write the new
//      student-profile headers.
//   3. Create "Showcase" tab with its headers.
//   4. Rewrite Claims headers (18 cols); clear any data rows (expected empty).
//   5. Rewrite Activity log headers (Time | Name | Action); keep rows.
//   6. Reset Site stats: keep Visitors, Revenue=0, Profiles listed=0,
//      Works showcased=0.
//   7. Ensure Payment inbox headers exist.
//   8. Print a verification summary.
//
// Safe to re-run ONLY on a fresh (pre-migration) sheet: it archives whatever
// is currently on the leaderboard tab. Do not run after going live.
const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1FSWiEoLh8AgADL8jiFye4wOL5lt1KwjYjwSeeTBuy0o';
const TAB_PROFILES = 'Leaderboard (All time)';
const TAB_TODAY = 'Today';
const TAB_SHOWCASE = 'Showcase';
const TAB_CLAIMS = 'Claims';
const TAB_ACTIVITY = 'Activity log';
const TAB_STATS = 'Site stats';
const TAB_INBOX = 'Payment inbox';
const TAB_ARCHIVE = 'Archive (companies)';

const ARCHIVE_HEADERS = ['Rank', 'Product name', 'URL', 'Category', 'Description', 'Bid (INR)', 'Clicks', 'Age'];
const PROFILE_HEADERS = ['Rank', 'Name', 'Headline', 'College', 'Skills', 'LinkedIn', 'GitHub', 'Coding profile', 'Email', 'Bid (INR)', 'Clicks', 'Age', 'Photo'];
const SHOWCASE_HEADERS = ['Rank', 'Work title', 'Creator', 'Platform', 'Link', 'Description', 'Bid (INR)', 'Clicks', 'Age'];
const CLAIM_HEADERS = ['Timestamp', 'Board', 'Name', 'Headline', 'College', 'Skills', 'Email', 'Link1', 'Link2', 'Link3', 'Platform', 'Description', 'Bid (INR)', 'Payment method', 'Rank achieved', 'Status', 'Payment ID', 'Photo'];
const ACTIVITY_HEADERS = ['Time', 'Name', 'Action'];
const STATS_HEADERS = ['Metric', 'Value', 'Note'];
const INBOX_HEADERS = ['Timestamp', 'Amount (INR)', 'UTR', 'Raw SMS', 'Status'];

function sheets() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Set GOOGLE_SERVICE_ACCOUNT_JSON env var first.');
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(raw),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function main() {
  const s = sheets();
  const get = async (range) => (await s.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range })).data.values || [];
  const clear = async (range) => s.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range });
  const upd = async (range, values) => s.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID, range, valueInputOption: 'USER_ENTERED', requestBody: { values },
  });
  const addTab = async (title) => s.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  });

  // 1. Archive current company rows.
  const leader = await get(`${TAB_PROFILES}!A1:H200`);
  const oldHeaders = leader[0] || [];
  const oldRows = leader.length > 1 ? leader.slice(1).filter((r) => r[1] && String(r[1]).trim()) : [];
  console.log(`found ${oldRows.length} company rows to archive (headers: ${oldHeaders.slice(0, 3).join(',')}…)`);
  try { await addTab(TAB_ARCHIVE); console.log('created tab:', TAB_ARCHIVE); }
  catch (e) { console.log('archive tab:', /already exists/i.test(e.message) ? 'already exists' : e.message); }
  await upd(`${TAB_ARCHIVE}!A1`, [ARCHIVE_HEADERS, ...oldRows]);
  console.log(`archived ${oldRows.length} rows -> ${TAB_ARCHIVE}`);

  // 2. Fresh profile boards.
  for (const tab of [TAB_PROFILES, TAB_TODAY]) {
    await clear(`${tab}!A2:L1000`);
    await upd(`${tab}!A1`, [PROFILE_HEADERS]);
    console.log('reset board:', tab);
  }

  // 3. Showcase tab.
  try { await addTab(TAB_SHOWCASE); console.log('created tab:', TAB_SHOWCASE); }
  catch (e) { console.log('showcase tab:', /already exists/i.test(e.message) ? 'already exists' : e.message); }
  await clear(`${TAB_SHOWCASE}!A2:I1000`);
  await upd(`${TAB_SHOWCASE}!A1`, [SHOWCASE_HEADERS]);

  // 4. Claims: new headers, clear data (expected empty).
  await clear(`${TAB_CLAIMS}!A2:Q1000`);
  await upd(`${TAB_CLAIMS}!A1`, [CLAIM_HEADERS]);
  console.log('reset:', TAB_CLAIMS);

  // 5. Activity log: rename Product -> Name, keep rows.
  const acts = await get(`${TAB_ACTIVITY}!A1:C100`);
  await upd(`${TAB_ACTIVITY}!A1`, [ACTIVITY_HEADERS, ...acts.slice(1)]);
  console.log(`activity headers renamed, ${acts.length - 1} rows kept`);

  // 6. Stats reset (keep Visitors).
  const stats = await get(`${TAB_STATS}!A1:C20`);
  let visitors = 28640;
  for (const r of stats.slice(1)) {
    if (r[0] && r[0].trim() === 'Visitors') { visitors = parseInt(String(r[1]).replace(/[^0-9]/g, ''), 10) || visitors; break; }
  }
  await upd(`${TAB_STATS}!A1`, [STATS_HEADERS,
    ['Visitors', String(visitors), 'demo counter'],
    ['Revenue (INR)', '0', 'auto: sum of live bids'],
    ['Profiles listed', '0', 'auto: profile count'],
    ['Works showcased', '0', 'auto: showcase count'],
  ]);
  console.log(`stats reset (visitors kept at ${visitors})`);

  // 7. Payment inbox headers.
  try {
    const inbox = await get(`${TAB_INBOX}!A1:E1`);
    if (!inbox.length || inbox[0][0] !== 'Timestamp') await upd(`${TAB_INBOX}!A1`, [INBOX_HEADERS]);
    console.log('inbox ok');
  } catch (e) {
    await addTab(TAB_INBOX);
    await upd(`${TAB_INBOX}!A1`, [INBOX_HEADERS]);
    console.log('created tab:', TAB_INBOX);
  }

  // 8. Verify.
  const meta = await s.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties.title' });
  console.log('tabs now:', meta.data.sheets.map((x) => x.properties.title).join(' | '));
  for (const [tab, rng] of [[TAB_PROFILES, 'A1:M3'], [TAB_SHOWCASE, 'A1:I2'], [TAB_CLAIMS, 'A1:R2'], [TAB_STATS, 'A1:C6'], [TAB_ARCHIVE, 'A1:H3']]) {
    const v = await get(`${tab}!${rng}`);
    console.log(`${tab}: ${(v[0] || []).join(' | ').slice(0, 60)}… (${Math.max(0, v.length - 1)} data rows)`);
  }
  console.log('MIGRATION COMPLETE');
}

main().catch((e) => { console.error('MIGRATION FAILED:', e.message); process.exit(1); });
