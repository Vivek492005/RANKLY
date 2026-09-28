'use strict';
// Optional profile-photo uploads for Rankly, backed by Vercel Blob.
//
// Why Blob and not Google Drive: a service account cannot upload files into
// a regular Gmail user's My Drive at all — every upload fails with
// "Service Accounts do not have storage quota" (the file would be
// service-account-owned), and shared drives / OAuth delegation need Google
// Workspace. Vercel Blob needs no Google OAuth dance: the store's
// read-write token is injected as BLOB_READ_WRITE_TOKEN.
//
// Layout: one deterministic public object per user; a re-upload overwrites
// it in place (allowOverwrite), so "re-bid with a photo replaces it" holds
// with no cleanup pass:
//   rankly-photos/rankly-<identitykey>.<ext>   (access: public)
//
// Uploaded objects are public so leaderboard avatars render without auth.
// Photo upload is a best-effort extra: callers must never let a failure
// break a claim.
const { put } = require('@vercel/blob');

const PHOTO_PREFIX = 'rankly-photos/';

// After client-side resize the payload should be ~100-400KB. 1.5MB hard cap.
const MAX_PHOTO_BYTES = 1536 * 1024;
// Magic-byte signatures: every entry must match. WebP requires both the
// RIFF container marker (offset 0) and the WEBP chunk tag (offset 8).
const ALLOWED_TYPES = {
  'image/jpeg': { ext: 'jpg', magic: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }] },
  'image/png': { ext: 'png', magic: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }] },
  'image/webp': { ext: 'webp', magic: [
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF
    { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, // WEBP
  ] },
};

// Sanitize an identity key into a filename-safe token (alphanumerics only).
function sanitizeKeyToken(key) {
  const s = String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 80);
  return s || 'profile';
}

// Decode + validate an uploaded photo. Accepts { data, type } where data is
// base64 (optionally a data: URL). Returns { buffer, ext } or throws.
function validatePhoto(photo) {
  if (!photo || typeof photo !== 'object') throw new Error('No photo provided.');
  const type = String(photo.type || '').toLowerCase();
  const spec = ALLOWED_TYPES[type];
  if (!spec) throw new Error('Photo must be a JPEG, PNG, or WebP image.');
  let b64 = String(photo.data || '');
  const m = b64.match(/^data:image\/[a-z]+;base64,(.*)$/i);
  if (m) b64 = m[1];
  b64 = b64.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || !b64.length) {
    throw new Error('Photo data is not valid base64.');
  }
  const buffer = Buffer.from(b64, 'base64');
  if (!buffer.length || buffer.length > MAX_PHOTO_BYTES) {
    throw new Error('Photo is too large — keep it under 1.5MB.');
  }
  const ok = spec.magic.every((sig) => sig.bytes.every((b, i) => buffer[sig.offset + i] === b));
  if (!ok) throw new Error('Photo content does not match its file type.');
  return { buffer, ext: spec.ext };
}

// Only URLs we created may be stored/rendered as photos: our Blob store
// origin + our path prefix + an image extension. Anything else degrades to
// the initials avatar, so a tampered value can never become an avatar.
function isPublicPhotoUrl(u) {
  return /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/rankly-photos\/[A-Za-z0-9_.\-]+\.(jpg|jpeg|png|webp)$/
    .test(String(u || '').trim());
}

// Upload (or overwrite) one user's profile photo. Returns { photoUrl } —
// the public Blob URL, which is what gets stored in the sheet's Photo
// column. Throws when the Blob token is missing or the upload fails.
async function uploadProfilePhoto({ userKey, buffer, ext }) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('BLOB_READ_WRITE_TOKEN is not set');
  }
  const pathname = `${PHOTO_PREFIX}rankly-${sanitizeKeyToken(userKey)}.${ext}`;
  const blob = await put(pathname, buffer, {
    access: 'public',
    contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
    allowOverwrite: true,
  });
  if (!isPublicPhotoUrl(blob.url)) throw new Error('Blob returned an unexpected URL');
  return { photoUrl: blob.url };
}

module.exports = {
  sanitizeKeyToken,
  validatePhoto,
  isPublicPhotoUrl,
  uploadProfilePhoto,
  MAX_PHOTO_BYTES,
};
