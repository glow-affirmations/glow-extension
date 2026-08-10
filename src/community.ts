import type { FetchLike } from "./network.js";

const DEFAULT_COMMUNITY_ORIGIN = "https://justglow.dev";

export type CommunityAuthor = {
  userId: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
};

export type CommunityAffirmationFeedItem = {
  id: string;
  createdAt: string;
  author: CommunityAuthor;
  affirmation: {
    text: string;
    contentVersion: number;
  };
  engagement: {
    glowCount: number;
    glowed: boolean;
  };
  permissions: {
    canDelete: boolean;
    canReport: boolean;
    canBlock: boolean;
  };
};

export type CommunityMembership = {
  joined: boolean;
  profile: {
    userId: string;
    handle: string;
    displayName: string | null;
    avatarUrl: string | null;
  } | null;
};

export type CommunityMemberProfile = {
  userId: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  isOwner: boolean;
};

export type CommunityFeedPage = {
  items: CommunityAffirmationFeedItem[];
  nextCursor: string | null;
};

export type CommunityReactionResult = {
  glowed: boolean;
  glowCount: number | null;
};

export type CommunityLibraryImportResult = {
  status: "added" | "already_added" | "in_progress";
  affirmationId: string | null;
};

export type CommunityAudio = {
  mimeType: string;
  data: ArrayBuffer;
};

export type CommunityChatChannelSlug = string;

export type CommunityChatChannel = {
  id: string;
  slug: CommunityChatChannelSlug;
  name: string;
  description: string | null;
};

export type CommunityChatMessage = {
  id: string;
  channelSlug: CommunityChatChannelSlug;
  body: string;
  createdAt: string;
  author: CommunityAuthor;
  replyTo: {
    id: string;
    body: string;
    author: Pick<CommunityAuthor, "handle" | "displayName">;
  } | null;
  seenByOther: boolean;
  permissions: {
    canDelete: boolean;
    canReport: boolean;
    canBlock: boolean;
  };
};

export type CommunityChatPage = {
  items: CommunityChatMessage[];
  nextCursor: string | null;
  historyLimited: boolean;
};

export type CommunityChatPostResult = {
  status: "sent" | "already_sent";
  message: CommunityChatMessage;
};

export type CommunityUnreadChatReplies = {
  items: CommunityChatMessage[];
  totalCount: number;
};

export type CommunityChatReplyReadResult = {
  status: "read" | "already_read";
};

export type CommunityChatReadResult = {
  status: "advanced" | "unchanged";
  lastReadMessageId: string;
};

export type CommunityChatRealtimeChange = {
  messageId: string;
  operation: "insert" | "update" | "delete";
};

export type CommunityChatReadCursorChange = {
  readerUserId: string;
  lastReadMessageId: string;
};

export function parseCommunityChatRealtimeChange(
  payload: unknown,
): CommunityChatRealtimeChange | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return null;
  const candidate = payload as Record<string, unknown>;
  const messageId = candidate.messageId;
  const operation = candidate.operation;
  if (
    typeof messageId !== "string" ||
    !/^[1-9]\d*$/u.test(messageId) ||
    (operation !== "insert" && operation !== "update" && operation !== "delete")
  ) {
    return null;
  }

  return { messageId, operation };
}

export function parseCommunityChatReadCursorChange(
  payload: unknown,
): CommunityChatReadCursorChange | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return null;
  const candidate = payload as Record<string, unknown>;
  const readerUserId = candidate.readerUserId;
  const lastReadMessageId = candidate.lastReadMessageId;
  if (
    typeof readerUserId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      readerUserId,
    ) ||
    typeof lastReadMessageId !== "string" ||
    !/^[1-9]\d*$/u.test(lastReadMessageId)
  ) {
    return null;
  }
  return { readerUserId, lastReadMessageId };
}

export type CommunityDeleteResult = {
  status: "deleted" | "already_deleted";
};

export class CommunityApiError extends Error {
  constructor(
    readonly kind:
      | "authentication"
      | "not_member"
      | "premium_required"
      | "offline"
      | "service"
      | "invalid_response",
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = "CommunityApiError";
  }
}

type TokenProvider = () => Promise<string | null>;

export class CommunityClient {
  constructor(
    private readonly fetchImpl: FetchLike,
    private readonly accessToken: TokenProvider,
    private readonly refreshAccessToken: TokenProvider,
    private readonly origin = DEFAULT_COMMUNITY_ORIGIN,
  ) {}

  async membership(): Promise<CommunityMembership> {
    const response = await this.request("/api/v1/community/membership");
    const payload = await responseJson(response);
    if (!response.ok) throw responseError(response, payload);
    const membership = recordField(payload, "membership");
    const profileValue = membership.profile;
    return {
      joined: booleanField(membership, "joined"),
      profile:
        profileValue === null
          ? null
          : parseMembershipProfile(
              asRecord(profileValue, "community membership profile"),
            ),
    };
  }

  async affirmations(cursor: string | null = null): Promise<CommunityFeedPage> {
    const query = new URLSearchParams({ limit: "20" });
    if (cursor) query.set("cursor", cursor);
    const response = await this.request(
      `/api/v1/community/affirmations?${query.toString()}`,
    );
    const payload = await responseJson(response);
    if (!response.ok) throw responseError(response, payload);
    if (!Array.isArray(payload.items)) {
      throw invalidResponse("The community feed did not return an item list.");
    }
    return {
      items: payload.items.map(parseAffirmationFeedItem),
      nextCursor: nullableStringField(payload, "nextCursor"),
    };
  }

  async profile(handle: string): Promise<CommunityMemberProfile> {
    const response = await this.request(
      `/api/v1/community/profiles/${encodeURIComponent(handle)}`,
    );
    const payload = await responseJson(response);
    if (!response.ok) throw responseError(response, payload);
    return parseMemberProfile(recordField(payload, "profile"));
  }

  async profileAffirmations(
    handle: string,
    cursor: string | null = null,
  ): Promise<CommunityFeedPage> {
    const query = new URLSearchParams({ collection: "shared", limit: "20" });
    if (cursor) query.set("cursor", cursor);
    const response = await this.request(
      `/api/v1/community/profiles/${encodeURIComponent(handle)}/affirmations?${query.toString()}`,
    );
    const payload = await responseJson(response);
    if (!response.ok) throw responseError(response, payload);
    if (!Array.isArray(payload.items)) {
      throw invalidResponse(
        "The community profile did not return an affirmation list.",
      );
    }
    return {
      items: payload.items.map(parseAffirmationFeedItem),
      nextCursor: nullableStringField(payload, "nextCursor"),
    };
  }

  async audio(messageId: string): Promise<CommunityAudio> {
    const response = await this.request(
      `/api/v1/community/messages/${encodeURIComponent(messageId)}/audio`,
    );
    if (!response.ok) {
      const payload = await responseJson(response).catch(() => ({}));
      throw responseError(response, payload);
    }
    return {
      mimeType:
        response.headers.get("content-type")?.split(";")[0] ?? "audio/mpeg",
      data: await response.arrayBuffer(),
    };
  }

  async setReaction(
    messageId: string,
    active: boolean,
  ): Promise<CommunityReactionResult> {
    const response = await this.request(
      `/api/v1/community/messages/${encodeURIComponent(messageId)}/reaction`,
      { method: active ? "PUT" : "DELETE" },
    );
    const payload = await responseJson(response);
    if (!response.ok) throw responseError(response, payload);
    const result = recordField(payload, "result");
    if (stringField(result, "status") !== "ok") {
      throw invalidResponse("The reaction response was not recognized.");
    }
    const count = result.glowCount;
    return {
      glowed: booleanField(result, "glowed"),
      glowCount:
        typeof count === "number" && Number.isInteger(count) && count >= 0
          ? count
          : null,
    };
  }

  async addToLibrary(messageId: string): Promise<CommunityLibraryImportResult> {
    const response = await this.request(
      `/api/v1/community/messages/${encodeURIComponent(messageId)}/library`,
      { method: "POST" },
    );
    const payload = await responseJson(response);
    const resultValue = payload.result;
    const result = isRecord(resultValue) ? resultValue : null;
    const status = result?.status;
    if (
      (response.ok || response.status === 202) &&
      (status === "added" ||
        status === "already_added" ||
        status === "in_progress")
    ) {
      return {
        status,
        affirmationId:
          typeof result?.affirmationId === "string"
            ? result.affirmationId
            : null,
      };
    }
    throw responseError(response, payload);
  }

  async chatChannels(): Promise<CommunityChatChannel[]> {
    const response = await this.request("/api/v1/community/chats");
    const payload = await responseJson(response);
    if (!response.ok) throw responseError(response, payload);
    if (!Array.isArray(payload.channels)) {
      throw invalidResponse("The community did not return a channel list.");
    }
    return payload.channels.map(parseChatChannel);
  }

  async chatMessages(
    channel: CommunityChatChannelSlug,
    cursor: string | null = null,
  ): Promise<CommunityChatPage> {
    const query = new URLSearchParams({ limit: "50" });
    if (cursor) query.set("cursor", cursor);
    const response = await this.request(
      `/api/v1/community/chats/${encodeURIComponent(channel)}?${query.toString()}`,
    );
    const payload = await responseJson(response);
    if (!response.ok) throw responseError(response, payload);
    if (!Array.isArray(payload.items)) {
      throw invalidResponse(
        "The community chat did not return a message list.",
      );
    }
    return {
      items: payload.items.map(parseChatMessage).reverse(),
      nextCursor: nullableStringField(payload, "nextCursor"),
      historyLimited: booleanField(payload, "historyLimited"),
    };
  }

  async unreadChatReplies(
    channel: CommunityChatChannelSlug,
  ): Promise<CommunityUnreadChatReplies> {
    const response = await this.request(
      `/api/v1/community/chats/${encodeURIComponent(channel)}/replies`,
    );
    const payload = await responseJson(response);
    if (!response.ok) throw responseError(response, payload);
    if (!Array.isArray(payload.items)) {
      throw invalidResponse(
        "The community did not return an unread reply list.",
      );
    }
    return {
      items: payload.items.map(parseChatMessage),
      totalCount: nonnegativeIntegerField(payload, "totalCount"),
    };
  }

  async markChatReplyRead(
    channel: CommunityChatChannelSlug,
    messageId: string,
  ): Promise<CommunityChatReplyReadResult> {
    const response = await this.request(
      `/api/v1/community/chats/${encodeURIComponent(channel)}/replies/${encodeURIComponent(messageId)}`,
      { method: "POST" },
    );
    const payload = await responseJson(response);
    if (!response.ok) throw responseError(response, payload);
    const result = recordField(payload, "result");
    const status = stringField(result, "status");
    if (status !== "read" && status !== "already_read") {
      throw invalidResponse(
        "The chat reply acknowledgement was not recognized.",
      );
    }
    return { status };
  }

  async advanceChatReadCursor(
    channel: CommunityChatChannelSlug,
    messageId: string,
  ): Promise<CommunityChatReadResult> {
    const response = await this.request(
      `/api/v1/community/chats/${encodeURIComponent(channel)}/read`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      },
    );
    const payload = await responseJson(response);
    if (!response.ok) throw responseError(response, payload);
    const result = recordField(payload, "result");
    const status = stringField(result, "status");
    if (status !== "advanced" && status !== "unchanged") {
      throw invalidResponse(
        "The chat read acknowledgement was not recognized.",
      );
    }
    return {
      status,
      lastReadMessageId: stringField(result, "lastReadMessageId"),
    };
  }

  async postChatMessage(
    channel: CommunityChatChannelSlug,
    body: string,
    clientNonce: string,
    replyToMessageId: string | null = null,
  ): Promise<CommunityChatPostResult> {
    const response = await this.request(
      `/api/v1/community/chats/${encodeURIComponent(channel)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, clientNonce, replyToMessageId }),
      },
    );
    const payload = await responseJson(response);
    if (!response.ok) throw responseError(response, payload);
    const result = recordField(payload, "result");
    const status = stringField(result, "status");
    if (status !== "sent" && status !== "already_sent") {
      throw invalidResponse(
        "The sent chat message response was not recognized.",
      );
    }
    return { status, message: parseChatMessage(result.message) };
  }

  async deleteMessage(messageId: string): Promise<CommunityDeleteResult> {
    const response = await this.request(
      `/api/v1/community/messages/${encodeURIComponent(messageId)}`,
      { method: "DELETE" },
    );
    const payload = await responseJson(response);
    if (!response.ok) throw responseError(response, payload);
    const result = recordField(payload, "result");
    const status = stringField(result, "status");
    if (status !== "deleted" && status !== "already_deleted") {
      throw invalidResponse("The delete response was not recognized.");
    }
    return { status };
  }

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    let token = await this.accessToken();
    if (!token) {
      throw new CommunityApiError(
        "authentication",
        "Sign in with GitHub to open the Glow community.",
        401,
      );
    }

    let response: Response;
    try {
      response = await this.fetchWithToken(path, token, init);
      if (response.status === 401) {
        token = await this.refreshAccessToken();
        if (token) response = await this.fetchWithToken(path, token, init);
      }
    } catch (error) {
      throw new CommunityApiError(
        "offline",
        error instanceof Error
          ? error.message
          : "Glow could not reach the community.",
      );
    }
    return response;
  }

  private fetchWithToken(
    path: string,
    token: string,
    init: RequestInit,
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    headers.set("Authorization", `Bearer ${token}`);
    return this.fetchImpl(new URL(path, this.origin), { ...init, headers });
  }
}

function parseMembershipProfile(
  value: Record<string, unknown>,
): NonNullable<CommunityMembership["profile"]> {
  return {
    userId: stringField(value, "userId"),
    handle: stringField(value, "handle"),
    displayName: nullableStringField(value, "displayName"),
    avatarUrl: nullableStringField(value, "avatarUrl"),
  };
}

function parseMemberProfile(
  value: Record<string, unknown>,
): CommunityMemberProfile {
  return {
    userId: stringField(value, "userId"),
    handle: stringField(value, "handle"),
    displayName: nullableStringField(value, "displayName"),
    avatarUrl: nullableStringField(value, "avatarUrl"),
    bio: nullableStringField(value, "bio"),
    isOwner: booleanField(value, "isOwner"),
  };
}

function parseAffirmationFeedItem(
  value: unknown,
): CommunityAffirmationFeedItem {
  const item = asRecord(value, "community affirmation");
  const author = recordField(item, "author");
  const affirmation = recordField(item, "affirmation");
  const engagement = recordField(item, "engagement");
  const permissions = recordField(item, "permissions");
  return {
    id: stringField(item, "id"),
    createdAt: stringField(item, "createdAt"),
    author: {
      userId: stringField(author, "userId"),
      handle: stringField(author, "handle"),
      displayName: nullableStringField(author, "displayName"),
      avatarUrl: nullableStringField(author, "avatarUrl"),
    },
    affirmation: {
      text: stringField(affirmation, "text"),
      contentVersion: nonnegativeIntegerField(
        affirmation,
        "contentVersion",
        true,
      ),
    },
    engagement: {
      glowCount: nonnegativeIntegerField(engagement, "glowCount"),
      glowed: booleanField(engagement, "glowed"),
    },
    permissions: {
      canDelete: booleanField(permissions, "canDelete"),
      canReport: booleanField(permissions, "canReport"),
      canBlock: booleanField(permissions, "canBlock"),
    },
  };
}

function parseChatChannel(value: unknown): CommunityChatChannel {
  const channel = asRecord(value, "community chat channel");
  const slug = stringField(channel, "slug");
  if (!isCommunityChatChannelSlug(slug)) {
    throw invalidResponse("Invalid community chat channel slug.");
  }
  return {
    id: stringField(channel, "id"),
    slug,
    name: stringField(channel, "name"),
    description: nullableStringField(channel, "description"),
  };
}

function parseChatMessage(value: unknown): CommunityChatMessage {
  const message = asRecord(value, "community chat message");
  const channelSlug = stringField(message, "channelSlug");
  if (!isCommunityChatChannelSlug(channelSlug)) {
    throw invalidResponse("Invalid community chat message channel.");
  }
  const author = recordField(message, "author");
  const permissions = recordField(message, "permissions");
  const replyValue = message.replyTo;
  const reply = replyValue === null ? null : asRecord(replyValue, "chat reply");
  const replyAuthor = reply ? recordField(reply, "author") : null;
  return {
    id: stringField(message, "id"),
    channelSlug,
    body: stringField(message, "body"),
    createdAt: stringField(message, "createdAt"),
    author: {
      userId: stringField(author, "userId"),
      handle: stringField(author, "handle"),
      displayName: nullableStringField(author, "displayName"),
      avatarUrl: nullableStringField(author, "avatarUrl"),
    },
    replyTo:
      reply && replyAuthor
        ? {
            id: stringField(reply, "id"),
            body: stringField(reply, "body"),
            author: {
              handle: stringField(replyAuthor, "handle"),
              displayName: nullableStringField(replyAuthor, "displayName"),
            },
          }
        : null,
    seenByOther: booleanField(message, "seenByOther"),
    permissions: {
      canDelete: booleanField(permissions, "canDelete"),
      canReport: booleanField(permissions, "canReport"),
      canBlock: booleanField(permissions, "canBlock"),
    },
  };
}

export function isCommunityChatChannelSlug(
  value: unknown,
): value is CommunityChatChannelSlug {
  return (
    typeof value === "string" &&
    value.length >= 2 &&
    value.length <= 64 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)
  );
}

function responseError(
  response: Response,
  payload: Record<string, unknown>,
): CommunityApiError {
  const code = typeof payload.error === "string" ? payload.error : null;
  if (response.status === 401) {
    return new CommunityApiError(
      "authentication",
      "Your Glow session has expired.",
      response.status,
    );
  }
  if (response.status === 403 && code === "not_member") {
    return new CommunityApiError(
      "not_member",
      "Set up your community profile on the web before opening the feed.",
      response.status,
    );
  }
  if (response.status === 403 && code === "premium_required") {
    return new CommunityApiError(
      "premium_required",
      "Glow Premium is required to join the conversation.",
      response.status,
    );
  }
  if (response.status === 429 || code === "rate_limited") {
    return new CommunityApiError(
      "service",
      "Slow down for a moment before sending another message.",
      response.status,
    );
  }
  return new CommunityApiError(
    "service",
    response.status >= 500
      ? "Glow community is temporarily unavailable."
      : "That community request could not be completed.",
    response.status,
  );
}

async function responseJson(
  response: Response,
): Promise<Record<string, unknown>> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new CommunityApiError(
      "invalid_response",
      response.status === 404
        ? "This Glow community action is not available on the server yet."
        : "Glow community returned an unexpected response.",
      response.status,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new CommunityApiError(
      "invalid_response",
      "Glow community returned an unreadable response.",
      response.status,
    );
  }
  return asRecord(payload, "community response");
}

function invalidResponse(message: string): CommunityApiError {
  return new CommunityApiError("invalid_response", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw invalidResponse(`Invalid ${label}.`);
  return value;
}

function recordField(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  return asRecord(value[key], key);
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.length === 0) {
    throw invalidResponse(`Invalid ${key}.`);
  }
  return field;
}

function nullableStringField(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const field = value[key];
  if (field === null) return null;
  if (typeof field !== "string") throw invalidResponse(`Invalid ${key}.`);
  return field;
}

function booleanField(value: Record<string, unknown>, key: string): boolean {
  const field = value[key];
  if (typeof field !== "boolean") throw invalidResponse(`Invalid ${key}.`);
  return field;
}

function nonnegativeIntegerField(
  value: Record<string, unknown>,
  key: string,
  positive = false,
): number {
  const field = value[key];
  if (
    typeof field !== "number" ||
    !Number.isInteger(field) ||
    field < (positive ? 1 : 0)
  ) {
    throw invalidResponse(`Invalid ${key}.`);
  }
  return field;
}
