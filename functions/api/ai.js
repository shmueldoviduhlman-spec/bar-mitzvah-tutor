/**
 * TutorPilot Secure Gemini Edge Proxy & Per-Tutor Quota Gatekeeper
 * Cloudflare Pages Function: POST /api/ai
 *
 * Environment Variables (configure in Cloudflare Pages -> Settings -> Environment Variables):
 * - GEMINI_API_KEY (Secret): Required to activate server-side proxying.
 * - SUPABASE_URL (Optional): Your Supabase project URL for strict JWT verification.
 * - SUPABASE_ANON_KEY (Optional): Your Supabase anon key for auth.getUser verification.
 * - REQUIRE_AUTH_JWT (Optional): Set "true" once multi-user public launch is live.
 * - AI_DAILY_LIMIT (Optional): Daily request cap per tutor (default 35 free / 300 pro).
 * - AI_QUOTA_KV (Optional KV binding): Durable cross-edge daily usage ledger.
 */

const ALLOWED_GEMINI_MODELS = new Set([
  'gemini-3-flash-preview',
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3.7-flash',
  'gemini-3.5-flash',
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-3.1-flash-lite',
  'gemini-3.1-pro-preview',
  'gemini-pro-latest',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite'
]);

const PRO_MODELS = new Set(['gemini-3.1-pro-preview', 'gemini-pro-latest', 'gemini-2.5-pro']);

// Lightweight in-memory fallback limiter when AI_QUOTA_KV binding is not configured
const isolateDailyUsage = new Map();

function buildCorsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-TutorPilot-Role, X-TutorPilot-Client',
    'Access-Control-Max-Age': '86400'
  };
}

function getUtcDateKey() {
  return new Date().toISOString().slice(0, 10);
}

async function verifySupabaseJwt(token, env) {
  if (!token || !env || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return null;
  }
  try {
    const authUrl = `${String(env.SUPABASE_URL).replace(/\/+$/, '')}/auth/v1/user`;
    const resp = await fetch(authUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: env.SUPABASE_ANON_KEY
      }
    });
    if (!resp.ok) return null;
    const user = await resp.json();
    return user && user.id ? user : null;
  } catch (_) {
    return null;
  }
}

async function incrementAndCheckQuota(identityKey, isProModel, env) {
  const today = getUtcDateKey();
  const baseKey = `ai_usage:${today}:${identityKey}`;
  const proKey = `ai_pro:${today}:${identityKey}`;
  const maxDaily = parseInt(env.AI_DAILY_LIMIT || '150', 10) || 150;
  const maxProDaily = parseInt(env.AI_PRO_DAILY_LIMIT || '25', 10) || 25;

  if (env.AI_QUOTA_KV && typeof env.AI_QUOTA_KV.get === 'function') {
    const currentCount = parseInt((await env.AI_QUOTA_KV.get(baseKey)) || '0', 10) || 0;
    if (currentCount >= maxDaily) {
      return { allowed: false, reason: `Daily AI request limit (${maxDaily}) reached for today.` };
    }
    if (isProModel) {
      const currentPro = parseInt((await env.AI_QUOTA_KV.get(proKey)) || '0', 10) || 0;
      if (currentPro >= maxProDaily) {
        return { allowed: false, reason: `Daily Deep Pro limit (${maxProDaily}) reached; switch to Standard mode.` };
      }
      await env.AI_QUOTA_KV.put(proKey, String(currentPro + 1), { expirationTtl: 90000 });
    }
    await env.AI_QUOTA_KV.put(baseKey, String(currentCount + 1), { expirationTtl: 90000 });
    return { allowed: true, remaining: Math.max(0, maxDaily - (currentCount + 1)) };
  }

  const entry = isolateDailyUsage.get(baseKey) || { total: 0, pro: 0 };
  if (entry.total >= maxDaily) {
    return { allowed: false, reason: `Daily AI request limit (${maxDaily}) reached for today.` };
  }
  if (isProModel && entry.pro >= maxProDaily) {
    return { allowed: false, reason: `Daily Deep Pro limit (${maxProDaily}) reached; switch to Standard mode.` };
  }
  entry.total += 1;
  if (isProModel) entry.pro += 1;
  isolateDailyUsage.set(baseKey, entry);
  return { allowed: true, remaining: Math.max(0, maxDaily - entry.total) };
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get('Origin') || '*';
  return new Response(null, { status: 204, headers: buildCorsHeaders(origin) });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '*';
  const cors = buildCorsHeaders(origin);

  const clientRole = (request.headers.get('X-TutorPilot-Role') || '').toLowerCase().trim();
  if (clientRole === 'student_portal') {
    return new Response(JSON.stringify({ error: 'Student portal accounts are not permitted to invoke Tutor AI.' }), {
      status: 403,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  const serverKey = (env && env.GEMINI_API_KEY ? String(env.GEMINI_API_KEY) : '').trim();
  if (!serverKey) {
    return new Response(JSON.stringify({
      error: 'Managed server AI key is not configured yet.',
      fallbackDirect: true
    }), {
      status: 503,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return new Response(JSON.stringify({ error: 'Invalid JSON request body' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  const authHeader = request.headers.get('Authorization') || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const verifiedUser = await verifySupabaseJwt(bearerToken, env || {});

  if (env && env.REQUIRE_AUTH_JWT === 'true' && !verifiedUser) {
    return new Response(JSON.stringify({ error: 'Authentication required for Tutor AI' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown_ip';
  const quotaIdentity = verifiedUser ? `user:${verifiedUser.id}` : `ip:${clientIp}`;
  const requestedModel = String((body && body.model) || 'gemini-3.8-flash').trim();
  const model = ALLOWED_GEMINI_MODELS.has(requestedModel) ? requestedModel : 'gemini-3.8-flash';
  const isProModel = PRO_MODELS.has(model);

  const quota = await incrementAndCheckQuota(quotaIdentity, isProModel, env || {});
  if (!quota.allowed) {
    return new Response(JSON.stringify({ error: quota.reason, quotaExceeded: true }), {
      status: 429,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  const geminiPayload = body && body.payload && typeof body.payload === 'object' ? body.payload : {};
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(serverKey)}`;

  try {
    const upstream = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload)
    });

    const responseText = await upstream.text();
    return new Response(responseText, {
      status: upstream.status,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'X-TutorPilot-Proxy': 'cloudflare-pages',
        'X-TutorPilot-Model': model,
        'X-TutorPilot-Remaining': String(quota.remaining ?? '')
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err && err.message ? err.message : 'Upstream Gemini proxy error' }), {
      status: 502,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
}
