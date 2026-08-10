import { describe, expect, test } from "bun:test";
import {
  formatChatDateLabel,
  groupChatMessagesByDate,
  isSameChatDate,
  startsChatDateGroup,
} from "../webview/src/lib/chat-date";

const reference = new Date("2026-08-09T12:00:00.000Z");

describe("Telegram-style chat date annotations", () => {
  test("uses relative, weekday, and long-date labels", () => {
    expect(formatChatDateLabel("2026-08-09T08:00:00.000Z", reference)).toBe("Today");
    expect(formatChatDateLabel("2026-08-08T23:59:00.000Z", reference)).toBe("Yesterday");
    expect(formatChatDateLabel("2026-08-05T08:00:00.000Z", reference)).toBe("Wednesday");
    expect(formatChatDateLabel("2026-07-10T08:00:00.000Z", reference)).toBe("July 10");
    expect(formatChatDateLabel("2025-12-31T08:00:00.000Z", reference)).toBe("December 31, 2025");
  });

  test("uses the timestamp calendar date consistently across host timezones", () => {
    expect(isSameChatDate("2026-08-08T23:30:00-10:00", "2026-08-08T01:00:00+03:00")).toBe(true);
  });

  test("starts a date group only at the first message of each day", () => {
    const messages = [
      { createdAt: "2026-08-08T20:00:00.000Z" },
      { createdAt: "2026-08-08T21:00:00.000Z" },
      { createdAt: "2026-08-09T06:00:00.000Z" },
    ];

    expect(messages.map((_, index) => startsChatDateGroup(messages, index))).toEqual([
      true,
      false,
      true,
    ]);
  });

  test("groups messages into bounded day sections while preserving their indexes", () => {
    const messages = [
      { id: "friday-one", createdAt: "2026-08-07T20:00:00.000Z" },
      { id: "friday-two", createdAt: "2026-08-07T21:00:00.000Z" },
      { id: "today", createdAt: "2026-08-09T06:00:00.000Z" },
    ];

    const groups = groupChatMessagesByDate(messages);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.entries.map(({ message, index }) => [message.id, index])).toEqual([
      ["friday-one", 0],
      ["friday-two", 1],
    ]);
    expect(groups[1]?.entries.map(({ message, index }) => [message.id, index])).toEqual([
      ["today", 2],
    ]);
  });
});
