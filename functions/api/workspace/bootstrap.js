import { handleOptions, jsonResponse } from '../_lib/cors.js';
import { requireTutorAuth, getPlatformSettings, hasActivePlanAccess } from '../_lib/auth.js';
import {
  ensureM142Schema,
  getBillingConfig,
  normalizeTutorBillingPolicy,
  normalizePayoutMethods,
  computeStudentLedgerSummary
} from '../_lib/billing_config.js';
import { reconcileTutorBillingState, evaluateStudentPortalAccess } from '../_lib/reconcile_billing.js';
import { buildUserCalendarFeedSignature } from '../calendar/ics.js';

function safeJsonParse(raw, fallback) {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

export function mapStudentRowToClient(row) {
  const profile = safeJsonParse(row.profile_json, {});
  const sharedNotes = safeJsonParse(row.shared_notes_json, []);
  const skills = safeJsonParse(row.skills_json, {});
  const schedule = safeJsonParse(row.schedule_json, []);
  const progress = safeJsonParse(row.progress_json, {});
  const mediaKey = String(row.avatar_media_key || '');
  const avatarUrl = mediaKey
    ? (mediaKey.startsWith('/') || mediaKey.startsWith('http') || mediaKey.startsWith('data:')
        ? mediaKey
        : `/api/media/${encodeURIComponent(mediaKey)}`)
    : (profile.avatar || '');

  return {
    id: row.id,
    name: row.name,
    subject: profile.subject || row.parsha_or_date || '',
    parshaOrDate: row.parsha_or_date || profile.gradeOrDate || '',
    gradeOrDate: profile.gradeOrDate || row.parsha_or_date || '',
    gradeLevel: profile.gradeLevel || 'Standard / All Levels',
    notes: row.private_notes || '',
    hourlyRate: profile.hourlyRate || '',
    status: row.status || 'active',
    archived: !!row.archived,
    archivedAt: row.archived_at || '',
    orderIndex: typeof row.sort_order === 'number' ? row.sort_order : 0,
    avatar: avatarUrl,
    avatarMediaKey: mediaKey,
    parentContact: profile.parentContact || { name: '', phone: '', email: '' },
    studentContact: profile.studentContact || { phone: '', email: '' },
    outreachLog: profile.outreachLog && typeof profile.outreachLog === 'object' ? profile.outreachLog : {},
    studentAccessCode: row.access_code || '',
    sharedNotes: Array.isArray(sharedNotes) ? sharedNotes : [],
    skills: skills && typeof skills === 'object' ? skills : {},
    schedule: Array.isArray(schedule) ? schedule : [],
    lessons: Array.isArray(profile.lessons) ? profile.lessons : [],
    completedTopics: progress.completedTopics && typeof progress.completedTopics === 'object' ? progress.completedTopics : {},
    completedParshiot: progress.completedParshiot && typeof progress.completedParshiot === 'object' ? progress.completedParshiot : {},
    schoolId: row.school_id,
    ownerUserId: row.owner_user_id,
    lastUpdatedBy: row.updated_by || '',
    updatedAt: row.updated_at || '',
    learnerType: row.learner_type || profile.learnerType || 'child',
    portalStatus: row.portal_status || 'not_activated',
    lessonRateCents: Number(row.lesson_rate_cents || 0),
    lessonCurrency: row.lesson_currency || 'USD',
    customBillingPolicy: safeJsonParse(row.custom_billing_policy_json, {}),
    openingLessonsTaught: Number(row.opening_lessons_taught || 0),
    openingBalanceCents: Number(row.opening_balance_cents || 0)
  };
}

export async function onRequestOptions(context) {
  return handleOptions(context, 'GET, OPTIONS');
}

export async function onRequestGet(context) {
  const auth = await requireTutorAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env } = context;
  const { user } = auth;
  const db = env.DB;

  const settings = await getPlatformSettings(db);
  const billingConfig = getBillingConfig(env, settings);
  await ensureM142Schema(db);
  const todayUtc = new Date().toISOString().slice(0, 10);

  const [schoolRow, membersRes, studentsRes, coursesRes, collectionsRes, keyRow, usageRow, sessionsRes, paymentsRes, requestsRes, subsRes, earningsRes, guardiansRes, tutorBilling] = await Promise.all([
    db.prepare('SELECT id, name, owner_user_id, join_code, created_at FROM schools WHERE id = ?').bind(user.school_id).first(),
    db.prepare(
      `SELECT sm.user_id, sm.role AS member_role, sm.joined_at, u.email, u.full_name, u.display_name_he
       FROM school_members sm
       LEFT JOIN users u ON u.id = sm.user_id
       WHERE sm.school_id = ?
       ORDER BY sm.joined_at ASC`
    ).bind(user.school_id).all(),
    db.prepare('SELECT * FROM students WHERE school_id = ? ORDER BY sort_order ASC, name ASC').bind(user.school_id).all(),
    db.prepare("SELECT * FROM courses WHERE school_id = ? AND (deleted_at IS NULL OR deleted_at = '') ORDER BY created_at ASC").bind(user.school_id).all(),
    db.prepare('SELECT collection_type, data_json, updated_at FROM curriculum_collections WHERE school_id = ?').bind(user.school_id).all(),
    db.prepare('SELECT key_hint, label, updated_at FROM user_api_keys WHERE user_id = ?').bind(user.id).first(),
    db.prepare('SELECT standard_count, pro_count, used_custom_key_count FROM ai_usage_daily WHERE user_id = ? AND date_utc = ?').bind(user.id, todayUtc).first(),
    db.prepare('SELECT * FROM calendar_sessions WHERE school_id = ? ORDER BY session_date DESC, start_time ASC LIMIT 800').bind(user.school_id).all().catch(() => ({ results: [] })),
    db.prepare('SELECT * FROM lesson_payments WHERE school_id = ? ORDER BY paid_at DESC LIMIT 500').bind(user.school_id).all().catch(() => ({ results: [] })),
    db.prepare('SELECT * FROM payment_requests WHERE school_id = ? ORDER BY created_at DESC LIMIT 300').bind(user.school_id).all().catch(() => ({ results: [] })),
    db.prepare('SELECT * FROM student_subscriptions WHERE school_id = ?').bind(user.school_id).all().catch(() => ({ results: [] })),
    db.prepare('SELECT * FROM tutor_earnings_ledger WHERE tutor_user_id = ? ORDER BY created_at DESC LIMIT 50').bind(user.id).all().catch(() => ({ results: [] })),
    db.prepare('SELECT * FROM student_guardians WHERE school_id = ?').bind(user.school_id).all().catch(() => ({ results: [] })),
    reconcileTutorBillingState(db, env, user.id, user).catch(() => null)
  ]);

  const tutorPolicy = normalizeTutorBillingPolicy(user.billing_policy_json);
  const payoutMethods = normalizePayoutMethods(user.payout_methods_json);
  const sessionsByStudent = new Map();
  for (const cs of ((sessionsRes && sessionsRes.results) || [])) {
    if (!sessionsByStudent.has(cs.student_id)) sessionsByStudent.set(cs.student_id, []);
    sessionsByStudent.get(cs.student_id).push(cs);
  }
  const paymentsByStudent = new Map();
  for (const lp of ((paymentsRes && paymentsRes.results) || [])) {
    if (!paymentsByStudent.has(lp.student_id)) paymentsByStudent.set(lp.student_id, []);
    paymentsByStudent.get(lp.student_id).push(lp);
  }
  const requestsByStudent = new Map();
  for (const pr of ((requestsRes && requestsRes.results) || [])) {
    if (!requestsByStudent.has(pr.student_id)) requestsByStudent.set(pr.student_id, []);
    requestsByStudent.get(pr.student_id).push(pr);
  }
  const subByStudent = new Map();
  for (const sub of ((subsRes && subsRes.results) || [])) {
    subByStudent.set(sub.student_id, sub);
  }
  const guardiansByStudent = new Map();
  for (const g of ((guardiansRes && guardiansRes.results) || [])) {
    if (!guardiansByStudent.has(g.student_id)) guardiansByStudent.set(g.student_id, []);
    guardiansByStudent.get(g.student_id).push(g);
  }

  const students = ((studentsRes && studentsRes.results) || []).map(row => {
    const mapped = mapStudentRowToClient(row);
    const stuSessions = sessionsByStudent.get(row.id) || [];
    const stuPayments = paymentsByStudent.get(row.id) || [];
    const stuRequests = requestsByStudent.get(row.id) || [];
    const stuSub = subByStudent.get(row.id) || null;
    const stuAccess = evaluateStudentPortalAccess(stuSub, row);
    const ledger = computeStudentLedgerSummary({
      studentRow: row,
      sessions: stuSessions,
      payments: stuPayments,
      paymentRequests: stuRequests,
      tutorPolicy
    });
    return {
      ...mapped,
      portalStatus: stuAccess.portalStatus,
      portalAccess: stuAccess,
      subscription: stuSub ? {
        status: stuSub.status,
        trialEndsAt: stuSub.trial_ends_at || '',
        currentPeriodEnd: stuSub.current_period_end || '',
        payerRole: stuSub.payer_role || 'parent',
        priceCents: Number(stuSub.price_cents || billingConfig.parentSubscriptionPriceCents)
      } : null,
      ledger,
      sessionInstances: stuSessions.slice(0, 60),
      recentPayments: stuPayments.slice(0, 20),
      guardians: (guardiansByStudent.get(row.id) || []).map(g => ({
        email: g.guardian_email,
        name: g.guardian_name || '',
        phone: g.guardian_phone || '',
        relationship: g.relationship || 'parent',
        linked: Boolean(g.guardian_user_id)
      }))
    };
  });

  const rawAccType = String(user.account_type || 'tutor').toLowerCase();
  let linkedAsFamily = false;
  if (rawAccType === 'parent' || rawAccType === 'adult_student') {
    const ownedCount = students.filter(s => s.ownerUserId === user.id).length;
    if (ownedCount === 0) linkedAsFamily = true;
  }

  const icsSig = await buildUserCalendarFeedSignature(user.id, env.STUDENT_TOKEN_SECRET || env.API_KEY_ENCRYPTION_SECRET || '');
  const appOrigin = String((env && env.APP_ORIGIN) || new URL(request.url).origin).replace(/\/+$/, '');
  const calendarIcsUrl = `${appOrigin}/api/calendar/ics?u=${encodeURIComponent(user.id)}&sig=${icsSig}`;
  const effectiveAccessMode = tutorBilling ? tutorBilling.accessMode : (hasActivePlanAccess(user) ? 'full' : 'read_only');
  const courses = ((coursesRes && coursesRes.results) || []).map(row => {
    const parsed = safeJsonParse(row.data_json, {});
    return {
      ...parsed,
      id: row.id,
      title: parsed.title || parsed.title_en || parsed.title_he || row.title || 'Untitled Course',
      archived: !!row.archived,
      archivedAt: row.archived_at || '',
      school_id: row.school_id,
      updatedAt: row.updated_at
    };
  });

  const collections = { readingMaterials: [], milestones: [], studyAdditions: {} };
  for (const cRow of ((collectionsRes && collectionsRes.results) || [])) {
    const parsed = safeJsonParse(cRow.data_json, null);
    if (cRow.collection_type === 'reading_materials' && Array.isArray(parsed)) collections.readingMaterials = parsed;
    if (cRow.collection_type === 'milestones' && Array.isArray(parsed)) collections.milestones = parsed;
    if (cRow.collection_type === 'study_materials' && parsed && typeof parsed === 'object') collections.studyAdditions = parsed;
  }

  const dailyLimit = user.ai_daily_limit != null ? Number(user.ai_daily_limit) : (Number(settings.default_ai_daily_limit) || 25);
  const proLimit = user.ai_pro_daily_limit != null ? Number(user.ai_pro_daily_limit) : (Number(settings.default_ai_pro_daily_limit) || 3);

  return jsonResponse({
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      displayNameHe: user.display_name_he || user.full_name,
      organization: user.organization,
      role: user.role,
      schoolId: user.school_id,
      accountStatus: user.account_status,
      accountType: rawAccType,
      redirectPortalRole: linkedAsFamily ? rawAccType : '',
      subscriptionStatus: user.subscription_status,
      hasActivePlan: effectiveAccessMode !== 'read_only',
      accessMode: effectiveAccessMode,
      readOnlyReason: (tutorBilling && tutorBilling.readOnlyReason) || '',
      trialDays: user.trial_days,
      trialEndsAt: user.trial_ends_at,
      billingPolicy: tutorPolicy,
      payoutMethods,
      tutorBilling,
      earningsLedger: (earningsRes && earningsRes.results) || [],
      stripeConfigured: Boolean(env && env.STRIPE_SECRET_KEY),
      stripeConnectOnboarded: Boolean(user.stripe_connect_onboarded),
      calendarIcsUrl,
      aiEnabled: !!user.ai_enabled,
      aiTierAccess: user.ai_tier_access || 'standard',
      aiAllowPlatformFallback: !!user.ai_allow_platform_fallback,
      hasCustomApiKey: !!(keyRow && keyRow.key_hint),
      customApiKeyHint: (keyRow && keyRow.key_hint) || '',
      customApiKeyLabel: (keyRow && keyRow.label) || '',
      aiUsageToday: {
        standardCount: Number((usageRow && usageRow.standard_count) || 0),
        proCount: Number((usageRow && usageRow.pro_count) || 0),
        dailyLimit,
        proLimit
      }
    },
    school: schoolRow ? {
      id: schoolRow.id,
      name: schoolRow.name,
      ownerUserId: schoolRow.owner_user_id,
      joinCode: schoolRow.join_code,
      members: (membersRes && membersRes.results) || []
    } : null,
    students,
    courses,
    collections,
    platform: {
      defaultTrialDays: Number(settings.default_trial_days || 35),
      globalAiEnabled: settings.global_ai_enabled !== false,
      announcementBanner: String(settings.announcement_banner || ''),
      billingConfig
    }
  }, 200, request, env);
}
