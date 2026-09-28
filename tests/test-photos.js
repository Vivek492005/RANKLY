'use strict';
// Unit tests for optional profile photos: Blob upload validation,
// key sanitization, and the public-safe photo URL helper.
const assert = require('assert');
const photos = require('../vercel-app/lib/photos');
const sheets = require('../vercel-app/lib/sheets');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('ok -', name); };
const throws = (fn, part) => {
  try { fn(); } catch (e) { if (part) assert.ok(e.message.includes(part), `wrong error: ${e.message}`); return; }
  assert.fail('expected throw');
};

// ---------- validatePhoto ----------
const b64 = (buf) => buf.toString('base64');
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(100)]);
const riffNotWebp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('XXXX'), Buffer.alloc(100)]);

t('accepts a valid JPEG', () => {
  const r = photos.validatePhoto({ data: b64(jpg), type: 'image/jpeg' });
  assert.strictEqual(r.ext, 'jpg');
  assert.ok(Buffer.isBuffer(r.buffer));
});

t('accepts a valid PNG', () => {
  const r = photos.validatePhoto({ data: b64(png), type: 'image/png' });
  assert.strictEqual(r.ext, 'png');
});

t('accepts a valid WebP (RIFF + WEBP)', () => {
  const r = photos.validatePhoto({ data: b64(webp), type: 'image/webp' });
  assert.strictEqual(r.ext, 'webp');
});

t('accepts a data: URL wrapper', () => {
  const r = photos.validatePhoto({ data: 'data:image/jpeg;base64,' + b64(jpg), type: 'image/jpeg' });
  assert.strictEqual(r.ext, 'jpg');
});

t('rejects RIFF container that is not WebP', () => {
  throws(() => photos.validatePhoto({ data: b64(riffNotWebp), type: 'image/webp' }), 'does not match');
});

t('rejects MIME/signature mismatch', () => {
  throws(() => photos.validatePhoto({ data: b64(png), type: 'image/jpeg' }), 'does not match');
  throws(() => photos.validatePhoto({ data: b64(jpg), type: 'image/png' }), 'does not match');
});

t('rejects invalid base64', () => {
  throws(() => photos.validatePhoto({ data: '!!!not-base64!!!', type: 'image/jpeg' }), 'base64');
  throws(() => photos.validatePhoto({ data: '', type: 'image/jpeg' }), 'base64');
});

t('rejects disallowed types', () => {
  throws(() => photos.validatePhoto({ data: b64(jpg), type: 'image/gif' }), 'JPEG, PNG, or WebP');
  throws(() => photos.validatePhoto(null), 'No photo');
});

t('rejects oversized photos', () => {
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(1536 * 1024)]);
  throws(() => photos.validatePhoto({ data: b64(big), type: 'image/jpeg' }), 'too large');
});

// ---------- sanitizeKeyToken ----------
t('sanitizes identity keys into filename tokens', () => {
  assert.strictEqual(photos.sanitizeKeyToken('id:abc123DEF'), 'idabc123def');
  assert.strictEqual(photos.sanitizeKeyToken('li:https://linkedin.com/in/x-y'), 'lihttpslinkedincominxy');
  assert.strictEqual(photos.sanitizeKeyToken('  '), 'profile');
  assert.strictEqual(photos.sanitizeKeyToken(''), 'profile');
  const long = photos.sanitizeKeyToken('x'.repeat(100));
  assert.ok(long.length <= 80, 'capped: ' + long.length);
});

// ---------- isPublicPhotoUrl ----------
t('isPublicPhotoUrl accepts only our Blob store URLs', () => {
  const good = 'https://rankly-blob.public.blob.vercel-storage.com/rankly-photos/rankly-idabc123.png';
  assert.ok(photos.isPublicPhotoUrl(good));
  for (const bad of ['', 'https://evil.com/rankly-photos/rankly-x.png',
      'https://rankly-blob.public.blob.vercel-storage.com/other/rankly-x.png',
      'https://rankly-blob.public.blob.vercel-storage.com/rankly-photos/rankly-x.exe',
      'http://rankly-blob.public.blob.vercel-storage.com/rankly-photos/rankly-x.png',
      null, undefined]) {
    assert.strictEqual(photos.isPublicPhotoUrl(bad), false, JSON.stringify(bad));
  }
});

// ---------- photoUrlFor (public-safe photo URLs) ----------
t('photoUrlFor passes through our Blob URLs', () => {
  const good = 'https://rankly-blob.public.blob.vercel-storage.com/rankly-photos/rankly-idabc123.png';
  assert.strictEqual(sheets.photoUrlFor(good), good);
});

t('photoUrlFor keeps legacy Drive IDs mapped to thumbnails', () => {
  const u = sheets.photoUrlFor('1AbC2dEfGhIjKlMnOp3');
  assert.strictEqual(u, 'https://drive.google.com/thumbnail?id=1AbC2dEfGhIjKlMnOp3&sz=w200');
});

t('photoUrlFor returns empty for junk (nothing unexpected leaks)', () => {
  for (const bad of ['', '   ', 'https://evil.com/x.png', 'not a url!!', null, undefined]) {
    assert.strictEqual(sheets.photoUrlFor(bad), '', JSON.stringify(bad));
  }
});

// ---------- headers carry Photo in the right slot ----------
t('PROFILE_HEADERS has Photo at index 12', () => {
  assert.strictEqual(sheets.PROFILE_HEADERS[12], 'Photo');
  assert.strictEqual(sheets.PROFILE_HEADERS.length, 13);
});

t('CLAIM_HEADERS has Photo at index 17', () => {
  assert.strictEqual(sheets.CLAIM_HEADERS[17], 'Photo');
  assert.strictEqual(sheets.CLAIM_HEADERS.length, 18);
});

console.log(`\n${pass} photo tests passed`);
