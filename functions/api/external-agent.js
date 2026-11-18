/**
 * TutorPilot Universal External AI Gateway & Strict Capability Sandbox
 * Cloudflare Pages Function: GET/POST /api/external-agent
 *
 * Allows any external AI platform (ChatGPT, Claude, Gemini, Make/Zapier/n8n, or custom agents)
 * to connect to a tutor's TutorPilot workspace using a revocable per-user Bearer token (`tp_ext_...`).
 *
 * Strictly enforces ONLY the 3 declared capabilities of My Agent:
 *   1. End of Class Student Updates (`get_overview`, `log_after_class_update`)
 *   2. Calendar & Schedule Management (`schedule_lesson`, `cancel_lesson`)
 *   3. TutorPilot App Help (`get_app_guide`)
 *
 * Explicitly blocks student deletion, student creation, course/lesson mutation, settings edits,
 * cross-school access, and private guardian/billing PII leakage.
 */

const DEFAULT_SUPABASE_URL = 'https://bpkwnqbabokesuesvkex.supabase.co';
const DEFAULT_SUPABASE_KEY = 'sb_publishable_hVy0YYOOT9k_LD_ZMe24zg_iuqTC538';
const TOKEN_REGISTRY_ROW_ID = '__external_agent_tokens__';

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

function getSupabaseConfig(env) {
  const url = String((env && env.SUPABASE_URL) || DEFAULT_SUPABASE_URL).replace(/\/+$/, '');
  const key = String((env && (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY)) || DEFAULT_SUPABASE_KEY);
  return { url, key };
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
  const alt = request.headers.get('X-TutorPilot-Token') || '';
  return alt.trim();
}

async function supabaseRequest(cfg, path, options = {}) {
  const resp = await fetch(`${cfg.url}/rest/v1/${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Supabase REST error (${resp.status}): ${errText.slice(0, 200)}`);
  }
  if (resp.status === 204) return null;
  const text = await resp.text();
  return text ? JSON.parse(text) : null;
}

async function verifyExternalToken(rawToken, cfg) {
  if (!rawToken || !rawToken.startsWith('tp_ext_') || rawToken.length < 20) {
    return null;
  }
  const tokenHash = await sha256Hex(rawToken);
  const rows = await supabaseRequest(
    cfg,
    `students_sync?id=eq.${encodeURIComponent(TOKEN_REGISTRY_ROW_ID)}&select=id,completed_topics`
  );
  const registryRow = Array.isArray(rows) ? rows[0] : null;
  const tokensMap = (registryRow && registryRow.completed_topics && registryRow.completed_topics.tokens) || {};
  const record = tokensMap[tokenHash];
  if (!record || record.enabled === false || record.revokedAt) {
    return null;
  }
  const caps = record.capabilities || {};
  return {
    tokenHash,
    schoolId: String(record.schoolId || 'school_main_770'),
    ownerEmail: String(record.ownerEmail || '').toLowerCase().trim(),
    userId: String(record.userId || ''),
    tutorName: String(record.tutorName || 'Tutor'),
    capabilities: {
      afterClass: caps.afterClass !== false,
      schedule: caps.schedule !== false,
      appGuide: caps.appGuide !== false
    }
  };
}

function rowBelongsToToken(row, auth) {
  if (!row || !row.id || String(row.id).startsWith('__')) return false;
  const meta = (row.completed_topics && row.completed_topics._meta) || {};
  const rowSchoolId = String(meta.school_id || '');
  const rowOwner = String(meta.owner_email || '').toLowerCase().trim();
  const rowUid = String(meta.user_id || '');
  if (auth.schoolId && rowSchoolId && rowSchoolId === auth.schoolId) return true;
  if (auth.ownerEmail && rowOwner && rowOwner === auth.ownerEmail) return true;
  if (auth.userId && rowUid && rowUid === auth.userId) return true;
  return false;
}

function sanitizeStudentRow(row) {
  const meta = (row.completed_topics && row.completed_topics._meta) || {};
  const skills = meta.skills || {};
  const schedule = Array.isArray(meta.schedule) ? meta.schedule : [];
  // Strictly strip private guardian PII, hourlyRate, portal access codes, and raw private notes
  return {
    id: row.id,
    name: row.name || '',
    subject: meta.subject || '',
    status: meta.status || 'active',
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
    schedule: schedule.map(s => ({
      id: s.id || '',
      dateStr: s.dateStr || s.date || '',
      dayOfWeek: typeof s.dayOfWeek === 'number' ? s.dayOfWeek : null,
      repeatWeekly: Boolean(s.repeatWeekly),
      time: s.time || s.timeSlot || '',
      topic: s.topic || s.subject || '',
      status: s.status || 'scheduled'
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
    settings: 'Click your circular profile avatar at top-right of the sidebar to open Settings, where you can switch Warm Daylight vs Dark Mode, switch English vs Hebrew, toggle Hebrew Dates in the Schedule header and day grid, manage School & Team Workspace, Cloud Sync, and Connect External AI.'
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

async function handleAction(action, params, auth, cfg, cors) {
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
      {
        error: `Capability for "${action}" is currently disabled by the tutor in Settings -> Connect External AI.`
      },
      403,
      cors
    );
  }

  if (action === 'get_app_guide') {
    return jsonResponse({ success: true, ...buildTutorPilotAppGuide(params.topic) }, 200, cors);
  }

  // Fetch rows once for scoped school reads / mutations
  const allRows = await supabaseRequest(cfg, 'students_sync?select=id,name,parsha_or_date,notes,completed_topics,completed_parshiot,updated_at');
  const rowsArr = Array.isArray(allRows) ? allRows : [];
  const scopedStudents = rowsArr.filter(r => rowBelongsToToken(r, auth));

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

    // Include read-only course lesson titles (no private content) so external AI knows next sequential lesson
    const coursesRow = rowsArr.find(r => r && r.id && String(r.id).startsWith('__custom_courses__'));
    const rawCourses = (coursesRow && coursesRow.completed_topics && Array.isArray(coursesRow.completed_topics.courses))
      ? coursesRow.completed_topics.courses
      : [];
    const courseOutlines = rawCourses.slice(0, 20).map(c => ({
      id: c.id,
      title: c.title_en || c.title_he || '',
      lessons: (Array.isArray(c.lessons) ? c.lessons : []).slice(0, 30).map((l, idx) => ({
        lessonNumber: l.lesson_num || (idx + 1),
        title: l.title_en || l.title_he || ''
      }))
    }));

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
      {
        error: `Existing student not found in your workspace: "${targetQuery || ''}". External agents can only update existing students.`
      },
      404,
      cors
    );
  }

  const completedTopics = { ...(studentRow.completed_topics || {}) };
  const meta = { ...(completedTopics._meta || {}) };
  const skills = { ...(meta.skills || {}) };
  const schedule = Array.isArray(meta.schedule) ? meta.schedule.map(item => ({ ...item })) : [];
  let updatedNotes = String(studentRow.notes || '');

  if (action === 'log_after_class_update') {
    const today = new Date();
    const todayYMD = formatYmd(today);
    const todayDow = today.getDay();

    if (params.lastTaught !== undefined) {
      skills.lastTaught = String(params.lastTaught).trim();
      skills.lastTaughtAt = todayYMD;
    }
    if (params.nextToTeach !== undefined) {
      skills.nextToTeach = String(params.nextToTeach).trim();
    }
    if (params.homeworkTask !== undefined && String(params.homeworkTask).trim()) {
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
    if (markCompleted && params.lastTaught !== undefined) {
      const todaySess = schedule.find(
        s => s && ((s.dateStr === todayYMD) || (s.repeatWeekly && s.dayOfWeek === todayDow))
      );
      if (todaySess && todaySess.status !== 'cancelled') {
        todaySess.status = 'completed';
        todaySess.completedAt = today.toISOString();
        markedTodaySession = true;
      }
    }

    meta.skills = skills;
    meta.schedule = schedule;
    completedTopics._meta = meta;

    await supabaseRequest(cfg, `students_sync?id=eq.${encodeURIComponent(studentRow.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: {
        notes: updatedNotes,
        completed_topics: completedTopics,
        updated_at: new Date().toISOString()
      }
    });

    return jsonResponse(
      {
        success: true,
        action: 'log_after_class_update',
        student: sanitizeStudentRow({ ...studentRow, notes: updatedNotes, completed_topics: completedTopics }),
        markedTodaySessionCompleted: markedTodaySession
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
    meta.schedule = schedule;
    const lessonsMirror = Array.isArray(meta.lessons) ? [...meta.lessons] : [];
    lessonsMirror.push({
      id: newSession.id,
      date: dateStr,
      timeSlot,
      subject: topic,
      notes: topic,
      status: 'scheduled'
    });
    meta.lessons = lessonsMirror;
    completedTopics._meta = meta;

    await supabaseRequest(cfg, `students_sync?id=eq.${encodeURIComponent(studentRow.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: {
        completed_topics: completedTopics,
        updated_at: new Date().toISOString()
      }
    });

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
    meta.schedule = filteredSchedule;
    if (Array.isArray(meta.lessons)) {
      meta.lessons = meta.lessons.filter(l => {
        if (sessionId && l.id === sessionId) return false;
        if (dateStr && (l.date === dateStr || l.dateStr === dateStr)) return false;
        return true;
      });
    }
    completedTopics._meta = meta;

    await supabaseRequest(cfg, `students_sync?id=eq.${encodeURIComponent(studentRow.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: {
        completed_topics: completedTopics,
        updated_at: new Date().toISOString()
      }
    });

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
  const cfg = getSupabaseConfig(env);

  try {
    const rawToken = extractBearerToken(request);
    const auth = await verifyExternalToken(rawToken, cfg);
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
    return await handleAction(mappedAction, { topic }, auth, cfg, cors);
  } catch (err) {
    return jsonResponse({ error: err && err.message ? err.message : 'External Agent Gateway error.' }, 500, cors);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '*';
  const cors = buildCorsHeaders(origin);
  const cfg = getSupabaseConfig(env);

  try {
    const rawToken = extractBearerToken(request);
    const auth = await verifyExternalToken(rawToken, cfg);
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
    return await handleAction(action, body, auth, cfg, cors);
  } catch (err) {
    return jsonResponse({ error: err && err.message ? err.message : 'External Agent Gateway error.' }, 500, cors);
  }
}
