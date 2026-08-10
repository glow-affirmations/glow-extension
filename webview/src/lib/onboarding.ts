export const ONBOARDING_COMPLETED_FOR_TESTING: boolean | null = null;

/**
 * `false` keeps onboarding visible across development-host reloads so the flow
 * can be inspected. Change the override to `null` before release to honor the
 * device-wide completion value supplied by the extension host.
 */
export function resolveOnboardingCompleted(
  persistedCompletion: unknown,
  testingOverride: boolean | null = ONBOARDING_COMPLETED_FOR_TESTING,
): boolean {
  return testingOverride ?? persistedCompletion === true;
}
