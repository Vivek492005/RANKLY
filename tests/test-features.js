'use strict';
// Tests for the 5 new features: Snipe Hour, Week Replay, Head-to-Head Duels,
// Verified Proof Badges, College Clash (+ /api/leaderboard switch on both pages).
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('/home/hatch/.tmp-jsdom/node_modules/jsdom');

const APP = path.resolve(__dirname, '../vercel-app');

const BOARD_PAYLOAD = {
  profiles: [
    { rank: 1, name: 'Asha', headline: 'Dev', college: 'IIT Bombay', skills: ['JS'], linkedin: '', github: '', coding: '', bid: 500, clicks: 10, age: 'now', key: 'name:asha',
      verified: { gh_user: 'asha-dev', gh_stars: 1200, gh_repos: 34, lc_user: 'asha', lc_solved: 450, lc_rating: 1845 } },
    { rank: 2, name: 'Ravi', headline: 'ML', college: 'IIT Bombay', skills: [], linkedin: '', github: '', coding: '', bid: 300, clicks: 5, age: 'now', key: 'name:ravi', verified: null },
    { rank: 3, name: 'Zed', headline: 'Design', college: 'NID', skills: [], linkedin: '', github: '', coding: '', bid: 100, clicks: 2, age: 'now', key: 'name:zed', verified: null },
  ],
  showcase: [
    { rank: 1, title: 'Cool app', creator: 'Ravi', platform: 'GitHub', link: '', description: '', bid: 300, clicks: 9, age: 'now', key: 'work:cool app' },
    { rank: 2, title: 'UI set', creator: 'Zed', platform: 'Instagram', link: '', description: '', bid: 120, clicks: 3, age: 'now', key: 'work:ui set' },
  ],
  activity: [{ time: '10:00', name: 'Asha', action: 'bid ₹500' }],
  stats: { visitors: 42, revenue: 900, profiles: 3 },
  snipe: { resetAt: new Date(Date.now() + 30 * 60000).toISOString(), endsAt: null, active: true, overtime: false },
};

const DUELS_PAYLOAD = { duels: [{
  id: 'd1', challenger: 'Asha', challengerKey: 'name:asha', opponent: 'Ravi', opponentKey: 'name:ravi',
  cStart: 400, oStart: 250, ends: '2099-01-01 00:00:00', status: 'active', winner: '',
}] };

const SNAPS = { days: [
  { date: '2026-09-20', profiles: [{ name: 'Asha', bid: 100 }, { name: 'Ravi', bid: 200 }], showcase: [] },
  { date: '2026-09-21', profiles: [{ name: 'Asha', bid: 500 }, { name: 'Ravi', bid: 300 }], showcase: [{ name: 'Cool app', bid: 300 }] },
] };

function buildDom(pageFile, opts = {}) {
  const pageSrc = fs.readFileSync(path.join(APP, pageFile), 'utf8');
  const sharedSrc = fs.readFileSync(path.join(APP, 'shared.js'), 'utf8');
  let html = pageSrc
  for (const tag of ['<script src="shared.js" defer></script>', '<script src="shared.js"></script>']) {
    html = html.replace(tag, `<script>${sharedSrc.replace(/<\/script>/g, '<\\/script>')}</script>`);
  }
  const calls = [];
  return new JSDOM(html, {
    url: 'https://localhost/', runScripts: 'dangerously',
    beforeParse(window) {
      window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
      window.HTMLDialogElement.prototype.close = function () {
        this.removeAttribute('open');
        this.dispatchEvent(new window.Event('close'));
      };
      window.Element.prototype.scrollIntoView = function () {};
      window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
      window.fetch = async (url, init = {}) => {
        const u = String(url);
        calls.push({ url: u, method: init.method || 'GET', body: init.body });
        if (u.includes('/api/leaderboard')) {
          const p = JSON.parse(JSON.stringify(BOARD_PAYLOAD));
          if (opts.farReset) p.snipe = { resetAt: new Date(Date.now() + 48 * 3600000).toISOString(), endsAt: null, active: false, overtime: false };
          return { ok: true, json: async () => p };
        }
        if (u.includes('/api/duels')) {
          if ((init.method || 'GET') === 'POST') {
            const b = JSON.parse(init.body);
            assert.ok(b.challengerKey && b.opponentKey, 'duel POST carries both keys');
            assert.notStrictEqual(b.challengerKey, b.opponentKey, 'challenger != opponent');
            return { ok: true, json: async () => ({ ok: true, duel: { id: 'd9' } }) };
          }
          return { ok: true, json: async () => (opts.noDuels ? { duels: [] } : DUELS_PAYLOAD) };
        }
        if (u.includes('/api/weeks')) return { ok: true, json: async () => ({ weeks: [] }) };
        if (u.includes('/api/snapshots')) return { ok: true, json: async () => SNAPS };
        if (u.includes('/api/config')) return { ok: true, json: async () => ({ mode: 'upi-manual', sheetsConfigured: true, upiId: 'sochai@ptyes' }) };
        return { ok: false, status: 404, text: async () => '' };
      };
      window.__calls = calls;
    },
  });
}

const flush = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const $ = (dom, sel) => dom.window.document.querySelector(sel);
const $$ = (dom, sel) => [...dom.window.document.querySelectorAll(sel)];

async function run() {
  let pass = 0;
  const t = async (name, fn) => { await fn(); pass++; console.log('ok -', name); };

  await t('profiles board loads from /api/leaderboard first', async () => {
    const dom = buildDom('index.html');
    await flush();
    assert.ok(dom.window.__calls.some(c => c.url.includes('/api/leaderboard')), 'leaderboard API called');
    const rows = $$ (dom, '#leaderboard .rank-row');
    assert.strictEqual(rows.length, 3, '3 rows rendered, got ' + rows.length);
    assert.ok(rows[0].textContent.includes('Asha'), 'first row is Asha');
    dom.window.close();
  });

  await t('snipe banner is live when reset is within the hour', async () => {
    const dom = buildDom('index.html');
    await flush();
    const b = $(dom, '#snipeBanner');
    assert.ok(!b.hidden, 'banner visible');
    assert.match(b.textContent, /SNIPE HOUR/, 'banner text: ' + b.textContent.trim().slice(0, 60));
    dom.window.close();
  });

  await t('snipe banner stays hidden far from reset', async () => {
    const dom = buildDom('index.html', { farReset: true });
    await flush();
    const b = dom.window.document.getElementById('snipeBanner');
    assert.ok(b.hidden, 'banner hidden');
    dom.window.close();
  });

  await t('verified chips render from payload', async () => {
    const dom = buildDom('index.html');
    await flush();
    const chips = $$ (dom, '#leaderboard .verify-chip');
    assert.ok(chips.length >= 2, 'chips rendered: ' + chips.length);
    const text = chips.map(c => c.textContent).join(' ');
    assert.match(text, /stars/, 'github chip: ' + text);
    assert.match(text, /solved/, 'leetcode chip');
    assert.match(text, /contest/, 'contest rating chip');
    dom.window.close();
  });

  await t('college clash renders sorted standings and filters', async () => {
    const dom = buildDom('index.html');
    await flush();
    const sec = dom.window.document.getElementById('collegeClash');
    assert.ok(!sec.hidden, 'clash section visible');
    const rows = $$ (dom, '.clash-row');
    assert.strictEqual(rows.length, 2, '2 colleges');
    assert.ok(rows[0].textContent.includes('IIT Bombay'), 'top college first');
    assert.ok(rows[0].textContent.includes('₹800'), 'IIT total = 500+300: ' + rows[0].textContent);
    rows[1].click();
    await flush();
    const shown = $$ (dom, '#leaderboard .rank-row');
    assert.strictEqual(shown.length, 1, 'filter to NID shows 1 row');
    assert.ok(shown[0].textContent.includes('Zed'));
    dom.window.close();
  });

  await t('duel arena renders live duel with bars', async () => {
    const dom = buildDom('index.html');
    await flush();
    const sec = dom.window.document.getElementById('duelArena');
    assert.ok(!sec.hidden, 'arena visible');
    const c = dom.window.document.querySelector('.duel-card');
    assert.ok(c, 'duel card');
    assert.ok(c.textContent.includes('Asha') && c.textContent.includes('Ravi'));
    assert.match(c.textContent, /left/, 'countdown text');
    dom.window.close();
  });

  await t('duel arena hidden when no duels', async () => {
    const dom = buildDom('index.html', { noDuels: true });
    await flush();
    assert.ok(dom.window.document.getElementById('duelArena').hidden, 'arena hidden');
    dom.window.close();
  });

  await t('duel button opens dialog and creates duel', async () => {
    const dom = buildDom('index.html');
    await flush();
    const btn = dom.window.document.querySelector('[data-duel-key="name:ravi"]');
    assert.ok(btn, 'duel button on Ravi row');
    btn.click();
    await flush();
    const dlg = dom.window.document.getElementById('duelDialog');
    assert.ok(dlg.hasAttribute('open'), 'dialog open');
    assert.ok(dom.window.document.getElementById('duelOpponent').textContent.includes('Ravi'));
    const opts = [...dom.window.document.querySelectorAll('#duelChallenger option')];
    assert.ok(opts.some(o => o.disabled), 'opponent disabled as challenger choice');
    dom.window.document.getElementById('duelForm').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await flush();
    const post = dom.window.__calls.find(c => c.url.includes('/api/duels') && c.method === 'POST');
    assert.ok(post, 'POST /api/duels sent');
    assert.ok(!dlg.hasAttribute('open'), 'dialog closed after create');
    dom.window.close();
  });

  await t('showcase page: snipe banner + duel arena from API', async () => {
    const dom = buildDom('showcase.html');
    await flush();
    assert.ok(!dom.window.document.getElementById('snipeBanner').hidden, 'showcase snipe banner live');
    assert.ok(!dom.window.document.getElementById('duelArena').hidden, 'showcase arena visible');
    const rows = $$ (dom, '#leaderboard .rank-row');
    assert.strictEqual(rows.length, 2, '2 showcase rows');
    assert.ok(rows[0].dataset.key === 'work:cool app', 'row has key');
    dom.window.close();
  });

  await t('replay page renders race from snapshots and scrubs', async () => {
    const dom = buildDom('replay.html');
    await flush(20);
    const rows = $$ (dom, '.race-row');
    assert.strictEqual(rows.length, 2, '2 race rows on latest day');
    assert.ok(rows[0].textContent.includes('Asha'), 'Asha leads on day 2');
    const label = dom.window.document.getElementById('dayLabel').textContent;
    assert.match(label, /Day 2\/2/, 'day label: ' + label);
    const scrub = dom.window.document.getElementById('dayScrub');
    dom.window.document.getElementById('playBtn').click(); // stop autoplay
    scrub.value = '0';
    scrub.dispatchEvent(new dom.window.Event('input'));
    const rows0 = $$ (dom, '.race-row');
    assert.ok(rows0[0].textContent.includes('Ravi'), 'Ravi leads on day 1, got: ' + rows0[0].textContent.trim().slice(0, 40));
    dom.window.close();
  });

  await t('replay page switches boards', async () => {
    const dom = buildDom('replay.html');
    await flush(20);
    dom.window.document.querySelector('[data-board="showcase"]').click();
    await flush();
    const rows = $$ (dom, '.race-row');
    assert.strictEqual(rows.length, 1, '1 showcase entry');
    assert.ok(rows[0].textContent.includes('Cool app'));
    dom.window.close();
  });

  console.log(`\n${pass} feature tests passed`);
}

run().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
