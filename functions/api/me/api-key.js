import { handleOptions, jsonResponse } from '../_lib/cors.js';
import { requireTutorAuth } from '../_lib/auth.js';
import { encryptSecret } from '../_lib/crypto.js';

export async function onRequestOptions(context) {
  return handleOptions(context, 'GET, PUT, DELETE, OPTIONS');
}

export async function onRequestGet(context) {
  const auth = await requireTutorAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env } = context;
  const row = await env.DB.prepare(
    'SELECT provider, key_hint, label, assigned_by, updated_at FROM user_api_keys WHERE user_id = ?'
  ).bind(auth.user.id).first();

  return jsonResponse({
    hasCustomApiKey: !!(row && row.key_hint),
    keyHint: (row && row.key_hint) || '',
    label: (row && row.label) || '',
    assignedBy: (row && row.assigned_by) || '',
    updatedAt: (row && row.updated_at) || '',
    aiEnabled: !!auth.user.ai_enabled,
    aiTierAccess: auth.user.ai_tier_access || 'standard',
    aiAllowPlatformFallback: !!auth.user.ai_allow_platform_fallback
  }, 200, request, env);
}

export async function onRequestPut(context) {
  const auth = await requireTutorAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, request, env);
  }

  const rawKey = String((body && body.apiKey) || '').trim();
  const label = String((body && body.label) || 'Personal Gemini Key').trim().slice(0, 80);
  if (!rawKey || rawKey.length < 18 || /\s/.test(rawKey)) {
    return jsonResponse({ error: 'Please enter a valid Google Gemini API key.' }, 400, request, env);
  }

  if (body && body.verifyLive) {
    try {
      const checkResp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(rawKey)}`
      );
      if (!checkResp.ok) {
        const errInfo = await checkResp.json().catch(() => ({}));
        const msg = (errInfo && errInfo.error && errInfo.error.message) || `Gemini key check failed (${checkResp.status})`;
        return jsonResponse({ error: msg }, 400, request, env);
      }
    } catch (e) {
      return jsonResponse({ error: e && e.message ? e.message : 'Unable to reach Gemini API for key verification' }, 502, request, env);
    }
  }

  const { cipherB64, ivB64, hint } = await encryptSecret(rawKey, env.API_KEY_ENCRYPTION_SECRET);
  const nowIso = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO user_api_keys (user_id, provider, encrypted_key_b64, iv_b64, key_hint, label, assigned_by, updated_at)
     VALUES (?, 'gemini', ?, ?, ?, ?, 'self', ?)
     ON CONFLICT(user_id) DO UPDATE SET
       encrypted_key_b64 = excluded.encrypted_key_b64,
       iv_b64 = excluded.iv_b64,
       key_hint = excluded.key_hint,
       label = excluded.label,
       assigned_by = 'self',
       updated_at = excluded.updated_at`
  ).bind(auth.user.id, cipherB64, ivB64, hint, label, nowIso).run();

  return jsonResponse({
    ok: true,
    hasCustomApiKey: true,
    keyHint: hint,
    label,
    assignedBy: 'self',
    updatedAt: nowIso
  }, 200, request, env);
}

export async function onRequestDelete(context) {
  const auth = await requireTutorAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  await context.env.DB.prepare('DELETE FROM user_api_keys WHERE user_id = ?').bind(auth.user.id).run();
  return jsonResponse({ ok: true, hasCustomApiKey: false, keyHint: '' }, 200, context.request, context.env);
}
