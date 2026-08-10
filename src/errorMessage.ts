const ERROR_MESSAGE_KEYS = [
  "message",
  "error",
  "detail",
  "details",
  "description",
  "reason",
  "hint",
] as const;

export function errorMessage(
  error: unknown,
  fallback = "Glow could not complete that request.",
): string {
  return extractErrorMessage(error) ?? fallback;
}

export function extractErrorMessage(error: unknown): string | null {
  return extract(error, new Set<unknown>(), 0);
}

function extract(
  value: unknown,
  visited: Set<unknown>,
  depth: number,
): string | null {
  if (depth > 4 || value === null || value === undefined) return null;

  if (typeof value === "string") {
    const message = value.trim();
    return message && message !== "[object Object]" ? message : null;
  }

  if (typeof value !== "object" || visited.has(value)) return null;
  visited.add(value);

  if (value instanceof Error) {
    const directMessage = extract(value.message, visited, depth + 1);
    if (directMessage) return directMessage;
    const causeMessage = extract(value.cause, visited, depth + 1);
    if (causeMessage) return causeMessage;
  }

  const record = value as Record<string, unknown>;
  for (const key of ERROR_MESSAGE_KEYS) {
    const message = extract(record[key], visited, depth + 1);
    if (message) return message;
  }

  return null;
}
