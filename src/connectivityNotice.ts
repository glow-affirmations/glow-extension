export function noticeWhileRefreshing(
  reconnecting: boolean,
  currentNotice: string | null,
  requestedNotice: string | null,
): string | null {
  return reconnecting ? currentNotice : requestedNotice;
}

export function noticeAfterOfflineFailure(
  _reconnecting: boolean,
  currentNotice: string | null,
  hasSignedInUser: boolean,
): string | null {
  if (!hasSignedInUser) return null;
  return currentNotice;
}

export function feedbackAfterOfflineFailure(
  reconnecting: boolean,
  currentNotice: string | null,
  hasSignedInUser: boolean,
): { error: null; notice: string | null } {
  return {
    error: null,
    notice: noticeAfterOfflineFailure(
      reconnecting,
      currentNotice,
      hasSignedInUser,
    ),
  };
}

export function noticeAfterOnlineRefresh(
  _reconnecting: boolean,
  priorityNotice: string | null,
): string | null {
  return priorityNotice;
}
