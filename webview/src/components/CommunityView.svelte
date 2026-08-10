<script lang="ts">
  import { onMount, tick } from "svelte";
  import PauseIcon from "phosphor-svelte/lib/PauseIcon";
  import FeatherIcon from "phosphor-svelte/lib/FeatherIcon";
  import ArrowBendUpLeftIcon from "phosphor-svelte/lib/ArrowBendUpLeftIcon";
  import ArrowDownIcon from "phosphor-svelte/lib/ArrowDownIcon";
  import ArrowLeftIcon from "phosphor-svelte/lib/ArrowLeftIcon";
  import ClockIcon from "phosphor-svelte/lib/ClockIcon";
  import CopySimpleIcon from "phosphor-svelte/lib/CopySimpleIcon";
  import LockSimpleIcon from "phosphor-svelte/lib/LockSimpleIcon";
  import PaperPlaneRightIcon from "phosphor-svelte/lib/PaperPlaneRightIcon";
  import SignOutIcon from "phosphor-svelte/lib/SignOutIcon";
  import TrashSimpleIcon from "phosphor-svelte/lib/TrashSimpleIcon";
  import WarningCircleIcon from "phosphor-svelte/lib/WarningCircleIcon";
  import AppToast from "./AppToast.svelte";
  import GlowMark from "./GlowMark.svelte";
  import Icon from "./Icon.svelte";
  import LoadingSpinner from "./LoadingSpinner.svelte";
  import type {
    CommunityAffirmationFeedItem,
    CommunityChatChannel,
    CommunityChatChannelSlug,
    CommunityChatMessage,
    CommunityHostApi,
    CommunityMemberProfile,
    CommunityViewState,
    ExtensionToCommunityMessage,
  } from "$lib/host";
  import type { NotificationTone } from "$lib/notifications";
  import { formatChatDateLabel, groupChatMessagesByDate, isSameChatDate } from "$lib/chat-date";

  let { hostApi }: { hostApi: CommunityHostApi } = $props();

  type AudioPhase = "idle" | "loading" | "playing" | "paused" | "error";
  type Toast = { message: string; tone: NotificationTone };
  type ChatUiMessage = CommunityChatMessage & {
    clientNonce?: string;
    delivery?: "pending" | "sent" | "failed";
  };
  type ChatContextMenu = { messageId: string; x: number; y: number };
  type CachedChatUi = {
    items: ChatUiMessage[];
    nextCursor: string | null;
    historyLimited: boolean;
    unreadReplies: ChatUiMessage[];
    unreadReplyTotal: number;
    error: string | null;
  };
  type PendingChatFocus = {
    requestId: string;
    channelSlug: CommunityChatChannelSlug;
    returnMessageId: string | null;
    acknowledgeReplyId: string | null;
    restoreReturnMessageId: string | null;
  };
  type ProfileViewState =
    | { status: "closed" }
    | { status: "loading"; handle: string }
    | { status: "ready"; profile: CommunityMemberProfile }
    | { status: "error"; handle: string; message: string };
  const tones = ["clay", "moss", "dusk", "amber", "plum", "stone"] as const;

  let viewState = $state<CommunityViewState>({ status: "loading" });
  let activeTab = $state<"affirmations" | "chats">("affirmations");
  let items = $state<CommunityAffirmationFeedItem[]>([]);
  let nextCursor = $state<string | null>(null);
  let pageLoading = $state(false);
  let pageLoadFailed = $state(false);
  let profileView = $state<ProfileViewState>({ status: "closed" });
  let profileItems = $state<CommunityAffirmationFeedItem[]>([]);
  let profileNextCursor = $state<string | null>(null);
  let profilePageLoading = $state(false);
  let chatChannels = $state<CommunityChatChannel[]>([]);
  let activeChatChannel = $state<CommunityChatChannelSlug | null>(null);
  let chatItems = $state<ChatUiMessage[]>([]);
  let chatNextCursor = $state<string | null>(null);
  let chatHistoryLimited = $state(false);
  let chatLoading = $state(false);
  let chatLoadingOlder = $state(false);
  let chatError = $state<string | null>(null);
  let chatDraft = $state("");
  let chatSending = $state(false);
  let chatRequestNonce = $state<string | null>(null);
  let chatHistoryElement = $state<HTMLDivElement | null>(null);
  let chatComposerInput = $state<HTMLTextAreaElement | null>(null);
  let chatReplyTarget = $state<ChatUiMessage | null>(null);
  let chatContextMenu = $state<ChatContextMenu | null>(null);
  let chatHighlightedMessageId = $state<string | null>(null);
  let chatDeleteConfirmId = $state<string | null>(null);
  let selectedChatMessageIds = $state<string[]>([]);
  let chatSelectionAnchorId = $state<string | null>(null);
  let chatBulkDeleteConfirm = $state(false);
  let chatBulkDeletePending = $state(false);
  let chatReadAcknowledgementTimer: ReturnType<typeof setTimeout> | undefined;
  let unreadChatReplies = $state<ChatUiMessage[]>([]);
  let unreadChatReplyTotal = $state(0);
  let chatReplyReturnStacks = $state<
    Partial<Record<CommunityChatChannelSlug, string[]>>
  >({});
  let chatChannelCache = $state<
    Partial<Record<CommunityChatChannelSlug, CachedChatUi>>
  >({});
  let chatScrollPositions = $state<
    Partial<Record<CommunityChatChannelSlug, number>>
  >({});
  let pendingChatFocus = $state<PendingChatFocus | null>(null);
  let online = $state(typeof navigator === "undefined" ? true : navigator.onLine);
  let pendingLibraryIds = $state<string[]>([]);
  let pendingReactionIds = $state<string[]>([]);
  let toast = $state<Toast | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let audioMessageId = $state<string | null>(null);
  let audioRequestId = $state<string | null>(null);
  let audioPhase = $state<AudioPhase>("idle");
  let audio: HTMLAudioElement | null = null;
  let audioUrl: string | null = null;
  const previousReactions = new Map<string, { glowed: boolean; glowCount: number }>();
  const deletedChatMessages = new Map<string, { message: ChatUiMessage; index: number }>();
  const locallyDeletedChatMessageIds = new Set<string>();
  const acknowledgedChatReadIds = new Map<CommunityChatChannelSlug, string>();
  const pendingChatReadIds = new Map<CommunityChatChannelSlug, string>();

  onMount(() => {
    const reportNetwork = () => {
      online = navigator.onLine;
      hostApi.postMessage({ type: "communityNetworkStatus", online });
    };
    const handleMessage = (event: MessageEvent<ExtensionToCommunityMessage>) => {
      const message = event.data;
      switch (message.type) {
        case "communityState":
          viewState = message.state;
          profileView = { status: "closed" };
          profileItems = [];
          profileNextCursor = null;
          profilePageLoading = false;
          if (message.state.status === "ready") {
            activeTab = message.state.data.activeTab;
            items = [...message.state.data.items];
            nextCursor = message.state.data.nextCursor;
            pageLoading = false;
            pageLoadFailed = false;
            chatChannels = [...message.state.data.chat.channels];
            activeChatChannel = message.state.data.chat.activeChannelSlug;
            chatItems = [...message.state.data.chat.items];
            chatNextCursor = message.state.data.chat.nextCursor;
            chatHistoryLimited = message.state.data.chat.historyLimited;
            unreadChatReplies = [...message.state.data.chat.unreadReplies];
            unreadChatReplyTotal = message.state.data.chat.unreadReplyTotal;
            chatError = message.state.data.chat.error;
            chatLoading = false;
            chatLoadingOlder = false;
            cacheActiveChatUi();
            if (activeTab === "chats") {
              void restoreChatScrollPosition(activeChatChannel, true);
              void focusChatComposer();
              void tick().then(queueVisibleChatReadAcknowledgement);
            }
          }
          return;
        case "communityPageLoading":
          pageLoading = true;
          pageLoadFailed = false;
          return;
        case "communityPageLoaded": {
          const known = new Set(items.map((item) => item.id));
          items = [...items, ...message.page.items.filter((item) => !known.has(item.id))];
          nextCursor = message.page.nextCursor;
          pageLoading = false;
          pageLoadFailed = false;
          return;
        }
        case "communityPageFailed":
          pageLoading = false;
          pageLoadFailed = true;
          showToast(message.message, "error");
          return;
        case "communityProfileLoading":
          profileView = { status: "loading", handle: message.handle };
          profileItems = [];
          profileNextCursor = null;
          profilePageLoading = false;
          return;
        case "communityProfileLoaded": {
          const known = new Set(profileItems.map((item) => item.id));
          profileItems = message.mode === "replace"
            ? [...message.page.items]
            : [...profileItems, ...message.page.items.filter((item) => !known.has(item.id))];
          profileNextCursor = message.page.nextCursor;
          profilePageLoading = false;
          profileView = { status: "ready", profile: message.profile };
          return;
        }
        case "communityProfileFailed":
          profilePageLoading = false;
          if (
            profileView.status === "ready" &&
            profileView.profile.handle === message.handle
          ) {
            showToast(message.message, "error");
            return;
          }
          profileView = {
            status: "error",
            handle: message.handle,
            message: message.message,
          };
          return;
        case "communityChatLoading":
          activeChatChannel = message.channelSlug;
          chatItems = [];
          chatNextCursor = null;
          chatHistoryLimited = false;
          chatLoading = true;
          chatLoadingOlder = false;
          chatError = null;
          return;
        case "communityChatLoaded": {
          if (message.channelSlug !== activeChatChannel) return;
          const shouldStickToBottom = isChatNearBottom();
          const savedPosition = chatScrollPositions[message.channelSlug];
          const visibleItems = message.page.items.filter(
            (item) => !locallyDeletedChatMessageIds.has(item.id),
          );
          const known = new Set(chatItems.map((item) => item.id));
          const received = visibleItems.filter((item) => !known.has(item.id));
          chatItems = message.mode === "prepend" ? [...received, ...chatItems] : [...visibleItems];
          chatNextCursor = message.page.nextCursor;
          chatHistoryLimited = message.page.historyLimited;
          chatLoading = false;
          chatLoadingOlder = false;
          chatError = null;
          cacheActiveChatUi();
          if (message.mode === "replace" && savedPosition !== undefined)
            void restoreChatScrollPosition(message.channelSlug);
          else if (message.mode === "replace" || (message.mode === "sync" && shouldStickToBottom))
            void scrollChatToBottom();
          return;
        }
        case "communityChatFailed":
          if (message.channelSlug !== activeChatChannel) return;
          chatLoading = false;
          chatLoadingOlder = false;
          chatError = message.message;
          return;
        case "communityChatUnreadRepliesLoaded":
          if (message.channelSlug !== activeChatChannel) return;
          unreadChatReplies = [...message.replies.items];
          unreadChatReplyTotal = message.replies.totalCount;
          cacheActiveChatUi();
          return;
        case "communityChatFocusReady":
          void settleChatFocus(message);
          return;
        case "communityChatReadSettled":
          if (!message.success && acknowledgedChatReadIds.get(message.channelSlug) === message.messageId) {
            acknowledgedChatReadIds.delete(message.channelSlug);
          }
          return;
        case "communityChatPostSettled":
          if (message.clientNonce !== chatRequestNonce) return;
          chatSending = false;
          chatRequestNonce = null;
          if (message.result && message.channelSlug === activeChatChannel) {
            const withoutPending = chatItems.filter(
              (item) => item.id !== `pending:${message.clientNonce}`,
            );
            chatItems = withoutPending.some((item) => item.id === message.result!.message.id)
              ? withoutPending
              : [...withoutPending, { ...message.result.message, delivery: "sent" }];
            chatError = null;
            void scrollChatToBottom();
          } else if (message.message) {
            chatItems = chatItems.map((item) =>
              item.id === `pending:${message.clientNonce}`
                ? { ...item, delivery: "failed" }
                : item,
            );
            chatError = message.message;
            showToast(message.message, "error");
          }
          void focusChatComposer();
          return;
        case "communityChatDeleteSettled": {
          const deleted = deletedChatMessages.get(message.messageId);
          deletedChatMessages.delete(message.messageId);
          if (!message.result && deleted) {
            locallyDeletedChatMessageIds.delete(message.messageId);
            const restored = [...chatItems];
            restored.splice(Math.min(deleted.index, restored.length), 0, deleted.message);
            chatItems = restored;
          }
          if (message.message) showToast(message.message, "error");
          return;
        }
        case "communityChatDeleteManySettled": {
          const failed: Array<{ message: ChatUiMessage; index: number }> = [];
          for (const result of message.results) {
            const deleted = deletedChatMessages.get(result.messageId);
            deletedChatMessages.delete(result.messageId);
            if (!result.result && deleted) {
              locallyDeletedChatMessageIds.delete(result.messageId);
              failed.push(deleted);
            }
          }
          if (failed.length > 0 && message.channelSlug === activeChatChannel) {
            const restored = [...chatItems];
            for (const { message: failedMessage } of failed) {
              if (!restored.some((item) => item.id === failedMessage.id)) {
                restored.push(failedMessage);
              }
            }
            chatItems = restored.sort(compareChatMessages);
            selectedChatMessageIds = failed.map(({ message: failedMessage }) => failedMessage.id);
            chatSelectionAnchorId = selectedChatMessageIds.at(-1) ?? null;
            showToast(
              failed.length === message.results.length
                ? "Unable to delete the selected messages."
                : `${failed.length} of ${message.results.length} messages could not be deleted.`,
              "error",
            );
          } else if (failed.length > 0) {
            const cached = chatChannelCache[message.channelSlug];
            if (cached) {
              const restored = [...cached.items];
              for (const { message: failedMessage } of failed) {
                if (!restored.some((item) => item.id === failedMessage.id)) {
                  restored.push(failedMessage);
                }
              }
              chatChannelCache = {
                ...chatChannelCache,
                [message.channelSlug]: {
                  ...cached,
                  items: restored.sort(compareChatMessages),
                },
              };
            }
            showToast(
              failed.length === message.results.length
                ? "Unable to delete the selected messages."
                : `${failed.length} of ${message.results.length} messages could not be deleted.`,
              "error",
            );
          }
          chatBulkDeletePending = false;
          chatBulkDeleteConfirm = false;
          if (message.channelSlug === activeChatChannel) cacheActiveChatUi();
          return;
        }
        case "communityAudioData":
          receiveAudio(message);
          return;
        case "communityAudioError":
          if (message.requestId !== audioRequestId) return;
          audioPhase = "error";
          showToast(message.message, "error");
          return;
        case "communityReactionSettled":
          settleReaction(message.messageId, message.result, message.message);
          return;
        case "communityLibrarySettled":
          settleLibrary(message.messageId, message.result?.status ?? null, message.message);
          return;
      }
    };

    window.addEventListener("message", handleMessage);
    window.addEventListener("online", reportNetwork);
    window.addEventListener("offline", reportNetwork);
    window.addEventListener("focus", queueVisibleChatReadAcknowledgement);
    document.addEventListener("visibilitychange", queueVisibleChatReadAcknowledgement);
    document.addEventListener("pointerdown", closeMenusOnOutsidePointerDown);
    document.addEventListener("mousedown", preventChatComposerBlur);
    document.addEventListener("keydown", closeMenusOnEscape);
    document.addEventListener("keydown", handleChatDocumentKeydown, true);
    reportNetwork();
    hostApi.postMessage({ type: "communityReady" });
    return () => {
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("online", reportNetwork);
      window.removeEventListener("offline", reportNetwork);
      window.removeEventListener("focus", queueVisibleChatReadAcknowledgement);
      document.removeEventListener("visibilitychange", queueVisibleChatReadAcknowledgement);
      document.removeEventListener("pointerdown", closeMenusOnOutsidePointerDown);
      document.removeEventListener("mousedown", preventChatComposerBlur);
      document.removeEventListener("keydown", closeMenusOnEscape);
      document.removeEventListener("keydown", handleChatDocumentKeydown, true);
      cleanupAudio();
      if (toastTimer) clearTimeout(toastTimer);
      if (chatReadAcknowledgementTimer) clearTimeout(chatReadAcknowledgementTimer);
    };
  });

  $effect(() => {
    if (
      activeTab !== "chats" ||
      selectedChatMessageIds.length === 0 ||
      chatBulkDeletePending
    ) return;
    const availableIds = new Set(chatItems.map((message) => message.id));
    const availableSelection = selectedChatMessageIds.filter((id) => availableIds.has(id));
    if (availableSelection.length === selectedChatMessageIds.length) return;
    selectedChatMessageIds = availableSelection;
    if (availableSelection.length === 0) {
      chatSelectionAnchorId = null;
      chatBulkDeleteConfirm = false;
      if (viewState.status === "ready" && viewState.data.identity.canContribute) {
        void focusChatComposer();
      }
    }
  });

  function displayText(value: string): string {
    const cleaned = value.replace(/^\s*(?:\[[^\]\r\n]{1,80}\]\s*)+/u, "").trim();
    return cleaned || value.trim();
  }

  function toneFor(value: string): (typeof tones)[number] {
    let hash = 0;
    for (const character of displayText(value)) {
      hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
    }
    return tones[hash % tones.length] ?? "stone";
  }

  function authorName(item: CommunityAffirmationFeedItem): string {
    return item.author.displayName?.trim() || `@${item.author.handle}`;
  }

  function formatDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    }).format(date);
  }

  function isPending(list: string[], id: string): boolean {
    return list.includes(id);
  }

  function setPending(list: string[], id: string, pending: boolean): string[] {
    return pending
      ? list.includes(id)
        ? list
        : [...list, id]
      : list.filter((value) => value !== id);
  }

  function showToast(message: string, tone: NotificationTone): void {
    toast = { message, tone };
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast = null;
      toastTimer = undefined;
    }, tone === "error" ? 10_000 : tone === "warning" ? 8_000 : 4_500);
  }

  function dismissToast(): void {
    toast = null;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = undefined;
  }

  function observeFeedEnd(node: HTMLElement): { destroy(): void } {
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some((entry) => entry.isIntersecting) &&
          nextCursor &&
          !pageLoading &&
          !pageLoadFailed
        ) {
          hostApi.postMessage({ type: "loadMoreCommunityAffirmations" });
        }
      },
      { rootMargin: "640px 0px", threshold: 0 },
    );
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

  function retryPage(): void {
    if (!nextCursor || pageLoading) return;
    pageLoadFailed = false;
    hostApi.postMessage({ type: "loadMoreCommunityAffirmations" });
  }

  function openProfile(handle: string): void {
    if (!online) {
      showToast("Connect to view this profile.", "warning");
      return;
    }
    const normalizedHandle = handle.trim().replace(/^@/u, "").toLowerCase();
    if (!normalizedHandle || profileView.status === "loading") return;
    closeAllCommunityMenus();
    profileView = { status: "loading", handle: normalizedHandle };
    profileItems = [];
    profileNextCursor = null;
    hostApi.postMessage({ type: "openCommunityProfile", handle: normalizedHandle });
  }

  function openOwnProfile(): void {
    if (viewState.status === "ready") openProfile(viewState.data.identity.handle);
  }

  function retryProfile(): void {
    if (profileView.status === "error") openProfile(profileView.handle);
  }

  function closeProfile(): void {
    profileView = { status: "closed" };
    profileItems = [];
    profileNextCursor = null;
    profilePageLoading = false;
    hostApi.postMessage({ type: "closeCommunityProfile" });
  }

  function loadMoreProfileAffirmations(): void {
    if (!profileNextCursor || profilePageLoading || !online) return;
    profilePageLoading = true;
    hostApi.postMessage({ type: "loadMoreCommunityProfileAffirmations" });
  }

  function profileName(profile: CommunityMemberProfile): string {
    return profile.displayName?.trim() || `@${profile.handle}`;
  }

  function currentChatChannel(): CommunityChatChannel | undefined {
    return chatChannels.find((channel) => channel.slug === activeChatChannel);
  }

  function cacheActiveChatUi(): void {
    if (!activeChatChannel) return;
    chatChannelCache = {
      ...chatChannelCache,
      [activeChatChannel]: {
        items: [...chatItems],
        nextCursor: chatNextCursor,
        historyLimited: chatHistoryLimited,
        unreadReplies: [...unreadChatReplies],
        unreadReplyTotal: unreadChatReplyTotal,
        error: chatError,
      },
    };
  }

  function rememberChatScrollPosition(): void {
    if (!activeChatChannel || !chatHistoryElement) return;
    chatScrollPositions = {
      ...chatScrollPositions,
      [activeChatChannel]: chatHistoryElement.scrollTop,
    };
  }

  async function restoreChatScrollPosition(
    channelSlug: CommunityChatChannelSlug | null,
    fallbackToBottom = false,
  ): Promise<void> {
    await tick();
    if (!channelSlug || !chatHistoryElement || activeChatChannel !== channelSlug)
      return;
    const saved = chatScrollPositions[channelSlug];
    if (saved !== undefined) chatHistoryElement.scrollTop = saved;
    else if (fallbackToBottom) chatHistoryElement.scrollTop = chatHistoryElement.scrollHeight;
  }

  function selectCommunityTab(tab: "affirmations" | "chats"): void {
    if (tab === activeTab) return;
    exitChatSelection(false);
    if (activeTab === "chats") rememberChatScrollPosition();
    activeTab = tab;
    hostApi.postMessage({ type: "setCommunitySurfaceTab", activeTab: tab });
    if (tab === "chats") {
      void restoreChatScrollPosition(activeChatChannel, true);
      void focusChatComposer();
    }
  }

  function selectChatChannel(channelSlug: CommunityChatChannelSlug): void {
    if (channelSlug === activeChatChannel || chatLoading) return;
    exitChatSelection(false);
    rememberChatScrollPosition();
    cacheActiveChatUi();
    chatReplyTarget = null;
    chatContextMenu = null;
    chatDeleteConfirmId = null;
    pendingChatFocus = null;
    activeChatChannel = channelSlug;
    void focusChatComposer();
    const cached = chatChannelCache[channelSlug];
    if (cached) {
      chatItems = [...cached.items];
      chatNextCursor = cached.nextCursor;
      chatHistoryLimited = cached.historyLimited;
      unreadChatReplies = [...cached.unreadReplies];
      unreadChatReplyTotal = cached.unreadReplyTotal;
      chatError = cached.error;
      chatLoading = false;
      void restoreChatScrollPosition(channelSlug, true);
    } else {
      chatItems = [];
      chatNextCursor = null;
      chatHistoryLimited = false;
      unreadChatReplies = [];
      unreadChatReplyTotal = 0;
      chatError = null;
      chatLoading = true;
    }
    hostApi.postMessage({ type: "selectCommunityChatChannel", channelSlug });
  }

  function loadOlderChatMessages(): void {
    if (!online) {
      showToast("Connect to load earlier messages.", "warning");
      return;
    }
    if (chatHistoryLimited || !chatNextCursor || chatLoadingOlder || chatLoading) return;
    chatLoadingOlder = true;
    chatError = null;
    hostApi.postMessage({ type: "loadMoreCommunityChatMessages" });
  }

  function submitChatMessage(event: SubmitEvent): void {
    event.preventDefault();
    const body = chatDraft.trim();
    if (!body || !activeChatChannel || chatSending || !online) {
      if (!online) showToast("Connect to send a message.", "warning");
      return;
    }
    const clientNonce = crypto.randomUUID();
    const replyTo = chatReplyTarget
      ? {
          id: chatReplyTarget.id,
          body: chatReplyTarget.body,
          author: {
            handle: chatReplyTarget.author.handle,
            displayName: chatReplyTarget.author.displayName,
          },
        }
      : null;
    const optimistic: ChatUiMessage = {
      id: `pending:${clientNonce}`,
      channelSlug: activeChatChannel,
      body,
      createdAt: new Date().toISOString(),
      author: {
        userId: viewState.status === "ready" ? viewState.data.identity.id : "",
        handle: viewState.status === "ready" ? viewState.data.identity.handle : "glow_member",
        displayName: viewState.status === "ready" ? viewState.data.identity.displayName : null,
        avatarUrl: viewState.status === "ready" ? viewState.data.identity.avatarUrl : null,
      },
      replyTo,
      seenByOther: false,
      permissions: { canDelete: true, canReport: false, canBlock: false },
      clientNonce,
      delivery: "pending",
    };
    chatSending = true;
    chatRequestNonce = clientNonce;
    chatError = null;
    chatItems = [...chatItems, optimistic];
    chatDraft = "";
    chatReplyTarget = null;
    void resizeChatComposer();
    void scrollChatToBottom();
    void focusChatComposer();
    hostApi.postMessage({
      type: "postCommunityChatMessage",
      channelSlug: activeChatChannel,
      body,
      clientNonce,
      replyToMessageId: replyTo?.id ?? null,
    });
  }

  function retryChatMessage(message: ChatUiMessage): void {
    if (message.delivery !== "failed" || !message.clientNonce || chatSending) return;
    chatSending = true;
    chatRequestNonce = message.clientNonce;
    chatError = null;
    chatContextMenu = null;
    chatItems = chatItems.map((item) =>
      item.id === message.id ? { ...item, delivery: "pending" } : item,
    );
    void focusChatComposer();
    hostApi.postMessage({
      type: "postCommunityChatMessage",
      channelSlug: message.channelSlug,
      body: message.body,
      clientNonce: message.clientNonce,
      replyToMessageId: message.replyTo?.id ?? null,
    });
  }

  function handleChatComposerKeydown(event: KeyboardEvent): void {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    if (event.currentTarget instanceof HTMLTextAreaElement) {
      event.currentTarget.form?.requestSubmit();
    }
  }

  async function resizeChatComposer(): Promise<void> {
    await tick();
    if (!chatComposerInput) return;
    chatComposerInput.style.height = "auto";
    chatComposerInput.style.height = `${Math.min(chatComposerInput.scrollHeight, 120)}px`;
  }

  async function focusChatComposer(): Promise<void> {
    await tick();
    if (
      activeTab !== "chats" ||
      viewState.status !== "ready" ||
      !viewState.data.identity.canContribute ||
      chatSelectionActive() ||
      chatBulkDeleteConfirm ||
      chatContextMenu ||
      !online ||
      !activeChatChannel
    ) return;
    chatComposerInput?.focus({ preventScroll: true });
  }

  function handleChatDocumentKeydown(event: KeyboardEvent): void {
    const target = event.target;
    const input = chatComposerInput;
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      activeTab !== "chats" ||
      viewState.status !== "ready" ||
      !viewState.data.identity.canContribute ||
      chatSelectionActive() ||
      chatBulkDeleteConfirm ||
      chatContextMenu ||
      !online ||
      !activeChatChannel ||
      !input ||
      !(target instanceof HTMLElement) ||
      target === input ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable ||
      window.matchMedia("(pointer: coarse)").matches ||
      document.querySelector('dialog[open], [role="dialog"], [role="menu"], details[open]')
    ) return;

    const isDirectInputKey =
      event.key.length === 1 ||
      event.key === "Backspace" ||
      event.key === "Delete" ||
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight";
    if (!isDirectInputKey) return;

    const selection = document.getSelection();
    if (event.key.startsWith("Arrow") && selection && !selection.isCollapsed) return;

    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new KeyboardEvent(event.type, event));
  }

  function preventChatComposerBlur(event: MouseEvent): void {
    const target = event.target;
    if (
      window.matchMedia("(pointer: coarse)").matches ||
      !chatComposerInput ||
      document.activeElement !== chatComposerInput ||
      !chatHistoryElement ||
      (target !== chatHistoryElement &&
        (!(target instanceof Element) || !target.classList.contains("chat-history-spacer")))
    ) return;
    event.preventDefault();
  }

  async function scrollChatToBottom(): Promise<void> {
    await tick();
    chatHistoryElement?.scrollTo({ top: chatHistoryElement.scrollHeight });
  }

  function isChatNearBottom(): boolean {
    if (!chatHistoryElement) return true;
    return (
      chatHistoryElement.scrollHeight -
        chatHistoryElement.scrollTop -
        chatHistoryElement.clientHeight <
      80
    );
  }

  function chatAuthorName(message: CommunityChatMessage): string {
    return message.author.displayName?.trim() || message.author.handle;
  }

  function chatInitials(message: CommunityChatMessage): string {
    return chatAuthorName(message)
      .replace(/^@/, "")
      .split(/\s+/u)
      .map((part) => part[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }

  function formatChatTime(value: string): string {
    const match = /T(\d{2}):(\d{2})/u.exec(value);
    if (!match) return "";
    const hour = Number(match[1]);
    const suffix = hour >= 12 ? "PM" : "AM";
    return `${hour % 12 || 12}:${match[2]} ${suffix}`;
  }

  function compareChatMessages(left: ChatUiMessage, right: ChatUiMessage): number {
    const createdAt = left.createdAt.localeCompare(right.createdAt);
    if (createdAt !== 0) return createdAt;
    if (left.id.length !== right.id.length) return left.id.length - right.id.length;
    return left.id.localeCompare(right.id);
  }

  function compareChatMessageIds(left: string, right: string): number {
    if (left.length !== right.length) return left.length - right.length;
    return left.localeCompare(right);
  }

  function queueVisibleChatReadAcknowledgement(): void {
    if (
      activeTab !== "chats" ||
      !online ||
      document.visibilityState !== "visible" ||
      !document.hasFocus() ||
      !activeChatChannel ||
      !chatHistoryElement
    ) return;
    const viewport = chatHistoryElement.getBoundingClientRect();
    let lastVisibleMessageId: string | null = null;
    for (const node of chatHistoryElement.querySelectorAll<HTMLElement>("[data-message-id]")) {
      const bounds = node.getBoundingClientRect();
      const visibleHeight = Math.min(bounds.bottom, viewport.bottom) - Math.max(bounds.top, viewport.top);
      if (visibleHeight < Math.min(18, bounds.height * 0.5)) continue;
      const messageId = node.dataset.messageId;
      if (
        messageId &&
        !messageId.startsWith("pending:") &&
        (!lastVisibleMessageId || compareChatMessageIds(messageId, lastVisibleMessageId) > 0)
      ) lastVisibleMessageId = messageId;
    }
    if (!lastVisibleMessageId) return;
    const acknowledged = acknowledgedChatReadIds.get(activeChatChannel);
    if (acknowledged && compareChatMessageIds(lastVisibleMessageId, acknowledged) <= 0) return;
    const pending = pendingChatReadIds.get(activeChatChannel);
    if (!pending || compareChatMessageIds(lastVisibleMessageId, pending) > 0) {
      pendingChatReadIds.set(activeChatChannel, lastVisibleMessageId);
    }
    if (chatReadAcknowledgementTimer) return;
    chatReadAcknowledgementTimer = setTimeout(flushChatReadAcknowledgement, 140);
  }

  function flushChatReadAcknowledgement(): void {
    chatReadAcknowledgementTimer = undefined;
    const channelSlug = activeChatChannel;
    if (!channelSlug) return;
    const messageId = pendingChatReadIds.get(channelSlug);
    if (!messageId) return;
    pendingChatReadIds.delete(channelSlug);
    acknowledgedChatReadIds.set(channelSlug, messageId);
    hostApi.postMessage({
      type: "acknowledgeCommunityChatRead",
      channelSlug,
      messageId,
    });
  }

  function chatChannelInitials(channel: CommunityChatChannel): string {
    return channel.name
      .split(/\s+/u)
      .map((part) => part[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }

  function chatChannelTone(index: number): "coral" | "violet" | "blue" | "sage" {
    return (["coral", "violet", "blue", "sage"] as const)[index % 4]!;
  }

  function chatAuthorTone(
    identity: string,
  ): "coral" | "amber" | "violet" | "sage" | "sky" | "blue" | "rose" {
    const chatTones = ["coral", "amber", "violet", "sage", "sky", "blue", "rose"] as const;
    let hash = 2_166_136_261;
    for (const character of identity.trim().toLocaleLowerCase()) {
      hash ^= character.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 16_777_619);
    }
    return chatTones[(hash >>> 0) % chatTones.length]!;
  }

  function isChatGroupStart(messages: ChatUiMessage[], index: number): boolean {
    return index === 0 ||
      !isSameChatDate(messages[index - 1]?.createdAt ?? "", messages[index]?.createdAt ?? "") ||
      messages[index - 1]?.author.userId !== messages[index]?.author.userId;
  }

  function isChatGroupEnd(messages: ChatUiMessage[], index: number): boolean {
    return index === messages.length - 1 ||
      !isSameChatDate(messages[index]?.createdAt ?? "", messages[index + 1]?.createdAt ?? "") ||
      messages[index + 1]?.author.userId !== messages[index]?.author.userId;
  }

  function selectedChatMessages(): ChatUiMessage[] {
    const selected = new Set(selectedChatMessageIds);
    return chatItems.filter((message) => selected.has(message.id));
  }

  function chatSelectionActive(): boolean {
    return selectedChatMessageIds.length > 0;
  }

  function canDeleteSelectedChatMessages(): boolean {
    const selected = selectedChatMessages();
    return selected.length > 0 &&
      selected.length === selectedChatMessageIds.length &&
      selected.every((message) =>
        message.permissions.canDelete &&
        message.delivery !== "pending" &&
        message.delivery !== "failed"
      );
  }

  function exitChatSelection(focusComposer = true): void {
    selectedChatMessageIds = [];
    chatSelectionAnchorId = null;
    chatBulkDeleteConfirm = false;
    chatContextMenu = null;
    chatDeleteConfirmId = null;
    if (
      focusComposer &&
      activeTab === "chats" &&
      viewState.status === "ready" &&
      viewState.data.identity.canContribute
    ) {
      void focusChatComposer();
    }
  }

  function enterChatSelection(message: ChatUiMessage): void {
    if (message.delivery === "pending" || message.delivery === "failed") return;
    selectedChatMessageIds = [message.id];
    chatSelectionAnchorId = message.id;
    chatContextMenu = null;
    chatDeleteConfirmId = null;
    chatReplyTarget = null;
  }

  function toggleChatMessageSelection(event: MouseEvent, message: ChatUiMessage): void {
    if (!chatSelectionActive()) return;
    event.preventDefault();
    event.stopPropagation();

    if (selectedChatMessageIds.includes(message.id)) {
      selectedChatMessageIds = selectedChatMessageIds.filter((id) => id !== message.id);
      chatSelectionAnchorId = selectedChatMessageIds[selectedChatMessageIds.length - 1] ?? null;
      if (selectedChatMessageIds.length === 0) exitChatSelection();
      return;
    }

    let additions = [message.id];
    if (event.shiftKey && chatSelectionAnchorId) {
      const anchorIndex = chatItems.findIndex((candidate) => candidate.id === chatSelectionAnchorId);
      const currentIndex = chatItems.findIndex((candidate) => candidate.id === message.id);
      if (anchorIndex >= 0 && currentIndex >= 0) {
        additions = chatItems
          .slice(Math.min(anchorIndex, currentIndex), Math.max(anchorIndex, currentIndex) + 1)
          .filter((candidate) =>
            candidate.delivery !== "pending" && candidate.delivery !== "failed"
          )
          .map((candidate) => candidate.id);
      }
    }

    const next = [...new Set([...selectedChatMessageIds, ...additions])];
    if (next.length > 100) {
      showToast("Select up to 100 messages at a time.", "warning");
      return;
    }
    selectedChatMessageIds = next;
    chatSelectionAnchorId = message.id;
  }

  function openChatContextMenu(event: MouseEvent, message: ChatUiMessage): void {
    event.preventDefault();
    if (chatSelectionActive()) {
      toggleChatMessageSelection(event, message);
      return;
    }
    const width = 196;
    const height = message.permissions.canDelete ? 188 : 148;
    chatContextMenu = {
      messageId: message.id,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
    };
    chatDeleteConfirmId = null;
  }

  function contextChatMessage(): ChatUiMessage | undefined {
    return chatItems.find((message) => message.id === chatContextMenu?.messageId);
  }

  function beginChatReply(message: ChatUiMessage): void {
    if (message.delivery === "pending" || message.delivery === "failed") return;
    chatReplyTarget = message;
    chatContextMenu = null;
    void focusChatComposer();
  }

  function cancelChatReply(): void {
    chatReplyTarget = null;
    void focusChatComposer();
  }

  function currentChatReplyReturnStack(): string[] {
    return activeChatChannel ? (chatReplyReturnStacks[activeChatChannel] ?? []) : [];
  }

  async function focusLoadedChatMessage(messageId: string): Promise<boolean> {
    await tick();
    const message = chatHistoryElement?.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(messageId)}"]`,
    );
    if (!message) return false;
    message.scrollIntoView({ behavior: "smooth", block: "center" });
    chatHighlightedMessageId = messageId;
    window.setTimeout(() => {
      if (chatHighlightedMessageId === messageId) chatHighlightedMessageId = null;
    }, 1_200);
    return true;
  }

  function requestChatFocus(
    messageId: string,
    options: {
      returnMessageId?: string;
      acknowledgeReplyId?: string;
      restoreReturnMessageId?: string;
    } = {},
  ): void {
    if (!activeChatChannel || pendingChatFocus || !online) {
      if (!online) showToast("Connect to open that message.", "warning");
      return;
    }
    const requestId = crypto.randomUUID();
    pendingChatFocus = {
      requestId,
      channelSlug: activeChatChannel,
      returnMessageId: options.returnMessageId ?? null,
      acknowledgeReplyId: options.acknowledgeReplyId ?? null,
      restoreReturnMessageId: options.restoreReturnMessageId ?? null,
    };
    hostApi.postMessage({
      type: "focusCommunityChatMessage",
      channelSlug: activeChatChannel,
      messageId,
      requestId,
    });
  }

  function followChatReply(message: ChatUiMessage): void {
    if (!message.replyTo) return;
    requestChatFocus(message.replyTo.id, { returnMessageId: message.id });
  }

  function focusNextUnreadChatReply(): void {
    const reply = unreadChatReplies[0];
    if (!reply) return;
    requestChatFocus(reply.id, { acknowledgeReplyId: reply.id });
  }

  function returnFromChatReply(): void {
    if (!activeChatChannel || pendingChatFocus) return;
    const stack = [...currentChatReplyReturnStack()];
    const messageId = stack.pop();
    if (!messageId) {
      void scrollChatToBottom();
      return;
    }
    chatReplyReturnStacks[activeChatChannel] = stack;
    requestChatFocus(messageId, { restoreReturnMessageId: messageId });
  }

  async function settleChatFocus(
    message: Extract<ExtensionToCommunityMessage, { type: "communityChatFocusReady" }>,
  ): Promise<void> {
    const pending = pendingChatFocus;
    if (!pending || message.requestId !== pending.requestId) return;
    pendingChatFocus = null;
    if (
      !message.found ||
      message.channelSlug !== activeChatChannel ||
      !(await focusLoadedChatMessage(message.messageId))
    ) {
      if (pending.restoreReturnMessageId) {
        const stack = chatReplyReturnStacks[pending.channelSlug] ?? [];
        chatReplyReturnStacks[pending.channelSlug] = [
          ...stack,
          pending.restoreReturnMessageId,
        ];
      }
      showToast("That message is no longer available.", "warning");
      void focusChatComposer();
      return;
    }

    if (pending.returnMessageId) {
      const stack = chatReplyReturnStacks[pending.channelSlug] ?? [];
      chatReplyReturnStacks[pending.channelSlug] = [...stack, pending.returnMessageId];
    }
    if (pending.acknowledgeReplyId) {
      unreadChatReplies = unreadChatReplies.filter(
        (reply) => reply.id !== pending.acknowledgeReplyId,
      );
      unreadChatReplyTotal = Math.max(0, unreadChatReplyTotal - 1);
      hostApi.postMessage({
        type: "acknowledgeCommunityChatReply",
        channelSlug: pending.channelSlug,
        messageId: pending.acknowledgeReplyId,
      });
    }
    void focusChatComposer();
  }

  async function copyChatMessage(message: ChatUiMessage): Promise<void> {
    try {
      await navigator.clipboard.writeText(message.body);
      chatContextMenu = null;
      void focusChatComposer();
    } catch {
      showToast("Unable to copy this message.", "error");
    }
  }

  function deleteChatMessage(message: ChatUiMessage): void {
    chatContextMenu = null;
    chatDeleteConfirmId = null;
    const index = chatItems.findIndex((item) => item.id === message.id);
    if (index < 0) return;
    chatItems = chatItems.filter((item) => item.id !== message.id);
    void focusChatComposer();
    if (message.id.startsWith("pending:")) return;
    locallyDeletedChatMessageIds.add(message.id);
    deletedChatMessages.set(message.id, { message, index });
    hostApi.postMessage({ type: "deleteCommunityChatMessage", messageId: message.id });
  }

  function deleteSelectedChatMessages(): void {
    if (
      chatBulkDeletePending ||
      !activeChatChannel ||
      !canDeleteSelectedChatMessages()
    ) return;
    const channelSlug = activeChatChannel;
    const selected = selectedChatMessages().slice(0, 100);
    const selectedIds = new Set(selected.map((message) => message.id));
    for (const message of selected) {
      const index = chatItems.findIndex((item) => item.id === message.id);
      if (index >= 0) {
        locallyDeletedChatMessageIds.add(message.id);
        deletedChatMessages.set(message.id, { message, index });
      }
    }
    chatItems = chatItems.filter((message) => !selectedIds.has(message.id));
    exitChatSelection(false);
    chatBulkDeletePending = true;
    cacheActiveChatUi();
    hostApi.postMessage({
      type: "deleteCommunityChatMessages",
      channelSlug,
      messageIds: selected.map((message) => message.id),
    });
  }

  function closeMenusOnOutsidePointerDown(event: PointerEvent): void {
    const target = event.target;
    if (!(target instanceof Node)) return;
    for (const menu of document.querySelectorAll<HTMLDetailsElement>(
      ".profile-menu[open], .card-menu[open]",
    )) {
      if (!menu.contains(target)) menu.removeAttribute("open");
    }
    if (
      chatContextMenu &&
      (!(target instanceof Element) ||
        !target.closest(".chat-context-menu"))
    ) {
      chatContextMenu = null;
      chatDeleteConfirmId = null;
    }
  }

  function closeMenusOnEscape(event: KeyboardEvent): void {
    const target = event.target;
    const targetIsEditable = target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable);
    if (
      (event.key === "Delete" || event.key === "Backspace") &&
      chatSelectionActive() &&
      canDeleteSelectedChatMessages() &&
      !targetIsEditable &&
      !chatBulkDeleteConfirm
    ) {
      event.preventDefault();
      chatBulkDeleteConfirm = true;
      return;
    }
    if (event.key !== "Escape") return;
    if (chatBulkDeleteConfirm) {
      chatBulkDeleteConfirm = false;
      return;
    }
    if (chatContextMenu) {
      chatContextMenu = null;
      chatDeleteConfirmId = null;
      return;
    }
    if (chatSelectionActive()) {
      exitChatSelection();
      return;
    }
    closeAllCommunityMenus();
    chatReplyTarget = null;
  }

  function closeAllCommunityMenus(): void {
    for (const menu of document.querySelectorAll<HTMLDetailsElement>(
      ".profile-menu[open], .card-menu[open]",
    )) {
      menu.removeAttribute("open");
    }
    chatContextMenu = null;
    chatDeleteConfirmId = null;
  }

  function cleanupAudio(): void {
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audio = null;
    audioUrl = null;
    audioMessageId = null;
    audioRequestId = null;
    audioPhase = "idle";
  }

  function toggleAudio(item: CommunityAffirmationFeedItem): void {
    if (!online) {
      showToast("Connect to listen to this affirmation.", "warning");
      return;
    }
    if (audioMessageId === item.id && audio) {
      if (audioPhase === "playing" || audioPhase === "loading") {
        audio.pause();
        audioPhase = "paused";
      } else {
        audioPhase = "loading";
        void audio.play().catch(() => {
          audioPhase = "error";
        });
      }
      return;
    }
    cleanupAudio();
    audioMessageId = item.id;
    audioRequestId = crypto.randomUUID();
    audioPhase = "loading";
    hostApi.postMessage({
      type: "playCommunityAffirmation",
      messageId: item.id,
      requestId: audioRequestId,
    });
  }

  function receiveAudio(
    message: Extract<ExtensionToCommunityMessage, { type: "communityAudioData" }>,
  ): void {
    if (message.requestId !== audioRequestId || message.messageId !== audioMessageId) return;
    if (message.data.byteLength === 0) {
      audioPhase = "error";
      showToast("That audio preview is unavailable.", "error");
      return;
    }
    audioUrl = URL.createObjectURL(new Blob([message.data], { type: message.mimeType }));
    const nextAudio = new Audio(audioUrl);
    audio = nextAudio;
    nextAudio.addEventListener("playing", () => {
      if (audio === nextAudio) audioPhase = "playing";
    });
    nextAudio.addEventListener("waiting", () => {
      if (audio === nextAudio) audioPhase = "loading";
    });
    nextAudio.addEventListener("ended", () => {
      if (audio !== nextAudio) return;
      nextAudio.currentTime = 0;
      audioPhase = "paused";
    });
    nextAudio.addEventListener("error", () => {
      if (audio === nextAudio) audioPhase = "error";
    });
    void nextAudio.play().catch(() => {
      if (audio === nextAudio) audioPhase = "error";
    });
  }

  function toggleReaction(item: CommunityAffirmationFeedItem): void {
    if (isPending(pendingReactionIds, item.id)) return;
    if (!online) {
      showToast("Connect to react to this affirmation.", "warning");
      return;
    }
    previousReactions.set(item.id, { ...item.engagement });
    const active = !item.engagement.glowed;
    updateCommunityFeedItem(item.id, (candidate) => ({
      ...candidate,
      engagement: {
        glowed: active,
        glowCount: Math.max(0, candidate.engagement.glowCount + (active ? 1 : -1)),
      },
    }));
    pendingReactionIds = setPending(pendingReactionIds, item.id, true);
    hostApi.postMessage({ type: "setCommunityReaction", messageId: item.id, active });
  }

  function settleReaction(
    messageId: string,
    result: { glowed: boolean; glowCount: number | null } | null,
    message: string | null,
  ): void {
    pendingReactionIds = setPending(pendingReactionIds, messageId, false);
    const previous = previousReactions.get(messageId);
    previousReactions.delete(messageId);
    updateCommunityFeedItem(messageId, (item) => {
      if (result) {
        return {
          ...item,
          engagement: {
            glowed: result.glowed,
            glowCount: result.glowCount ?? item.engagement.glowCount,
          },
        };
      }
      return previous ? { ...item, engagement: previous } : item;
    });
    if (message) showToast(message, "error");
  }

  function updateCommunityFeedItem(
    messageId: string,
    update: (item: CommunityAffirmationFeedItem) => CommunityAffirmationFeedItem,
  ): void {
    items = items.map((item) => (item.id === messageId ? update(item) : item));
    profileItems = profileItems.map((item) =>
      item.id === messageId ? update(item) : item,
    );
  }

  function addToLibrary(item: CommunityAffirmationFeedItem, menu: HTMLDetailsElement | null): void {
    menu?.removeAttribute("open");
    if (isPending(pendingLibraryIds, item.id)) return;
    if (!online) {
      showToast("Connect to add this affirmation to your library.", "warning");
      return;
    }
    pendingLibraryIds = setPending(pendingLibraryIds, item.id, true);
    hostApi.postMessage({ type: "addCommunityAffirmationToLibrary", messageId: item.id });
  }

  function settleLibrary(
    messageId: string,
    status: "added" | "already_added" | "in_progress" | null,
    message: string | null,
  ): void {
    pendingLibraryIds = setPending(pendingLibraryIds, messageId, false);
    if (message) {
      showToast(message, "error");
    } else if (status === "added") {
      showToast("Successfully added to your library.", "success");
    } else if (status === "already_added") {
      showToast("This affirmation is already in your library.", "info");
    } else if (status === "in_progress") {
      showToast("This affirmation is already being added.", "info");
    }
  }
</script>

<main
  class="community-shell"
  class:chat-open={activeTab === "chats" && profileView.status === "closed"}
>
  <header class="community-header" class:profile-open={profileView.status !== "closed"}>
    {#if profileView.status !== "closed"}
      <button class="profile-back" type="button" onclick={closeProfile}>
        <ArrowLeftIcon size={17} aria-hidden="true" /> Community
      </button>
      <span class="brand profile-brand" aria-label="Glow"><GlowMark size="prominent" /></span>
      <span class="profile-space" aria-hidden="true"></span>
    {:else}
      <span class="brand" aria-label="Glow"><GlowMark size="prominent" /></span>
      <div class="tabs" role="tablist" aria-label="Community sections">
        <span class="tab-indicator" class:chats-selected={activeTab === "chats"} aria-hidden="true"></span>
        <button
          type="button"
          role="tab"
          class:active={activeTab === "affirmations"}
          aria-selected={activeTab === "affirmations"}
          onclick={() => selectCommunityTab("affirmations")}>Affirmations</button
        >
        <button
          type="button"
          role="tab"
          class:active={activeTab === "chats"}
          aria-selected={activeTab === "chats"}
          onclick={() => selectCommunityTab("chats")}>Chats</button
        >
      </div>
    {#if viewState.status === "ready"}
      <details class="profile-menu">
        <summary
          class="profile-trigger"
          aria-label={`Open options for @${viewState.data.identity.handle}`}
        >
          <Icon name="user" size="control" />
        </summary>
        <div class="profile-menu-panel">
          <div class="profile-menu-identity">
            <strong>{viewState.data.identity.displayName}</strong>
            <span>@{viewState.data.identity.handle}</span>
          </div>
          <button
            class="profile-menu-item"
            type="button"
            onclick={(event) => {
              event.currentTarget.closest("details")?.removeAttribute("open");
              openOwnProfile();
            }}
          >
            <span>View profile</span>
            <Icon name="user" size="small" weight="duotone" />
          </button>
          <button
            class="profile-menu-item"
            type="button"
            onclick={(event) => {
              event.currentTarget.closest("details")?.removeAttribute("open");
              hostApi.postMessage({ type: "openCommunityDashboard" });
            }}
          >
            <span>Dashboard</span>
            <Icon name="dashboard" size="small" weight="duotone" />
          </button>
          <button
            class="profile-menu-item sign-out"
            type="button"
            onclick={(event) => {
              event.currentTarget.closest("details")?.removeAttribute("open");
              hostApi.postMessage({ type: "signOutCommunity" });
            }}
          >
            <span>Sign out</span>
            <SignOutIcon size={16} aria-hidden="true" />
          </button>
        </div>
      </details>
    {:else}
      <span class="profile-space" aria-hidden="true"></span>
    {/if}
    {/if}
  </header>

  {#if profileView.status === "loading"}
    <section class="center-state profile-loading">
      <LoadingSpinner size="prominent" />
      <p>Opening @{profileView.handle}…</p>
    </section>
  {:else if profileView.status === "error"}
    <section class="center-state profile-loading">
      <h1>That profile is quiet for now.</h1>
      <p>{profileView.message}</p>
      <button type="button" onclick={retryProfile}>Try again</button>
    </section>
  {:else if profileView.status === "ready"}
    <section class="member-view" aria-labelledby="member-profile-name">
      <div class="member-identity">
        <div class="member-avatar">
          {#if profileView.profile.avatarUrl}
            <img
              src={profileView.profile.avatarUrl}
              alt=""
              width="88"
              height="88"
              referrerpolicy="no-referrer"
            />
          {:else}
            <span aria-hidden="true">{profileName(profileView.profile).slice(0, 1).toUpperCase()}</span>
          {/if}
        </div>
        <div class="member-copy">
          <h1 id="member-profile-name">{profileName(profileView.profile)}</h1>
          <p class="member-handle">@{profileView.profile.handle}</p>
          {#if profileView.profile.bio}<p class="member-bio">{profileView.profile.bio}</p>{/if}
        </div>
      </div>

      <nav class="member-tabs" aria-label="Profile collections">
        <button class="active" type="button">Shared</button>
      </nav>

      {#if profileItems.length === 0}
        <div class="member-empty">
          <h2>No shared affirmations yet.</h2>
        </div>
      {:else}
        <div class="affirmation-grid member-grid">
          {#each profileItems as item (item.id)}
            <article class="affirmation-card" data-tone={toneFor(item.affirmation.text)}>
              <details class="card-menu">
                <summary aria-label={`More actions for ${authorName(item)}`}>
                  <Icon name="more" size="small" weight="bold" />
                </summary>
                <div class="menu-panel">
                  <button
                    type="button"
                    disabled={isPending(pendingLibraryIds, item.id)}
                    onclick={(event) => addToLibrary(item, event.currentTarget.closest("details"))}
                  >
                    <Icon name="plus" size="small" /> Add to my library
                  </button>
                </div>
              </details>
              <blockquote>{displayText(item.affirmation.text)}</blockquote>
              <footer>
                <button class="author author-button" type="button" onclick={() => openProfile(item.author.handle)}>
                  {#if item.author.avatarUrl}
                    <img src={item.author.avatarUrl} alt="" referrerpolicy="no-referrer" />
                  {:else}
                    <span class="avatar-fallback">{authorName(item).slice(0, 1).toUpperCase()}</span>
                  {/if}
                  <span>
                    <strong>{authorName(item)}</strong>
                    <small>@{item.author.handle} · {formatDate(item.createdAt)}</small>
                  </span>
                </button>
                <div class="card-actions">
                  <button
                    class="play"
                    class:active={audioMessageId === item.id && audioPhase === "playing"}
                    class:error={audioMessageId === item.id && audioPhase === "error"}
                    type="button"
                    aria-label="Listen to this affirmation"
                    onclick={() => toggleAudio(item)}
                  >
                    {#if audioMessageId === item.id && audioPhase === "loading"}
                      <LoadingSpinner size="small" />
                    {:else if audioMessageId === item.id && audioPhase === "playing"}
                      <PauseIcon size={15} weight="fill" aria-hidden="true" />
                    {:else}
                      <Icon name="play" size="small" weight="fill" />
                    {/if}
                  </button>
                  <button
                    class:active={item.engagement.glowed}
                    type="button"
                    disabled={isPending(pendingReactionIds, item.id)}
                    aria-label={item.engagement.glowed ? "Remove reaction" : "React with a heart"}
                    aria-pressed={item.engagement.glowed}
                    onclick={() => toggleReaction(item)}
                  >
                    <Icon name="heart" size="small" weight={item.engagement.glowed ? "fill" : "regular"} />
                  </button>
                </div>
              </footer>
            </article>
          {/each}
        </div>
      {/if}

      {#if profileNextCursor}
        <button
          class="member-load-more"
          type="button"
          disabled={profilePageLoading}
          onclick={loadMoreProfileAffirmations}
        >{profilePageLoading ? "Loading…" : "Load more"}</button>
      {/if}
    </section>
  {:else if activeTab === "chats" && viewState.status === "ready"}
    <section class="chat-view" aria-label="Community chats">
      <nav class="chat-channel-selector" aria-label="Chat channels">
        <span class="chat-channel-label">Channels</span>
        {#each chatChannels as channel, index (channel.id)}
          <button
            type="button"
            class:active={channel.slug === activeChatChannel}
            aria-pressed={channel.slug === activeChatChannel}
            data-tone={chatChannelTone(index)}
            onclick={() => selectChatChannel(channel.slug)}
          >
            <span class="chat-channel-avatar" aria-hidden="true">{chatChannelInitials(channel)}</span>
            <span class="chat-channel-copy">
              <strong>{channel.name}</strong>
              <small>{channel.description}</small>
            </span>
          </button>
        {/each}
      </nav>

      <div class="chat-panel">
        <header class="chat-thread-header" class:selection-active={chatSelectionActive()}>
          {#if chatSelectionActive()}
            <button
              class="chat-selection-close"
              type="button"
              aria-label="Cancel message selection"
              onclick={() => exitChatSelection()}
            ><Icon name="close" size="small" /></button>
            <strong class="chat-selection-count">
              {selectedChatMessageIds.length}
              {selectedChatMessageIds.length === 1 ? "message" : "messages"} selected
            </strong>
            {#if canDeleteSelectedChatMessages()}
              <button
                class="chat-selection-delete"
                type="button"
                aria-label="Delete selected messages"
                disabled={chatBulkDeletePending}
                onclick={() => (chatBulkDeleteConfirm = true)}
              ><TrashSimpleIcon size={19} aria-hidden="true" /></button>
            {/if}
          {:else}
            <div>
              <h1>{currentChatChannel()?.name ?? "Chats"}</h1>
              <p>{currentChatChannel()?.description ?? "Community conversation"}</p>
            </div>
          {/if}
        </header>

        <div
          class="chat-history"
          bind:this={chatHistoryElement}
          aria-live="polite"
          onscroll={queueVisibleChatReadAcknowledgement}
        >
          {#if chatItems.length > 0}<div class="chat-history-spacer" aria-hidden="true"></div>{/if}
          {#if chatHistoryLimited && chatItems.length > 0}
            <div class="chat-history-gate">
              <LockSimpleIcon size={17} weight="duotone" aria-hidden="true" />
              <span>
                <strong>There is more above this preview.</strong>
                <small>Lifetime members can browse the full conversation.</small>
              </span>
              <button type="button" onclick={() => hostApi.postMessage({ type: "openCommunityPremium" })}>
                Unlock history
              </button>
            </div>
          {/if}
          {#if chatNextCursor && !chatHistoryLimited}
            <button
              class="chat-load-older"
              type="button"
              disabled={chatLoadingOlder}
              onclick={loadOlderChatMessages}
            >{chatLoadingOlder ? "Loading earlier messages…" : "Load earlier messages"}</button>
          {/if}
          {#if chatLoading}
            <p class="chat-state">Loading conversation…</p>
          {:else if chatItems.length === 0 && !chatError}
            <p class="chat-state">No messages yet. Start the conversation.</p>
          {/if}
          {#if chatError && chatItems.length === 0}
            <p class="chat-error" role="status">{chatError}</p>
          {/if}
          {#each groupChatMessagesByDate(chatItems) as day (day.key)}
            <section class="chat-day-group">
              <p class="chat-date-marker">
                <time datetime={day.createdAt}>{formatChatDateLabel(day.createdAt)}</time>
              </p>
              {#each day.entries as entry (entry.message.id)}
                {@const message = entry.message}
                {@const index = entry.index}
                {@const ownMessage = message.author.userId === viewState.data.identity.id}
                <article
              class="chat-message"
              class:self={ownMessage}
              class:group-start={isChatGroupStart(chatItems, index)}
              class:group-end={isChatGroupEnd(chatItems, index)}
              class:highlighted={chatHighlightedMessageId === message.id}
              class:selection-mode={chatSelectionActive()}
              class:selected={selectedChatMessageIds.includes(message.id)}
              data-author-tone={chatAuthorTone(message.author.handle)}
              data-message-id={message.id}
              role={chatSelectionActive() ? "option" : undefined}
              aria-selected={chatSelectionActive()
                ? selectedChatMessageIds.includes(message.id)
                : undefined}
              onclick={(event) => toggleChatMessageSelection(event, message)}
              oncontextmenu={(event) => openChatContextMenu(event, message)}
            >
              {#if chatSelectionActive()}
                <span class="chat-selection-control" aria-hidden="true">
                  {#if selectedChatMessageIds.includes(message.id)}
                    <Icon name="check" size="small" weight="bold" />
                  {/if}
                </span>
              {/if}
              {#if !ownMessage && isChatGroupEnd(chatItems, index)}
                <button
                  class="chat-avatar"
                  type="button"
                  aria-label={`View ${chatAuthorName(message)}'s profile`}
                  onclick={() => openProfile(message.author.handle)}
                >{chatInitials(message)}</button>
              {:else if !ownMessage}
                <span class="chat-avatar-space" aria-hidden="true"></span>
              {/if}
              <div class="chat-bubble">
                {#if !ownMessage && isChatGroupStart(chatItems, index)}
                  <button
                    class="chat-author"
                    type="button"
                    onclick={() => openProfile(message.author.handle)}
                  >{chatAuthorName(message)}</button>
                {/if}
                {#if message.replyTo}
                  <button
                    class="chat-reply-snippet"
                    data-reply-tone={chatAuthorTone(message.replyTo.author.handle)}
                    type="button"
                    onclick={() => followChatReply(message)}
                  >
                    <strong>{message.replyTo.author.displayName?.trim() || message.replyTo.author.handle}</strong>
                    <span>{message.replyTo.body}</span>
                  </button>
                {/if}
                <p>{message.body}</p>
                <span class="chat-message-meta">
                  <time datetime={message.createdAt}>{formatChatTime(message.createdAt)}</time>
                  {#if ownMessage}
                    {#if message.delivery === "pending"}
                      <span class="chat-delivery pending" aria-label="Sending"><ClockIcon size={13} /></span>
                    {:else if message.delivery === "failed"}
                      <span class="chat-delivery failed" aria-label="Failed to send"><WarningCircleIcon size={14} /></span>
                    {:else if message.seenByOther}
                      <span class="chat-delivery seen" aria-label="Seen">
                        <Icon name="check" size="small" weight="bold" />
                        <Icon name="check" size="small" weight="bold" />
                      </span>
                    {:else}
                      <span class="chat-delivery sent" aria-label="Sent"><Icon name="check" size="small" weight="bold" /></span>
                    {/if}
                  {/if}
                </span>
              </div>
                </article>
              {/each}
            </section>
          {/each}
        </div>

        {#if unreadChatReplyTotal > 0 || currentChatReplyReturnStack().length > 0}
          <div class="chat-reply-navigation" aria-label="Reply navigation">
            {#if unreadChatReplyTotal > 0}
              <button
                class="chat-reply-navigation-button"
                type="button"
                disabled={pendingChatFocus !== null}
                aria-label={`Open next unread reply. ${unreadChatReplyTotal} unread.`}
                onclick={focusNextUnreadChatReply}
              >
                <ArrowBendUpLeftIcon size={20} weight="bold" aria-hidden="true" />
                <span>{unreadChatReplyTotal}</span>
              </button>
            {/if}
            {#if currentChatReplyReturnStack().length > 0}
              <button
                class="chat-reply-navigation-button"
                type="button"
                disabled={pendingChatFocus !== null}
                aria-label="Return to the reply"
                onclick={returnFromChatReply}
              >
                <ArrowDownIcon size={20} weight="bold" aria-hidden="true" />
              </button>
            {/if}
          </div>
        {/if}

        {#if chatContextMenu && contextChatMessage()}
          {@const contextMessage = contextChatMessage()!}
          <div
            class="chat-context-menu"
            role="menu"
            aria-label="Message actions"
            style:left={`${chatContextMenu.x}px`}
            style:top={`${chatContextMenu.y}px`}
          >
            {#if chatDeleteConfirmId === contextMessage.id}
              <p>Delete this message?</p>
              <button class="destructive" type="button" onclick={() => deleteChatMessage(contextMessage)}>
                <TrashSimpleIcon size={17} aria-hidden="true" /> Delete message
              </button>
              <button type="button" onclick={() => (chatDeleteConfirmId = null)}>Cancel</button>
            {:else}
              {#if contextMessage.delivery === "failed"}
                <button type="button" role="menuitem" onclick={() => retryChatMessage(contextMessage)}>
                  <Icon name="regenerate" size="small" /> Retry
                </button>
              {:else if contextMessage.delivery !== "pending" && viewState.data.identity.canContribute}
                <button type="button" role="menuitem" onclick={() => beginChatReply(contextMessage)}>
                  <ArrowBendUpLeftIcon size={17} /> Reply
                </button>
              {/if}
              <button type="button" role="menuitem" onclick={() => copyChatMessage(contextMessage)}>
                <CopySimpleIcon size={17} aria-hidden="true" /> Copy text
              </button>
              {#if contextMessage.delivery !== "pending" && contextMessage.delivery !== "failed"}
                <button type="button" role="menuitem" onclick={() => enterChatSelection(contextMessage)}>
                  <Icon name="check" size="small" /> Select
                </button>
              {/if}
              {#if contextMessage.permissions.canDelete && contextMessage.delivery !== "pending"}
                <button
                  class="destructive"
                  type="button"
                  role="menuitem"
                  onclick={() => (chatDeleteConfirmId = contextMessage.id)}
                ><TrashSimpleIcon size={17} aria-hidden="true" /> Delete</button>
              {/if}
            {/if}
          </div>
        {/if}

        {#if chatBulkDeleteConfirm}
          <div
            class="chat-delete-dialog-backdrop"
            role="presentation"
            onclick={(event) => {
              if (event.target === event.currentTarget) chatBulkDeleteConfirm = false;
            }}
          >
            <div class="chat-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="bulk-delete-title">
              <h2 id="bulk-delete-title">
                Delete {selectedChatMessageIds.length}
                {selectedChatMessageIds.length === 1 ? "message" : "messages"}?
              </h2>
              <p>This cannot be undone.</p>
              <div>
                <button type="button" onclick={() => (chatBulkDeleteConfirm = false)}>Cancel</button>
                <button
                  class="destructive"
                  type="button"
                  disabled={chatBulkDeletePending}
                  onclick={deleteSelectedChatMessages}
                >Delete</button>
              </div>
            </div>
          </div>
        {/if}

        {#if viewState.data.identity.canContribute && !chatSelectionActive()}
          <form class="chat-composer" onsubmit={submitChatMessage}>
            {#if chatError}<p class="chat-error" role="alert">{chatError}</p>{/if}
            {#if chatReplyTarget}
              <div
                class="chat-composer-reply"
                data-reply-tone={chatAuthorTone(chatReplyTarget.author.handle)}
              >
                <ArrowBendUpLeftIcon size={18} />
                <div>
                  <strong>Replying to {chatAuthorName(chatReplyTarget)}</strong>
                  <span>{chatReplyTarget.body}</span>
                </div>
                <button type="button" aria-label="Cancel reply" onclick={cancelChatReply}>
                  <Icon name="close" size="small" />
                </button>
              </div>
            {/if}
            <textarea
              bind:value={chatDraft}
              bind:this={chatComposerInput}
              maxlength="4000"
              rows="1"
              aria-label="Message"
              autocomplete="off"
              placeholder="Write a message…"
              disabled={!online || !activeChatChannel}
              oninput={resizeChatComposer}
              onkeydown={handleChatComposerKeydown}
            ></textarea>
            <button
              type="submit"
              aria-label="Send message"
              disabled={!online || chatSending || !chatDraft.trim() || !activeChatChannel}
            ><PaperPlaneRightIcon size={17} weight="fill" aria-hidden="true" /></button>
          </form>
        {:else if !viewState.data.identity.canContribute}
          <div class="community-read-only">
            <span>Chats are read-only on Free.</span>
            <button type="button" onclick={() => hostApi.postMessage({ type: "openCommunityPremium" })}
              >Get lifetime access</button
            >
          </div>
        {/if}
      </div>
    </section>
  {:else if viewState.status === "loading"}
    <section class="center-state"><LoadingSpinner size="prominent" /><p>Opening community…</p></section>
  {:else if viewState.status === "signed_out"}
    <section class="center-state">
      <h1>Sign in to visit the community.</h1>
      <button type="button" onclick={() => hostApi.postMessage({ type: "focusGlow" })}>Open Glow</button>
    </section>
  {:else if viewState.status === "not_member"}
    <section class="center-state">
      <h1>Set up your community profile first.</h1>
      <p>Your handle and profile are created on the web.</p>
      <button
        type="button"
        onclick={() => hostApi.postMessage({ type: "openCommunityOnWeb", destination: "profile" })}
      >Set up profile <Icon name="external" size="small" /></button>
    </section>
  {:else if viewState.status === "error"}
    <section class="center-state">
      <h1>Community is quiet for now.</h1>
      <p>{viewState.message}</p>
      <button type="button" onclick={() => hostApi.postMessage({ type: "communityReady" })}>Try again</button>
    </section>
  {:else}
    <section class="feed" aria-label="Community affirmations">
      {#if items.length === 0}
        <div class="center-state feed-empty"><h1>No affirmations yet.</h1></div>
      {:else}
        <div class="affirmation-grid">
          {#each items as item (item.id)}
            <article class="affirmation-card" data-tone={toneFor(item.affirmation.text)}>
              <details class="card-menu">
                <summary
                  aria-label={isPending(pendingLibraryIds, item.id)
                    ? "Adding affirmation to your library"
                    : `More actions for ${authorName(item)}`}
                  onclick={(event) => {
                    if (isPending(pendingLibraryIds, item.id)) event.preventDefault();
                  }}
                >
                  {#if isPending(pendingLibraryIds, item.id)}
                    <LoadingSpinner size="small" />
                  {:else}
                    <Icon name="more" size="small" weight="bold" />
                  {/if}
                </summary>
                <div class="menu-panel">
                  <button
                    type="button"
                    disabled={isPending(pendingLibraryIds, item.id)}
                    onclick={(event) => addToLibrary(item, event.currentTarget.closest("details"))}
                  >
                    <Icon name="plus" size="small" /> Add to my library
                  </button>
                </div>
              </details>

              <blockquote>{displayText(item.affirmation.text)}</blockquote>

              <footer>
                <button
                  class="author author-button"
                  type="button"
                  onclick={() => openProfile(item.author.handle)}
                >
                  {#if item.author.avatarUrl}
                    <img src={item.author.avatarUrl} alt="" referrerpolicy="no-referrer" />
                  {:else}
                    <span class="avatar-fallback">{authorName(item).slice(0, 1).toUpperCase()}</span>
                  {/if}
                  <span>
                    <strong>{authorName(item)}</strong>
                    <small>@{item.author.handle} · {formatDate(item.createdAt)}</small>
                  </span>
                </button>
                <div class="card-actions">
                  <button
                    class="play"
                    class:active={audioMessageId === item.id && audioPhase === "playing"}
                    class:error={audioMessageId === item.id && audioPhase === "error"}
                    type="button"
                    aria-label={audioMessageId === item.id && audioPhase === "playing"
                      ? "Pause affirmation"
                      : "Listen to this affirmation"}
                    onclick={() => toggleAudio(item)}
                  >
                    {#if audioMessageId === item.id && audioPhase === "loading"}
                      <LoadingSpinner size="small" />
                    {:else if audioMessageId === item.id && audioPhase === "playing"}
                      <PauseIcon size={15} weight="fill" aria-hidden="true" />
                    {:else}
                      <Icon name="play" size="small" weight="fill" />
                    {/if}
                  </button>
                  <button
                    class:active={item.engagement.glowed}
                    type="button"
                    disabled={isPending(pendingReactionIds, item.id)}
                    aria-label={item.engagement.glowed ? "Remove reaction" : "React with a heart"}
                    aria-pressed={item.engagement.glowed}
                    onclick={() => toggleReaction(item)}
                  >
                    <Icon name="heart" size="small" weight={item.engagement.glowed ? "fill" : "regular"} />
                  </button>
                </div>
              </footer>
            </article>
          {/each}
        </div>
      {/if}

      {#if nextCursor}
        <div class="feed-sentinel" use:observeFeedEnd aria-live="polite">
          {#if pageLoading}<span>Loading earlier affirmations…</span>{/if}
        </div>
      {/if}
      {#if nextCursor && pageLoadFailed}
        <button class="retry-page" type="button" onclick={retryPage}>Try loading again</button>
      {/if}
    </section>

    <button
      class="compose"
      type="button"
      aria-label="Share an affirmation on the web"
      onclick={() => hostApi.postMessage({ type: "openCommunityOnWeb", destination: "compose" })}
    ><FeatherIcon size={22} aria-hidden="true" /></button>
  {/if}

  {#if toast}
    <AppToast message={toast.message} tone={toast.tone} onDismiss={dismissToast} />
  {/if}
</main>

<style>
  .community-shell {
    --tile-bg: #dedbd4;
    --tile-text: #34322e;
    --tile-muted: #6e6a62;
    --tile-accent: #82766a;
    --tile-rule: rgb(52 50 46 / 14%);
    width: 100%;
    height: 100%;
    overflow-y: auto;
    background: var(--sol-bg);
    color: var(--sol-text);
  }
  .community-shell.chat-open { overflow: hidden; }

  .community-header {
    position: sticky;
    z-index: 30;
    top: 0;
    display: grid;
    width: min(calc(100% - 48px), 1180px);
    min-height: 48px;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    margin: 0 auto;
    background: color-mix(in srgb, var(--sol-bg) 94%, transparent);
    backdrop-filter: blur(14px);
  }

  .brand,
  .profile-space {
    display: grid;
    width: 28px;
    height: 28px;
    place-items: center;
  }

  .profile-brand {
    grid-column: 2;
    justify-self: center;
  }

  .profile-back {
    display: inline-flex;
    width: fit-content;
    align-items: center;
    gap: 7px;
    padding: 7px 0;
    border: 0;
    background: transparent;
    color: var(--sol-muted);
    cursor: pointer;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
  }

  .profile-back:hover { color: var(--sol-text); }

  .member-view {
    width: min(calc(100% - 48px), 1180px);
    margin: 0 auto;
    padding: 48px 0 96px;
  }

  .member-identity {
    display: grid;
    max-width: 760px;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 24px;
    margin-bottom: 38px;
  }

  .member-avatar,
  .member-avatar img {
    width: 88px;
    height: 88px;
    border-radius: 24px;
  }

  .member-avatar {
    display: grid;
    place-items: center;
    border: 1px solid var(--sol-border);
    background: var(--sol-panel);
    color: var(--sol-accent);
    font-size: 32px;
    font-weight: 650;
  }

  .member-avatar img { object-fit: cover; }

  .member-copy h1 {
    margin: 0;
    color: var(--sol-text);
    font-size: clamp(27px, 3vw, 36px);
    font-weight: 580;
    letter-spacing: -0.035em;
    line-height: 1.05;
  }

  .member-handle,
  .member-bio { margin: 0; }
  .member-handle { margin-top: 5px; color: var(--sol-muted); font-size: 12px; }
  .member-bio {
    max-width: 58ch;
    margin-top: 14px;
    color: color-mix(in srgb, var(--sol-text) 74%, transparent);
    font-size: 15px;
    line-height: 1.6;
  }

  .member-tabs {
    display: flex;
    gap: 24px;
    margin-bottom: 28px;
    border-bottom: 1px solid var(--sol-border);
  }

  .member-tabs button {
    position: relative;
    min-height: 44px;
    padding: 0 2px;
    border: 0;
    background: transparent;
    color: var(--sol-text);
    font: inherit;
    font-size: 13px;
    font-weight: 590;
  }

  .member-tabs button::after {
    position: absolute;
    right: 0;
    bottom: -1px;
    left: 0;
    height: 2px;
    border-radius: 999px;
    background: var(--sol-accent);
    content: "";
  }

  .member-empty {
    padding: 64px 0;
    color: var(--sol-muted);
    text-align: center;
  }
  .member-empty h2 { margin: 0; color: var(--sol-text); font-size: 18px; }
  .member-load-more {
    display: block;
    min-width: 118px;
    margin: 20px auto 0;
    padding: 10px 16px;
    border: 1px solid var(--sol-border);
    border-radius: 999px;
    background: transparent;
    color: var(--sol-text);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
  }

  .tabs {
    position: relative;
    display: grid;
    width: 230px;
    height: 38px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 3px;
    justify-self: center;
    overflow: hidden;
    padding: 3px;
    border: 1px solid var(--sol-border);
    border-radius: 999px;
    background: var(--sol-control-bg);
  }

  .tab-indicator,
  .tabs button { grid-row: 1; }

  .tab-indicator {
    z-index: 0;
    grid-column: 1;
    border: 1px solid var(--sol-row-active-border);
    border-radius: 999px;
    background: var(--sol-row-active);
    pointer-events: none;
    transition: transform 420ms cubic-bezier(0.2, 0, 0, 1);
  }

  .tab-indicator.chats-selected { transform: translateX(calc(100% + 3px)); }

  .tabs button {
    z-index: 1;
    min-width: 0;
    border: 0;
    border-radius: 999px;
    padding: 0 10px;
    background: transparent;
    color: var(--sol-muted);
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
  }

  .tabs button:nth-of-type(1) { grid-column: 1; }
  .tabs button:nth-of-type(2) { grid-column: 2; }

  .tabs button.active {
    background: transparent;
    color: var(--sol-text);
    font-weight: 600;
  }

  .profile-trigger {
    display: grid;
    width: 40px;
    height: 40px;
    place-items: center;
    justify-self: end;
    padding: 3px;
    border: 1px solid transparent;
    border-radius: 11px;
    background: transparent;
    color: var(--sol-muted);
    cursor: pointer;
    list-style: none;
  }

  .profile-trigger::-webkit-details-marker { display: none; }
  .profile-trigger:hover,
  .profile-menu[open] .profile-trigger {
    border-color: var(--sol-border);
    background: var(--sol-control-bg);
    color: var(--sol-text);
  }

  .profile-menu {
    position: relative;
    justify-self: end;
  }

  .profile-menu-panel {
    position: absolute;
    z-index: 40;
    top: calc(100% + 7px);
    right: 0;
    width: 210px;
    padding: 6px;
    border: 1px solid var(--sol-border);
    border-radius: 9px;
    background: var(--sol-panel);
    box-shadow: 0 14px 34px rgb(0 0 0 / 28%);
  }

  .profile-menu-identity {
    display: grid;
    gap: 2px;
    margin-bottom: 5px;
    padding: 9px 10px 10px;
    border-bottom: 1px solid var(--sol-rule);
  }

  .profile-menu-identity strong { overflow: hidden; font-size: 12px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
  .profile-menu-identity span { overflow: hidden; color: var(--sol-muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }

  .profile-menu-item {
    display: flex;
    width: 100%;
    min-height: 38px;
    align-items: center;
    justify-content: space-between;
    padding: 0 10px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--sol-muted);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    font-weight: 650;
  }

  .profile-menu-item:hover {
    background: var(--sol-row-hover);
    color: var(--sol-text);
  }

  .profile-menu-item.sign-out {
    margin-top: 4px;
    border-top: 1px solid var(--sol-rule);
    border-radius: 0 0 5px 5px;
  }

  .feed {
    width: min(1180px, calc(100% - 40px));
    min-height: calc(100% - 48px);
    margin: 0 auto;
    padding: 20px 0 110px;
  }

  .chat-view {
    box-sizing: border-box;
    display: grid;
    width: min(calc(100% - 48px), 1180px);
    height: calc(100% - 48px);
    min-width: 0;
    min-height: 0;
    grid-template-columns: 260px minmax(0, 1fr);
    align-items: start;
    gap: clamp(36px, 5vw, 72px);
    margin: 0 auto;
    padding-top: clamp(40px, 6vh, 68px);
    font-family: Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .chat-channel-selector {
    display: grid;
    align-content: start;
    gap: 2px;
  }

  .chat-channel-label {
    margin: 0 10px 8px;
    color: var(--sol-muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }

  .chat-channel-selector button {
    display: grid;
    min-height: 62px;
    grid-template-columns: 40px minmax(0, 1fr);
    align-items: center;
    gap: 11px;
    padding: 7px 10px;
    border: 0;
    border-radius: 12px;
    background: transparent;
    color: var(--sol-muted);
    cursor: pointer;
    font: inherit;
    text-align: left;
  }

  .chat-channel-selector button:hover {
    background: color-mix(in srgb, var(--sol-text) 5%, transparent);
    color: var(--sol-text);
  }

  .chat-channel-selector button.active {
    background: color-mix(in srgb, var(--sol-text) 8%, transparent);
    color: var(--sol-text);
  }

  .chat-channel-avatar {
    display: grid;
    width: 40px;
    height: 40px;
    place-items: center;
    border-radius: 50%;
    background: color-mix(in srgb, var(--channel-color) 18%, var(--sol-panel));
    color: var(--channel-color);
    font-size: 10px;
    font-weight: 600;
  }

  .chat-channel-selector button[data-tone="coral"] { --channel-color: light-dark(#b65439, #f08b67); }
  .chat-channel-selector button[data-tone="blue"] { --channel-color: light-dark(#3f739d, #78a9d1); }
  .chat-channel-selector button[data-tone="violet"] { --channel-color: light-dark(#75589a, #aa8acc); }
  .chat-channel-selector button[data-tone="sage"] { --channel-color: light-dark(#52785d, #86ad8e); }

  .chat-channel-copy { display: grid; min-width: 0; gap: 3px; }
  .chat-channel-copy strong {
    overflow: hidden;
    color: var(--sol-text);
    font-size: 14px;
    font-weight: 500;
    line-height: 1.15;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chat-channel-copy small {
    overflow: hidden;
    color: var(--sol-muted);
    font-size: 12px;
    line-height: 1.15;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chat-panel {
    position: relative;
    display: grid;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    grid-template-rows: auto minmax(0, 1fr) auto;
  }

  .chat-thread-header {
    display: flex;
    min-height: 62px;
    align-items: start;
    justify-content: space-between;
    padding: 5px 0 15px;
    border-bottom: 1px solid var(--sol-rule);
  }
  .chat-thread-header h1 { margin: 0; color: var(--sol-text); font-size: 16px; font-weight: 500; }
  .chat-thread-header p { margin: 5px 0 0; color: var(--sol-muted); font-size: 14px; line-height: 1.4; }
  .chat-thread-header.selection-active { align-items: center; gap: 12px; padding-block: 8px 14px; }
  .chat-selection-close,
  .chat-selection-delete {
    display: grid;
    width: 38px;
    height: 38px;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--sol-muted);
    cursor: pointer;
  }
  .chat-selection-close:hover,
  .chat-selection-close:focus-visible,
  .chat-selection-delete:hover,
  .chat-selection-delete:focus-visible { outline: 0; background: light-dark(#e7e7e4, #242728); color: var(--sol-text); }
  .chat-selection-delete { margin-left: auto; color: light-dark(#b74232, #f08b74); }
  .chat-selection-count { color: var(--sol-text); font-size: 15px; font-weight: 600; }

  .chat-history {
    display: flex;
    flex-direction: column;
    min-height: 0;
    gap: 3px;
    padding: 24px 2px 28px;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: none;
  }
  .chat-history::-webkit-scrollbar { display: none; }
  .chat-history-spacer { min-height: 0; flex: 1 0 0; }
  .chat-day-group {
    display: flex;
    min-width: 0;
    flex: 0 0 auto;
    flex-direction: column;
    gap: 3px;
  }

  .chat-history-gate {
    position: relative;
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    margin: 0 2px 22px;
    padding: 14px 16px;
    border: 1px solid color-mix(in srgb, var(--sol-accent) 24%, var(--sol-rule));
    border-radius: 14px;
    background:
      linear-gradient(to bottom, color-mix(in srgb, var(--sol-bg) 24%, transparent), transparent),
      color-mix(in srgb, var(--sol-accent) 7%, var(--sol-panel));
    color: var(--sol-accent);
    align-self: stretch;
  }

  .chat-history-gate::before {
    position: absolute;
    right: 18px;
    bottom: calc(100% + 1px);
    left: 18px;
    height: 28px;
    background: linear-gradient(to top, var(--sol-bg), transparent);
    content: "";
    pointer-events: none;
  }

  .chat-history-gate > span { display: grid; gap: 2px; }
  .chat-history-gate strong { color: var(--sol-text); font-size: 13px; font-weight: 600; }
  .chat-history-gate small { color: var(--sol-muted); font-size: 11px; }
  .chat-history-gate button {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--sol-accent);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    white-space: nowrap;
  }

  .chat-reply-navigation {
    position: absolute;
    right: 5px;
    bottom: 84px;
    z-index: 12;
    display: grid;
    gap: 8px;
  }

  .chat-reply-navigation-button {
    position: relative;
    display: grid;
    width: 42px;
    height: 42px;
    place-items: center;
    padding: 0;
    border: 1px solid color-mix(in srgb, var(--sol-border) 82%, transparent);
    border-radius: 50%;
    background: light-dark(#fff, #242728);
    color: var(--sol-muted);
    box-shadow: 0 3px 12px rgb(0 0 0 / 16%);
    cursor: pointer;
  }

  .chat-reply-navigation-button:hover,
  .chat-reply-navigation-button:focus-visible {
    outline: 0;
    color: var(--sol-accent);
  }

  .chat-reply-navigation-button:disabled {
    opacity: 0.58;
    cursor: default;
  }

  .chat-reply-navigation-button span {
    position: absolute;
    top: -6px;
    right: -5px;
    display: grid;
    min-width: 20px;
    height: 20px;
    place-items: center;
    padding: 0 5px;
    border: 2px solid var(--sol-bg);
    border-radius: 999px;
    background: var(--sol-accent);
    color: var(--sol-button-fg);
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
  }

  .chat-message {
    --chat-author-color: var(--chat-peer-accent);
    position: relative;
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr);
    align-items: end;
    gap: 8px;
  }
  .chat-message.selection-mode { padding-left: 38px; cursor: pointer; user-select: none; }
  .chat-message.self.selection-mode { padding-right: 38px; padding-left: 0; }
  .chat-message.selection-mode .chat-bubble,
  .chat-message.selection-mode .chat-avatar,
  .chat-message.selection-mode .chat-avatar-space { pointer-events: none; }
  .chat-selection-control {
    position: absolute;
    bottom: 6px;
    left: 4px;
    display: grid;
    width: 24px;
    height: 24px;
    place-items: center;
    border: 2px solid color-mix(in srgb, var(--sol-muted) 62%, transparent);
    border-radius: 50%;
    background: var(--sol-bg);
    color: #171210;
  }
  .chat-message.self .chat-selection-control { right: 4px; left: auto; }
  .chat-message.selected .chat-selection-control { border-color: var(--sol-accent); background: var(--sol-accent); }
  .chat-message.selected .chat-bubble { box-shadow: 0 0 0 2px color-mix(in srgb, var(--sol-accent) 58%, transparent); }
  .chat-message.group-start:not(:first-child) { margin-top: 9px; }
  .chat-message.self { grid-template-columns: minmax(0, 1fr); justify-items: end; }
  .chat-avatar,
  .chat-avatar-space { width: 32px; height: 32px; }
  .chat-avatar {
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: color-mix(in srgb, var(--chat-author-color) 18%, var(--sol-panel));
    color: var(--chat-author-color);
    font-size: 9px;
    font-weight: 720;
    padding: 0;
    border: 0;
    cursor: pointer;
  }

  .chat-message[data-author-tone="coral"], .chat-reply-snippet[data-reply-tone="coral"], .chat-composer-reply[data-reply-tone="coral"] { --chat-peer-accent: light-dark(#b65439, #f08b67); }
  .chat-message[data-author-tone="amber"], .chat-reply-snippet[data-reply-tone="amber"], .chat-composer-reply[data-reply-tone="amber"] { --chat-peer-accent: light-dark(#94642d, #d9a65b); }
  .chat-message[data-author-tone="violet"], .chat-reply-snippet[data-reply-tone="violet"], .chat-composer-reply[data-reply-tone="violet"] { --chat-peer-accent: light-dark(#75589a, #aa8acc); }
  .chat-message[data-author-tone="sage"], .chat-reply-snippet[data-reply-tone="sage"], .chat-composer-reply[data-reply-tone="sage"] { --chat-peer-accent: light-dark(#52785d, #86ad8e); }
  .chat-message[data-author-tone="sky"], .chat-reply-snippet[data-reply-tone="sky"], .chat-composer-reply[data-reply-tone="sky"] { --chat-peer-accent: light-dark(#3f739d, #78a9d1); }
  .chat-message[data-author-tone="blue"], .chat-reply-snippet[data-reply-tone="blue"], .chat-composer-reply[data-reply-tone="blue"] { --chat-peer-accent: light-dark(#475f98, #839bd2); }
  .chat-message[data-author-tone="rose"], .chat-reply-snippet[data-reply-tone="rose"], .chat-composer-reply[data-reply-tone="rose"] { --chat-peer-accent: light-dark(#98536b, #d58aa2); }

  .chat-bubble {
    position: relative;
    width: fit-content;
    max-width: min(72%, 570px);
    min-height: 34px;
    padding: 7px 68px 7px 12px;
    border-radius: 14px;
    background: light-dark(#e9e9e6, #202324);
    color: var(--sol-text);
  }
  .chat-message:not(.group-start) .chat-bubble { border-top-left-radius: 7px; }
  .chat-message:not(.group-end) .chat-bubble { border-bottom-left-radius: 7px; }
  .chat-message.group-end:not(.self) .chat-bubble { border-bottom-left-radius: 4px; }
  .chat-message.self .chat-bubble {
    padding-right: 92px;
    border-bottom-right-radius: 4px;
    background: light-dark(#f1ddd5, #442c25);
  }
  .chat-message.highlighted .chat-bubble {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--sol-accent) 58%, transparent);
  }

  .chat-author {
    display: block;
    margin-bottom: 1px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--chat-author-color);
    cursor: pointer;
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    line-height: 20px;
  }
  .chat-bubble > p { margin: 0; font-size: 16px; line-height: 1.3125; overflow-wrap: anywhere; white-space: pre-wrap; }
  .chat-message-meta {
    position: absolute;
    right: 9px;
    bottom: 7px;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: color-mix(in srgb, var(--sol-muted) 82%, transparent);
    font-size: 12px;
    line-height: 1;
    white-space: nowrap;
  }
  .chat-delivery { display: inline-flex; color: var(--sol-accent-hover); }
  .chat-delivery.seen :global(svg + svg) { margin-left: -7px; }
  .chat-delivery :global(svg) { width: 13px !important; height: 13px !important; }
  .chat-delivery.pending { color: var(--sol-muted); }
  .chat-delivery.failed { color: light-dark(#b74232, #f08b74); }

  .chat-reply-snippet {
    position: relative;
    display: grid;
    width: 100%;
    min-width: 0;
    gap: 1px;
    margin: 1px 0 5px;
    padding: 3px 9px 3px 11px;
    overflow: hidden;
    border: 0;
    border-radius: 4px;
    background: color-mix(in srgb, var(--chat-peer-accent) 10%, transparent);
    color: inherit;
    font: inherit;
    text-align: left;
  }
  .chat-reply-snippet::before { position: absolute; inset: 0 auto 0 0; width: 3px; background: var(--chat-peer-accent); content: ""; }
  .chat-reply-snippet strong,
  .chat-reply-snippet span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chat-reply-snippet strong { color: var(--chat-peer-accent); font-size: 12px; font-weight: 600; }
  .chat-reply-snippet span { color: var(--sol-muted); font-size: 12px; }

  .chat-date-marker,
  .chat-load-older {
    align-self: center;
    border: 0;
    border-radius: 999px;
    padding: 5px 10px;
    background: color-mix(in srgb, var(--sol-text) 9%, transparent);
    color: var(--sol-muted);
    font-size: 11px;
    font-weight: 500;
    line-height: 1;
  }
  .chat-date-marker {
    position: sticky;
    top: 12px;
    z-index: 2;
    margin: 13px 0 8px;
    pointer-events: none;
    user-select: none;
  }
  .chat-history-spacer + .chat-day-group > .chat-date-marker,
  .chat-load-older + .chat-day-group > .chat-date-marker { margin-top: 0; }
  .chat-date-marker + .chat-message.group-start { margin-top: 0; }
  .chat-load-older { margin: 0 0 11px; }
  .chat-load-older { cursor: pointer; }
  .chat-state { align-self: center; margin: auto 0; color: var(--sol-muted); font-size: 14px; text-align: center; }

  .chat-context-menu {
    position: fixed;
    z-index: 80;
    display: grid;
    width: 196px;
    gap: 2px;
    padding: 6px;
    border: 1px solid color-mix(in srgb, var(--sol-border) 76%, transparent);
    border-radius: 12px;
    background: color-mix(in srgb, var(--sol-panel) 92%, transparent);
    box-shadow: 0 12px 32px rgb(0 0 0 / 22%);
    backdrop-filter: blur(14px);
  }
  .chat-context-menu button {
    display: flex;
    width: 100%;
    min-height: 38px;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--sol-text);
    cursor: pointer;
    font: inherit;
    font-size: 14px;
    text-align: left;
  }
  .chat-context-menu button:hover { background: color-mix(in srgb, var(--sol-text) 8%, transparent); }
  .chat-context-menu p { margin: 5px 9px 4px; color: var(--sol-text); font-size: 13px; font-weight: 500; }
  .chat-context-menu button.destructive { color: light-dark(#b74232, #f08b74); }
  .chat-delete-dialog-backdrop {
    position: fixed;
    z-index: 100;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgb(0 0 0 / 36%);
    backdrop-filter: blur(2px);
  }
  .chat-delete-dialog {
    width: min(100%, 340px);
    padding: 20px;
    border: 1px solid var(--sol-border);
    border-radius: 14px;
    background: var(--sol-panel);
    box-shadow: 0 18px 52px rgb(0 0 0 / 28%);
  }
  .chat-delete-dialog h2 { margin: 0; color: var(--sol-text); font-size: 16px; font-weight: 650; }
  .chat-delete-dialog p { margin: 8px 0 20px; color: var(--sol-muted); font-size: 13px; }
  .chat-delete-dialog > div { display: flex; justify-content: flex-end; gap: 8px; }
  .chat-delete-dialog button {
    min-height: 38px;
    padding: 0 14px;
    border: 0;
    border-radius: 9px;
    background: light-dark(#e7e7e4, #242728);
    color: var(--sol-text);
    cursor: pointer;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
  }
  .chat-delete-dialog button.destructive { background: light-dark(#b74232, #d9654f); color: #fff; }

  .chat-composer {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 44px;
    align-items: center;
    gap: 10px;
    padding-bottom: 14px;
  }
  .chat-error { grid-column: 1 / -1; margin: 0 2px 2px; color: var(--sol-accent-hover); font-size: 12px; line-height: 1.35; }
  .chat-composer textarea {
    width: 100%;
    min-width: 0;
    height: 48px;
    max-height: 120px;
    padding: 13px 16px;
    border: 0;
    border-radius: 999px;
    outline: 0;
    overflow-y: auto;
    resize: none;
    background: light-dark(#fff, #202324);
    color: var(--sol-text);
    box-shadow: 0 1px 8px 1px rgb(0 0 0 / 12%);
    font: inherit;
    font-size: 16px;
    line-height: 1.3125;
  }
  .chat-composer textarea::placeholder { color: var(--sol-muted); }
  .chat-composer > button[type="submit"] {
    display: grid;
    width: 44px;
    height: 44px;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--sol-accent);
    color: var(--sol-button-fg);
    cursor: pointer;
  }
  .chat-composer > button[type="submit"]:disabled { opacity: 0.34; cursor: default; }

  .chat-composer-reply {
    display: grid;
    min-width: 0;
    grid-column: 1 / -1;
    grid-template-columns: 22px minmax(0, 1fr) 30px;
    align-items: center;
    gap: 8px;
    padding: 2px 6px 5px;
    color: var(--chat-peer-accent);
  }
  .chat-composer-reply > div { position: relative; display: grid; min-width: 0; gap: 1px; padding: 3px 9px 3px 11px; overflow: hidden; border-radius: 4px; background: color-mix(in srgb, var(--chat-peer-accent) 10%, transparent); }
  .chat-composer-reply > div::before { position: absolute; inset: 0 auto 0 0; width: 3px; background: var(--chat-peer-accent); content: ""; }
  .chat-composer-reply strong,
  .chat-composer-reply span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chat-composer-reply strong { color: var(--chat-peer-accent); font-size: 13px; font-weight: 600; }
  .chat-composer-reply span { color: var(--sol-muted); font-size: 12px; }
  .chat-composer-reply button { display: grid; width: 30px; height: 30px; place-items: center; padding: 0; border: 0; background: transparent; color: var(--sol-muted); cursor: pointer; }

  .community-read-only {
    display: flex;
    min-height: 58px;
    align-items: center;
    justify-content: center;
    gap: 12px;
    border-top: 1px solid var(--sol-rule);
    color: var(--sol-muted);
    font-size: 13px;
  }
  .community-read-only button { border: 0; background: transparent; color: var(--sol-accent); cursor: pointer; font: inherit; font-weight: 700; }

  .affirmation-grid {
    display: block;
    columns: 3 280px;
    column-gap: 16px;
  }

  .affirmation-card {
    position: relative;
    display: inline-grid;
    width: 100%;
    margin: 0 0 16px;
    padding: 18px;
    break-inside: avoid;
    border: 1px solid var(--tile-rule);
    border-radius: 18px;
    background: var(--tile-bg);
    color: var(--tile-text);
  }

  .affirmation-card[data-tone="clay"] {
    --tile-bg: #ead4c8;
    --tile-text: #482d25;
    --tile-muted: #80665b;
    --tile-accent: #a84f34;
    --tile-rule: rgb(72 45 37 / 14%);
  }
  .affirmation-card[data-tone="moss"] {
    --tile-bg: #dce1cb;
    --tile-text: #30362a;
    --tile-muted: #68705c;
    --tile-accent: #73804e;
    --tile-rule: rgb(48 54 42 / 14%);
  }
  .affirmation-card[data-tone="dusk"] {
    --tile-bg: #d6dce3;
    --tile-text: #2e343d;
    --tile-muted: #626b77;
    --tile-accent: #68768a;
    --tile-rule: rgb(46 52 61 / 14%);
  }
  .affirmation-card[data-tone="amber"] {
    --tile-bg: #eadfc4;
    --tile-text: #413729;
    --tile-muted: #786d59;
    --tile-accent: #9a7540;
    --tile-rule: rgb(65 55 41 / 14%);
  }
  .affirmation-card[data-tone="plum"] {
    --tile-bg: #dfd5df;
    --tile-text: #3b303b;
    --tile-muted: #716471;
    --tile-accent: #826183;
    --tile-rule: rgb(59 48 59 / 14%);
  }
  .affirmation-card[data-tone="stone"] {
    --tile-bg: #dedbd4;
    --tile-text: #34322e;
    --tile-muted: #6e6a62;
    --tile-accent: #82766a;
    --tile-rule: rgb(52 50 46 / 14%);
  }

  :global(html[data-sol-theme="dark"]) .affirmation-card,
  :global(html[data-sol-theme="editor"] body.vscode-dark) .affirmation-card,
  :global(html[data-sol-theme="editor"] body.vscode-high-contrast) .affirmation-card {
    --tile-bg: #292725;
    --tile-text: #eeeae4;
    --tile-muted: #a5a09a;
    --tile-accent: #b09c89;
    --tile-rule: rgb(241 233 226 / 11%);
  }
  :global(html[data-sol-theme="dark"]) .affirmation-card[data-tone="clay"],
  :global(html[data-sol-theme="editor"] body.vscode-dark) .affirmation-card[data-tone="clay"] {
    --tile-bg: #33231e; --tile-text: #f3e4dc; --tile-muted: #b79a8e; --tile-accent: #eb7a52;
  }
  :global(html[data-sol-theme="dark"]) .affirmation-card[data-tone="moss"],
  :global(html[data-sol-theme="editor"] body.vscode-dark) .affirmation-card[data-tone="moss"] {
    --tile-bg: #25291f; --tile-text: #e8eadc; --tile-muted: #a1a68d; --tile-accent: #a9b275;
  }
  :global(html[data-sol-theme="dark"]) .affirmation-card[data-tone="dusk"],
  :global(html[data-sol-theme="editor"] body.vscode-dark) .affirmation-card[data-tone="dusk"] {
    --tile-bg: #222830; --tile-text: #e7ebf0; --tile-muted: #99a3af; --tile-accent: #91a1b7;
  }
  :global(html[data-sol-theme="dark"]) .affirmation-card[data-tone="amber"],
  :global(html[data-sol-theme="editor"] body.vscode-dark) .affirmation-card[data-tone="amber"] {
    --tile-bg: #30291d; --tile-text: #f1e9d8; --tile-muted: #b1a184; --tile-accent: #d3a55b;
  }
  :global(html[data-sol-theme="dark"]) .affirmation-card[data-tone="plum"],
  :global(html[data-sol-theme="editor"] body.vscode-dark) .affirmation-card[data-tone="plum"] {
    --tile-bg: #2c242e; --tile-text: #eee5ef; --tile-muted: #aa98ac; --tile-accent: #bd8fbd;
  }
  :global(html[data-sol-theme="dark"]) .affirmation-card[data-tone="stone"],
  :global(html[data-sol-theme="editor"] body.vscode-dark) .affirmation-card[data-tone="stone"] {
    --tile-bg: #292725; --tile-text: #eeeae4; --tile-muted: #a5a09a; --tile-accent: #b09c89;
  }

  blockquote {
    max-width: 22ch;
    margin: 38px auto 26px;
    color: var(--tile-text);
    font-family: var(--sol-font-ui);
    font-size: clamp(26px, 2.35vw, 36px);
    font-weight: 560;
    letter-spacing: -0.025em;
    line-height: 1.08;
    overflow-wrap: anywhere;
    text-align: center;
    padding: 0;
    border: 0;
    background: transparent;
  }

  .card-menu {
    position: absolute;
    z-index: 5;
    top: 10px;
    right: 10px;
  }

  .card-menu summary,
  .card-actions button {
    display: grid;
    width: 32px;
    height: 32px;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--tile-muted);
    cursor: pointer;
    list-style: none;
  }

  .card-menu summary::-webkit-details-marker { display: none; }
  .card-menu summary:hover,
  .card-actions button:hover,
  .card-actions button.active {
    background: color-mix(in srgb, var(--tile-accent) 14%, transparent);
    color: var(--tile-accent);
  }

  .menu-panel {
    position: absolute;
    top: 36px;
    right: 0;
    width: max-content;
    min-width: 172px;
    padding: 5px;
    border: 1px solid var(--sol-border);
    border-radius: 10px;
    background: var(--sol-panel);
    color: var(--sol-text);
    box-shadow: 0 12px 28px rgb(0 0 0 / 24%);
  }

  .menu-panel button {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 8px;
    padding: 9px 10px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--sol-text);
    cursor: pointer;
    font-size: 12px;
  }

  .menu-panel button:hover { background: var(--sol-control-hover); }

  footer {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-top: 13px;
    border-top: 1px solid var(--tile-rule);
  }

  .author {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 6px;
  }

  .author-button {
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-align: left;
  }

  .author img,
  .avatar-fallback {
    width: 24px;
    height: 24px;
    flex: 0 0 auto;
    border: 1px solid var(--tile-rule);
    border-radius: 7px;
    object-fit: cover;
  }

  .avatar-fallback {
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--tile-accent) 16%, transparent);
    color: var(--tile-accent);
    font-size: 10px;
    font-weight: 700;
  }

  .author > span {
    display: flex;
    min-width: 0;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 1px 5px;
    line-height: 1.2;
  }

  .author strong { color: var(--tile-text); font-size: 11px; }
  .author small { color: var(--tile-muted); font-size: 9px; }

  .card-actions { display: flex; flex: 0 0 auto; gap: 2px; }
  .card-actions .play {
    background: color-mix(in srgb, var(--tile-accent) 14%, transparent);
    color: var(--tile-accent);
  }
  .card-actions .play.active { background: var(--tile-accent); color: var(--tile-bg); }
  .card-actions .play.error { color: var(--tile-muted); }

  .feed-sentinel {
    min-height: 1px;
    margin-top: 12px;
    color: var(--sol-muted);
    font-size: 12px;
    text-align: center;
  }

  .retry-page,
  .center-state button {
    display: inline-flex;
    min-height: 40px;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 0 17px;
    border: 1px solid var(--sol-border);
    border-radius: 999px;
    background: var(--sol-control-bg);
    color: var(--sol-text);
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
  }

  .retry-page { margin: 16px auto 0; }

  .center-state {
    display: grid;
    min-height: calc(100% - 64px);
    place-items: center;
    padding: 40px 24px 96px;
    text-align: center;
  }

  .center-state { align-content: center; gap: 10px; }
  .center-state h1 { margin: 0; font-size: clamp(22px, 4vw, 32px); font-weight: 560; letter-spacing: -0.025em; }
  .center-state p { margin: 0 0 12px; color: var(--sol-muted); font-size: 14px; }
  .feed-empty { min-height: 50vh; }

  .compose {
    position: fixed;
    z-index: 18;
    right: 50%;
    bottom: 24px;
    display: grid;
    width: 52px;
    height: 52px;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--sol-accent);
    color: var(--sol-button-fg);
    box-shadow: 0 12px 30px color-mix(in srgb, var(--sol-accent) 25%, transparent);
    cursor: pointer;
    transform: translateX(50%);
  }

  @media (max-width: 900px) {
    .affirmation-grid { columns: 2 260px; }
    .chat-view { grid-template-columns: 232px minmax(0, 1fr); gap: 28px; }
  }

  @media (min-width: 481px) {
    .tabs { transform: translateY(7px); }
  }

  @media (max-width: 600px) {
    .community-header,
    .feed,
    .member-view { width: calc(100% - 24px); }
    .tabs { width: 218px; }
    .affirmation-grid { columns: 1; }
    blockquote { font-size: clamp(25px, 8vw, 34px); }
    .chat-view {
      width: calc(100% - 24px);
      height: auto;
      grid-template-columns: 1fr;
      gap: 24px;
      padding-top: 36px;
    }
    .chat-channel-selector {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .chat-channel-label { grid-column: 1 / -1; }
    .chat-channel-selector button { min-height: 58px; grid-template-columns: 36px minmax(0, 1fr); gap: 9px; padding: 7px; }
    .chat-channel-avatar { width: 36px; height: 36px; }
    .chat-panel { height: max(400px, calc(100vh - 330px)); }
    .chat-thread-header { padding-top: 2px; }
    .chat-history { padding-block: 22px 24px; }
    .chat-history-gate { grid-template-columns: 24px minmax(0, 1fr); padding: 12px; }
    .chat-history-gate button { grid-column: 2; justify-self: start; }
    .member-view { padding-top: 34px; }
    .member-identity {
      grid-template-columns: 68px minmax(0, 1fr);
      gap: 16px;
      margin-bottom: 28px;
    }
    .member-avatar,
    .member-avatar img { width: 68px; height: 68px; border-radius: 19px; }
    .member-copy h1 { font-size: 26px; }
  }

  @media (max-width: 480px) {
    .community-header {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 7px 12px;
      padding: 3px 0 4px;
    }
    .brand { grid-column: 1; grid-row: 1; }
    .profile-menu,
    .profile-space { grid-column: 2; grid-row: 1; }
    .tabs { grid-column: 1 / -1; grid-row: 2; justify-self: center; }
    .community-header.profile-open {
      grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
      gap: 0;
    }
    .community-header.profile-open .profile-back { grid-column: 1; grid-row: 1; }
    .community-header.profile-open .profile-brand { grid-column: 2; grid-row: 1; }
    .community-header.profile-open .profile-space { grid-column: 3; grid-row: 1; }
  }
</style>
