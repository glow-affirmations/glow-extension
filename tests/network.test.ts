import { describe, expect, test } from "bun:test";
import { createTimeoutFetch, requestTimeoutMs, type FetchLike } from "../src/network";

describe("timeout fetch", () => {
  test("uses a longer timeout for affirmation generation", () => {
    expect(
      requestTimeoutMs(
        "https://example.supabase.co/functions/v1/generate-user-affirmation",
      ),
    ).toBe(125_000);
  });

  test("uses a short timeout for storage downloads", () => {
    expect(
      requestTimeoutMs("https://example.supabase.co/storage/v1/object/audio/example.mp3"),
    ).toBe(15_000);
  });

  test("aborts a request that does not finish", async () => {
    const hangingFetch: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
          once: true,
        });
      });
    const timeoutFetch = createTimeoutFetch(hangingFetch, () => 10);

    await expect(timeoutFetch("https://example.com/hang")).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });

  test("preserves an earlier caller abort", async () => {
    const hangingFetch: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
          once: true,
        });
      });
    const timeoutFetch = createTimeoutFetch(hangingFetch, () => 1_000);
    const controller = new AbortController();
    const reason = new Error("caller stopped");
    const request = timeoutFetch("https://example.com/hang", { signal: controller.signal });
    controller.abort(reason);

    await expect(request).rejects.toBe(reason);
  });
});
