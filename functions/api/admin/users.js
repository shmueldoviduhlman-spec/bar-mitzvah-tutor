import { handleOptions, jsonResponse } from '../_lib/cors.js';
import { requireAdminAuth, logAdminAudit } from '../_lib/auth.js';
import { encryptSecret } from '../_lib/crypto.js';

const VALID_ROLES = new Set(['super_admin', 'admin', 'school_owner', 'tutor']);
const VALID_SUB_STATUSES = new Set(['trialing', 'active', 'lifetime', 'expired', 'canceled']);

export async function onRequestOptions(context) {
  return handleOptions(context, 'GET, POST, OPTIONS');
}

export async function onRequestGet(context) {
  const auth = await requireAdminAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env } = context;
  const db = env.DB;

  const u = new URL(request.url);
  const search = String(u.searchParams.get('q') || '').trim().toLowerCase();
  const filter = String(u.searchParams.get('filter') || 'all').trim().toLowerCase();
  const todayUtc = new Date().toISOString().slice(0, 10);

  const [usersRes, invitesRes] = await Promise.all([
    db.prepare(`
      SELECT u.*,
             s.name AS school_name,
             s.join_code AS school_join_code,
             k.key_hint AS custom_api_key_hint,
             k.label AS custom_api_key_label,
             k.assigned_by AS custom_api_key_assigned_by,
             (SELECT COUNT(*) FROM students st WHERE st.school_id = u.school_id AND st.archived = 0) AS student_count,
             (SELECT COALESCE(SUM(m.byte_size), 0) FROM media_objects m WHERE m.school_id = u.school_id) AS storage_bytes,
             (SELECT COALESCE(a.standard_count + a.pro_count, 0) FROM ai_usage_daily a WHERE a.user_id = u.id AND a.date_utc = ?) AS ai_calls_today
      FROM users u
      LEFT JOIN schools s ON s.id = u.school_id
      LEFT JOIN user_api_keys k ON k.user_id = u.id
      ORDER BY CASE u.role WHEN 'super_admin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.created_at DESC
    `).bind(todayUtc).all(),
    db.prepare('SELECT email, full_name, organization, role, school_id, subscription_status, trial_days, ai_enabled, ai_tier_access, ai_daily_limit, ai_pro_daily_limit, preassigned_key_hint, admin_notes, invited_by, created_at FROM user_invites ORDER BY created_at DESC').all()
  ]);

  let users = ((usersRes && usersRes.results) || []).map(r => ({
    id: r.id,
    email: r.email,
    fullName: r.full_name,
    displayNameHe: r.display_name_he,
    organization: r.organization,
    role: r.role,
    schoolId: r.school_id,
    schoolName: r.school_name || r.organization,
    schoolJoinCode: r.school_join_code || '',
    accountStatus: r.account_status,
    suspendedReason: r.suspended_reason || '',
    subscriptionStatus: r.subscription_status,
    trialDays: r.trial_days,
    trialEndsAt: r.trial_ends_at,
    aiEnabled: !!r.ai_enabled,
    aiTierAccess: r.ai_tier_access,
    aiDailyLimit: r.ai_daily_limit,
    aiProDailyLimit: r.ai_pro_daily_limit,
    aiAllowPlatformFallback: !!r.ai_allow_platform_fallback,
    hasCustomApiKey: !!r.custom_api_key_hint,
    customApiKeyHint: r.custom_api_key_hint || '',
    customApiKeyLabel: r.custom_api_key_label || '',
    customApiKeyAssignedBy: r.custom_api_key_assigned_by || '',
    adminNotes: r.admin_notes || '',
    studentCount: Number(r.student_count || 0),
    storageBytes: Number(r.storage_bytes || 0),
    aiCallsToday: Number(r.ai_calls_today || 0),
    lastActiveAt: r.last_active_at || '',
    createdAt: r.created_at
  }));

  if (search) {
    users = users.filter(x =>
      (x.email || '').toLowerCase().includes(search) ||
      (x.fullName || '').toLowerCase().includes(search) ||
      (x.organization || '').toLowerCase().includes(search) ||
      (x.schoolName || '').toLowerCase().includes(search)
    );
  }

  if (filter === 'trialing') users = users.filter(x => x.subscriptionStatus === 'trialing');
  else if (filter === 'active') users = users.filter(x => x.subscriptionStatus === 'active');
  else if (filter === 'lifetime') users = users.filter(x => x.subscriptionStatus === 'lifetime');
  else if (filter === 'expired') users = users.filter(x => x.subscriptionStatus === 'expired' || x.subscriptionStatus === 'canceled');
  else if (filter === 'suspended') users = users.filter(x => x.accountStatus === 'suspended');
  else if (filter === 'ai_disabled') users = users.filter(x => !x.aiEnabled);
  else if (filter === 'custom_key') users = users.filter(x => x.hasCustomApiKey);

  const invites = ((invitesRes && invitesRes.results) || []).map(i => ({
    email: i.email,
    fullName: i.full_name,
    organization: i.organization,
    role: i.role,
    schoolId: i.school_id,
    subscriptionStatus: i.subscription_status,
    trialDays: i.trial_days,
    aiEnabled: !!i.ai_enabled,
    aiTierAccess: i.ai_tier_access,
    hasPreassignedKey: !!i.preassigned_key_hint,
    preassignedKeyHint: i.preassigned_key_hint || '',
    invitedBy: i.invited_by,
    createdAt: i.created_at
  }));

  return jsonResponse({ users, invites }, 200, request, env);
}

export async function onRequestPost(context) {
  const auth = await requireAdminAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env } = context;
  const db = env.DB;

  let body;
  try { body = await request.json(); } catch (_) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, request, env);
  }

  const email = String((body && body.email) || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return jsonResponse({ error: 'Valid email is required' }, 400, request, env);
  }

  let requestedRole = String((body && body.role) || 'school_owner').trim().toLowerCase();
  if (!VALID_ROLES.has(requestedRole)) requestedRole = 'school_owner';
  if (requestedRole === 'super_admin') {
    return jsonResponse({ error: 'Cannot assign super_admin via invite UI' }, 403, request, env);
  }
  if (requestedRole === 'admin' && auth.user.role !== 'super_admin') {
    return jsonResponse({ error: 'Only super_admin can invite helper admin accounts' }, 403, request, env);
  }

  const subStatus = VALID_SUB_STATUSES.has(String((body && body.subscriptionStatus) || 'trialing'))
    ? String(body.subscriptionStatus)
    : 'trialing';
  const trialDays = subStatus === 'lifetime' ? 9999 : (parseInt(String((body && body.trialDays) ?? '35'), 10) || 35);
  const fullName = String((body && body.fullName) || email.split('@')[0]).trim();
  const organization = String((body && body.organization) || `${fullName}'s Studio`).trim();
  const schoolId = String((body && body.schoolId) || '').trim();
  const aiEnabled = (body && body.aiEnabled === false) ? 0 : 1;
  const aiTierAccess = (body && body.aiTierAccess === 'pro') ? 'pro' : 'standard';
  const aiDailyLimit = (body && body.aiDailyLimit !== '' && body.aiDailyLimit !== null && body.aiDailyLimit !== undefined)
    ? parseInt(String(body.aiDailyLimit), 10) : null;
  const aiProDailyLimit = (body && body.aiProDailyLimit !== '' && body.aiProDailyLimit !== null && body.aiProDailyLimit !== undefined)
    ? parseInt(String(body.aiProDailyLimit), 10) : null;
  const aiAllowPlatformFallback = (body && body.aiAllowPlatformFallback) ? 1 : 0;
  const adminNotes = String((body && body.adminNotes) || '').trim();

  let keyCipher = '', keyIv = '', keyHint = '';
  const rawCustomKey = String((body && body.customApiKey) || '').trim();
  if (rawCustomKey) {
    const enc = await encryptSecret(rawCustomKey, env.API_KEY_ENCRYPTION_SECRET);
    keyCipher = enc.cipherB64;
    keyIv = enc.ivB64;
    keyHint = enc.hint;
  }

  const nowIso = new Date().toISOString();
  const existingUser = await db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').bind(email).first();

  if (existingUser) {
    const trialEndsAt = subStatus === 'trialing'
      ? new Date(Date.now() + trialDays * 86400 * 1000).toISOString()
      : '';
    await db.prepare(
      `UPDATE users SET
         full_name = CASE WHEN full_name = '' THEN ? ELSE full_name END,
         organization = CASE WHEN ? != '' THEN ? ELSE organization END,
         role = CASE WHEN role = 'super_admin' THEN 'super_admin' ELSE ? END,
         subscription_status = ?, trial_days = ?, trial_ends_at = ?,
         ai_enabled = ?, ai_tier_access = ?, ai_daily_limit = ?, ai_pro_daily_limit = ?,
         ai_allow_platform_fallback = ?, admin_notes = ?, updated_at = ?
       WHERE id = ?`
    ).bind(
      fullName, organization, organization, requestedRole, subStatus, trialDays, trialEndsAt,
      aiEnabled, aiTierAccess, aiDailyLimit, aiProDailyLimit, aiAllowPlatformFallback, adminNotes, nowIso, existingUser.id
    ).run();

    if (keyCipher) {
      await db.prepare(
        `INSERT INTO user_api_keys (user_id, provider, encrypted_key_b64, iv_b64, key_hint, label, assigned_by, updated_at)
         VALUES (?, 'gemini', ?, ?, ?, 'Admin Assigned Key', ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET encrypted_key_b64=excluded.encrypted_key_b64, iv_b64=excluded.iv_b64, key_hint=excluded.key_hint, assigned_by=excluded.assigned_by, updated_at=excluded.updated_at`
      ).bind(existingUser.id, keyCipher, keyIv, keyHint, auth.user.email, nowIso).run();
    }

    await logAdminAudit(db, auth.user, { id: existingUser.id, email }, 'update_or_provision_existing_user', {
      role: requestedRole, subscriptionStatus: subStatus, trialDays, aiEnabled, hasCustomKey: !!keyCipher
    });

    return jsonResponse({ ok: true, mode: 'updated_existing', email }, 200, request, env);
  }

  await db.prepare(
    `INSERT INTO user_invites (
       email, full_name, organization, role, school_id, subscription_status, trial_days,
       ai_enabled, ai_tier_access, ai_daily_limit, ai_pro_daily_limit, ai_allow_platform_fallback,
       preassigned_key_cipher, preassigned_key_iv, preassigned_key_hint, admin_notes, invited_by, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       full_name=excluded.full_name, organization=excluded.organization, role=excluded.role,
       school_id=excluded.school_id, subscription_status=excluded.subscription_status, trial_days=excluded.trial_days,
       ai_enabled=excluded.ai_enabled, ai_tier_access=excluded.ai_tier_access,
       ai_daily_limit=excluded.ai_daily_limit, ai_pro_daily_limit=excluded.ai_pro_daily_limit,
       ai_allow_platform_fallback=excluded.ai_allow_platform_fallback,
       preassigned_key_cipher=CASE WHEN excluded.preassigned_key_cipher != '' THEN excluded.preassigned_key_cipher ELSE user_invites.preassigned_key_cipher END,
       preassigned_key_iv=CASE WHEN excluded.preassigned_key_iv != '' THEN excluded.preassigned_key_iv ELSE user_invites.preassigned_key_iv END,
       preassigned_key_hint=CASE WHEN excluded.preassigned_key_hint != '' THEN excluded.preassigned_key_hint ELSE user_invites.preassigned_key_hint END,
       admin_notes=excluded.admin_notes, invited_by=excluded.invited_by`
  ).bind(
    email, fullName, organization, requestedRole, schoolId, subStatus, trialDays,
    aiEnabled, aiTierAccess, aiDailyLimit, aiProDailyLimit, aiAllowPlatformFallback,
    keyCipher, keyIv, keyHint, adminNotes, auth.user.email, nowIso
  ).run();

  let clerkInviteSent = false;
  if (body && body.sendClerkInvite && env.CLERK_SECRET_KEY) {
    try {
      const invResp = await fetch('https://api.clerk.com/v1/invitations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.CLERK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email_address: email,
          redirect_url: (env.APP_ORIGIN || 'https://tutorpilot.us'),
          notify: true,
          ignore_existing: true
        })
      });
      clerkInviteSent = invResp.ok;
    } catch (_) {}
  }

  await logAdminAudit(db, auth.user, { id: '', email }, 'create_user_invite', {
    role: requestedRole, subscriptionStatus: subStatus, trialDays, aiEnabled, hasCustomKey: !!keyCipher, clerkInviteSent
  });

  return jsonResponse({ ok: true, mode: 'invited', email, clerkInviteSent }, 201, request, env);
}
