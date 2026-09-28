'use strict';
// Unit tests for the weekly-archive data layer in lib/sheets.js.
// Drives getWeeklyArchive with a stubbed Sheets API (no network, no Google).
const path = require('path');
const assert = require('assert');
const Module = require('module');

const SHEETS_PATH = path.resolve(__dirname, '../vercel-app/lib/sheets.js');

const WEEKS_ROWS = [
  ['Week', 'Start date', 'End date', 'Board', 'Rank', 'Name', 'Headline', 'College', 'Skills', 'Link', 'Platform', 'Bid (INR)'],
  [1, '2026-09-14', '2026-09-20', 'profiles', 1, 'Asha', 'Dev', 'IIT', 'Go, SQL', 'https://li/a', '', 500],
  [1, '2026-09-14', '2026-09-20', 'profiles', 2, 'Ravi', 'ML', '', 'Python', '', '', 300],
  [1, '2026-09-14', '2026-09-20', 'showcase', 1, 'App', 'Asha', '', '', 'https://x', 'GitHub', 100],
  [2, '2026-09-21', '2026-09-27', 'profiles', 1, 'Meera', 'Web', 'NIT', '', 'https://li/m', '', 900],
  ['', '', '', '', '', '', '', '', '', '', '', ''],          // junk row: skipped
  ['abc', '', '', '', '', '', '', '', '', '', '', ''],        // junk row: skipped
];

function loadSheetsWith(rows, failWith) {
  delete require.cache[SHEETS_PATH];
  const googleapis = {
    google: {
      auth: { GoogleAuth: function () { return {}; } },
      sheets: () => ({
        spreadsheets: {
          values: {
            get: async () => {
              if (failWith) { const e = new Error(failWith); throw e; }
              return { data: { values: rows } };
            },
          },
        },
      }),
    },
  };
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'googleapis') return googleapis;
    return origLoad.call(this, request, parent, isMain);
  };
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{"client_email":"t@t.iam.gserviceaccount.com","private_key":"x"}';
  const sheets = require(SHEETS_PATH);
  Module._load = origLoad;
  return sheets;
}

async function run() {
  let pass = 0;
  const t = async (name, fn) => { await fn(); pass++; console.log('ok -', name); };

  await t('groups rows into weeks oldest-first', async () => {
    const sheets = loadSheetsWith(WEEKS_ROWS);
    const { weeks } = await sheets.getWeeklyArchive();
    assert.strictEqual(weeks.length, 2);
    assert.strictEqual(weeks[0].week, 1);
    assert.strictEqual(weeks[1].week, 2);
    assert.strictEqual(weeks[0].start, '2026-09-14');
    assert.strictEqual(weeks[0].end, '2026-09-20');
  });

  await t('profiles and works separated and rank-sorted', async () => {
    const sheets = loadSheetsWith(WEEKS_ROWS);
    const { weeks } = await sheets.getWeeklyArchive();
    const w1 = weeks[0];
    assert.strictEqual(w1.profiles.length, 2);
    assert.strictEqual(w1.profiles[0].name, 'Asha');
    assert.deepStrictEqual(w1.profiles[0].skills, ['Go', 'SQL']);
    assert.strictEqual(w1.works.length, 1);
    assert.strictEqual(w1.works[0].title, 'App');
    assert.strictEqual(w1.works[0].platform, 'GitHub');
  });

  await t('totals computed per week', async () => {
    const sheets = loadSheetsWith(WEEKS_ROWS);
    const { weeks } = await sheets.getWeeklyArchive();
    assert.strictEqual(weeks[0].profileCount, 2);
    assert.strictEqual(weeks[0].workCount, 1);
    assert.strictEqual(weeks[0].revenue, 900);
    assert.strictEqual(weeks[1].revenue, 900);
  });

  await t('junk rows skipped', async () => {
    const sheets = loadSheetsWith(WEEKS_ROWS);
    const { weeks } = await sheets.getWeeklyArchive();
    assert.strictEqual(weeks.length, 2);
  });

  await t('missing archive tab returns empty weeks', async () => {
    const sheets = loadSheetsWith(null, 'Unable to parse range: Weekly Archive');
    const { weeks } = await sheets.getWeeklyArchive();
    assert.deepStrictEqual(weeks, []);
  });

  await t('top-10 cap per board', async () => {
    const rows = [WEEKS_ROWS[0]];
    for (let i = 1; i <= 15; i++) {
      rows.push([1, '2026-09-14', '2026-09-20', 'profiles', i, 'P' + i, '', '', '', '', '', 1000 - i]);
    }
    const sheets = loadSheetsWith(rows);
    const { weeks } = await sheets.getWeeklyArchive();
    assert.strictEqual(weeks[0].profiles.length, 10);
    assert.strictEqual(weeks[0].profileCount, 15);
    assert.strictEqual(weeks[0].profiles[0].name, 'P1');
  });

  console.log(`\n${pass}/6 weekly-archive tests passed`);
}

run().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
