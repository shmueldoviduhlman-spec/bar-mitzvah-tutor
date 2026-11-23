import { handleOptions, jsonResponse } from '../_lib/cors.js';
import { requireAdminAuth } from '../_lib/auth.js';

export async function onRequestOptions(context) {
  return handleOptions(context, 'GET, OPTIONS');
}

export async function onRequestGet(context) {
  const auth = await requireAdminAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env } = context;

  const u = new URL(request.url);
  const limit = Math.min(200, Math.max(10, parseInt(u.searchParams.get('limit') || '60', 10) || 60));
  const search = String(u.searchParams.get('q') || '').trim().toLowerCase();

  const res = await env.DB.prepare(
    'SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT ?'
  ).bind(limit).all();

  let logs = ((res && res.results) || []).map(r => {
    let details = {};
    try { details = r.details_json ? JSON.parse(r.details_json) : {}; } catch (_) {}
    return {
      id: r.id,
      actorUserId: r.actor_user_id,
      actorEmail: r.actor_email,
      targetUserId: r.target_user_id,
      targetEmail: r.target_email,
      action: r.action,
      details,
      createdAt: r.created_at
    };
  });

  if (search) {
    logs = logs.filter(l =>
      (l.actorEmail || '').toLowerCase().includes(search) ||
      (l.targetEmail || '').toLowerCase().includes(search) ||
      (l.action || '').toLowerCase().includes(search) ||
      JSON.stringify(l.details || {}).toLowerCase().includes(search)
    );
  }

  return jsonResponse({ logs }, 200, request, env);
}
