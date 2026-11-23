import { handleOptions, jsonResponse } from '../_lib/cors.js';
import { requireAdminAuth, logAdminAudit } from '../_lib/auth.js';
import { generateRandomCode } from '../_lib/crypto.js';

export async function onRequestOptions(context) {
  return handleOptions(context, 'GET, PATCH, OPTIONS');
}

export async function onRequestGet(context) {
  const auth = await requireAdminAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env } = context;

  const rows = await env.DB.prepare(`
    SELECT s.*,
           u.email AS owner_email,
           u.full_name AS owner_name,
           (SELECT COUNT(*) FROM school_members sm WHERE sm.school_id = s.id) AS member_count,
           (SELECT COUNT(*) FROM students st WHERE st.school_id = s.id AND st.archived = 0) AS student_count,
           (SELECT COUNT(*) FROM courses c WHERE c.school_id = s.id AND (c.deleted_at IS NULL OR c.deleted_at = '')) AS course_count
    FROM schools s
    LEFT JOIN users u ON u.id = s.owner_user_id
    ORDER BY s.created_at ASC
  `).all();

  const schools = ((rows && rows.results) || []).map(r => ({
    id: r.id,
    name: r.name,
    ownerUserId: r.owner_user_id,
    ownerEmail: r.owner_email || '',
    ownerName: r.owner_name || '',
    joinCode: r.join_code,
    memberCount: Number(r.member_count || 0),
    studentCount: Number(r.student_count || 0),
    courseCount: Number(r.course_count || 0),
    createdAt: r.created_at
  }));

  return jsonResponse({ schools }, 200, request, env);
}

export async function onRequestPatch(context) {
  const auth = await requireAdminAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env } = context;

  let body;
  try { body = await request.json(); } catch (_) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, request, env);
  }

  const schoolId = String((body && body.schoolId) || '').trim();
  if (!schoolId) return jsonResponse({ error: 'schoolId is required' }, 400, request, env);

  const school = await env.DB.prepare('SELECT * FROM schools WHERE id = ?').bind(schoolId).first();
  if (!school) return jsonResponse({ error: 'School not found' }, 404, request, env);

  const nowIso = new Date().toISOString();
  let nextName = school.name;
  let nextJoinCode = school.join_code;

  if (body.name && String(body.name).trim()) {
    nextName = String(body.name).trim();
  }
  if (body.rotateJoinCode) {
    nextJoinCode = generateRandomCode(8);
  } else if (body.joinCode && String(body.joinCode).trim().length >= 4) {
    nextJoinCode = String(body.joinCode).toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
  }

  await env.DB.prepare('UPDATE schools SET name = ?, join_code = ?, updated_at = ? WHERE id = ?')
    .bind(nextName, nextJoinCode, nowIso, school.id).run();

  await logAdminAudit(env.DB, auth.user, { id: school.id, email: school.name }, 'update_school', {
    schoolId: school.id,
    name: nextName,
    rotatedJoinCode: !!body.rotateJoinCode
  });

  return jsonResponse({ ok: true, school: { id: school.id, name: nextName, joinCode: nextJoinCode } }, 200, request, env);
}
