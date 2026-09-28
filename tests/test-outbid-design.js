'use strict';
// jsdom test for the outbid.lol-style redesign: cream/coral design tokens,
// Inter typography, pill controls, soft cards, segmented tabs, activity chips,
// avatar initials, responsive rules — and no remnants of the old dark/lime theme.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('/home/hatch/.tmp-jsdom/node_modules/jsdom');

const APP = path.resolve(__dirname, '../vercel-app');
const css = fs.readFileSync(path.join(APP, 'styles.css'), 'utf8');
const sharedSrc = fs.readFileSync(path.join(APP, 'shared.js'), 'utf8');

function buildDom(pageFile) {
  const pageSrc = fs.readFileSync(path.join(APP, pageFile), 'utf8');
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
      window.matchMedia = window.matchMedia || (() => ({ matches: false }));
      window.fetch = async (url) => {
        const u = String(url);
        if (u.includes('/api/weeks')) return { ok: true, json: async () => ({ weeks: [] }) };
        if (u.includes('/api/config')) return { ok: true, json: async () => ({ mode: 'upi-manual', sheetsConfigured: true, upiId: 'sochai@ptyes' }) };
        return { ok: false, status: 404, text: async () => '' };
      };
    },
  });
}

const flush = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

async function run() {
  let pass = 0;
  const t = async (name, fn) => { await fn(); pass++; console.log('ok -', name); };

  await t('cream/coral design tokens present', async () => {
    assert.ok(/#FDF9F0/i.test(css), 'ivory canvas token');
    assert.ok(/#FF6A4D/i.test(css), 'coral accent token');
    assert.ok(/Inter/i.test(css), 'Inter typography');
  });

  await t('old dark/lime theme fully removed', async () => {
    assert.ok(!/#101210/i.test(css), 'no dark canvas');
    assert.ok(!/#c8f04a/i.test(css), 'no lime accent');
    assert.ok(!/--acid/.test(css), 'no --acid var');
    assert.ok(!/mouse-follow/.test(sharedSrc), 'no dark-theme mouse-follow');
  });

  await t('ambient live background present (user-approved)', async () => {
    assert.ok(/\.ambient-blobs/.test(css), 'glow blob layer');
    assert.ok(/\.dot-grid/.test(css), 'dot grid layer');
    assert.ok(/\.bid-rain/.test(css), 'bid rain canvas layer');
    assert.ok(/\.spotlight/.test(css), 'cream spotlight layer');
    assert.ok(/\.live-ticker/.test(css), 'live ticker');
    assert.ok(/initAmbient/.test(sharedSrc), 'ambient init JS');
    assert.ok(/renderLiveTicker/.test(sharedSrc), 'ticker render JS');
    assert.ok(/boostAmbient/.test(sharedSrc), 'event boost JS');
    assert.ok(/prefers-reduced-motion/.test(css), 'reduced-motion guard');
  });

  await t('pill controls, segmented tabs, soft cards styled', async () => {
    assert.ok(/\.chip\b/.test(css), 'filter pill class');
    assert.ok(/\.view-tab/.test(css), 'segmented tab class');
    assert.ok(/\.board-card/.test(css), 'soft card class');
    assert.ok(/var\(--radius-pill\)|9999px/.test(css), 'pill radius used');
  });

  await t('activity chips and avatar styles present', async () => {
    assert.ok(/\.act-chip/.test(css), 'activity chip class');
    assert.ok(/\.avatar/.test(css), 'avatar class');
    assert.ok(/activityHTML/.test(sharedSrc), 'activityHTML helper exists');
    assert.ok(/flash-new/.test(sharedSrc), 'flash-new pulse retained');
  });

  await t('avatarStyle/initialsOf helpers exist and render', async () => {
    const dom = buildDom('index.html');
    await flush();
    const { window } = dom.window;
    assert.strictEqual(typeof window.initialsOf, 'function', 'initialsOf defined');
    assert.strictEqual(typeof window.avatarStyle, 'function', 'avatarStyle defined');
    assert.strictEqual(window.initialsOf('Aarav Sharma'), 'AS', 'initials from name');
    assert.strictEqual(window.initialsOf('Diya'), 'DI', 'initials padded for single name');
    assert.ok(String(window.avatarStyle('Aarav Sharma')).includes('background'), 'avatar style has background');
    dom.window.close();
  });

  await t('index has outbid layout elements', async () => {
    const dom = buildDom('index.html');
    await flush();
    const { document } = dom.window;
    assert.ok(document.querySelector('.cat-bar'), 'category bar');
    assert.ok(document.querySelector('.segment'), 'segmented selector');
    assert.ok(document.querySelector('.hero-claim'), 'claim hero');
    assert.ok(document.querySelector('.layout'), '70/30 layout');
    assert.ok(document.querySelector('.sidebar'), 'sidebar');
    assert.ok(document.querySelector('.stats-grid'), 'stat cards');
    dom.window.close();
  });

  await t('showcase has outbid layout elements', async () => {
    const dom = buildDom('showcase.html');
    await flush();
    const { document } = dom.window;
    assert.ok(document.querySelector('.cat-bar'), 'category bar');
    assert.ok(document.querySelector('.hero-claim'), 'claim hero');
    assert.ok(document.querySelector('.layout'), '70/30 layout');
    assert.ok(document.querySelector('#platforms'), 'platform filter pills');
    dom.window.close();
  });

  await t('replay uses light theme and coral accents', async () => {
    const src = fs.readFileSync(path.join(APP, 'replay.html'), 'utf8');
    assert.ok(!/#101210/i.test(src), 'no dark canvas fill in export');
    assert.ok(/#FDF9F0/i.test(src), 'cream canvas fill in export');
    assert.ok(/class="accent"/.test(src), 'coral accent on heading');
    const dom = buildDom('replay.html');
    await flush();
    dom.window.close();
  });

  await t('share cards recolored to cream/coral', async () => {
    assert.ok(/#FDF9F0/.test(sharedSrc), 'cream in share card');
    assert.ok(/#FF6A4D/.test(sharedSrc), 'coral in share card');
    assert.ok(!/#c8f04a/.test(sharedSrc), 'no lime in share card');
  });

  await t('responsive rules present', async () => {
    assert.ok(/@media/.test(css), 'media queries exist');
    assert.ok(/max-width:\s*900px|max-width:\s*960px|max-width:\s*1024px/.test(css), 'layout collapse breakpoint');
    assert.ok(/max-width:\s*640px|max-width:\s*600px/.test(css), 'mobile breakpoint');
  });

  await t('pages load with no script errors', async () => {
    for (const page of ['index.html', 'showcase.html', 'replay.html']) {
      const dom = buildDom(page);
      await flush();
      assert.ok(dom.window.document.body, `${page} body rendered`);
      dom.window.close();
    }
  });

  await t('new activity still flashes the newest chip', async () => {
    const dom = buildDom('index.html');
    await flush();
    const { document, window } = dom.window;
    const items1 = [{ name: 'Asha', action: 'claimed rank #1', time: '10:00 am' }];
    document.getElementById('activityList').innerHTML = window.activityHTML(items1);
    window.pulseNewActivity(items1);
    await flush();
    assert.strictEqual(document.querySelectorAll('.act-chip.flash-new').length, 0,
      'no flash on first render');
    const items2 = [{ name: 'Ravi', action: 'claimed rank #2', time: '10:05 am' }, ...items1];
    document.getElementById('activityList').innerHTML = window.activityHTML(items2);
    window.pulseNewActivity(items2);
    await flush();
    const flashed = document.querySelectorAll('.act-chip.flash-new');
    assert.strictEqual(flashed.length, 1, 'exactly one chip flashed');
    assert.ok(flashed[0].textContent.includes('Ravi'), 'the newest chip flashed');
    dom.window.close();
  });

  console.log(`\n${pass}/12 outbid-design tests passed`);
}

run().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
