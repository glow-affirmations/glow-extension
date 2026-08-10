export type NotificationTone = "info" | "success" | "warning" | "error";

export function libraryNoticeTone(message: string | null): NotificationTone {
  if (!message) return "info";

  const normalized = message.toLowerCase();
  if (
    normalized.includes("offline") ||
    normalized.includes("waiting to sync") ||
    normalized.includes("still downloading") ||
    normalized.includes("could not be updated") ||
    normalized.includes("pending")
  ) {
    return "warning";
  }
  if (normalized.includes("back online") || normalized.includes("successfully")) {
    return "success";
  }
  return "info";
}

export function notificationDurationMs(tone: NotificationTone): number {
  switch (tone) {
    case "success":
      return 4_500;
    case "info":
      return 6_000;
    case "warning":
      return 8_000;
    case "error":
      return 10_000;
  }
}
