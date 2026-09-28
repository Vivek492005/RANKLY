'use strict';
// Handler tests for GET /api/weeks (previous weekly rankings).
// Mocks ../lib/sheets via require-cache injection; no network, no Google.
const path = require('path');
const assert = require('assert');

const SHEETS_PATH = path.resolve(__dirname, '../vercel-app/lib/sheets.js');
const HANDLER_PATH = path.resolve(__dirname, '../vercel-app/api/weeks.js');

function mockSheets(impl) {
  delete require.cache[HANDLER_PATH];
  require.cache[SHEETS_PATH] = {
    id: SHEETS_PATH, filename: SHEETS_PATH, loaded: true,
    exports: { getWeeklyArchive: impl },
  };
  return require(HANDLER_PATH);
}

function mockRes() {
  return {
    code: null, body: null,
    status(c) { this.code = c; return this; },
    json(o) { this.body = o; return this; },
    setHeader() {}, end() {},
  };
}

function sampleArchive() {
  return {
    weeks: [
      { week: 1, start: '2026-09-14', end: '2026-09-20',
        profiles: [{ rank: 1, name: 'Asha', headline: 'Dev', college: 'IIT', skills: ['Go'], bid: 500 }],
        works: [{ rank: 1, title: 'App', creator: 'Asha', platform: 'GitHub', link: 'https://x', bid: 100 }],
        profileCount: 1, workCount: 1, revenue: 600 },
      { week: 2, start: '2026-09-21', end: '2026-09-27',
        profiles: [{ rank: 1, name: 'Ravi', headline: 'ML', college: '', skills: [], bid: 900 }],
        works: [],
        profileCount: 1, workCount: 0, revenue: 900 },
    ],
  };
}

async function run() {
  let pass = 0;
  const t = async (name, fn) => { await fn(); pass++; console.log('ok -', name); };

  await t('GET returns weeks oldest-first', async () => {
    const h = mockSheets(async () => sampleArchive());
    const res = mockRes();
    await h({ method: 'GET', query: {} }, res);
    assert.strictEqual(res.code, 200);
    assert.strictEqual(res.body.weeks.length, 2);
    assert.strictEqual(res.body.weeks[0].week, 1);
    assert.strictEqual(res.body.weeks[1].week, 2);
  });

  await t('profiles and works separated with counts', async () => {
    const h = mockSheets(async () => sampleArchive());
    const res = mockRes();
    await h({ method: 'GET', query: {} }, res);
    const w1 = res.body.weeks[0];
    assert.strictEqual(w1.profiles[0].name, 'Asha');
    assert.strictEqual(w1.works[0].title, 'App');
    assert.strictEqual(w1.profileCount, 1);
    assert.strictEqual(w1.revenue, 600);
  });

  await t('empty archive returns empty weeks', async () => {
    const h = mockSheets(async () => ({ weeks: [] }));
    const res = mockRes();
    await h({ method: 'GET', query: {} }, res);
    assert.strictEqual(res.code, 200);
    assert.deepStrictEqual(res.body, { weeks: [] });
  });

  await t('non-GET returns 405', async () => {
    const h = mockSheets(async () => { throw new Error('should not be called'); });
    const res = mockRes();
    await h({ method: 'POST', query: {} }, res);
    assert.strictEqual(res.code, 405);
    assert.ok(res.body.error);
  });

  await t('sheets failure returns 500 without leaking internals', async () => {
    const h = mockSheets(async () => { throw new Error('invalid_grant: boom'); });
    const res = mockRes();
    await h({ method: 'GET', query: {} }, res);
    assert.strictEqual(res.code, 500);
    assert.strictEqual(res.body.error, 'Could not load previous weeks.');
  });

  console.log(`\n${pass}/5 weeks-api tests passed`);
}

run().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
