'use strict';
// Tests for the growth features: reset countdown, share buttons, hall of fame,
// champion badges, top-bid hint, and the minimum-increment backend rule.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('/home/hatch/.tmp-jsdom/node_modules/jsdom');

const APP = path.resolve(__dirname, '../vercel-app');

function buildDom(pageFile, weeksPayload) {
  const pageSrc = fs.readFileSync(path.join(APP, pageFile), 'utf8');
  const sharedSrc = fs.readFileSync(path.join(APP, 'shared.js'), 'utf8');
  const html = pageSrc.replace('<script src="shared.js"></script>',
    `<script>${sharedSrc.replace(/<\/script>/g, '<\\/script>')}</script>`);
  return new JSDOM(html, {
    url: 'https://localhost/', runScripts: 'dangerously',
    beforeParse(window) {
      window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
      window.HTMLDialogElement.prototype.close = function () {
        this.removeAttribute('open');
        this.dispatchEvent(new window.Event('close'));
      };
      Object.defineProperty(window.HTMLDialogElement.prototype, 'open', {
        get() { return this.hasAttribute('open'); },
      });
      window.Element.prototype.scrollIntoView = function () {};
      window.fetch = async (url) => {
        const u = String(url);
        if (u.includes('/api/weeks')) return { ok: true, json: async () => weeksPayload || { weeks: [] } };
        if (u.includes('/api/config')) return { ok: true, json: async () => ({ mode: 'upi-manual', sheetsConfigured: true, upiId: 'sochai@ptyes' }) };
        if (u.includes('/api/leaderboard')) return { ok: true, json: async () => ({
          profiles: [
            { key: 'id:aaa', rank: 1, name: 'Asha', headline: 'Full-stack dev', college: 'IIT Bombay', skills: ['React'], linkedin: 'https://linkedin.com/in/asha', github: '', coding: '', bid: 450, clicks: 120, age: '2h', verified: null },
            { key: 'id:bbb', rank: 2, name: 'Ravi', headline: 'ML engineer', college: 'IIIT Hyderabad', skills: ['Python'], linkedin: '', github: 'https://github.com/ravi', coding: '', bid: 320, clicks: 98, age: '5h', verified: null },
            { key: 'id:ccc', rank: 3, name: 'Meera', headline: 'Android dev', college: 'DTU Delhi', skills: ['Kotlin'], linkedin: '', github: '', coding: 'https://leetcode.com/meera', bid: 180, clicks: 64, age: '1d', verified: null },
          ],
          showcase: [
            { key: 'work:devdash', rank: 1, title: 'DevDash', creator: 'Asha', platform: 'GitHub', link: 'https://github.com/asha/devdash', description: 'Analytics', bid: 420, clicks: 210, age: '3h' },
            { key: 'work:ui-challenge', rank: 2, title: '30 days of UI', creator: 'Ravi', platform: 'Instagram', link: 'https://instagram.com/ravi', description: 'UI series', bid: 260, clicks: 150, age: '1d' },
          ], activity: [], stats: { visitors: 10, revenue: 950, profiles: 3 },
          snipe: { resetAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 86400000).toISOString(), active: false, overtime: false },
        }) };
        if (u.includes('/api/duels')) return { ok: true, json: async () => ({ duels: [] }) };
        return { ok: false, status: 404, text: async () => '' };
      };
    },
  });
}

const flush = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const WEEKS = { weeks: [{ week: 1, start: '2026-09-14', end: '2026-09-20',
  profiles: [{ name: 'Asha', headline: 'Dev', college: 'IIT', skills: [], bid: 500, rank: 1 }],
  works: [{ title: 'Cool app', creator: 'Ravi', platform: 'GitHub', bid: 300, rank: 1 }] }] };

async function run() {
  let pass = 0;
  const t = async (name, fn) => { await fn(); pass++; console.log('ok -', name); };

  await t('countdown element renders with reset text', async () => {
    const dom = buildDom('index.html');
    await flush();
    const el = dom.window.document.getElementById('resetCountdown');
    assert.ok(el, '#resetCountdown exists');
    assert.match(el.textContent, /^Rankings reset in \d+d \d+h \d+m$/, 'countdown text: ' + el.textContent);
    dom.window.close();
  });

  await t('msUntilSundayReset hits next Sunday 00:05 IST', async () => {
    const dom = buildDom('index.html');
    await flush();
    const ms = dom.window.eval(`({
      wed: msUntilSundayReset(new Date('2026-09-23T12:00:00+05:30')),
      sunBefore: msUntilSundayReset(new Date('2026-09-27T00:04:00+05:30')),
      sunAfter: msUntilSundayReset(new Date('2026-09-27T00:06:00+05:30')),
    })`);
    assert.strictEqual(ms.wed, (3 * 24 * 60 + 12 * 60 + 5) * 60000, 'Wed 12:00 -> Sun 00:05');
    assert.strictEqual(ms.sunBefore, 60000, 'Sun 00:04 -> 1 minute');
    assert.strictEqual(ms.sunAfter, (6 * 24 * 60 + 23 * 60 + 59) * 60000, 'Sun 00:06 -> next Sun');
    dom.window.close();
  });

  await t('share buttons render on rank rows', async () => {
    const dom = buildDom('index.html');
    await flush();
    const btns = dom.window.document.querySelectorAll('.icon-btn[data-share-profile]');
    assert.ok(btns.length >= 3, `expected share buttons, got ${btns.length}`);
    assert.strictEqual(typeof dom.window.shareRankCard, 'function', 'shareRankCard defined');
    dom.window.close();
  });

  await t('hall of fame renders past champions', async () => {
    const dom = buildDom('index.html', WEEKS);
    await flush(20);
    const sec = dom.window.document.getElementById('hallOfFame');
    assert.strictEqual(sec.hidden, false, 'hall of fame visible');
    const cards = dom.window.document.querySelectorAll('.hof-card');
    assert.strictEqual(cards.length, 1, 'one champion card');
    assert.ok(cards[0].textContent.includes('Asha'), 'champion name shown');
    assert.ok(cards[0].textContent.includes('Week 1'), 'week label shown');
    dom.window.close();
  });

  await t('champion badge marks #1 in Previous weeks', async () => {
    const dom = buildDom('index.html', WEEKS);
    await flush(20);
    const tab = [...dom.window.document.querySelectorAll('.view-tab')].find(b => b.dataset.view === 'weeks');
    tab.click();
    await flush(20);
    const badge = dom.window.document.querySelector('.champion-badge');
    assert.ok(badge, 'champion badge rendered');
    assert.strictEqual(badge.textContent, 'Champion');
    dom.window.close();
  });

  await t('claim form shows top-bid hint', async () => {
    const dom = buildDom('index.html');
    await flush();
    dom.window.eval('liveLoaded = true; updateEstimate();');
    const hint = dom.window.document.getElementById('topBidHint').textContent;
    assert.ok(hint.includes('₹460'), 'hint names the +10 minimum, got: ' + hint);
    dom.window.close();
  });

  await t('showcase page has countdown + hall of fame + share', async () => {
    const dom = buildDom('showcase.html', WEEKS);
    await flush(20);
    assert.match(dom.window.document.getElementById('resetCountdown').textContent, /^Rankings reset in /);
    assert.strictEqual(dom.window.document.getElementById('hallOfFame').hidden, false);
    assert.ok(dom.window.document.querySelector('.icon-btn[data-share-work]'), 'work share button');
    dom.window.close();
  });

  await t('submit-claim rejects #1 snipes below the increment', async () => {
    const sheetsPath = require.resolve(path.join(APP, 'lib/sheets.js'));
    const handlerPath = require.resolve(path.join(APP, 'api/submit-claim.js'));
    delete require.cache[handlerPath];
    const realSheets = require(path.join(APP, 'lib/sheets.js'));
    require.cache[sheetsPath] = { id: sheetsPath, filename: sheetsPath, loaded: true,
      exports: {
        recordPendingClaim: async () => { throw new Error('should not be called'); },
        findUnmatchedPayment: async () => null,
        markPaymentMatched: async () => {},
        autoVerifyAndApply: async () => null,
        getBidContext: async () => ({ topBid: 500, existingBid: null }),
        MIN_INCREMENT: 10, incrementError: realSheets.incrementError,
      } };
    const handler = require(handlerPath);
    const base = { board: 'profiles', name: 'Asha', headline: 'Dev', linkedin: 'https://linkedin.com/in/asha', utr: 'ABCDEF123456' };
    const call = async (bid) => {
      const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; } };
      await handler({ method: 'POST', body: { ...base, bid } }, res);
      return res;
    };
    let r = await call(505);
    assert.strictEqual(r.statusCode, 400, '505 rejected');
    assert.ok(r.body.error.includes('#1'), 'mentions #1: ' + r.body.error);
    assert.ok(r.body.error.includes('₹510'), 'names the minimum: ' + r.body.error);
    delete require.cache[sheetsPath]; delete require.cache[handlerPath];
  });

  await t('submit-claim accepts clearing bids and rejects small re-bids', async () => {
    const sheetsPath = require.resolve(path.join(APP, 'lib/sheets.js'));
    const handlerPath = require.resolve(path.join(APP, 'api/submit-claim.js'));
    delete require.cache[handlerPath];
    let recorded = 0;
    const realSheets = require(path.join(APP, 'lib/sheets.js'));
    require.cache[sheetsPath] = { id: sheetsPath, filename: sheetsPath, loaded: true,
      exports: {
        recordPendingClaim: async () => { recorded++; return {}; },
        findUnmatchedPayment: async () => null,
        markPaymentMatched: async () => {},
        autoVerifyAndApply: async () => null,
        getBidContext: async () => ({ topBid: 500, existingBid: 400 }),
        MIN_INCREMENT: 10, incrementError: realSheets.incrementError,
      } };
    const handler = require(handlerPath);
    const base = { board: 'profiles', name: 'Asha', headline: 'Dev', linkedin: 'https://linkedin.com/in/asha', utr: 'ABCDEF123456' };
    const call = async (bid) => {
      const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; } };
      await handler({ method: 'POST', body: { ...base, bid } }, res);
      return res;
    };
    let r = await call(405);
    assert.strictEqual(r.statusCode, 400, '405 re-bid rejected');
    assert.ok(r.body.error.includes('₹410'), 'names re-bid minimum: ' + r.body.error);
    r = await call(410);
    assert.strictEqual(r.statusCode, 200, '410 re-bid accepted');
    assert.strictEqual(recorded, 1, 'claim recorded');
    r = await call(300);
    assert.strictEqual(r.statusCode, 400, 'lower re-bid rejected (equal/lower loophole closed)');
    delete require.cache[sheetsPath]; delete require.cache[handlerPath];
  });

  await t('getBidContext column indices match sheet headers', async () => {
    const src = fs.readFileSync(path.join(APP, 'lib/sheets.js'), 'utf8');
    const prof = src.match(/PROFILE_HEADERS = \[(.*?)\]/s)[1];
    const show = src.match(/SHOWCASE_HEADERS = \[(.*?)\]/s)[1];
    const cols = (s) => s.split(',').map(x => x.trim().replace(/['"]/g, ''));
    assert.strictEqual(cols(prof)[9], 'Bid (INR)', 'profiles bid col');
    assert.strictEqual(cols(prof)[8], 'Email', 'profiles email col');
    assert.strictEqual(cols(prof)[5], 'LinkedIn', 'profiles linkedin col');
    assert.strictEqual(cols(show)[6], 'Bid (INR)', 'showcase bid col');
    assert.strictEqual(cols(show)[4], 'Link', 'showcase link col');
  });

  console.log(`\n${pass}/10 growth tests passed`);
}

run().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
