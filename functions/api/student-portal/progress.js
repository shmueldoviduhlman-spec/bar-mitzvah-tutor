import { handleOptions, jsonResponse } from '../_lib/cors.js';
import { verifyStudentToken } from '../_lib/crypto.js';
import { extractStudentToken } from './me.js';
import { sanitizeStudentForPortal } from './login.js';

export async function onRequestOptions(context) {
  return handleOptions(context, 'POST, OPTIONS');
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const secret = String((env && env.STUDENT_TOKEN_SECRET) || '').trim();
  const token = extractStudentToken(request);
  const claims = token && secret ? await verifyStudentToken(token, secret) : null;
  if (!claims) {
    return jsonResponse({ error: 'Student session expired or invalid' }, 401, request, env);
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, request, env);
  }

  const row = await env.DB.prepare(
    'SELECT * FROM students WHERE id = ? AND school_id = ? AND archived = 0'
  ).bind(claims.studentId, claims.schoolId).first();
  if (!row) {
    return jsonResponse({ error: 'Student record not found' }, 404, request, env);
  }

  let skills = {};
  try { skills = row.skills_json ? JSON.parse(row.skills_json) : {}; } catch (_) {}
  if (!skills || typeof skills !== 'object') skills = {};

  // Students can ONLY mutate homework completion, customGoals completion flags, and assigned quiz submissions
  if (typeof (body && body.homeworkCompleted) === 'boolean') {
    if (!skills.homework || typeof skills.homework !== 'object') skills.homework = {};
    skills.homework.completed = body.homeworkCompleted;
  }

  if (Array.isArray(body && body.goalCompletions) && Array.isArray(skills.customGoals)) {
    const map = new Map();
    for (const item of body.goalCompletions) {
      if (item && item.id) map.set(String(item.id), !!item.completed);
    }
    skills.customGoals = skills.customGoals.map(g => {
      if (g && map.has(String(g.id))) {
        return { ...g, completed: map.get(String(g.id)) };
      }
      return g;
    });
  }

  const applyAssignedTestSubmission = (existingTest, incomingTest) => {
    const qLen = Array.isArray(existingTest.questions) ? existingTest.questions.length : Number(existingTest.total || 0);
    return {
      ...existingTest,
      answers: Array.isArray(incomingTest.answers) ? incomingTest.answers.slice(0, Math.max(qLen, incomingTest.answers.length)) : (existingTest.answers || []),
      score: typeof incomingTest.score === 'number' ? incomingTest.score : (existingTest.score || 0),
      total: typeof incomingTest.total === 'number' ? incomingTest.total : qLen,
      completed: Boolean(incomingTest.completed),
      completedAt: incomingTest.completed ? String(incomingTest.completedAt || new Date().toISOString()) : ''
    };
  };

  if (body && body.assignedTest && typeof body.assignedTest === 'object' && skills.assignedTest && typeof skills.assignedTest === 'object') {
    const existingId = skills.assignedTest.id ? String(skills.assignedTest.id) : '';
    const incomingId = body.assignedTest.id ? String(body.assignedTest.id) : '';
    if (!existingId || !incomingId || existingId === incomingId) {
      skills.assignedTest = applyAssignedTestSubmission(skills.assignedTest, body.assignedTest);
    }
  }

  if (Array.isArray(body && body.assignedTests) && Array.isArray(skills.assignedTests)) {
    const testMap = new Map();
    for (const item of body.assignedTests) {
      if (item && item.id) testMap.set(String(item.id), item);
    }
    skills.assignedTests = skills.assignedTests.map(t => {
      if (t && t.id && testMap.has(String(t.id))) {
        return applyAssignedTestSubmission(t, testMap.get(String(t.id)));
      }
      return t;
    });
  }

  skills._updatedAt = Date.now();
  const nowIso = new Date().toISOString();

  await env.DB.prepare(
    'UPDATE students SET skills_json = ?, updated_at = ? WHERE id = ? AND school_id = ?'
  ).bind(JSON.stringify(skills), nowIso, row.id, row.school_id).run();

  const updated = await env.DB.prepare(
    'SELECT * FROM students WHERE id = ? AND school_id = ?'
  ).bind(row.id, row.school_id).first();

  return jsonResponse({
    ok: true,
    student: updated ? sanitizeStudentForPortal(updated) : sanitizeStudentForPortal({ ...row, skills_json: JSON.stringify(skills) })
  }, 200, request, env);
}
