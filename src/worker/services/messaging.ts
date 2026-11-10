import { newId, type Env } from '../core';

export const MESSAGE_TTL_MS = 24 * 3_600_000;

export const expiresFor = (now: Date) => new Date(now.getTime() + MESSAGE_TTL_MS).toISOString();

/** One private conversation per (owner, helper). Created on demand. */
export async function ensureConversation(db: D1Database, owner: string, helperId: string, nowIso: string): Promise<string> {
  const ex = await db.prepare('SELECT id FROM conversations WHERE owner_id = ? AND helper_id = ?').bind(owner, helperId).first<{ id: string }>();
  if (ex) return ex.id;
  const id = newId();
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO conversations (id, owner_id, helper_id, created_at) VALUES (?,?,?,?)').bind(id, owner, helperId, nowIso),
  ]);
  const row = (await db.prepare('SELECT id FROM conversations WHERE owner_id = ? AND helper_id = ?').bind(owner, helperId).first<{ id: string }>())!;
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO conversation_participants (conversation_id, participant_type, participant_id) VALUES (?, 'contractor', ?)").bind(row.id, owner),
    db.prepare("INSERT OR IGNORE INTO conversation_participants (conversation_id, participant_type, participant_id) VALUES (?, 'helper', ?)").bind(row.id, helperId),
  ]);
  return row.id;
}

export const visibleMessagesSql =
  `SELECT m.id, m.sender_type, m.body, m.original_language, m.delivery_status, m.bulk_batch_id IS NOT NULL AS is_bulk, m.created_at, m.expires_at
     FROM messages m WHERE m.conversation_id = ? AND m.owner_id = ? AND m.deleted_at IS NULL AND m.expiration_status = 'active' AND m.expires_at > ? ORDER BY m.created_at, m.id`;

/** Backend-controlled expiry: body is wiped (tombstone), attachments deleted from R2, translations removed. Idempotent. */
export async function expireMessages(env: Env, now: Date) {
  const n = now.toISOString(); const db = env.DB;
  const atts = (await db.prepare('SELECT id, storage_key FROM message_attachments WHERE deleted_at IS NULL AND expires_at <= ?').bind(n).all<{ id: string; storage_key: string }>()).results;
  let attFailed = 0;
  for (const a of atts) {
    try { if (env.ATTACHMENTS) await env.ATTACHMENTS.delete(a.storage_key); await db.prepare('UPDATE message_attachments SET deleted_at = ? WHERE id = ?').bind(n, a.id).run(); }
    catch { attFailed++; }
  }
  const tr = await db.prepare("DELETE FROM message_translations WHERE message_id IN (SELECT id FROM messages WHERE expiration_status = 'active' AND expires_at <= ?)").bind(n).run();
  const r = await db.prepare("UPDATE messages SET body = NULL, deleted_at = ?, expiration_status = 'deleted' WHERE expiration_status = 'active' AND expires_at <= ?").bind(n, n).run();
  return { messages_expired: r.meta.changes ?? 0, translations_removed: tr.meta.changes ?? 0, attachments_deleted: atts.length - attFailed, attachments_failed: attFailed };
}

export async function runMaintenance(env: Env, now: Date) {
  const db = env.DB; const id = newId(); const started = now.toISOString();
  await db.prepare('INSERT INTO job_runs (id, job, started_at) VALUES (?,?,?)').bind(id, 'maintenance', started).run();
  try {
    const exp = await expireMessages(env, now);
    const rl = await db.prepare('DELETE FROM rate_limits WHERE (window_start < ? AND window_start > 10000000) OR window_start < ?').bind(Math.floor(now.getTime() / 60000) - 2880, Math.floor(now.getTime() / 3_600_000) - 48).run().catch(() => null);
    const se = await db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(new Date(now.getTime() - 7 * 86_400_000).toISOString()).run();
    const et = await db.prepare('DELETE FROM email_tokens WHERE expires_at < ?').bind(started).run();
    const details = { ...exp, sessions_purged: se.meta.changes, email_tokens_purged: et.meta.changes, rate_limits_purged: rl?.meta.changes ?? 0 };
    await db.prepare('UPDATE job_runs SET finished_at = ?, ok = 1, details = ? WHERE id = ?').bind(new Date().toISOString(), JSON.stringify(details), id).run();
    return details;
  } catch (e) {
    await db.prepare('UPDATE job_runs SET finished_at = ?, ok = 0, details = ? WHERE id = ?').bind(new Date().toISOString(), String((e as Error).message), id).run();
    throw e;
  }
}
