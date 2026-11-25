import { handleOptions, jsonResponse } from '../_lib/cors.js';
import { extractBearerToken, verifyClerkJwt, ensureD1User } from '../_lib/auth.js';
import { ensureM142Schema, getBillingConfig, getPlatformSettings } from '../_lib/billing_config.js';
import { stripeApiRequest } from '../_lib/reconcile_billing.js';
import { sha256Hex } from '../_lib/crypto.js';

export async function onRequestOptions(context) {
  return handleOptions(context, 'POST, OPTIONS');
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env || !env.DB) return jsonResponse({ error: 'Database binding missing' }, 500, request, env);
  await ensureM142Schema(env.DB);

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, request, env);
  }

  const kind = String((body && body.kind) || '').trim();
  const origin = String((env && env.APP_ORIGIN) || new URL(request.url).origin).replace(/\/+$/, '');
  const settings = await getPlatformSettings(env.DB);
  const cfg = getBillingConfig(env, settings);

  if (!env.STRIPE_SECRET_KEY) {
    return jsonResponse({
      ok: false,
      stripeConfigured: false,
      message: 'Card checkout activates automatically once STRIPE_SECRET_KEY is configured. P2P payments (Zelle, Venmo, Cash, Bank Transfer) and free trials are active right now.'
    }, 200, request, env);
  }

  // Flow 1: Direct 0%-Platform-Cut Card Payment for a Tutor Payment Request
  if (kind === 'lesson_payment_request') {
    const payToken = String((body && body.payToken) || '').trim();
    const requestId = String((body && body.paymentRequestId) || '').trim();
    let reqRow = null;

    if (payToken) {
      const h = await sha256Hex(payToken);
      reqRow = await env.DB.prepare('SELECT * FROM payment_requests WHERE public_token_hash = ?').bind(h).first();
    } else if (requestId) {
      const tok = extractBearerToken(request);
      const clerk = tok ? await verifyClerkJwt(tok, env) : null;
      if (!clerk) return jsonResponse({ error: 'Authentication required' }, 401, request, env);
      await ensureD1User(env.DB, clerk, env, 'auto');
      reqRow = await env.DB.prepare('SELECT * FROM payment_requests WHERE id = ?').bind(requestId).first();
    }

    if (!reqRow) return jsonResponse({ error: 'Payment request not found' }, 404, request, env);
    if (reqRow.status === 'paid') return jsonResponse({ error: 'Payment request already paid' }, 400, request, env);

    const tutorRow = await env.DB.prepare('SELECT id, full_name, email, stripe_connect_account_id, stripe_connect_onboarded FROM users WHERE id = ?')
      .bind(reqRow.tutor_user_id).first();
    if (!tutorRow || !tutorRow.stripe_connect_account_id || !tutorRow.stripe_connect_onboarded) {
      return jsonResponse({
        ok: false,
        connectRequired: true,
        message: 'Direct card checkout requires your tutor to finish Stripe Connect setup. You can send via Zelle / Venmo / Cash (0% fees) right now.'
      }, 200, request, env);
    }

    const platformFeeCents = Math.round((Number(reqRow.amount_cents || 0) * cfg.lessonPlatformFeeBps) / 10000); // 0 when LESSON_PLATFORM_FEE_BPS=0
    const successUrl = payToken
      ? `${origin}/?pay=${encodeURIComponent(payToken)}&paid=1`
      : `${origin}/?auth=1&paid=1`;
    const cancelUrl = payToken ? `${origin}/?pay=${encodeURIComponent(payToken)}` : `${origin}/`;

    const stripeRes = await stripeApiRequest(env, 'POST', '/v1/checkout/sessions', {
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: String(reqRow.currency || 'usd').toLowerCase(),
          unit_amount: Math.round(Number(reqRow.amount_cents || 0)),
          product_data: {
            name: reqRow.description || 'Tutoring Lessons'
          }
        }
      }],
      payment_intent_data: {
        application_fee_amount: platformFeeCents,
        transfer_data: {
          destination: tutorRow.stripe_connect_account_id
        },
        metadata: {
          kind: 'lesson_payment_request',
          payment_request_id: reqRow.id,
          student_id: reqRow.student_id,
          tutor_user_id: reqRow.tutor_user_id
        }
      },
      metadata: {
        kind: 'lesson_payment_request',
        payment_request_id: reqRow.id,
        student_id: reqRow.student_id,
        tutor_user_id: reqRow.tutor_user_id
      }
    });

    if (!stripeRes.ok || !stripeRes.data || !stripeRes.data.url) {
      return jsonResponse({ error: stripeRes.error || 'Unable to create Stripe direct payment session' }, 502, request, env);
    }
    await env.DB.prepare('UPDATE payment_requests SET stripe_checkout_session_id = ?, updated_at = ? WHERE id = ?')
      .bind(stripeRes.data.id, new Date().toISOString(), reqRow.id).run().catch(() => {});
    return jsonResponse({ ok: true, stripeConfigured: true, url: stripeRes.data.url, sessionId: stripeRes.data.id }, 200, request, env);
  }

  // Subscription flows require Clerk session authentication
  const tok = extractBearerToken(request);
  const clerk = tok ? await verifyClerkJwt(tok, env) : null;
  if (!clerk) return jsonResponse({ error: 'Authentication required' }, 401, request, env);
  const user = await ensureD1User(env.DB, clerk, env, 'auto');

  if (kind === 'student_subscription') {
    const studentId = String((body && body.studentId) || '').trim();
    const stuRow = await env.DB.prepare('SELECT * FROM students WHERE id = ?').bind(studentId).first();
    if (!stuRow) return jsonResponse({ error: 'Student not found' }, 404, request, env);

    const subRow = await env.DB.prepare('SELECT * FROM student_subscriptions WHERE student_id = ?').bind(stuRow.id).first();
    let remainingTrialDays = 0;
    if (subRow && subRow.status === 'trialing' && subRow.trial_ends_at) {
      const remMs = Date.parse(subRow.trial_ends_at) - Date.now();
      if (remMs > 86400000) remainingTrialDays = Math.floor(remMs / 86400000);
    }

    const sessionPayload = {
      mode: 'subscription',
      success_url: `${origin}/?auth=1&sub_updated=student`,
      cancel_url: `${origin}/?auth=1`,
      customer_email: user.email || undefined,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: cfg.parentSubscriptionPriceCents,
          recurring: { interval: 'month' },
          product_data: {
            name: `TutorPilot Student Portal — ${stuRow.name}`
          }
        }
      }],
      subscription_data: {
        ...(remainingTrialDays > 0 ? { trial_period_days: remainingTrialDays } : {}),
        metadata: {
          kind: 'student_subscription',
          student_id: stuRow.id,
          tutor_user_id: stuRow.owner_user_id,
          payer_user_id: user.id
        }
      },
      metadata: {
        kind: 'student_subscription',
        student_id: stuRow.id,
        tutor_user_id: stuRow.owner_user_id,
        payer_user_id: user.id
      }
    };

    const stripeRes = await stripeApiRequest(env, 'POST', '/v1/checkout/sessions', sessionPayload);
    if (!stripeRes.ok || !stripeRes.data || !stripeRes.data.url) {
      return jsonResponse({ error: stripeRes.error || 'Unable to start student subscription checkout' }, 502, request, env);
    }
    return jsonResponse({ ok: true, stripeConfigured: true, url: stripeRes.data.url, sessionId: stripeRes.data.id }, 200, request, env);
  }

  if (kind === 'tutor_subscription') {
    let remainingTrialDays = 0;
    if (user.subscription_status === 'trialing' && user.trial_ends_at) {
      const remMs = Date.parse(user.trial_ends_at) - Date.now();
      if (remMs > 86400000) remainingTrialDays = Math.floor(remMs / 86400000);
    }
    const stripeRes = await stripeApiRequest(env, 'POST', '/v1/checkout/sessions', {
      mode: 'subscription',
      success_url: `${origin}/?auth=1&sub_updated=tutor`,
      cancel_url: `${origin}/?auth=1`,
      customer_email: user.email || undefined,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: cfg.tutorSubscriptionPriceCents,
          recurring: { interval: 'month' },
          product_data: {
            name: 'TutorPilot Studio Plan (Auto-Waived at 5 Active Paying Students)'
          }
        }
      }],
      subscription_data: {
        ...(remainingTrialDays > 0 ? { trial_period_days: remainingTrialDays } : {}),
        metadata: {
          kind: 'tutor_subscription',
          tutor_user_id: user.id
        }
      },
      metadata: {
        kind: 'tutor_subscription',
        tutor_user_id: user.id
      }
    });
    if (!stripeRes.ok || !stripeRes.data || !stripeRes.data.url) {
      return jsonResponse({ error: stripeRes.error || 'Unable to start tutor subscription checkout' }, 502, request, env);
    }
    return jsonResponse({ ok: true, stripeConfigured: true, url: stripeRes.data.url, sessionId: stripeRes.data.id }, 200, request, env);
  }

  return jsonResponse({ error: 'Invalid checkout kind' }, 400, request, env);
}
