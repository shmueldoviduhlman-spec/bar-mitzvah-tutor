import { handleOptions, jsonResponse } from '../_lib/cors.js';
import { requireTutorAuth } from '../_lib/auth.js';
import {
  ensureM142Schema,
  getBillingConfig,
  getPlatformSettings,
  normalizeTutorBillingPolicy,
  normalizePayoutMethods
} from '../_lib/billing_config.js';
import { reconcileTutorBillingState } from '../_lib/reconcile_billing.js';
import { buildUserCalendarFeedSignature } from '../calendar/ics.js';

export async function onRequestOptions(context) {
  return handleOptions(context, 'GET, PUT, OPTIONS');
}

export async function onRequestGet(context) {
  const auth = await requireTutorAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env } = context;
  const { user } = auth;
  await ensureM142Schema(env.DB);

  const settings = await getPlatformSettings(env.DB);
  const cfg = getBillingConfig(env, settings);
  const tutorBilling = await reconcileTutorBillingState(env.DB, env, user.id, user);
  const earningsRes = await env.DB.prepare(
    'SELECT * FROM tutor_earnings_ledger WHERE tutor_user_id = ? ORDER BY created_at DESC LIMIT 50'
  ).bind(user.id).all().catch(() => ({ results: [] }));

  const sig = await buildUserCalendarFeedSignature(user.id, env.STUDENT_TOKEN_SECRET || env.API_KEY_ENCRYPTION_SECRET || '');
  const origin = String((env && env.APP_ORIGIN) || new URL(request.url).origin).replace(/\/+$/, '');

  return jsonResponse({
    ok: true,
    billingConfig: cfg,
    billingPolicy: normalizeTutorBillingPolicy(user.billing_policy_json),
    payoutMethods: normalizePayoutMethods(user.payout_methods_json),
    tutorBilling,
    stripeConfigured: Boolean(env && env.STRIPE_SECRET_KEY),
    stripeConnectOnboarded: Boolean(user.stripe_connect_onboarded),
    earningsLedger: (earningsRes && earningsRes.results) || [],
    calendarIcsUrl: `${origin}/api/calendar/ics?u=${encodeURIComponent(user.id)}&sig=${sig}`
  }, 200, request, env);
}

export async function onRequestPut(context) {
  const auth = await requireTutorAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env } = context;
  const { user } = auth;
  await ensureM142Schema(env.DB);

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, request, env);
  }

  const nowIso = new Date().toISOString();
  const nextPolicy = body && body.billingPolicy !== undefined
    ? normalizeTutorBillingPolicy(body.billingPolicy)
    : normalizeTutorBillingPolicy(user.billing_policy_json);
  const nextPayouts = body && body.payoutMethods !== undefined
    ? normalizePayoutMethods(body.payoutMethods)
    : normalizePayoutMethods(user.payout_methods_json);

  await env.DB.prepare(
    'UPDATE users SET billing_policy_json = ?, payout_methods_json = ?, updated_at = ? WHERE id = ?'
  ).bind(JSON.stringify(nextPolicy), JSON.stringify(nextPayouts), nowIso, user.id).run();

  const tutorBilling = await reconcileTutorBillingState(env.DB, env, user.id);

  return jsonResponse({
    ok: true,
    billingPolicy: nextPolicy,
    payoutMethods: nextPayouts,
    tutorBilling
  }, 200, request, env);
}
