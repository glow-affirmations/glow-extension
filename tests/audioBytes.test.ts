import { describe, expect, test } from "bun:test";
import { exactArrayBuffer } from "../src/audioBytes";

describe("webview audio byte transfer", () => {
  test("copies only the selected bytes into an exact ArrayBuffer", () => {
    const backing = new Uint8Array([0, 0x49, 0x44, 0x33, 0x04, 0]);
    const transferred = exactArrayBuffer(backing.subarray(1, 5));

    expect(transferred.byteLength).toBe(4);
    expect(new Uint8Array(transferred)).toEqual(new Uint8Array([0x49, 0x44, 0x33, 0x04]));
  });

  test("rejects an empty cached file", () => {
    expect(() => exactArrayBuffer(new Uint8Array())).toThrow("cached audio file is empty");
  });
});
