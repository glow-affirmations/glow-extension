const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const STORAGE_DOWNLOAD_TIMEOUT_MS = 15_000;
const GENERATION_REQUEST_TIMEOUT_MS = 125_000;

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function createTimeoutFetch(
  fetchImpl: FetchLike,
  timeoutForRequest: (input: string | URL | Request) => number = requestTimeoutMs,
): FetchLike {
  return async (input, init) => {
    const timeoutMs = timeoutForRequest(input);
    const controller = new AbortController();
    const callerSignal = init?.signal ?? requestSignal(input);
    const abortFromCaller = () => controller.abort(callerSignal?.reason);

    if (callerSignal?.aborted) abortFromCaller();
    else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });

    const timeout = setTimeout(() => {
      const error = new Error(`The request timed out after ${Math.ceil(timeoutMs / 1_000)} seconds.`);
      error.name = "TimeoutError";
      controller.abort(error);
    }, timeoutMs);

    try {
      return await fetchImpl(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    }
  };
}

export function requestTimeoutMs(input: string | URL | Request): number {
  const url = requestUrl(input);
  if (url.includes("/functions/v1/generate-user-affirmation")) {
    return GENERATION_REQUEST_TIMEOUT_MS;
  }
  if (url.includes("/storage/v1/object/") && !url.includes("/object/sign/")) {
    return STORAGE_DOWNLOAD_TIMEOUT_MS;
  }
  return DEFAULT_REQUEST_TIMEOUT_MS;
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestSignal(input: string | URL | Request): AbortSignal | null {
  return typeof Request !== "undefined" && input instanceof Request ? input.signal : null;
}
