import { ensureM142Schema, normalizeSessionStatus, safeJsonParse } from '../_lib/billing_config.js';
import { sha256Hex } from '../_lib/crypto.js';

function escapeIcsText(str) {
  return String(str || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function parseStartTimeTo24h(timeStr) {
  const s = String(timeStr || '4:30 PM').trim();
  const m12 = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m12) {
    let h = parseInt(m12[1], 10);
    const mins = parseInt(m12[2], 10);
    const ap = m12[3].toUpperCase();
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return { h, mins };
  }
  const m24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) {
    return { h: parseInt(m24[1], 10), mins: parseInt(m24[2], 10) };
  }
  return { h: 16, mins: 30 };
}

function formatIcsLocalStamp(dateStr, timeStr, offsetMinutes = 0) {
  const clean = String(dateStr || '').replace(/[^0-9]/g, '');
  if (clean.length !== 8) return '20260101T160000';
  const y = parseInt(clean.slice(0, 4), 10);
  const mo = parseInt(clean.slice(4, 6), 10) - 1;
  const d = parseInt(clean.slice(6, 8), 10);
  const { h, mins } = parseStartTimeTo24h(timeStr);
  const dt = new Date(Date.UTC(y, mo, d, h, mins + offsetMinutes, 0));
  const pad = n => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}00`;
}

export async function buildUserCalendarFeedSignature(userId, secret) {
  const raw = `${userId || ''}:ics:${secret || 'tutorpilot-ics-fallback'}`;
  return (await sha256Hex(raw)).slice(0, 32);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env || !env.DB) {
    return new Response('Database unavailable', { status: 500 });
  }
  await ensureM142Schema(env.DB);
  const u = new URL(request.url);
  const uid = String(u.searchParams.get('u') || '').trim();
  const sig = String(u.searchParams.get('sig') || '').trim();
  if (!uid || !sig) {
    return new Response('Calendar feed signature required', { status: 401 });
  }
  const expected = await buildUserCalendarFeedSignature(uid, env.STUDENT_TOKEN_SECRET || env.API_KEY_ENCRYPTION_SECRET || '');
  if (sig !== expected) {
    return new Response('Invalid calendar feed signature', { status: 403 });
  }

  const user = await env.DB.prepare('SELECT id, school_id, full_name FROM users WHERE id = ?').bind(uid).first();
  if (!user) return new Response('Workspace not found', { status: 404 });

  const [studentsRes, sessionsRes] = await Promise.all([
    env.DB.prepare('SELECT id, name, schedule_json FROM students WHERE school_id = ? AND archived = 0').bind(user.school_id).all(),
    env.DB.prepare('SELECT * FROM calendar_sessions WHERE school_id = ? ORDER BY session_date DESC LIMIT 200').bind(user.school_id).all()
  ]);

  const studentsById = new Map();
  for (const s of ((studentsRes && studentsRes.results) || [])) {
    studentsById.set(s.id, s);
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TutorPilot//Schedule Sync//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(`${user.full_name || 'TutorPilot'} Lessons`)}`
  ];

  const concreteKeys = new Set();
  for (const cs of ((sessionsRes && sessionsRes.results) || [])) {
    const stu = studentsById.get(cs.student_id);
    if (!stu) continue;
    concreteKeys.add(`${cs.student_id}:${cs.session_date}:${cs.start_time}`);
    const st = normalizeSessionStatus(cs.status);
    const badge = st === 'completed'
      ? '[COMPLETED] '
      : st === 'canceled'
        ? '[CANCELED] '
        : st === 'late_canceled'
          ? '[LATE CANCELED] '
          : st === 'no_show'
            ? '[NO-SHOW] '
            : '';
    const icsStatus = (st === 'canceled' || st === 'late_canceled') ? 'CANCELLED' : 'CONFIRMED';
    const dtStart = formatIcsLocalStamp(cs.session_date, cs.start_time, 0);
    const dtEnd = formatIcsLocalStamp(cs.session_date, cs.start_time, Number(cs.duration_minutes || 60));
    const descParts = [];
    if (cs.topic) descParts.push(`Topic: ${cs.topic}`);
    if (cs.recap_summary) descParts.push(`Recap: ${cs.recap_summary}`);
    if (cs.homework_assigned) descParts.push(`Homework: ${cs.homework_assigned}`);
    if (cs.cancel_reason) descParts.push(`Status Note: ${cs.cancel_reason}`);

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${escapeIcsText(cs.id)}@tutorpilot.us`);
    lines.push(`DTSTART:${dtStart}`);
    lines.push(`DTEND:${dtEnd}`);
    lines.push(`STATUS:${icsStatus}`);
    lines.push(`SUMMARY:${escapeIcsText(`${badge}${stu.name}${cs.topic ? ' — ' + cs.topic : ''}`)}`);
    if (descParts.length > 0) lines.push(`DESCRIPTION:${escapeIcsText(descParts.join('\n'))}`);
    lines.push('END:VEVENT');
  }

  for (const stu of studentsById.values()) {
    const sched = safeJsonParse(stu.schedule_json, []);
    for (const slot of (Array.isArray(sched) ? sched : [])) {
      if (!slot || !slot.dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(slot.dateStr)) continue;
      if (concreteKeys.has(`${stu.id}:${slot.dateStr}:${slot.time || '4:30 PM'}`)) continue;
      const st = normalizeSessionStatus(slot.status || 'scheduled');
      const dtStart = formatIcsLocalStamp(slot.dateStr, slot.time || '4:30 PM', 0);
      const dtEnd = formatIcsLocalStamp(slot.dateStr, slot.time || '4:30 PM', Number(slot.durationMinutes || 60));
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${escapeIcsText(`${stu.id}_${slot.id || slot.dateStr}`)}@tutorpilot.us`);
      lines.push(`DTSTART:${dtStart}`);
      lines.push(`DTEND:${dtEnd}`);
      if (slot.repeatWeekly) lines.push('RRULE:FREQ=WEEKLY');
      lines.push(`STATUS:${st === 'canceled' ? 'CANCELLED' : 'CONFIRMED'}`);
      lines.push(`SUMMARY:${escapeIcsText(`${stu.name}${slot.topic ? ' — ' + slot.topic : ''}`)}`);
      lines.push('END:VEVENT');
    }
  }

  lines.push('END:VCALENDAR');
  return new Response(lines.join('\r\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="tutorpilot-schedule.ics"',
      'Cache-Control': 'no-cache'
    }
  });
}
