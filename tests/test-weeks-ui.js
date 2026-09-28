'use strict';
// jsdom test: the "Previous weeks" view-tab on index.html (profiles) and
// showcase.html (works) renders week pills + top rankers from /api/weeks,
// switches weeks on pill click, and hides the search toolbar in weeks mode.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('/home/hatch/.tmp-jsdom/node_modules/jsdom');

const APP = path.resolve(__dirname, '../vercel-app');

const WEEKS_PAYLOAD = {
  weeks: [
    { week: 1, start: '2026-09-14', end: '2026-09-20',
      profiles: [{ rank: 1, name: 'Asha', headline: 'Dev', college: 'IIT', skills: ['Go'], bid: 500 }],
      works: [{ rank: 1, title: 'Old App', creator: 'Asha', platform: 'GitHub', link: 'https://x', bid: 100 }],
      profileCount: 1, workCount: 1, revenue: 600 },
    { week: 2, start: '2026-09-21', end: '2026-09-27',
      profiles: [
        { rank: 1, name: 'Ravi', headline: 'ML', college: 'NIT', skills: ['Python'], bid: 900 },
        { rank: 2, name: 'Meera', headline: 'Web', college: '', skills: [], bid: 400 },
      ],
      works: [],
      profileCount: 2, workCount: 0, revenue: 1300 },
  ],
};

function buildDom(pageFile) {
  const pageSrc = fs.readFileSync(path.join(APP, pageFile), 'utf8');
  const sharedSrc = fs.readFileSync(path.join(APP, 'shared.js'), 'utf8');
  const html = pageSrc.replace('<script src="shared.js"></script>',
    `<script>${sharedSrc.replace(/<\/script>/g, '<\\/script>')}</script>`);
  const dom = new JSDOM(html, {
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
        if (u.includes('/api/weeks')) return { ok: true, json: async () => WEEKS_PAYLOAD };
        if (u.includes('/api/config')) return { ok: true, json: async () => ({ mode: 'upi-manual', sheetsConfigured: true, upiId: 'sochai@ptyes' }) };
        return { ok: false, status: 404, text: async () => '' };
      };
    },
  });
  return dom;
}

const flush = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

function clickWeeksTab(document, window) {
  const btn = [...document.querySelectorAll('.view-tab')].find((b) => b.dataset.view === 'weeks');
  assert.ok(btn, 'Previous weeks tab exists');
  btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

async function run() {
  let pass = 0;
  const t = async (name, fn) => { await fn(); pass++; console.log('ok -', name); };

  await t('index: weeks tab renders week pills and latest week rankers', async () => {
    const dom = buildDom('index.html');
    await flush();
    const { document, window } = dom.window;
    clickWeeksTab(document, window);
    await flush();
    const pills = document.querySelectorAll('.week-pill');
    assert.strictEqual(pills.length, 2);
    assert.strictEqual(pills[0].textContent.trim(), 'Week 1');
    assert.strictEqual(pills[1].textContent.trim(), 'Week 2');
    // latest week (2) selected by default
    assert.strictEqual(pills[1].getAttribute('aria-pressed'), 'true');
    const rows = document.querySelectorAll('#weeksList .rank-row');
    assert.strictEqual(rows.length, 2);
    assert.ok(rows[0].textContent.includes('Ravi'));
    const summary = document.querySelector('.weeks-summary').textContent;
    assert.ok(summary.includes('Week 2'), 'summary names the week');
    assert.ok(summary.includes('2 profiles'), 'summary counts profiles');
    dom.window.close();
  });

  await t('index: clicking a week pill switches the rankers', async () => {
    const dom = buildDom('index.html');
    await flush();
    const { document, window } = dom.window;
    clickWeeksTab(document, window);
    await flush();
    const pills = document.querySelectorAll('.week-pill');
    pills[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await flush();
    const rows = document.querySelectorAll('#weeksList .rank-row');
    assert.strictEqual(rows.length, 1);
    assert.ok(rows[0].textContent.includes('Asha'));
    assert.ok(rows[0].textContent.includes('₹500'));
    dom.window.close();
  });

  await t('index: weeks mode hides search toolbar and pagination', async () => {
    const dom = buildDom('index.html');
    await flush();
    const { document, window } = dom.window;
    clickWeeksTab(document, window);
    await flush();
    assert.ok(document.body.classList.contains('weeks-mode'), 'weeks-mode class applied');
    dom.window.close();
  });

  await t('showcase: weeks toggle renders week pills and top works', async () => {
    const dom = buildDom('showcase.html');
    await flush();
    const { document, window } = dom.window;
    clickWeeksTab(document, window);
    await flush();
    const pills = document.querySelectorAll('.week-pill');
    assert.strictEqual(pills.length, 2);
    pills[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await flush();
    const rows = document.querySelectorAll('#weeksList .rank-row');
    assert.strictEqual(rows.length, 1);
    assert.ok(rows[0].textContent.includes('Old App'));
    assert.ok(rows[0].textContent.includes('GitHub'));
    dom.window.close();
  });

  await t('empty archive shows the no-weeks message', async () => {
    const dom = buildDom('index.html');
    await flush();
    const { document, window } = dom.window;
    // swap the weeks payload to empty before clicking
    window.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/api/weeks')) return { ok: true, json: async () => ({ weeks: [] }) };
      if (u.includes('/api/config')) return { ok: true, json: async () => ({ mode: 'upi-manual', sheetsConfigured: true, upiId: 'sochai@ptyes' }) };
      return { ok: false, status: 404, text: async () => '' };
    };
    clickWeeksTab(document, window);
    await flush();
    const empty = document.querySelector('#weeksList .empty');
    assert.ok(empty && empty.textContent.includes('No previous weeks yet'));
    dom.window.close();
  });

  console.log(`\n${pass}/5 weeks-ui tests passed`);
}

run().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
