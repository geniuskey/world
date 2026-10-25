export class ApiFailure extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}
const responses = new Map<string, { etag: string; body: unknown }>();
export async function api<T>(
  path: string,
  options: RequestInit & { fresh?: boolean } = {},
): Promise<T> {
  const { fresh, ...init } = options;
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  if (fresh) headers.set('Cache-Control', 'no-cache');
  const cached = responses.get(path);
  if (cached?.etag && !fresh && !init.method) headers.set('If-None-Match', cached.etag);
  const response = await fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin' });
  if (response.status === 304 && cached) return cached.body as T;
  const body = (await response.json()) as { error?: { code?: string } };
  if (!response.ok) throw new ApiFailure(body.error?.code || 'INTERNAL_ERROR', response.status);
  const etag = response.headers.get('etag');
  if (etag) responses.set(path, { etag, body });
  return body as T;
}
export const post = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export async function mutate<T>(path: string, payload: Record<string, unknown>) {
  const signature = `world:pending:${path}:${JSON.stringify(payload)}`;
  const key = sessionStorage.getItem(signature) || crypto.randomUUID();
  sessionStorage.setItem(signature, key);
  try {
    const result = await post<T>(path, { ...payload, idempotency_key: key });
    sessionStorage.removeItem(signature);
    return result;
  } catch (error) {
    if (error instanceof ApiFailure && error.status < 500) sessionStorage.removeItem(signature);
    throw error;
  }
}
