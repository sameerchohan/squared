import { ApiError } from "./errors";

// Sliding-window rate limiter for abuse-prone endpoints (credential
// guessing, account spam). In-memory, so limits are per-instance: good
// protection for a single container, and the natural upgrade path at scale
// is Redis or WAF rules in front of the load balancer.

const buckets = new Map<string, number[]>();
const MAX_TRACKED_KEYS = 10_000;

export function enforceRateLimit(
  key: string,
  limit: number,
  windowMs: number
): void {
  const now = Date.now();
  const cutoff = now - windowMs;

  // Cheap global cleanup so abandoned keys can't grow memory unboundedly.
  if (buckets.size > MAX_TRACKED_KEYS) {
    for (const [k, hits] of buckets) {
      if (hits.every((t) => t < cutoff)) buckets.delete(k);
    }
  }

  const hits = (buckets.get(key) ?? []).filter((t) => t >= cutoff);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    throw new ApiError(429, "Too many attempts — try again shortly");
  }
  hits.push(now);
  buckets.set(key, hits);
}

/**
 * Best-effort client identity for rate limiting. x-forwarded-for is set by
 * the load balancer in production; locally everything shares one bucket.
 */
export function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local"
  );
}
