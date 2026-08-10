import { describe, expect, test } from "bun:test";
import { tagUserAffirmation } from "../src/affirmationPrompt";

describe("custom affirmation prompt", () => {
  test("prefixes the required affirmation direction tag", () => {
    expect(tagUserAffirmation("There are no limits in this world")).toBe(
      "[affirmation] There are no limits in this world",
    );
  });
});
