import { handleOptions, jsonResponse } from '../_lib/cors.js';
import { requireTutorAuth } from '../_lib/auth.js';
import { generateRandomCode } from '../_lib/crypto.js';

export async function onRequestOptions(context) {
  return handleOptions(context, 'GET, POST, OPTIONS');
}

export async function onRequestGet(context) {
  const auth = await requireTutorAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { env, request } = context;

  const school = await env.DB.prepare(
    'SELECT id, name, owner_user_id, join_code, created_at, updated_at FROM schools WHERE id = ?'
  ).bind(auth.user.school_id).first();
  if (!school) return jsonResponse({ error: 'School not found' }, 404, request, env);

  const membersRes = await env.DB.prepare(
    `SELECT sm.user_id, sm.role AS member_role, sm.joined_at, u.email, u.full_name, u.display_name_he
     FROM school_members sm
     LEFT JOIN users u ON u.id = sm.user_id
     WHERE sm.school_id = ? ORDER BY sm.joined_at ASC`
  ).bind(school.id).all();

  return jsonResponse({
    school: {
      id: school.id,
      name: school.name,
      ownerUserId: school.owner_user_id,
      joinCode: school.join_code,
      members: (membersRes && membersRes.results) || []
    }
  }, 200, request, env);
}

export async function onRequestPost(context) {
  const auth = await requireTutorAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env } = context;
  const { user } = auth;

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, request, env);
  }

  const action = String((body && body.action) || '').trim();
  const nowIso = new Date().toISOString();

  if (action === 'update_name') {
    const newName = String((body && body.name) || '').trim();
    if (!newName) return jsonResponse({ error: 'School name cannot be empty' }, 400, request, env);
    const school = await env.DB.prepare('SELECT id, owner_user_id FROM schools WHERE id = ?').bind(user.school_id).first();
    if (!school) return jsonResponse({ error: 'School not found' }, 404, request, env);
    if (school.owner_user_id !== user.id && user.role !== 'super_admin' && user.role !== 'admin') {
      return jsonResponse({ error: 'Only the school owner can rename this workspace' }, 403, request, env);
    }
    await env.DB.prepare('UPDATE schools SET name = ?, updated_at = ? WHERE id = ?').bind(newName, nowIso, school.id).run();
    return jsonResponse({ ok: true, name: newName }, 200, request, env);
  }

  if (action === 'rotate_join_code') {
    const school = await env.DB.prepare('SELECT id, owner_user_id FROM schools WHERE id = ?').bind(user.school_id).first();
    if (!school) return jsonResponse({ error: 'School not found' }, 404, request, env);
    if (school.owner_user_id !== user.id && user.role !== 'super_admin' && user.role !== 'admin') {
      return jsonResponse({ error: 'Only the school owner can rotate the join code' }, 403, request, env);
    }
    const newCode = generateRandomCode(8);
    await env.DB.prepare('UPDATE schools SET join_code = ?, updated_at = ? WHERE id = ?').bind(newCode, nowIso, school.id).run();
    return jsonResponse({ ok: true, joinCode: newCode }, 200, request, env);
  }

  if (action === 'join_with_code') {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (env.APP_KV && typeof env.APP_KV.get === 'function') {
      const rlKey = `school_join_rl:${ip}`;
      const tries = parseInt((await env.APP_KV.get(rlKey)) || '0', 10) || 0;
      if (tries >= 12) {
        return jsonResponse({ error: 'Too many join attempts. Wait 10 minutes and try again.' }, 429, request, env);
      }
      await env.APP_KV.put(rlKey, String(tries + 1), { expirationTtl: 600 });
    }

    const enteredCode = String((body && body.joinCode) || '').toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
    if (!enteredCode || enteredCode.length < 4) {
      return jsonResponse({ error: 'Invalid join code' }, 400, request, env);
    }
    const targetSchool = await env.DB.prepare('SELECT * FROM schools WHERE upper(join_code) = ?').bind(enteredCode).first();
    if (!targetSchool) {
      return jsonResponse({ error: 'School join code not found' }, 404, request, env);
    }

    await env.DB.batch([
      env.DB.prepare('UPDATE users SET school_id = ?, organization = ?, updated_at = ? WHERE id = ?').bind(targetSchool.id, targetSchool.name, nowIso, user.id),
      env.DB.prepare("INSERT OR IGNORE INTO school_members (school_id, user_id, role, joined_at) VALUES (?, ?, 'teacher', ?)").bind(targetSchool.id, user.id, nowIso)
    ]);

    return jsonResponse({ ok: true, school: { id: targetSchool.id, name: targetSchool.name, joinCode: targetSchool.join_code } }, 200, request, env);
  }

  if (action === 'remove_member') {
    const targetUserId = String((body && body.userId) || '').trim();
    const school = await env.DB.prepare('SELECT id, owner_user_id FROM schools WHERE id = ?').bind(user.school_id).first();
    if (!school) return jsonResponse({ error: 'School not found' }, 404, request, env);
    if (school.owner_user_id !== user.id && user.role !== 'super_admin' && user.role !== 'admin') {
      return jsonResponse({ error: 'Only the school owner can remove teachers' }, 403, request, env);
    }
    if (!targetUserId || targetUserId === school.owner_user_id) {
      return jsonResponse({ error: 'Cannot remove the school owner' }, 400, request, env);
    }
    const soloSchoolId = 'school_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const soloCode = generateRandomCode(8);
    const targetUser = await env.DB.prepare('SELECT full_name, email FROM users WHERE id = ?').bind(targetUserId).first();
    const soloName = ((targetUser && targetUser.full_name) || 'My') + ' Studio';

    await env.DB.batch([
      env.DB.prepare('DELETE FROM school_members WHERE school_id = ? AND user_id = ?').bind(school.id, targetUserId),
      env.DB.prepare('INSERT INTO schools (id, name, owner_user_id, join_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(soloSchoolId, soloName, targetUserId, soloCode, nowIso, nowIso),
      env.DB.prepare("INSERT INTO school_members (school_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").bind(soloSchoolId, targetUserId, nowIso),
      env.DB.prepare('UPDATE users SET school_id = ?, updated_at = ? WHERE id = ?').bind(soloSchoolId, nowIso, targetUserId)
    ]);

    return jsonResponse({ ok: true, removedUserId: targetUserId }, 200, request, env);
  }

  return jsonResponse({ error: 'Unsupported school action' }, 400, request, env);
}
