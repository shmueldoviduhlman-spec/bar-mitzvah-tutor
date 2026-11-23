import { handleOptions, jsonResponse } from '../_lib/cors.js';
import { requireAdminAuth, getPlatformSettings } from '../_lib/auth.js';

export async function onRequestOptions(context) {
  return handleOptions(context, 'GET, OPTIONS');
}

export async function onRequestGet(context) {
  const auth = await requireAdminAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env } = context;
  const db = env.DB;
  const todayUtc = new Date().toISOString().slice(0, 10);
  const sevenDaysIso = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
  const thirtyDaysDate = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);

  const [usersStats, studentStats, courseStats, mediaStats, aiTodayStats, ai30Stats, invitesCount, settings] = await Promise.all([
    db.prepare(`
      SELECT
        COUNT(*) AS total_users,
        SUM(CASE WHEN subscription_status = 'trialing' AND account_status = 'active' THEN 1 ELSE 0 END) AS active_trials,
        SUM(CASE WHEN subscription_status = 'trialing' AND account_status = 'active' AND trial_ends_at != '' AND trial_ends_at <= ? THEN 1 ELSE 0 END) AS expiring_soon,
        SUM(CASE WHEN subscription_status = 'active' THEN 1 ELSE 0 END) AS paid_users,
        SUM(CASE WHEN subscription_status = 'lifetime' THEN 1 ELSE 0 END) AS lifetime_users,
        SUM(CASE WHEN account_status = 'suspended' THEN 1 ELSE 0 END) AS suspended_users,
        SUM(CASE WHEN ai_enabled = 0 THEN 1 ELSE 0 END) AS ai_disabled_users
      FROM users
    `).bind(sevenDaysIso).first(),
    db.prepare('SELECT COUNT(*) AS total_students FROM students WHERE archived = 0').first(),
    db.prepare("SELECT COUNT(*) AS total_courses FROM courses WHERE (deleted_at IS NULL OR deleted_at = '')").first(),
    db.prepare('SELECT COALESCE(SUM(byte_size), 0) AS total_bytes, COUNT(*) AS total_objects FROM media_objects').first(),
    db.prepare('SELECT COALESCE(SUM(standard_count + pro_count), 0) AS calls_today, COALESCE(SUM(used_custom_key_count), 0) AS custom_calls_today FROM ai_usage_daily WHERE date_utc = ?').bind(todayUtc).first(),
    db.prepare('SELECT COALESCE(SUM(standard_count + pro_count), 0) AS calls_30d FROM ai_usage_daily WHERE date_utc >= ?').bind(thirtyDaysDate).first(),
    db.prepare('SELECT COUNT(*) AS pending_invites FROM user_invites').first(),
    getPlatformSettings(db)
  ]);

  return jsonResponse({
    kpis: {
      totalUsers: Number((usersStats && usersStats.total_users) || 0),
      activeTrials: Number((usersStats && usersStats.active_trials) || 0),
      expiringSoon: Number((usersStats && usersStats.expiring_soon) || 0),
      paidUsers: Number((usersStats && usersStats.paid_users) || 0),
      lifetimeUsers: Number((usersStats && usersStats.lifetime_users) || 0),
      suspendedUsers: Number((usersStats && usersStats.suspended_users) || 0),
      aiDisabledUsers: Number((usersStats && usersStats.ai_disabled_users) || 0),
      pendingInvites: Number((invitesCount && invitesCount.pending_invites) || 0),
      totalStudents: Number((studentStats && studentStats.total_students) || 0),
      totalCourses: Number((courseStats && courseStats.total_courses) || 0),
      totalMediaBytes: Number((mediaStats && mediaStats.total_bytes) || 0),
      totalMediaObjects: Number((mediaStats && mediaStats.total_objects) || 0),
      aiCallsToday: Number((aiTodayStats && aiTodayStats.calls_today) || 0),
      aiCustomKeyCallsToday: Number((aiTodayStats && aiTodayStats.custom_calls_today) || 0),
      aiCalls30d: Number((ai30Stats && ai30Stats.calls_30d) || 0)
    },
    settings
  }, 200, request, env);
}
