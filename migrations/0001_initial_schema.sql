-- TutorPilot Multi-Tenant Relational Schema (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT DEFAULT '',
  display_name_he TEXT DEFAULT '',
  organization TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'tutor' CHECK (role IN ('super_admin', 'admin', 'school_owner', 'tutor')),
  school_id TEXT NOT NULL,
  account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'suspended')),
  suspended_reason TEXT DEFAULT '',
  subscription_status TEXT NOT NULL DEFAULT 'trialing' CHECK (subscription_status IN ('trialing', 'active', 'lifetime', 'expired', 'canceled')),
  trial_days INTEGER NOT NULL DEFAULT 35,
  trial_ends_at TEXT DEFAULT '',
  stripe_customer_id TEXT DEFAULT '',
  stripe_subscription_id TEXT DEFAULT '',
  ai_enabled INTEGER NOT NULL DEFAULT 1,
  ai_tier_access TEXT NOT NULL DEFAULT 'standard' CHECK (ai_tier_access IN ('standard', 'pro')),
  ai_daily_limit INTEGER DEFAULT NULL,
  ai_pro_daily_limit INTEGER DEFAULT NULL,
  ai_allow_platform_fallback INTEGER NOT NULL DEFAULT 0,
  admin_notes TEXT DEFAULT '',
  last_active_at TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_school ON users(school_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_sub_status ON users(subscription_status);

CREATE TABLE IF NOT EXISTS user_api_keys (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'gemini',
  encrypted_key_b64 TEXT NOT NULL,
  iv_b64 TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  label TEXT DEFAULT '',
  assigned_by TEXT DEFAULT 'self',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_invites (
  email TEXT PRIMARY KEY,
  full_name TEXT DEFAULT '',
  organization TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'tutor' CHECK (role IN ('super_admin', 'admin', 'school_owner', 'tutor')),
  school_id TEXT DEFAULT '',
  subscription_status TEXT NOT NULL DEFAULT 'trialing' CHECK (subscription_status IN ('trialing', 'active', 'lifetime', 'expired', 'canceled')),
  trial_days INTEGER NOT NULL DEFAULT 35,
  ai_enabled INTEGER NOT NULL DEFAULT 1,
  ai_tier_access TEXT NOT NULL DEFAULT 'standard' CHECK (ai_tier_access IN ('standard', 'pro')),
  ai_daily_limit INTEGER DEFAULT NULL,
  ai_pro_daily_limit INTEGER DEFAULT NULL,
  ai_allow_platform_fallback INTEGER NOT NULL DEFAULT 0,
  preassigned_key_cipher TEXT DEFAULT '',
  preassigned_key_iv TEXT DEFAULT '',
  preassigned_key_hint TEXT DEFAULT '',
  admin_notes TEXT DEFAULT '',
  invited_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  join_code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS school_members (
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'teacher' CHECK (role IN ('owner', 'teacher')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (school_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_school_members_user ON school_members(user_id);

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  access_code TEXT NOT NULL,
  avatar_media_key TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  archived INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  parsha_or_date TEXT DEFAULT '',
  profile_json TEXT NOT NULL DEFAULT '{}',
  private_notes TEXT NOT NULL DEFAULT '',
  shared_notes_json TEXT NOT NULL DEFAULT '[]',
  skills_json TEXT NOT NULL DEFAULT '{}',
  schedule_json TEXT NOT NULL DEFAULT '[]',
  progress_json TEXT NOT NULL DEFAULT '{}',
  updated_by TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_students_school ON students(school_id);
CREATE INDEX IF NOT EXISTS idx_students_access_code ON students(access_code);
CREATE INDEX IF NOT EXISTS idx_students_name_lower ON students(lower(name));

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT DEFAULT '',
  deleted_at TEXT DEFAULT '',
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_courses_school ON courses(school_id);

CREATE TABLE IF NOT EXISTS curriculum_collections (
  school_id TEXT NOT NULL,
  collection_type TEXT NOT NULL CHECK (collection_type IN ('reading_materials', 'milestones', 'study_materials')),
  data_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (school_id, collection_type)
);

CREATE TABLE IF NOT EXISTS media_objects (
  key TEXT PRIMARY KEY,
  school_id TEXT NOT NULL,
  student_id TEXT DEFAULT '',
  uploaded_by TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL DEFAULT 0,
  original_name TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_media_school ON media_objects(school_id);
CREATE INDEX IF NOT EXISTS idx_media_student ON media_objects(student_id);

CREATE TABLE IF NOT EXISTS external_agent_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  school_id TEXT NOT NULL,
  label TEXT DEFAULT '',
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  revoked_at TEXT DEFAULT '',
  last_used_at TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ext_tokens_user ON external_agent_tokens(user_id);

CREATE TABLE IF NOT EXISTS ai_usage_daily (
  user_id TEXT NOT NULL,
  date_utc TEXT NOT NULL,
  standard_count INTEGER NOT NULL DEFAULT 0,
  pro_count INTEGER NOT NULL DEFAULT 0,
  used_custom_key_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, date_utc)
);

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_by TEXT DEFAULT 'system',
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO platform_settings (key, value_json, updated_by, updated_at) VALUES
  ('default_trial_days', '35', 'system', '2026-11-23T00:00:00.000Z'),
  ('global_ai_enabled', 'true', 'system', '2026-11-23T00:00:00.000Z'),
  ('default_ai_daily_limit', '25', 'system', '2026-11-23T00:00:00.000Z'),
  ('default_ai_pro_daily_limit', '3', 'system', '2026-11-23T00:00:00.000Z'),
  ('announcement_banner', '""', 'system', '2026-11-23T00:00:00.000Z');

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  target_user_id TEXT DEFAULT '',
  target_email TEXT DEFAULT '',
  action TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_logs(created_at DESC);
