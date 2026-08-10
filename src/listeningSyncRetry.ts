export const LISTENING_SYNC_RETRY_BASE_MS = 5_000;
export const LISTENING_SYNC_RETRY_MAX_MS = 5 * 60 * 1_000;

export type ListeningSyncFailureKind =
  | "authentication"
  | "retryable"
  | "permanent";

export class ListeningSyncRequestError extends Error {
  readonly code: string;

  constructor(
    readonly status: number,
    cause: unknown,
  ) {
    super(remoteErrorMessage(cause), { cause });
    this.name = "ListeningSyncRequestError";
    this.code = remoteErrorCode(cause);
  }
}

export function listeningSyncFailureKind(
  error: unknown,
): ListeningSyncFailureKind {
  if (error instanceof ListeningSyncRequestError) {
    if (error.status === 401) return "authentication";
    if (
      error.status === 0 ||
      error.status === 408 ||
      error.status === 429 ||
      error.status >= 500
    ) {
      return "retryable";
    }
    return "permanent";
  }

  const details = isRecord(error) ? error : {};
  const code = typeof details.code === "string" ? details.code : "";
  const message = remoteErrorMessage(error);
  if (
    /^08/.test(code) ||
    /^PGRST00[0-3]$/.test(code) ||
    /fetch failed|failed to fetch|network|offline|econn|enotfound|timed?\s*out/i.test(
      message,
    )
  ) {
    return "retryable";
  }
  return "permanent";
}

export function listeningSyncRetryDelay(
  attempt: number,
  random: () => number = Math.random,
): number {
  const normalizedAttempt =
    Number.isInteger(attempt) && attempt > 0 ? attempt : 0;
  const exponential = Math.min(
    LISTENING_SYNC_RETRY_MAX_MS,
    LISTENING_SYNC_RETRY_BASE_MS * 2 ** Math.min(normalizedAttempt, 16),
  );
  const jitter = 0.8 + clampUnitInterval(random()) * 0.4;
  return Math.min(
    LISTENING_SYNC_RETRY_MAX_MS,
    Math.max(1, Math.round(exponential * jitter)),
  );
}

function remoteErrorCode(error: unknown): string {
  return isRecord(error) && typeof error.code === "string" ? error.code : "";
}

function remoteErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (
    isRecord(error) &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message;
  }
  return "Glow could not synchronize listening statistics.";
}

function clampUnitInterval(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
