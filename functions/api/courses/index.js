import { handleOptions, jsonResponse } from '../_lib/cors.js';
import { requireTutorAuth } from '../_lib/auth.js';

function mapCourseRow(row) {
  let parsed = {};
  try { parsed = row.data_json ? JSON.parse(row.data_json) : {}; } catch (_) {}
  return {
    ...parsed,
    id: row.id,
    title: parsed.title || parsed.title_en || parsed.title_he || row.title || 'Untitled Course',
    archived: !!row.archived,
    archivedAt: row.archived_at || '',
    school_id: row.school_id,
    updatedAt: row.updated_at
  };
}

export async function onRequestOptions(context) {
  return handleOptions(context, 'GET, PUT, OPTIONS');
}

export async function onRequestGet(context) {
  const auth = await requireTutorAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const rows = await context.env.DB.prepare(
    "SELECT * FROM courses WHERE school_id = ? AND (deleted_at IS NULL OR deleted_at = '') ORDER BY created_at ASC"
  ).bind(auth.user.school_id).all();
  return jsonResponse({
    courses: ((rows && rows.results) || []).map(mapCourseRow)
  }, 200, context.request, context.env);
}

export async function onRequestPut(context) {
  const auth = await requireTutorAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, request, env);
  }

  const incomingCourses = Array.isArray(body && body.courses) ? body.courses : [];
  const deletedCourseIds = Array.isArray(body && body.deletedCourseIds) ? body.deletedCourseIds : [];
  const nowIso = new Date().toISOString();

  const existingRowsRes = await env.DB.prepare('SELECT id, school_id FROM courses WHERE school_id = ?').bind(auth.user.school_id).all();
  const existingMap = new Map();
  for (const r of ((existingRowsRes && existingRowsRes.results) || [])) {
    existingMap.set(r.id, r.school_id);
  }

  const stmts = [];
  for (const c of incomingCourses) {
    if (!c || !c.id) continue;
    const cid = String(c.id).trim();
    // Prevent writing into another school's course ID
    const foreignCheck = existingMap.has(cid)
      ? null
      : await env.DB.prepare('SELECT school_id FROM courses WHERE id = ?').bind(cid).first();
    if (foreignCheck && foreignCheck.school_id !== auth.user.school_id) {
      continue;
    }

    const cleanObj = { ...c, id: cid, school_id: auth.user.school_id };
    const title = String(c.title || c.title_en || c.title_he || 'Untitled Course').trim();
    const archived = c.archived ? 1 : 0;
    const archivedAt = c.archived ? String(c.archivedAt || nowIso) : '';

    stmts.push(
      env.DB.prepare(
        `INSERT INTO courses (id, school_id, owner_user_id, title, archived, archived_at, deleted_at, data_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           archived = excluded.archived,
           archived_at = excluded.archived_at,
           deleted_at = '',
           data_json = excluded.data_json,
           updated_at = excluded.updated_at`
      ).bind(cid, auth.user.school_id, auth.user.id, title, archived, archivedAt, JSON.stringify(cleanObj), nowIso, nowIso)
    );
  }

  for (const delId of deletedCourseIds) {
    if (!delId) continue;
    stmts.push(
      env.DB.prepare(
        'UPDATE courses SET deleted_at = ?, updated_at = ? WHERE id = ? AND school_id = ?'
      ).bind(nowIso, nowIso, String(delId).trim(), auth.user.school_id)
    );
  }

  if (stmts.length > 0) {
    await env.DB.batch(stmts);
  }

  const rows = await env.DB.prepare(
    "SELECT * FROM courses WHERE school_id = ? AND (deleted_at IS NULL OR deleted_at = '') ORDER BY created_at ASC"
  ).bind(auth.user.school_id).all();
  return jsonResponse({ ok: true, courses: ((rows && rows.results) || []).map(mapCourseRow) }, 200, request, env);
}
