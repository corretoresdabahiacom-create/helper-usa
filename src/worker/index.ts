import { Hono } from 'hono';
import { csrfGuard, getNow, HttpError, securityHeaders, type Env, type Vars } from './core';
import { authRoutes } from './routes/auth';
import { accountRoutes, metaRoutes } from './routes/account';
import { helperRoutes } from './routes/helpers';
import { workRoutes } from './routes/work';
import { financeRoutes } from './routes/finance';
import { reportRoutes } from './routes/reports';
import { messageRoutes } from './routes/messages';
import { portalRoutes } from './routes/portal';
import { adminRoutes } from './routes/admin';
import { runMaintenance } from './services/messaging';

export const app = new Hono<{ Bindings: Env; Variables: Vars }>();

app.use('/api/*', async (c, next) => { c.set('now', getNow(c.env)); await next(); });
app.use('/api/*', securityHeaders);
app.use('/api/*', csrfGuard);

app.get('/api/health', (c) => c.json({ ok: true, time: c.get('now').toISOString() }));
app.route('/api/auth', authRoutes);
app.route('/api/portal', portalRoutes);
app.route('/api', metaRoutes);
app.route('/api/helpers', helperRoutes);
app.route('/api/work', workRoutes);
app.route('/api/finance', financeRoutes);
app.route('/api/reports', reportRoutes);
app.route('/api/messages', messageRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api', accountRoutes); // MUST stay last: its auth middleware applies to everything registered after it

app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.code, ...(err.extra ?? {}) }, err.status as 400);
  console.error('unhandled', err instanceof Error ? err.message : String(err)); // never log bodies/secrets
  return c.json({ error: 'internal_error' }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_ev: ScheduledController, env: Env, ctx: ExecutionContext) { ctx.waitUntil(runMaintenance(env, getNow(env))); },
} satisfies ExportedHandler<Env>;
