/**
 * Strict CORS & JSON Response Helpers for TutorPilot Edge APIs
 */

const ALLOWED_STATIC_ORIGINS = new Set([
  'https://tutorpilot.us',
  'https://www.tutorpilot.us',
  'https://tutorpilot.pages.dev'
]);

export function isAllowedOrigin(origin, env) {
  if (!origin) return false;
  const clean = String(origin).trim();
  if (ALLOWED_STATIC_ORIGINS.has(clean)) return true;
  if (env && env.APP_ORIGIN && clean === String(env.APP_ORIGIN).trim()) return true;
  try {
    const parsed = new URL(clean);
    if (parsed.protocol === 'https:' && parsed.hostname.endsWith('.tutorpilot.pages.dev')) {
      return true;
    }
    if ((parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
        (parsed.protocol === 'http:' || parsed.protocol === 'https:')) {
      return true;
    }
  } catch (_) {}
  return false;
}

export function buildCorsHeaders(request, env, methods = 'GET, POST, PUT, PATCH, DELETE, OPTIONS') {
  const origin = request && request.headers ? (request.headers.get('Origin') || '') : '';
  const headers = {
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Student-Token, X-TutorPilot-Token, X-TutorPilot-Role, X-TutorPilot-Client',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
  if (isAllowedOrigin(origin, env)) {
    headers['Access-Control-Allow-Origin'] = origin;
  } else if (!origin) {
    headers['Access-Control-Allow-Origin'] = (env && env.APP_ORIGIN) || 'https://tutorpilot.us';
  }
  return headers;
}

export function handleOptions(context, methods) {
  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders(context.request, context.env, methods)
  });
}

export function jsonResponse(payload, status, request, env, extraHeaders = {}) {
  const cors = buildCorsHeaders(request, env);
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...cors,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders
    }
  });
}
