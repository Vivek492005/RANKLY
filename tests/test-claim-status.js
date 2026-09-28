'use strict';
// Handler tests for GET /api/claim-status (live payment-status polling).
// Mocks ../lib/sheets via require-cache injection; no network, no Google.
const path = require('path');
const assert = require('assert');

const SHEETS_PATH = path.resolve(__dirname, '../vercel-app/lib/sheets.js');
const HANDLER_PATH = path.resolve(__dirname, '../vercel-app/api/claim-status.js');

function mockSheets(impl) {
  delete require.cache[HANDLER_PATH];
  require.cache[SHEETS_PATH] = {
    id: SHEETS_PATH, filename: SHEETS_PATH, loaded: true,
    exports: { findClaimByUtr: impl },
  };
  return require(HANDLER_PATH);
}

function mockRes() {
  return {
    code: null, body: null,
    status(c) { this.code = c; return this; },
    json(o) { this.body = o; return this; },
  };
}

async function run() {
  let pass = 0;
  const t = async (name, fn) => { await fn(); pass++; console.log('ok -', name); };

  await t('applied claim returns status + rank', async () => {
    const h = mockSheets(async () => ({ board: 'profiles', name: 'Asha', bid: 50, rank: '2', status: 'applied' }));
    const res = mockRes();
    await h({ method: 'GET', query: { utr: 'ABC123456' } }, res);
    assert.strictEqual(res.code, 200);
    assert.deepStrictEqual(res.body, { found: true, status: 'applied', rank: '2', board: 'profiles', name: 'Asha' });
  });

  await t('awaiting claim returns null rank', async () => {
    const h = mockSheets(async () => ({ board: 'showcase', name: 'Cool App', bid: 10, rank: '', status: 'awaiting verification' }));
    const res = mockRes();
    await h({ method: 'GET', query: { utr: 'XYZ999' } }, res);
    assert.strictEqual(res.code, 200);
    assert.strictEqual(res.body.found, true);
    assert.strictEqual(res.body.status, 'awaiting verification');
    assert.strictEqual(res.body.rank, null);
  });

  await t('unknown UTR returns found:false', async () => {
    const h = mockSheets(async () => null);
    const res = mockRes();
    await h({ method: 'GET', query: { utr: 'NOPE123456' } }, res);
    assert.strictEqual(res.code, 200);
    assert.deepStrictEqual(res.body, { found: false });
  });

  await t('bad UTR returns 400', async () => {
    const h = mockSheets(async () => { throw new Error('should not be called'); });
    const res = mockRes();
    await h({ method: 'GET', query: { utr: '!!!' } }, res);
    assert.strictEqual(res.code, 400);
  });

  await t('POST returns 405', async () => {
    const h = mockSheets(async () => null);
    const res = mockRes();
    await h({ method: 'POST', query: { utr: 'ABC123456' } }, res);
    assert.strictEqual(res.code, 405);
  });

  await t('sheets failure returns 500', async () => {
    const h = mockSheets(async () => { throw new Error('boom'); });
    const res = mockRes();
    await h({ method: 'GET', query: { utr: 'ABC123456' } }, res);
    assert.strictEqual(res.code, 500);
  });

  delete require.cache[SHEETS_PATH];
  delete require.cache[HANDLER_PATH];
  console.log(`\n${pass}/6 claim-status tests passed`);
}

run().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
