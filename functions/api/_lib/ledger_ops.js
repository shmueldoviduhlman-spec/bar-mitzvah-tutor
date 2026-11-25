/**
 * Shared Session Materialization, Atomic Recap & Balance Ledger Operations
 */

import {
  ensureM142Schema,
  safeJsonParse,
  parseRateStringToCents,
  normalizeTutorBillingPolicy,
  normalizeSessionStatus,
  computeSessionChargeCents,
  computeStudentLedgerSummary
} from './billing_config.js';

export function formatDateFriendly(dateStr) {
  try {
    const d = dateStr ? new Date(`${dateStr}T12:00:00`) : new Date();
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch (_) {
    return dateStr || '';
  }
}

export async function getTutorPolicyForUserId(db, tutorUserId) {
  if (!db || !tutorUserId) return normalizeTutorBillingPolicy({});
  try {
    const row = await db.prepare('SELECT billing_policy_json FROM users WHERE id = ?').bind(tutorUserId).first();
    return normalizeTutorBillingPolicy(row && row.billing_policy_json);
  } catch (_) {
    return normalizeTutorBillingPolicy({});
  }
}

export async function loadStudentBillingSnapshot(db, studentRow, tutorPolicy = null) {
  if (!db || !studentRow) {
    return {
      ledger: computeStudentLedgerSummary({ studentRow: studentRow || {} }),
      sessions: [],
      payments: [],
      paymentRequests: [],
      subscription: null,
      guardians: []
    };
  }
  await ensureM142Schema(db);
  const effectiveTutorId = studentRow.owner_user_id || '';
  const policy = tutorPolicy || (effectiveTutorId ? await getTutorPolicyForUserId(db, effectiveTutorId) : normalizeTutorBillingPolicy({}));

  const [sessRes, payRes, reqRes, subRow, guardRes] = await Promise.all([
    db.prepare('SELECT * FROM calendar_sessions WHERE student_id = ? ORDER BY session_date DESC, start_time DESC').bind(studentRow.id).all().catch(() => ({ results: [] })),
    db.prepare('SELECT * FROM lesson_payments WHERE student_id = ? ORDER BY paid_at DESC, created_at DESC').bind(studentRow.id).all().catch(() => ({ results: [] })),
    db.prepare('SELECT * FROM payment_requests WHERE student_id = ? ORDER BY created_at DESC').bind(studentRow.id).all().catch(() => ({ results: [] })),
    db.prepare('SELECT * FROM student_subscriptions WHERE student_id = ?').bind(studentRow.id).first().catch(() => null),
    db.prepare('SELECT * FROM student_guardians WHERE student_id = ? ORDER BY created_at ASC').bind(studentRow.id).all().catch(() => ({ results: [] }))
  ]);

  const sessions = (sessRes && sessRes.results) || [];
  const payments = (payRes && payRes.results) || [];
  const paymentRequests = (reqRes && reqRes.results) || [];
  const guardians = (guardRes && guardRes.results) || [];

  const ledger = computeStudentLedgerSummary({
    studentRow,
    sessions,
    payments,
    paymentRequests,
    tutorPolicy: policy
  });

  return { ledger, sessions, payments, paymentRequests, subscription: subRow || null, guardians };
}

export async function upsertCalendarSessionAndSyncStudent(db, {
  studentRow,
  tutorUser,
  body = {},
  defaultSource = 'manual'
}) {
  await ensureM142Schema(db);
  const nowIso = new Date().toISOString();
  const sessionDate = String(body.sessionDate || body.date || nowIso.slice(0, 10)).trim();
  const requestedId = String(body.sessionId || '').trim();
  const seriesId = String(body.seriesScheduleId || '').trim();
  const rawOutcome = body.outcome || body.status || 'completed';

  const tutorPolicy = await getTutorPolicyForUserId(db, tutorUser ? tutorUser.id : studentRow.owner_user_id);
  const profile = safeJsonParse(studentRow.profile_json, {});
  const parsedProf = parseRateStringToCents(profile.hourlyRate || '', tutorPolicy.currency);
  const studentRateCents = Number(studentRow.lesson_rate_cents || 0) || parsedProf.rateCents || tutorPolicy.defaultRateCents || 0;
  const currency = String(studentRow.lesson_currency || parsedProf.currency || tutorPolicy.currency || 'USD').toUpperCase();

  let overrideCents = body.overrideChargeCents;
  if (body.waiveFee === true) overrideCents = 0;

  const { status, countsAsTaught, chargeCents, chargeOverridden } = computeSessionChargeCents({
    status: rawOutcome,
    studentRateCents,
    tutorPolicy,
    studentCustomPolicy: safeJsonParse(studentRow.custom_billing_policy_json, {}),
    overrideChargeCents: overrideCents
  });

  let existingSess = null;
  if (requestedId) {
    existingSess = await db.prepare(
      'SELECT * FROM calendar_sessions WHERE id = ? AND student_id = ?'
    ).bind(requestedId, studentRow.id).first().catch(() => null);
  }
  if (!existingSess && seriesId) {
    existingSess = await db.prepare(
      'SELECT * FROM calendar_sessions WHERE student_id = ? AND session_date = ? AND series_schedule_id = ?'
    ).bind(studentRow.id, sessionDate, seriesId).first().catch(() => null);
  }
  if (!existingSess && !requestedId) {
    existingSess = await db.prepare(
      'SELECT * FROM calendar_sessions WHERE student_id = ? AND session_date = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(studentRow.id, sessionDate).first().catch(() => null);
  }

  // Pull time / topic / series context from matching schedule_json slot if present
  const schedule = safeJsonParse(studentRow.schedule_json, []).map(item => ({ ...(item || {}) }));
  const parsedDateObj = /^\d{4}-\d{2}-\d{2}$/.test(sessionDate) ? new Date(`${sessionDate}T12:00:00`) : new Date();
  const targetDow = parsedDateObj.getDay();

  const matchingSchedIdx = schedule.findIndex(item => {
    if (!item) return false;
    if (requestedId && item.id === requestedId) return true;
    if (seriesId && item.id === seriesId) return true;
    if (!item.repeatWeekly && (item.dateStr === sessionDate || item.date === sessionDate)) return true;
    if (item.repeatWeekly && Number(item.dayOfWeek) === targetDow) return true;
    return false;
  });

  const matchingSchedSlot = matchingSchedIdx >= 0 ? schedule[matchingSchedIdx] : null;
  const resolvedSeriesId = (existingSess && existingSess.series_schedule_id)
    || seriesId
    || (matchingSchedSlot && matchingSchedSlot.repeatWeekly ? matchingSchedSlot.id : '');

  const csId = (existingSess && existingSess.id)
    || (requestedId && requestedId.startsWith('cs_') ? requestedId : '')
    || ('cs_' + crypto.randomUUID().replace(/-/g, '').slice(0, 18));

  const startTime = String(body.startTime || body.time || (existingSess && existingSess.start_time) || (matchingSchedSlot && (matchingSchedSlot.time || matchingSchedSlot.timeSlot)) || '4:30 PM').trim();
  const durationMinutes = Math.min(240, Math.max(15, Math.round(Number(body.durationMinutes || (existingSess && existingSess.duration_minutes) || tutorPolicy.defaultDurationMins || 60))));
  const summaryTaught = body.summaryTaught !== undefined ? String(body.summaryTaught).trim() : (body.lastTaught !== undefined ? String(body.lastTaught).trim() : '');
  const homeworkAssigned = body.homeworkTask !== undefined ? String(body.homeworkTask).trim() : '';
  const nextToTeach = body.nextToTeach !== undefined ? String(body.nextToTeach).trim() : '';
  const cancelReason = body.cancelReason !== undefined ? String(body.cancelReason).trim() : '';
  const privateNote = body.privateNote !== undefined ? String(body.privateNote).trim() : '';
  const recapSource = String(body.recapSource || defaultSource || 'manual').trim();
  const topic = String(body.topic || (summaryTaught && status === 'completed' ? summaryTaught : '') || (existingSess && existingSess.topic) || (matchingSchedSlot && matchingSchedSlot.topic) || 'Tutoring Session').trim();

  const completedAt = status === 'completed' ? ((existingSess && existingSess.completed_at) || nowIso) : '';
  const canceledAt = (status === 'canceled' || status === 'late_canceled' || status === 'no_show')
    ? ((existingSess && existingSess.canceled_at) || nowIso)
    : '';

  await db.prepare(
    `INSERT INTO calendar_sessions (
      id, school_id, tutor_user_id, student_id, series_schedule_id, course_id, lesson_id,
      session_date, start_time, duration_minutes, topic, status, counts_as_taught,
      charge_cents, charge_overridden, currency, recap_summary, homework_assigned,
      next_to_teach, tutor_private_note, cancel_reason, recap_source,
      completed_at, canceled_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      start_time = excluded.start_time,
      duration_minutes = excluded.duration_minutes,
      topic = excluded.topic,
      status = excluded.status,
      counts_as_taught = excluded.counts_as_taught,
      charge_cents = excluded.charge_cents,
      charge_overridden = excluded.charge_overridden,
      currency = excluded.currency,
      recap_summary = CASE WHEN excluded.recap_summary != '' THEN excluded.recap_summary ELSE calendar_sessions.recap_summary END,
      homework_assigned = CASE WHEN excluded.homework_assigned != '' THEN excluded.homework_assigned ELSE calendar_sessions.homework_assigned END,
      next_to_teach = CASE WHEN excluded.next_to_teach != '' THEN excluded.next_to_teach ELSE calendar_sessions.next_to_teach END,
      tutor_private_note = CASE WHEN excluded.tutor_private_note != '' THEN excluded.tutor_private_note ELSE calendar_sessions.tutor_private_note END,
      cancel_reason = CASE WHEN excluded.cancel_reason != '' THEN excluded.cancel_reason ELSE calendar_sessions.cancel_reason END,
      recap_source = excluded.recap_source,
      completed_at = excluded.completed_at,
      canceled_at = excluded.canceled_at,
      updated_at = excluded.updated_at`
  ).bind(
    csId,
    studentRow.school_id,
    (tutorUser && tutorUser.id) || studentRow.owner_user_id,
    studentRow.id,
    resolvedSeriesId,
    String(body.courseId || (existingSess && existingSess.course_id) || ''),
    String(body.lessonId || (existingSess && existingSess.lesson_id) || ''),
    sessionDate,
    startTime,
    durationMinutes,
    topic,
    status,
    countsAsTaught,
    chargeCents,
    chargeOverridden,
    currency,
    summaryTaught,
    homeworkAssigned,
    nextToTeach,
    privateNote,
    cancelReason,
    recapSource,
    completedAt,
    canceledAt,
    (existingSess && existingSess.created_at) || nowIso,
    nowIso
  ).run();

  // Sync student skills_json, shared_notes_json, private_notes & schedule_json non-destructively
  const skills = safeJsonParse(studentRow.skills_json, {});
  const sharedNotes = safeJsonParse(studentRow.shared_notes_json, []);
  let updatedPrivateNotes = String(studentRow.private_notes || '');
  const legacyUiStatus = status === 'canceled' ? 'cancelled' : status;

  if (matchingSchedSlot) {
    if (matchingSchedSlot.repeatWeekly) {
      matchingSchedSlot.dateStatuses = (matchingSchedSlot.dateStatuses && typeof matchingSchedSlot.dateStatuses === 'object')
        ? { ...matchingSchedSlot.dateStatuses }
        : {};
      matchingSchedSlot.dateStatuses[sessionDate] = legacyUiStatus;
    } else {
      matchingSchedSlot.status = legacyUiStatus;
      matchingSchedSlot.completedAt = status === 'completed' ? completedAt : null;
      if (topic && summaryTaught && status === 'completed') matchingSchedSlot.topic = topic;
    }
    schedule[matchingSchedIdx] = matchingSchedSlot;
  } else if (status !== 'scheduled') {
    schedule.push({
      id: csId,
      dateStr: sessionDate,
      dayOfWeek: targetDow,
      time: startTime,
      repeatWeekly: false,
      topic,
      status: legacyUiStatus,
      completedAt: status === 'completed' ? completedAt : null
    });
  }

  if (status === 'completed') {
    if (summaryTaught) {
      skills.lastTaught = summaryTaught;
      skills.lastTaughtAt = sessionDate;
    }
    if (nextToTeach) {
      skills.nextToTeach = nextToTeach;
    }
    if (homeworkAssigned) {
      skills.homework = {
        task: homeworkAssigned,
        completed: false,
        assignedDate: formatDateFriendly(sessionDate)
      };
    }
    if (summaryTaught || homeworkAssigned) {
      const recapParts = [];
      if (summaryTaught) recapParts.push(`Lesson Recap: ${summaryTaught}`);
      if (homeworkAssigned) recapParts.push(`Practice / Homework: ${homeworkAssigned}`);
      const noteText = recapParts.join('\n');
      const existingNoteIdx = sharedNotes.findIndex(n => n && n.sessionId === csId);
      const entry = {
        id: existingNoteIdx >= 0 ? sharedNotes[existingNoteIdx].id : ('sn_' + csId),
        sessionId: csId,
        dateStr: sessionDate,
        dateLabel: formatDateFriendly(sessionDate),
        text: noteText
      };
      if (existingNoteIdx >= 0) sharedNotes[existingNoteIdx] = entry;
      else sharedNotes.push(entry);
    }
  } else if (status === 'canceled' || status === 'late_canceled' || status === 'no_show') {
    // Allow tutor to plan what to teach next even on canceled session, without overwriting lastTaught
    if (nextToTeach) skills.nextToTeach = nextToTeach;
  }

  if (privateNote) {
    const tag = `[${sessionDate}] ${privateNote}`;
    if (!updatedPrivateNotes.includes(tag)) {
      updatedPrivateNotes = updatedPrivateNotes ? `${updatedPrivateNotes.trim()}\n${tag}` : tag;
    }
  }

  skills._updatedAt = Date.now();
  await db.prepare(
    `UPDATE students
     SET private_notes = ?, shared_notes_json = ?, skills_json = ?, schedule_json = ?, updated_by = ?, updated_at = ?
     WHERE id = ? AND school_id = ?`
  ).bind(
    updatedPrivateNotes,
    JSON.stringify(sharedNotes),
    JSON.stringify(skills),
    JSON.stringify(schedule),
    (tutorUser && (tutorUser.full_name || tutorUser.email)) || 'Tutor',
    nowIso,
    studentRow.id,
    studentRow.school_id
  ).run();

  const [savedSession, savedStudent] = await Promise.all([
    db.prepare('SELECT * FROM calendar_sessions WHERE id = ?').bind(csId).first(),
    db.prepare('SELECT * FROM students WHERE id = ? AND school_id = ?').bind(studentRow.id, studentRow.school_id).first()
  ]);
  const snapshot = await loadStudentBillingSnapshot(db, savedStudent || studentRow, tutorPolicy);

  return {
    session: savedSession,
    studentRow: savedStudent || studentRow,
    ...snapshot
  };
}
