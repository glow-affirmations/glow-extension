import { describe, expect, test } from "bun:test";
import {
  affirmationCollections,
  includedAffirmations,
  interleaveAffirmations,
} from "../webview/src/lib/affirmations";

describe("included affirmations", () => {
  test("exposes only the five curated Featured affirmations in product order", () => {
    expect(includedAffirmations.map((affirmation) => affirmation.affirmation)).toEqual([
      "I have the power to believe.",
      "Anything is possible.",
      "Beautiful things take time.",
      "I am scientific and meticulous.",
      "I am calm and concentrated.",
    ]);
  });

  test("alternates one soul affirmation then one mind affirmation", () => {
    for (let index = 0; index < affirmationCollections.soul.length; index += 1) {
      expect(includedAffirmations[index * 2]?.id).toBe(
        affirmationCollections.soul[index]?.id,
      );
      expect(includedAffirmations[index * 2 + 1]?.id).toBe(
        affirmationCollections.mind[index]?.id,
      );
    }
  });

  test("retains the remainder when the collections have different lengths", () => {
    const soul = affirmationCollections.soul.slice(0, 2);
    const mind = affirmationCollections.mind.slice(0, 1);

    expect(interleaveAffirmations(soul, mind).map((affirmation) => affirmation.id)).toEqual([
      soul[0]!.id,
      mind[0]!.id,
      soul[1]!.id,
    ]);
  });
});
