/**
 * Centralized Billing Configuration, Cancellation/No-Show Fee Calculator,
 * Deterministic Student Balance Ledger, and Schema Safety Helpers
 */

export const SUPPORTED_CURRENCIES = {
  USD: { code: 'USD', symbol: '$', label: 'US Dollar ($)' },
  ILS: { code: 'ILS', symbol: '₪', label: 'Israeli Shekel (₪)' },
  GBP: { code: 'GBP', symbol: '£', label: 'British Pound (£)' },
  EUR: { code: 'EUR', symbol: '€', label: 'Euro (€)' },
  CAD: { code: 'CAD', symbol: 'CA$', label: 'Canadian Dollar (CA$)' }
};

export const VALID_SESSION_STATUSES = new Set([
  'scheduled',
  'completed',
  'canceled',
  'late_canceled',
  'no_show'
]);

const ensuredDbSet = new WeakSet();

export async function getPlatformSettings(db) {
  const defaults = {
    default_trial_days: 35,
    global_ai_enabled: true,
    default_ai_daily_limit: 25,
    default_ai_pro_daily_limit: 3,
    announcement_banner: '',
    parent_subscription_price_cents: 500,
    parent_trial_days: 7,
    tutor_subscription_price_cents: 1500,
    tutor_waiver_min_paying_students: 5,
    tutor_share_per_student_cents: 100,
    lesson_platform_fee_bps: 0
  };
  if (!db) return defaults;
  try {
    const rows = await db.prepare('SELECT key, value_json FROM platform_settings').all();
    const list = (rows && rows.results) || [];
    for (const row of list) {
      try {
        defaults[row.key] = JSON.parse(row.value_json);
      } catch (_) {}
    }
  } catch (_) {}
  return defaults;
}

export function safeJsonParse(raw, fallback) {
  if (!raw) return fallback;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

export function getBillingConfig(env = {}, platformSettings = {}) {
  const num = (envKey, settingKey, fallback) => {
    if (platformSettings && platformSettings[settingKey] !== undefined && platformSettings[settingKey] !== null && platformSettings[settingKey] !== '') {
      const n = Number(platformSettings[settingKey]);
      if (!Number.isNaN(n) && n >= 0) return Math.trunc(n);
    }
    if (env && env[envKey] !== undefined && env[envKey] !== null && env[envKey] !== '') {
      const n = Number(env[envKey]);
      if (!Number.isNaN(n) && n >= 0) return Math.trunc(n);
    }
    return fallback;
  };

  return {
    parentSubscriptionPriceCents: num('PARENT_SUBSCRIPTION_PRICE_CENTS', 'parent_subscription_price_cents', 500),
    parentTrialDays: Math.max(1, num('PARENT_TRIAL_DAYS', 'parent_trial_days', 7)),
    tutorSubscriptionPriceCents: num('TUTOR_SUBSCRIPTION_PRICE_CENTS', 'tutor_subscription_price_cents', 1500),
    tutorTrialDays: Math.max(1, num('TUTOR_TRIAL_DAYS', 'default_trial_days', 35)),
    tutorWaiverMinPayingStudents: Math.max(1, num('TUTOR_WAIVER_MIN_PAYING_STUDENTS', 'tutor_waiver_min_paying_students', 5)),
    tutorSharePerStudentCents: num('TUTOR_SHARE_PER_STUDENT_CENTS', 'tutor_share_per_student_cents', 100),
    lessonPlatformFeeBps: num('LESSON_PLATFORM_FEE_BPS', 'lesson_platform_fee_bps', 0)
  };
}

export function parseRateStringToCents(rawStr, fallbackCurrency = 'USD') {
  const s = String(rawStr || '').trim();
  if (!s) return { rateCents: 0, currency: fallbackCurrency || 'USD' };

  let currency = fallbackCurrency || 'USD';
  if (s.includes('₪') || /\bils\b/i.test(s) || /\bnis\b/i.test(s)) currency = 'ILS';
  else if (s.includes('£') || /\bgbp\b/i.test(s)) currency = 'GBP';
  else if (s.includes('€') || /\beur\b/i.test(s)) currency = 'EUR';
  else if (/\bcad\b/i.test(s) || s.toUpperCase().includes('CA$')) currency = 'CAD';
  else if (s.includes('$') || /\busd\b/i.test(s)) currency = 'USD';

  const m = s.match(/(\d+(?:,\d{3})*(?:\.\d{1,2})?)/);
  if (!m) return { rateCents: 0, currency };
  const cleaned = Number(m[1].replace(/,/g, ''));
  if (Number.isNaN(cleaned) || cleaned < 0) return { rateCents: 0, currency };
  return { rateCents: Math.round(cleaned * 100), currency };
}

export function formatMoneyCents(cents, currency = 'USD') {
  const sym = (SUPPORTED_CURRENCIES[currency] && SUPPORTED_CURRENCIES[currency].symbol) || '$';
  const val = (Number(cents || 0) / 100);
  const fixed = Math.abs(val % 1) < 0.001 ? String(Math.round(val)) : val.toFixed(2);
  return `${sym}${fixed}`;
}

export function normalizeRuleEntry(rawRule, defaultMode = 'free', defaultValue = 0) {
  const r = rawRule && typeof rawRule === 'object' ? rawRule : {};
  const mode = (r.mode === 'percent' || r.mode === 'flat' || r.mode === 'free') ? r.mode : defaultMode;
  let value = Number(r.value);
  if (Number.isNaN(value) || value < 0) value = defaultValue;
  if (mode === 'free') value = 0;
  if (mode === 'percent') value = Math.min(200, Math.round(value));
  if (mode === 'flat') value = Math.round(value);
  return { mode, value };
}

export function normalizeTutorBillingPolicy(rawPolicy) {
  const p = safeJsonParse(rawPolicy, {});
  const obj = (p && typeof p === 'object') ? p : {};
  const currency = SUPPORTED_CURRENCIES[String(obj.currency || 'USD').toUpperCase()] ? String(obj.currency || 'USD').toUpperCase() : 'USD';
  const defaultRateCents = Math.max(0, Math.round(Number(obj.defaultRateCents) || 0));
  const defaultDurationMins = Math.min(240, Math.max(15, Math.round(Number(obj.defaultDurationMins) || 60)));
  return {
    defaultRateCents,
    currency,
    defaultDurationMins,
    cancelRule: normalizeRuleEntry(obj.cancelRule, 'free', 0),
    lateCancelRule: normalizeRuleEntry(obj.lateCancelRule, 'free', 0),
    noShowRule: normalizeRuleEntry(obj.noShowRule, 'free', 0)
  };
}

export function normalizePayoutMethods(rawMethods) {
  const p = safeJsonParse(rawMethods, {});
  const obj = (p && typeof p === 'object') ? p : {};
  return {
    zelle: String(obj.zelle || '').trim().slice(0, 140),
    venmo: String(obj.venmo || '').trim().slice(0, 140),
    cashapp: String(obj.cashapp || '').trim().slice(0, 140),
    paypal: String(obj.paypal || '').trim().slice(0, 140),
    bankInstructions: String(obj.bankInstructions || '').trim().slice(0, 400),
    customPaymentUrl: String(obj.customPaymentUrl || '').trim().slice(0, 300)
  };
}

export function normalizeSessionStatus(rawStatus) {
  const s = String(rawStatus || 'scheduled').trim().toLowerCase().replace(/-/g, '_');
  if (s === 'cancelled' || s === 'cancel' || s === 'canceled') return 'canceled';
  if (s === 'late_cancelled' || s === 'late_cancel' || s === 'late_canceled') return 'late_canceled';
  if (s === 'no_show' || s === 'noshow' || s === 'missed') return 'no_show';
  if (s === 'completed' || s === 'done' || s === 'taught') return 'completed';
  return 'scheduled';
}

export function applyRuleToRate(rule, rateCents) {
  const base = Math.max(0, Math.round(Number(rateCents) || 0));
  if (!rule || rule.mode === 'free') return 0;
  if (rule.mode === 'percent') return Math.round((base * Math.max(0, Number(rule.value) || 0)) / 100);
  if (rule.mode === 'flat') return Math.max(0, Math.round(Number(rule.value) || 0));
  return 0;
}

export function computeSessionChargeCents({
  status,
  studentRateCents = 0,
  tutorPolicy = {},
  studentCustomPolicy = {},
  overrideChargeCents = null
}) {
  const normStatus = normalizeSessionStatus(status);
  const countsAsTaught = normStatus === 'completed' ? 1 : 0;

  if (overrideChargeCents !== undefined && overrideChargeCents !== null && overrideChargeCents !== '') {
    const num = Number(overrideChargeCents);
    if (!Number.isNaN(num) && num >= 0) {
      return {
        status: normStatus,
        countsAsTaught,
        chargeCents: Math.round(num),
        chargeOverridden: 1
      };
    }
  }

  const tp = normalizeTutorBillingPolicy(tutorPolicy);
  const scp = safeJsonParse(studentCustomPolicy, {});
  const effectiveRate = Math.max(0, Math.round(Number(studentRateCents) || tp.defaultRateCents || 0));

  if (normStatus === 'scheduled') {
    return { status: normStatus, countsAsTaught: 0, chargeCents: 0, chargeOverridden: 0 };
  }
  if (normStatus === 'completed') {
    return { status: normStatus, countsAsTaught: 1, chargeCents: effectiveRate, chargeOverridden: 0 };
  }

  const pickRule = (key) => {
    if (scp && scp[key] && typeof scp[key] === 'object' && scp[key].mode && scp[key].mode !== 'inherit') {
      return normalizeRuleEntry(scp[key], 'free', 0);
    }
    return normalizeRuleEntry(tp[key], 'free', 0);
  };

  let chargeCents = 0;
  if (normStatus === 'canceled') chargeCents = applyRuleToRate(pickRule('cancelRule'), effectiveRate);
  else if (normStatus === 'late_canceled') chargeCents = applyRuleToRate(pickRule('lateCancelRule'), effectiveRate);
  else if (normStatus === 'no_show') chargeCents = applyRuleToRate(pickRule('noShowRule'), effectiveRate);

  return { status: normStatus, countsAsTaught: 0, chargeCents, chargeOverridden: 0 };
}

export function computeStudentLedgerSummary({
  studentRow = {},
  sessions = [],
  payments = [],
  paymentRequests = [],
  tutorPolicy = {}
}) {
  const tp = normalizeTutorBillingPolicy(tutorPolicy);
  const profile = safeJsonParse(studentRow.profile_json, {});
  const parsedFromProfile = parseRateStringToCents(profile.hourlyRate || '', tp.currency);
  const effectiveRateCents = Number(studentRow.lesson_rate_cents || 0) || parsedFromProfile.rateCents || tp.defaultRateCents || 0;
  const currency = String(studentRow.lesson_currency || parsedFromProfile.currency || tp.currency || 'USD').toUpperCase();

  let completedSessionsCount = 0;
  let canceledSessionsCount = 0;
  let noShowSessionsCount = 0;
  let sessionChargesCents = 0;

  for (const s of (Array.isArray(sessions) ? sessions : [])) {
    if (!s) continue;
    const st = normalizeSessionStatus(s.status);
    if (st === 'completed') {
      completedSessionsCount += 1;
    } else if (st === 'canceled' || st === 'late_canceled') {
      canceledSessionsCount += 1;
    } else if (st === 'no_show') {
      noShowSessionsCount += 1;
    }
    if (st !== 'scheduled') {
      sessionChargesCents += Math.max(0, Math.round(Number(s.charge_cents || 0)));
    }
  }

  const openingTaught = Math.max(0, Math.round(Number(studentRow.opening_lessons_taught || 0)));
  const openingBalanceCents = Math.max(0, Math.round(Number(studentRow.opening_balance_cents || 0)));
  const lessonsTaught = openingTaught + completedSessionsCount;
  const totalChargesCents = openingBalanceCents + sessionChargesCents;

  let totalConfirmedPaidCents = 0;
  for (const p of (Array.isArray(payments) ? payments : [])) {
    if (p && p.confirmed_by_tutor !== 0) {
      totalConfirmedPaidCents += Math.max(0, Math.round(Number(p.amount_cents || 0)));
    }
  }

  const balanceOwedCents = Math.max(0, totalChargesCents - totalConfirmedPaidCents);
  const lessonsOwed = effectiveRateCents > 0
    ? Math.round((balanceOwedCents / effectiveRateCents) * 100) / 100
    : 0;

  const normalizedReqs = (Array.isArray(paymentRequests) ? paymentRequests : []).map(r => ({
    id: r.id,
    studentId: r.student_id,
    lessonsCount: Number(r.lessons_count || 0),
    amountCents: Math.round(Number(r.amount_cents || 0)),
    currency: r.currency || currency,
    description: r.description || '',
    lineItems: safeJsonParse(r.line_items_json, []),
    status: r.status || 'open',
    reportedMethod: r.reported_method || '',
    reportedNote: r.reported_note || '',
    reportedAt: r.reported_at || '',
    paidAt: r.paid_at || '',
    createdAt: r.created_at || ''
  }));

  const pendingConfirmationRequests = normalizedReqs.filter(r => r.status === 'pending_confirmation');
  const openRequests = normalizedReqs.filter(r => r.status === 'open');

  return {
    lessonsTaught,
    completedSessionsCount,
    canceledSessionsCount,
    noShowSessionsCount,
    effectiveRateCents,
    currency,
    totalChargesCents,
    totalConfirmedPaidCents,
    balanceOwedCents,
    lessonsOwed,
    openRequests,
    pendingConfirmationRequests,
    allRequests: normalizedReqs
  };
}

/**
 * Ensures M142 tables & columns exist idempotently even in ephemeral SQLite / mock DBs
 */
export async function ensureM142Schema(db) {
  if (!db || ensuredDbSet.has(db)) return;
  try {
    const ddlStatements = [
      `ALTER TABLE users ADD COLUMN account_type TEXT NOT NULL DEFAULT 'tutor'`,
      `ALTER TABLE users ADD COLUMN tutor_fee_waived INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN active_paying_students_count INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN stripe_connect_account_id TEXT DEFAULT ''`,
      `ALTER TABLE users ADD COLUMN stripe_connect_onboarded INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN billing_policy_json TEXT NOT NULL DEFAULT '{}'`,
      `ALTER TABLE users ADD COLUMN payout_methods_json TEXT NOT NULL DEFAULT '{}'`,
      `ALTER TABLE students ADD COLUMN learner_type TEXT NOT NULL DEFAULT 'child'`,
      `ALTER TABLE students ADD COLUMN portal_status TEXT NOT NULL DEFAULT 'not_activated'`,
      `ALTER TABLE students ADD COLUMN adult_user_id TEXT DEFAULT ''`,
      `ALTER TABLE students ADD COLUMN lesson_rate_cents INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE students ADD COLUMN lesson_currency TEXT NOT NULL DEFAULT 'USD'`,
      `ALTER TABLE students ADD COLUMN custom_billing_policy_json TEXT NOT NULL DEFAULT '{}'`,
      `ALTER TABLE students ADD COLUMN opening_lessons_taught INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE students ADD COLUMN opening_balance_cents INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE students ADD COLUMN activation_invite_token TEXT DEFAULT ''`
    ];
    for (const sql of ddlStatements) {
      try { await db.prepare(sql).run(); } catch (_) {}
    }

    const createTables = [
      `CREATE TABLE IF NOT EXISTS student_guardians (
        id TEXT PRIMARY KEY,
        school_id TEXT NOT NULL,
        student_id TEXT NOT NULL,
        guardian_user_id TEXT DEFAULT '',
        guardian_email TEXT NOT NULL,
        guardian_name TEXT DEFAULT '',
        guardian_phone TEXT DEFAULT '',
        relationship TEXT NOT NULL DEFAULT 'parent',
        is_primary_payer INTEGER NOT NULL DEFAULT 1,
        invite_token_hash TEXT DEFAULT '',
        linked_at TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE(student_id, guardian_email)
      )`,
      `CREATE TABLE IF NOT EXISTS calendar_sessions (
        id TEXT PRIMARY KEY,
        school_id TEXT NOT NULL,
        tutor_user_id TEXT NOT NULL,
        student_id TEXT NOT NULL,
        series_schedule_id TEXT DEFAULT '',
        course_id TEXT DEFAULT '',
        lesson_id TEXT DEFAULT '',
        session_date TEXT NOT NULL,
        start_time TEXT NOT NULL DEFAULT '4:30 PM',
        duration_minutes INTEGER NOT NULL DEFAULT 60,
        topic TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'scheduled',
        counts_as_taught INTEGER NOT NULL DEFAULT 0,
        charge_cents INTEGER NOT NULL DEFAULT 0,
        charge_overridden INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        recap_summary TEXT DEFAULT '',
        homework_assigned TEXT DEFAULT '',
        next_to_teach TEXT DEFAULT '',
        tutor_private_note TEXT DEFAULT '',
        cancel_reason TEXT DEFAULT '',
        recap_source TEXT DEFAULT '',
        completed_at TEXT DEFAULT '',
        canceled_at TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS payment_requests (
        id TEXT PRIMARY KEY,
        school_id TEXT NOT NULL,
        tutor_user_id TEXT NOT NULL,
        student_id TEXT NOT NULL,
        payer_user_id TEXT DEFAULT '',
        payer_email TEXT DEFAULT '',
        lessons_count REAL NOT NULL DEFAULT 0,
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        description TEXT DEFAULT '',
        line_items_json TEXT NOT NULL DEFAULT '[]',
        covered_session_ids_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'open',
        public_token_hash TEXT DEFAULT '',
        stripe_checkout_session_id TEXT DEFAULT '',
        stripe_payment_intent_id TEXT DEFAULT '',
        reported_method TEXT DEFAULT '',
        reported_by_role TEXT DEFAULT '',
        reported_note TEXT DEFAULT '',
        reported_at TEXT DEFAULT '',
        confirmed_by_user_id TEXT DEFAULT '',
        paid_at TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS lesson_payments (
        id TEXT PRIMARY KEY,
        school_id TEXT NOT NULL,
        tutor_user_id TEXT NOT NULL,
        student_id TEXT NOT NULL,
        payment_request_id TEXT DEFAULT '',
        amount_cents INTEGER NOT NULL,
        lessons_settled REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        method TEXT NOT NULL DEFAULT 'other',
        platform_fee_cents INTEGER NOT NULL DEFAULT 0,
        recorded_by_role TEXT NOT NULL DEFAULT 'tutor',
        confirmed_by_tutor INTEGER NOT NULL DEFAULT 1,
        reference_note TEXT DEFAULT '',
        paid_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS student_subscriptions (
        student_id TEXT PRIMARY KEY,
        school_id TEXT NOT NULL,
        tutor_user_id TEXT NOT NULL,
        payer_user_id TEXT DEFAULT '',
        payer_role TEXT NOT NULL DEFAULT 'parent',
        status TEXT NOT NULL DEFAULT 'not_activated',
        price_cents INTEGER NOT NULL DEFAULT 500,
        trial_days INTEGER NOT NULL DEFAULT 7,
        trial_ends_at TEXT DEFAULT '',
        current_period_end TEXT DEFAULT '',
        stripe_customer_id TEXT DEFAULT '',
        stripe_subscription_id TEXT DEFAULT '',
        activated_at TEXT DEFAULT '',
        canceled_at TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS tutor_earnings_ledger (
        id TEXT PRIMARY KEY,
        tutor_user_id TEXT NOT NULL,
        student_id TEXT DEFAULT '',
        period_month TEXT NOT NULL,
        active_paying_students_snapshot INTEGER NOT NULL DEFAULT 0,
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        status TEXT NOT NULL DEFAULT 'accrued',
        stripe_invoice_id TEXT DEFAULT '',
        stripe_transfer_id TEXT DEFAULT '',
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS billing_webhook_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        processed_at TEXT NOT NULL,
        summary_json TEXT NOT NULL DEFAULT '{}'
      )`
    ];
    for (const sql of createTables) {
      try { await db.prepare(sql).run(); } catch (_) {}
    }
    ensuredDbSet.add(db);
  } catch (_) {}
}
