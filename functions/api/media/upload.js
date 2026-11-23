import { handleOptions, jsonResponse } from '../_lib/cors.js';
import { requireTutorAuth } from '../_lib/auth.js';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

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

function isAllowedMime(mime) {
  const clean = String(mime || '').split(';')[0].trim().toLowerCase();
  if (clean.startsWith('image/') || clean.startsWith('audio/') || clean === 'application/pdf') {
    return clean;
  }
  return '';
}

function base64ToUint8Array(b64) {
  const clean = String(b64 || '').replace(/^data:[^,]+,/i, '').replace(/\s+/g, '');
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function onRequestOptions(context) {
  return handleOptions(context, 'POST, OPTIONS');
}

export async function onRequestPost(context) {
  const auth = await requireTutorAuth(context);
  if (auth.errorResponse) return auth.errorResponse;
  const { request, env } = context;

  if (!env.MEDIA_BUCKET) {
    return jsonResponse({ error: 'R2 media bucket is not configured' }, 500, request, env);
  }

  let bytes = null;
  let contentType = '';
  let originalName = 'upload';
  let studentId = '';

  const reqCt = String(request.headers.get('Content-Type') || '').toLowerCase();
  if (reqCt.includes('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('file');
    studentId = String(form.get('studentId') || '').trim();
    if (!file || typeof file.arrayBuffer !== 'function') {
      return jsonResponse({ error: 'Missing file in form data' }, 400, request, env);
    }
    originalName = String(file.name || 'upload').slice(0, 180);
    contentType = isAllowedMime(file.type || '');
    bytes = new Uint8Array(await file.arrayBuffer());
  } else {
    let body;
    try {
      body = await request.json();
    } catch (_) {
      return jsonResponse({ error: 'Invalid JSON or multipart upload payload' }, 400, request, env);
    }
    studentId = String((body && body.studentId) || '').trim();
    originalName = String((body && body.originalName) || 'upload').slice(0, 180);
    const dataUrl = String((body && body.dataUrl) || '');
    const dataUrlMime = dataUrl.startsWith('data:') ? dataUrl.slice(5).split(/[;,]/)[0] : '';
    contentType = isAllowedMime((body && body.contentType) || dataUrlMime);
    const rawB64 = String((body && body.base64) || dataUrl || '');
    if (!rawB64) {
      return jsonResponse({ error: 'Missing base64 file payload' }, 400, request, env);
    }
    bytes = base64ToUint8Array(rawB64);
  }

  if (!contentType) {
    return jsonResponse({ error: 'Unsupported file type. Allowed: images, audio, and PDF.' }, 400, request, env);
  }
  if (!bytes || bytes.byteLength === 0) {
    return jsonResponse({ error: 'Empty file payload' }, 400, request, env);
  }
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return jsonResponse({ error: 'File exceeds 25 MB maximum size limit' }, 413, request, env);
  }

  if (studentId) {
    const st = await env.DB.prepare('SELECT id, school_id FROM students WHERE id = ?').bind(studentId).first();
    if (!st || st.school_id !== auth.user.school_id) {
      return jsonResponse({ error: 'Student not found in your workspace' }, 403, request, env);
    }
  }

  const ext = EXT_FROM_MIME[contentType] || 'bin';
  const safeSchool = String(auth.user.school_id || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  const mediaKey = `schools/${safeSchool}/${crypto.randomUUID()}.${ext}`;
  const nowIso = new Date().toISOString();

  await env.MEDIA_BUCKET.put(mediaKey, bytes, {
    httpMetadata: { contentType },
    customMetadata: {
      schoolId: auth.user.school_id,
      studentId: studentId || '',
      uploadedBy: auth.user.id
    }
  });

  await env.DB.prepare(
    `INSERT INTO media_objects (key, school_id, student_id, uploaded_by, content_type, byte_size, original_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    mediaKey,
    auth.user.school_id,
    studentId,
    auth.user.id,
    contentType,
    bytes.byteLength,
    originalName,
    nowIso
  ).run();

  return jsonResponse({
    ok: true,
    mediaKey,
    contentType,
    byteSize: bytes.byteLength,
    url: `/api/media/${mediaKey}`
  }, 201, request, env);
}
