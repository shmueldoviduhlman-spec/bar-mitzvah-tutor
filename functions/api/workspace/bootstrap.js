import { handleOptions, jsonResponse } from '../_lib/cors.js';
import { requireTutorAuth, getPlatformSettings, hasActivePlanAccess } from '../_lib/auth.js';

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
    updatedAt: row.updated_at || ''
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
  const todayUtc = new Date().toISOString().slice(0, 10);

  const [schoolRow, membersRes, studentsRes, coursesRes, collectionsRes, keyRow, usageRow] = await Promise.all([
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
    db.prepare('SELECT standard_count, pro_count, used_custom_key_count FROM ai_usage_daily WHERE user_id = ? AND date_utc = ?').bind(user.id, todayUtc).first()
  ]);

  const students = ((studentsRes && studentsRes.results) || []).map(mapStudentRowToClient);
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
      subscriptionStatus: user.subscription_status,
      hasActivePlan: hasActivePlanAccess(user),
      trialDays: user.trial_days,
      trialEndsAt: user.trial_ends_at,
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
      announcementBanner: String(settings.announcement_banner || '')
    }
  }, 200, request, env);
}
