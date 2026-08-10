import { describe, expect, test } from "bun:test";
import {
  LISTENING_SYNC_RETRY_BASE_MS,
  LISTENING_SYNC_RETRY_MAX_MS,
  ListeningSyncRequestError,
  listeningSyncFailureKind,
  listeningSyncRetryDelay,
} from "../src/listeningSyncRetry";

describe("listening statistics retry policy", () => {
  test("retries authentication once through the dedicated auth path", () => {
    expect(
      listeningSyncFailureKind(new ListeningSyncRequestError(401, {
        message: "JWT expired",
      })),
    ).toBe("authentication");
  });

  test("retries network, throttling, and server failures", () => {
    expect(
      listeningSyncFailureKind(new ListeningSyncRequestError(0, {
        message: "fetch failed",
      })),
    ).toBe("retryable");
    expect(
      listeningSyncFailureKind(new ListeningSyncRequestError(429, {
        message: "rate limited",
      })),
    ).toBe("retryable");
    expect(
      listeningSyncFailureKind(new ListeningSyncRequestError(503, {
        message: "unavailable",
      })),
    ).toBe("retryable");
  });

  test("does not automatically retry permission or validation failures", () => {
    expect(
      listeningSyncFailureKind(new ListeningSyncRequestError(403, {
        code: "42501",
        message: "permission denied",
      })),
    ).toBe("permanent");
    expect(
      listeningSyncFailureKind(new ListeningSyncRequestError(422, {
        message: "invalid payload",
      })),
    ).toBe("permanent");
  });

  test("uses exponential jitter capped at five minutes", () => {
    expect(listeningSyncRetryDelay(0, () => 0.5)).toBe(
      LISTENING_SYNC_RETRY_BASE_MS,
    );
    expect(listeningSyncRetryDelay(1, () => 0.5)).toBe(
      LISTENING_SYNC_RETRY_BASE_MS * 2,
    );
    expect(listeningSyncRetryDelay(20, () => 1)).toBe(
      LISTENING_SYNC_RETRY_MAX_MS,
    );
  });
});
