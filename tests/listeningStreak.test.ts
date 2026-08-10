import { describe, expect, test } from "bun:test";
import {
  deriveListeningStreak,
  localDateKey,
} from "../src/listeningStreak";

const middayUtc = new Date("2026-07-30T12:00:00.000Z");

describe("listening streak", () => {
  test("uses the listener timezone when selecting the practice day", () => {
    expect(localDateKey(middayUtc, 0)).toBe("2026-07-30");
    expect(
      localDateKey(new Date("2026-07-30T02:00:00.000Z"), 240),
    ).toBe("2026-07-29");
    expect(
      localDateKey(new Date("2026-07-30T22:00:00.000Z"), -180),
    ).toBe("2026-07-31");
  });

  test("keeps an active streak through yesterday", () => {
    expect(
      deriveListeningStreak(
        ["2026-07-27", "2026-07-28", "2026-07-29"],
        middayUtc,
        0,
      ),
    ).toEqual({
      currentDays: 3,
      longestDays: 3,
      practicedToday: false,
      lastPracticeDate: "2026-07-29",
    });
  });

  test("ignores invalid, duplicate, and future practice days", () => {
    expect(
      deriveListeningStreak(
        [
          "not-a-date",
          "2026-02-30",
          "2026-07-26",
          "2026-07-27",
          "2026-07-27",
          "2026-07-31",
        ],
        middayUtc,
        0,
      ),
    ).toEqual({
      currentDays: 0,
      longestDays: 2,
      practicedToday: false,
      lastPracticeDate: "2026-07-27",
    });
  });
});
