export function generatedAffirmationExists(
  affirmations: readonly { id: string }[],
  requestId: string,
): boolean {
  return affirmations.some((affirmation) => affirmation.id === requestId);
}
