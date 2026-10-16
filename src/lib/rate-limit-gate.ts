

/** Gate key for clients built without a user, such as tokenless public sources. */
export const TOKENLESS_RATE_LIMIT_KEY = "anonymous";

/** Reset time (epoch ms) per key, for the keys that are currently limited. */
const resetTimesByKey = new Map<string, number>();

/**
 * The gate key for a user. Clients created without a userId share one key, so
 * a tokenless source that runs into the anonymous limit still pauses.
 */
export function rateLimitGateKey(userId?: string | null): string {
  const trimmed = typeof userId === "string" ? userId.trim() : "";
  return trimmed === "" ? TOKENLESS_RATE_LIMIT_KEY : trimmed;
}

/**
 * Record that this key is rate limited until `resetAt`. A reset that is
 * further out than the one already recorded wins: two endpoints can report
 * different windows and the work has to wait for the later one.
 */
export function markRateLimited(key: string, resetAt: Date | number): void {
  const resetMs = resetAt instanceof Date ? resetAt.getTime() : resetAt;
  if (!Number.isFinite(resetMs)) {
    return;
  }

  const current = resetTimesByKey.get(key);
  if (current !== undefined && current >= resetMs) {
    return;
  }

  resetTimesByKey.set(key, resetMs);
}

/**
 * The reset time while the key is still rate limited, otherwise null. A reset
 * that has passed is forgotten on read, so the gate opens on its own.
 */
export function rateLimitedUntil(key: string, now: Date = new Date()): Date | null {
  const resetMs = resetTimesByKey.get(key);
  if (resetMs === undefined) {
    return null;
  }

  if (resetMs <= now.getTime()) {
    resetTimesByKey.delete(key);
    return null;
  }

  return new Date(resetMs);
}

/** Open the gate for one key, for example after a request came back with budget left. */
export function clearRateLimit(key: string): void {
  resetTimesByKey.delete(key);
}

/** Open the gate for every key. Used by tests and by a full restart of the scheduler. */
export function clearAllRateLimits(): void {
  resetTimesByKey.clear();
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  const candidate = error as { status?: unknown; response?: { status?: unknown }; message?: unknown };
  const rawStatus = candidate.status ?? candidate.response?.status;
  const status = typeof rawStatus === "number" ? rawStatus : undefined;

  if (status === 429) {
    return true;
  }

  const message =
    typeof candidate.message === "string" ? candidate.message : String(error);
  const mentionsRateLimit = /rate limit/i.test(message);

  if (!mentionsRateLimit) {
    return false;
  }

  // Without one the error has been re-thrown along the way, and the message is
  // all that is left to go on.
  return status === undefined || status === 403;
}

export class RateLimitPausedError extends Error {
  readonly status = 403;
  readonly resetAt: Date;

  constructor(resetAt: Date, endpoint?: string) {
    super(
      `Source API rate limit exceeded; requests are paused until ${resetAt.toISOString()}` +
        (endpoint ? ` (not sent: ${endpoint})` : "")
    );
    this.name = "RateLimitPausedError";
    this.resetAt = resetAt;
  }
}

/**
 * Endpoints that never count against the limit and are needed to learn when
 * it opens again. Everything else is held while the gate is closed.
 */
