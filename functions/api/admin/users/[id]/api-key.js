import { handleOptions, jsonResponse } from '../../../_lib/cors.js';
import { requireAdminAuth, logAdminAudit } from '../../../_lib/auth.js';
import { encryptSecret } from '../../../_lib/crypto.js';

export async function onRequestOptions(context) {
  return handleOptions(context, 'PUT, DELETE, OPTIONS');
}

export async function onRequestPut(context) {
  const auth = await requireAdminAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env, params } = context;
  const db = env.DB;
  const targetId = String((params && params.id) || '').trim();

  const target = await db.prepare('SELECT id, email, role FROM users WHERE id = ?').bind(targetId).first();
  if (!target) return jsonResponse({ error: 'Target user not found' }, 404, request, env);
  if ((target.role === 'super_admin' || target.role === 'admin') && auth.user.role !== 'super_admin' && auth.user.id !== target.id) {
    return jsonResponse({ error: 'Insufficient permission to edit this admin key' }, 403, request, env);
  }

  let body;
  try { body = await request.json(); } catch (_) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, request, env);
  }

  const rawKey = String((body && body.apiKey) || '').trim();
  const label = String((body && body.label) || 'Admin Assigned Gemini Key').trim().slice(0, 80);
  if (!rawKey || rawKey.length < 18 || /\s/.test(rawKey)) {
    return jsonResponse({ error: 'Valid Gemini API key required' }, 400, request, env);
  }

  const { cipherB64, ivB64, hint } = await encryptSecret(rawKey, env.API_KEY_ENCRYPTION_SECRET);
  const nowIso = new Date().toISOString();

  await db.prepare(
    `INSERT INTO user_api_keys (user_id, provider, encrypted_key_b64, iv_b64, key_hint, label, assigned_by, updated_at)
     VALUES (?, 'gemini', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       encrypted_key_b64 = excluded.encrypted_key_b64,
       iv_b64 = excluded.iv_b64,
       key_hint = excluded.key_hint,
       label = excluded.label,
       assigned_by = excluded.assigned_by,
       updated_at = excluded.updated_at`
  ).bind(target.id, cipherB64, ivB64, hint, label, auth.user.email, nowIso).run();

  if (body && body.aiAllowPlatformFallback !== undefined) {
    await db.prepare('UPDATE users SET ai_allow_platform_fallback = ?, updated_at = ? WHERE id = ?')
      .bind(body.aiAllowPlatformFallback ? 1 : 0, nowIso, target.id).run();
  }

  await logAdminAudit(db, auth.user, target, 'assign_user_api_key', { keyHint: hint, label });

  return jsonResponse({
    ok: true,
    userId: target.id,
    hasCustomApiKey: true,
    keyHint: hint,
    label,
    assignedBy: auth.user.email,
    updatedAt: nowIso
  }, 200, request, env);
}

export async function onRequestDelete(context) {
  const auth = await requireAdminAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env, params } = context;
  const db = env.DB;
  const targetId = String((params && params.id) || '').trim();

  const target = await db.prepare('SELECT id, email, role FROM users WHERE id = ?').bind(targetId).first();
  if (!target) return jsonResponse({ error: 'Target user not found' }, 404, request, env);
  if ((target.role === 'super_admin' || target.role === 'admin') && auth.user.role !== 'super_admin' && auth.user.id !== target.id) {
    return jsonResponse({ error: 'Insufficient permission to revoke this admin key' }, 403, request, env);
  }

  await db.prepare('DELETE FROM user_api_keys WHERE user_id = ?').bind(target.id).run();
  await logAdminAudit(db, auth.user, target, 'revoke_user_api_key', {});

  return jsonResponse({ ok: true, userId: target.id, hasCustomApiKey: false, keyHint: '' }, 200, request, env);
}
