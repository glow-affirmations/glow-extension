const DAY_MS = 24 * 60 * 60 * 1_000;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export type ListeningStreak = {
  currentDays: number;
  longestDays: number;
  practicedToday: boolean;
  lastPracticeDate: string | null;
};

function dateOrdinal(dateKey: string): number | null {
  if (!DATE_KEY_PATTERN.test(dateKey)) return null;

  const timestamp = Date.parse(`${dateKey}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) return null;

  const normalized = new Date(timestamp).toISOString().slice(0, 10);
  return normalized === dateKey ? Math.floor(timestamp / DAY_MS) : null;
}

function dateKeyFromOrdinal(ordinal: number): string {
  return new Date(ordinal * DAY_MS).toISOString().slice(0, 10);
}

export function localDateKey(
  now: Date,
  timezoneOffsetMinutes: number,
): string {
  const safeOffset =
    Number.isInteger(timezoneOffsetMinutes) &&
    timezoneOffsetMinutes >= -840 &&
    timezoneOffsetMinutes <= 840
      ? timezoneOffsetMinutes
      : 0;

  return new Date(now.getTime() - safeOffset * 60_000)
    .toISOString()
    .slice(0, 10);
}

export function deriveListeningStreak(
  practiceDates: Iterable<string>,
  now: Date,
  timezoneOffsetMinutes: number,
): ListeningStreak {
  const todayOrdinal = dateOrdinal(
    localDateKey(now, timezoneOffsetMinutes),
  )!;
  const practiceOrdinals = new Set<number>();

  for (const value of practiceDates) {
    const ordinal = dateOrdinal(value);
    if (ordinal !== null && ordinal <= todayOrdinal) {
      practiceOrdinals.add(ordinal);
    }
  }

  const ordered = [...practiceOrdinals].sort((left, right) => left - right);
  let longestDays = 0;
  let runDays = 0;
  let previousOrdinal: number | null = null;

  for (const ordinal of ordered) {
    runDays =
      previousOrdinal !== null && ordinal === previousOrdinal + 1
        ? runDays + 1
        : 1;
    longestDays = Math.max(longestDays, runDays);
    previousOrdinal = ordinal;
  }

  const practicedToday = practiceOrdinals.has(todayOrdinal);
  const currentAnchor = practicedToday
    ? todayOrdinal
    : practiceOrdinals.has(todayOrdinal - 1)
      ? todayOrdinal - 1
      : null;
  let currentDays = 0;

  if (currentAnchor !== null) {
    for (
      let ordinal = currentAnchor;
      practiceOrdinals.has(ordinal);
      ordinal -= 1
    ) {
      currentDays += 1;
    }
  }

  const lastOrdinal = ordered.at(-1);
  return {
    currentDays,
    longestDays,
    practicedToday,
    lastPracticeDate:
      lastOrdinal === undefined ? null : dateKeyFromOrdinal(lastOrdinal),
  };
}
