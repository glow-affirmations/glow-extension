import anythingIsPossibleAudio from "../../../sol_affirmations/featured/anything_is_possible.mp3?url";
import calmAndConcentratedAudio from "../../../sol_affirmations/featured/i_am_calm_and_concentrated.mp3?url";
import powerToBelieveAudio from "../../../sol_affirmations/featured/i_have_the_power_to_believe.mp3?url";
import scientificAudio from "../../../sol_affirmations/mind/i_am_scientific_and_meticulous.mp3?url";
import beautifulThingsAudio from "../../../sol_affirmations/soul/beautiful_things_take_time.mp3?url";

export type AffirmationCategory = "mind" | "soul";

export type Affirmation = {
  id: string;
  title: string;
  affirmation: string;
  audio: string;
};

export const affirmationCategories: AffirmationCategory[] = ["soul", "mind"];

export const affirmationCollections: Record<AffirmationCategory, Affirmation[]> = {
  mind: [
    {
      id: "43737c84-fe35-4271-ba9d-b33155f443ae",
      title: "Anything is possible",
      affirmation: "Anything is possible.",
      audio: anythingIsPossibleAudio,
    },
    {
      id: "130ca437-cdac-42aa-87ff-a48eaeda0082",
      title: "Scientific and meticulous",
      affirmation: "I am scientific and meticulous.",
      audio: scientificAudio,
    },
  ],
  soul: [
    {
      id: "c6633054-a7fb-4edd-a3fc-5b3b163e53fb",
      title: "I have the power to believe",
      affirmation: "I have the power to believe.",
      audio: powerToBelieveAudio,
    },
    {
      id: "2f4c421b-1104-4f5b-8a9b-0cdb9246c23e",
      title: "Beautiful things take time",
      affirmation: "Beautiful things take time.",
      audio: beautifulThingsAudio,
    },
    {
      id: "6b21dd38-ce05-4ee8-acc8-be5a070049e9",
      title: "I am calm and concentrated",
      affirmation: "I am calm and concentrated.",
      audio: calmAndConcentratedAudio,
    },
  ],
};

export function interleaveAffirmations(
  first: readonly Affirmation[],
  second: readonly Affirmation[],
): Affirmation[] {
  const affirmations: Affirmation[] = [];
  const length = Math.max(first.length, second.length);

  for (let index = 0; index < length; index += 1) {
    const firstAffirmation = first[index];
    const secondAffirmation = second[index];
    if (firstAffirmation) affirmations.push(firstAffirmation);
    if (secondAffirmation) affirmations.push(secondAffirmation);
  }

  return affirmations;
}

export const includedAffirmations = interleaveAffirmations(
  affirmationCollections.soul,
  affirmationCollections.mind,
);
