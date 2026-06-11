/**
 * Token-bucket rate limiter, one instance per domain.
 * Default: 1 request per 2 000 ms with ±500 ms jitter.
 * Callers await acquire() before every outbound request.
 */
export class RateLimiter {
  private readonly intervalMs: number;
  private readonly jitterMs: number;
  private lastAcquiredAt = 0;

  constructor(intervalMs = 2_000, jitterMs = 500) {
    this.intervalMs = intervalMs;
    this.jitterMs = jitterMs;
  }

  async acquire(): Promise<void> {
    const jitter = Math.random() * this.jitterMs;
    const waitMs = Math.max(
      0,
      this.lastAcquiredAt + this.intervalMs + jitter - Date.now(),
    );
    if (waitMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
    this.lastAcquiredAt = Date.now();
  }
}

/** Registry — one limiter per domain string. */
const registry = new Map<string, RateLimiter>();

export function getRateLimiter(
  domain: string,
  intervalMs?: number,
  jitterMs?: number,
): RateLimiter {
  let limiter = registry.get(domain);
  if (limiter === undefined) {
    limiter = new RateLimiter(intervalMs, jitterMs);
    registry.set(domain, limiter);
  }
  return limiter;
}
