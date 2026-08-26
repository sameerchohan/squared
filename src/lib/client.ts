// Minimal fetch wrapper for the browser side: JSON in/out, throws the API's
// error message, and signals 401 distinctly so pages can redirect to /login.

export class UnauthorizedError extends Error {}

export async function api<T>(
  path: string,
  options?: { method?: string; body?: unknown }
): Promise<T> {
  const res = await fetch(path, {
    method: options?.method ?? "GET",
    headers: options?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 401) {
    throw new UnauthorizedError(data.error ?? "Not signed in");
  }
  if (!res.ok) {
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}
