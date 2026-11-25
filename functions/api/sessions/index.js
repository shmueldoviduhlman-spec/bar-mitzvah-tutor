import { handleOptions, jsonResponse } from '../_lib/cors.js';
import { requireTutorAuth, requireTutorWriteAccess } from '../_lib/auth.js';
import { ensureM142Schema, safeJsonParse, parseRateStringToCents, normalizeSessionStatus } from '../_lib/billing_config.js';
import { getTutorPolicyForUserId } from '../_lib/ledger_ops.js';

export async function onRequestOptions(context) {
  return handleOptions(context, 'GET, POST, DELETE, OPTIONS');
}

export async function onRequestGet(context) {
  const auth = await requireTutorAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env } = context;
  await ensureM142Schema(env.DB);

  const u = new URL(request.url);
  const studentId = String(u.searchParams.get('studentId') || '').trim();
  const fromDate = String(u.searchParams.get('from') || '').trim();
  const toDate = String(u.searchParams.get('to') || '').trim();

  const where = ['school_id = ?'];
  const binds = [auth.user.school_id];
  if (studentId) {
    where.push('student_id = ?');
    binds.push(studentId);
  }
  if (fromDate) {
    where.push('session_date >= ?');
    binds.push(fromDate);
  }
  if (toDate) {
    where.push('session_date <= ?');
    binds.push(toDate);
  }

  const rows = await env.DB.prepare(
    `SELECT * FROM calendar_sessions WHERE ${where.join(' AND ')} ORDER BY session_date DESC, start_time ASC LIMIT 500`
  ).bind(...binds).all();

  return jsonResponse({
    ok: true,
    sessions: (rows && rows.results) || []
  }, 200, request, env);
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

  const studentId = String((body && body.studentId) || '').trim();
  const sessionDate = String((body && (body.sessionDate || body.date)) || '').trim();
  if (!studentId || !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
    return jsonResponse({ error: 'studentId and valid sessionDate (YYYY-MM-DD) are required' }, 400, request, env);
  }

  const stu = await env.DB.prepare('SELECT * FROM students WHERE id = ? AND school_id = ?')
    .bind(studentId, auth.user.school_id).first();
  if (!stu) return jsonResponse({ error: 'Student not found in workspace' }, 404, request, env);

  const policy = await getTutorPolicyForUserId(env.DB, auth.user.id);
  const profile = safeJsonParse(stu.profile_json, {});
  const parsedProf = parseRateStringToCents(profile.hourlyRate || '', policy.currency);
  const currency = String(stu.lesson_currency || parsedProf.currency || policy.currency || 'USD').toUpperCase();

  const csId = String(body.id || ('cs_' + crypto.randomUUID().replace(/-/g, '').slice(0, 18))).trim();
  const startTime = String(body.startTime || body.time || '4:30 PM').trim();
  const durationMinutes = Math.min(240, Math.max(15, Math.round(Number(body.durationMinutes || policy.defaultDurationMins || 60))));
  const topic = String(body.topic || stu.parsha_or_date || 'Tutoring Session').trim();
  const repeatWeekly = Boolean(body.repeatWeekly);
  const seriesId = String(body.seriesScheduleId || (repeatWeekly ? ('ser_' + csId) : '')).trim();
  const status = normalizeSessionStatus(body.status || 'scheduled');
  const nowIso = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO calendar_sessions (
      id, school_id, tutor_user_id, student_id, series_schedule_id, course_id, lesson_id,
      session_date, start_time, duration_minutes, topic, status, counts_as_taught,
      charge_cents, charge_overridden, currency, recap_summary, homework_assigned,
      next_to_teach, tutor_private_note, cancel_reason, recap_source,
      completed_at, canceled_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, '', '', '', '', '', 'calendar', '', '', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      session_date = excluded.session_date,
      start_time = excluded.start_time,
      duration_minutes = excluded.duration_minutes,
      topic = excluded.topic,
      updated_at = excluded.updated_at`
  ).bind(
    csId,
    auth.user.school_id,
    auth.user.id,
    stu.id,
    seriesId,
    String(body.courseId || ''),
    String(body.lessonId || ''),
    sessionDate,
    startTime,
    durationMinutes,
    topic,
    status,
    currency,
    nowIso,
    nowIso
  ).run();

  const schedule = safeJsonParse(stu.schedule_json, []).map(item => ({ ...(item || {}) }));
  const dateObj = new Date(`${sessionDate}T12:00:00`);
  const dayOfWeek = isNaN(dateObj.getDay()) ? 0 : dateObj.getDay();

  const existingSlotIdx = schedule.findIndex(s => s && (s.id === csId || (seriesId && s.id === seriesId)));
  const slotObj = {
    id: repeatWeekly ? (seriesId || csId) : csId,
    dateStr: sessionDate,
    dayOfWeek,
    time: startTime,
    durationMinutes,
    repeatWeekly,
    topic,
    status: status === 'canceled' ? 'cancelled' : status,
    completedAt: null
  };
  if (existingSlotIdx >= 0) schedule[existingSlotIdx] = { ...schedule[existingSlotIdx], ...slotObj };
  else schedule.push(slotObj);

  await env.DB.prepare('UPDATE students SET schedule_json = ?, updated_at = ? WHERE id = ? AND school_id = ?')
    .bind(JSON.stringify(schedule), nowIso, stu.id, auth.user.school_id).run();

  const saved = await env.DB.prepare('SELECT * FROM calendar_sessions WHERE id = ?').bind(csId).first();
  return jsonResponse({ ok: true, session: saved }, 201, request, env);
}
