import { handleOptions, jsonResponse } from '../_lib/cors.js';
import { requireTutorAuth } from '../_lib/auth.js';
import { ensureM142Schema } from '../_lib/billing_config.js';
import { stripeApiRequest } from '../_lib/reconcile_billing.js';

export async function onRequestOptions(context) {
  return handleOptions(context, 'POST, OPTIONS');
}

export async function onRequestPost(context) {
  const auth = await requireTutorAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env } = context;
  const { user } = auth;
  await ensureM142Schema(env.DB);

  if (!env.STRIPE_SECRET_KEY) {
    return jsonResponse({
      ok: false,
      stripeConfigured: false,
      message: 'Stripe Connect card payouts will activate automatically once STRIPE_SECRET_KEY is configured. Your direct P2P handles (Zelle, Venmo, Cash, Bank) work with 0% fees right now.'
    }, 200, request, env);
  }

  let accountId = String(user.stripe_connect_account_id || '').trim();
  if (!accountId) {
    const createAcct = await stripeApiRequest(env, 'POST', '/v1/accounts', {
      type: 'express',
      email: user.email || undefined,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true }
      },
      metadata: {
        tutor_user_id: user.id,
        school_id: user.school_id
      }
    });
    if (!createAcct.ok || !createAcct.data || !createAcct.data.id) {
      return jsonResponse({ error: createAcct.error || 'Unable to create Stripe Connect account' }, 502, request, env);
    }
    accountId = createAcct.data.id;
    await env.DB.prepare('UPDATE users SET stripe_connect_account_id = ?, updated_at = ? WHERE id = ?')
      .bind(accountId, new Date().toISOString(), user.id).run();
  }

  const origin = String((env && env.APP_ORIGIN) || new URL(request.url).origin).replace(/\/+$/, '');
  const linkRes = await stripeApiRequest(env, 'POST', '/v1/account_links', {
    account: accountId,
    refresh_url: `${origin}/?connect=refresh`,
    return_url: `${origin}/?connect=complete`,
    type: 'account_onboarding'
  });

  if (!linkRes.ok || !linkRes.data || !linkRes.data.url) {
    return jsonResponse({ error: linkRes.error || 'Unable to create Stripe Connect onboarding link' }, 502, request, env);
  }

  return jsonResponse({
    ok: true,
    stripeConfigured: true,
    accountId,
    url: linkRes.data.url
  }, 200, request, env);
}
