import { handleOptions, jsonResponse } from '../_lib/cors.js';
import { requireTutorAuth } from '../_lib/auth.js';
import { generateRandomCode } from '../_lib/crypto.js';
import { mapStudentRowToClient } from '../workspace/bootstrap.js';

export function buildStudentDbFields(body, existingRow, user) {
  const nowIso = new Date().toISOString();
  const id = String((body && body.id) || (existingRow && existingRow.id) || ('stu_' + Date.now() + '_' + generateRandomCode(5, 'abcdefghijklmnopqrstuvwxyz0123456789'))).trim();
  const name = String((body && body.name) ?? (existingRow && existingRow.name) ?? '').trim();
  const existingProfile = existingRow && existingRow.profile_json ? (() => { try { return JSON.parse(existingRow.profile_json); } catch (_) { return {}; } })() : {};

  let accessCode = String((body && body.studentAccessCode) || (existingRow && existingRow.access_code) || '').toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
  if (!accessCode || accessCode.length < 4) {
    accessCode = generateRandomCode(6);
  }

  let avatarMediaKey = String((body && body.avatarMediaKey) || '').trim();
  const rawAvatar = String((body && body.avatar) || '').trim();
  if (!avatarMediaKey && rawAvatar.startsWith('/api/media/')) {
    avatarMediaKey = decodeURIComponent(rawAvatar.slice('/api/media/'.length).split('?')[0]);
  }
  const avatarInProfile = rawAvatar.startsWith('http') || rawAvatar.startsWith('data:') ? rawAvatar : (existingProfile.avatar || '');

  const rawStudentContact = (body && body.studentContact && typeof body.studentContact === 'object')
    ? body.studentContact
    : (existingProfile.studentContact || { phone: '', email: '' });
  const rawOutreachLog = (body && body.outreachLog && typeof body.outreachLog === 'object')
    ? body.outreachLog
    : (existingProfile.outreachLog || {});

  const profileObj = {
    subject: String((body && body.subject) ?? existingProfile.subject ?? ''),
    gradeOrDate: String((body && body.gradeOrDate) ?? existingProfile.gradeOrDate ?? ''),
    gradeLevel: String((body && body.gradeLevel) ?? existingProfile.gradeLevel ?? 'Standard / All Levels'),
    hourlyRate: String((body && body.hourlyRate) ?? existingProfile.hourlyRate ?? ''),
    parentContact: (body && body.parentContact && typeof body.parentContact === 'object') ? body.parentContact : (existingProfile.parentContact || { name: '', phone: '', email: '' }),
    studentContact: {
      phone: String(rawStudentContact.phone || '').trim(),
      email: String(rawStudentContact.email || '').trim()
    },
    outreachLog: rawOutreachLog,
    avatar: avatarMediaKey ? '' : avatarInProfile,
    lessons: Array.isArray(body && body.lessons)
      ? body.lessons
      : (Array.isArray(existingProfile.lessons) ? existingProfile.lessons : [])
  };

  const progressObj = {
    completedTopics: (body && body.completedTopics && typeof body.completedTopics === 'object') ? body.completedTopics : {},
    completedParshiot: (body && body.completedParshiot && typeof body.completedParshiot === 'object') ? body.completedParshiot : {}
  };

  return {
    id,
    school_id: user.school_id,
    owner_user_id: (existingRow && existingRow.owner_user_id) || user.id,
    name,
    access_code: accessCode,
    avatar_media_key: avatarMediaKey || (existingRow && existingRow.avatar_media_key) || '',
    status: String((body && body.status) || (existingRow && existingRow.status) || 'active'),
    archived: (body && body.archived) ? 1 : 0,
    archived_at: (body && body.archived) ? String(body.archivedAt || nowIso) : '',
    sort_order: typeof (body && body.orderIndex) === 'number' ? body.orderIndex : ((existingRow && existingRow.sort_order) || 0),
    parsha_or_date: String((body && (body.parshaOrDate || body.gradeOrDate || body.subject)) ?? (existingRow && existingRow.parsha_or_date) ?? ''),
    profile_json: JSON.stringify(profileObj),
    private_notes: String((body && body.notes) ?? (existingRow && existingRow.private_notes) ?? ''),
    shared_notes_json: JSON.stringify(Array.isArray(body && body.sharedNotes) ? body.sharedNotes : []),
    skills_json: JSON.stringify((body && body.skills && typeof body.skills === 'object') ? body.skills : {}),
    schedule_json: JSON.stringify(Array.isArray(body && body.schedule) ? body.schedule : []),
    progress_json: JSON.stringify(progressObj),
    updated_by: user.full_name || user.email,
    created_at: (existingRow && existingRow.created_at) || nowIso,
    updated_at: nowIso
  };
}

export async function onRequestOptions(context) {
  return handleOptions(context, 'GET, POST, OPTIONS');
}

export async function onRequestGet(context) {
  const auth = await requireTutorAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const rows = await context.env.DB.prepare(
    'SELECT * FROM students WHERE school_id = ? ORDER BY sort_order ASC, name ASC'
  ).bind(auth.user.school_id).all();
  return jsonResponse({
    students: ((rows && rows.results) || []).map(mapStudentRowToClient)
  }, 200, context.request, context.env);
}

export async function onRequestPost(context) {
  const auth = await requireTutorAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, request, env);
  }
  if (!body || !String(body.name || '').trim()) {
    return jsonResponse({ error: 'Student name is required' }, 400, request, env);
  }

  const existing = body.id
    ? await env.DB.prepare('SELECT * FROM students WHERE id = ?').bind(String(body.id)).first()
    : null;
  if (existing && existing.school_id !== auth.user.school_id) {
    return jsonResponse({ error: 'Forbidden' }, 403, request, env);
  }

  const f = buildStudentDbFields(body, existing, auth.user);
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

  const saved = await env.DB.prepare('SELECT * FROM students WHERE id = ? AND school_id = ?').bind(f.id, auth.user.school_id).first();
  return jsonResponse({ ok: true, student: saved ? mapStudentRowToClient(saved) : null }, existing ? 200 : 201, request, env);
}
