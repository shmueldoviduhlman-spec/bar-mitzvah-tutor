import { handleOptions, jsonResponse } from '../_lib/cors.js';
import { requireTutorAuth } from '../_lib/auth.js';
import { ensureM142Schema, getBillingConfig, getPlatformSettings, safeJsonParse } from '../_lib/billing_config.js';
import { generateRandomCode, sha256Hex } from '../_lib/crypto.js';
import { evaluateStudentPortalAccess, reconcileTutorBillingState, syncStudentPortalAccessFlag } from '../_lib/reconcile_billing.js';

export async function onRequestOptions(context) {
  return handleOptions(context, 'POST, OPTIONS');
}

export async function onRequestPost(context) {
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

  const action = String((body && body.action) || '').trim();
  const settings = await getPlatformSettings(env.DB);
  const cfg = getBillingConfig(env, settings);
  const nowIso = new Date().toISOString();

  // Tutor creates an activation invite link for a Parent (child student) or Adult Student
  if (action === 'create_invite') {
    const studentId = String((body && body.studentId) || '').trim();
    const stuRow = await env.DB.prepare('SELECT * FROM students WHERE id = ? AND school_id = ?')
      .bind(studentId, user.school_id).first();
    if (!stuRow) return jsonResponse({ error: 'Student not found in your workspace' }, 404, request, env);

    const learnerType = (body.learnerType === 'adult_student' || stuRow.learner_type === 'adult_student') ? 'adult_student' : 'child';
    const profile = safeJsonParse(stuRow.profile_json, {});
    const contactEmail = String(
      body.email ||
      (learnerType === 'adult_student' ? (profile.studentContact && profile.studentContact.email) : (profile.parentContact && profile.parentContact.email)) ||
      ''
    ).trim().toLowerCase();
    const contactName = String(
      body.name ||
      (learnerType === 'adult_student' ? stuRow.name : (profile.parentContact && profile.parentContact.name)) ||
      ''
    ).trim();
    const contactPhone = String(
      body.phone ||
      (learnerType === 'adult_student' ? (profile.studentContact && profile.studentContact.phone) : (profile.parentContact && profile.parentContact.phone)) ||
      ''
    ).trim();

    let rawToken = String(stuRow.activation_invite_token || '').trim();
    if (!rawToken || body.regenerate === true) {
      rawToken = 'act_' + generateRandomCode(22, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
    }

    const curSub = await env.DB.prepare('SELECT * FROM student_subscriptions WHERE student_id = ?').bind(stuRow.id).first();
    const nextPortalStatus = (!stuRow.portal_status || stuRow.portal_status === 'not_activated') ? 'invited' : stuRow.portal_status;

    await env.DB.prepare(
      'UPDATE students SET learner_type = ?, portal_status = ?, activation_invite_token = ?, updated_at = ? WHERE id = ?'
    ).bind(learnerType, nextPortalStatus, rawToken, nowIso, stuRow.id).run();

    if (!curSub) {
      await env.DB.prepare(
        `INSERT INTO student_subscriptions (
          student_id, school_id, tutor_user_id, payer_user_id, payer_role, status,
          price_cents, trial_days, trial_ends_at, current_period_end,
          stripe_customer_id, stripe_subscription_id, activated_at, canceled_at, created_at, updated_at
        ) VALUES (?, ?, ?, '', ?, 'not_activated', ?, ?, '', '', '', '', '', '', ?, ?)`
      ).bind(
        stuRow.id,
        stuRow.school_id,
        stuRow.owner_user_id || user.id,
        learnerType === 'adult_student' ? 'adult_student' : 'parent',
        cfg.parentSubscriptionPriceCents,
        cfg.parentTrialDays,
        nowIso,
        nowIso
      ).run();
    }

    if (contactEmail && contactEmail.includes('@')) {
      const gId = 'grd_' + (await sha256Hex(`${stuRow.id}:${contactEmail}`)).slice(0, 16);
      const tokenHash = await sha256Hex(rawToken);
      await env.DB.prepare(
        `INSERT INTO student_guardians (
          id, school_id, student_id, guardian_user_id, guardian_email, guardian_name,
          guardian_phone, relationship, is_primary_payer, invite_token_hash, linked_at, created_at
        ) VALUES (?, ?, ?, '', ?, ?, ?, ?, 1, ?, '', ?)
        ON CONFLICT(student_id, guardian_email) DO UPDATE SET
          guardian_name = CASE WHEN excluded.guardian_name != '' THEN excluded.guardian_name ELSE student_guardians.guardian_name END,
          guardian_phone = CASE WHEN excluded.guardian_phone != '' THEN excluded.guardian_phone ELSE student_guardians.guardian_phone END,
          relationship = excluded.relationship,
          invite_token_hash = excluded.invite_token_hash`
      ).bind(
        gId,
        stuRow.school_id,
        stuRow.id,
        contactEmail,
        contactName,
        contactPhone,
        learnerType === 'adult_student' ? 'self_adult' : 'parent',
        tokenHash,
        nowIso
      ).run();
    }

    const origin = String((env && env.APP_ORIGIN) || new URL(request.url).origin).replace(/\/+$/, '');
    const roleParam = learnerType === 'adult_student' ? 'adult_student' : 'parent';
    const activateUrl = `${origin}/?activate=${encodeURIComponent(rawToken)}&role=${roleParam}`;

    return jsonResponse({
      ok: true,
      studentId: stuRow.id,
      learnerType,
      portalStatus: nextPortalStatus,
      inviteToken: rawToken,
      activateUrl,
      trialDays: cfg.parentTrialDays,
      monthlyPriceCents: cfg.parentSubscriptionPriceCents
    }, 200, request, env);
  }

  // Parent or Adult Student redeems activation invite -> starts 7-day free trial (once only!) & links account
  if (action === 'redeem_invite') {
    const inviteToken = String((body && body.inviteToken) || '').trim();
    if (!inviteToken) {
      return jsonResponse({ error: 'Activation invite token is required' }, 400, request, env);
    }

    const stuRow = await env.DB.prepare('SELECT * FROM students WHERE activation_invite_token = ? AND archived = 0')
      .bind(inviteToken).first();
    if (!stuRow) {
      return jsonResponse({ error: 'Invalid or expired activation invite link.' }, 404, request, env);
    }

    const isAdult = stuRow.learner_type === 'adult_student';
    const relationship = isAdult ? 'self_adult' : 'parent';
    const nextAccountType = isAdult ? 'adult_student' : 'parent';

    // Preserve tutor role if user already owns tutor students; otherwise set Parent / Adult Student role
    const ownedTutorStudents = await env.DB.prepare('SELECT COUNT(*) AS cnt FROM students WHERE owner_user_id = ?')
      .bind(user.id).first();
    if (user.role !== 'super_admin' && Number((ownedTutorStudents && ownedTutorStudents.cnt) || 0) === 0) {
      await env.DB.prepare('UPDATE users SET account_type = ?, updated_at = ? WHERE id = ?')
        .bind(nextAccountType, nowIso, user.id).run();
    }

    if (isAdult) {
      await env.DB.prepare('UPDATE students SET adult_user_id = ?, updated_at = ? WHERE id = ?')
        .bind(user.id, nowIso, stuRow.id).run();
    }

    const gId = 'grd_' + (await sha256Hex(`${stuRow.id}:${user.email || user.id}`)).slice(0, 16);
    await env.DB.prepare(
      `INSERT INTO student_guardians (
        id, school_id, student_id, guardian_user_id, guardian_email, guardian_name,
        guardian_phone, relationship, is_primary_payer, invite_token_hash, linked_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, '', ?, 1, '', ?, ?)
      ON CONFLICT(student_id, guardian_email) DO UPDATE SET
        guardian_user_id = excluded.guardian_user_id,
        relationship = excluded.relationship,
        linked_at = excluded.linked_at`
    ).bind(
      gId,
      stuRow.school_id,
      stuRow.id,
      user.id,
      String(user.email || `${user.id}@clerk.local`).toLowerCase(),
      user.full_name || '',
      relationship,
      nowIso,
      nowIso
    ).run();

    let subRow = await env.DB.prepare('SELECT * FROM student_subscriptions WHERE student_id = ?').bind(stuRow.id).first();
    const curStatus = String((subRow && subRow.status) || 'not_activated');

    // Only start fresh 7-day free trial if never activated yet (prevents resetting an expired trial!)
    if (!subRow || curStatus === 'not_activated') {
      const trialEndsAt = new Date(Date.now() + cfg.parentTrialDays * 86400 * 1000).toISOString();
      await env.DB.prepare(
        `INSERT INTO student_subscriptions (
          student_id, school_id, tutor_user_id, payer_user_id, payer_role, status,
          price_cents, trial_days, trial_ends_at, current_period_end,
          stripe_customer_id, stripe_subscription_id, activated_at, canceled_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'trialing', ?, ?, ?, '', '', '', ?, '', ?, ?)
        ON CONFLICT(student_id) DO UPDATE SET
          payer_user_id = excluded.payer_user_id,
          payer_role = excluded.payer_role,
          status = 'trialing',
          price_cents = excluded.price_cents,
          trial_days = excluded.trial_days,
          trial_ends_at = excluded.trial_ends_at,
          activated_at = excluded.activated_at,
          updated_at = excluded.updated_at`
      ).bind(
        stuRow.id,
        stuRow.school_id,
        stuRow.owner_user_id,
        user.id,
        nextAccountType,
        cfg.parentSubscriptionPriceCents,
        cfg.parentTrialDays,
        trialEndsAt,
        nowIso,
        nowIso,
        nowIso
      ).run();
      subRow = await env.DB.prepare('SELECT * FROM student_subscriptions WHERE student_id = ?').bind(stuRow.id).first();
    } else if (!subRow.payer_user_id) {
      await env.DB.prepare('UPDATE student_subscriptions SET payer_user_id = ?, updated_at = ? WHERE student_id = ?')
        .bind(user.id, nowIso, stuRow.id).run();
      subRow.payer_user_id = user.id;
    }

    await syncStudentPortalAccessFlag(env.DB, stuRow.id, subRow);
    await reconcileTutorBillingState(env.DB, env, stuRow.owner_user_id);

    const access = evaluateStudentPortalAccess(subRow, stuRow);
    return jsonResponse({
      ok: true,
      studentId: stuRow.id,
      studentName: stuRow.name,
      studentAccessCode: stuRow.access_code,
      learnerType: stuRow.learner_type,
      accountType: nextAccountType,
      portalAccess: access
    }, 200, request, env);
  }

  return jsonResponse({ error: 'Unsupported family portal activation action' }, 400, request, env);
}
