#!/usr/bin/env node
/**
 * TutorPilot Supabase CSV -> Cloudflare D1 & R2 Migration Script
 *
 * Parses the UTF-8 Supabase export CSV (RFC-4180), skips __portal_settings__,
 * normalizes users (with `pending_` IDs for Clerk auto-relinking), schools
 * (with fresh random 8-char join codes), school_members, students (including
 * orphan assignment and `_meta.lessons` preservation), courses (with UTF-8-safe
 * SQL chunking under D1's 100 KB statement limit), and extracts all Base64
 * avatars & audio recordings into R2 `tutorpilot-media` + D1 `media_objects`.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_DIR = path.resolve(__dirname, '..');

const DEFAULT_CSV_PATH = path.join(WORKSPACE_DIR, 'Supabase Snippet Untitled query.csv');
const D1_DB_NAME = 'tutorpilot_db';
const R2_BUCKET_NAME = 'tutorpilot-media';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ALLOWED_ROLES = new Set(['super_admin', 'admin', 'school_owner', 'tutor']);
const ALLOWED_SUB_STATUSES = new Set(['trialing', 'active', 'lifetime', 'expired', 'canceled']);
const BANNED_LEGACY_JOIN_CODES = new Set(['770770', '687938']);

const EXT_FROM_MIME = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'application/pdf': 'pdf'
};

function parseCliArgs(argv) {
  const opts = {
    csvPath: DEFAULT_CSV_PATH,
    dryRun: false,
    skipR2: false,
    localOnly: false,
    remoteOnly: false
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--csv' && argv[i + 1]) {
      opts.csvPath = path.resolve(argv[++i]);
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--skip-r2') {
      opts.skipR2 = true;
    } else if (arg === '--local-only') {
      opts.localOnly = true;
    } else if (arg === '--remote-only') {
      opts.remoteOnly = true;
    } else {
      throw new Error(`Unknown CLI argument: ${arg}`);
    }
  }
  if (opts.localOnly && opts.remoteOnly) {
    throw new Error('Cannot specify both --local-only and --remote-only');
  }
  return opts;
}

/**
 * Full RFC-4180 UTF-8 CSV parser handling quoted fields, escaped quotes (""),
 * embedded commas, and embedded CR/LF newlines inside quotes.
 */
function parseCsvRfc4180(rawText) {
  let text = rawText;
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\r') {
        if (text[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (ch === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
  }
  if (inQuotes) {
    throw new Error('Malformed CSV: unclosed quoted field at EOF');
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length > 1) {
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === '') {
      rows.pop();
    }
  }
  if (rows.length < 2) {
    throw new Error('CSV contains no data rows');
  }

  const headers = rows[0].map((h) => String(h || '').trim());
  const records = [];
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    if (cols.length !== headers.length) {
      throw new Error(`CSV row ${r} has ${cols.length} columns; expected ${headers.length}`);
    }
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = cols[c];
    }
    records.push(obj);
  }
  return { headers, records };
}

function normalizeSchoolId(rawSchoolId) {
  const s = String(rawSchoolId || '').trim();
  if (!s) return '';
  if (s === 'school_main_770') return 'school_main_academy';
  return s;
}

function normalizePendingUserId(rawId) {
  const s = String(rawId || '').trim();
  if (!s) return '';
  return s.startsWith('pending_') ? s : `pending_${s}`;
}

function normalizeUserRole(rawRole) {
  const r = String(rawRole || '').trim().toLowerCase();
  if (r === 'classroom_owner') return 'school_owner';
  return ALLOWED_ROLES.has(r) ? r : 'tutor';
}

function normalizeIsoTimestamp(rawTs, fallbackIso = '2026-11-23T00:00:00.000Z') {
  const raw = String(rawTs || '').trim();
  if (!raw) return fallbackIso;
  // Normalize Postgres format e.g. "2026-11-22 19:08:06.237573+00" -> "2026-11-22T19:08:06.237Z"
  let normalized = raw.replace(' ', 'T');
  normalized = normalized.replace(/(\.\d{3})\d+/, '$1');
  normalized = normalized.replace(/\+00(?::00)?$/, 'Z');
  const ms = Date.parse(normalized);
  if (Number.isNaN(ms)) {
    throw new Error(`Unparseable timestamp: ${raw}`);
  }
  return new Date(ms).toISOString();
}

function generateRandomCode(len, usedSet, bannedSet = new Set()) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const bytes = crypto.randomBytes(len);
    let code = '';
    for (let i = 0; i < len; i++) {
      code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    }
    if (!usedSet.has(code) && !bannedSet.has(code)) {
      usedSet.add(code);
      return code;
    }
  }
  throw new Error('Unable to generate unique random code');
}

function safeJsonParse(raw, label) {
  const txt = String(raw ?? '').trim();
  if (!txt) return {};
  try {
    return JSON.parse(txt);
  } catch (err) {
    throw new Error(`Invalid JSON in ${label}: ${err.message}`);
  }
}

function verifyMediaMagicBytes(mime, buf) {
  if (!buf || buf.byteLength === 0) return false;
  const h = buf.subarray(0, 12);
  if (mime === 'image/jpeg' || mime === 'image/jpg') {
    return h.length >= 3 && h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff;
  }
  if (mime === 'image/png') {
    return h.length >= 4 && h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47;
  }
  if (mime === 'image/gif') {
    return h.subarray(0, 4).toString('ascii') === 'GIF8';
  }
  if (mime === 'image/webp') {
    return h.subarray(0, 4).toString('ascii') === 'RIFF' && h.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  if (mime === 'audio/webm') {
    return h.length >= 4 && h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3;
  }
  if (mime === 'audio/ogg') {
    return h.subarray(0, 4).toString('ascii') === 'OggS';
  }
  if (mime === 'application/pdf') {
    return h.subarray(0, 4).toString('ascii') === '%PDF';
  }
  return true;
}

function parseAndValidateDataUri(dataUri, label) {
  const match = String(dataUri || '').match(/^data:([^,;]+)(?:;[^,]*)?,(.*)$/is);
  if (!match) {
    throw new Error(`Invalid data URI in ${label}`);
  }
  const mime = match[1].trim().toLowerCase();
  const ext = EXT_FROM_MIME[mime];
  if (!ext) {
    throw new Error(`Unsupported MIME type "${mime}" in ${label}`);
  }
  const cleanB64 = match[2].replace(/\s+/g, '');
  const buffer = Buffer.from(cleanB64, 'base64');
  if (buffer.byteLength === 0) {
    throw new Error(`Decoded empty media buffer for ${label}`);
  }
  if (!verifyMediaMagicBytes(mime, buffer)) {
    throw new Error(`Magic byte check failed for ${mime} in ${label}`);
  }
  const sha256_12 = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 12);
  return { mime, ext, buffer, sha256_12 };
}

function sqlText(val) {
  const s = String(val ?? '');
  if (s.includes('\0')) {
    throw new Error('Unexpected NUL byte in SQL text literal');
  }
  const escaped = s
    .replace(/'/g, "''")
    .replace(/\r/g, "' || char(13) || '")
    .replace(/\n/g, "' || char(10) || '");
  return `'${escaped}'`;
}

/**
 * Splits a string into UTF-8 & surrogate-pair safe chunks whose SQL-escaped
 * literal byte length stays strictly below `maxSqlLiteralBytes`, keeping every
 * D1 SQL statement comfortably under Cloudflare D1's 100 KB statement limit.
 */
function chunkStringForSql(str, maxSqlLiteralBytes = 35000) {
  const s = String(str ?? '');
  if (!s) return [''];
  const chunks = [];
  let current = '';
  let currentBytes = 2; // opening + closing single quote

  for (const ch of s) {
    let chSqlBytes;
    if (ch === "'") chSqlBytes = 2;
    else if (ch === '\r' || ch === '\n') chSqlBytes = 18;
    else chSqlBytes = Buffer.byteLength(ch, 'utf8');

    if (current.length > 0 && currentBytes + chSqlBytes > maxSqlLiteralBytes) {
      chunks.push(current);
      current = ch;
      currentBytes = 2 + chSqlBytes;
    } else {
      current += ch;
      currentBytes += chSqlBytes;
    }
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  assert.equal(chunks.join(''), s, 'Chunk round-trip mismatch');
  return chunks;
}

function assertNoDataUris(value, pathLabel) {
  if (typeof value === 'string') {
    if (value.trim().toLowerCase().startsWith('data:')) {
      throw new Error(`Leftover data URI found at ${pathLabel}`);
    }
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      assertNoDataUris(value[i], `${pathLabel}[${i}]`);
    }
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      assertNoDataUris(v, `${pathLabel}.${k}`);
    }
  }
}

async function runWithConcurrency(items, concurrency, fn) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

async function uploadToR2WithRetry(item, tmpDir, maxAttempts = 3) {
  const tmpFile = path.join(tmpDir, `${item.sha256_12}_${item.index}.${item.ext}`);
  fs.writeFileSync(tmpFile, item.buffer);
  const objectPath = `${R2_BUCKET_NAME}/${item.key}`;

  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await execFileAsync(
        'npx',
        [
          'wrangler',
          'r2',
          'object',
          'put',
          objectPath,
          '--file',
          tmpFile,
          '--content-type',
          item.contentType,
          '--remote'
        ],
        { cwd: WORKSPACE_DIR, maxBuffer: 10 * 1024 * 1024 }
      );
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
  }
  throw new Error(`R2 upload failed for ${item.key}: ${lastErr?.stderr || lastErr?.message}`);
}

function buildMigrationPlan(csvPath) {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found: ${csvPath}`);
  }
  const rawCsv = fs.readFileSync(csvPath, 'utf8');
  const { headers, records } = parseCsvRfc4180(rawCsv);
  const expectedHeaders = [
    'id',
    'name',
    'parsha_or_date',
    'notes',
    'completed_topics',
    'completed_parshiot',
    'updated_at'
  ];
  assert.deepEqual(headers, expectedHeaders, `Unexpected CSV headers: ${headers.join(',')}`);

  let skippedPortalSettings = 0;
  let usersDirRow = null;
  let schoolsRegRow = null;
  const courseContainerRows = [];
  const studentRows = [];

  for (const rec of records) {
    if (rec.id === '__portal_settings__') {
      // Never log or persist __portal_settings__
      skippedPortalSettings++;
      continue;
    }
    if (rec.id === '__tutor_users_directory__') {
      usersDirRow = rec;
    } else if (rec.id === '__schools_registry__') {
      schoolsRegRow = rec;
    } else if (rec.id.startsWith('__custom_courses')) {
      courseContainerRows.push(rec);
    } else if (rec.id.startsWith('stu_')) {
      studentRows.push(rec);
    } else {
      throw new Error(`Unrecognized CSV row id: ${rec.id}`);
    }
  }

  assert.ok(usersDirRow, 'Missing __tutor_users_directory__ row');
  assert.ok(schoolsRegRow, 'Missing __schools_registry__ row');

  const schoolsRegData = safeJsonParse(schoolsRegRow.completed_topics, '__schools_registry__');
  const usersDirData = safeJsonParse(usersDirRow.completed_topics, '__tutor_users_directory__');
  const rawSchools = Array.isArray(schoolsRegData.schools) ? schoolsRegData.schools : [];
  const rawUsers = Array.isArray(usersDirData.users) ? usersDirData.users : [];

  // Map owner email -> normalized school_id from schools registry so users without explicit school_id link cleanly
  const ownerEmailToSchoolId = new Map();
  for (const s of rawSchools) {
    const sid = normalizeSchoolId(s.id);
    const email = String(s.owner_email || '').trim().toLowerCase();
    if (sid && email) ownerEmailToSchoolId.set(email, sid);
  }

  // 1. Normalize Users
  const users = [];
  const usersByEmail = new Map();
  for (const u of rawUsers) {
    const email = String(u.email || '').trim().toLowerCase();
    if (!email) throw new Error(`User missing email: ${JSON.stringify(u)}`);

    const id = normalizePendingUserId(u.id);
    const role = normalizeUserRole(u.role);
    const schoolId = normalizeSchoolId(u.school_id) || ownerEmailToSchoolId.get(email) || 'school_main_academy';
    const rawSub = String(u.subscription_status || 'trialing').trim().toLowerCase();
    const subscriptionStatus = ALLOWED_SUB_STATUSES.has(rawSub) ? rawSub : 'trialing';
    const trialDays = subscriptionStatus === 'lifetime' ? 9999 : (Number(u.trial_days) || 35);
    const createdAt = normalizeIsoTimestamp(u.createdAt || usersDirRow.updated_at);
    const updatedAt = normalizeIsoTimestamp(u.last_active || usersDirRow.updated_at, createdAt);
    const trialEndsAt = subscriptionStatus === 'trialing'
      ? new Date(Date.parse(createdAt) + trialDays * 86400 * 1000).toISOString()
      : '';
    const isSuper = role === 'super_admin' || email === 'shmueldoviduhlman@gmail.com';
    const fullName = String(u.name_en || u.full_name || email.split('@')[0]).trim();
    const displayNameHe = String(u.name_he || fullName).trim();
    const defaultOrg = isSuper ? 'Bar Mitzvah Academy' : `${fullName}'s Studio`;
    const organization = String(u.organization || u.school_name || defaultOrg).trim();

    const userRow = {
      id,
      email,
      full_name: fullName,
      display_name_he: displayNameHe,
      organization,
      role,
      school_id: schoolId,
      account_status: 'active',
      suspended_reason: '',
      subscription_status: subscriptionStatus,
      trial_days: trialDays,
      trial_ends_at: trialEndsAt,
      ai_enabled: 1,
      ai_tier_access: isSuper ? 'pro' : 'standard',
      ai_daily_limit: null,
      ai_pro_daily_limit: null,
      ai_allow_platform_fallback: 0,
      admin_notes: '',
      last_active_at: normalizeIsoTimestamp(u.last_active, updatedAt),
      created_at: createdAt,
      updated_at: updatedAt
    };
    users.push(userRow);
    usersByEmail.set(email, userRow);
  }

  // 2. Normalize Schools & School Members (fresh random join codes)
  const usedJoinCodes = new Set();
  const schools = [];
  const schoolsById = new Map();
  const schoolMembers = [];
  const schoolMembersDedup = new Set();

  for (const s of rawSchools) {
    const id = normalizeSchoolId(s.id);
    const ownerEmail = String(s.owner_email || '').trim().toLowerCase();
    const ownerUser = usersByEmail.get(ownerEmail);
    if (!ownerUser) {
      throw new Error(`School ${id} owner "${ownerEmail}" not found in users directory`);
    }
    const joinCode = generateRandomCode(8, usedJoinCodes, BANNED_LEGACY_JOIN_CODES);
    const createdAt = normalizeIsoTimestamp(s.created_at || schoolsRegRow.updated_at);
    const updatedAt = normalizeIsoTimestamp(schoolsRegRow.updated_at, createdAt);

    const schoolRow = {
      id,
      name: String(s.name || 'Bar Mitzvah Academy').trim(),
      owner_user_id: ownerUser.id,
      join_code: joinCode,
      created_at: createdAt,
      updated_at: updatedAt
    };
    schools.push(schoolRow);
    schoolsById.set(id, schoolRow);

    const members = Array.isArray(s.members) ? s.members : [];
    for (const m of members) {
      const mEmail = String(m.email || '').trim().toLowerCase();
      const memberUser = usersByEmail.get(mEmail);
      if (!memberUser) continue;
      const memberKey = `${id}:${memberUser.id}`;
      if (schoolMembersDedup.has(memberKey)) continue;
      schoolMembersDedup.add(memberKey);
      schoolMembers.push({
        school_id: id,
        user_id: memberUser.id,
        role: m.role === 'owner' ? 'owner' : 'teacher',
        joined_at: normalizeIsoTimestamp(m.joined_at, createdAt)
      });
    }
  }

  // Ensure every user is a member of their assigned school
  for (const u of users) {
    const memberKey = `${u.school_id}:${u.id}`;
    if (!schoolMembersDedup.has(memberKey) && schoolsById.has(u.school_id)) {
      schoolMembersDedup.add(memberKey);
      const sch = schoolsById.get(u.school_id);
      schoolMembers.push({
        school_id: u.school_id,
        user_id: u.id,
        role: sch.owner_user_id === u.id ? 'owner' : 'teacher',
        joined_at: u.created_at
      });
    }
  }

  // 3. Normalize Students & Extract Base64 Media
  const usedStudentAccessCodes = new Set();
  for (const rec of studentRows) {
    const ct = safeJsonParse(rec.completed_topics, `${rec.id}.completed_topics`);
    const meta = (ct && ct._meta) || {};
    const rawCode = String(meta.studentAccessCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
    if (rawCode.length >= 4) {
      usedStudentAccessCodes.add(rawCode);
    }
  }

  const students = [];
  const mediaObjects = [];
  const usedR2Keys = new Set();

  for (const rec of studentRows) {
    const ct = safeJsonParse(rec.completed_topics, `${rec.id}.completed_topics`);
    const cp = safeJsonParse(rec.completed_parshiot, `${rec.id}.completed_parshiot`);
    const meta = (ct && ct._meta && typeof ct._meta === 'object') ? ct._meta : {};

    const cleanTopics = { ...ct };
    delete cleanTopics._meta;

    // Normalize school_id and assign orphan student (e.g. stu_1795374485939) to school_main_academy
    let schoolId = normalizeSchoolId(meta.school_id);
    if (!schoolId || !schoolsById.has(schoolId)) {
      schoolId = 'school_main_academy';
    }
    const safeSchool = schoolId.replace(/[^a-zA-Z0-9_-]/g, '_');

    const ownerEmail = String(meta.owner_email || '').trim().toLowerCase();
    const ownerUser = (ownerEmail && usersByEmail.get(ownerEmail)) || null;
    const schoolObj = schoolsById.get(schoolId);
    const ownerUserId = (ownerUser && ownerUser.id) || (schoolObj && schoolObj.owner_user_id) || 'pending_super_admin_shmuel';

    let accessCode = String(meta.studentAccessCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
    if (!accessCode || accessCode.length < 4) {
      accessCode = generateRandomCode(6, usedStudentAccessCodes);
    }

    const updatedAt = normalizeIsoTimestamp(rec.updated_at);
    const createdAt = updatedAt;

    // Extract avatar if data URI
    let avatarMediaKey = '';
    let profileAvatar = String(meta.avatar || '').trim();
    if (profileAvatar.startsWith('data:')) {
      const parsed = parseAndValidateDataUri(profileAvatar, `${rec.id}.avatar`);
      const key = `schools/${safeSchool}/migrated/${rec.id}/avatar_${parsed.sha256_12}.${parsed.ext}`;
      assert.ok(!usedR2Keys.has(key), `Duplicate R2 key generated: ${key}`);
      usedR2Keys.add(key);

      mediaObjects.push({
        index: mediaObjects.length,
        key,
        school_id: schoolId,
        student_id: rec.id,
        uploaded_by: ownerUserId,
        contentType: parsed.mime,
        ext: parsed.ext,
        buffer: parsed.buffer,
        sha256_12: parsed.sha256_12,
        byte_size: parsed.buffer.byteLength,
        original_name: `avatar.${parsed.ext}`,
        created_at: updatedAt
      });
      avatarMediaKey = key;
      profileAvatar = '';
    }

    // Clone & recursively extract any embedded data URIs inside skills (customGoals recordings, etc.)
    const migratedSkills = meta.skills && typeof meta.skills === 'object'
      ? structuredClone(meta.skills)
      : {};

    function extractMediaWalk(node, pathParts, parentObj) {
      if (typeof node === 'string' && node.trim().toLowerCase().startsWith('data:')) {
        const label = `${rec.id}.${pathParts.join('.')}`;
        const parsed = parseAndValidateDataUri(node, label);
        const rawItemId = (parentObj && parentObj.id) || pathParts.join('_');
        const safeItemId = String(rawItemId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'media';
        let key = `schools/${safeSchool}/migrated/${rec.id}/${safeItemId}_${parsed.sha256_12}.${parsed.ext}`;
        if (usedR2Keys.has(key)) {
          let suffix = 2;
          while (usedR2Keys.has(`${key}_${suffix}`)) suffix++;
          key = `schools/${safeSchool}/migrated/${rec.id}/${safeItemId}_${suffix}_${parsed.sha256_12}.${parsed.ext}`;
        }
        usedR2Keys.add(key);

        const rawTitle = (parentObj && (parentObj.title || parentObj.name)) || safeItemId;
        const cleanTitle = String(rawTitle).replace(/[\/\\]/g, '_').trim().slice(0, 160) || safeItemId;
        const originalName = cleanTitle.toLowerCase().endsWith(`.${parsed.ext}`)
          ? cleanTitle
          : `${cleanTitle}.${parsed.ext}`;

        mediaObjects.push({
          index: mediaObjects.length,
          key,
          school_id: schoolId,
          student_id: rec.id,
          uploaded_by: ownerUserId,
          contentType: parsed.mime,
          ext: parsed.ext,
          buffer: parsed.buffer,
          sha256_12: parsed.sha256_12,
          byte_size: parsed.buffer.byteLength,
          original_name: originalName.slice(0, 180),
          created_at: updatedAt
        });
        return `/api/media/${key}`;
      }
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
          node[i] = extractMediaWalk(node[i], [...pathParts, String(i)], node);
        }
        return node;
      }
      if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
          node[k] = extractMediaWalk(v, [...pathParts, k], node);
        }
        return node;
      }
      return node;
    }

    extractMediaWalk(migratedSkills, ['skills'], null);

    const sharedNotes = Array.isArray(meta.sharedNotes) ? meta.sharedNotes : [];
    const schedule = Array.isArray(meta.schedule) ? meta.schedule : [];
    const lessons = Array.isArray(meta.lessons) ? meta.lessons : [];

    const profileObj = {
      subject: String(meta.subject ?? rec.parsha_or_date ?? ''),
      gradeOrDate: String(meta.gradeOrDate ?? ''),
      gradeLevel: String(meta.gradeLevel || 'Standard / All Levels'),
      hourlyRate: String(meta.hourlyRate ?? ''),
      parentContact: (meta.parentContact && typeof meta.parentContact === 'object')
        ? meta.parentContact
        : { name: '', phone: '', email: '' },
      avatar: profileAvatar,
      lessons
    };

    const progressObj = {
      completedTopics: cleanTopics,
      completedParshiot: (cp && typeof cp === 'object') ? cp : {}
    };

    assertNoDataUris(profileObj, `${rec.id}.profileObj`);
    assertNoDataUris(migratedSkills, `${rec.id}.skills`);
    assertNoDataUris(sharedNotes, `${rec.id}.sharedNotes`);
    assertNoDataUris(schedule, `${rec.id}.schedule`);
    assertNoDataUris(progressObj, `${rec.id}.progressObj`);

    students.push({
      id: rec.id,
      school_id: schoolId,
      owner_user_id: ownerUserId,
      name: String(rec.name || '').trim(),
      access_code: accessCode,
      avatar_media_key: avatarMediaKey,
      status: String(meta.status || 'active'),
      archived: meta.archived ? 1 : 0,
      archived_at: meta.archived ? normalizeIsoTimestamp(meta.archivedAt || updatedAt) : '',
      sort_order: typeof meta.order === 'number' ? meta.order : 0,
      parsha_or_date: String(rec.parsha_or_date || meta.gradeOrDate || meta.subject || ''),
      profile_json: JSON.stringify(profileObj),
      private_notes: String(rec.notes || ''),
      shared_notes_json: JSON.stringify(sharedNotes),
      skills_json: JSON.stringify(migratedSkills),
      schedule_json: JSON.stringify(schedule),
      progress_json: JSON.stringify(progressObj),
      updated_by: String(meta.last_updated_by || meta.last_updated_email || ''),
      created_at: createdAt,
      updated_at: updatedAt
    });
  }

  // 4. Normalize Courses
  const courses = [];
  const skippedEmptyCourseContainers = [];

  for (const container of courseContainerRows) {
    const ct = safeJsonParse(container.completed_topics, `${container.id}.completed_topics`);
    const containerMeta = (ct && ct._meta) || {};
    const containerSchoolId = normalizeSchoolId(containerMeta.school_id);
    const list = Array.isArray(ct) ? ct : (Array.isArray(ct.courses) ? ct.courses : []);

    if (list.length === 0) {
      skippedEmptyCourseContainers.push({ id: container.id, schoolId: containerSchoolId || '(none)' });
      continue;
    }

    for (const rawCourse of list) {
      if (!rawCourse || !rawCourse.id) continue;
      const cid = String(rawCourse.id).trim();
      const courseSchoolId = normalizeSchoolId(rawCourse.school_id || containerSchoolId) || 'school_main_academy';
      if (!schoolsById.has(courseSchoolId)) {
        throw new Error(`Course ${cid} references unknown school ${courseSchoolId}`);
      }
      const ownerEmail = String(containerMeta.owner_email || '').trim().toLowerCase();
      const ownerUserId =
        (schoolsById.get(courseSchoolId) && schoolsById.get(courseSchoolId).owner_user_id) ||
        (ownerEmail && usersByEmail.get(ownerEmail) && usersByEmail.get(ownerEmail).id) ||
        'pending_super_admin_shmuel';

      const title = String(rawCourse.title || rawCourse.title_en || rawCourse.title_he || 'Untitled Course').trim();
      const archived = rawCourse.archived ? 1 : 0;
      const createdAt = normalizeIsoTimestamp(rawCourse.created_at || container.updated_at);
      const updatedAt = normalizeIsoTimestamp(rawCourse.updated_at || container.updated_at, createdAt);
      const archivedAt = archived ? normalizeIsoTimestamp(rawCourse.archivedAt || updatedAt) : '';

      const cleanCourse = {
        ...rawCourse,
        id: cid,
        school_id: courseSchoolId,
        owner_id: ownerUserId
      };
      assertNoDataUris(cleanCourse, `${cid}.data_json`);

      courses.push({
        id: cid,
        school_id: courseSchoolId,
        owner_user_id: ownerUserId,
        title,
        archived,
        archived_at: archivedAt,
        deleted_at: '',
        data_json: JSON.stringify(cleanCourse),
        created_at: createdAt,
        updated_at: updatedAt
      });
    }
  }

  return {
    totalCsvRows: records.length,
    skippedPortalSettings,
    skippedEmptyCourseContainers,
    users,
    schools,
    schoolMembers,
    students,
    courses,
    mediaObjects
  };
}

function buildMigrationSqlStatements(plan) {
  const stmts = [];

  for (const u of plan.users) {
    stmts.push(
      `INSERT INTO users (id, email, full_name, display_name_he, organization, role, school_id, account_status, suspended_reason, subscription_status, trial_days, trial_ends_at, ai_enabled, ai_tier_access, ai_daily_limit, ai_pro_daily_limit, ai_allow_platform_fallback, admin_notes, last_active_at, created_at, updated_at) VALUES (${sqlText(u.id)}, ${sqlText(u.email)}, ${sqlText(u.full_name)}, ${sqlText(u.display_name_he)}, ${sqlText(u.organization)}, ${sqlText(u.role)}, ${sqlText(u.school_id)}, ${sqlText(u.account_status)}, ${sqlText(u.suspended_reason)}, ${sqlText(u.subscription_status)}, ${u.trial_days}, ${sqlText(u.trial_ends_at)}, ${u.ai_enabled}, ${sqlText(u.ai_tier_access)}, NULL, NULL, ${u.ai_allow_platform_fallback}, ${sqlText(u.admin_notes)}, ${sqlText(u.last_active_at)}, ${sqlText(u.created_at)}, ${sqlText(u.updated_at)}) ON CONFLICT(id) DO UPDATE SET email = excluded.email, full_name = excluded.full_name, display_name_he = excluded.display_name_he, organization = excluded.organization, role = excluded.role, school_id = excluded.school_id, account_status = excluded.account_status, subscription_status = excluded.subscription_status, trial_days = excluded.trial_days, trial_ends_at = excluded.trial_ends_at, ai_enabled = excluded.ai_enabled, ai_tier_access = excluded.ai_tier_access, ai_allow_platform_fallback = excluded.ai_allow_platform_fallback, last_active_at = excluded.last_active_at, updated_at = excluded.updated_at;`
    );
  }

  for (const s of plan.schools) {
    stmts.push(
      `INSERT INTO schools (id, name, owner_user_id, join_code, created_at, updated_at) VALUES (${sqlText(s.id)}, ${sqlText(s.name)}, ${sqlText(s.owner_user_id)}, ${sqlText(s.join_code)}, ${sqlText(s.created_at)}, ${sqlText(s.updated_at)}) ON CONFLICT(id) DO UPDATE SET name = excluded.name, owner_user_id = excluded.owner_user_id, join_code = excluded.join_code, updated_at = excluded.updated_at;`
    );
  }

  for (const sm of plan.schoolMembers) {
    stmts.push(
      `INSERT INTO school_members (school_id, user_id, role, joined_at) VALUES (${sqlText(sm.school_id)}, ${sqlText(sm.user_id)}, ${sqlText(sm.role)}, ${sqlText(sm.joined_at)}) ON CONFLICT(school_id, user_id) DO UPDATE SET role = excluded.role, joined_at = excluded.joined_at;`
    );
  }

  for (const st of plan.students) {
    const profileChunks = chunkStringForSql(st.profile_json, 35000);
    const skillsChunks = chunkStringForSql(st.skills_json, 35000);
    const progressChunks = chunkStringForSql(st.progress_json, 35000);

    stmts.push(
      `INSERT INTO students (id, school_id, owner_user_id, name, access_code, avatar_media_key, status, archived, archived_at, sort_order, parsha_or_date, profile_json, private_notes, shared_notes_json, skills_json, schedule_json, progress_json, updated_by, created_at, updated_at) VALUES (${sqlText(st.id)}, ${sqlText(st.school_id)}, ${sqlText(st.owner_user_id)}, ${sqlText(st.name)}, ${sqlText(st.access_code)}, ${sqlText(st.avatar_media_key)}, ${sqlText(st.status)}, ${st.archived}, ${sqlText(st.archived_at)}, ${st.sort_order}, ${sqlText(st.parsha_or_date)}, ${sqlText(profileChunks[0])}, ${sqlText(st.private_notes)}, ${sqlText(st.shared_notes_json)}, ${sqlText(skillsChunks[0])}, ${sqlText(st.schedule_json)}, ${sqlText(progressChunks[0])}, ${sqlText(st.updated_by)}, ${sqlText(st.created_at)}, ${sqlText(st.updated_at)}) ON CONFLICT(id) DO UPDATE SET school_id = excluded.school_id, owner_user_id = excluded.owner_user_id, name = excluded.name, access_code = excluded.access_code, avatar_media_key = excluded.avatar_media_key, status = excluded.status, archived = excluded.archived, archived_at = excluded.archived_at, sort_order = excluded.sort_order, parsha_or_date = excluded.parsha_or_date, profile_json = excluded.profile_json, private_notes = excluded.private_notes, shared_notes_json = excluded.shared_notes_json, skills_json = excluded.skills_json, schedule_json = excluded.schedule_json, progress_json = excluded.progress_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at;`
    );

    for (let i = 1; i < profileChunks.length; i++) {
      stmts.push(`UPDATE students SET profile_json = profile_json || ${sqlText(profileChunks[i])} WHERE id = ${sqlText(st.id)};`);
    }
    for (let i = 1; i < skillsChunks.length; i++) {
      stmts.push(`UPDATE students SET skills_json = skills_json || ${sqlText(skillsChunks[i])} WHERE id = ${sqlText(st.id)};`);
    }
    for (let i = 1; i < progressChunks.length; i++) {
      stmts.push(`UPDATE students SET progress_json = progress_json || ${sqlText(progressChunks[i])} WHERE id = ${sqlText(st.id)};`);
    }
  }

  for (const c of plan.courses) {
    const chunks = chunkStringForSql(c.data_json, 35000);
    stmts.push(
      `INSERT INTO courses (id, school_id, owner_user_id, title, archived, archived_at, deleted_at, data_json, created_at, updated_at) VALUES (${sqlText(c.id)}, ${sqlText(c.school_id)}, ${sqlText(c.owner_user_id)}, ${sqlText(c.title)}, ${c.archived}, ${sqlText(c.archived_at)}, '', ${sqlText(chunks[0])}, ${sqlText(c.created_at)}, ${sqlText(c.updated_at)}) ON CONFLICT(id) DO UPDATE SET school_id = excluded.school_id, owner_user_id = excluded.owner_user_id, title = excluded.title, archived = excluded.archived, archived_at = excluded.archived_at, deleted_at = '', data_json = excluded.data_json, updated_at = excluded.updated_at;`
    );
    for (let i = 1; i < chunks.length; i++) {
      stmts.push(
        `UPDATE courses SET data_json = data_json || ${sqlText(chunks[i])} WHERE id = ${sqlText(c.id)};`
      );
    }
  }

  for (const m of plan.mediaObjects) {
    stmts.push(
      `INSERT INTO media_objects (key, school_id, student_id, uploaded_by, content_type, byte_size, original_name, created_at) VALUES (${sqlText(m.key)}, ${sqlText(m.school_id)}, ${sqlText(m.student_id)}, ${sqlText(m.uploaded_by)}, ${sqlText(m.contentType)}, ${m.byte_size}, ${sqlText(m.original_name)}, ${sqlText(m.created_at)}) ON CONFLICT(key) DO UPDATE SET school_id = excluded.school_id, student_id = excluded.student_id, uploaded_by = excluded.uploaded_by, content_type = excluded.content_type, byte_size = excluded.byte_size, original_name = excluded.original_name;`
    );
  }

  return stmts;
}

async function executeD1SqlFile(targetFlag, sqlFilePath) {
  const args = ['wrangler', 'd1', 'execute', D1_DB_NAME, targetFlag, '--file', sqlFilePath];
  if (targetFlag === '--remote') args.push('--yes');
  const { stdout, stderr } = await execFileAsync('npx', args, {
    cwd: WORKSPACE_DIR,
    maxBuffer: 20 * 1024 * 1024
  });
  return { stdout, stderr };
}

async function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  const plan = buildMigrationPlan(opts.csvPath);
  const statements = buildMigrationSqlStatements(plan);

  const maxStmtBytes = statements.reduce((max, s) => Math.max(max, Buffer.byteLength(s, 'utf8')), 0);
  const totalMediaBytes = plan.mediaObjects.reduce((sum, m) => sum + m.byte_size, 0);

  console.log('=== TutorPilot Migration Plan Summary ===');
  console.log(`CSV rows parsed:        ${plan.totalCsvRows} (skipped __portal_settings__: ${plan.skippedPortalSettings})`);
  console.log(`Users (pending_*):      ${plan.users.length}`);
  console.log(`Schools:                ${plan.schools.length} (codes: ${plan.schools.map((s) => `${s.id}=${s.join_code}`).join(', ')})`);
  console.log(`School members:         ${plan.schoolMembers.length}`);
  console.log(`Students:               ${plan.students.length}`);
  console.log(`Courses:                ${plan.courses.length} (skipped empty containers: ${plan.skippedEmptyCourseContainers.map((x) => x.id).join(', ') || 'none'})`);
  console.log(`Media objects (R2):     ${plan.mediaObjects.length} (${totalMediaBytes} bytes total)`);
  console.log(`SQL statements:         ${statements.length} (max statement size: ${maxStmtBytes} bytes)`);

  assert.ok(maxStmtBytes < 90000, `SQL statement too large (${maxStmtBytes} bytes)`);

  if (opts.dryRun) {
    console.log('\n[DRY-RUN] Validated without uploading to R2 or writing to D1.');
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tutorpilot-migrate-'));
  try {
    if (!opts.skipR2 && plan.mediaObjects.length > 0) {
      console.log(`\nUploading ${plan.mediaObjects.length} media objects to remote R2 bucket "${R2_BUCKET_NAME}"...`);
      let uploaded = 0;
      await runWithConcurrency(plan.mediaObjects, 5, async (item) => {
        await uploadToR2WithRetry(item, tmpDir);
        uploaded++;
        if (uploaded % 10 === 0 || uploaded === plan.mediaObjects.length) {
          console.log(`  R2 progress: ${uploaded}/${plan.mediaObjects.length}`);
        }
      });
      console.log(`R2 upload complete: ${uploaded}/${plan.mediaObjects.length} objects.`);
    }

    const sqlFilePath = path.join(tmpDir, 'migration.sql');
    fs.writeFileSync(sqlFilePath, statements.join('\n') + '\n', 'utf8');

    if (!opts.remoteOnly) {
      console.log(`\nExecuting SQL against LOCAL D1 "${D1_DB_NAME}"...`);
      await executeD1SqlFile('--local', sqlFilePath);
      console.log('LOCAL D1 migration complete.');
    }

    if (!opts.localOnly) {
      console.log(`\nExecuting SQL against REMOTE D1 "${D1_DB_NAME}"...`);
      await executeD1SqlFile('--remote', sqlFilePath);
      console.log('REMOTE D1 migration complete.');
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('MIGRATION FAILED:', err && err.stack ? err.stack : err);
  process.exit(1);
});
