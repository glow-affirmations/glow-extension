const AFFIRMATION_TAG = "[affirmation]";

export function tagUserAffirmation(affirmation: string): string {
  return `${AFFIRMATION_TAG} ${affirmation}`;
}
