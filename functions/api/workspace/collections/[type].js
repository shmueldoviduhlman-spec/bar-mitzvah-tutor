import { handleOptions, jsonResponse } from '../../_lib/cors.js';
import { requireTutorAuth } from '../../_lib/auth.js';

const ALLOWED_COLLECTION_TYPES = new Set(['reading_materials', 'milestones', 'study_materials']);

export async function onRequestOptions(context) {
  return handleOptions(context, 'GET, PUT, OPTIONS');
}

export async function onRequestGet(context) {
  const auth = await requireTutorAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env, params } = context;
  const colType = String((params && params.type) || '').trim();
  if (!ALLOWED_COLLECTION_TYPES.has(colType)) {
    return jsonResponse({ error: 'Invalid curriculum collection type' }, 400, request, env);
  }
  const row = await env.DB.prepare(
    'SELECT data_json, updated_at FROM curriculum_collections WHERE school_id = ? AND collection_type = ?'
  ).bind(auth.user.school_id, colType).first();

  let data = colType === 'study_materials' ? {} : [];
  if (row && row.data_json) {
    try { data = JSON.parse(row.data_json); } catch (_) {}
  }
  return jsonResponse({ type: colType, data, updatedAt: (row && row.updated_at) || '' }, 200, request, env);
}

export async function onRequestPut(context) {
  const auth = await requireTutorAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env, params } = context;
  const colType = String((params && params.type) || '').trim();
  if (!ALLOWED_COLLECTION_TYPES.has(colType)) {
    return jsonResponse({ error: 'Invalid curriculum collection type' }, 400, request, env);
  }
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, request, env);
  }
  const payload = body && Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : body;
  const nowIso = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO curriculum_collections (school_id, collection_type, data_json, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(school_id, collection_type) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at`
  ).bind(auth.user.school_id, colType, JSON.stringify(payload ?? (colType === 'study_materials' ? {} : [])), nowIso).run();

  return jsonResponse({ ok: true, type: colType, updatedAt: nowIso }, 200, request, env);
}
