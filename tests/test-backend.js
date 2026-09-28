'use strict';
// Backend unit tests for the 5 new features: hashed identity keys (privacy),
// snipeState timing, and the minimum-increment rule.
const assert = require('assert');
const crypto = require('crypto');
const sheets = require('../vercel-app/lib/sheets');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('ok -', name); };

// ---------- Hashed identity keys (no raw emails in public payloads) ----------
t('email keys are hashed, deterministic, case-insensitive', () => {
  const a = sheets.profileKeyOf({ email: 'User@Example.com', name: 'X' });
  const b = sheets.profileKeyOf({ email: 'user@example.com', name: 'Y' });
  assert.strictEqual(a, b);
  assert.match(a, /^id:[0-9a-f]{16}$/, 'key: ' + a);
  assert.ok(!a.includes('user@example.com'), 'no raw email in key');
});

t('hash matches Python hashlib.sha256(email)[:16]', () => {
  const expected = crypto.createHash('sha256').update('sochai.hr@gmail.com').digest('hex').slice(0, 16);
  assert.strictEqual(sheets.hashEmail('Sochai.HR@Gmail.com'), expected);
});

t('canonicalKey folds legacy email: keys', () => {
  const viaLegacy = sheets.canonicalKey('email:User@Example.com');
  const viaNew = sheets.profileKeyOf({ email: 'user@example.com' });
  assert.strictEqual(viaLegacy, viaNew);
  assert.strictEqual(sheets.canonicalKey('li:https://x'), 'li:https://x');
  assert.strictEqual(sheets.canonicalKey('name:asha'), 'name:asha');
});

t('profileIdentityKey hashes row emails', () => {
  const row = ['', 'Asha', 'Dev', 'IIT', '', '', '', '', 'Asha@Mail.com', '500', '1', 'now'];
  const k = sheets.profileIdentityKey(row);
  assert.match(k, /^id:[0-9a-f]{16}$/, 'row key: ' + k);
  assert.strictEqual(k, sheets.profileKeyOf({ email: 'asha@mail.com' }));
});

t('non-email keys pass through (public-safe)', () => {
  assert.strictEqual(sheets.profileKeyOf({ linkedin: 'https://linkedin.com/in/asha', name: 'Asha' }), 'li:https://linkedin.com/in/asha');
  assert.strictEqual(sheets.profileKeyOf({ name: 'Asha' }), 'name:asha');
  assert.strictEqual(sheets.workIdentityKey('Cool App'), 'work:cool app');
});

// ---------- snipeState timing ----------
const IST = '+05:30';
const ms = (s) => new Date(s).getTime();

t('snipe is live 25 min before Sunday 00:05 IST', () => {
  const v = sheets.snipeState(ms(`2026-09-26T23:40:00${IST}`));
  assert.strictEqual(v.active, true);
  assert.strictEqual(v.overtime, false);
  assert.ok(new Date(v.resetAt).getTime() > ms(`2026-09-26T23:40:00${IST}`), 'resetAt in future');
});

t('overtime 10 min after Sunday 00:05 IST reset', () => {
  const v = sheets.snipeState(ms(`2026-09-27T00:10:00${IST}`));
  assert.strictEqual(v.active, true, JSON.stringify(v));
  assert.strictEqual(v.overtime, true);
  assert.ok(new Date(v.resetAt).getTime() <= ms(`2026-09-27T00:10:00${IST}`), 'resetAt is the past reset');
});

t('overtime window matches the reset script cap (15 min)', () => {
  const on = sheets.snipeState(ms(`2026-09-27T00:14:00${IST}`));
  assert.strictEqual(on.active, true);
  assert.strictEqual(on.overtime, true);
  const off = sheets.snipeState(ms(`2026-09-27T00:21:00${IST}`));
  assert.strictEqual(off.active, false);
  assert.strictEqual(off.overtime, false);
});

t('idle on a Wednesday afternoon', () => {
  const v = sheets.snipeState(ms(`2026-09-23T12:00:00${IST}`));
  assert.strictEqual(v.active, false);
  assert.strictEqual(v.overtime, false);
});

t('nextResetAt lands on Sunday 00:05 IST in the future', () => {
  const r = sheets.nextResetAt(ms(`2026-09-23T12:00:00${IST}`));
  assert.ok(r > ms(`2026-09-23T12:00:00${IST}`), 'in future');
  assert.strictEqual(r, ms(`2026-09-27T00:05:00${IST}`), 'next Sunday 00:05 IST: ' + new Date(r).toISOString());
  // Exactly at reset time -> jumps to the following Sunday.
  assert.strictEqual(
    sheets.nextResetAt(ms(`2026-09-27T00:05:00${IST}`)),
    ms(`2026-10-04T00:05:00${IST}`));
});

// ---------- Minimum-increment rule ----------
t('re-bid: equal, lower, and +1..+9 rejected; +10 accepted', () => {
  const ctx = { topBid: 500, existingBid: 400 };
  assert.ok(sheets.incrementError(ctx, 400), 'equal rejected');
  assert.ok(sheets.incrementError(ctx, 350), 'lower rejected');
  for (let b = 401; b <= 409; b++) assert.ok(sheets.incrementError(ctx, b), `+${b - 400} rejected`);
  assert.strictEqual(sheets.incrementError(ctx, 410), null, 'exactly +10 accepted');
  assert.strictEqual(sheets.incrementError(ctx, 600), null, '+200 accepted');
});

t('new bid: below/equal top fine; +1..+9 over top rejected; +10 accepted', () => {
  const ctx = { topBid: 500, existingBid: null };
  assert.strictEqual(sheets.incrementError(ctx, 100), null, 'below top ok');
  assert.strictEqual(sheets.incrementError(ctx, 500), null, 'equal to top ok (no #1 take)');
  for (let b = 501; b <= 509; b++) assert.ok(sheets.incrementError(ctx, b), `top+${b - 500} rejected`);
  assert.strictEqual(sheets.incrementError(ctx, 510), null, 'top+10 accepted');
  assert.strictEqual(sheets.incrementError(ctx, 999), null, 'top+499 accepted');
});

t('empty board: any valid bid accepted', () => {
  assert.strictEqual(sheets.incrementError({ topBid: 0, existingBid: null }, 1), null);
});

console.log(`\n${pass} backend tests passed`);
