import { describe, expect, test } from "bun:test";
import { customAudioBlob } from "../webview/src/lib/audioBlob";

describe("custom audio blobs", () => {
  test("keeps the exact MP3 bytes and MIME type", async () => {
    const bytes = new Uint8Array([0x49, 0x44, 0x33, 0x04]).buffer;
    const blob = customAudioBlob(bytes, "audio/mpeg");

    expect(blob.type).toBe("audio/mpeg");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array(bytes));
  });

  test("rejects empty or unexpected audio data", () => {
    expect(() => customAudioBlob(new ArrayBuffer(0), "audio/mpeg")).toThrow(
      "cached audio file is empty",
    );
    expect(() => customAudioBlob(new Uint8Array([1]).buffer, "text/html")).toThrow(
      "unsupported format",
    );
  });
});
