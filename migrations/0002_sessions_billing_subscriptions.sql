-- TutorPilot M142 Migration: Calendar Sessions, End-of-Session Recaps,
-- Configurable Tutor Billing Policies, Two-Step Payment Requests, 0%-Cut Ledger,
-- Parent/Adult Portal Subscriptions ($5/mo after 7d) & Tutor $1 Share / Waiver
-- Strictly additive: preserves all existing users, schools, students, courses, and media.

ALTER TABLE users ADD COLUMN account_type TEXT NOT NULL DEFAULT 'tutor';
ALTER TABLE users ADD COLUMN tutor_fee_waived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN active_paying_students_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN stripe_connect_account_id TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN stripe_connect_onboarded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN billing_policy_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN payout_methods_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE students ADD COLUMN learner_type TEXT NOT NULL DEFAULT 'child';
ALTER TABLE students ADD COLUMN portal_status TEXT NOT NULL DEFAULT 'not_activated';
ALTER TABLE students ADD COLUMN adult_user_id TEXT DEFAULT '';
ALTER TABLE students ADD COLUMN lesson_rate_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE students ADD COLUMN lesson_currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE students ADD COLUMN custom_billing_policy_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE students ADD COLUMN opening_lessons_taught INTEGER NOT NULL DEFAULT 0;
ALTER TABLE students ADD COLUMN opening_balance_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE students ADD COLUMN activation_invite_token TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS student_guardians (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
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
);

CREATE INDEX IF NOT EXISTS idx_guardians_user ON student_guardians(guardian_user_id);
CREATE INDEX IF NOT EXISTS idx_guardians_email ON student_guardians(lower(guardian_email));
CREATE INDEX IF NOT EXISTS idx_guardians_student ON student_guardians(student_id);

CREATE TABLE IF NOT EXISTS calendar_sessions (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL,
  tutor_user_id TEXT NOT NULL,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  series_schedule_id TEXT DEFAULT '',
  course_id TEXT DEFAULT '',
  lesson_id TEXT DEFAULT '',
  session_date TEXT NOT NULL,
  start_time TEXT NOT NULL DEFAULT '4:30 PM',
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  topic TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'canceled', 'late_canceled', 'no_show')),
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
);

CREATE INDEX IF NOT EXISTS idx_sessions_school_date ON calendar_sessions(school_id, session_date);
CREATE INDEX IF NOT EXISTS idx_sessions_student_date ON calendar_sessions(student_id, session_date);
CREATE INDEX IF NOT EXISTS idx_sessions_tutor_status ON calendar_sessions(tutor_user_id, status);

CREATE TABLE IF NOT EXISTS payment_requests (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL,
  tutor_user_id TEXT NOT NULL,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  payer_user_id TEXT DEFAULT '',
  payer_email TEXT DEFAULT '',
  lessons_count REAL NOT NULL DEFAULT 0,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  description TEXT DEFAULT '',
  line_items_json TEXT NOT NULL DEFAULT '[]',
  covered_session_ids_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'pending_confirmation', 'paid', 'canceled')),
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
);

CREATE INDEX IF NOT EXISTS idx_payreq_student ON payment_requests(student_id, status);
CREATE INDEX IF NOT EXISTS idx_payreq_tutor ON payment_requests(tutor_user_id, status);
CREATE INDEX IF NOT EXISTS idx_payreq_token ON payment_requests(public_token_hash);

CREATE TABLE IF NOT EXISTS lesson_payments (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL,
  tutor_user_id TEXT NOT NULL,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
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
);

CREATE INDEX IF NOT EXISTS idx_lesson_payments_student ON lesson_payments(student_id);
CREATE INDEX IF NOT EXISTS idx_lesson_payments_tutor ON lesson_payments(tutor_user_id);

CREATE TABLE IF NOT EXISTS student_subscriptions (
  student_id TEXT PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  school_id TEXT NOT NULL,
  tutor_user_id TEXT NOT NULL,
  payer_user_id TEXT DEFAULT '',
  payer_role TEXT NOT NULL DEFAULT 'parent',
  status TEXT NOT NULL DEFAULT 'not_activated'
    CHECK (status IN ('not_activated', 'trialing', 'active', 'past_due', 'canceled', 'expired', 'comped')),
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
);

CREATE INDEX IF NOT EXISTS idx_stu_sub_tutor_status ON student_subscriptions(tutor_user_id, status);
CREATE INDEX IF NOT EXISTS idx_stu_sub_payer ON student_subscriptions(payer_user_id);

CREATE TABLE IF NOT EXISTS tutor_earnings_ledger (
  id TEXT PRIMARY KEY,
  tutor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id TEXT DEFAULT '',
  period_month TEXT NOT NULL,
  active_paying_students_snapshot INTEGER NOT NULL DEFAULT 0,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'accrued'
    CHECK (status IN ('accrued', 'transferred', 'paid_manual', 'reversed')),
  stripe_invoice_id TEXT DEFAULT '',
  stripe_transfer_id TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tutor_earnings_user ON tutor_earnings_ledger(tutor_user_id, period_month);

CREATE TABLE IF NOT EXISTS billing_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  summary_json TEXT NOT NULL DEFAULT '{}'
);

INSERT OR IGNORE INTO platform_settings (key, value_json, updated_by, updated_at) VALUES
  ('parent_subscription_price_cents', '500', 'system', '2026-11-24T00:00:00.000Z'),
  ('parent_trial_days', '7', 'system', '2026-11-24T00:00:00.000Z'),
  ('tutor_subscription_price_cents', '1500', 'system', '2026-11-24T00:00:00.000Z'),
  ('tutor_waiver_min_paying_students', '5', 'system', '2026-11-24T00:00:00.000Z'),
  ('tutor_share_per_student_cents', '100', 'system', '2026-11-24T00:00:00.000Z'),
  ('lesson_platform_fee_bps', '0', 'system', '2026-11-24T00:00:00.000Z');
