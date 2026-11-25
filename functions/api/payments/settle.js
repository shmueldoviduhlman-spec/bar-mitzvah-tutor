import { handleOptions, jsonResponse } from '../_lib/cors.js';
import { requireTutorAuth, extractBearerToken, verifyClerkJwt, ensureD1User } from '../_lib/auth.js';
import { ensureM142Schema, formatMoneyCents } from '../_lib/billing_config.js';
import { sha256Hex } from '../_lib/crypto.js';
import { loadStudentBillingSnapshot } from '../_lib/ledger_ops.js';

const VALID_METHODS = new Set(['stripe_direct', 'zelle', 'venmo', 'cashapp', 'paypal', 'cash', 'bank_transfer', 'other']);

export async function onRequestOptions(context) {
  return handleOptions(context, 'POST, OPTIONS');
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env || !env.DB) {
    return jsonResponse({ error: 'Database binding missing' }, 500, request, env);
  }
  await ensureM142Schema(env.DB);

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, request, env);
  }

  const action = String((body && body.action) || 'record_direct_payment').trim();
  const nowIso = new Date().toISOString();

  // Step 1: Parent / Adult Student reports they sent off-platform P2P payment (authenticated OR via payToken)
  if (action === 'report_sent') {
    const payToken = String((body && body.payToken) || '').trim();
    const requestId = String((body && body.paymentRequestId) || '').trim();
    const methodRaw = String((body && body.method) || 'zelle').trim().toLowerCase();
    const method = VALID_METHODS.has(methodRaw) ? methodRaw : 'other';
    const note = String((body && body.note) || '').trim().slice(0, 300);

    let reqRow = null;
    let reporterRole = 'parent';

    if (payToken) {
      const hash = await sha256Hex(payToken);
      reqRow = await env.DB.prepare('SELECT * FROM payment_requests WHERE public_token_hash = ?').bind(hash).first();
    } else {
      const token = extractBearerToken(request);
      if (!token) return jsonResponse({ error: 'Authentication or payToken required' }, 401, request, env);
      const clerk = await verifyClerkJwt(token, env);
      if (!clerk) return jsonResponse({ error: 'Invalid session token' }, 401, request, env);
      const user = await ensureD1User(env.DB, clerk, env, 'auto');
      reporterRole = user.account_type === 'adult_student' ? 'adult_student' : 'parent';

      reqRow = await env.DB.prepare('SELECT * FROM payment_requests WHERE id = ?').bind(requestId).first();
      if (reqRow) {
        const stuRow = await env.DB.prepare('SELECT id, school_id, adult_user_id FROM students WHERE id = ?').bind(reqRow.student_id).first();
        const guardianRow = await env.DB.prepare(
          'SELECT id FROM student_guardians WHERE student_id = ? AND (guardian_user_id = ? OR lower(guardian_email) = lower(?))'
        ).bind(reqRow.student_id, user.id, user.email).first();
        const authorized = Boolean(
          guardianRow ||
          (stuRow && stuRow.adult_user_id === user.id) ||
          (stuRow && stuRow.school_id === user.school_id)
        );
        if (!authorized) return jsonResponse({ error: 'Forbidden' }, 403, request, env);
      }
    }

    if (!reqRow) {
      return jsonResponse({ error: 'Payment request not found' }, 404, request, env);
    }
    if (reqRow.status === 'paid') {
      return jsonResponse({ error: 'This payment request is already confirmed paid.' }, 400, request, env);
    }
    if (reqRow.status === 'canceled') {
      return jsonResponse({ error: 'This payment request was canceled by the tutor.' }, 400, request, env);
    }

    await env.DB.prepare(
      `UPDATE payment_requests
       SET status = 'pending_confirmation', reported_method = ?, reported_by_role = ?, reported_note = ?, reported_at = ?, updated_at = ?
       WHERE id = ?`
    ).bind(method, reporterRole, note, nowIso, nowIso, reqRow.id).run();

    const updated = await env.DB.prepare('SELECT * FROM payment_requests WHERE id = ?').bind(reqRow.id).first();
    return jsonResponse({
      ok: true,
      action: 'report_sent',
      paymentRequest: updated,
      message: `Reported ${formatMoneyCents(reqRow.amount_cents, reqRow.currency)} via ${method}. Awaiting tutor confirmation.`
    }, 200, request, env);
  }

  // All other settlement actions require Tutor authentication
  const auth = await requireTutorAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { user } = auth;

  // Step 2: Tutor confirms receipt of a reported payment -> finalizes 0%-cut ledger entry and zeroes balance
  if (action === 'confirm_received') {
    const requestId = String((body && body.paymentRequestId) || '').trim();
    const reqRow = await env.DB.prepare('SELECT * FROM payment_requests WHERE id = ? AND school_id = ?')
      .bind(requestId, user.school_id).first();
    if (!reqRow) return jsonResponse({ error: 'Payment request not found in workspace' }, 404, request, env);
    if (reqRow.status === 'paid') {
      const stu = await env.DB.prepare('SELECT * FROM students WHERE id = ?').bind(reqRow.student_id).first();
      const snap = await loadStudentBillingSnapshot(env.DB, stu);
      return jsonResponse({ ok: true, alreadyPaid: true, paymentRequest: reqRow, ledger: snap.ledger }, 200, request, env);
    }
    if (reqRow.status === 'canceled') {
      return jsonResponse({ error: 'Cannot confirm a canceled payment request.' }, 400, request, env);
    }

    const methodRaw = String((body && body.method) || reqRow.reported_method || 'other').trim().toLowerCase();
    const method = VALID_METHODS.has(methodRaw) ? methodRaw : 'other';
    const note = String((body && body.note) || reqRow.reported_note || `Confirmed via ${method}`).trim().slice(0, 300);
    const payId = 'payrec_' + crypto.randomUUID().replace(/-/g, '').slice(0, 18);

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE payment_requests
         SET status = 'paid', reported_method = ?, confirmed_by_user_id = ?, paid_at = ?, updated_at = ?
         WHERE id = ?`
      ).bind(method, user.id, nowIso, nowIso, reqRow.id),
      env.DB.prepare(
        `INSERT INTO lesson_payments (
          id, school_id, tutor_user_id, student_id, payment_request_id,
          amount_cents, lessons_settled, currency, method, platform_fee_cents,
          recorded_by_role, confirmed_by_tutor, reference_note, paid_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'tutor', 1, ?, ?, ?)`
      ).bind(
        payId,
        user.school_id,
        user.id,
        reqRow.student_id,
        reqRow.id,
        Math.round(Number(reqRow.amount_cents || 0)),
        Number(reqRow.lessons_count || 0),
        reqRow.currency || 'USD',
        method,
        note,
        nowIso,
        nowIso
      )
    ]);

    const stuRow = await env.DB.prepare('SELECT * FROM students WHERE id = ?').bind(reqRow.student_id).first();
    const updatedReq = await env.DB.prepare('SELECT * FROM payment_requests WHERE id = ?').bind(reqRow.id).first();
    const snap = await loadStudentBillingSnapshot(env.DB, stuRow);

    return jsonResponse({
      ok: true,
      action: 'confirm_received',
      paymentId: payId,
      paymentRequest: updatedReq,
      ledger: snap.ledger
    }, 200, request, env);
  }

  // Reopen if reported payment was not received
  if (action === 'reopen_request' || action === 'cancel_request') {
    const requestId = String((body && body.paymentRequestId) || '').trim();
    const reqRow = await env.DB.prepare('SELECT * FROM payment_requests WHERE id = ? AND school_id = ?')
      .bind(requestId, user.school_id).first();
    if (!reqRow) return jsonResponse({ error: 'Payment request not found' }, 404, request, env);
    if (reqRow.status === 'paid') return jsonResponse({ error: 'Already paid requests cannot be modified' }, 400, request, env);

    const nextStatus = action === 'cancel_request' ? 'canceled' : 'open';
    await env.DB.prepare(
      'UPDATE payment_requests SET status = ?, updated_at = ? WHERE id = ?'
    ).bind(nextStatus, nowIso, reqRow.id).run();
    const stuRow = await env.DB.prepare('SELECT * FROM students WHERE id = ?').bind(reqRow.student_id).first();
    const snap = await loadStudentBillingSnapshot(env.DB, stuRow);
    return jsonResponse({ ok: true, action, status: nextStatus, ledger: snap.ledger }, 200, request, env);
  }

  // Direct 1-step recording by Tutor (Cash, Zelle, Venmo, Bank without prior request, or direct settle)
  if (action === 'record_direct_payment') {
    const studentId = String((body && body.studentId) || '').trim();
    const stuRow = await env.DB.prepare('SELECT * FROM students WHERE id = ? AND school_id = ?')
      .bind(studentId, user.school_id).first();
    if (!stuRow) return jsonResponse({ error: 'Student not found in workspace' }, 404, request, env);

    const snapBefore = await loadStudentBillingSnapshot(env.DB, stuRow);
    const amountCents = body && body.amountCents !== undefined && body.amountCents !== null && body.amountCents !== ''
      ? Math.round(Number(body.amountCents))
      : snapBefore.ledger.balanceOwedCents;
    if (!amountCents || amountCents <= 0 || Number.isNaN(amountCents)) {
      return jsonResponse({ error: 'Positive payment amountCents is required' }, 400, request, env);
    }

    const methodRaw = String((body && body.method) || 'cash').trim().toLowerCase();
    const method = VALID_METHODS.has(methodRaw) ? methodRaw : 'other';
    const note = String((body && body.note) || `Direct 0%-fee payment (${method})`).trim().slice(0, 300);
    const reqId = String((body && body.paymentRequestId) || '').trim();
    const rate = snapBefore.ledger.effectiveRateCents;
    const lessonsSettled = rate > 0 ? Math.round((amountCents / rate) * 100) / 100 : 0;
    const payId = 'payrec_' + crypto.randomUUID().replace(/-/g, '').slice(0, 18);

    const stmts = [
      env.DB.prepare(
        `INSERT INTO lesson_payments (
          id, school_id, tutor_user_id, student_id, payment_request_id,
          amount_cents, lessons_settled, currency, method, platform_fee_cents,
          recorded_by_role, confirmed_by_tutor, reference_note, paid_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'tutor', 1, ?, ?, ?)`
      ).bind(
        payId,
        user.school_id,
        user.id,
        stuRow.id,
        reqId,
        amountCents,
        lessonsSettled,
        snapBefore.ledger.currency || 'USD',
        method,
        note,
        nowIso,
        nowIso
      )
    ];

    if (reqId) {
      stmts.push(
        env.DB.prepare(
          `UPDATE payment_requests
           SET status = 'paid', reported_method = ?, confirmed_by_user_id = ?, paid_at = ?, updated_at = ?
           WHERE id = ? AND school_id = ? AND status != 'paid'`
        ).bind(method, user.id, nowIso, nowIso, reqId, user.school_id)
      );
    } else if (amountCents >= snapBefore.ledger.balanceOwedCents) {
      // Auto-close matching open requests if full balance settled
      stmts.push(
        env.DB.prepare(
          `UPDATE payment_requests
           SET status = 'paid', reported_method = ?, confirmed_by_user_id = ?, paid_at = ?, updated_at = ?
           WHERE student_id = ? AND school_id = ? AND status IN ('open', 'pending_confirmation')`
        ).bind(method, user.id, nowIso, nowIso, stuRow.id, user.school_id)
      );
    }

    await env.DB.batch(stmts);
    const snapAfter = await loadStudentBillingSnapshot(env.DB, stuRow);
    return jsonResponse({
      ok: true,
      action: 'record_direct_payment',
      paymentId: payId,
      ledger: snapAfter.ledger
    }, 201, request, env);
  }

  return jsonResponse({ error: 'Unsupported payment settlement action' }, 400, request, env);
}
