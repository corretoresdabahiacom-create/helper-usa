export class ApiError extends Error {
  constructor(public status: number, public code: string, public data: any) { super(code); }
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method, credentials: 'same-origin',
    headers: { 'x-hc-csrf': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ct = res.headers.get('content-type') ?? '';
  const data: any = ct.includes('json') ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('hc:unauth'));
    throw new ApiError(res.status, data?.error ?? 'error', data);
  }
  return data as T;
}
export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b: unknown = {}) => api<T>('POST', p, b);
export const put = <T = any>(p: string, b: unknown) => api<T>('PUT', p, b);
export const patch = <T = any>(p: string, b: unknown) => api<T>('PATCH', p, b);
export const del = <T = any>(p: string, b?: unknown) => api<T>('DELETE', p, b);

/** Authenticated file download (CSV/PDF/TXT) via the same CSRF-safe fetch. */
export async function download(path: string, filename: string) {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin', headers: { 'x-hc-csrf': '1' } });
  if (!res.ok) throw new ApiError(res.status, 'download_failed', null);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
