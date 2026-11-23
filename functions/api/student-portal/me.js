import { handleOptions, jsonResponse } from '../_lib/cors.js';
import { verifyStudentToken } from '../_lib/crypto.js';
import { sanitizeStudentForPortal } from './login.js';

export function extractStudentToken(request) {
  const hdr = (request && request.headers && (request.headers.get('X-Student-Token') || request.headers.get('Authorization'))) || '';
  if (hdr.startsWith('Bearer ')) return hdr.slice(7).trim();
  if (hdr && !hdr.includes(' ')) return hdr.trim();
  try {
    const u = new URL(request.url);
    return (u.searchParams.get('st') || '').trim();
  } catch (_) {
    return '';
  }
}

export async function onRequestOptions(context) {
  return handleOptions(context, 'GET, OPTIONS');
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const secret = String((env && env.STUDENT_TOKEN_SECRET) || '').trim();
  const token = extractStudentToken(request);
  const claims = token && secret ? await verifyStudentToken(token, secret) : null;
  if (!claims) {
    return jsonResponse({ error: 'Student session expired or invalid' }, 401, request, env);
  }

  const row = await env.DB.prepare(
    'SELECT * FROM students WHERE id = ? AND school_id = ? AND archived = 0'
  ).bind(claims.studentId, claims.schoolId).first();
  if (!row) {
    return jsonResponse({ error: 'Student record not found' }, 404, request, env);
  }

  return jsonResponse({
    ok: true,
    student: sanitizeStudentForPortal(row)
  }, 200, request, env);
}
