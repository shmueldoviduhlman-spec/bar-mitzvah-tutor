import { handleOptions, jsonResponse } from './_lib/cors.js';
import { requireTutorAuth } from './_lib/auth.js';
import { sha256Hex, generateRandomCode } from './_lib/crypto.js';

export async function onRequestOptions(context) {
  return handleOptions(context, 'GET, POST, DELETE, OPTIONS');
}

export async function onRequestGet(context) {
  const auth = await requireTutorAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env } = context;

  const rows = await env.DB.prepare(
    `SELECT token_hash, label, capabilities_json, revoked_at, last_used_at, created_at
     FROM external_agent_tokens
     WHERE user_id = ? AND (revoked_at IS NULL OR revoked_at = '')
     ORDER BY created_at DESC`
  ).bind(auth.user.id).all();

  const tokens = ((rows && rows.results) || []).map(r => ({
    tokenHash: r.token_hash,
    label: r.label,
    capabilities: (() => { try { return JSON.parse(r.capabilities_json || '{}'); } catch (_) { return {}; } })(),
    lastUsedAt: r.last_used_at || '',
    createdAt: r.created_at
  }));

  return jsonResponse({ tokens }, 200, request, env);
}

export async function onRequestPost(context) {
  const auth = await requireTutorAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env } = context;

  let body;
  try { body = await request.json(); } catch (_) { body = {}; }

  const rawToken = `tp_ext_${generateRandomCode(32, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')}`;
  const tokenHash = await sha256Hex(rawToken);
  const label = String((body && body.label) || 'Personal AI Agent').trim().slice(0, 80);
  const caps = {
    afterClass: !(body && body.capabilities && body.capabilities.afterClass === false),
    schedule: !(body && body.capabilities && body.capabilities.schedule === false),
    appGuide: !(body && body.capabilities && body.capabilities.appGuide === false)
  };
  const nowIso = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO external_agent_tokens (token_hash, user_id, school_id, label, capabilities_json, revoked_at, last_used_at, created_at)
     VALUES (?, ?, ?, ?, ?, '', '', ?)`
  ).bind(tokenHash, auth.user.id, auth.user.school_id, label, JSON.stringify(caps), nowIso).run();

  return jsonResponse({
    ok: true,
    rawToken,
    tokenHash,
    label,
    capabilities: caps,
    createdAt: nowIso
  }, 201, request, env);
}

export async function onRequestDelete(context) {
  const auth = await requireTutorAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env } = context;
  const u = new URL(request.url);
  const tokenHash = String(u.searchParams.get('tokenHash') || '').trim();
  if (!tokenHash) return jsonResponse({ error: 'tokenHash query param required' }, 400, request, env);

  await env.DB.prepare(
    'UPDATE external_agent_tokens SET revoked_at = ? WHERE token_hash = ? AND user_id = ?'
  ).bind(new Date().toISOString(), tokenHash, auth.user.id).run();

  return jsonResponse({ ok: true, revokedTokenHash: tokenHash }, 200, request, env);
}
