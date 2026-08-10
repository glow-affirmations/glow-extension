import { describe, expect, test } from "bun:test";
import { displayAffirmationText } from "../webview/src/lib/affirmationDisplay";

describe("affirmation display text", () => {
  test("removes voice direction tags", () => {
    expect(displayAffirmationText("[happy] I am ready for today.")).toBe(
      "I am ready for today.",
    );
    expect(displayAffirmationText("[soft][reassuring] I am safe.")).toBe("I am safe.");
  });

  test("cleans spacing and punctuation left by inline tags", () => {
    expect(displayAffirmationText("I am [calm] present [pause] , focused, and ready.")).toBe(
      "I am present, focused, and ready.",
    );
  });

  test("keeps line breaks while removing tags", () => {
    expect(displayAffirmationText("[warm]\nI welcome joy.\n\n[slow] I welcome peace.")).toBe(
      "I welcome joy.\n\nI welcome peace.",
    );
  });
});
