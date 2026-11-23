import { handleOptions, jsonResponse } from '../../_lib/cors.js';
import { requireAdminAuth, logAdminAudit } from '../../_lib/auth.js';

const ALLOWED_MUTABLE_ROLES = new Set(['admin', 'school_owner', 'tutor']);
const VALID_SUB_STATUSES = new Set(['trialing', 'active', 'lifetime', 'expired', 'canceled']);

export async function onRequestOptions(context) {
  return handleOptions(context, 'PATCH, DELETE, OPTIONS');
}

export async function onRequestPatch(context) {
  const auth = await requireAdminAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env, params } = context;
  const db = env.DB;
  const targetId = String((params && params.id) || '').trim();
  if (!targetId) return jsonResponse({ error: 'Target user ID required' }, 400, request, env);

  const target = await db.prepare('SELECT * FROM users WHERE id = ?').bind(targetId).first();
  if (!target) return jsonResponse({ error: 'User not found' }, 404, request, env);

  // Strict hierarchy protection: super_admin can never be suspended/demoted; helper admin cannot touch super_admin or other admins
  if (target.role === 'super_admin' && auth.user.id !== target.id) {
    return jsonResponse({ error: 'Super Admin account cannot be modified by another account' }, 403, request, env);
  }
  if (target.role === 'admin' && auth.user.role !== 'super_admin' && auth.user.id !== target.id) {
    return jsonResponse({ error: 'Only super_admin can modify helper admin accounts' }, 403, request, env);
  }

  let body;
  try { body = await request.json(); } catch (_) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, request, env);
  }

  const nowIso = new Date().toISOString();
  const auditDetails = {};
  let nextRole = target.role;
  let nextAccountStatus = target.account_status;
  let nextSuspendedReason = target.suspended_reason || '';
  let nextSubStatus = target.subscription_status;
  let nextTrialDays = target.trial_days;
  let nextTrialEndsAt = target.trial_ends_at || '';
  let nextAiEnabled = target.ai_enabled;
  let nextAiTier = target.ai_tier_access;
  let nextAiDailyLimit = target.ai_daily_limit;
  let nextAiProLimit = target.ai_pro_daily_limit;
  let nextAiFallback = target.ai_allow_platform_fallback;
  let nextAdminNotes = target.admin_notes || '';
  let nextFullName = target.full_name;
  let nextOrganization = target.organization;

  if (body.role !== undefined && target.role !== 'super_admin') {
    const reqRole = String(body.role).trim().toLowerCase();
    if (!ALLOWED_MUTABLE_ROLES.has(reqRole)) {
      return jsonResponse({ error: 'Invalid target role' }, 400, request, env);
    }
    if (reqRole === 'admin' && auth.user.role !== 'super_admin') {
      return jsonResponse({ error: 'Only super_admin can promote or demote helper admins' }, 403, request, env);
    }
    nextRole = reqRole;
    auditDetails.role = reqRole;
  }

  if (body.accountStatus !== undefined) {
    if (target.role === 'super_admin' && body.accountStatus === 'suspended') {
      return jsonResponse({ error: 'Cannot suspend super_admin account' }, 403, request, env);
    }
    nextAccountStatus = body.accountStatus === 'suspended' ? 'suspended' : 'active';
    nextSuspendedReason = nextAccountStatus === 'suspended' ? String(body.suspendedReason || 'Suspended by administrator') : '';
    auditDetails.accountStatus = nextAccountStatus;
  }

  if (body.subscriptionStatus !== undefined && VALID_SUB_STATUSES.has(String(body.subscriptionStatus))) {
    if (!(target.role === 'super_admin' && body.subscriptionStatus !== 'lifetime')) {
      nextSubStatus = String(body.subscriptionStatus);
      auditDetails.subscriptionStatus = nextSubStatus;
      if (nextSubStatus === 'lifetime') {
        nextTrialDays = 9999;
        nextTrialEndsAt = '';
      } else if (nextSubStatus === 'trialing' && !nextTrialEndsAt) {
        const d = parseInt(String(body.trialDays || nextTrialDays || 35), 10) || 35;
        nextTrialDays = d;
        nextTrialEndsAt = new Date(Date.now() + d * 86400 * 1000).toISOString();
      }
    }
  }

  if (typeof body.extendDays === 'number' && body.extendDays !== 0) {
    const addDays = Math.trunc(body.extendDays);
    const baseMs = nextTrialEndsAt ? Math.max(Date.now(), Date.parse(nextTrialEndsAt) || Date.now()) : Date.now();
    nextSubStatus = 'trialing';
    nextTrialDays = Math.max(1, Number(nextTrialDays || 0) + addDays);
    nextTrialEndsAt = new Date(baseMs + addDays * 86400 * 1000).toISOString();
    auditDetails.extendDays = addDays;
  }

  if (body.trialDays !== undefined && typeof body.extendDays !== 'number') {
    const d = parseInt(String(body.trialDays), 10);
    if (!Number.isNaN(d) && d > 0) {
      nextTrialDays = d;
      if (nextSubStatus === 'trialing') {
        nextTrialEndsAt = new Date(Date.now() + d * 86400 * 1000).toISOString();
      }
      auditDetails.trialDays = d;
    }
  }

  if (body.aiEnabled !== undefined) {
    nextAiEnabled = body.aiEnabled ? 1 : 0;
    auditDetails.aiEnabled = !!nextAiEnabled;
  }
  if (body.aiTierAccess === 'standard' || body.aiTierAccess === 'pro') {
    nextAiTier = body.aiTierAccess;
    auditDetails.aiTierAccess = nextAiTier;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'aiDailyLimit')) {
    nextAiDailyLimit = (body.aiDailyLimit === null || body.aiDailyLimit === '') ? null : parseInt(String(body.aiDailyLimit), 10);
    auditDetails.aiDailyLimit = nextAiDailyLimit;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'aiProDailyLimit')) {
    nextAiProLimit = (body.aiProDailyLimit === null || body.aiProDailyLimit === '') ? null : parseInt(String(body.aiProDailyLimit), 10);
    auditDetails.aiProDailyLimit = nextAiProLimit;
  }
  if (body.aiAllowPlatformFallback !== undefined) {
    nextAiFallback = body.aiAllowPlatformFallback ? 1 : 0;
    auditDetails.aiAllowPlatformFallback = !!nextAiFallback;
  }
  if (body.adminNotes !== undefined) {
    nextAdminNotes = String(body.adminNotes || '');
    auditDetails.adminNotesUpdated = true;
  }
  if (body.fullName !== undefined && String(body.fullName).trim()) {
    nextFullName = String(body.fullName).trim();
  }
  if (body.organization !== undefined) {
    nextOrganization = String(body.organization || '').trim();
  }

  await db.prepare(
    `UPDATE users SET
       full_name = ?, organization = ?, role = ?, account_status = ?, suspended_reason = ?,
       subscription_status = ?, trial_days = ?, trial_ends_at = ?,
       ai_enabled = ?, ai_tier_access = ?, ai_daily_limit = ?, ai_pro_daily_limit = ?,
       ai_allow_platform_fallback = ?, admin_notes = ?, updated_at = ?
     WHERE id = ?`
  ).bind(
    nextFullName, nextOrganization, nextRole, nextAccountStatus, nextSuspendedReason,
    nextSubStatus, nextTrialDays, nextTrialEndsAt,
    nextAiEnabled, nextAiTier, nextAiDailyLimit, nextAiProLimit,
    nextAiFallback, nextAdminNotes, nowIso, target.id
  ).run();

  await logAdminAudit(db, auth.user, target, 'update_user', auditDetails);

  return jsonResponse({ ok: true, userId: target.id, updated: auditDetails }, 200, request, env);
}

export async function onRequestDelete(context) {
  const auth = await requireAdminAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env, params } = context;
  const db = env.DB;
  const targetId = String((params && params.id) || '').trim();

  // Support deleting pending invite by email if passed with prefix "invite:"
  if (targetId.startsWith('invite:')) {
    const invEmail = decodeURIComponent(targetId.slice('invite:'.length)).toLowerCase();
    await db.prepare('DELETE FROM user_invites WHERE lower(email) = lower(?)').bind(invEmail).run();
    await logAdminAudit(db, auth.user, { id: '', email: invEmail }, 'delete_user_invite', {});
    return jsonResponse({ ok: true, deletedInvite: invEmail }, 200, request, env);
  }

  const target = await db.prepare('SELECT * FROM users WHERE id = ?').bind(targetId).first();
  if (!target) return jsonResponse({ error: 'User not found' }, 404, request, env);

  if (target.role === 'super_admin') {
    return jsonResponse({ error: 'Super Admin account cannot be deleted' }, 403, request, env);
  }
  if (target.role === 'admin' && auth.user.role !== 'super_admin') {
    return jsonResponse({ error: 'Only super_admin can delete helper admin accounts' }, 403, request, env);
  }

  const membersRes = await db.prepare('SELECT user_id FROM school_members WHERE school_id = ?').bind(target.school_id).all();
  const otherMembers = ((membersRes && membersRes.results) || []).filter(m => m.user_id !== target.id);

  const stmts = [
    db.prepare('DELETE FROM user_api_keys WHERE user_id = ?').bind(target.id),
    db.prepare('DELETE FROM external_agent_tokens WHERE user_id = ?').bind(target.id),
    db.prepare('DELETE FROM ai_usage_daily WHERE user_id = ?').bind(target.id),
    db.prepare('DELETE FROM school_members WHERE user_id = ?').bind(target.id),
    db.prepare('DELETE FROM users WHERE id = ?').bind(target.id)
  ];

  // Only delete school data & R2 files when this user was the sole member of that school
  if (otherMembers.length === 0) {
    const mediaRes = await db.prepare('SELECT key FROM media_objects WHERE school_id = ?').bind(target.school_id).all();
    for (const m of ((mediaRes && mediaRes.results) || [])) {
      if (env.MEDIA_BUCKET && m && m.key) await env.MEDIA_BUCKET.delete(m.key).catch(() => {});
    }
    stmts.push(
      db.prepare('DELETE FROM media_objects WHERE school_id = ?').bind(target.school_id),
      db.prepare('DELETE FROM students WHERE school_id = ?').bind(target.school_id),
      db.prepare('DELETE FROM courses WHERE school_id = ?').bind(target.school_id),
      db.prepare('DELETE FROM curriculum_collections WHERE school_id = ?').bind(target.school_id),
      db.prepare('DELETE FROM schools WHERE id = ?').bind(target.school_id)
    );
  }

  await db.batch(stmts);
  await logAdminAudit(db, auth.user, target, 'delete_user', { purgedSchoolData: otherMembers.length === 0 });

  return jsonResponse({ ok: true, deletedUserId: target.id }, 200, request, env);
}
