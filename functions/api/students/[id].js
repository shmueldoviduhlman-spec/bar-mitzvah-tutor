import { handleOptions, jsonResponse } from '../_lib/cors.js';
import { requireTutorAuth } from '../_lib/auth.js';
import { mapStudentRowToClient } from '../workspace/bootstrap.js';
import { buildStudentDbFields } from './index.js';

export async function onRequestOptions(context) {
  return handleOptions(context, 'GET, PUT, DELETE, OPTIONS');
}

export async function onRequestGet(context) {
  const auth = await requireTutorAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const studentId = String((context.params && context.params.id) || '').trim();
  const row = await context.env.DB.prepare(
    'SELECT * FROM students WHERE id = ? AND school_id = ?'
  ).bind(studentId, auth.user.school_id).first();
  if (!row) {
    return jsonResponse({ error: 'Student not found' }, 404, context.request, context.env);
  }
  return jsonResponse({ student: mapStudentRowToClient(row) }, 200, context.request, context.env);
}

export async function onRequestPut(context) {
  const auth = await requireTutorAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env, params } = context;
  const studentId = String((params && params.id) || '').trim();
  if (!studentId) return jsonResponse({ error: 'Student ID required' }, 400, request, env);

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, request, env);
  }

  const anyExisting = await env.DB.prepare('SELECT * FROM students WHERE id = ?').bind(studentId).first();
  if (anyExisting && anyExisting.school_id !== auth.user.school_id) {
    return jsonResponse({ error: 'Forbidden' }, 403, request, env);
  }

  const f = buildStudentDbFields({ ...body, id: studentId }, anyExisting, auth.user);
  await env.DB.prepare(
    `INSERT INTO students (
      id, school_id, owner_user_id, name, access_code, avatar_media_key,
      status, archived, archived_at, sort_order, parsha_or_date, profile_json,
      private_notes, shared_notes_json, skills_json, schedule_json, progress_json,
      updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      access_code = excluded.access_code,
      avatar_media_key = excluded.avatar_media_key,
      status = excluded.status,
      archived = excluded.archived,
      archived_at = excluded.archived_at,
      sort_order = excluded.sort_order,
      parsha_or_date = excluded.parsha_or_date,
      profile_json = excluded.profile_json,
      private_notes = excluded.private_notes,
      shared_notes_json = excluded.shared_notes_json,
      skills_json = excluded.skills_json,
      schedule_json = excluded.schedule_json,
      progress_json = excluded.progress_json,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at`
  ).bind(
    f.id, f.school_id, f.owner_user_id, f.name, f.access_code, f.avatar_media_key,
    f.status, f.archived, f.archived_at, f.sort_order, f.parsha_or_date, f.profile_json,
    f.private_notes, f.shared_notes_json, f.skills_json, f.schedule_json, f.progress_json,
    f.updated_by, f.created_at, f.updated_at
  ).run();

  const saved = await env.DB.prepare('SELECT * FROM students WHERE id = ? AND school_id = ?').bind(studentId, auth.user.school_id).first();
  return jsonResponse({ ok: true, student: saved ? mapStudentRowToClient(saved) : null }, 200, request, env);
}

export async function onRequestDelete(context) {
  const auth = await requireTutorAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env, params } = context;
  const studentId = String((params && params.id) || '').trim();
  const row = await env.DB.prepare('SELECT id, school_id FROM students WHERE id = ?').bind(studentId).first();
  if (!row) return jsonResponse({ error: 'Student not found' }, 404, request, env);
  if (row.school_id !== auth.user.school_id) return jsonResponse({ error: 'Forbidden' }, 403, request, env);

  // Clean up R2 media objects tied exclusively to this student
  const mediaRows = await env.DB.prepare('SELECT key FROM media_objects WHERE student_id = ? AND school_id = ?').bind(studentId, auth.user.school_id).all();
  for (const m of ((mediaRows && mediaRows.results) || [])) {
    if (env.MEDIA_BUCKET && m && m.key) {
      await env.MEDIA_BUCKET.delete(m.key).catch(() => {});
    }
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM media_objects WHERE student_id = ? AND school_id = ?').bind(studentId, auth.user.school_id),
    env.DB.prepare('DELETE FROM students WHERE id = ? AND school_id = ?').bind(studentId, auth.user.school_id)
  ]);

  return jsonResponse({ ok: true, deletedId: studentId }, 200, request, env);
}
