import { handleOptions, jsonResponse } from '../_lib/cors.js';
import { requireTutorWriteAccess } from '../_lib/auth.js';

export async function onRequestOptions(context) {
  return handleOptions(context, 'PUT, DELETE, OPTIONS');
}

export async function onRequestPut(context) {
  const auth = await requireTutorWriteAccess(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env, params } = context;
  const courseId = String((params && params.id) || '').trim();
  if (!courseId) return jsonResponse({ error: 'Course ID required' }, 400, request, env);

  const existing = await env.DB.prepare('SELECT id, school_id FROM courses WHERE id = ?').bind(courseId).first();
  if (existing && existing.school_id !== auth.user.school_id) {
    return jsonResponse({ error: 'Forbidden' }, 403, request, env);
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, request, env);
  }

  const nowIso = new Date().toISOString();
  const cleanObj = { ...(body || {}), id: courseId, school_id: auth.user.school_id };
  const title = String(cleanObj.title || cleanObj.title_en || cleanObj.title_he || 'Untitled Course').trim();
  const archived = cleanObj.archived ? 1 : 0;
  const archivedAt = cleanObj.archived ? String(cleanObj.archivedAt || nowIso) : '';

  await env.DB.prepare(
    `INSERT INTO courses (id, school_id, owner_user_id, title, archived, archived_at, deleted_at, data_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       archived = excluded.archived,
       archived_at = excluded.archived_at,
       deleted_at = '',
       data_json = excluded.data_json,
       updated_at = excluded.updated_at`
  ).bind(courseId, auth.user.school_id, auth.user.id, title, archived, archivedAt, JSON.stringify(cleanObj), nowIso, nowIso).run();

  return jsonResponse({ ok: true, course: { ...cleanObj, archived: !!archived, archivedAt, updatedAt: nowIso } }, 200, request, env);
}

export async function onRequestDelete(context) {
  const auth = await requireTutorWriteAccess(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env, params } = context;
  const courseId = String((params && params.id) || '').trim();
  const existing = await env.DB.prepare('SELECT id, school_id FROM courses WHERE id = ?').bind(courseId).first();
  if (!existing) return jsonResponse({ error: 'Course not found' }, 404, request, env);
  if (existing.school_id !== auth.user.school_id) return jsonResponse({ error: 'Forbidden' }, 403, request, env);

  const nowIso = new Date().toISOString();
  await env.DB.prepare('UPDATE courses SET deleted_at = ?, updated_at = ? WHERE id = ? AND school_id = ?')
    .bind(nowIso, nowIso, courseId, auth.user.school_id).run();
  return jsonResponse({ ok: true, deletedId: courseId }, 200, request, env);
}
