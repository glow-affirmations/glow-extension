import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import {
  isCommunityChatChannelSlug,
  type CommunityAffirmationFeedItem,
  type CommunityChatChannel,
  type CommunityChatChannelSlug,
  type CommunityChatPage,
  type CommunityChatReadCursorChange,
  type CommunityChatReadResult,
  type CommunityChatPostResult,
  type CommunityChatRealtimeChange,
  type CommunityChatReplyReadResult,
  type CommunityDeleteResult,
  type CommunityFeedPage,
  type CommunityLibraryImportResult,
  type CommunityMemberProfile,
  type CommunityMembership,
  type CommunityReactionResult,
  type CommunityUnreadChatReplies,
} from "./community.js";
import { errorMessage } from "./errorMessage.js";

export type CommunityPanelUser = {
  id: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  canContribute: boolean;
};

type CommunitySurfaceTab = "affirmations" | "chats";
type CommunitySurfacePreference = {
  userId: string;
  activeTab: CommunitySurfaceTab;
  activeChatChannel: CommunityChatChannelSlug | null;
};
type CachedCommunityChat = {
  items: CommunityChatPage["items"];
  nextCursor: string | null;
  historyLimited: boolean;
  unreadReplies: CommunityChatPage["items"];
  unreadReplyTotal: number;
  error: string | null;
};

export type CommunityPanelBridge = {
  getUser(): CommunityPanelUser | null;
  isOnline(): boolean;
  onDidChangeUser(
    listener: (user: CommunityPanelUser | null) => void,
  ): vscode.Disposable;
  membership(): Promise<CommunityMembership>;
  affirmations(cursor?: string | null): Promise<CommunityFeedPage>;
  profile(handle: string): Promise<CommunityMemberProfile>;
  profileAffirmations(
    handle: string,
    cursor?: string | null,
  ): Promise<CommunityFeedPage>;
  chatChannels(): Promise<CommunityChatChannel[]>;
  chatMessages(
    channel: CommunityChatChannelSlug,
    cursor?: string | null,
  ): Promise<CommunityChatPage>;
  unreadChatReplies(
    channel: CommunityChatChannelSlug,
  ): Promise<CommunityUnreadChatReplies>;
  markChatReplyRead(
    channel: CommunityChatChannelSlug,
    messageId: string,
  ): Promise<CommunityChatReplyReadResult>;
  advanceChatReadCursor(
    channel: CommunityChatChannelSlug,
    messageId: string,
  ): Promise<CommunityChatReadResult>;
  subscribeToChatChannel(
    channelId: string,
    listener: (change: CommunityChatRealtimeChange) => void,
    readCursorListener: (change: CommunityChatReadCursorChange) => void,
  ): Promise<vscode.Disposable>;
  postChatMessage(
    channel: CommunityChatChannelSlug,
    body: string,
    clientNonce: string,
    replyToMessageId?: string | null,
  ): Promise<CommunityChatPostResult>;
  deleteMessage(messageId: string): Promise<CommunityDeleteResult>;
  audio(messageId: string): Promise<{ mimeType: string; data: ArrayBuffer }>;
  setReaction(
    messageId: string,
    active: boolean,
  ): Promise<CommunityReactionResult>;
  addToLibrary(messageId: string): Promise<CommunityLibraryImportResult>;
  refreshLibrarySilently(): Promise<void>;
  openPremium(): Promise<void>;
  signOut(): Promise<void>;
  setNetworkAvailable(available: boolean): void;
};

type CommunitySnapshot = {
  identity: CommunityPanelUser & { handle: string };
  activeTab: CommunitySurfaceTab;
  items: CommunityAffirmationFeedItem[];
  nextCursor: string | null;
  chat: {
    channels: CommunityChatChannel[];
    activeChannelSlug: CommunityChatChannelSlug | null;
    items: CommunityChatPage["items"];
    nextCursor: string | null;
    historyLimited: boolean;
    unreadReplies: CommunityChatPage["items"];
    unreadReplyTotal: number;
    error: string | null;
  };
};

type CommunityViewState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "not_member" }
  | { status: "ready"; data: CommunitySnapshot }
  | { status: "error"; message: string };

type CommunityToExtensionMessage =
  | { type: "communityReady" }
  | { type: "communityNetworkStatus"; online: boolean }
  | { type: "loadMoreCommunityAffirmations" }
  | { type: "openCommunityProfile"; handle: string }
  | { type: "closeCommunityProfile" }
  | { type: "loadMoreCommunityProfileAffirmations" }
  | { type: "setCommunitySurfaceTab"; activeTab: CommunitySurfaceTab }
  | {
      type: "selectCommunityChatChannel";
      channelSlug: CommunityChatChannelSlug;
    }
  | { type: "loadMoreCommunityChatMessages" }
  | {
      type: "focusCommunityChatMessage";
      channelSlug: CommunityChatChannelSlug;
      messageId: string;
      requestId: string;
    }
  | {
      type: "acknowledgeCommunityChatReply";
      channelSlug: CommunityChatChannelSlug;
      messageId: string;
    }
  | {
      type: "acknowledgeCommunityChatRead";
      channelSlug: CommunityChatChannelSlug;
      messageId: string;
    }
  | {
      type: "postCommunityChatMessage";
      channelSlug: CommunityChatChannelSlug;
      body: string;
      clientNonce: string;
      replyToMessageId?: string | null;
    }
  | { type: "openCommunityPremium" }
  | { type: "openCommunityDashboard" }
  | { type: "signOutCommunity" }
  | { type: "deleteCommunityChatMessage"; messageId: string }
  | {
      type: "deleteCommunityChatMessages";
      channelSlug: CommunityChatChannelSlug;
      messageIds: string[];
    }
  | { type: "playCommunityAffirmation"; messageId: string; requestId: string }
  | { type: "setCommunityReaction"; messageId: string; active: boolean }
  | { type: "addCommunityAffirmationToLibrary"; messageId: string }
  | { type: "openCommunityOnWeb"; destination: "chats" | "profile" | "compose" }
  | { type: "focusGlow" };

type ExtensionToCommunityMessage =
  | { type: "communityState"; state: CommunityViewState }
  | { type: "communityPageLoading" }
  | { type: "communityPageLoaded"; page: CommunityFeedPage }
  | { type: "communityPageFailed"; message: string }
  | { type: "communityProfileLoading"; handle: string }
  | {
      type: "communityProfileLoaded";
      profile: CommunityMemberProfile;
      page: CommunityFeedPage;
      mode: "replace" | "append";
    }
  | { type: "communityProfileFailed"; handle: string; message: string }
  | { type: "communityChatLoading"; channelSlug: CommunityChatChannelSlug }
  | {
      type: "communityChatLoaded";
      channelSlug: CommunityChatChannelSlug;
      page: CommunityChatPage;
      mode: "replace" | "prepend" | "sync";
    }
  | {
      type: "communityChatFailed";
      channelSlug: CommunityChatChannelSlug;
      message: string;
    }
  | {
      type: "communityChatUnreadRepliesLoaded";
      channelSlug: CommunityChatChannelSlug;
      replies: CommunityUnreadChatReplies;
    }
  | {
      type: "communityChatFocusReady";
      channelSlug: CommunityChatChannelSlug;
      messageId: string;
      requestId: string;
      found: boolean;
    }
  | {
      type: "communityChatReadSettled";
      channelSlug: CommunityChatChannelSlug;
      messageId: string;
      success: boolean;
    }
  | {
      type: "communityChatPostSettled";
      channelSlug: CommunityChatChannelSlug;
      clientNonce: string;
      result: CommunityChatPostResult | null;
      message: string | null;
    }
  | {
      type: "communityChatDeleteSettled";
      messageId: string;
      result: CommunityDeleteResult | null;
      message: string | null;
    }
  | {
      type: "communityChatDeleteManySettled";
      channelSlug: CommunityChatChannelSlug;
      results: Array<{
        messageId: string;
        result: CommunityDeleteResult | null;
        message: string | null;
      }>;
    }
  | {
      type: "communityAudioData";
      requestId: string;
      messageId: string;
      mimeType: string;
      data: ArrayBuffer;
    }
  | {
      type: "communityAudioError";
      requestId: string;
      messageId: string;
      message: string;
    }
  | {
      type: "communityReactionSettled";
      messageId: string;
      result: CommunityReactionResult | null;
      message: string | null;
    }
  | {
      type: "communityLibrarySettled";
      messageId: string;
      result: CommunityLibraryImportResult | null;
      message: string | null;
    };

const COMMUNITY_URL = "https://justglow.dev/community";
const COMMUNITY_SURFACE_PREFERENCE_KEY = "glow.community.surface.v1";

export class GlowCommunityPanel implements vscode.Disposable {
  static readonly viewType = "glow.community";
  private panel: vscode.WebviewPanel | undefined;
  private snapshot: CommunitySnapshot | null = null;
  private loadSequence = 0;
  private pageLoad: Promise<void> | null = null;
  private profileLoad: Promise<void> | null = null;
  private profileSequence = 0;
  private activeProfile: {
    profile: CommunityMemberProfile;
    items: CommunityAffirmationFeedItem[];
    nextCursor: string | null;
  } | null = null;
  private chatLoad: Promise<void> | null = null;
  private chatRealtimeSubscription: vscode.Disposable | null = null;
  private chatRealtimeSequence = 0;
  private chatRealtimeSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private chatRealtimeSyncRunning = false;
  private readonly pendingChatRealtimeChanges = new Map<
    string,
    CommunityChatRealtimeChange["operation"]
  >();
  private readonly chatCache = new Map<
    CommunityChatChannelSlug,
    CachedCommunityChat
  >();
  private readonly chatRefreshes = new Map<
    CommunityChatChannelSlug,
    Promise<void>
  >();
  private lastUserKey: string | null = null;
  private readonly userSubscription: vscode.Disposable;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly globalState: vscode.Memento,
    private readonly bridge: CommunityPanelBridge,
  ) {
    this.userSubscription = bridge.onDidChangeUser((user) => {
      const userKey = user ? `${user.id}:${user.canContribute}` : null;
      if (userKey === this.lastUserKey) return;
      this.lastUserKey = userKey;
      this.chatCache.clear();
      this.chatRefreshes.clear();
      if (this.panel) void this.loadCommunity(false);
    });
  }

  dispose(): void {
    this.loadSequence += 1;
    this.disposeChatRealtime();
    this.userSubscription.dispose();
    this.panel?.dispose();
    this.panel = undefined;
    this.snapshot = null;
    this.profileSequence += 1;
    this.activeProfile = null;
  }

  async show(): Promise<void> {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      return;
    }

    const webviewRoot = vscode.Uri.joinPath(
      this.extensionUri,
      "dist",
      "webview",
    );
    const panel = vscode.window.createWebviewPanel(
      GlowCommunityPanel.viewType,
      "Community",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [webviewRoot],
      },
    );
    panel.iconPath = {
      light: vscode.Uri.joinPath(
        this.extensionUri,
        "media",
        "glow-tab-light.svg",
      ),
      dark: vscode.Uri.joinPath(
        this.extensionUri,
        "media",
        "glow-tab-dark.svg",
      ),
    };
    this.panel = panel;
    const currentUser = this.bridge.getUser();
    this.lastUserKey = currentUser
      ? `${currentUser.id}:${currentUser.canContribute}`
      : null;

    panel.onDidDispose(() => {
      if (this.panel !== panel) return;
      this.loadSequence += 1;
      this.disposeChatRealtime();
      this.panel = undefined;
      this.snapshot = null;
      this.profileSequence += 1;
      this.activeProfile = null;
    });
    panel.webview.onDidReceiveMessage(
      (message: CommunityToExtensionMessage) => {
        void this.handleMessage(message).catch((error) => {
          console.warn(
            "[Glow community] Could not process a community action.",
            errorMessage(error),
          );
        });
      },
    );
    panel.webview.html = await panelHtml(
      panel.webview,
      webviewRoot,
      "community",
      "Community",
    );
  }

  private async handleMessage(
    message: CommunityToExtensionMessage,
  ): Promise<void> {
    switch (message.type) {
      case "communityReady":
        await this.loadCommunity(true);
        return;
      case "communityNetworkStatus":
        this.bridge.setNetworkAvailable(message.online);
        return;
      case "loadMoreCommunityAffirmations":
        await this.loadMore();
        return;
      case "openCommunityProfile":
        await this.openProfile(message.handle);
        return;
      case "closeCommunityProfile":
        this.profileSequence += 1;
        this.activeProfile = null;
        return;
      case "loadMoreCommunityProfileAffirmations":
        await this.loadMoreProfileAffirmations();
        return;
      case "setCommunitySurfaceTab":
        await this.setSurfaceTab(message.activeTab);
        return;
      case "selectCommunityChatChannel":
        await this.selectChatChannel(message.channelSlug);
        return;
      case "loadMoreCommunityChatMessages":
        await this.loadMoreChatMessages();
        return;
      case "focusCommunityChatMessage":
        await this.focusChatMessage(
          message.channelSlug,
          message.messageId,
          message.requestId,
        );
        return;
      case "acknowledgeCommunityChatReply":
        await this.acknowledgeChatReply(message.channelSlug, message.messageId);
        return;
      case "acknowledgeCommunityChatRead":
        await this.acknowledgeChatRead(message.channelSlug, message.messageId);
        return;
      case "postCommunityChatMessage":
        await this.postChatMessage(
          message.channelSlug,
          message.body,
          message.clientNonce,
          message.replyToMessageId,
        );
        return;
      case "openCommunityPremium":
        await this.bridge.openPremium();
        return;
      case "openCommunityDashboard":
        await vscode.commands.executeCommand("glow.openDashboard");
        return;
      case "signOutCommunity":
        await this.bridge.signOut();
        return;
      case "deleteCommunityChatMessage":
        await this.deleteChatMessage(message.messageId);
        return;
      case "deleteCommunityChatMessages":
        await this.deleteChatMessages(message.channelSlug, message.messageIds);
        return;
      case "playCommunityAffirmation":
        await this.sendAudio(message.messageId, message.requestId);
        return;
      case "setCommunityReaction":
        await this.setReaction(message.messageId, message.active);
        return;
      case "addCommunityAffirmationToLibrary":
        await this.addToLibrary(message.messageId);
        return;
      case "openCommunityOnWeb":
        await this.openOnWeb(message.destination);
        return;
      case "focusGlow":
        await vscode.commands.executeCommand("workbench.view.extension.glow");
        return;
    }
  }

  private async loadCommunity(showLoading: boolean): Promise<void> {
    const panel = this.panel;
    if (!panel) return;
    const sequence = ++this.loadSequence;
    this.profileSequence += 1;
    this.activeProfile = null;
    if (showLoading)
      await this.post({ type: "communityState", state: { status: "loading" } });

    const user = this.bridge.getUser();
    if (!user) {
      this.disposeChatRealtime();
      this.snapshot = null;
      await this.post({
        type: "communityState",
        state: { status: "signed_out" },
      });
      return;
    }
    if (!this.bridge.isOnline()) {
      await this.post({
        type: "communityState",
        state: {
          status: "error",
          message: "Connect to the internet to open the community.",
        },
      });
      return;
    }

    try {
      const membership = await this.bridge.membership();
      if (this.panel !== panel || sequence !== this.loadSequence) return;
      if (!membership.joined || !membership.profile) {
        this.snapshot = null;
        await this.post({
          type: "communityState",
          state: { status: "not_member" },
        });
        return;
      }

      const page = await this.bridge.affirmations();
      if (this.panel !== panel || sequence !== this.loadSequence) return;
      const preference = this.readSurfacePreference(user.id);
      let chat: CommunitySnapshot["chat"] = {
        channels: [],
        activeChannelSlug: null,
        items: [],
        nextCursor: null,
        historyLimited: false,
        unreadReplies: [],
        unreadReplyTotal: 0,
        error: null,
      };
      let shouldRefreshCachedChat = false;
      try {
        const channels = await this.bridge.chatChannels();
        const activeChannelSlug = channels.some(
          (channel) => channel.slug === preference.activeChatChannel,
        )
          ? preference.activeChatChannel
          : (channels[0]?.slug ?? null);
        const cached = activeChannelSlug
          ? this.chatCache.get(activeChannelSlug)
          : undefined;
        shouldRefreshCachedChat = Boolean(cached);
        const [chatPage, unreadReplies] =
          activeChannelSlug && !cached
            ? await Promise.all([
                this.bridge.chatMessages(activeChannelSlug),
                this.bridge.unreadChatReplies(activeChannelSlug),
              ])
            : [
                {
                  items: cached?.items ?? [],
                  nextCursor: cached?.nextCursor ?? null,
                  historyLimited: cached?.historyLimited ?? false,
                },
                {
                  items: cached?.unreadReplies ?? [],
                  totalCount: cached?.unreadReplyTotal ?? 0,
                },
              ];
        chat = {
          channels,
          activeChannelSlug,
          items: chatPage.items,
          nextCursor: chatPage.nextCursor,
          historyLimited: chatPage.historyLimited,
          unreadReplies: unreadReplies.items,
          unreadReplyTotal: unreadReplies.totalCount,
          error: null,
        };
        if (activeChannelSlug) this.cacheChat(activeChannelSlug, chat);
      } catch (error) {
        chat.error = communityErrorMessage(error);
      }
      if (this.panel !== panel || sequence !== this.loadSequence) return;
      this.snapshot = {
        identity: { ...user, handle: membership.profile.handle },
        activeTab: preference.activeTab,
        items: page.items,
        nextCursor: page.nextCursor,
        chat,
      };
      await this.post({
        type: "communityState",
        state: { status: "ready", data: this.snapshot },
      });
      void this.switchChatRealtimeSubscription(chat.activeChannelSlug);
      if (chat.activeChannelSlug && shouldRefreshCachedChat) {
        void this.refreshChatChannel(chat.activeChannelSlug);
      }
    } catch (error) {
      if (this.panel !== panel || sequence !== this.loadSequence) return;
      await this.post({
        type: "communityState",
        state: { status: "error", message: communityErrorMessage(error) },
      });
    }
  }

  private async selectChatChannel(
    channelSlug: CommunityChatChannelSlug,
  ): Promise<void> {
    if (!this.snapshot || !this.bridge.isOnline()) return;
    if (
      !this.snapshot.chat.channels.some(
        (channel) => channel.slug === channelSlug,
      )
    )
      return;
    if (this.snapshot.chat.activeChannelSlug === channelSlug) return;

    this.cacheActiveChat();
    await this.rememberSurface({ activeChatChannel: channelSlug });
    const cached = this.chatCache.get(channelSlug);
    if (cached) {
      this.snapshot = {
        ...this.snapshot,
        chat: {
          ...this.snapshot.chat,
          activeChannelSlug: channelSlug,
          ...this.cloneCachedChat(cached),
        },
      };
      await this.post({
        type: "communityChatLoaded",
        channelSlug,
        page: {
          items: cached.items,
          nextCursor: cached.nextCursor,
          historyLimited: cached.historyLimited,
        },
        mode: "replace",
      });
      await this.post({
        type: "communityChatUnreadRepliesLoaded",
        channelSlug,
        replies: {
          items: cached.unreadReplies,
          totalCount: cached.unreadReplyTotal,
        },
      });
      void this.switchChatRealtimeSubscription(channelSlug);
      void this.refreshChatChannel(channelSlug);
      return;
    }

    if (this.chatLoad) await this.chatLoad;
    const pending = (async () => {
      this.snapshot = {
        ...this.snapshot!,
        chat: {
          ...this.snapshot!.chat,
          activeChannelSlug: channelSlug,
          items: [],
          nextCursor: null,
          historyLimited: false,
          unreadReplies: [],
          unreadReplyTotal: 0,
          error: null,
        },
      };
      await this.post({ type: "communityChatLoading", channelSlug });
      try {
        const [page, unreadReplies] = await Promise.all([
          this.bridge.chatMessages(channelSlug),
          this.bridge.unreadChatReplies(channelSlug),
        ]);
        if (
          !this.snapshot?.chat.channels.some(
            (channel) => channel.slug === channelSlug,
          )
        )
          return;
        this.snapshot = {
          ...this.snapshot,
          chat: {
            ...this.snapshot.chat,
            activeChannelSlug: channelSlug,
            items: page.items,
            nextCursor: page.nextCursor,
            historyLimited: page.historyLimited,
            unreadReplies: unreadReplies.items,
            unreadReplyTotal: unreadReplies.totalCount,
            error: null,
          },
        };
        this.cacheActiveChat();
        await this.post({
          type: "communityChatLoaded",
          channelSlug,
          page,
          mode: "replace",
        });
        await this.post({
          type: "communityChatUnreadRepliesLoaded",
          channelSlug,
          replies: unreadReplies,
        });
        void this.switchChatRealtimeSubscription(channelSlug);
      } catch (error) {
        const message = communityErrorMessage(error);
        if (this.snapshot?.chat.activeChannelSlug === channelSlug) {
          this.snapshot = {
            ...this.snapshot,
            chat: { ...this.snapshot.chat, error: message },
          };
        }
        await this.post({ type: "communityChatFailed", channelSlug, message });
      }
    })();
    this.chatLoad = pending;
    try {
      await pending;
    } finally {
      if (this.chatLoad === pending) this.chatLoad = null;
    }
  }

  private async setSurfaceTab(activeTab: CommunitySurfaceTab): Promise<void> {
    if (!this.snapshot || this.snapshot.activeTab === activeTab) return;
    this.snapshot = { ...this.snapshot, activeTab };
    await this.rememberSurface({ activeTab });
  }

  private readSurfacePreference(userId: string): CommunitySurfacePreference {
    const fallback: CommunitySurfacePreference = {
      userId,
      activeTab: "affirmations",
      activeChatChannel: null,
    };
    const stored = this.globalState.get<unknown>(
      COMMUNITY_SURFACE_PREFERENCE_KEY,
    );
    if (!stored || typeof stored !== "object") return fallback;
    const candidate = stored as Partial<CommunitySurfacePreference>;
    if (candidate.userId !== userId) return fallback;
    const activeTab =
      candidate.activeTab === "chats" || candidate.activeTab === "affirmations"
        ? candidate.activeTab
        : fallback.activeTab;
    const activeChatChannel = isCommunityChatChannelSlug(
      candidate.activeChatChannel,
    )
      ? candidate.activeChatChannel
      : null;
    return { userId, activeTab, activeChatChannel };
  }

  private async rememberSurface(
    update: Partial<Omit<CommunitySurfacePreference, "userId">>,
  ): Promise<void> {
    const user = this.bridge.getUser();
    if (!user) return;
    const current = this.readSurfacePreference(user.id);
    await this.globalState.update(COMMUNITY_SURFACE_PREFERENCE_KEY, {
      ...current,
      ...update,
      userId: user.id,
    } satisfies CommunitySurfacePreference);
  }

  private cloneCachedChat(cached: CachedCommunityChat): CachedCommunityChat {
    return {
      ...cached,
      items: [...cached.items],
      unreadReplies: [...cached.unreadReplies],
    };
  }

  private cacheChat(
    channelSlug: CommunityChatChannelSlug,
    chat: CachedCommunityChat,
  ): void {
    this.chatCache.set(channelSlug, this.cloneCachedChat(chat));
  }

  private cacheActiveChat(): void {
    const chat = this.snapshot?.chat;
    if (!chat?.activeChannelSlug) return;
    this.cacheChat(chat.activeChannelSlug, chat);
  }

  private async refreshChatChannel(
    channelSlug: CommunityChatChannelSlug,
  ): Promise<void> {
    const existing = this.chatRefreshes.get(channelSlug);
    if (existing) return existing;
    const refresh = (async () => {
      try {
        const [page, unreadReplies] = await Promise.all([
          this.bridge.chatMessages(channelSlug),
          this.bridge.unreadChatReplies(channelSlug),
        ]);
        const previous = this.chatCache.get(channelSlug);
        const merged = new Map(
          previous?.items.map((item) => [item.id, item]) ?? [],
        );
        for (const item of page.items) merged.set(item.id, item);
        const items = page.historyLimited
          ? page.items
          : [...merged.values()].sort(compareCommunityChatMessages);
        const cached: CachedCommunityChat = {
          items,
          nextCursor: page.historyLimited
            ? null
            : (previous?.nextCursor ?? page.nextCursor),
          historyLimited: page.historyLimited,
          unreadReplies: unreadReplies.items,
          unreadReplyTotal: unreadReplies.totalCount,
          error: null,
        };
        this.cacheChat(channelSlug, cached);
        if (this.snapshot?.chat.activeChannelSlug !== channelSlug) return;
        this.snapshot = {
          ...this.snapshot,
          chat: {
            ...this.snapshot.chat,
            activeChannelSlug: channelSlug,
            ...this.cloneCachedChat(cached),
          },
        };
        await this.post({
          type: "communityChatLoaded",
          channelSlug,
          page: {
            items,
            nextCursor: cached.nextCursor,
            historyLimited: cached.historyLimited,
          },
          mode: "sync",
        });
        await this.post({
          type: "communityChatUnreadRepliesLoaded",
          channelSlug,
          replies: unreadReplies,
        });
      } catch (error) {
        console.warn(
          "[Glow community] Could not refresh the cached conversation.",
          errorMessage(error),
        );
      }
    })();
    this.chatRefreshes.set(channelSlug, refresh);
    try {
      await refresh;
    } finally {
      if (this.chatRefreshes.get(channelSlug) === refresh)
        this.chatRefreshes.delete(channelSlug);
    }
  }

  private async loadMoreChatMessages(): Promise<void> {
    const chat = this.snapshot?.chat;
    if (
      this.chatLoad ||
      !chat?.activeChannelSlug ||
      !chat.nextCursor ||
      !this.bridge.isOnline()
    )
      return;
    const { activeChannelSlug, nextCursor } = chat;
    const pending = (async () => {
      try {
        const page = await this.bridge.chatMessages(
          activeChannelSlug,
          nextCursor,
        );
        if (
          !this.snapshot ||
          this.snapshot.chat.activeChannelSlug !== activeChannelSlug
        )
          return;
        const known = new Set(this.snapshot.chat.items.map((item) => item.id));
        const prepended = page.items.filter((item) => !known.has(item.id));
        this.snapshot = {
          ...this.snapshot,
          chat: {
            ...this.snapshot.chat,
            items: [...prepended, ...this.snapshot.chat.items],
            nextCursor: page.nextCursor,
            error: null,
          },
        };
        this.cacheActiveChat();
        await this.post({
          type: "communityChatLoaded",
          channelSlug: activeChannelSlug,
          page: {
            items: prepended,
            nextCursor: page.nextCursor,
            historyLimited: page.historyLimited,
          },
          mode: "prepend",
        });
      } catch (error) {
        await this.post({
          type: "communityChatFailed",
          channelSlug: activeChannelSlug,
          message: communityErrorMessage(error),
        });
      }
    })();
    this.chatLoad = pending;
    try {
      await pending;
    } finally {
      if (this.chatLoad === pending) this.chatLoad = null;
    }
  }

  private async focusChatMessage(
    channelSlug: CommunityChatChannelSlug,
    messageId: string,
    requestId: string,
  ): Promise<void> {
    if (this.chatLoad) await this.chatLoad;
    if (
      !/^[1-9]\d*$/u.test(messageId) ||
      !this.snapshot ||
      this.snapshot.chat.activeChannelSlug !== channelSlug ||
      !this.bridge.isOnline()
    ) {
      await this.post({
        type: "communityChatFocusReady",
        channelSlug,
        messageId,
        requestId,
        found: false,
      });
      return;
    }

    const pending = (async () => {
      let cursor = this.snapshot?.chat.nextCursor ?? null;
      let found =
        this.snapshot?.chat.items.some((item) => item.id === messageId) ??
        false;
      let changed = false;

      for (
        let pageNumber = 0;
        !found && cursor && pageNumber < 20;
        pageNumber += 1
      ) {
        const page = await this.bridge.chatMessages(channelSlug, cursor);
        if (
          !this.snapshot ||
          this.snapshot.chat.activeChannelSlug !== channelSlug
        )
          break;

        const merged = new Map(
          this.snapshot.chat.items.map((item) => [item.id, item]),
        );
        for (const item of page.items) merged.set(item.id, item);
        const items = [...merged.values()].sort(compareCommunityChatMessages);
        cursor = page.nextCursor;
        found = items.some((item) => item.id === messageId);
        changed = true;
        this.snapshot = {
          ...this.snapshot,
          chat: {
            ...this.snapshot.chat,
            items,
            nextCursor: cursor,
            error: null,
          },
        };
        this.cacheActiveChat();
      }

      if (changed && this.snapshot?.chat.activeChannelSlug === channelSlug) {
        await this.post({
          type: "communityChatLoaded",
          channelSlug,
          page: {
            items: this.snapshot.chat.items,
            nextCursor: this.snapshot.chat.nextCursor,
            historyLimited: this.snapshot.chat.historyLimited,
          },
          mode: "sync",
        });
      }

      await this.post({
        type: "communityChatFocusReady",
        channelSlug,
        messageId,
        requestId,
        found,
      });
    })();

    this.chatLoad = pending;
    try {
      await pending;
    } catch (error) {
      await this.post({
        type: "communityChatFocusReady",
        channelSlug,
        messageId,
        requestId,
        found: false,
      });
      await this.post({
        type: "communityChatFailed",
        channelSlug,
        message: communityErrorMessage(error),
      });
    } finally {
      if (this.chatLoad === pending) this.chatLoad = null;
    }
  }

  private async acknowledgeChatReply(
    channelSlug: CommunityChatChannelSlug,
    messageId: string,
  ): Promise<void> {
    if (
      !this.snapshot ||
      this.snapshot.chat.activeChannelSlug !== channelSlug ||
      !this.bridge.isOnline()
    )
      return;

    try {
      await this.bridge.markChatReplyRead(channelSlug, messageId);
      const replies = await this.bridge.unreadChatReplies(channelSlug);
      if (
        !this.snapshot ||
        this.snapshot.chat.activeChannelSlug !== channelSlug
      )
        return;
      this.snapshot = {
        ...this.snapshot,
        chat: {
          ...this.snapshot.chat,
          unreadReplies: replies.items,
          unreadReplyTotal: replies.totalCount,
        },
      };
      this.cacheActiveChat();
      await this.post({
        type: "communityChatUnreadRepliesLoaded",
        channelSlug,
        replies,
      });
    } catch (error) {
      await this.post({
        type: "communityChatFailed",
        channelSlug,
        message: communityErrorMessage(error),
      });
    }
  }

  private disposeChatRealtime(): void {
    this.chatRealtimeSequence += 1;
    this.chatRealtimeSubscription?.dispose();
    this.chatRealtimeSubscription = null;
    if (this.chatRealtimeSyncTimer) {
      clearTimeout(this.chatRealtimeSyncTimer);
      this.chatRealtimeSyncTimer = null;
    }
    this.pendingChatRealtimeChanges.clear();
  }

  private async switchChatRealtimeSubscription(
    channelSlug: CommunityChatChannelSlug | null,
  ): Promise<void> {
    this.disposeChatRealtime();
    if (!channelSlug || !this.snapshot || !this.bridge.isOnline()) return;

    const channel = this.snapshot.chat.channels.find(
      (candidate) => candidate.slug === channelSlug,
    );
    if (!channel) return;

    const sequence = this.chatRealtimeSequence;
    try {
      const subscription = await this.bridge.subscribeToChatChannel(
        channel.id,
        (change) => this.scheduleChatRealtimeSync(channelSlug, change),
        (change) => void this.applyChatReadCursor(channelSlug, change),
      );
      if (
        sequence !== this.chatRealtimeSequence ||
        this.snapshot?.chat.activeChannelSlug !== channelSlug
      ) {
        subscription.dispose();
        return;
      }
      this.chatRealtimeSubscription = subscription;
    } catch (error) {
      // History loading and posting still work if the realtime transport drops.
      console.warn(
        "[Glow community] Live chat updates are temporarily unavailable.",
        errorMessage(error),
      );
    }
  }

  private scheduleChatRealtimeSync(
    channelSlug: CommunityChatChannelSlug,
    change: CommunityChatRealtimeChange,
  ): void {
    if (this.snapshot?.chat.activeChannelSlug !== channelSlug) return;
    this.pendingChatRealtimeChanges.set(change.messageId, change.operation);
    this.armChatRealtimeSync(channelSlug);
  }

  private async applyChatReadCursor(
    channelSlug: CommunityChatChannelSlug,
    change: CommunityChatReadCursorChange,
  ): Promise<void> {
    const snapshot = this.snapshot;
    if (
      !snapshot ||
      snapshot.chat.activeChannelSlug !== channelSlug ||
      change.readerUserId === snapshot.identity.id
    )
      return;
    let changed = false;
    const items = snapshot.chat.items.map((message) => {
      if (
        message.author.userId !== snapshot.identity.id ||
        compareCommunityChatMessageIds(message.id, change.lastReadMessageId) >
          0 ||
        message.seenByOther
      )
        return message;
      changed = true;
      return { ...message, seenByOther: true };
    });
    if (!changed) return;
    this.snapshot = {
      ...snapshot,
      chat: { ...snapshot.chat, items },
    };
    this.cacheActiveChat();
    await this.post({
      type: "communityChatLoaded",
      channelSlug,
      page: {
        items,
        nextCursor: this.snapshot.chat.nextCursor,
        historyLimited: this.snapshot.chat.historyLimited,
      },
      mode: "sync",
    });
  }

  private armChatRealtimeSync(channelSlug: CommunityChatChannelSlug): void {
    if (this.chatRealtimeSyncTimer || this.chatRealtimeSyncRunning) return;
    this.chatRealtimeSyncTimer = setTimeout(() => {
      this.chatRealtimeSyncTimer = null;
      void this.syncChatRealtimeChanges(channelSlug);
    }, 80);
  }

  private async syncChatRealtimeChanges(
    channelSlug: CommunityChatChannelSlug,
  ): Promise<void> {
    if (
      this.chatRealtimeSyncRunning ||
      this.snapshot?.chat.activeChannelSlug !== channelSlug ||
      this.pendingChatRealtimeChanges.size === 0
    )
      return;

    const sequence = this.chatRealtimeSequence;
    const changes = new Map(this.pendingChatRealtimeChanges);
    this.pendingChatRealtimeChanges.clear();
    this.chatRealtimeSyncRunning = true;
    try {
      const [page, unreadReplies] = await Promise.all([
        this.bridge.chatMessages(channelSlug),
        this.bridge.unreadChatReplies(channelSlug),
      ]);
      if (
        sequence !== this.chatRealtimeSequence ||
        !this.snapshot ||
        this.snapshot.chat.activeChannelSlug !== channelSlug
      )
        return;

      let items = page.items;
      if (!page.historyLimited) {
        const freshIds = new Set(page.items.map((item) => item.id));
        const removedIds = new Set(
          [...changes]
            .filter(
              ([messageId, operation]) =>
                operation !== "insert" && !freshIds.has(messageId),
            )
            .map(([messageId]) => messageId),
        );
        const merged = new Map(
          this.snapshot.chat.items
            .filter((item) => !removedIds.has(item.id))
            .map((item) => [item.id, item]),
        );
        for (const item of page.items) merged.set(item.id, item);
        items = [...merged.values()].sort(compareCommunityChatMessages);
      }
      this.snapshot = {
        ...this.snapshot,
        chat: {
          ...this.snapshot.chat,
          items,
          nextCursor: page.historyLimited
            ? null
            : this.snapshot.chat.nextCursor,
          historyLimited: page.historyLimited,
          unreadReplies: unreadReplies.items,
          unreadReplyTotal: unreadReplies.totalCount,
          error: null,
        },
      };
      this.cacheActiveChat();
      await this.post({
        type: "communityChatLoaded",
        channelSlug,
        page: {
          items,
          nextCursor: this.snapshot.chat.nextCursor,
          historyLimited: this.snapshot.chat.historyLimited,
        },
        mode: "sync",
      });
      await this.post({
        type: "communityChatUnreadRepliesLoaded",
        channelSlug,
        replies: unreadReplies,
      });
    } catch (error) {
      console.warn(
        "[Glow community] Could not refresh live chat messages.",
        errorMessage(error),
      );
    } finally {
      this.chatRealtimeSyncRunning = false;
      const activeChannel = this.snapshot?.chat.activeChannelSlug;
      if (activeChannel && this.pendingChatRealtimeChanges.size > 0)
        this.armChatRealtimeSync(activeChannel);
    }
  }

  private async acknowledgeChatRead(
    channelSlug: CommunityChatChannelSlug,
    messageId: string,
  ): Promise<void> {
    if (
      this.snapshot?.chat.activeChannelSlug !== channelSlug ||
      !/^[1-9]\d*$/u.test(messageId) ||
      !this.bridge.isOnline()
    ) {
      return;
    }
    try {
      await this.bridge.advanceChatReadCursor(channelSlug, messageId);
      await this.post({
        type: "communityChatReadSettled",
        channelSlug,
        messageId,
        success: true,
      });
    } catch (error) {
      await this.post({
        type: "communityChatReadSettled",
        channelSlug,
        messageId,
        success: false,
      });
      console.warn(
        "[Glow community] Could not acknowledge the visible chat position.",
        errorMessage(error),
      );
    }
  }

  private async postChatMessage(
    channelSlug: CommunityChatChannelSlug,
    body: string,
    clientNonce: string,
    replyToMessageId: string | null = null,
  ): Promise<void> {
    const trimmed = body.trim();
    if (!this.snapshot?.identity.canContribute) {
      await this.post({
        type: "communityChatPostSettled",
        channelSlug,
        clientNonce,
        result: null,
        message: "Glow Premium is required to join the conversation.",
      });
      return;
    }
    if (
      this.snapshot.chat.activeChannelSlug !== channelSlug ||
      trimmed.length === 0 ||
      trimmed.length > 4_000
    ) {
      await this.post({
        type: "communityChatPostSettled",
        channelSlug,
        clientNonce,
        result: null,
        message: "That message could not be sent.",
      });
      return;
    }
    if (!this.bridge.isOnline()) {
      await this.post({
        type: "communityChatPostSettled",
        channelSlug,
        clientNonce,
        result: null,
        message: "Connect to send a message.",
      });
      return;
    }
    try {
      const result = await this.bridge.postChatMessage(
        channelSlug,
        trimmed,
        clientNonce,
        replyToMessageId,
      );
      if (this.snapshot?.chat.activeChannelSlug === channelSlug) {
        const items = this.snapshot.chat.items.some(
          (item) => item.id === result.message.id,
        )
          ? this.snapshot.chat.items
          : [...this.snapshot.chat.items, result.message];
        this.snapshot = {
          ...this.snapshot,
          chat: { ...this.snapshot.chat, items },
        };
        this.cacheActiveChat();
      }
      await this.post({
        type: "communityChatPostSettled",
        channelSlug,
        clientNonce,
        result,
        message: null,
      });
    } catch (error) {
      await this.post({
        type: "communityChatPostSettled",
        channelSlug,
        clientNonce,
        result: null,
        message: communityErrorMessage(error),
      });
    }
  }

  private async deleteChatMessage(messageId: string): Promise<void> {
    if (!this.bridge.isOnline()) {
      await this.post({
        type: "communityChatDeleteSettled",
        messageId,
        result: null,
        message: "Connect to delete this message.",
      });
      return;
    }
    try {
      const result = await this.bridge.deleteMessage(messageId);
      if (this.snapshot) {
        this.snapshot = {
          ...this.snapshot,
          chat: {
            ...this.snapshot.chat,
            items: this.snapshot.chat.items.filter(
              (item) => item.id !== messageId,
            ),
          },
        };
        this.cacheActiveChat();
      }
      await this.post({
        type: "communityChatDeleteSettled",
        messageId,
        result,
        message: null,
      });
    } catch (error) {
      await this.post({
        type: "communityChatDeleteSettled",
        messageId,
        result: null,
        message: communityErrorMessage(error),
      });
    }
  }

  private async deleteChatMessages(
    channelSlug: CommunityChatChannelSlug,
    messageIds: string[],
  ): Promise<void> {
    const uniqueMessageIds = [...new Set(messageIds)].slice(0, 100);
    if (!this.bridge.isOnline()) {
      await this.post({
        type: "communityChatDeleteManySettled",
        channelSlug,
        results: uniqueMessageIds.map((messageId) => ({
          messageId,
          result: null,
          message: "Connect to delete these messages.",
        })),
      });
      return;
    }

    const results: Array<{
      messageId: string;
      result: CommunityDeleteResult | null;
      message: string | null;
    }> = [];
    for (let index = 0; index < uniqueMessageIds.length; index += 6) {
      results.push(
        ...(await Promise.all(
          uniqueMessageIds.slice(index, index + 6).map(async (messageId) => {
            try {
              return {
                messageId,
                result: await this.bridge.deleteMessage(messageId),
                message: null,
              };
            } catch (error) {
              return {
                messageId,
                result: null,
                message: communityErrorMessage(error),
              };
            }
          }),
        )),
      );
    }
    const deletedIds = new Set(
      results
        .filter(({ result }) => result !== null)
        .map(({ messageId }) => messageId),
    );
    const cached = this.chatCache.get(channelSlug);
    if (cached && deletedIds.size > 0) {
      this.chatCache.set(channelSlug, {
        ...cached,
        items: cached.items.filter((item) => !deletedIds.has(item.id)),
      });
    }
    if (
      this.snapshot &&
      this.snapshot.chat.activeChannelSlug === channelSlug &&
      deletedIds.size > 0
    ) {
      this.snapshot = {
        ...this.snapshot,
        chat: {
          ...this.snapshot.chat,
          items: this.snapshot.chat.items.filter(
            (item) => !deletedIds.has(item.id),
          ),
        },
      };
      this.cacheActiveChat();
    }
    await this.post({
      type: "communityChatDeleteManySettled",
      channelSlug,
      results,
    });
  }

  private async loadMore(): Promise<void> {
    if (this.pageLoad || !this.snapshot?.nextCursor || !this.bridge.isOnline())
      return;
    const cursor = this.snapshot.nextCursor;
    const pending = (async () => {
      await this.post({ type: "communityPageLoading" });
      try {
        const page = await this.bridge.affirmations(cursor);
        if (!this.snapshot) return;
        const known = new Set(this.snapshot.items.map((item) => item.id));
        const appended = page.items.filter((item) => !known.has(item.id));
        this.snapshot = {
          ...this.snapshot,
          items: [...this.snapshot.items, ...appended],
          nextCursor: page.nextCursor,
        };
        await this.post({
          type: "communityPageLoaded",
          page: { items: appended, nextCursor: page.nextCursor },
        });
      } catch (error) {
        await this.post({
          type: "communityPageFailed",
          message: communityErrorMessage(error),
        });
      }
    })();
    this.pageLoad = pending;
    try {
      await pending;
    } finally {
      if (this.pageLoad === pending) this.pageLoad = null;
    }
  }

  private async openProfile(handle: string): Promise<void> {
    const normalizedHandle = handle.trim().replace(/^@/u, "").toLowerCase();
    if (!/^[a-z0-9_]{3,32}$/u.test(normalizedHandle) || !this.bridge.isOnline())
      return;

    const sequence = ++this.profileSequence;
    const pending = (async () => {
      await this.post({
        type: "communityProfileLoading",
        handle: normalizedHandle,
      });
      try {
        const [profile, page] = await Promise.all([
          this.bridge.profile(normalizedHandle),
          this.bridge.profileAffirmations(normalizedHandle),
        ]);
        if (sequence !== this.profileSequence) return;
        this.activeProfile = {
          profile,
          items: page.items,
          nextCursor: page.nextCursor,
        };
        await this.post({
          type: "communityProfileLoaded",
          profile,
          page,
          mode: "replace",
        });
      } catch (error) {
        if (sequence !== this.profileSequence) return;
        this.activeProfile = null;
        await this.post({
          type: "communityProfileFailed",
          handle: normalizedHandle,
          message: communityErrorMessage(error),
        });
      }
    })();
    this.profileLoad = pending;
    try {
      await pending;
    } finally {
      if (this.profileLoad === pending) this.profileLoad = null;
    }
  }

  private async loadMoreProfileAffirmations(): Promise<void> {
    const active = this.activeProfile;
    if (this.profileLoad || !active?.nextCursor || !this.bridge.isOnline())
      return;

    const pending = (async () => {
      try {
        const page = await this.bridge.profileAffirmations(
          active.profile.handle,
          active.nextCursor,
        );
        if (this.activeProfile?.profile.handle !== active.profile.handle)
          return;
        const known = new Set(this.activeProfile.items.map((item) => item.id));
        const appended = page.items.filter((item) => !known.has(item.id));
        this.activeProfile = {
          ...this.activeProfile,
          items: [...this.activeProfile.items, ...appended],
          nextCursor: page.nextCursor,
        };
        await this.post({
          type: "communityProfileLoaded",
          profile: this.activeProfile.profile,
          page: { items: appended, nextCursor: page.nextCursor },
          mode: "append",
        });
      } catch (error) {
        await this.post({
          type: "communityProfileFailed",
          handle: active.profile.handle,
          message: communityErrorMessage(error),
        });
      }
    })();
    this.profileLoad = pending;
    try {
      await pending;
    } finally {
      if (this.profileLoad === pending) this.profileLoad = null;
    }
  }

  private async sendAudio(messageId: string, requestId: string): Promise<void> {
    if (!this.bridge.isOnline()) {
      await this.post({
        type: "communityAudioError",
        requestId,
        messageId,
        message: "Connect to listen to this affirmation.",
      });
      return;
    }
    try {
      const audio = await this.bridge.audio(messageId);
      await this.post({
        type: "communityAudioData",
        requestId,
        messageId,
        mimeType: audio.mimeType,
        data: audio.data,
      });
    } catch (error) {
      await this.post({
        type: "communityAudioError",
        requestId,
        messageId,
        message: communityErrorMessage(error),
      });
    }
  }

  private async setReaction(messageId: string, active: boolean): Promise<void> {
    if (!this.bridge.isOnline()) {
      await this.post({
        type: "communityReactionSettled",
        messageId,
        result: null,
        message: "Connect to react to this affirmation.",
      });
      return;
    }
    try {
      const result = await this.bridge.setReaction(messageId, active);
      this.updateReaction(messageId, result);
      await this.post({
        type: "communityReactionSettled",
        messageId,
        result,
        message: null,
      });
    } catch (error) {
      await this.post({
        type: "communityReactionSettled",
        messageId,
        result: null,
        message: communityErrorMessage(error),
      });
    }
  }

  private updateReaction(
    messageId: string,
    result: CommunityReactionResult,
  ): void {
    if (!this.snapshot) return;
    this.snapshot = {
      ...this.snapshot,
      items: this.snapshot.items.map((item) =>
        item.id === messageId
          ? {
              ...item,
              engagement: {
                glowed: result.glowed,
                glowCount: result.glowCount ?? item.engagement.glowCount,
              },
            }
          : item,
      ),
    };
  }

  private async addToLibrary(messageId: string): Promise<void> {
    if (!this.bridge.isOnline()) {
      await this.post({
        type: "communityLibrarySettled",
        messageId,
        result: null,
        message: "Connect to add this affirmation to your library.",
      });
      return;
    }
    try {
      const result = await this.bridge.addToLibrary(messageId);
      await this.post({
        type: "communityLibrarySettled",
        messageId,
        result,
        message: null,
      });
      if (result.status === "added" || result.status === "already_added") {
        void this.bridge.refreshLibrarySilently().catch((error) => {
          console.warn(
            "[Glow community] Library refresh was deferred.",
            errorMessage(error),
          );
        });
      }
    } catch (error) {
      await this.post({
        type: "communityLibrarySettled",
        messageId,
        result: null,
        message: communityErrorMessage(error),
      });
    }
  }

  private async openOnWeb(
    destination: "chats" | "profile" | "compose",
  ): Promise<void> {
    const handle = this.snapshot?.identity.handle;
    const url =
      destination === "chats"
        ? `${COMMUNITY_URL}?channel=chats`
        : destination === "profile"
          ? handle
            ? `${COMMUNITY_URL}/@${encodeURIComponent(handle)}`
            : `${COMMUNITY_URL}/profile`
          : COMMUNITY_URL;
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }

  private async post(message: ExtensionToCommunityMessage): Promise<void> {
    await this.panel?.webview.postMessage(message);
  }
}

function communityErrorMessage(error: unknown): string {
  const message = errorMessage(error);
  return message.length > 0
    ? message
    : "Glow community is temporarily unavailable.";
}

function compareCommunityChatMessages(
  left: CommunityChatPage["items"][number],
  right: CommunityChatPage["items"][number],
): number {
  const byCreatedAt = left.createdAt.localeCompare(right.createdAt);
  if (byCreatedAt !== 0) return byCreatedAt;
  return BigInt(left.id) < BigInt(right.id) ? -1 : left.id === right.id ? 0 : 1;
}

function compareCommunityChatMessageIds(left: string, right: string): number {
  if (left.length !== right.length) return left.length - right.length;
  return left.localeCompare(right);
}

async function panelHtml(
  webview: vscode.Webview,
  webviewRoot: vscode.Uri,
  viewMode: string,
  title: string,
): Promise<string> {
  const indexUri = vscode.Uri.joinPath(webviewRoot, "index.html");
  try {
    const bytes = await vscode.workspace.fs.readFile(indexUri);
    const assetRoot = webview.asWebviewUri(webviewRoot).toString(true);
    const baseUri = `${assetRoot}/`;
    const nonce = randomBytes(16).toString("base64");
    const modeScript = `<script nonce="${nonce}">document.documentElement.dataset.glowView = ${JSON.stringify(viewMode)};</script>`;
    return new TextDecoder()
      .decode(bytes)
      .replaceAll("__CSP_SOURCE__", webview.cspSource)
      .replaceAll("__CSP_NONCE__", nonce)
      .replaceAll("<script>", `<script nonce="${nonce}">`)
      .replaceAll('"/_app/', `"${assetRoot}/_app/`)
      .replace(
        /base: new URL\((['"])\.\1, location\)\.pathname\.slice\(0, -1\)/,
        (baseExpression) =>
          `${baseExpression},\n\t\t\t\t\t\tassets: ${JSON.stringify(assetRoot)}`,
      )
      .replace("<head>", `<head><base href="${baseUri}">${modeScript}`);
  } catch (error) {
    const message = escapeHtml(errorMessage(error));
    return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline';"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(title)}</title></head><body><h2>Community unavailable</h2><p>${message}</p></body></html>`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
