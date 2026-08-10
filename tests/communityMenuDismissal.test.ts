import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const source = readFileSync(
  resolve(import.meta.dir, "../webview/src/components/CommunityView.svelte"),
  "utf8",
);

describe("community chat menu dismissal", () => {
  test("keeps the delete confirmation open while the webview remains interactive", () => {
    expect(source).not.toContain(
      'window.addEventListener("blur", closeAllCommunityMenus)',
    );
    expect(source).toContain(
      'document.addEventListener("pointerdown", closeMenusOnOutsidePointerDown)',
    );
    expect(source).toContain(
      '{#if chatDeleteConfirmId === contextMessage.id}',
    );
  });

  test("clears delete state only when the menu is actually dismissed", () => {
    const outsideHandler = source.slice(
      source.indexOf("function closeMenusOnOutsidePointerDown"),
      source.indexOf("function closeMenusOnEscape"),
    );
    expect(outsideHandler).toContain('!target.closest(".chat-context-menu');
    expect(outsideHandler).toContain("chatContextMenu = null");
    expect(outsideHandler).toContain("chatDeleteConfirmId = null");
  });
});
