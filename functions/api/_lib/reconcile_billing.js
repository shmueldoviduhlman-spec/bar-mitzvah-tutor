/**
 * TutorPilot Subscription Lifecycle, Tutor $15/mo Automatic Waiver/Resume,
 * $1/Active-Paying-Student Share Ledger, 0%-Cut Direct Lesson Checkout,
 * and Stripe Webhook Engine (Zero npm dependencies — Web Crypto + native fetch)
 */

import { getBillingConfig, ensureM142Schema, safeJsonParse, getPlatformSettings } from './billing_config.js';
import { timingSafeEqualStr } from './crypto.js';

const textEncoder = new TextEncoder();

export function toHex(bytes) {
  return Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyStripeWebhookSignature(rawBody, sigHeader, webhookSecret, toleranceSec = 300) {
  const secret = String(webhookSecret || '').trim();
  if (!secret || !sigHeader) return false;

  const parts = String(sigHeader).split(',').map(p => p.trim());
  let timestamp = '';
  const signatures = [];
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx <= 0) continue;
    const k = part.slice(0, eqIdx).trim();
    const v = part.slice(eqIdx + 1).trim();
    if (k === 't') timestamp = v;
    else if (k === 'v1') signatures.push(v);
  }
  const tsNum = parseInt(timestamp, 10);
  if (!timestamp || Number.isNaN(tsNum) || signatures.length === 0) return false;

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > toleranceSec) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signedBuf = await crypto.subtle.sign('HMAC', key, textEncoder.encode(`${timestamp}.${rawBody || ''}`));
  const expectedHex = toHex(signedBuf);
  return signatures.some(sig => timingSafeEqualStr(sig.toLowerCase(), expectedHex));
}

export function encodeFormParams(obj, prefix = '') {
  const params = [];
  if (!obj || typeof obj !== 'object') return '';
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === null) {
      params.push(`${encodeURIComponent(key)}=`);
    } else if (Array.isArray(v)) {
      v.forEach((item, idx) => {
        if (item && typeof item === 'object') {
          const nested = encodeFormParams(item, `${key}[${idx}]`);
          if (nested) params.push(nested);
        } else if (item !== undefined && item !== null) {
          params.push(`${encodeURIComponent(`${key}[${idx}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof v === 'object') {
      const nested = encodeFormParams(v, key);
      if (nested) params.push(nested);
    } else {
      params.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return params.filter(Boolean).join('&');
}

export async function stripeApiRequest(env, method, apiPath, formObj = null, extraHeaders = {}) {
  const secret = String((env && env.STRIPE_SECRET_KEY) || '').trim();
  if (!secret) {
    return { configured: false, ok: false, status: 503, error: 'STRIPE_SECRET_KEY not configured' };
  }
  const url = `https://api.stripe.com${apiPath.startsWith('/') ? apiPath : `/${apiPath}`}`;
  const headers = {
    Authorization: `Bearer ${secret}`,
    ...extraHeaders
  };
  const init = { method, headers };
  if (formObj && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = encodeFormParams(formObj);
  }
  const resp = await fetch(url, init);
  const data = await resp.json().catch(() => ({}));
  return {
    configured: true,
    ok: resp.ok,
    status: resp.status,
    data,
    error: (!resp.ok && data && data.error && data.error.message) ? data.error.message : (!resp.ok ? `Stripe API error (${resp.status})` : '')
  };
}

export function evaluateStudentPortalAccess(subRow, studentRow = null) {
  const statusRaw = String((subRow && subRow.status) || (studentRow && studentRow.portal_status) || 'not_activated').toLowerCase();
  if (!subRow && (!studentRow || !studentRow.portal_status || statusRaw === 'not_activated')) {
    return { portalStatus: 'not_activated', canLogin: false, readOnly: true, reason: 'not_activated', trialDaysLeft: 0 };
  }
  if (statusRaw === 'not_activated' || statusRaw === 'invited') {
    return { portalStatus: statusRaw, canLogin: false, readOnly: true, reason: 'not_activated', trialDaysLeft: 0 };
  }
  if (statusRaw === 'active' || statusRaw === 'comped') {
    return {
      portalStatus: statusRaw,
      canLogin: true,
      readOnly: false,
      reason: '',
      trialEndsAt: (subRow && subRow.trial_ends_at) || '',
      currentPeriodEnd: (subRow && subRow.current_period_end) || '',
      trialDaysLeft: 0
    };
  }
  if (statusRaw === 'trialing') {
    const endsAt = (subRow && subRow.trial_ends_at) || '';
    const endMs = endsAt ? Date.parse(endsAt) : NaN;
    if (endsAt && !Number.isNaN(endMs)) {
      const msLeft = endMs - Date.now();
      if (msLeft <= 0) {
        return {
          portalStatus: 'read_only',
          canLogin: true,
          readOnly: true,
          reason: 'trial_ended',
          trialEndsAt: endsAt,
          trialDaysLeft: 0
        };
      }
      return {
        portalStatus: 'trialing',
        canLogin: true,
        readOnly: false,
        reason: '',
        trialEndsAt: endsAt,
        trialDaysLeft: Math.max(1, Math.ceil(msLeft / 86400000))
      };
    }
    return { portalStatus: 'trialing', canLogin: true, readOnly: false, reason: '', trialEndsAt: endsAt, trialDaysLeft: 7 };
  }
  return {
    portalStatus: 'read_only',
    canLogin: true,
    readOnly: true,
    reason: statusRaw || 'subscription_lapsed',
    trialEndsAt: (subRow && subRow.trial_ends_at) || '',
    trialDaysLeft: 0
  };
}

export async function syncStudentPortalAccessFlag(db, studentId, subRow) {
  if (!db || !studentId) return;
  const evalRes = evaluateStudentPortalAccess(subRow);
  const nextStatus = evalRes.portalStatus;
  try {
    await db.prepare('UPDATE students SET portal_status = ? WHERE id = ?').bind(nextStatus, studentId).run();
  } catch (_) {}
}

export async function reconcileTutorBillingState(db, env = {}, tutorUserId, preloadedUser = null) {
  if (!tutorUserId) {
    return {
      accessMode: 'full',
      readOnlyReason: '',
      activePayingStudentsCount: 0,
      waiverThreshold: 5,
      tutorFeeWaived: false,
      isLifetimeFreeTutor: false,
      qualifiesForWaiverAndShare: false,
      monthlyShareCents: 0,
      totalShareEarnedCents: 0,
      sharePerStudentCents: 100,
      tutorSubscriptionPriceCents: 1500
    };
  }

  if (db) await ensureM142Schema(db);
  const settings = db ? await getPlatformSettings(db) : {};
  const cfg = getBillingConfig(env, settings);

  let user = preloadedUser;
  if (!user && db) {
    user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(tutorUserId).first().catch(() => null);
  }
  if (!user) {
    return {
      accessMode: 'full',
      readOnlyReason: '',
      activePayingStudentsCount: 0,
      waiverThreshold: cfg.tutorWaiverMinPayingStudents,
      tutorFeeWaived: false,
      isLifetimeFreeTutor: false,
      qualifiesForWaiverAndShare: false,
      monthlyShareCents: 0,
      totalShareEarnedCents: 0,
      sharePerStudentCents: cfg.tutorSharePerStudentCents,
      tutorSubscriptionPriceCents: cfg.tutorSubscriptionPriceCents
    };
  }

  let activePayingCount = 0;
  let totalShareEarnedCents = 0;
  if (db) {
    try {
      const cntRow = await db.prepare(
        `SELECT COUNT(*) AS cnt
         FROM student_subscriptions ss
         INNER JOIN students s ON s.id = ss.student_id
         WHERE ss.tutor_user_id = ? AND s.archived = 0 AND ss.status = 'active'`
      ).bind(tutorUserId).first();
      activePayingCount = Number((cntRow && cntRow.cnt) || 0);
    } catch (_) {
      activePayingCount = Number(user.active_paying_students_count || 0);
    }
    try {
      const earnRow = await db.prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS total_cents
         FROM tutor_earnings_ledger
         WHERE tutor_user_id = ? AND status != 'reversed'`
      ).bind(tutorUserId).first();
      totalShareEarnedCents = Number((earnRow && earnRow.total_cents) || 0);
    } catch (_) {}
  }

  const isLifetimeFreeTutor = (user.role === 'super_admin') || (String(user.subscription_status || '').toLowerCase() === 'lifetime');
  const qualifiesForWaiverAndShare = activePayingCount >= cfg.tutorWaiverMinPayingStudents;
  const monthlyShareCents = qualifiesForWaiverAndShare ? (activePayingCount * cfg.tutorSharePerStudentCents) : 0;

  let tutorFeeWaived = qualifiesForWaiverAndShare ? 1 : 0;
  let accessMode = 'full';
  let readOnlyReason = '';

  const subSt = String(user.subscription_status || 'trialing').toLowerCase();
  const trialValid = subSt === 'trialing' && (!user.trial_ends_at || Date.parse(user.trial_ends_at) > Date.now());
  let trialDaysLeft = 0;
  if (subSt === 'trialing' && user.trial_ends_at) {
    const diff = Date.parse(user.trial_ends_at) - Date.now();
    trialDaysLeft = diff > 0 ? Math.max(1, Math.ceil(diff / 86400000)) : 0;
  }

  if (user.account_status === 'suspended') {
    accessMode = 'read_only';
    readOnlyReason = 'account_suspended';
  } else if (isLifetimeFreeTutor) {
    accessMode = 'full';
  } else if (qualifiesForWaiverAndShare) {
    accessMode = 'full';
    // Automatically waive Tutor $15/mo fee on Stripe if subscription exists
    if (user.stripe_subscription_id && env && env.STRIPE_SECRET_KEY) {
      await stripeApiRequest(env, 'POST', `/v1/subscriptions/${encodeURIComponent(user.stripe_subscription_id)}`, {
        pause_collection: { behavior: 'void' }
      }).catch(() => {});
    }
  } else {
    // Under threshold (< 5 active paying students)
    if (subSt === 'active' || trialValid) {
      accessMode = 'full';
      // Resume Stripe $15/mo billing if trial ended and tutor has an attached Stripe subscription
      if (subSt === 'active' && user.stripe_subscription_id && env && env.STRIPE_SECRET_KEY && Number(user.tutor_fee_waived || 0) === 1) {
        await stripeApiRequest(env, 'POST', `/v1/subscriptions/${encodeURIComponent(user.stripe_subscription_id)}`, {
          pause_collection: ''
        }).catch(() => {});
      }
    } else {
      // Trial ended or canceled/expired with < 5 active paying students
      accessMode = 'read_only';
      readOnlyReason = (subSt === 'canceled' || subSt === 'expired' || subSt === 'past_due')
        ? 'tutor_subscription_lapsed'
        : 'tutor_trial_ended';
      // Auto-mark expired trialing users cleanly in D1
      if (subSt === 'trialing' && db) {
        await db.prepare("UPDATE users SET subscription_status = 'expired', updated_at = ? WHERE id = ?")
          .bind(new Date().toISOString(), tutorUserId).run().catch(() => {});
      }
    }
  }

  if (db && (Number(user.tutor_fee_waived || 0) !== tutorFeeWaived || Number(user.active_paying_students_count || 0) !== activePayingCount)) {
    await db.prepare(
      'UPDATE users SET tutor_fee_waived = ?, active_paying_students_count = ? WHERE id = ?'
    ).bind(tutorFeeWaived, activePayingCount, tutorUserId).run().catch(() => {});
  }

  return {
    accessMode,
    readOnlyReason,
    activePayingStudentsCount: activePayingCount,
    waiverThreshold: cfg.tutorWaiverMinPayingStudents,
    studentsNeededForWaiver: Math.max(0, cfg.tutorWaiverMinPayingStudents - activePayingCount),
    tutorFeeWaived: Boolean(tutorFeeWaived),
    isLifetimeFreeTutor,
    qualifiesForWaiverAndShare,
    monthlyShareCents,
    totalShareEarnedCents,
    sharePerStudentCents: cfg.tutorSharePerStudentCents,
    tutorSubscriptionPriceCents: cfg.tutorSubscriptionPriceCents,
    tutorTrialDays: cfg.tutorTrialDays,
    trialDaysLeft,
    subscriptionStatus: subSt
  };
}

export async function accrueMonthlyTutorShareForInvoice(db, env = {}, { tutorUserId, studentId = '', stripeInvoiceId = '', periodMonth = '' }) {
  if (!db || !tutorUserId) return { accrued: false, reason: 'missing_args' };
  await ensureM142Schema(db);
  const summary = await reconcileTutorBillingState(db, env, tutorUserId);
  if (!summary.qualifiesForWaiverAndShare || summary.sharePerStudentCents <= 0) {
    return { accrued: false, reason: 'below_threshold', activePayingStudentsCount: summary.activePayingStudentsCount };
  }

  if (stripeInvoiceId) {
    const existing = await db.prepare(
      'SELECT id FROM tutor_earnings_ledger WHERE stripe_invoice_id = ?'
    ).bind(stripeInvoiceId).first().catch(() => null);
    if (existing) {
      return { accrued: false, reason: 'duplicate_invoice', ledgerId: existing.id };
    }
  }

  const nowIso = new Date().toISOString();
  const monthKey = periodMonth || nowIso.slice(0, 7);
  const id = 'earn_' + crypto.randomUUID().replace(/-/g, '').slice(0, 18);
  let transferId = '';
  let status = 'accrued';

  const tutorRow = await db.prepare('SELECT stripe_connect_account_id, stripe_connect_onboarded FROM users WHERE id = ?')
    .bind(tutorUserId).first().catch(() => null);
  if (tutorRow && tutorRow.stripe_connect_account_id && tutorRow.stripe_connect_onboarded && env && env.STRIPE_SECRET_KEY) {
    const tr = await stripeApiRequest(env, 'POST', '/v1/transfers', {
      amount: summary.sharePerStudentCents,
      currency: 'usd',
      destination: tutorRow.stripe_connect_account_id,
      description: `TutorPilot $1 monthly student share (${monthKey})`
    }).catch(() => ({ ok: false }));
    if (tr && tr.ok && tr.data && tr.data.id) {
      transferId = tr.data.id;
      status = 'transferred';
    }
  }

  await db.prepare(
    `INSERT INTO tutor_earnings_ledger
      (id, tutor_user_id, student_id, period_month, active_paying_students_snapshot, amount_cents, currency, status, stripe_invoice_id, stripe_transfer_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?)`
  ).bind(
    id,
    tutorUserId,
    studentId,
    monthKey,
    summary.activePayingStudentsCount,
    summary.sharePerStudentCents,
    status,
    stripeInvoiceId,
    transferId,
    nowIso
  ).run();

  return {
    accrued: true,
    ledgerId: id,
    amountCents: summary.sharePerStudentCents,
    status,
    transferId
  };
}
