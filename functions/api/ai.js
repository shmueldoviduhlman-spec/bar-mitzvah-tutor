/**
 * TutorPilot Secure Gemini Edge Proxy, Per-User Key Vault & Governance Gatekeeper
 * Cloudflare Pages Function: POST /api/ai
 */

import { handleOptions, jsonResponse, buildCorsHeaders } from './_lib/cors.js';
import { requireTutorAuth, getPlatformSettings, hasActivePlanAccess } from './_lib/auth.js';
import { decryptSecret } from './_lib/crypto.js';

const ALLOWED_GEMINI_MODELS = new Set([
  'gemini-3-flash-preview',
  'gemini-3.1-pro-preview',
  'gemini-pro-latest',
  'gemini-3.1-flash-lite-preview',
  'gemini-flash-lite-latest',
  'gemini-3.5-flash-lite',
  'gemini-flash-latest',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite'
]);

const PRO_MODELS = new Set([
  'gemini-3.1-pro-preview',
  'gemini-pro-latest',
  'gemini-2.5-pro'
]);

const isolateDailyUsage = new Map();

function getUtcDateKey() {
  return new Date().toISOString().slice(0, 10);
}

async function checkAndIncrementQuota(userId, isProModel, maxDaily, maxProDaily, env) {
  const today = getUtcDateKey();
  const baseKey = `ai_usage:${today}:${userId}`;
  const proKey = `ai_pro:${today}:${userId}`;

  if (env.APP_KV && typeof env.APP_KV.get === 'function') {
    const currentCount = parseInt((await env.APP_KV.get(baseKey)) || '0', 10) || 0;
    if (currentCount >= maxDaily) {
      return { allowed: false, reason: `Daily AI limit (${maxDaily} requests) reached. Add your own Gemini API key in Settings for unlimited personal quota.` };
    }
    if (isProModel) {
      const currentPro = parseInt((await env.APP_KV.get(proKey)) || '0', 10) || 0;
      if (currentPro >= maxProDaily) {
        return { allowed: false, reason: `Daily Deep Pro limit (${maxProDaily} requests) reached. Switch to Standard mode or add your own Gemini API key in Settings.` };
      }
      await env.APP_KV.put(proKey, String(currentPro + 1), { expirationTtl: 95000 });
    }
    await env.APP_KV.put(baseKey, String(currentCount + 1), { expirationTtl: 95000 });
    return { allowed: true, remaining: Math.max(0, maxDaily - (currentCount + 1)) };
  }

  const entry = isolateDailyUsage.get(baseKey) || { total: 0, pro: 0 };
  if (entry.total >= maxDaily) {
    return { allowed: false, reason: `Daily AI limit (${maxDaily} requests) reached for today.` };
  }
  if (isProModel && entry.pro >= maxProDaily) {
    return { allowed: false, reason: `Daily Deep Pro limit (${maxProDaily} requests) reached; switch to Standard mode.` };
  }
  entry.total += 1;
  if (isProModel) entry.pro += 1;
  isolateDailyUsage.set(baseKey, entry);
  return { allowed: true, remaining: Math.max(0, maxDaily - entry.total) };
}

export async function onRequestOptions(context) {
  return handleOptions(context, 'POST, OPTIONS');
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const clientRole = (request.headers.get('X-TutorPilot-Role') || '').toLowerCase().trim();
  if (clientRole === 'student_portal') {
    return jsonResponse({ error: 'Student portal accounts are not permitted to invoke Tutor AI.' }, 403, request, env);
  }

  const auth = await requireTutorAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { user } = auth;
  const db = env.DB;

  const settings = await getPlatformSettings(db);
  if (settings.global_ai_enabled === false && user.role !== 'super_admin') {
    return jsonResponse({ error: 'Platform AI is temporarily paused by administrator.' }, 503, request, env);
  }

  if (!hasActivePlanAccess(user)) {
    return jsonResponse({ error: 'Your free trial or subscription has ended. Contact support or upgrade to continue using AI.' }, 403, request, env);
  }

  if (!user.ai_enabled) {
    return jsonResponse({ error: 'AI features are disabled on your account. Contact administrator or check Settings.' }, 403, request, env);
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ error: 'Invalid JSON request body' }, 400, request, env);
  }

  const requestedModel = String((body && body.model) || 'gemini-3-flash-preview').trim();
  const model = ALLOWED_GEMINI_MODELS.has(requestedModel) ? requestedModel : 'gemini-3-flash-preview';
  const isProModel = PRO_MODELS.has(model);

  const customKeyRow = await db.prepare('SELECT encrypted_key_b64, iv_b64 FROM user_api_keys WHERE user_id = ?').bind(user.id).first();
  let customKeyPlain = '';
  if (customKeyRow && customKeyRow.encrypted_key_b64 && customKeyRow.iv_b64 && env.API_KEY_ENCRYPTION_SECRET) {
    try {
      customKeyPlain = await decryptSecret(customKeyRow.encrypted_key_b64, customKeyRow.iv_b64, env.API_KEY_ENCRYPTION_SECRET);
    } catch (e) {
      console.error('Custom key decrypt failure:', e);
    }
  }

  const hasCustomKey = !!customKeyPlain;
  const platformKey = String((env && env.GEMINI_API_KEY) || '').trim();

  // Only allow Deep Pro model on shared platform key if user tier is 'pro' or user is super_admin (own custom key can always choose any allowed model)
  if (isProModel && !hasCustomKey && user.role !== 'super_admin' && user.ai_tier_access !== 'pro') {
    return jsonResponse({
      error: 'Deep Pro models require Pro AI access or your own custom Gemini API key in Settings.',
      proRestricted: true
    }, 403, request, env);
  }

  let activeApiKey = '';
  let usingCustomKey = false;
  if (hasCustomKey) {
    activeApiKey = customKeyPlain;
    usingCustomKey = true;
  } else if (platformKey) {
    activeApiKey = platformKey;
  } else {
    return jsonResponse({
      error: 'No Gemini API key configured yet. Add your own free Google AI Studio key inside Settings -> AI Assistant, or wait for administrator key setup.',
      needsApiKey: true
    }, 503, request, env);
  }

  let remainingQuota = 'custom';
  if (!usingCustomKey) {
    const defaultDaily = user.role === 'super_admin' ? 500 : (Number(settings.default_ai_daily_limit) || 25);
    const defaultProDaily = user.role === 'super_admin' ? 100 : (Number(settings.default_ai_pro_daily_limit) || 3);
    const userDailyCap = user.ai_daily_limit != null ? Number(user.ai_daily_limit) : defaultDaily;
    const userProCap = user.ai_pro_daily_limit != null ? Number(user.ai_pro_daily_limit) : defaultProDaily;

    const quota = await checkAndIncrementQuota(user.id, isProModel, userDailyCap, userProCap, env);
    if (!quota.allowed) {
      return jsonResponse({ error: quota.reason, quotaExceeded: true }, 429, request, env);
    }
    remainingQuota = String(quota.remaining);
  } else if (user.ai_daily_limit != null) {
    // Honor explicit admin cap even on assigned custom keys if admin set one
    const userDailyCap = Number(user.ai_daily_limit);
    const userProCap = user.ai_pro_daily_limit != null ? Number(user.ai_pro_daily_limit) : userDailyCap;
    const quota = await checkAndIncrementQuota(user.id, isProModel, userDailyCap, userProCap, env);
    if (!quota.allowed) {
      return jsonResponse({ error: quota.reason, quotaExceeded: true }, 429, request, env);
    }
    remainingQuota = String(quota.remaining);
  }

  const geminiPayload = body && body.payload && typeof body.payload === 'object' ? body.payload : {};
  const callUpstream = async (keyToUse) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(keyToUse)}`;
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload)
    });
  };

  try {
    let upstream = await callUpstream(activeApiKey);

    if (usingCustomKey && !upstream.ok && (upstream.status === 429 || upstream.status === 401 || upstream.status === 403) &&
        user.ai_allow_platform_fallback && platformKey) {
      const defaultDaily = Number(settings.default_ai_daily_limit) || 25;
      const defaultProDaily = Number(settings.default_ai_pro_daily_limit) || 3;
      const q = await checkAndIncrementQuota(user.id, isProModel, defaultDaily, defaultProDaily, env);
      if (q.allowed) {
        upstream = await callUpstream(platformKey);
        usingCustomKey = false;
        remainingQuota = String(q.remaining);
      }
    }

    const todayUtc = getUtcDateKey();
    const nowIso = new Date().toISOString();
    await db.prepare(
      `INSERT INTO ai_usage_daily (user_id, date_utc, standard_count, pro_count, used_custom_key_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, date_utc) DO UPDATE SET
         standard_count = standard_count + excluded.standard_count,
         pro_count = pro_count + excluded.pro_count,
         used_custom_key_count = used_custom_key_count + excluded.used_custom_key_count,
         updated_at = excluded.updated_at`
    ).bind(
      user.id,
      todayUtc,
      isProModel ? 0 : 1,
      isProModel ? 1 : 0,
      usingCustomKey ? 1 : 0,
      nowIso
    ).run().catch(() => {});

    const responseText = await upstream.text();
    const cors = buildCorsHeaders(request, env, 'POST, OPTIONS');
    return new Response(responseText, {
      status: upstream.status,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'X-TutorPilot-Proxy': 'cloudflare-pages',
        'X-TutorPilot-Model': model,
        'X-TutorPilot-Key-Source': usingCustomKey ? 'user-custom' : 'platform-shared',
        'X-TutorPilot-Remaining': remainingQuota
      }
    });
  } catch (err) {
    return jsonResponse({ error: err && err.message ? err.message : 'Upstream Gemini proxy error' }, 502, request, env);
  }
}
