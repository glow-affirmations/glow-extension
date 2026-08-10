import { describe, expect, test } from "bun:test";
import {
  CommunityClient,
  parseCommunityChatReadCursorChange,
  parseCommunityChatRealtimeChange,
} from "../src/community";
import type { FetchLike } from "../src/network";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const feedItem = {
  id: "42",
  createdAt: "2026-08-07T12:00:00.000Z",
  author: {
    userId: "11111111-1111-4111-8111-111111111111",
    handle: "miki",
    displayName: "Miki",
    avatarUrl: null,
  },
  affirmation: { text: "I can begin again.", contentVersion: 1 },
  engagement: { glowCount: 7, glowed: false, saved: false },
  permissions: { canDelete: false, canReport: true, canBlock: true },
};

const chatMessage = {
  id: "84",
  channelSlug: "general",
  body: "Hello from Glow.",
  createdAt: "2026-08-09T12:00:00.000Z",
  author: feedItem.author,
  replyTo: null,
  seenByOther: false,
  permissions: { canDelete: true, canReport: false, canBlock: false },
};

describe("community client", () => {
  test("accepts only the bounded database broadcast contract", () => {
    expect(
      parseCommunityChatRealtimeChange({
        messageId: "42",
        operation: "insert",
      }),
    ).toEqual({ messageId: "42", operation: "insert" });
    expect(
      parseCommunityChatRealtimeChange({
        messageId: "42",
        operation: "update",
      }),
    ).toEqual({ messageId: "42", operation: "update" });
    expect(
      parseCommunityChatRealtimeChange({ messageId: "0", operation: "insert" }),
    ).toBeNull();
    expect(
      parseCommunityChatRealtimeChange({
        messageId: "42",
        operation: "publish",
      }),
    ).toBeNull();
    expect(
      parseCommunityChatRealtimeChange({ body: "private message contents" }),
    ).toBeNull();
    expect(
      parseCommunityChatReadCursorChange({
        readerUserId: "11111111-1111-4111-8111-111111111111",
        lastReadMessageId: "42",
      }),
    ).toEqual({
      readerUserId: "11111111-1111-4111-8111-111111111111",
      lastReadMessageId: "42",
    });
  });

  test("passes the opaque cursor through when loading the next affirmation page", async () => {
    let requestedUrl = "";
    const fetchImpl: FetchLike = async (input) => {
      requestedUrl = input.toString();
      return jsonResponse(200, { items: [feedItem], nextCursor: "next-page" });
    };
    const client = new CommunityClient(
      fetchImpl,
      async () => "token",
      async () => null,
    );

    const page = await client.affirmations("cursor-value");

    expect(requestedUrl).toContain("limit=20");
    expect(requestedUrl).toContain("cursor=cursor-value");
    expect(page.items[0]?.id).toBe("42");
    expect(page.nextCursor).toBe("next-page");
  });

  test("loads a member profile and its shared affirmations natively", async () => {
    const requestedUrls: string[] = [];
    const responses = [
      jsonResponse(200, {
        profile: {
          userId: feedItem.author.userId,
          handle: "miki",
          displayName: "Miki",
          avatarUrl: null,
          bio: "Building with intention.",
          isOwner: false,
        },
      }),
      jsonResponse(200, { items: [feedItem], nextCursor: "profile-next" }),
    ];
    const client = new CommunityClient(
      async (input) => {
        requestedUrls.push(input.toString());
        return responses.shift() ?? jsonResponse(500, {});
      },
      async () => "token",
      async () => null,
    );

    await expect(client.profile("miki")).resolves.toMatchObject({
      handle: "miki",
      bio: "Building with intention.",
      isOwner: false,
    });
    await expect(
      client.profileAffirmations("miki", "older"),
    ).resolves.toMatchObject({
      items: [{ id: "42" }],
      nextCursor: "profile-next",
    });
    expect(requestedUrls[0]).toEndWith("/api/v1/community/profiles/miki");
    expect(requestedUrls[1]).toContain(
      "/api/v1/community/profiles/miki/affirmations?collection=shared&limit=20&cursor=older",
    );
  });

  test("joins and updates a Community profile through the shared API", async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    const responses = [
      jsonResponse(201, {
        result: {
          status: "joined",
          profile: {
            userId: feedItem.author.userId,
            handle: "miki",
            displayName: "Miki",
            avatarUrl: null,
          },
          membership: { spaceId: 1, role: "member", status: "active" },
        },
      }),
      jsonResponse(200, {
        result: {
          status: "ok",
          profile: {
            userId: feedItem.author.userId,
            handle: "miki_glows",
            displayName: "Miki",
            avatarUrl: null,
            bio: "Building with intention.",
          },
        },
      }),
    ];
    const client = new CommunityClient(
      async (input, init) => {
        requests.push({
          url: input.toString(),
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return responses.shift() ?? jsonResponse(500, {});
      },
      async () => "token",
      async () => null,
    );

    await expect(
      client.join({ handle: "miki", displayName: "Miki" }),
    ).resolves.toMatchObject({ status: "joined", profile: { handle: "miki" } });
    await expect(
      client.updateProfile({
        handle: "miki_glows",
        displayName: "Miki",
        bio: "Building with intention.",
        avatarUrl: null,
      }),
    ).resolves.toMatchObject({
      handle: "miki_glows",
      bio: "Building with intention.",
      isOwner: true,
    });
    expect(requests).toEqual([
      {
        url: "https://justglow.dev/api/v1/community/membership",
        method: "PUT",
        body: { handle: "miki", displayName: "Miki" },
      },
      {
        url: "https://justglow.dev/api/v1/community/profile",
        method: "PUT",
        body: {
          handle: "miki_glows",
          displayName: "Miki",
          bio: "Building with intention.",
          avatarUrl: null,
        },
      },
    ]);
  });

  test("shares, reports, and blocks through server-authorized Community endpoints", async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    const sourceId = "22222222-2222-4222-8222-222222222222";
    const nonce = "33333333-3333-4333-8333-333333333333";
    const responses = [
      jsonResponse(200, {
        items: [
          {
            id: sourceId,
            title: "Begin again",
            text: "I can begin again.",
            kind: "included",
          },
        ],
      }),
      jsonResponse(201, {
        result: { status: "shared", messageId: "91" },
      }),
      jsonResponse(201, {
        result: { status: "reported", reportId: "7" },
      }),
      jsonResponse(200, { result: { status: "ok", blocked: true } }),
      jsonResponse(200, { result: { status: "ok", blocked: false } }),
    ];
    const client = new CommunityClient(
      async (input, init) => {
        requests.push({
          url: input.toString(),
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return responses.shift() ?? jsonResponse(500, {});
      },
      async () => "token",
      async () => null,
    );

    await expect(client.shareableAffirmations()).resolves.toEqual([
      {
        id: sourceId,
        title: "Begin again",
        text: "I can begin again.",
        kind: "included",
      },
    ]);
    await expect(client.shareAffirmation(sourceId, nonce)).resolves.toEqual({
      status: "shared",
      messageId: "91",
    });
    await expect(
      client.reportMessage("84", "spam", "Repeated advertising"),
    ).resolves.toEqual({ status: "reported", reportId: "7" });
    await expect(
      client.setBlock(feedItem.author.userId, true),
    ).resolves.toEqual({
      blocked: true,
    });
    await expect(
      client.setBlock(feedItem.author.userId, false),
    ).resolves.toEqual({
      blocked: false,
    });

    expect(requests.map(({ url, method }) => ({ url, method }))).toEqual([
      {
        url: "https://justglow.dev/api/v1/community/affirmations/shareable",
        method: "GET",
      },
      {
        url: "https://justglow.dev/api/v1/community/affirmations/share",
        method: "POST",
      },
      {
        url: "https://justglow.dev/api/v1/community/reports",
        method: "POST",
      },
      {
        url: `https://justglow.dev/api/v1/community/blocks/${feedItem.author.userId}`,
        method: "PUT",
      },
      {
        url: `https://justglow.dev/api/v1/community/blocks/${feedItem.author.userId}`,
        method: "DELETE",
      },
    ]);
  });

  test("preserves the handle conflict code for inline onboarding recovery", async () => {
    const client = new CommunityClient(
      async () => jsonResponse(409, { error: "handle_taken" }),
      async () => "token",
      async () => null,
    );

    await expect(client.join({ handle: "miki" })).rejects.toMatchObject({
      kind: "conflict",
      code: "handle_taken",
      message: "That handle is already taken. Try another one.",
    });
  });

  test("refreshes authentication once after a rejected bearer token", async () => {
    const authorizations: string[] = [];
    const fetchImpl: FetchLike = async (_input, init) => {
      authorizations.push(
        new Headers(init?.headers).get("Authorization") ?? "",
      );
      return authorizations.length === 1
        ? jsonResponse(401, { error: "unauthorized" })
        : jsonResponse(200, {
            membership: {
              joined: true,
              profile: {
                userId: feedItem.author.userId,
                handle: "miki",
                displayName: "Miki",
                avatarUrl: null,
              },
              space: null,
            },
          });
    };
    const client = new CommunityClient(
      fetchImpl,
      async () => "expired-token",
      async () => "fresh-token",
    );

    await expect(client.membership()).resolves.toMatchObject({ joined: true });
    expect(authorizations).toEqual([
      "Bearer expired-token",
      "Bearer fresh-token",
    ]);
  });

  test("accepts idempotent and in-progress library import results", async () => {
    const responses = [
      jsonResponse(200, {
        result: { status: "already_added", affirmationId: "a" },
      }),
      jsonResponse(202, { result: { status: "in_progress" } }),
    ];
    const client = new CommunityClient(
      async () => responses.shift() ?? jsonResponse(500, {}),
      async () => "token",
      async () => null,
    );

    await expect(client.addToLibrary("42")).resolves.toEqual({
      status: "already_added",
      affirmationId: "a",
    });
    await expect(client.addToLibrary("42")).resolves.toEqual({
      status: "in_progress",
      affirmationId: null,
    });
  });

  test("turns an HTML route miss into a useful API error", async () => {
    const client = new CommunityClient(
      async () =>
        new Response("<!doctype html><h1>404</h1>", {
          status: 404,
          headers: { "Content-Type": "text/html" },
        }),
      async () => "token",
      async () => null,
    );

    await expect(client.addToLibrary("42")).rejects.toMatchObject({
      name: "CommunityApiError",
      kind: "invalid_response",
      status: 404,
      message: "This Glow community action is not available on the server yet.",
    });
  });

  test("loads chat channels and returns chat history in chronological order", async () => {
    const responses = [
      jsonResponse(200, {
        channels: [
          {
            id: "1",
            slug: "small-wins",
            name: "Small Wins",
            description: "Notice and celebrate steady progress.",
          },
        ],
      }),
      jsonResponse(200, {
        items: [
          {
            ...chatMessage,
            id: "85",
            channelSlug: "small-wins",
            body: "Newest",
          },
          {
            ...chatMessage,
            id: "84",
            channelSlug: "small-wins",
            body: "Older",
          },
        ],
        nextCursor: "older-page",
        historyLimited: false,
      }),
    ];
    const client = new CommunityClient(
      async () => responses.shift() ?? jsonResponse(500, {}),
      async () => "token",
      async () => null,
    );

    await expect(client.chatChannels()).resolves.toEqual([
      {
        id: "1",
        slug: "small-wins",
        name: "Small Wins",
        description: "Notice and celebrate steady progress.",
      },
    ]);
    await expect(client.chatMessages("small-wins")).resolves.toMatchObject({
      items: [
        { id: "84", body: "Older" },
        { id: "85", body: "Newest" },
      ],
      nextCursor: "older-page",
      historyLimited: false,
    });
  });

  test("rejects malformed server-published chat channel slugs", async () => {
    const client = new CommunityClient(
      async () =>
        jsonResponse(200, {
          channels: [
            {
              id: "1",
              slug: "Small Wins",
              name: "Small Wins",
              description: null,
            },
          ],
        }),
      async () => "token",
      async () => null,
    );

    await expect(client.chatChannels()).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });

  test("posts a chat message as JSON with an idempotency nonce", async () => {
    let requestBody: unknown;
    let contentType = "";
    const client = new CommunityClient(
      async (_input, init) => {
        contentType = new Headers(init?.headers).get("Content-Type") ?? "";
        requestBody = JSON.parse(String(init?.body));
        return jsonResponse(201, {
          result: { status: "sent", message: chatMessage },
        });
      },
      async () => "token",
      async () => null,
    );

    await expect(
      client.postChatMessage(
        "general",
        "Hello from Glow.",
        "11111111-1111-4111-8111-111111111111",
      ),
    ).resolves.toMatchObject({ status: "sent", message: { id: "84" } });
    expect(contentType).toBe("application/json");
    expect(requestBody).toEqual({
      body: "Hello from Glow.",
      clientNonce: "11111111-1111-4111-8111-111111111111",
      replyToMessageId: null,
    });
  });

  test("loads unread replies and acknowledges one through the channel API", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const responses = [
      jsonResponse(200, { items: [chatMessage], totalCount: 3 }),
      jsonResponse(200, { result: { status: "read" } }),
    ];
    const client = new CommunityClient(
      async (input, init) => {
        requests.push({
          url: input.toString(),
          method: init?.method ?? "GET",
        });
        return responses.shift() ?? jsonResponse(500, {});
      },
      async () => "token",
      async () => null,
    );

    await expect(client.unreadChatReplies("general")).resolves.toMatchObject({
      items: [{ id: "84" }],
      totalCount: 3,
    });
    await expect(client.markChatReplyRead("general", "84")).resolves.toEqual({
      status: "read",
    });
    expect(requests).toEqual([
      {
        url: "https://justglow.dev/api/v1/community/chats/general/replies",
        method: "GET",
      },
      {
        url: "https://justglow.dev/api/v1/community/chats/general/replies/84",
        method: "POST",
      },
    ]);
  });

  test("advances the visible chat read cursor monotonically", async () => {
    let requestedUrl = "";
    let requestBody: unknown;
    const client = new CommunityClient(
      async (input, init) => {
        requestedUrl = input.toString();
        requestBody = JSON.parse(String(init?.body));
        return jsonResponse(200, {
          result: { status: "advanced", lastReadMessageId: "84" },
        });
      },
      async () => "token",
      async () => null,
    );

    await expect(
      client.advanceChatReadCursor("general", "84"),
    ).resolves.toEqual({
      status: "advanced",
      lastReadMessageId: "84",
    });
    expect(requestedUrl).toBe(
      "https://justglow.dev/api/v1/community/chats/general/read",
    );
    expect(requestBody).toEqual({ messageId: "84" });
  });

  test("maps the Premium posting gate to a useful client error", async () => {
    const client = new CommunityClient(
      async () => jsonResponse(403, { error: "premium_required" }),
      async () => "token",
      async () => null,
    );

    await expect(
      client.postChatMessage(
        "general",
        "Hello",
        "11111111-1111-4111-8111-111111111111",
      ),
    ).rejects.toMatchObject({
      kind: "premium_required",
      status: 403,
      message: "Glow Premium is required to join the conversation.",
    });
  });

  test("deletes an owned community message through the shared endpoint", async () => {
    let requestedUrl = "";
    let requestedMethod = "";
    const client = new CommunityClient(
      async (input, init) => {
        requestedUrl = input.toString();
        requestedMethod = init?.method ?? "GET";
        return jsonResponse(200, { result: { status: "deleted" } });
      },
      async () => "token",
      async () => null,
    );

    await expect(client.deleteMessage("84")).resolves.toEqual({
      status: "deleted",
    });
    expect(requestedUrl).toEndWith("/api/v1/community/messages/84");
    expect(requestedMethod).toBe("DELETE");
  });
});
