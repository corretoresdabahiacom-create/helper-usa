import { describe, expect, it } from 'vitest';
import { makeEnv, signup } from './helpers/app';

describe('smoke', () => {
  it('registers, logs in, reads profile', async () => {
    const env = makeEnv();
    const { c } = await signup(env);
    const me = await c.call('GET', '/api/auth/me');
    expect(me.status).toBe(200);
    const meta = await c.call('GET', '/api/meta');
    expect(meta.status).toBe(200);
    expect(meta.json.states.length).toBe(51);
  });
});
