import type { Client } from './app';
export const NOW = '2026-11-10T15:00:00Z'; // 2026-11-10 in America/Chicago

export async function firstCategory(c: Client) {
  const m = await c.call('GET', '/api/meta');
  return m.json.categories[0].id as string;
}
export async function makeHelper(c: Client, over: Record<string, unknown> = {}) {
  const cat = await firstCategory(c);
  const r = await c.call('POST', '/api/helpers', { full_name: 'Carlos Silva', state: 'TX', city: 'Austin', category_ids: [cat], function_title: 'Laborer', whatsapp: '(512) 555-0101', language: 'es', description: 'Reliable', messaging_consent: true, ...over });
  if (r.status !== 201) throw new Error(`helper create ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.id as string;
}
export async function makeAssignment(c: Client, helper_id: string, dates: string[], daily_rate = '150.00', over: Record<string, unknown> = {}) {
  const r = await c.call('POST', '/api/work/assignments', { helper_id, job_name: 'Framing', dates, daily_rate, ...over });
  if (r.status !== 201) throw new Error(`assignment ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.id as string;
}
export async function workdaysOf(c: Client, helper_id: string, from = '2026-01-01', to = '2026-12-31') {
  return (await c.call('GET', `/api/work/workdays?helper_id=${helper_id}&from=${from}&to=${to}`)).json.workdays as any[];
}
export async function complete(c: Client, id: string) {
  return c.call('PATCH', `/api/work/workdays/${id}`, { status: 'completed' });
}
