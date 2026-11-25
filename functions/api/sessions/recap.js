import { handleOptions, jsonResponse } from '../_lib/cors.js';
import { requireTutorWriteAccess } from '../_lib/auth.js';
import { ensureM142Schema } from '../_lib/billing_config.js';
import { upsertCalendarSessionAndSyncStudent } from '../_lib/ledger_ops.js';

export async function onRequestOptions(context) {
  return handleOptions(context, 'POST, OPTIONS');
}

export async function onRequestPost(context) {
  const auth = await requireTutorWriteAccess(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env } = context;
  await ensureM142Schema(env.DB);

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, request, env);
  }

  const targetId = String((body && body.studentId) || '').trim();
  const targetName = String((body && (body.studentNameOrId || body.studentName)) || '').trim().toLowerCase();

  let studentRow = null;
  if (targetId) {
    studentRow = await env.DB.prepare('SELECT * FROM students WHERE id = ? AND school_id = ?')
      .bind(targetId, auth.user.school_id).first();
  }
  if (!studentRow && targetName) {
    const allRes = await env.DB.prepare('SELECT * FROM students WHERE school_id = ? AND archived = 0')
      .bind(auth.user.school_id).all();
    const list = (allRes && allRes.results) || [];
    studentRow = list.find(r => String(r.id).toLowerCase() === targetName)
      || list.find(r => String(r.name || '').trim().toLowerCase() === targetName)
      || list.find(r => String(r.name || '').toLowerCase().includes(targetName))
      || null;
  }

  if (!studentRow) {
    return jsonResponse({ error: 'Matching student not found in your workspace' }, 404, request, env);
  }

  const result = await upsertCalendarSessionAndSyncStudent(env.DB, {
    studentRow,
    tutorUser: auth.user,
    body,
    defaultSource: body && body.recapSource ? String(body.recapSource) : 'manual'
  });

  return jsonResponse({
    ok: true,
    session: result.session,
    ledger: result.ledger,
    sessions: result.sessions
  }, 200, request, env);
}
