import { Hono } from 'hono';
import { z } from 'zod';
import { audit, HttpError, iso, lang3, newId, nowIso, notFound, parseBody, rateLimit, uid, type Ctx, type Env, type Vars } from '../core';
import { requireAuth } from './auth';
import { ownedHelper } from './helpers';
import { ensureConversation, expiresFor, visibleMessagesSql } from '../services/messaging';
import { textToPdf } from '../services/pdf';

export const messageRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();
messageRoutes.use('*', requireAuth);

const bodySchema = z.object({ body: z.string().trim().min(1).max(2000), language: lang3.optional() });
const maxBulk = (env: Env) => Math.min(Number(env.MAX_BULK_RECIPIENTS ?? 50) || 50, 200);

function canMessage(h: { opted_out: number; messaging_consent: string; archived_at: string | null }): string | null {
  if (h.opted_out) return 'opted_out';
  if (h.messaging_consent === 'revoked') return 'consent_revoked';
  return null;
}

messageRoutes.get('/conversations', async (c) => {
  const now = nowIso(c as any);
  const rows = await c.env.DB.prepare(
    `SELECT cv.id, cv.helper_id, h.full_name AS helper_name, h.opted_out, h.messaging_consent, cv.last_message_at,
            (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = cv.id AND m.owner_id = cv.owner_id AND m.deleted_at IS NULL AND m.expires_at > ?) AS active_messages,
            (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = cv.id AND m.owner_id = cv.owner_id AND m.sender_type = 'helper' AND m.delivery_status <> 'read' AND m.deleted_at IS NULL AND m.expires_at > ?) AS unread
       FROM conversations cv JOIN helpers h ON h.id = cv.helper_id AND h.owner_id = cv.owner_id
      WHERE cv.owner_id = ? ORDER BY cv.last_message_at DESC NULLS LAST LIMIT 200`).bind(now, now, uid(c as any)).all();
  return c.json({ conversations: rows.results, retention_hours: 24 });
});

messageRoutes.get('/with/:helperId', async (c) => {
  const h = await ownedHelper(c as any, c.req.param('helperId')); const owner = uid(c as any); const now = nowIso(c as any);
  const convId = await ensureConversation(c.env.DB, owner, h.id, now);
  const msgs = (await c.env.DB.prepare(visibleMessagesSql).bind(convId, owner, now).all()).results;
  await c.env.DB.prepare("UPDATE messages SET delivery_status = 'read' WHERE conversation_id = ? AND owner_id = ? AND sender_type = 'helper' AND delivery_status <> 'read' AND expires_at > ?").bind(convId, owner, now).run();
  const atts = (await c.env.DB.prepare('SELECT a.id, a.message_id, a.mime, a.size_bytes, a.expires_at FROM message_attachments a JOIN messages m ON m.id = a.message_id WHERE m.conversation_id = ? AND a.owner_id = ? AND a.deleted_at IS NULL AND a.expires_at > ?').bind(convId, owner, now).all()).results;
  return c.json({ conversation_id: convId, helper: { id: h.id, full_name: h.full_name, opted_out: !!h.opted_out, messaging_consent: h.messaging_consent }, messages: msgs, attachments: atts, retention_hours: 24 });
});

async function sendOne(c: Ctx, helper: any, body: string, lang: string, batch: string | null) {
  const owner = uid(c); const now = c.get('now'); const n = iso(now); const db = c.env.DB;
  const convId = await ensureConversation(db, owner, helper.id, n); const id = newId();
  await db.batch([
    db.prepare('INSERT INTO messages (id, conversation_id, owner_id, sender_type, body, original_language, bulk_batch_id, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(id, convId, owner, 'contractor', body, lang, batch, n, expiresFor(now)),
    db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ? AND owner_id = ?').bind(n, convId, owner),
    db.prepare('UPDATE helpers SET last_contacted_at = ? WHERE id = ? AND owner_id = ?').bind(n, helper.id, owner),
  ]);
  return { id, conversation_id: convId, expires_at: expiresFor(now) };
}

messageRoutes.post('/with/:helperId', async (c) => {
  const b = await parseBody(c as any, bodySchema); const h = await ownedHelper(c as any, c.req.param('helperId'));
  await rateLimit(c as any, 'msg_send', uid(c as any), 120, 3600);
  const block = canMessage(h as any); if (block) throw new HttpError(409, block);
  const r = await sendOne(c as any, h, b.body, b.language ?? c.get('user').profile.language, null);
  return c.json(r, 201);
});

/** Bulk send = N independent private conversations, never a group. Only helpers with granted consent and not opted out. */
messageRoutes.post('/bulk', async (c) => {
  const b = await parseBody(c as any, bodySchema.extend({ helper_ids: z.array(z.string().uuid()).min(1).max(200) }));
  const ids = [...new Set(b.helper_ids)];
  if (ids.length > maxBulk(c.env)) throw new HttpError(400, 'too_many_recipients', { max: maxBulk(c.env) });
  await rateLimit(c as any, 'msg_bulk', uid(c as any), 10, 3600);
  const batch = newId(); const sent: string[] = []; const skipped: { helper_id: string; reason: string }[] = [];
  for (const hid of ids) {
    const h = await c.env.DB.prepare('SELECT * FROM helpers WHERE id = ? AND owner_id = ?').bind(hid, uid(c as any)).first<any>();
    if (!h) { skipped.push({ helper_id: hid, reason: 'not_found' }); continue; }
    if (h.archived_at) { skipped.push({ helper_id: hid, reason: 'archived' }); continue; }
    if (h.opted_out) { skipped.push({ helper_id: hid, reason: 'opted_out' }); continue; }
    if (h.messaging_consent !== 'granted') { skipped.push({ helper_id: hid, reason: 'no_consent' }); continue; }
    await sendOne(c as any, h, b.body, b.language ?? c.get('user').profile.language, batch); sent.push(hid);
  }
  await audit(c as any, 'data', 'bulk_message_sent', 'messages', batch, { sent: sent.length, skipped: skipped.length }).run();
  return c.json({ batch_id: batch, sent_count: sent.length, skipped }, 201);
});

messageRoutes.post('/:id/translate', async (c) => {
  const { lang } = await parseBody(c as any, z.object({ lang: lang3 }));
  const m = await c.env.DB.prepare('SELECT id, body, original_language FROM messages WHERE id = ? AND owner_id = ? AND deleted_at IS NULL AND expires_at > ?').bind(c.req.param('id'), uid(c as any), nowIso(c as any)).first<any>();
  if (!m || !m.body) throw notFound();
  if (m.original_language === lang) return c.json({ text: m.body, lang });
  const cached = await c.env.DB.prepare('SELECT text FROM message_translations WHERE message_id = ? AND lang = ?').bind(m.id, lang).first<{ text: string }>();
  if (cached) return c.json({ text: cached.text, lang, cached: true });
  if (!c.env.AI) throw new HttpError(503, 'translation_unavailable'); // honest: no fake translation
  try {
    const r = (await c.env.AI.run('@cf/meta/m2m100-1.2b', { text: m.body, source_lang: m.original_language, target_lang: lang })) as { translated_text?: string };
    if (!r.translated_text) throw new Error('empty');
    await c.env.DB.prepare('INSERT OR REPLACE INTO message_translations (message_id, lang, text, created_at) VALUES (?,?,?,?)').bind(m.id, lang, r.translated_text, nowIso(c as any)).run();
    return c.json({ text: r.translated_text, lang, machine_translated: true });
  } catch { throw new HttpError(503, 'translation_unavailable'); }
});

export async function exportLines(db: D1Database, owner: string, convId: string, now: string, who: string) {
  const msgs = (await db.prepare(visibleMessagesSql).bind(convId, owner, now).all<any>()).results;
  const lines = [`Helper Connect - conversation export (${who})`, `Exported: ${now}`, 'Only messages still within the 24-hour retention window are included.', ''];
  for (const m of msgs) lines.push(`[${m.created_at}] ${m.sender_type === 'contractor' ? 'Contractor' : 'Helper'}: ${m.body}`);
  if (!msgs.length) lines.push('(no active messages)');
  return { lines, count: msgs.length };
}

messageRoutes.get('/with/:helperId/export', async (c) => {
  const format = c.req.query('format') === 'pdf' ? 'pdf' : 'txt';
  const h = await ownedHelper(c as any, c.req.param('helperId')); const owner = uid(c as any); const now = nowIso(c as any);
  const convId = await ensureConversation(c.env.DB, owner, h.id, now);
  const { lines, count } = await exportLines(c.env.DB, owner, convId, now, h.full_name);
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO message_exports (id, owner_id, conversation_id, format, requested_by, message_count, created_at) VALUES (?,?,?,?,?,?,?)').bind(newId(), owner, convId, format, 'contractor', count, now),
    audit(c as any, 'data', 'conversation_exported', 'conversations', convId, { format, count }),
  ]);
  const name = `conversation-${now.slice(0, 10)}.${format}`;
  const headers = { 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store' };
  if (format === 'pdf') return new Response(textToPdf('Helper Connect - Conversation', lines).buffer as ArrayBuffer, { headers: { ...headers, 'content-type': 'application/pdf' } });
  return new Response(lines.join('\n'), { headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' } });
});

// ── attachments (feature-flagged: needs an R2 bucket binding, which is not available without a payment method) ──
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
messageRoutes.post('/with/:helperId/attachments', async (c) => {
  if (!c.env.ATTACHMENTS) throw new HttpError(501, 'attachments_disabled');
  const h = await ownedHelper(c as any, c.req.param('helperId')); const block = canMessage(h as any); if (block) throw new HttpError(409, block);
  const form = await c.req.formData(); const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'validation_error', { issues: [{ path: 'file', code: 'required' }] });
  if (!ALLOWED_MIME.includes(file.type)) throw new HttpError(415, 'unsupported_media_type');
  if (file.size > 5 * 1024 * 1024) throw new HttpError(413, 'file_too_large');
  const sent = await sendOne(c as any, h, String(form.get('body') ?? '').slice(0, 2000) || '(attachment)', c.get('user').profile.language, null);
  const key = `${uid(c as any)}/${sent.id}/${newId()}`;
  await c.env.ATTACHMENTS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  const aid = newId();
  await c.env.DB.prepare('INSERT INTO message_attachments (id, message_id, owner_id, storage_key, mime, size_bytes, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?)').bind(aid, sent.id, uid(c as any), key, file.type, file.size, nowIso(c as any), sent.expires_at).run();
  return c.json({ id: aid, message_id: sent.id }, 201);
});
messageRoutes.get('/attachments/:id', async (c) => {
  if (!c.env.ATTACHMENTS) throw new HttpError(501, 'attachments_disabled');
  const a = await c.env.DB.prepare('SELECT * FROM message_attachments WHERE id = ? AND owner_id = ? AND deleted_at IS NULL AND expires_at > ?').bind(c.req.param('id'), uid(c as any), nowIso(c as any)).first<any>();
  if (!a) throw notFound();
  const o = await c.env.ATTACHMENTS.get(a.storage_key); if (!o) throw notFound();
  return new Response(o.body, { headers: { 'content-type': a.mime, 'content-disposition': 'attachment', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
});

messageRoutes.post('/abuse-report', async (c) => {
  const b = await parseBody(c as any, z.object({ helper_id: z.string().uuid().optional(), reason: z.string().trim().min(5).max(1000) }));
  if (b.helper_id) await ownedHelper(c as any, b.helper_id);
  await c.env.DB.prepare('INSERT INTO abuse_reports (id, owner_id, helper_id, reason, created_at) VALUES (?,?,?,?,?)').bind(newId(), uid(c as any), b.helper_id ?? null, b.reason, nowIso(c as any)).run();
  return c.json({ ok: true }, 201);
});
