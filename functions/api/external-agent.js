/**
 * TutorPilot Universal External AI Gateway & Strict Capability Sandbox (Cloudflare D1)
 * Cloudflare Pages Function: GET/POST /api/external-agent
 *
 * Strictly enforces ONLY the 3 declared capabilities of My Agent:
 *   1. End of Class Student Updates (`get_overview`, `log_after_class_update`)
 *   2. Calendar & Schedule Management (`schedule_lesson`, `cancel_lesson`)
 *   3. TutorPilot Website Help Guide (`get_app_guide`)
 *
 * Explicitly blocks student deletion, student creation, course/lesson mutation,
 * settings edits, cross-school access, and private guardian/billing PII leakage.
 */

function normalizeExternalOutcome(raw) {
  const s = String(raw || 'completed').trim().toLowerCase().replace(/-/g, '_');
  if (s === 'cancelled' || s === 'cancel' || s === 'canceled') return 'canceled';
  if (s === 'late_cancelled' || s === 'late_cancel' || s === 'late_canceled') return 'late_canceled';
  if (s === 'no_show' || s === 'noshow' || s === 'missed') return 'no_show';
  if (s === 'scheduled') return 'scheduled';
  return 'completed';
}

const ALLOWED_ACTIONS = new Set([
  'get_overview',
  'log_after_class_update',
  'schedule_lesson',
  'cancel_lesson',
  'get_app_guide'
]);

const ACTION_REQUIRED_CAPABILITY = {
  get_overview: 'overview',
  log_after_class_update: 'afterClass',
  schedule_lesson: 'schedule',
  cancel_lesson: 'schedule',
  get_app_guide: 'appGuide'
};

function buildCorsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-TutorPilot-Token',
    'Access-Control-Max-Age': '86400'
  };
}

function jsonResponse(payload, status, cors) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
}

export async function sha256Hex(input) {
  const data = new TextEncoder().encode(String(input || ''));
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hashBuf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function formatYmd(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeTimeSlot(rawTime) {
  const str = String(rawTime || '').trim();
  if (!str) return '4:30 PM';
  const match24 = str.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    let h = parseInt(match24[1], 10);
    const mins = match24[2];
    const ampm = h >= 12 ? 'PM' : 'AM';
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return `${h}:${mins} ${ampm}`;
  }
  return str;
}

function extractBearerToken(request) {
  const authHeader = request.headers.get('Authorization') || '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  return (request.headers.get('X-TutorPilot-Token') || '').trim();
}

function safeParse(raw, fallback) {
  if (!raw || typeof raw !== 'string') return fallback;
  try { return JSON.parse(raw); } catch (_) { return fallback; }
}

async function verifyExternalToken(rawToken, env) {
  if (!rawToken || !rawToken.startsWith('tp_ext_') || rawToken.length < 20) {
    return null;
  }
  if (!env || !env.DB) return null;
  const tokenHash = await sha256Hex(rawToken);
  const row = await env.DB.prepare(
    `SELECT t.token_hash, t.user_id, t.school_id, t.capabilities_json, t.revoked_at,
            u.email, u.full_name, u.account_status, u.role, u.subscription_status, u.trial_ends_at, u.tutor_fee_waived
     FROM external_agent_tokens t
     LEFT JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ?`
  ).bind(tokenHash).first();

  if (!row || (row.revoked_at && String(row.revoked_at).trim() !== '')) {
    return null;
  }
  if (row.account_status === 'suspended') {
    return null;
  }

  await env.DB.prepare('UPDATE external_agent_tokens SET last_used_at = ? WHERE token_hash = ?')
    .bind(new Date().toISOString(), tokenHash).run().catch(() => {});

  const subSt = String(row.subscription_status || '').toLowerCase();
  const isLifetimeOrWaived = (row.role === 'super_admin') || subSt === 'lifetime' || subSt === 'active' || Number(row.tutor_fee_waived || 0) === 1;
  const trialExpired = subSt === 'trialing' && row.trial_ends_at && Date.parse(row.trial_ends_at) <= Date.now();
  const isReadOnly = !isLifetimeOrWaived && (subSt === 'expired' || subSt === 'canceled' || subSt === 'past_due' || trialExpired);

  const caps = safeParse(row.capabilities_json, {});
  return {
    tokenHash,
    schoolId: String(row.school_id || ''),
    ownerEmail: String(row.email || '').toLowerCase().trim(),
    userId: String(row.user_id || ''),
    tutorName: String(row.full_name || 'Tutor'),
    isReadOnly,
    capabilities: {
      afterClass: caps.afterClass !== false,
      schedule: caps.schedule !== false,
      appGuide: caps.appGuide !== false
    }
  };
}

function sanitizeStudentRow(row) {
  const profile = safeParse(row.profile_json, {});
  const skills = safeParse(row.skills_json, {});
  const schedule = safeParse(row.schedule_json, []);
  return {
    id: row.id,
    name: row.name || '',
    subject: profile.subject || row.parsha_or_date || '',
    status: row.status || 'active',
    lastTaught: String(skills.lastTaught || ''),
    lastTaughtAt: String(skills.lastTaughtAt || ''),
    nextToTeach: String(skills.nextToTeach || ''),
    homework: skills.homework && skills.homework.task
      ? {
          task: String(skills.homework.task),
          completed: Boolean(skills.homework.completed),
          assignedDate: String(skills.homework.assignedDate || '')
        }
      : null,
    schedule: (Array.isArray(schedule) ? schedule : []).map(s => ({
      id: (s && s.id) || '',
      dateStr: (s && (s.dateStr || s.date)) || '',
      dayOfWeek: s && typeof s.dayOfWeek === 'number' ? s.dayOfWeek : null,
      repeatWeekly: Boolean(s && s.repeatWeekly),
      time: (s && (s.time || s.timeSlot)) || '',
      topic: (s && (s.topic || s.subject)) || '',
      status: (s && s.status) || 'scheduled'
    }))
  };
}

function findScopedStudent(rows, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return null;
  let match = rows.find(r => String(r.id || '').toLowerCase() === q);
  if (match) return match;
  match = rows.find(r => String(r.name || '').trim().toLowerCase() === q);
  if (match) return match;
  return rows.find(r => String(r.name || '').toLowerCase().includes(q)) || null;
}

function buildTutorPilotAppGuide(topic) {
  const sections = {
    overview: 'TutorPilot is a tutoring workspace with 4 main tabs (Courses, Students, Schedule, My Agent) plus a live Today\'s Overview directly under Workspace in the sidebar.',
    navigation: 'On desktop, click the circular parchment scroll logo at top-left to roll up or unroll the sidebar. On both desktop and mobile, native Back button and swipe-back gestures step back cleanly across tabs, courses, lessons, schedule dates, student drawers, and Settings sub-sections.',
    courses: 'Open Courses to view visual course cards. Click any course to see a numbered vertical lesson list, add a lesson (+ New Lesson), or click Edit Course with AI (which also contains the double-confirmed Delete Course action). Click any lesson to read it cleanly or click Edit with AI.',
    students: 'Open Students to browse your roster. Click any student to open their 2-tab profile: Tab 1 (Progress & Tutor Notes) shows Teaching Continuity (Last Taught & Next to Teach), course checklists, and private tutor notes; Tab 2 (Student Portal & Shared) manages the Student Portal invite code, homework, goals, and shared notes.',
    schedule: 'Open Schedule for a full-width Month or Week calendar. Click any date to enter that date\'s clean view showing scheduled students and times, then click any student to inspect or edit what to teach him, mark attendance, or jump to AI After Class.',
    today_overview: 'Today\'s Overview sits right under Workspace in the sidebar and lists today\'s scheduled students, their class times, and what you need to teach each student next.',
    my_agent: 'Open My Agent to speak or type after any class what you taught today, schedule or cancel lessons, or ask how TutorPilot works.',
    settings: 'Click your circular profile avatar at top-right of the sidebar to open Settings, where you can switch Warm Daylight vs Dark Mode, switch English vs Hebrew, toggle Hebrew Dates in the Schedule header and day grid, manage School & Team Workspace, AI API Keys, and Connect External AI.'
  };
  const key = String(topic || '').trim().toLowerCase();
  return {
    appName: 'TutorPilot',
    requestedTopic: key || 'all',
    guide: sections,
    declaredExternalCapabilities: [
      '1. End of Class Student Updates (get_overview, log_after_class_update)',
      '2. Calendar & Schedule Management (schedule_lesson, cancel_lesson)',
      '3. TutorPilot Website Help Guide (get_app_guide)'
    ]
  };
}

function isCapabilityAllowed(auth, action) {
  const req = ACTION_REQUIRED_CAPABILITY[action];
  if (req === 'overview') {
    return Boolean(auth.capabilities.afterClass || auth.capabilities.schedule);
  }
  return Boolean(auth.capabilities[req]);
}

async function handleAction(action, params, auth, env, cors) {
  if (!ALLOWED_ACTIONS.has(action)) {
    return jsonResponse(
      {
        error: `Action "${action || ''}" is not permitted for external AI agents. External agents cannot delete students, create students, edit courses, or modify account settings.`,
        allowedActions: Array.from(ALLOWED_ACTIONS)
      },
      403,
      cors
    );
  }

  if (!isCapabilityAllowed(auth, action)) {
    return jsonResponse(
      { error: `Capability for "${action}" is currently disabled by the tutor in Settings -> Connect External AI.` },
      403,
      cors
    );
  }

  if (action === 'get_app_guide') {
    return jsonResponse({ success: true, ...buildTutorPilotAppGuide(params.topic) }, 200, cors);
  }

  if (auth.isReadOnly && action !== 'get_overview') {
    return jsonResponse(
      { error: 'Account is in Read-Only Mode. Reactivate subscription in TutorPilot Settings to log updates or modify schedule.', code: 'SUBSCRIPTION_READ_ONLY', readOnly: true },
      402,
      cors
    );
  }

  const studentsRes = await env.DB.prepare(
    'SELECT * FROM students WHERE school_id = ? AND archived = 0 ORDER BY sort_order ASC, name ASC'
  ).bind(auth.schoolId).all();
  const scopedStudents = (studentsRes && studentsRes.results) || [];

  if (action === 'get_overview') {
    const today = new Date();
    const todayYMD = formatYmd(today);
    const todayDow = today.getDay();
    const students = scopedStudents.map(sanitizeStudentRow);

    const todayClasses = [];
    students.forEach(st => {
      (st.schedule || []).forEach(s => {
        if ((s.repeatWeekly && s.dayOfWeek === todayDow) || (!s.repeatWeekly && s.dateStr === todayYMD)) {
          todayClasses.push({
            studentId: st.id,
            studentName: st.name,
            sessionId: s.id,
            time: s.time,
            status: s.status,
            whatToTeach: (s.topic && s.topic !== 'Tutoring Session' && s.topic !== 'שיעור פרטי')
              ? s.topic
              : (st.nextToTeach || st.subject || '')
          });
        }
      });
    });

    const coursesRes = await env.DB.prepare(
      "SELECT id, title, data_json FROM courses WHERE school_id = ? AND archived = 0 AND (deleted_at IS NULL OR deleted_at = '') LIMIT 20"
    ).bind(auth.schoolId).all();
    const courseOutlines = ((coursesRes && coursesRes.results) || []).map(row => {
      const c = safeParse(row.data_json, {});
      return {
        id: row.id,
        title: c.title || row.title || '',
        lessons: (Array.isArray(c.lessons) ? c.lessons : []).slice(0, 30).map((l, idx) => ({
          lessonNumber: l.lesson_num || (idx + 1),
          title: l.title || l.title_en || l.title_he || ''
        }))
      };
    });

    return jsonResponse(
      {
        success: true,
        date: todayYMD,
        schoolId: auth.schoolId,
        todayClasses,
        students,
        courseOutlines
      },
      200,
      cors
    );
  }

  const targetQuery = params.studentNameOrId || params.studentName || params.studentId;
  const studentRow = findScopedStudent(scopedStudents, targetQuery);
  if (!studentRow) {
    return jsonResponse(
      { error: `Existing student not found in your workspace: "${targetQuery || ''}". External agents can only update existing students.` },
      404,
      cors
    );
  }

  const skills = safeParse(studentRow.skills_json, {});
  const schedule = safeParse(studentRow.schedule_json, []).map(item => ({ ...item }));
  let updatedNotes = String(studentRow.private_notes || '');

  if (action === 'log_after_class_update') {
    const today = new Date();
    const todayYMD = String(params.date || formatYmd(today)).trim();
    const todayDow = (new Date(`${todayYMD}T12:00:00`)).getDay();
    const outcome = params.sessionOutcome ? normalizeExternalOutcome(params.sessionOutcome) : 'completed';
    const isMissed = outcome === 'canceled' || outcome === 'late_canceled' || outcome === 'no_show';

    if (!isMissed && params.lastTaught !== undefined) {
      skills.lastTaught = String(params.lastTaught).trim();
      skills.lastTaughtAt = todayYMD;
    }
    if (params.nextToTeach !== undefined) {
      skills.nextToTeach = String(params.nextToTeach).trim();
    }
    if (!isMissed && params.homeworkTask !== undefined && String(params.homeworkTask).trim()) {
      skills.homework = {
        task: String(params.homeworkTask).trim(),
        completed: false,
        assignedDate: today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      };
    }
    if (params.appendNote !== undefined && String(params.appendNote).trim()) {
      const piece = String(params.appendNote).trim();
      updatedNotes = updatedNotes ? `${updatedNotes.trim()}\n[${todayYMD}] ${piece}` : `[${todayYMD}] ${piece}`;
    }

    const markCompleted = params.markTodayCompleted !== false;
    let markedTodaySession = false;
    const todaySess = schedule.find(
      s => s && ((s.dateStr === todayYMD) || (s.repeatWeekly && s.dayOfWeek === todayDow))
    );
    if (isMissed || (markCompleted && params.lastTaught !== undefined)) {
      const targetUiStatus = outcome === 'canceled' ? 'cancelled' : outcome;
      if (todaySess) {
        if (todaySess.repeatWeekly && isMissed) {
          todaySess.dateStatuses = { ...(todaySess.dateStatuses || {}), [todayYMD]: targetUiStatus };
        } else if (todaySess.status !== 'cancelled' || isMissed) {
          todaySess.status = targetUiStatus;
          todaySess.completedAt = outcome === 'completed' ? today.toISOString() : null;
        }
        markedTodaySession = true;
      }
    }

    skills._updatedAt = Date.now();
    const nowIso = new Date().toISOString();
    await env.DB.prepare(
      'UPDATE students SET private_notes = ?, skills_json = ?, schedule_json = ?, updated_at = ? WHERE id = ? AND school_id = ?'
    ).bind(updatedNotes, JSON.stringify(skills), JSON.stringify(schedule), nowIso, studentRow.id, auth.schoolId).run();

    try {
      const tutorRow = await env.DB.prepare('SELECT billing_policy_json FROM users WHERE id = ?').bind(auth.userId).first();
      const policy = safeParse(tutorRow && tutorRow.billing_policy_json, {});
      const rateCents = Number(studentRow.lesson_rate_cents || 0) || Number(policy.defaultRateCents || 0);
      const currency = String(studentRow.lesson_currency || policy.currency || 'USD');
      let chargeCents = 0;
      if (params.waiveFee === true) {
        chargeCents = 0;
      } else if (outcome === 'completed') {
        chargeCents = rateCents;
      } else if (isMissed) {
        const ruleKey = outcome === 'canceled' ? 'cancelRule' : (outcome === 'late_canceled' ? 'lateCancelRule' : 'noShowRule');
        const r = (policy && policy[ruleKey]) || { mode: 'free', value: 0 };
        if (r.mode === 'percent') chargeCents = Math.round((rateCents * Number(r.value || 0)) / 100);
        else if (r.mode === 'flat') chargeCents = Math.max(0, Math.round(Number(r.value || 0)));
      }
      const existingCs = await env.DB.prepare(
        'SELECT id FROM calendar_sessions WHERE student_id = ? AND session_date = ? LIMIT 1'
      ).bind(studentRow.id, todayYMD).first();
      const csId = (existingCs && existingCs.id) || `cs_ext_${todayYMD}_${studentRow.id.slice(-8)}`;
      await env.DB.prepare(
        `INSERT INTO calendar_sessions (
          id, school_id, tutor_user_id, student_id, series_schedule_id, course_id, lesson_id,
          session_date, start_time, duration_minutes, topic, status, counts_as_taught,
          charge_cents, charge_overridden, currency, recap_summary, homework_assigned,
          next_to_teach, tutor_private_note, cancel_reason, recap_source,
          completed_at, canceled_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, '', '', ?, ?, 60, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'external_agent', ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          counts_as_taught = excluded.counts_as_taught,
          charge_cents = excluded.charge_cents,
          recap_summary = CASE WHEN excluded.recap_summary != '' THEN excluded.recap_summary ELSE calendar_sessions.recap_summary END,
          homework_assigned = CASE WHEN excluded.homework_assigned != '' THEN excluded.homework_assigned ELSE calendar_sessions.homework_assigned END,
          next_to_teach = CASE WHEN excluded.next_to_teach != '' THEN excluded.next_to_teach ELSE calendar_sessions.next_to_teach END,
          cancel_reason = CASE WHEN excluded.cancel_reason != '' THEN excluded.cancel_reason ELSE calendar_sessions.cancel_reason END,
          updated_at = excluded.updated_at`
      ).bind(
        csId,
        auth.schoolId,
        auth.userId,
        studentRow.id,
        (todaySess && todaySess.repeatWeekly) ? (todaySess.id || '') : '',
        todayYMD,
        (todaySess && (todaySess.time || todaySess.timeSlot)) || '4:30 PM',
        (!isMissed && params.lastTaught) ? String(params.lastTaught).trim() : ((todaySess && todaySess.topic) || 'Tutoring Session'),
        outcome,
        outcome === 'completed' ? 1 : 0,
        chargeCents,
        params.waiveFee === true ? 1 : 0,
        currency,
        !isMissed ? String(params.lastTaught || '').trim() : '',
        !isMissed ? String(params.homeworkTask || '').trim() : '',
        String(params.nextToTeach || '').trim(),
        String(params.appendNote || '').trim(),
        isMissed ? String(params.cancelReason || params.appendNote || outcome).trim() : '',
        outcome === 'completed' ? nowIso : '',
        isMissed ? nowIso : '',
        nowIso,
        nowIso
      ).run();
    } catch (_) {}

    return jsonResponse(
      {
        success: true,
        action: 'log_after_class_update',
        sessionOutcome: outcome,
        student: sanitizeStudentRow({
          ...studentRow,
          private_notes: updatedNotes,
          skills_json: JSON.stringify(skills),
          schedule_json: JSON.stringify(schedule)
        }),
        markedTodaySessionCompleted: outcome === 'completed' && markedTodaySession
      },
      200,
      cors
    );
  }

  if (action === 'schedule_lesson') {
    const dateStr = String(params.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return jsonResponse({ error: 'Valid date in YYYY-MM-DD format is required.' }, 400, cors);
    }
    const timeSlot = normalizeTimeSlot(params.timeSlot || params.time || '4:30 PM');
    const topic = String(params.topic || params.subject || skills.nextToTeach || 'Tutoring Session').trim();
    const parsedDate = new Date(`${dateStr}T12:00:00`);
    const newSession = {
      id: `ext_les_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      dateStr,
      dayOfWeek: parsedDate.getDay(),
      time: timeSlot,
      repeatWeekly: Boolean(params.repeatWeekly),
      topic,
      status: 'scheduled',
      completedAt: null
    };
    schedule.push(newSession);
    const nowIso = new Date().toISOString();
    await env.DB.prepare(
      'UPDATE students SET schedule_json = ?, updated_at = ? WHERE id = ? AND school_id = ?'
    ).bind(JSON.stringify(schedule), nowIso, studentRow.id, auth.schoolId).run();

    return jsonResponse(
      {
        success: true,
        action: 'schedule_lesson',
        studentName: studentRow.name,
        session: newSession
      },
      200,
      cors
    );
  }

  if (action === 'cancel_lesson') {
    const dateStr = String(params.date || '').trim();
    const sessionId = String(params.sessionId || '').trim();
    if (!dateStr && !sessionId) {
      return jsonResponse({ error: 'Provide date (YYYY-MM-DD) or sessionId to cancel a scheduled lesson.' }, 400, cors);
    }
    const beforeCount = schedule.length;
    const filteredSchedule = schedule.filter(s => {
      if (sessionId && s.id === sessionId) return false;
      if (dateStr && s.dateStr === dateStr) return false;
      return true;
    });
    const removedCount = beforeCount - filteredSchedule.length;
    const nowIso = new Date().toISOString();
    await env.DB.prepare(
      'UPDATE students SET schedule_json = ?, updated_at = ? WHERE id = ? AND school_id = ?'
    ).bind(JSON.stringify(filteredSchedule), nowIso, studentRow.id, auth.schoolId).run();

    return jsonResponse(
      {
        success: true,
        action: 'cancel_lesson',
        studentName: studentRow.name,
        removedCount
      },
      200,
      cors
    );
  }

  return jsonResponse({ error: 'Unsupported action.' }, 403, cors);
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get('Origin') || '*';
  return new Response(null, { status: 204, headers: buildCorsHeaders(origin) });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '*';
  const cors = buildCorsHeaders(origin);

  try {
    const rawToken = extractBearerToken(request);
    const auth = await verifyExternalToken(rawToken, env);
    if (!auth) {
      return jsonResponse(
        { error: 'Unauthorized. Provide a valid TutorPilot Personal Connection Token (Authorization: Bearer tp_ext_...).' },
        401,
        cors
      );
    }

    const url = new URL(request.url);
    const rawAction = (url.searchParams.get('action') || 'overview').trim().toLowerCase();
    const mappedAction = rawAction === 'overview'
      ? 'get_overview'
      : (rawAction === 'guide' ? 'get_app_guide' : rawAction);
    const topic = url.searchParams.get('topic') || '';
    return await handleAction(mappedAction, { topic }, auth, env, cors);
  } catch (err) {
    return jsonResponse({ error: err && err.message ? err.message : 'External Agent Gateway error.' }, 500, cors);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '*';
  const cors = buildCorsHeaders(origin);

  try {
    const rawToken = extractBearerToken(request);
    const auth = await verifyExternalToken(rawToken, env);
    if (!auth) {
      return jsonResponse(
        { error: 'Unauthorized. Provide a valid TutorPilot Personal Connection Token (Authorization: Bearer tp_ext_...).' },
        401,
        cors
      );
    }

    let body = {};
    try {
      body = await request.json();
    } catch (_) {
      return jsonResponse({ error: 'Invalid JSON request body.' }, 400, cors);
    }

    const action = String(body.action || '').trim();
    return await handleAction(action, body, auth, env, cors);
  } catch (err) {
    return jsonResponse({ error: err && err.message ? err.message : 'External Agent Gateway error.' }, 500, cors);
  }
}
