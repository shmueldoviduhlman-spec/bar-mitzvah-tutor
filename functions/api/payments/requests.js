import { handleOptions, jsonResponse } from '../_lib/cors.js';
import { requireTutorAuth } from '../_lib/auth.js';
import { ensureM142Schema, normalizePayoutMethods, safeJsonParse, formatMoneyCents } from '../_lib/billing_config.js';
import { generateRandomCode, sha256Hex } from '../_lib/crypto.js';
import { loadStudentBillingSnapshot } from '../_lib/ledger_ops.js';

export async function onRequestOptions(context) {
  return handleOptions(context, 'GET, POST, OPTIONS');
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env || !env.DB) {
    return jsonResponse({ error: 'Database binding missing' }, 500, request, env);
  }
  await ensureM142Schema(env.DB);
  const u = new URL(request.url);
  const payToken = String(u.searchParams.get('payToken') || '').trim();

  if (payToken) {
    const tokenHash = await sha256Hex(payToken);
    const reqRow = await env.DB.prepare('SELECT * FROM payment_requests WHERE public_token_hash = ?')
      .bind(tokenHash).first();
    if (!reqRow) {
      return jsonResponse({ error: 'Payment request link is invalid or expired.' }, 404, request, env);
    }
    const [stuRow, tutorRow] = await Promise.all([
      env.DB.prepare('SELECT id, name, learner_type FROM students WHERE id = ?').bind(reqRow.student_id).first(),
      env.DB.prepare('SELECT id, full_name, organization, payout_methods_json, stripe_connect_account_id, stripe_connect_onboarded FROM users WHERE id = ?').bind(reqRow.tutor_user_id).first()
    ]);

    return jsonResponse({
      ok: true,
      paymentRequest: {
        id: reqRow.id,
        studentId: reqRow.student_id,
        studentName: (stuRow && stuRow.name) || 'Student',
        tutorName: (tutorRow && (tutorRow.organization || tutorRow.full_name)) || 'TutorPilot Studio',
        lessonsCount: Number(reqRow.lessons_count || 0),
        amountCents: Math.round(Number(reqRow.amount_cents || 0)),
        currency: reqRow.currency || 'USD',
        description: reqRow.description || '',
        lineItems: safeJsonParse(reqRow.line_items_json, []),
        status: reqRow.status,
        reportedMethod: reqRow.reported_method || '',
        reportedNote: reqRow.reported_note || '',
        reportedAt: reqRow.reported_at || '',
        paidAt: reqRow.paid_at || '',
        createdAt: reqRow.created_at || '',
        payoutMethods: normalizePayoutMethods(tutorRow && tutorRow.payout_methods_json),
        stripeCardAvailable: Boolean(tutorRow && tutorRow.stripe_connect_account_id && tutorRow.stripe_connect_onboarded && env.STRIPE_SECRET_KEY)
      }
    }, 200, request, env);
  }

  const auth = await requireTutorAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const studentId = String(u.searchParams.get('studentId') || '').trim();

  let rowsRes;
  if (auth.user.account_type === 'parent' || auth.user.account_type === 'adult_student') {
    rowsRes = await env.DB.prepare(
      `SELECT pr.* FROM payment_requests pr
       LEFT JOIN student_guardians sg ON sg.student_id = pr.student_id
       LEFT JOIN students s ON s.id = pr.student_id
       WHERE (sg.guardian_user_id = ? OR lower(sg.guardian_email) = lower(?) OR s.adult_user_id = ?)
       GROUP BY pr.id
       ORDER BY pr.created_at DESC LIMIT 100`
    ).bind(auth.user.id, auth.user.email, auth.user.id).all();
  } else if (studentId) {
    rowsRes = await env.DB.prepare(
      'SELECT * FROM payment_requests WHERE school_id = ? AND student_id = ? ORDER BY created_at DESC LIMIT 100'
    ).bind(auth.user.school_id, studentId).all();
  } else {
    rowsRes = await env.DB.prepare(
      'SELECT * FROM payment_requests WHERE school_id = ? ORDER BY created_at DESC LIMIT 100'
    ).bind(auth.user.school_id).all();
  }

  return jsonResponse({
    ok: true,
    paymentRequests: (rowsRes && rowsRes.results) || []
  }, 200, request, env);
}

export async function onRequestPost(context) {
  const auth = await requireTutorAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env } = context;
  await ensureM142Schema(env.DB);

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, request, env);
  }

  const studentId = String((body && body.studentId) || '').trim();
  if (!studentId) {
    return jsonResponse({ error: 'studentId is required' }, 400, request, env);
  }

  const stuRow = await env.DB.prepare('SELECT * FROM students WHERE id = ? AND school_id = ?')
    .bind(studentId, auth.user.school_id).first();
  if (!stuRow) {
    return jsonResponse({ error: 'Student not found in your workspace' }, 404, request, env);
  }

  const snapshot = await loadStudentBillingSnapshot(env.DB, stuRow);
  const requestedAmount = body && body.amountCents !== undefined && body.amountCents !== null && body.amountCents !== ''
    ? Math.round(Number(body.amountCents))
    : snapshot.ledger.balanceOwedCents;

  if (!requestedAmount || requestedAmount <= 0 || Number.isNaN(requestedAmount)) {
    return jsonResponse({
      error: 'No unpaid balance found to request. Mark completed lessons first or enter a custom amount.'
    }, 400, request, env);
  }

  const currency = String((body && body.currency) || snapshot.ledger.currency || 'USD').toUpperCase();
  const rateCents = snapshot.ledger.effectiveRateCents;
  const lessonsCount = body && body.lessonsCount !== undefined
    ? Number(body.lessonsCount)
    : (rateCents > 0 ? Math.round((requestedAmount / rateCents) * 100) / 100 : snapshot.ledger.lessonsOwed);

  const billableSessions = (snapshot.sessions || [])
    .filter(s => s && s.status !== 'scheduled' && Number(s.charge_cents || 0) > 0)
    .slice(0, 20)
    .map(s => ({
      id: s.id,
      date: s.session_date,
      time: s.start_time,
      status: s.status,
      topic: s.topic || '',
      chargeCents: Number(s.charge_cents || 0)
    }));

  const profile = safeJsonParse(stuRow.profile_json, {});
  const primaryGuardian = (snapshot.guardians && snapshot.guardians[0]) || null;
  const payerEmail = String((primaryGuardian && primaryGuardian.guardian_email) || (profile.parentContact && profile.parentContact.email) || '').trim().toLowerCase();
  const payerUserId = (primaryGuardian && primaryGuardian.guardian_user_id) || stuRow.adult_user_id || '';

  const rawPayToken = 'pay_' + generateRandomCode(24, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
  const tokenHash = await sha256Hex(rawPayToken);
  const reqId = 'preq_' + crypto.randomUUID().replace(/-/g, '').slice(0, 18);
  const nowIso = new Date().toISOString();
  const description = String((body && body.description) || `${stuRow.name} — Tutoring Balance (${formatMoneyCents(requestedAmount, currency)})`).trim();

  await env.DB.prepare(
    `INSERT INTO payment_requests (
      id, school_id, tutor_user_id, student_id, payer_user_id, payer_email,
      lessons_count, amount_cents, currency, description, line_items_json,
      covered_session_ids_json, status, public_token_hash,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`
  ).bind(
    reqId,
    auth.user.school_id,
    auth.user.id,
    stuRow.id,
    payerUserId,
    payerEmail,
    lessonsCount,
    requestedAmount,
    currency,
    description,
    JSON.stringify(billableSessions),
    JSON.stringify(billableSessions.map(x => x.id)),
    tokenHash,
    nowIso,
    nowIso
  ).run();

  const origin = String((env && env.APP_ORIGIN) || new URL(request.url).origin).replace(/\/+$/, '');
  const payUrl = `${origin}/?pay=${rawPayToken}`;
  const updatedSnapshot = await loadStudentBillingSnapshot(env.DB, stuRow);

  return jsonResponse({
    ok: true,
    paymentRequest: {
      id: reqId,
      studentId: stuRow.id,
      studentName: stuRow.name,
      lessonsCount,
      amountCents: requestedAmount,
      currency,
      description,
      lineItems: billableSessions,
      status: 'open',
      createdAt: nowIso
    },
    payToken: rawPayToken,
    payUrl,
    ledger: updatedSnapshot.ledger
  }, 201, request, env);
}
