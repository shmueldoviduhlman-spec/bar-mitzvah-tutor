/**
 * Clerk RS256 JWT Verification, D1 Multi-Tenant User Provisioning & Role Enforcement
 */

import { fromBase64Url, generateRandomCode } from './crypto.js';
import { jsonResponse } from './cors.js';

const textDecoder = new TextDecoder();
const jwksCache = new Map(); // jwksUrl -> { expiresAt, keysByKid: Map<string, CryptoKey> }
const DEFAULT_SYSTEM_SCHOOL_CODE = () => generateRandomCode(8);

function getSuperAdminEmailSet(env) {
  const raw = String((env && env.SUPER_ADMIN_EMAILS) || 'shmueldoviduhlman@gmail.com');
  return new Set(
    raw
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

function parseJwtParts(token) {
  const parts = String(token || '').trim().split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(textDecoder.decode(fromBase64Url(parts[0])));
    const payload = JSON.parse(textDecoder.decode(fromBase64Url(parts[1])));
    const signature = fromBase64Url(parts[2]);
    return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature };
  } catch (_) {
    return null;
  }
}

async function fetchJwksKeys(jwksUrl, forceRefresh = false) {
  const now = Date.now();
  const cached = jwksCache.get(jwksUrl);
  if (!forceRefresh && cached && cached.expiresAt > now) {
    return cached.keysByKid;
  }
  const resp = await fetch(jwksUrl, { headers: { Accept: 'application/json' } });
  if (!resp.ok) {
    throw new Error(`Failed to fetch Clerk JWKS (${resp.status})`);
  }
  const body = await resp.json();
  const keysByKid = new Map();
  const list = Array.isArray(body && body.keys) ? body.keys : [];
  for (const jwk of list) {
    if (jwk && jwk.kty === 'RSA' && jwk.kid) {
      try {
        const cryptoKey = await crypto.subtle.importKey(
          'jwk',
          jwk,
          { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
          false,
          ['verify']
        );
        keysByKid.set(jwk.kid, cryptoKey);
      } catch (_) {}
    }
  }
  jwksCache.set(jwksUrl, { expiresAt: now + 5 * 60 * 1000, keysByKid });
  return keysByKid;
}

export async function verifyClerkJwt(token, env) {
  const parsed = parseJwtParts(token);
  if (!parsed || !parsed.header || !parsed.payload) return null;
  if (parsed.header.alg !== 'RS256') return null;

  const claims = parsed.payload;
  const nowSec = Math.floor(Date.now() / 1000);
  if (!claims.sub) return null;
  if (typeof claims.exp !== 'number' || claims.exp < nowSec - 15) return null;
  if (typeof claims.nbf === 'number' && claims.nbf > nowSec + 15) return null;

  const expectedIssuer = String((env && env.CLERK_ISSUER) || 'https://clerk.tutorpilot.us').replace(/\/+$/, '');
  const actualIssuer = String(claims.iss || '').replace(/\/+$/, '');
  if (!actualIssuer || actualIssuer !== expectedIssuer) return null;

  const jwksUrl = String((env && env.CLERK_JWKS_URL) || `${expectedIssuer}/.well-known/jwks.json`);
  let keysMap = await fetchJwksKeys(jwksUrl, false);
  let verifyKey = parsed.header.kid ? keysMap.get(parsed.header.kid) : null;
  if (!verifyKey && parsed.header.kid) {
    keysMap = await fetchJwksKeys(jwksUrl, true);
    verifyKey = keysMap.get(parsed.header.kid);
  }
  if (!verifyKey) return null;

  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    verifyKey,
    parsed.signature,
    new TextEncoder().encode(parsed.signingInput)
  );
  if (!ok) return null;

  const email = String(
    claims.email ||
    claims.email_address ||
    (claims.primary_email_address || '')
  ).trim().toLowerCase();

  const fullName = String(
    claims.name ||
    claims.full_name ||
    [claims.first_name, claims.last_name].filter(Boolean).join(' ') ||
    ''
  ).trim();

  return {
    sub: String(claims.sub),
    email,
    fullName,
    claims
  };
}

async function fetchClerkCanonicalUser(userId, env) {
  const secret = String((env && env.CLERK_SECRET_KEY) || '').trim();
  if (!secret || !userId) return null;
  try {
    const resp = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, {
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: 'application/json'
      }
    });
    if (!resp.ok) return null;
    const u = await resp.json();
    const emails = Array.isArray(u.email_addresses) ? u.email_addresses : [];
    const primary = emails.find(e => e.id === u.primary_email_address_id) || emails[0];
    const email = String((primary && primary.email_address) || '').trim().toLowerCase();
    const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
    return { email, fullName };
  } catch (_) {
    return null;
  }
}

export async function getPlatformSettings(db) {
  const defaults = {
    default_trial_days: 35,
    global_ai_enabled: true,
    default_ai_daily_limit: 25,
    default_ai_pro_daily_limit: 3,
    announcement_banner: ''
  };
  try {
    const rows = await db.prepare('SELECT key, value_json FROM platform_settings').all();
    const list = (rows && rows.results) || [];
    for (const row of list) {
      try {
        defaults[row.key] = JSON.parse(row.value_json);
      } catch (_) {}
    }
  } catch (_) {}
  return defaults;
}

export async function logAdminAudit(db, actor, target, action, details = {}) {
  try {
    const id = 'aud_' + crypto.randomUUID().replace(/-/g, '');
    await db.prepare(
      `INSERT INTO admin_audit_logs (id, actor_user_id, actor_email, target_user_id, target_email, action, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      String((actor && actor.id) || 'system'),
      String((actor && actor.email) || 'system'),
      String((target && target.id) || ''),
      String((target && target.email) || ''),
      String(action || 'unknown'),
      JSON.stringify(details || {}),
      new Date().toISOString()
    ).run();
  } catch (err) {
    console.error('Audit log insert notice:', err);
  }
}

async function relinkPendingUserToClerkId(db, oldUserId, newClerkId) {
  if (!oldUserId || !newClerkId || oldUserId === newClerkId) return;
  const statements = [
    db.prepare('UPDATE users SET id = ? WHERE id = ?').bind(newClerkId, oldUserId),
    db.prepare('UPDATE user_api_keys SET user_id = ? WHERE user_id = ?').bind(newClerkId, oldUserId),
    db.prepare('UPDATE schools SET owner_user_id = ? WHERE owner_user_id = ?').bind(newClerkId, oldUserId),
    db.prepare('UPDATE school_members SET user_id = ? WHERE user_id = ?').bind(newClerkId, oldUserId),
    db.prepare('UPDATE students SET owner_user_id = ? WHERE owner_user_id = ?').bind(newClerkId, oldUserId),
    db.prepare('UPDATE courses SET owner_user_id = ? WHERE owner_user_id = ?').bind(newClerkId, oldUserId),
    db.prepare('UPDATE external_agent_tokens SET user_id = ? WHERE user_id = ?').bind(newClerkId, oldUserId),
    db.prepare('UPDATE ai_usage_daily SET user_id = ? WHERE user_id = ?').bind(newClerkId, oldUserId)
  ];
  await db.batch(statements);
}

export async function ensureD1User(db, clerkProfile, env) {
  const superAdmins = getSuperAdminEmailSet(env);
  const nowIso = new Date().toISOString();

  // Fast path: user already exists by exact Clerk sub
  let user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(clerkProfile.sub).first();

  // Resolve email if missing from JWT or user missing
  let email = clerkProfile.email;
  let fullName = clerkProfile.fullName;
  if (!user && !email) {
    const canonical = await fetchClerkCanonicalUser(clerkProfile.sub, env);
    if (canonical) {
      email = canonical.email;
      if (!fullName) fullName = canonical.fullName;
    }
  }

  if (!user && email) {
    const existingByEmail = await db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').bind(email).first();
    if (existingByEmail) {
      if (String(existingByEmail.id).startsWith('pending_')) {
        await relinkPendingUserToClerkId(db, existingByEmail.id, clerkProfile.sub);
        user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(clerkProfile.sub).first();
      } else {
        user = existingByEmail;
      }
    }
  }

  if (!user) {
    if (!email) {
      email = `${clerkProfile.sub}@clerk.local`;
    }
    const isSuper = superAdmins.has(email);
    const settings = await getPlatformSettings(db);
    const invite = await db.prepare('SELECT * FROM user_invites WHERE lower(email) = lower(?)').bind(email).first();

    const defaultTrialDays = parseInt(settings.default_trial_days || env.DEFAULT_TRIAL_DAYS || '35', 10) || 35;
    const role = isSuper ? 'super_admin' : ((invite && invite.role) || 'school_owner');
    const subStatus = isSuper ? 'lifetime' : ((invite && invite.subscription_status) || 'trialing');
    const trialDays = isSuper ? 9999 : ((invite && typeof invite.trial_days === 'number') ? invite.trial_days : defaultTrialDays);
    const trialEndsAt = subStatus === 'trialing'
      ? new Date(Date.now() + trialDays * 86400 * 1000).toISOString()
      : '';
    const resolvedName = (invite && invite.full_name) || fullName || email.split('@')[0];
    const orgName = (invite && invite.organization) || (isSuper ? 'Bar Mitzvah Academy' : `${resolvedName}'s Studio`);

    let schoolId = invite && invite.school_id ? invite.school_id : '';
    if (schoolId) {
      const targetSchool = await db.prepare('SELECT id FROM schools WHERE id = ?').bind(schoolId).first();
      if (!targetSchool) schoolId = '';
    }
    if (!schoolId) {
      schoolId = 'school_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      const joinCode = DEFAULT_SYSTEM_SCHOOL_CODE();
      await db.prepare(
        `INSERT INTO schools (id, name, owner_user_id, join_code, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(schoolId, orgName, clerkProfile.sub, joinCode, nowIso, nowIso).run();
    }

    await db.prepare(
      `INSERT OR IGNORE INTO school_members (school_id, user_id, role, joined_at)
       VALUES (?, ?, ?, ?)`
    ).bind(schoolId, clerkProfile.sub, (invite && invite.school_id) ? 'teacher' : 'owner', nowIso).run();

    await db.prepare(
      `INSERT INTO users (
        id, email, full_name, display_name_he, organization, role, school_id,
        account_status, suspended_reason, subscription_status, trial_days, trial_ends_at,
        ai_enabled, ai_tier_access, ai_daily_limit, ai_pro_daily_limit, ai_allow_platform_fallback,
        admin_notes, last_active_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      clerkProfile.sub,
      email,
      resolvedName,
      '',
      orgName,
      role,
      schoolId,
      subStatus,
      trialDays,
      trialEndsAt,
      invite ? invite.ai_enabled : 1,
      isSuper ? 'pro' : ((invite && invite.ai_tier_access) || 'standard'),
      invite ? invite.ai_daily_limit : null,
      invite ? invite.ai_pro_daily_limit : null,
      invite ? invite.ai_allow_platform_fallback : 0,
      (invite && invite.admin_notes) || '',
      nowIso,
      nowIso,
      nowIso
    ).run();

    if (invite && invite.preassigned_key_cipher && invite.preassigned_key_iv) {
      await db.prepare(
        `INSERT OR REPLACE INTO user_api_keys (user_id, provider, encrypted_key_b64, iv_b64, key_hint, label, assigned_by, updated_at)
         VALUES (?, 'gemini', ?, ?, ?, 'Pre-assigned Admin Key', ?, ?)`
      ).bind(
        clerkProfile.sub,
        invite.preassigned_key_cipher,
        invite.preassigned_key_iv,
        invite.preassigned_key_hint || '',
        invite.invited_by,
        nowIso
      ).run();
    }

    if (invite) {
      await db.prepare('DELETE FROM user_invites WHERE lower(email) = lower(?)').bind(email).run();
    }

    user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(clerkProfile.sub).first();
  } else {
    // Ensure listed SUPER_ADMIN_EMAILS always hold super_admin + lifetime on server
    const isSuper = superAdmins.has(String(user.email || '').toLowerCase());
    if (isSuper && (user.role !== 'super_admin' || user.subscription_status !== 'lifetime' || user.ai_tier_access !== 'pro')) {
      await db.prepare(
        `UPDATE users SET role = 'super_admin', subscription_status = 'lifetime', trial_days = 9999, ai_tier_access = 'pro', account_status = 'active', updated_at = ? WHERE id = ?`
      ).bind(nowIso, user.id).run();
      user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
    } else {
      await db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').bind(nowIso, user.id).run();
    }
  }

  return user;
}

export function extractBearerToken(request) {
  const header = (request && request.headers && request.headers.get('Authorization')) || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  try {
    const u = new URL(request.url);
    return (u.searchParams.get('t') || '').trim();
  } catch (_) {
    return '';
  }
}

export async function requireTutorAuth(context) {
  const { request, env } = context;
  if (!env || !env.DB) {
    return { errorResponse: jsonResponse({ error: 'Database binding missing' }, 500, request, env) };
  }
  const token = extractBearerToken(request);
  if (!token) {
    return { errorResponse: jsonResponse({ error: 'Authentication required' }, 401, request, env) };
  }
  const clerkProfile = await verifyClerkJwt(token, env);
  if (!clerkProfile) {
    return { errorResponse: jsonResponse({ error: 'Invalid or expired session token' }, 401, request, env) };
  }
  const user = await ensureD1User(env.DB, clerkProfile, env);
  if (!user) {
    return { errorResponse: jsonResponse({ error: 'Unable to resolve user workspace' }, 401, request, env) };
  }
  if (user.account_status === 'suspended') {
    return {
      errorResponse: jsonResponse(
        { error: user.suspended_reason || 'Account suspended. Contact administrator.', suspended: true },
        403,
        request,
        env
      )
    };
  }
  return { user, clerk: clerkProfile };
}

export async function requireAdminAuth(context, { superAdminOnly = false } = {}) {
  const auth = await requireTutorAuth(context);
  if (auth.errorResponse) return auth;
  const role = String(auth.user.role || '').toLowerCase();
  const allowed = superAdminOnly ? (role === 'super_admin') : (role === 'super_admin' || role === 'admin');
  if (!allowed) {
    return {
      errorResponse: jsonResponse(
        { error: superAdminOnly ? 'Super Admin permission required' : 'Administrator permission required' },
        403,
        context.request,
        context.env
      )
    };
  }
  return auth;
}

export function hasActivePlanAccess(user) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  if (user.account_status === 'suspended') return false;
  const st = String(user.subscription_status || '').toLowerCase();
  if (st === 'lifetime' || st === 'active') return true;
  if (st === 'trialing') {
    if (!user.trial_ends_at) return true;
    return Date.parse(user.trial_ends_at) > Date.now();
  }
  return false;
}
