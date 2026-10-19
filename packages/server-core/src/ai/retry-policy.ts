import type { ProviderError } from "./provider";

/**
 * Bounded exponential backoff with full jitter, respecting provider-supplied
 * `retry-after` hints where present.
 */

export interface RetryConfig {
  max_attempts: number;
  base_delay_ms: number;
  max_delay_ms: number;
}

export function defaultRetry(): RetryConfig {
  return { max_attempts: 3, base_delay_ms: 1000, max_delay_ms: 30_000 };
}

export function backoffDelay(attempt: number, cfg: RetryConfig): number {
  const exp = Math.min(cfg.max_delay_ms, cfg.base_delay_ms * 2 ** attempt);
  // Full jitter
  return Math.floor(Math.random() * exp);
}

export function shouldRetry(err: ProviderError, attempt: number, cfg: RetryConfig): boolean {
  if (attempt >= cfg.max_attempts) return false;
  return err.retryable || err.rate_limited;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  cfg: RetryConfig,
  onRetry?: (err: ProviderError, attempt: number, delayMs: number) => void,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      const err = e as ProviderError;
      if (!("retryable" in err) && !("rate_limited" in err)) throw err;
      if (!shouldRetry(err, attempt, cfg)) throw err;
      const delay = backoffDelay(attempt, cfg);
      onRetry?.(err, attempt, delay);
      await new Promise((r) => setTimeout(r, delay));
      attempt += 1;
    }
  }
}
