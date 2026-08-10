type ComposerAutoOpenInput = {
  userId: string | null;
  handledUserId: string | null;
  entitlement: "signed_out" | "free" | "premium" | "unavailable";
  syncStatus: "loading" | "refreshing" | "online" | "offline";
  customAffirmationCount: number;
};

export function shouldAutoOpenComposer(input: ComposerAutoOpenInput): boolean {
  return (
    input.userId !== null &&
    input.userId !== input.handledUserId &&
    input.entitlement === "premium" &&
    input.syncStatus === "online" &&
    input.customAffirmationCount === 0
  );
}
