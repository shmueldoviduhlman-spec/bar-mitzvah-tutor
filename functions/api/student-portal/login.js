import { handleOptions, jsonResponse } from '../_lib/cors.js';
import { signStudentToken } from '../_lib/crypto.js';
import { ensureM142Schema } from '../_lib/billing_config.js';
import { evaluateStudentPortalAccess } from '../_lib/reconcile_billing.js';

function safeJson(raw, fallback) {
  if (!raw || typeof raw !== 'string') return fallback;
  try { return JSON.parse(raw); } catch (_) { return fallback; }
}

function normalizeStudentName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function sanitizeStudentForPortal(row, opts = {}) {
  const profile = safeJson(row.profile_json, {});
  const sharedNotes = safeJson(row.shared_notes_json, []);
  const skills = safeJson(row.skills_json, {});
  const schedule = safeJson(row.schedule_json, []);
  const access = opts.portalAccess || evaluateStudentPortalAccess(opts.subRow || null, row);

  const mediaKey = String(row.avatar_media_key || '');
  const avatarUrl = mediaKey
    ? (mediaKey.startsWith('/') || mediaKey.startsWith('http') || mediaKey.startsWith('data:')
        ? mediaKey
        : `/api/media/${encodeURIComponent(mediaKey)}`)
    : (profile.avatar || '');

  const recentRecaps = Array.isArray(opts.sessions)
    ? opts.sessions.slice(0, 15).map(cs => ({
        id: cs.id,
        sessionDate: cs.session_date,
        startTime: cs.start_time,
        topic: cs.topic || '',
        status: cs.status,
        recapSummary: cs.recap_summary || '',
        homeworkAssigned: cs.homework_assigned || ''
      }))
    : [];

  // Zero-Leak Guarantee: explicitly omit private_notes, parentContact, hourlyRate, owner_user_id, and all charges/billing
  return {
    id: row.id,
    name: row.name,
    subject: profile.subject || row.parsha_or_date || '',
    gradeOrDate: profile.gradeOrDate || row.parsha_or_date || '',
    gradeLevel: profile.gradeLevel || 'Standard / All Levels',
    learnerType: row.learner_type || 'child',
    portalStatus: access.portalStatus,
    portalReadOnly: Boolean(access.readOnly),
    avatar: avatarUrl,
    studentAccessCode: String(row.access_code || '').toUpperCase().trim(),
    sharedNotes: Array.isArray(sharedNotes) ? sharedNotes : [],
    skills: skills && typeof skills === 'object' ? skills : {},
    recentRecaps,
    schedule: Array.isArray(schedule) ? schedule.map(l => ({
      id: (l && l.id) || '',
      dateStr: (l && l.dateStr) || '',
      time: (l && l.time) || '',
      status: (l && l.status) || 'scheduled',
      repeatWeekly: !!(l && l.repeatWeekly),
      dateStatuses: (l && l.dateStatuses && typeof l.dateStatuses === 'object') ? l.dateStatuses : undefined
    })) : []
  };
}

export async function onRequestOptions(context) {
  return handleOptions(context, 'POST, OPTIONS');
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env || !env.DB) {
    return jsonResponse({ error: 'Database binding missing' }, 500, request, env);
  }
  const secret = String((env && env.STUDENT_TOKEN_SECRET) || '').trim();
  if (!secret) {
    return jsonResponse({ error: 'Student portal signing secret not configured' }, 500, request, env);
  }

  const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (env.APP_KV && typeof env.APP_KV.get === 'function') {
    const rlKey = `sp_rl:${clientIp}`;
    const attempts = parseInt((await env.APP_KV.get(rlKey)) || '0', 10) || 0;
    if (attempts >= 15) {
      return jsonResponse({ error: 'Too many login attempts. Please wait 10 minutes and try again.' }, 429, request, env);
    }
    await env.APP_KV.put(rlKey, String(attempts + 1), { expirationTtl: 600 });
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ error: 'Invalid JSON request body' }, 400, request, env);
  }

  const enteredName = normalizeStudentName(body && body.name);
  const enteredCode = String((body && body.accessCode) || '').toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
  if (!enteredName || !enteredCode) {
    return jsonResponse({ error: 'Please enter both your exact name and Student Code.' }, 400, request, env);
  }

  // Indexed lookup ONLY by access_code; never returns multiple students to client
  const matchesRes = await env.DB.prepare(
    'SELECT * FROM students WHERE upper(trim(access_code)) = ? AND archived = 0'
  ).bind(enteredCode).all();

  const matchRow = ((matchesRes && matchesRes.results) || []).find(row =>
    normalizeStudentName(row.name) === enteredName
  );

  if (!matchRow) {
    return jsonResponse({ error: 'Exact name and Student Code did not match. Ask your teacher to check your code.' }, 401, request, env);
  }

  await ensureM142Schema(env.DB);
  const subRow = await env.DB.prepare('SELECT * FROM student_subscriptions WHERE student_id = ?')
    .bind(matchRow.id).first().catch(() => null);
  const portalAccess = evaluateStudentPortalAccess(subRow, matchRow);
  if (!portalAccess.canLogin) {
    return jsonResponse({
      error: 'Your Student Portal is not activated yet. Ask your parent or tutor to activate your 7-day free trial first.',
      code: 'PORTAL_NOT_ACTIVATED',
      portalStatus: portalAccess.portalStatus
    }, 403, request, env);
  }

  const sessRes = await env.DB.prepare(
    'SELECT id, session_date, start_time, topic, status, recap_summary, homework_assigned FROM calendar_sessions WHERE student_id = ? ORDER BY session_date DESC LIMIT 15'
  ).bind(matchRow.id).all().catch(() => ({ results: [] }));

  const studentToken = await signStudentToken(
    { studentId: matchRow.id, schoolId: matchRow.school_id, accessCode: enteredCode },
    secret,
    43200 // 12 hours
  );

  return jsonResponse({
    ok: true,
    studentToken,
    student: sanitizeStudentForPortal(matchRow, { subRow, portalAccess, sessions: (sessRes && sessRes.results) || [] })
  }, 200, request, env);
}
