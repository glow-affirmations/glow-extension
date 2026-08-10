import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const panelSource = readFileSync(
  resolve(import.meta.dir, "../src/communityPanel.ts"),
  "utf8",
);
const communitySource = readFileSync(
  resolve(import.meta.dir, "../src/community.ts"),
  "utf8",
);
const hostSource = readFileSync(
  resolve(import.meta.dir, "../webview/src/lib/host.ts"),
  "utf8",
);
const viewSource = readFileSync(
  resolve(import.meta.dir, "../webview/src/components/CommunityView.svelte"),
  "utf8",
);
const extensionSource = readFileSync(
  resolve(import.meta.dir, "../src/extension.ts"),
  "utf8",
);
const dashboardViewSource = readFileSync(
  resolve(import.meta.dir, "../webview/src/components/DashboardView.svelte"),
  "utf8",
);

describe("extension Community conversation continuity", () => {
  test("accepts server-discovered plain-chat channels without a client release", () => {
    expect(communitySource).toContain(
      "/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)",
    );
    expect(communitySource).not.toContain('value === "entrepreneurship"');
    expect(panelSource).toContain("isCommunityChatChannelSlug(");
    expect(panelSource).toContain("(channels[0]?.slug ?? null)");
    expect(hostSource).toContain(
      "export type CommunityChatChannelSlug = string;",
    );
  });

  test("uses VS Code globalState for an account-scoped tab and channel", () => {
    expect(panelSource).toContain(
      'const COMMUNITY_SURFACE_PREFERENCE_KEY = "glow.community.surface.v1"',
    );
    expect(panelSource).toContain(
      "private readonly globalState: vscode.Memento",
    );
    expect(panelSource).toContain("candidate.userId !== userId");
    expect(panelSource).toContain("retainContextWhenHidden: true");
  });

  test("renders cached channels before silent reconciliation", () => {
    expect(panelSource).toContain("private readonly chatCache = new Map");
    expect(panelSource).toContain(
      "const cached = this.chatCache.get(channelSlug)",
    );
    expect(panelSource).toContain("void this.refreshChatChannel(channelSlug)");
    expect(panelSource).toContain("const items = page.historyLimited");
    expect(viewSource).toContain("let chatChannelCache = $state");
  });

  test("keeps long histories scrollable and the composer copy stable", () => {
    expect(viewSource).toContain(".chat-history-spacer");
    expect(viewSource).toContain("flex-direction: column");
    expect(viewSource).toContain("overflow-y: auto");
    expect(viewSource).toContain('placeholder="Write a message…"');
    expect(viewSource).toContain("padding-bottom: 14px;");
  });

  test("keeps the narrow chat composer near the bottom of tall editors", () => {
    expect(viewSource).toContain(
      ".chat-panel { height: max(400px, calc(100vh - 330px)); }",
    );
    expect(viewSource).not.toContain(
      ".chat-panel { height: clamp(400px, calc(100vh - 330px), 520px); }",
    );
  });

  test("uses concise editor tab titles beside the Glow logo", () => {
    expect(panelSource).toContain('"Community",');
    expect(panelSource).not.toContain('"Glow Community",');
    expect(extensionSource).toContain('"Dashboard",');
    expect(extensionSource).not.toContain('"Glow Dashboard",');
    expect(dashboardViewSource).toContain("<title>Dashboard</title>");
  });

  test("uses right-click without a visible bubble menu trigger", () => {
    expect(viewSource).toContain(
      "oncontextmenu={(event) => openChatContextMenu(event, message)}",
    );
    expect(viewSource).not.toContain("chat-message-menu-trigger");
    expect(viewSource).not.toContain("openChatContextMenuFromButton");
  });

  test("uses Telegram-style guarded keyboard focus without pointer hijacking", () => {
    expect(viewSource).toContain(
      'document.addEventListener("keydown", handleChatDocumentKeydown, true)',
    );
    expect(viewSource).not.toContain("keepChatComposerActive");
    expect(viewSource).toContain(
      "chatComposerInput?.focus({ preventScroll: true })",
    );
    expect(viewSource).toContain('target.tagName === "INPUT"');
    expect(viewSource).toContain(
      'event.key.startsWith("Arrow") && selection && !selection.isCollapsed',
    );
    expect(viewSource).toContain(
      "input.dispatchEvent(new KeyboardEvent(event.type, event))",
    );
    expect(viewSource).toContain(
      'document.addEventListener("mousedown", preventChatComposerBlur)',
    );
    expect(viewSource).toContain(
      "document.activeElement !== chatComposerInput",
    );
    expect(viewSource).toContain(
      'target.classList.contains("chat-history-spacer")',
    );
    expect(viewSource).toContain("disabled={!online || !activeChatChannel}");
    expect(viewSource).not.toContain(".chat-composer textarea:focus");
  });

  test("matches Telegram selection, Shift range, and confirmed bulk deletion", () => {
    expect(viewSource).toContain(
      "onclick={() => enterChatSelection(contextMessage)}",
    );
    expect(viewSource).toContain("event.shiftKey && chatSelectionAnchorId");
    expect(viewSource).toContain("canDeleteSelectedChatMessages()");
    expect(viewSource).toContain('type: "deleteCommunityChatMessages"');
    expect(panelSource).toContain(
      "private async deleteChatMessages(\n    channelSlug: CommunityChatChannelSlug,",
    );
    expect(panelSource).toContain("uniqueMessageIds");
    expect(panelSource).toContain('type: "communityChatDeleteManySettled"');
    expect(viewSource).toContain(
      "const locallyDeletedChatMessageIds = new Set<string>();",
    );
    expect(viewSource).toContain("!locallyDeletedChatMessageIds.has(item.id)");
    const optimisticDelete = viewSource.indexOf(
      "locallyDeletedChatMessageIds.add(message.id);",
      viewSource.indexOf("function deleteSelectedChatMessages"),
    );
    const immediateSelectionExit = viewSource.indexOf(
      "exitChatSelection(false);",
      optimisticDelete,
    );
    const pendingDelete = viewSource.indexOf(
      "chatBulkDeletePending = true;",
      immediateSelectionExit,
    );
    expect(optimisticDelete).toBeGreaterThan(-1);
    expect(immediateSelectionExit).toBeGreaterThan(optimisticDelete);
    expect(pendingDelete).toBeGreaterThan(immediateSelectionExit);
  });

  test("matches Telegram visible read cursors and overlapping double checks", () => {
    expect(viewSource).toContain("queueVisibleChatReadAcknowledgement");
    expect(viewSource).toContain('document.visibilityState !== "visible"');
    expect(viewSource).toContain('aria-label="Seen"');
    expect(viewSource).toContain(".chat-delivery.seen :global(svg + svg)");
    expect(panelSource).toContain('type: "acknowledgeCommunityChatRead"');
    expect(communitySource).toContain("advanceChatReadCursor(");
    expect(communitySource).toContain("parseCommunityChatReadCursorChange");
  });

  test("keeps Community onboarding and membership refresh inside the extension", () => {
    expect(viewSource).toContain('type: "joinCommunity"');
    expect(viewSource).toContain('type: "refreshCommunityMembership"');
    expect(viewSource).toContain("Join the community");
    expect(viewSource).toContain("Already joined? Refresh");
    expect(panelSource).toContain("private async joinCommunity(");
    expect(panelSource).toContain("suggestedCommunityHandle(user, membership)");
    expect(panelSource).not.toContain("openCommunityOnWeb");
    expect(panelSource).not.toContain("COMMUNITY_URL");
    expect(panelSource).not.toContain("vscode.env.openExternal");
    expect(viewSource).not.toContain("openCommunityOnWeb");
  });

  test("supports the Community lifecycle through native extension controls", () => {
    expect(viewSource).toContain('type: "updateCommunityProfile"');
    expect(viewSource).toContain('type: "loadCommunityComposer"');
    expect(viewSource).toContain('type: "shareCommunityAffirmation"');
    expect(viewSource).toContain('type: "reportCommunityMessage"');
    expect(viewSource).toContain('type: "setCommunityBlock"');
    expect(viewSource).toContain("Edit profile");
    expect(viewSource).toContain('aria-label="Share an affirmation"');
    expect(panelSource).toContain("private async updateProfile(");
    expect(panelSource).toContain("private async loadComposer(");
    expect(panelSource).toContain("private async shareAffirmation(");
    expect(panelSource).toContain("private async reportMessage(");
    expect(panelSource).toContain("private async setBlock(");
  });
});
