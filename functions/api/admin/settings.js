import { handleOptions, jsonResponse } from '../_lib/cors.js';
import { requireAdminAuth, getPlatformSettings, logAdminAudit } from '../_lib/auth.js';

export async function onRequestOptions(context) {
  return handleOptions(context, 'GET, PATCH, OPTIONS');
}

export async function onRequestGet(context) {
  const auth = await requireAdminAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const settings = await getPlatformSettings(context.env.DB);
  return jsonResponse({ settings }, 200, context.request, context.env);
}

export async function onRequestPatch(context) {
  const auth = await requireAdminAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env } = context;

  let body;
  try { body = await request.json(); } catch (_) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, request, env);
  }

  const nowIso = new Date().toISOString();
  const updates = [];
  const changed = {};

  if (typeof (body && body.default_trial_days) === 'number' && body.default_trial_days > 0) {
    const val = Math.trunc(body.default_trial_days);
    updates.push(
      env.DB.prepare('INSERT OR REPLACE INTO platform_settings (key, value_json, updated_by, updated_at) VALUES (?, ?, ?, ?)')
        .bind('default_trial_days', JSON.stringify(val), auth.user.email, nowIso)
    );
    changed.default_trial_days = val;
  }

  if (typeof (body && body.global_ai_enabled) === 'boolean') {
    updates.push(
      env.DB.prepare('INSERT OR REPLACE INTO platform_settings (key, value_json, updated_by, updated_at) VALUES (?, ?, ?, ?)')
        .bind('global_ai_enabled', JSON.stringify(body.global_ai_enabled), auth.user.email, nowIso)
    );
    changed.global_ai_enabled = body.global_ai_enabled;
  }

  if (typeof (body && body.default_ai_daily_limit) === 'number' && body.default_ai_daily_limit >= 0) {
    const val = Math.trunc(body.default_ai_daily_limit);
    updates.push(
      env.DB.prepare('INSERT OR REPLACE INTO platform_settings (key, value_json, updated_by, updated_at) VALUES (?, ?, ?, ?)')
        .bind('default_ai_daily_limit', JSON.stringify(val), auth.user.email, nowIso)
    );
    changed.default_ai_daily_limit = val;
  }

  if (typeof (body && body.default_ai_pro_daily_limit) === 'number' && body.default_ai_pro_daily_limit >= 0) {
    const val = Math.trunc(body.default_ai_pro_daily_limit);
    updates.push(
      env.DB.prepare('INSERT OR REPLACE INTO platform_settings (key, value_json, updated_by, updated_at) VALUES (?, ?, ?, ?)')
        .bind('default_ai_pro_daily_limit', JSON.stringify(val), auth.user.email, nowIso)
    );
    changed.default_ai_pro_daily_limit = val;
  }

  if (typeof (body && body.announcement_banner) === 'string') {
    const val = String(body.announcement_banner).trim().slice(0, 300);
    updates.push(
      env.DB.prepare('INSERT OR REPLACE INTO platform_settings (key, value_json, updated_by, updated_at) VALUES (?, ?, ?, ?)')
        .bind('announcement_banner', JSON.stringify(val), auth.user.email, nowIso)
    );
    changed.announcement_banner = val;
  }

  if (updates.length > 0) {
    await env.DB.batch(updates);
    await logAdminAudit(env.DB, auth.user, null, 'update_platform_settings', changed);
  }

  const settings = await getPlatformSettings(env.DB);
  return jsonResponse({ ok: true, settings }, 200, request, env);
}
