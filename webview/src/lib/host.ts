import type { PlayerStateApi } from "./playerState";

export type BusyAction =
  | "auth"
  | "refresh"
  | "favorite"
  | "generate"
  | "regenerate"
  | "delete"
  | "checkout"
  | "confirmCheckout";
export type SyncStatus = "loading" | "refreshing" | "online" | "offline";
export type GlowEntitlement = "signed_out" | "free" | "premium" | "unavailable";

export type SolUser = {
  id: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
};

export type CustomAffirmation = {
  id: string;
  title: string;
  affirmation: string;
  offlineReady: boolean;
  durationMs: number | null;
  createdAt: string;
};

export type LibraryState = {
  user: SolUser | null;
  entitlement: GlowEntitlement;
  checkoutPending: boolean;
  favoriteIds: string[];
  customAffirmations: CustomAffirmation[];
  syncStatus: SyncStatus;
  lastSyncedAt: string | null;
  pendingChanges: number;
  busy: BusyAction | null;
  notice: string | null;
  error: string | null;
};

export type PairingViewState =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "complete" }
  | {
      status: "waiting_for_code";
      expiresAt: string;
      canReopenBrowser: true;
      message: string | null;
    }
  | {
      status: "redeeming" | "exchanging_tokens";
      expiresAt: string;
      canReopenBrowser: false;
    }
  | {
      status: "expired" | "locked" | "denied" | "failed";
      message: string;
      canStartAgain: true;
    };

export type WebviewToExtensionMessage =
  | { type: "ready"; restoredVolume?: number }
  | { type: "networkStatus"; online: boolean }
  | { type: "setVolume"; volume: number }
  | { type: "beginPairing" }
  | { type: "submitPairingCode"; code: string }
  | { type: "reopenPairingPage" }
  | { type: "acknowledgePairingComplete" }
  | { type: "cancelPairing" }
  | { type: "restartPairing" }
  | { type: "signOut" }
  | { type: "openDashboard" }
  | { type: "openCommunity" }
  | { type: "completeOnboarding" }
  | { type: "openPremium" }
  | { type: "confirmPremium" }
  | { type: "reopenPremium" }
  | { type: "refreshLibrary" }
  | { type: "toggleFavorite"; affirmationId: string; favorite: boolean }
  | {
      type: "generateCustom";
      requestId: string;
      title: string;
      affirmation: string;
    }
  | { type: "regenerateCustom"; requestId: string; affirmationId: string }
  | { type: "loadPendingCandidates" }
  | {
      type: "selectCandidate";
      candidateSetId: string;
      affirmationId: string;
      generationId: string;
    }
  | { type: "cancelCandidates"; candidateSetId: string }
  | { type: "prepareCustomAudio"; requestId: string; affirmationId: string }
  | { type: "deleteCustom"; affirmationId: string }
  | {
      type: "listeningStarted";
      affirmationId: string;
      occurredAt: string;
      timezoneOffsetMinutes: number;
    }
  | {
      type: "listeningCompleted";
      affirmationId: string;
      occurredAt: string;
      durationMs: number;
    }
  | {
      type: "listeningStopped";
      affirmationId: string;
      occurredAt: string;
    }
  | {
      type: "playerStatusChanged";
      isPlaying: boolean;
      affirmation: string;
    };

export type PlayerCommandMessage = {
  type: "playerCommand";
  command: "toggle" | "next";
};

export type DashboardAffirmation = {
  id: string;
  text: string;
  sessionCount: number;
  completedListens: number;
  listenedMs: number;
  lastListenedAt: string | null;
};

export type DashboardRecentSegment = {
  affirmationId: string;
  sessionId: string;
  completedListens: number;
  listenedMs: number;
  startedAt: string;
  endedAt: string;
};

export type DashboardSnapshot = {
  identity: {
    displayName: string;
    username: string | null;
    avatarUrl: string | null;
  };
  plan: "free" | "premium";
  stats: {
    affirmationsListened: number;
    completedListens: number;
    listenedMs: number;
    latestActivityAt: string | null;
  };
  streak: {
    currentDays: number;
    longestDays: number;
    practicedToday: boolean;
    lastPracticeDate: string | null;
  } | null;
  rhythm: number[];
  affirmations: DashboardAffirmation[];
  recentSegments: DashboardRecentSegment[];
  historyPeriodsAvailable: boolean;
  dataUnavailable: boolean;
  generatedAt: string;
};

export type DashboardToExtensionMessage =
  | { type: "dashboardReady" }
  | { type: "refreshDashboard" }
  | { type: "focusGlow" }
  | { type: "openDashboardOnWeb" }
  | { type: "openCommunity" }
  | { type: "openBilling" }
  | { type: "openPremium" };

export type DashboardViewState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "ready"; data: DashboardSnapshot }
  | { status: "error"; message: string };

export type ExtensionToDashboardMessage = {
  type: "dashboardState";
  state: DashboardViewState;
};

export type DashboardHostApi = {
  postMessage(message: DashboardToExtensionMessage): void;
};

export type CommunityAffirmationFeedItem = {
  id: string;
  createdAt: string;
  author: {
    userId: string;
    handle: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
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

export type CommunityFeedPage = {
  items: CommunityAffirmationFeedItem[];
  nextCursor: string | null;
};

export type CommunityMemberProfile = {
  userId: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  isOwner: boolean;
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
  author: {
    userId: string;
    handle: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
  replyTo: {
    id: string;
    body: string;
    author: { handle: string; displayName: string | null };
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

export type CommunitySnapshot = {
  identity: SolUser & { handle: string; canContribute: boolean };
  activeTab: "affirmations" | "chats";
  items: CommunityAffirmationFeedItem[];
  nextCursor: string | null;
  chat: {
    channels: CommunityChatChannel[];
    activeChannelSlug: CommunityChatChannelSlug | null;
    items: CommunityChatMessage[];
    nextCursor: string | null;
    historyLimited: boolean;
    unreadReplies: CommunityChatMessage[];
    unreadReplyTotal: number;
    error: string | null;
  };
};

export type CommunityViewState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "not_member" }
  | { status: "ready"; data: CommunitySnapshot }
  | { status: "error"; message: string };

export type CommunityToExtensionMessage =
  | { type: "communityReady" }
  | { type: "communityNetworkStatus"; online: boolean }
  | { type: "loadMoreCommunityAffirmations" }
  | { type: "openCommunityProfile"; handle: string }
  | { type: "closeCommunityProfile" }
  | { type: "loadMoreCommunityProfileAffirmations" }
  | { type: "setCommunitySurfaceTab"; activeTab: "affirmations" | "chats" }
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

export type ExtensionToCommunityMessage =
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
      result: { status: "deleted" | "already_deleted" } | null;
      message: string | null;
    }
  | {
      type: "communityChatDeleteManySettled";
      channelSlug: CommunityChatChannelSlug;
      results: Array<{
        messageId: string;
        result: { status: "deleted" | "already_deleted" } | null;
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
      result: { glowed: boolean; glowCount: number | null } | null;
      message: string | null;
    }
  | {
      type: "communityLibrarySettled";
      messageId: string;
      result: {
        status: "added" | "already_added" | "in_progress";
        affirmationId: string | null;
      } | null;
      message: string | null;
    };

export type CommunityHostApi = {
  postMessage(message: CommunityToExtensionMessage): void;
};

export type CustomAudioMessage =
  | {
      type: "customAudioData";
      requestId: string;
      affirmationId: string;
      mimeType: "audio/mpeg";
      data: ArrayBuffer;
    }
  | {
      type: "customAudioError";
      requestId: string;
      affirmationId: string;
      message: string;
    };

export type AudioCandidate = {
  id: string;
  index: 1 | 2;
  durationMs: number | null;
  mimeType: "audio/mpeg";
  data: ArrayBuffer;
};

export type AudioCandidateSet = {
  id: string;
  affirmationId: string;
  purpose: "create" | "regenerate";
  title: string;
  affirmation: string;
  expiresAt: string;
  candidates: AudioCandidate[];
};

export type CandidateSetMessage = {
  type: "candidateSet";
  candidateSet: AudioCandidateSet | null;
};

export type CandidateSelectionSettledMessage = {
  type: "candidateSelectionSettled";
  candidateSetId: string;
  affirmationId: string;
  succeeded: boolean;
};

export type ExtensionToWebviewMessage =
  | { type: "hostReady"; extensionName: string; onboardingCompleted: boolean }
  | { type: "volumePreference"; volume: number }
  | { type: "libraryState"; state: LibraryState }
  | { type: "pairingState"; state: PairingViewState }
  | CandidateSetMessage
  | CandidateSelectionSettledMessage
  | CustomAudioMessage
  | PlayerCommandMessage;

export type SolHostApi = PlayerStateApi & {
  postMessage(message: WebviewToExtensionMessage): void;
};

export const initialLibraryState: LibraryState = {
  user: null,
  entitlement: "signed_out",
  checkoutPending: false,
  favoriteIds: [],
  customAffirmations: [],
  syncStatus: "loading",
  lastSyncedAt: null,
  pendingChanges: 0,
  busy: "refresh",
  notice: null,
  error: null,
};
