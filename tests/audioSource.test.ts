import { describe, expect, test } from "bun:test";
import { audioSourceKind } from "../webview/src/lib/audioSource";

describe("audio source diagnostics", () => {
  test("classifies sources without exposing their contents", () => {
    expect(audioSourceKind("blob:https://webview.example/cached-audio-id")).toBe("custom-blob");
    expect(audioSourceKind("https://example.com/file.mp3")).toBe("remote-https");
    expect(audioSourceKind(null)).toBe("none");
  });
});
