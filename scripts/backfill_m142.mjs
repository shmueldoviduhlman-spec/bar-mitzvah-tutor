#!/usr/bin/env node
/**
 * TutorPilot M142 Idempotent D1 Backfill Script
 * Backfills student lesson_rate_cents / lesson_currency from profile_json.hourlyRate,
 * creates missing not_activated student_subscriptions rows, links parent emails into
 * student_guardians, and materializes historical status-marked or single-date schedule_json
 * sessions into calendar_sessions without losing any existing records.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parseRateStringToCents, normalizeSessionStatus, safeJsonParse } from '../functions/api/_lib/billing_config.js';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_DIR = path.resolve(__dirname, '..');
const WRANGLER_BIN = '/Users/dev/.npm/_npx/32026684e21afda6/node_modules/.bin/wrangler';
const D1_DB_NAME = 'tutorpilot_db';

function sqlEscape(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : '0';
  return `'${String(val).replace(/'/g, "''")}'`;
}

async function queryD1(sql, isRemote) {
  const args = ['d1', 'execute', D1_DB_NAME, isRemote ? '--remote' : '--local', '--json', '--command', sql];
  const { stdout } = await execFileAsync(WRANGLER_BIN, args, { cwd: WORKSPACE_DIR, maxBuffer: 20 * 1024 * 1024 });
  const parsed = JSON.parse(stdout);
  if (Array.isArray(parsed) && parsed[0] && Array.isArray(parsed[0].results)) {
    return parsed[0].results;
  }
  return [];
}

async function execD1File(statements, isRemote) {
  if (statements.length === 0) return;
  const tmpFile = path.join(os.tmpdir(), `tp_backfill_m142_${Date.now()}.sql`);
  fs.writeFileSync(tmpFile, statements.join('\n'), 'utf8');
  try {
    const args = ['d1', 'execute', D1_DB_NAME, isRemote ? '--remote' : '--local', '--file', tmpFile];
    await execFileAsync(WRANGLER_BIN, args, { cwd: WORKSPACE_DIR, maxBuffer: 20 * 1024 * 1024 });
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }
}

async function main() {
  const isRemote = process.argv.includes('--remote');
  console.log(`[M142 Backfill] Starting against ${isRemote ? 'REMOTE' : 'LOCAL'} D1 (${D1_DB_NAME})...`);

  const students = await queryD1('SELECT * FROM students', isRemote);
  console.log(`[M142 Backfill] Inspecting ${students.length} students...`);

  const statements = [];
  const nowIso = new Date().toISOString();
  let updatedRates = 0;
  let insertedSubs = 0;
  let insertedGuardians = 0;
  let insertedSessions = 0;

  for (const stu of students) {
    const profile = safeJsonParse(stu.profile_json, {});
    const schedule = safeJsonParse(stu.schedule_json, []);
    const { rateCents, currency } = parseRateStringToCents(profile.hourlyRate || '', stu.lesson_currency || 'USD');

    if (Number(stu.lesson_rate_cents || 0) === 0 && rateCents > 0) {
      statements.push(
        `UPDATE students SET lesson_rate_cents = ${rateCents}, lesson_currency = ${sqlEscape(currency)} WHERE id = ${sqlEscape(stu.id)};`
      );
      updatedRates++;
    }

    const portalSt = String(stu.portal_status || 'not_activated');
    statements.push(
      `INSERT OR IGNORE INTO student_subscriptions (student_id, school_id, tutor_user_id, payer_user_id, payer_role, status, price_cents, trial_days, trial_ends_at, current_period_end, stripe_customer_id, stripe_subscription_id, activated_at, canceled_at, created_at, updated_at) VALUES (${sqlEscape(stu.id)}, ${sqlEscape(stu.school_id)}, ${sqlEscape(stu.owner_user_id)}, '', ${sqlEscape(stu.learner_type === 'adult_student' ? 'adult_student' : 'parent')}, ${sqlEscape(portalSt === 'not_activated' ? 'not_activated' : portalSt)}, 500, 7, '', '', '', '', '', '', ${sqlEscape(stu.created_at || nowIso)}, ${sqlEscape(nowIso)});`
    );
    insertedSubs++;

    const parentEmail = String((profile.parentContact && profile.parentContact.email) || '').trim().toLowerCase();
    if (parentEmail && parentEmail.includes('@')) {
      const gId = 'grd_' + crypto.createHash('sha256').update(`${stu.id}:${parentEmail}`).digest('hex').slice(0, 16);
      statements.push(
        `INSERT OR IGNORE INTO student_guardians (id, school_id, student_id, guardian_user_id, guardian_email, guardian_name, guardian_phone, relationship, is_primary_payer, invite_token_hash, linked_at, created_at) VALUES (${sqlEscape(gId)}, ${sqlEscape(stu.school_id)}, ${sqlEscape(stu.id)}, '', ${sqlEscape(parentEmail)}, ${sqlEscape((profile.parentContact && profile.parentContact.name) || '')}, ${sqlEscape((profile.parentContact && profile.parentContact.phone) || '')}, 'parent', 1, '', '', ${sqlEscape(nowIso)});`
      );
      insertedGuardians++;
    }

    if (Array.isArray(schedule)) {
      for (const item of schedule) {
        if (!item || typeof item !== 'object') continue;
        const dateStr = String(item.dateStr || item.date || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
        // Backfill single-date sessions or explicitly status-marked recurring sessions cleanly
        const rawStatus = normalizeSessionStatus(item.status || 'scheduled');
        if (item.repeatWeekly && rawStatus === 'scheduled') continue;
        const csId = 'cs_bf_' + crypto.createHash('sha256').update(`${stu.id}:${item.id || ''}:${dateStr}`).digest('hex').slice(0, 16);
        const effRate = Number(stu.lesson_rate_cents || 0) || rateCents;
        const counts = rawStatus === 'completed' ? 1 : 0;
        const charge = rawStatus === 'completed' ? effRate : 0;
        statements.push(
          `INSERT OR IGNORE INTO calendar_sessions (id, school_id, tutor_user_id, student_id, series_schedule_id, course_id, lesson_id, session_date, start_time, duration_minutes, topic, status, counts_as_taught, charge_cents, charge_overridden, currency, recap_summary, homework_assigned, next_to_teach, tutor_private_note, cancel_reason, recap_source, completed_at, canceled_at, created_at, updated_at) VALUES (${sqlEscape(csId)}, ${sqlEscape(stu.school_id)}, ${sqlEscape(stu.owner_user_id)}, ${sqlEscape(stu.id)}, ${sqlEscape(item.repeatWeekly ? (item.id || '') : '')}, '', '', ${sqlEscape(dateStr)}, ${sqlEscape(item.time || item.timeSlot || '4:30 PM')}, 60, ${sqlEscape(item.topic || item.subject || '')}, ${sqlEscape(rawStatus)}, ${counts}, ${charge}, 0, ${sqlEscape(currency)}, '', '', '', '', '', 'backfill', ${sqlEscape(rawStatus === 'completed' ? (item.completedAt || nowIso) : '')}, ${sqlEscape(rawStatus === 'canceled' ? nowIso : '')}, ${sqlEscape(nowIso)}, ${sqlEscape(nowIso)});`
        );
        insertedSessions++;
      }
    }
  }

  await execD1File(statements, isRemote);
  console.log(`[M142 Backfill] Complete! ratesUpdated=${updatedRates}, subsEnsured=${insertedSubs}, guardiansEnsured=${insertedGuardians}, sessionsBackfilled=${insertedSessions}`);
}

main().catch(err => {
  console.error('[M142 Backfill] Failed:', err);
  process.exit(1);
});
