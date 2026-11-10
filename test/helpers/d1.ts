import { createRequire } from 'node:module';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (p: string) => any };
type DatabaseSync = any;
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Minimal D1Database shim over node:sqlite (same SQLite engine family as D1). batch() is atomic (rolls back on any failure), like D1. */
class Stmt {
  args: unknown[] = [];
  constructor(private db: DatabaseSync, readonly sql: string) {}
  bind(...a: unknown[]) { const s = new Stmt(this.db, this.sql); s.args = a.map((v) => (v === undefined ? null : v)); return s; }
  private rows() { return this.db.prepare(this.sql).all(...(this.args as any[])) as any[]; }
  async first<T = any>(col?: string): Promise<T | null> { const r = this.rows()[0]; if (!r) return null; return (col ? r[col] : { ...r }) as T; }
  async all<T = any>() { return { results: this.rows().map((r) => ({ ...r })) as T[], success: true, meta: {} }; }
  async run() {
    const st = this.db.prepare(this.sql);
    if (/\bRETURNING\b/i.test(this.sql)) { st.all(...(this.args as any[])); return { success: true, meta: { changes: 1 }, results: [] }; }
    const r = st.run(...(this.args as any[]));
    return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) }, results: [] };
  }
  _exec() { return this.run(); }
}
export class TestD1 {
  db: DatabaseSync;
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec('PRAGMA foreign_keys = ON');
    const dir = join(process.cwd(), 'migrations');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) this.db.exec(readFileSync(join(dir, f), 'utf8'));
  }
  prepare(sql: string) { return new Stmt(this.db, sql) as unknown as D1PreparedStatement; }
  async batch(stmts: D1PreparedStatement[]) {
    this.db.exec('BEGIN');
    try { const out = []; for (const s of stmts as unknown as Stmt[]) out.push(await s.run()); this.db.exec('COMMIT'); return out as any; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  async exec(sql: string) { this.db.exec(sql); return { count: 1, duration: 0 } as any; }
}
