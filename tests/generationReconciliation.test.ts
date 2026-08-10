import { describe, expect, test } from "bun:test";
import { generatedAffirmationExists } from "../src/generationReconciliation";

describe("ambiguous generation reconciliation", () => {
  test("treats the matching server affirmation as a successful request", () => {
    expect(
      generatedAffirmationExists(
        [{ id: "older" }, { id: "matching-request" }],
        "matching-request",
      ),
    ).toBe(true);
  });

  test("does not settle from another window's unrelated affirmation", () => {
    expect(
      generatedAffirmationExists(
        [{ id: "older" }, { id: "different-request" }],
        "matching-request",
      ),
    ).toBe(false);
  });
});
