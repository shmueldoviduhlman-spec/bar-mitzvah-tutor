import { ensureM142Schema } from '../_lib/billing_config.js';
import {
  verifyStripeWebhookSignature,
  reconcileTutorBillingState,
  accrueMonthlyTutorShareForInvoice,
  syncStudentPortalAccessFlag
} from '../_lib/reconcile_billing.js';

function mapStripeSubStatus(stripeStatus) {
  const s = String(stripeStatus || '').toLowerCase();
  if (s === 'trialing') return 'trialing';
  if (s === 'active') return 'active';
  if (s === 'past_due' || s === 'unpaid' || s === 'incomplete' || s === 'incomplete_expired') return 'past_due';
  if (s === 'canceled') return 'canceled';
  return 'past_due';
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env || !env.DB) {
    return new Response(JSON.stringify({ error: 'Database binding missing' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  await ensureM142Schema(env.DB);

  const sigHeader = request.headers.get('Stripe-Signature') || '';
  const rawBody = await request.text();
  const webhookSecret = String((env && env.STRIPE_WEBHOOK_SECRET) || '').trim();

  if (!webhookSecret) {
    return new Response(JSON.stringify({ error: 'STRIPE_WEBHOOK_SECRET not configured' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const validSig = await verifyStripeWebhookSignature(rawBody, sigHeader, webhookSecret);
  if (!validSig) {
    return new Response(JSON.stringify({ error: 'Invalid Stripe webhook signature' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (_) {
    return new Response(JSON.stringify({ error: 'Invalid event payload' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const eventId = String((event && event.id) || '').trim();
  const eventType = String((event && event.type) || '').trim();
  if (!eventId || !eventType) {
    return new Response(JSON.stringify({ error: 'Missing event id or type' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Idempotency check
  const seen = await env.DB.prepare('SELECT event_id FROM billing_webhook_events WHERE event_id = ?').bind(eventId).first().catch(() => null);
  if (seen) {
    return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const nowIso = new Date().toISOString();
  const obj = (event.data && event.data.object) || {};
  const meta = (obj.metadata && typeof obj.metadata === 'object') ? obj.metadata : {};
  const summary = { eventType };

  if (eventType === 'checkout.session.completed') {
    if (meta.kind === 'lesson_payment_request' && meta.payment_request_id) {
      const reqRow = await env.DB.prepare('SELECT * FROM payment_requests WHERE id = ?').bind(meta.payment_request_id).first();
      if (reqRow && reqRow.status !== 'paid') {
        const payId = 'payrec_' + crypto.randomUUID().replace(/-/g, '').slice(0, 18);
        await env.DB.batch([
          env.DB.prepare(
            `UPDATE payment_requests SET status = 'paid', reported_method = 'stripe_direct', stripe_payment_intent_id = ?, paid_at = ?, updated_at = ? WHERE id = ?`
          ).bind(String(obj.payment_intent || ''), nowIso, nowIso, reqRow.id),
          env.DB.prepare(
            `INSERT INTO lesson_payments (
              id, school_id, tutor_user_id, student_id, payment_request_id,
              amount_cents, lessons_settled, currency, method, platform_fee_cents,
              recorded_by_role, confirmed_by_tutor, reference_note, paid_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'stripe_direct', 0, 'stripe_webhook', 1, ?, ?, ?)`
          ).bind(
            payId,
            reqRow.school_id,
            reqRow.tutor_user_id,
            reqRow.student_id,
            reqRow.id,
            Math.round(Number(reqRow.amount_cents || 0)),
            Number(reqRow.lessons_count || 0),
            reqRow.currency || 'USD',
            `Direct Stripe card payment (0% TutorPilot fee)`,
            nowIso,
            nowIso
          )
        ]);
        summary.paymentRequestPaid = reqRow.id;
      }
    } else if (meta.kind === 'student_subscription' && meta.student_id) {
      await env.DB.prepare(
        `UPDATE student_subscriptions SET stripe_customer_id = ?, stripe_subscription_id = ?, updated_at = ? WHERE student_id = ?`
      ).bind(String(obj.customer || ''), String(obj.subscription || ''), nowIso, meta.student_id).run().catch(() => {});
    } else if (meta.kind === 'tutor_subscription' && meta.tutor_user_id) {
      await env.DB.prepare(
        `UPDATE users SET stripe_customer_id = ?, stripe_subscription_id = ?, updated_at = ? WHERE id = ?`
      ).bind(String(obj.customer || ''), String(obj.subscription || ''), nowIso, meta.tutor_user_id).run().catch(() => {});
    }
  } else if (eventType === 'customer.subscription.created' || eventType === 'customer.subscription.updated' || eventType === 'customer.subscription.deleted') {
    const mapped = eventType === 'customer.subscription.deleted' ? 'canceled' : mapStripeSubStatus(obj.status);
    const periodEndIso = obj.current_period_end ? new Date(Number(obj.current_period_end) * 1000).toISOString() : '';

    if (meta.kind === 'student_subscription' || meta.student_id) {
      const stuId = String(meta.student_id || '');
      let subRow = stuId
        ? await env.DB.prepare('SELECT * FROM student_subscriptions WHERE student_id = ?').bind(stuId).first()
        : await env.DB.prepare('SELECT * FROM student_subscriptions WHERE stripe_subscription_id = ?').bind(String(obj.id || '')).first();
      if (subRow) {
        await env.DB.prepare(
          `UPDATE student_subscriptions
           SET status = ?, current_period_end = ?, stripe_customer_id = COALESCE(NULLIF(?, ''), stripe_customer_id),
               stripe_subscription_id = ?, canceled_at = ?, updated_at = ?
           WHERE student_id = ?`
        ).bind(
          mapped,
          periodEndIso,
          String(obj.customer || ''),
          String(obj.id || subRow.stripe_subscription_id || ''),
          mapped === 'canceled' ? nowIso : '',
          nowIso,
          subRow.student_id
        ).run();
        const refreshed = await env.DB.prepare('SELECT * FROM student_subscriptions WHERE student_id = ?').bind(subRow.student_id).first();
        await syncStudentPortalAccessFlag(env.DB, subRow.student_id, refreshed);
        summary.tutorReconciled = await reconcileTutorBillingState(env.DB, env, subRow.tutor_user_id);
      }
    } else {
      const tutorId = String(meta.tutor_user_id || '');
      const targetTutor = tutorId
        ? await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(tutorId).first()
        : await env.DB.prepare('SELECT * FROM users WHERE stripe_subscription_id = ?').bind(String(obj.id || '')).first();
      if (targetTutor && targetTutor.role !== 'super_admin' && targetTutor.subscription_status !== 'lifetime') {
        const nextUserSub = mapped === 'past_due' ? 'expired' : mapped;
        await env.DB.prepare(
          `UPDATE users SET subscription_status = ?, stripe_customer_id = COALESCE(NULLIF(?, ''), stripe_customer_id), stripe_subscription_id = ?, updated_at = ? WHERE id = ?`
        ).bind(nextUserSub, String(obj.customer || ''), String(obj.id || ''), nowIso, targetTutor.id).run();
        summary.tutorReconciled = await reconcileTutorBillingState(env.DB, env, targetTutor.id);
      }
    }
  } else if (eventType === 'invoice.paid' || eventType === 'invoice.payment_failed') {
    const subId = String(obj.subscription || '');
    const subDetailsMeta = (obj.subscription_details && obj.subscription_details.metadata) || meta || {};
    const stuSub = subId
      ? await env.DB.prepare('SELECT * FROM student_subscriptions WHERE stripe_subscription_id = ?').bind(subId).first()
      : (subDetailsMeta.student_id ? await env.DB.prepare('SELECT * FROM student_subscriptions WHERE student_id = ?').bind(subDetailsMeta.student_id).first() : null);

    if (stuSub) {
      const nextSt = eventType === 'invoice.paid' ? 'active' : 'past_due';
      await env.DB.prepare('UPDATE student_subscriptions SET status = ?, updated_at = ? WHERE student_id = ?')
        .bind(nextSt, nowIso, stuSub.student_id).run();
      const refreshed = await env.DB.prepare('SELECT * FROM student_subscriptions WHERE student_id = ?').bind(stuSub.student_id).first();
      await syncStudentPortalAccessFlag(env.DB, stuSub.student_id, refreshed);

      if (eventType === 'invoice.paid') {
        summary.tutorShare = await accrueMonthlyTutorShareForInvoice(env.DB, env, {
          tutorUserId: stuSub.tutor_user_id,
          studentId: stuSub.student_id,
          stripeInvoiceId: String(obj.id || ''),
          periodMonth: nowIso.slice(0, 7)
        });
      } else {
        summary.tutorReconciled = await reconcileTutorBillingState(env.DB, env, stuSub.tutor_user_id);
      }
    } else if (subId) {
      const tutorRow = await env.DB.prepare('SELECT * FROM users WHERE stripe_subscription_id = ?').bind(subId).first();
      if (tutorRow && tutorRow.role !== 'super_admin' && tutorRow.subscription_status !== 'lifetime') {
        const nextSt = eventType === 'invoice.paid' ? 'active' : 'expired';
        await env.DB.prepare('UPDATE users SET subscription_status = ?, updated_at = ? WHERE id = ?')
          .bind(nextSt, nowIso, tutorRow.id).run();
        summary.tutorReconciled = await reconcileTutorBillingState(env.DB, env, tutorRow.id);
      }
    }
  } else if (eventType === 'account.updated' && obj.id) {
    const onboarded = (obj.charges_enabled || obj.payouts_enabled) ? 1 : 0;
    await env.DB.prepare('UPDATE users SET stripe_connect_onboarded = ?, updated_at = ? WHERE stripe_connect_account_id = ?')
      .bind(onboarded, nowIso, String(obj.id)).run().catch(() => {});
  }

  await env.DB.prepare(
    'INSERT OR IGNORE INTO billing_webhook_events (event_id, event_type, processed_at, summary_json) VALUES (?, ?, ?, ?)'
  ).bind(eventId, eventType, nowIso, JSON.stringify(summary)).run().catch(() => {});

  return new Response(JSON.stringify({ received: true, eventType, summary }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
