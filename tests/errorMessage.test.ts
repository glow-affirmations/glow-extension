import { describe, expect, test } from "bun:test";
import {
  errorMessage,
  extractErrorMessage,
} from "../src/errorMessage";

describe("error message normalization", () => {
  test("reads plain PostgREST error objects", () => {
    expect(
      errorMessage({
        code: "P0001",
        details: null,
        hint: null,
        message: "The affirmation is not visible to the authenticated user.",
      }),
    ).toBe("The affirmation is not visible to the authenticated user.");
  });

  test("reads nested provider error objects", () => {
    expect(
      extractErrorMessage({
        error: {
          detail: {
            message: "The provider is temporarily unavailable.",
          },
        },
      }),
    ).toBe("The provider is temporarily unavailable.");
  });

  test("never shows the JavaScript object placeholder", () => {
    expect(errorMessage({ error: {} })).toBe(
      "Glow could not complete that request.",
    );
    expect(errorMessage("[object Object]")).toBe(
      "Glow could not complete that request.",
    );
  });
});
