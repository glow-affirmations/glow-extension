export type ChatTimestampedMessage = {
  createdAt: string;
};

export type ChatDateGroup<T extends ChatTimestampedMessage> = {
  key: string;
  createdAt: string;
  entries: Array<{ message: T; index: number }>;
};

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

const ISO_CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})/u;
const DAY_IN_MS = 24 * 60 * 60 * 1_000;

function parseCalendarDate(value: string): CalendarDate | null {
  const match = ISO_CALENDAR_DATE.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function calendarOrdinal(date: CalendarDate): number {
  return Date.UTC(date.year, date.month - 1, date.day) / DAY_IN_MS;
}

function calendarKey(value: string): string | null {
  const date = parseCalendarDate(value);
  return date ? `${date.year}-${date.month}-${date.day}` : null;
}

function referenceCalendarDate(reference: Date): CalendarDate {
  return {
    year: reference.getUTCFullYear(),
    month: reference.getUTCMonth() + 1,
    day: reference.getUTCDate(),
  };
}

export function isSameChatDate(left: string, right: string): boolean {
  const leftKey = calendarKey(left);
  return leftKey !== null && leftKey === calendarKey(right);
}

export function startsChatDateGroup(
  messages: ChatTimestampedMessage[],
  index: number,
): boolean {
  return index === 0 || !isSameChatDate(messages[index - 1]?.createdAt ?? "", messages[index]?.createdAt ?? "");
}

export function groupChatMessagesByDate<T extends ChatTimestampedMessage>(
  messages: T[],
): ChatDateGroup<T>[] {
  const groups: ChatDateGroup<T>[] = [];

  messages.forEach((message, index) => {
    const currentGroup = groups.at(-1);
    if (!currentGroup || !isSameChatDate(currentGroup.createdAt, message.createdAt)) {
      groups.push({
        key: `${message.createdAt}:${index}`,
        createdAt: message.createdAt,
        entries: [{ message, index }],
      });
      return;
    }

    currentGroup.entries.push({ message, index });
  });

  return groups;
}

export function formatChatDateLabel(createdAt: string, reference = new Date()): string {
  const target = parseCalendarDate(createdAt);
  if (!target) return "";

  const anchor = referenceCalendarDate(reference);
  const calendarDayDiff = calendarOrdinal(target) - calendarOrdinal(anchor);
  if (calendarDayDiff === 0) return "Today";
  if (calendarDayDiff === -1) return "Yesterday";

  const date = new Date(Date.UTC(target.year, target.month - 1, target.day));
  if (Math.abs(calendarDayDiff) < 7) {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      timeZone: "UTC",
    }).format(date);
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: target.year === anchor.year ? undefined : "numeric",
    timeZone: "UTC",
  }).format(date);
}
