import { buildCorsHeaders, handleOptions, jsonResponse } from '../_lib/cors.js';
import { verifyClerkJwt, ensureD1User } from '../_lib/auth.js';
import { verifyStudentToken } from '../_lib/crypto.js';

function resolveKeyParam(params, urlStr) {
  const seg = params && params.key;
  if (Array.isArray(seg) && seg.length > 0) {
    return seg.map(s => decodeURIComponent(s)).join('/');
  }
  if (typeof seg === 'string' && seg) {
    return decodeURIComponent(seg);
  }
  try {
    const u = new URL(urlStr);
    const idx = u.pathname.indexOf('/api/media/');
    if (idx >= 0) return decodeURIComponent(u.pathname.slice(idx + '/api/media/'.length));
  } catch (_) {}
  return '';
}

async function authorizeMediaRequest(request, env, mediaMeta) {
  const u = new URL(request.url);
  const authHeader = request.headers.get('Authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  const studentToken = (
    request.headers.get('X-Student-Token') ||
    u.searchParams.get('st') ||
    ''
  ).trim();

  if (studentToken && env.STUDENT_TOKEN_SECRET) {
    const stClaims = await verifyStudentToken(studentToken, env.STUDENT_TOKEN_SECRET);
    if (stClaims && stClaims.schoolId === mediaMeta.school_id) {
      if (!mediaMeta.student_id || mediaMeta.student_id === stClaims.studentId) {
        return { authorized: true, actorType: 'student' };
      }
    }
  }

  const tutorToken = bearer || (u.searchParams.get('t') || '').trim();
  if (tutorToken) {
    const clerkProfile = await verifyClerkJwt(tutorToken, env);
    if (clerkProfile) {
      const user = await ensureD1User(env.DB, clerkProfile, env);
      if (user && user.account_status !== 'suspended' && user.school_id === mediaMeta.school_id) {
        return { authorized: true, actorType: 'tutor', user };
      }
    }
  }

  return { authorized: false };
}

export async function onRequestOptions(context) {
  return handleOptions(context, 'GET, DELETE, OPTIONS');
}

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const mediaKey = resolveKeyParam(params, request.url);
  if (!mediaKey) return jsonResponse({ error: 'Media key required' }, 400, request, env);

  const mediaMeta = await env.DB.prepare('SELECT * FROM media_objects WHERE key = ?').bind(mediaKey).first();
  if (!mediaMeta) return jsonResponse({ error: 'Media not found' }, 404, request, env);

  const authCheck = await authorizeMediaRequest(request, env, mediaMeta);
  if (!authCheck.authorized) {
    return jsonResponse({ error: 'Unauthorized media access' }, 403, request, env);
  }

  const rangeHdr = request.headers.get('Range');
  const r2Obj = await env.MEDIA_BUCKET.get(mediaKey, rangeHdr ? { range: request.headers } : undefined);
  if (!r2Obj) return jsonResponse({ error: 'Media object missing from storage' }, 404, request, env);

  const cors = buildCorsHeaders(request, env, 'GET, DELETE, OPTIONS');
  const headers = new Headers({
    ...cors,
    'Content-Type': mediaMeta.content_type || (r2Obj.httpMetadata && r2Obj.httpMetadata.contentType) || 'application/octet-stream',
    'Cache-Control': 'private, max-age=86400',
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff'
  });

  if (typeof r2Obj.size === 'number') {
    if (r2Obj.range && typeof r2Obj.range.offset === 'number' && typeof r2Obj.range.length === 'number') {
      const start = r2Obj.range.offset;
      const end = start + r2Obj.range.length - 1;
      headers.set('Content-Range', `bytes ${start}-${end}/${r2Obj.size}`);
      headers.set('Content-Length', String(r2Obj.range.length));
      return new Response(r2Obj.body, { status: 206, headers });
    }
    headers.set('Content-Length', String(r2Obj.size));
  }

  return new Response(r2Obj.body, { status: 200, headers });
}

export async function onRequestDelete(context) {
  const { request, env, params } = context;
  const mediaKey = resolveKeyParam(params, request.url);
  if (!mediaKey) return jsonResponse({ error: 'Media key required' }, 400, request, env);

  const mediaMeta = await env.DB.prepare('SELECT * FROM media_objects WHERE key = ?').bind(mediaKey).first();
  if (!mediaMeta) return jsonResponse({ error: 'Media not found' }, 404, request, env);

  const authCheck = await authorizeMediaRequest(request, env, mediaMeta);
  if (!authCheck.authorized || authCheck.actorType !== 'tutor') {
    return jsonResponse({ error: 'Tutor authorization required to delete media' }, 403, request, env);
  }

  if (env.MEDIA_BUCKET) await env.MEDIA_BUCKET.delete(mediaKey).catch(() => {});
  await env.DB.prepare('DELETE FROM media_objects WHERE key = ? AND school_id = ?').bind(mediaKey, mediaMeta.school_id).run();
  return jsonResponse({ ok: true, deletedKey: mediaKey }, 200, request, env);
}
