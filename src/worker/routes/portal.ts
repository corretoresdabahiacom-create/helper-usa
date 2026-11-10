import { Hono } from 'hono';
import { z } from 'zod';
import { type Ctx, clientIp, HttpError, iso, lang3, newId, parseBody, rateLimit, sha256Hex, type Env, type Vars } from '../core';
import { ensureConversation, expiresFor, visibleMessagesSql } from '../services/messaging';
import { exportLines } from './messages';
import { textToPdf } from '../services/pdf';

/** Helper portal: no accounts. Access = hashed, expiring, revocable invitation token; sees only their own private thread with ONE contractor. */
export const portalRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

async function resolve(c: Ctx) {
  const token = c.req.param('token') as string;
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) throw new HttpError(404, 'not_found');
  await rateLimit(c, 'portal_ip', clientIp(c), 120, 600);
  const now = iso(c.get('now'));
  const inv = await c.env.DB.prepare(
    `SELECT i.id, i.owner_id, i.helper_id, h.full_name, h.language, h.opted_out, h.messaging_consent, p.full_name AS contractor_name, p.business_name
       FROM invitations i JOIN helpers h ON h.id = i.helper_id AND h.owner_id = i.owner_id JOIN contractor_profiles p ON p.user_id = i.owner_id
      WHERE i.token_hash = ? AND i.revoked_at IS NULL AND i.expires_at > ?`).bind(await sha256Hex(token), now).first<any>();
  if (!inv) throw new HttpError(404, 'not_found'); // same response for unknown/expired/revoked
  return { inv, now };
}

portalRoutes.get('/:token', async (c) => {
  const { inv, now } = await resolve(c);
  await c.env.DB.prepare('UPDATE invitations SET accepted_at = COALESCE(accepted_at, ?) WHERE id = ?').bind(now, inv.id).run();
  const conv = await ensureConversation(c.env.DB, inv.owner_id, inv.helper_id, now);
  const msgs = (await c.env.DB.prepare(visibleMessagesSql).bind(conv, inv.owner_id, now).all()).results;
  await c.env.DB.prepare("UPDATE messages SET delivery_status = 'read' WHERE conversation_id = ? AND owner_id = ? AND sender_type = 'contractor' AND delivery_status <> 'read' AND expires_at > ?").bind(conv, inv.owner_id, now).run();
  return c.json({ helper_name: inv.full_name, language: inv.language, contractor: inv.business_name ?? inv.contractor_name, opted_out: !!inv.opted_out, messages: msgs, retention_hours: 24 });
});

portalRoutes.post('/:token/messages', async (c) => {
  const { inv, now } = await resolve(c);
  const b = await parseBody(c as any, z.object({ body: z.string().trim().min(1).max(2000), language: lang3.optional() }));
  await rateLimit(c as any, 'portal_send', inv.id, 60, 3600);
  if (inv.opted_out) throw new HttpError(409, 'opted_out');
  const conv = await ensureConversation(c.env.DB, inv.owner_id, inv.helper_id, now); const nd = c.get('now');
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO messages (id, conversation_id, owner_id, sender_type, body, original_language, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?)').bind(newId(), conv, inv.owner_id, 'helper', b.body, b.language ?? inv.language, now, expiresFor(nd)),
    c.env.DB.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ? AND owner_id = ?').bind(now, conv, inv.owner_id),
  ]);
  return c.json({ ok: true }, 201);
});

/** Helper opts out: no more bulk or individual messages from the contractor. */
portalRoutes.post('/:token/opt-out', async (c) => {
  const { inv, now } = await resolve(c);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE helpers SET opted_out = 1, messaging_consent = 'revoked', updated_at = ? WHERE id = ? AND owner_id = ?").bind(now, inv.helper_id, inv.owner_id),
    c.env.DB.prepare("INSERT INTO consent_records (id, owner_id, helper_id, kind, status, source, created_at) VALUES (?,?,?,'messaging','revoked','helper_portal',?)").bind(newId(), inv.owner_id, inv.helper_id, now),
  ]);
  return c.json({ ok: true });
});

portalRoutes.get('/:token/export', async (c) => {
  const { inv, now } = await resolve(c); const format = c.req.query('format') === 'pdf' ? 'pdf' : 'txt';
  const conv = await ensureConversation(c.env.DB, inv.owner_id, inv.helper_id, now);
  const { lines, count } = await exportLines(c.env.DB, inv.owner_id, conv, now, inv.full_name);
  await c.env.DB.prepare('INSERT INTO message_exports (id, owner_id, conversation_id, format, requested_by, message_count, created_at) VALUES (?,?,?,?,?,?,?)').bind(newId(), inv.owner_id, conv, format, 'helper', count, now).run();
  const h = { 'content-disposition': `attachment; filename="conversation.${format}"`, 'cache-control': 'no-store' };
  return format === 'pdf' ? new Response(textToPdf('Helper Connect - Conversation', lines).buffer as ArrayBuffer, { headers: { ...h, 'content-type': 'application/pdf' } }) : new Response(lines.join('\n'), { headers: { ...h, 'content-type': 'text/plain; charset=utf-8' } });
});
