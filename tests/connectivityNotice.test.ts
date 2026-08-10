import { describe, expect, test } from "bun:test";
import {
  feedbackAfterOfflineFailure,
  noticeAfterOfflineFailure,
  noticeAfterOnlineRefresh,
  noticeWhileRefreshing,
} from "../src/connectivityNotice";

describe("connectivity notices", () => {
  test("keeps the first offline transition quiet", () => {
    expect(noticeAfterOfflineFailure(false, null, true)).toBeNull();
  });

  test("keeps automatic reconnect attempts quiet", () => {
    expect(noticeWhileRefreshing(true, null, null)).toBeNull();
    expect(noticeAfterOfflineFailure(true, null, true)).toBeNull();
  });

  test("does not show a signed-in library notice without a user", () => {
    expect(noticeAfterOfflineFailure(false, null, false)).toBeNull();
  });

  test("suppresses retryable offline errors even without a library cache", () => {
    expect(feedbackAfterOfflineFailure(false, null, false)).toEqual({
      error: null,
      notice: null,
    });
  });

  test("preserves a useful notice without exposing an offline error", () => {
    const notice = "Saved locally — waiting to sync.";
    expect(feedbackAfterOfflineFailure(true, notice, true)).toEqual({
      error: null,
      notice,
    });
  });

  test("keeps the back-online transition quiet", () => {
    expect(noticeAfterOnlineRefresh(true, null)).toBeNull();
  });

  test("does not show a recovery notice after a normal online refresh", () => {
    expect(noticeAfterOnlineRefresh(false, null)).toBeNull();
  });

  test("keeps a higher-priority sync warning after recovery", () => {
    const warning = "Synced, but the offline copy could not be updated.";
    expect(noticeAfterOnlineRefresh(true, warning)).toBe(warning);
  });

  test("does not discard an unrelated notice when connectivity drops", () => {
    const notice = "Your affirmation was regenerated.";
    expect(noticeAfterOfflineFailure(false, notice, true)).toBe(notice);
  });
});
