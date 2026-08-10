import { describe, expect, test } from "bun:test";
import { completePairingCode } from "../webview/src/lib/pairingCode";

describe("pairing code entry", () => {
  test("recognizes complete copy-code formats for automatic submission", () => {
    expect(completePairingCode("482917")).toBe("482917");
    expect(completePairingCode("482 917")).toBe("482917");
    expect(completePairingCode("482-917")).toBe("482917");
  });

  test("waits for a complete six-digit code", () => {
    expect(completePairingCode("48291")).toBeNull();
    expect(completePairingCode("482 91")).toBeNull();
    expect(completePairingCode("482a917")).toBeNull();
  });
});
