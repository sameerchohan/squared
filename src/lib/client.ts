// Minimal fetch wrapper for the browser side: JSON in/out, throws the API's
// error message, and signals 401 distinctly so pages can redirect to /login.
// A FormData body is passed through untouched, so the browser can set its own
// multipart boundary; anything else is sent as JSON.

export class UnauthorizedError extends Error {}

export async function api<T>(
  path: string,
  options?: { method?: string; body?: unknown }
): Promise<T> {
  const sendingForm = options?.body instanceof FormData;
  const res = await fetch(path, {
    method: options?.method ?? "GET",
    headers:
      options?.body !== undefined && !sendingForm
        ? { "Content-Type": "application/json" }
        : undefined,
    body:
      options?.body === undefined
        ? undefined
        : sendingForm
          ? (options.body as FormData)
          : JSON.stringify(options.body),
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
