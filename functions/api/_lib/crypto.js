/**
 * Web Crypto Utilities: AES-256-GCM Secret Vault & HMAC-SHA256 Student Tokens
 */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function toBase64Url(bytes) {
  let bin = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function fromBase64Url(b64url) {
  const b64 = String(b64url || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toBase64(bytes) {
  let bin = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

export function fromBase64(b64) {
  const bin = atob(String(b64 || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveAesKey(masterSecret) {
  const raw = String(masterSecret || '').trim();
  if (!raw || raw.length < 16) {
    throw new Error('Server encryption secret is not configured');
  }
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(raw));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(plaintext, masterSecret) {
  const clean = String(plaintext || '').trim();
  if (!clean) throw new Error('Cannot encrypt empty secret');
  const key = await deriveAesKey(masterSecret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    textEncoder.encode(clean)
  );
  return {
    cipherB64: toBase64(new Uint8Array(encrypted)),
    ivB64: toBase64(iv),
    hint: maskApiKey(clean)
  };
}

export async function decryptSecret(cipherB64, ivB64, masterSecret) {
  if (!cipherB64 || !ivB64) return '';
  const key = await deriveAesKey(masterSecret);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivB64) },
    key,
    fromBase64(cipherB64)
  );
  return textDecoder.decode(decrypted);
}

export function maskApiKey(rawKey) {
  const s = String(rawKey || '').trim();
  if (!s) return '';
  if (s.length <= 6) return '••••' + s.slice(-2);
  return `${s.slice(0, 4)}••••${s.slice(-4)}`;
}

export async function sha256Hex(input) {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(String(input || '')));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function generateRandomCode(len = 6, alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789') {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = '';
  for (let i = 0; i < len; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export function timingSafeEqualStr(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  const len = Math.max(sa.length, sb.length);
  let diff = sa.length ^ sb.length;
  for (let i = 0; i < len; i++) {
    diff |= (sa.charCodeAt(i) || 0) ^ (sb.charCodeAt(i) || 0);
  }
  return diff === 0;
}

async function importHmacKey(secret) {
  const raw = String(secret || '').trim();
  if (!raw || raw.length < 16) throw new Error('STUDENT_TOKEN_SECRET is not configured');
  return crypto.subtle.importKey(
    'raw',
    textEncoder.encode(raw),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function signStudentToken(payloadObj, secret, ttlSec = 43200) {
  const key = await importHmacKey(secret);
  const nowSec = Math.floor(Date.now() / 1000);
  const body = {
    ...payloadObj,
    iat: nowSec,
    exp: nowSec + ttlSec
  };
  const dataPart = toBase64Url(textEncoder.encode(JSON.stringify(body)));
  const sig = await crypto.subtle.sign('HMAC', key, textEncoder.encode(dataPart));
  return `${dataPart}.${toBase64Url(new Uint8Array(sig))}`;
}

export async function verifyStudentToken(token, secret) {
  try {
    const parts = String(token || '').trim().split('.');
    if (parts.length !== 2) return null;
    const [dataPart, sigPart] = parts;
    const key = await importHmacKey(secret);
    const sigBytes = fromBase64Url(sigPart);
    const ok = await crypto.subtle.verify('HMAC', key, sigBytes, textEncoder.encode(dataPart));
    if (!ok) return null;
    const claims = JSON.parse(textDecoder.decode(fromBase64Url(dataPart)));
    const nowSec = Math.floor(Date.now() / 1000);
    if (!claims || !claims.studentId || !claims.schoolId) return null;
    if (typeof claims.exp !== 'number' || claims.exp < nowSec) return null;
    return claims;
  } catch (_) {
    return null;
  }
}
