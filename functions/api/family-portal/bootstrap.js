import { handleOptions, jsonResponse } from '../_lib/cors.js';
import { requireTutorAuth } from '../_lib/auth.js';
import { ensureM142Schema, getBillingConfig, getPlatformSettings, normalizePayoutMethods, safeJsonParse } from '../_lib/billing_config.js';
import { evaluateStudentPortalAccess } from '../_lib/reconcile_billing.js';
import { loadStudentBillingSnapshot } from '../_lib/ledger_ops.js';

export async function onRequestOptions(context) {
  return handleOptions(context, 'GET, OPTIONS');
}

export async function onRequestGet(context) {
  const auth = await requireTutorAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env } = context;
  const { user } = auth;
  await ensureM142Schema(env.DB);

  const settings = await getPlatformSettings(env.DB);
  const cfg = getBillingConfig(env, settings);

  // Resolve all non-archived students overseen as a Parent or Adult Self-Payer
  const linkedRes = await env.DB.prepare(
    `SELECT DISTINCT s.*
     FROM students s
     LEFT JOIN student_guardians sg ON sg.student_id = s.id
     WHERE s.archived = 0
       AND (
         s.adult_user_id = ?
         OR sg.guardian_user_id = ?
         OR (lower(sg.guardian_email) = lower(?) AND sg.guardian_email != '')
       )
     ORDER BY s.name ASC`
  ).bind(user.id, user.id, user.email || '').all();

  const linkedRows = (linkedRes && linkedRes.results) || [];
  const linkedStudents = [];

  for (const stu of linkedRows) {
    const snap = await loadStudentBillingSnapshot(env.DB, stu);
    const tutorRow = await env.DB.prepare(
      'SELECT id, full_name, organization, payout_methods_json, stripe_connect_account_id, stripe_connect_onboarded FROM users WHERE id = ?'
    ).bind(stu.owner_user_id).first().catch(() => null);

    const portalAccess = evaluateStudentPortalAccess(snap.subscription, stu);
    const skills = safeJsonParse(stu.skills_json, {});
    const sharedNotes = safeJsonParse(stu.shared_notes_json, []);
    const schedule = safeJsonParse(stu.schedule_json, []);
    const mediaKey = String(stu.avatar_media_key || '');
    const avatarUrl = mediaKey
      ? (mediaKey.startsWith('/') || mediaKey.startsWith('http') || mediaKey.startsWith('data:')
          ? mediaKey
          : `/api/media/${encodeURIComponent(mediaKey)}`)
      : '';

    const sanitizedSessions = (snap.sessions || []).slice(0, 30).map(cs => ({
      id: cs.id,
      sessionDate: cs.session_date,
      startTime: cs.start_time,
      topic: cs.topic || '',
      status: cs.status,
      countsAsTaught: !!cs.counts_as_taught,
      chargeCents: Number(cs.charge_cents || 0),
      currency: cs.currency || snap.ledger.currency,
      recapSummary: cs.recap_summary || '',
      homeworkAssigned: cs.homework_assigned || '',
      nextToTeach: cs.next_to_teach || '',
      cancelReason: cs.cancel_reason || ''
    }));

    linkedStudents.push({
      id: stu.id,
      name: stu.name,
      subject: safeJsonParse(stu.profile_json, {}).subject || stu.parsha_or_date || '',
      avatar: avatarUrl,
      learnerType: stu.learner_type || 'child',
      studentAccessCode: stu.access_code || '',
      tutorName: (tutorRow && (tutorRow.organization || tutorRow.full_name)) || 'TutorPilot Studio',
      portalAccess,
      skills,
      sharedNotes: Array.isArray(sharedNotes) ? sharedNotes : [],
      schedule: Array.isArray(schedule) ? schedule : [],
      sessions: sanitizedSessions,
      ledger: snap.ledger,
      payments: (snap.payments || []).slice(0, 20),
      payoutMethods: normalizePayoutMethods(tutorRow && tutorRow.payout_methods_json),
      stripeCardAvailable: Boolean(tutorRow && tutorRow.stripe_connect_account_id && tutorRow.stripe_connect_onboarded && env.STRIPE_SECRET_KEY)
    });
  }

  return jsonResponse({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      accountType: user.account_type || 'parent'
    },
    billingConfig: cfg,
    linkedStudents
  }, 200, request, env);
}
