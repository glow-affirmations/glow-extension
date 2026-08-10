import * as vscode from "vscode";
import { randomBytes, randomUUID } from "node:crypto";
import {
  createClient,
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import {
  listeningSessionCheckpointIsDue,
  nextListeningSessionSyncDelay,
  OfflineSyncStore,
  type ListeningSyncReference,
  type OfflineMutation,
  type OfflineListeningSegment,
  type OfflineListeningSession,
  type OfflineSyncSnapshot,
} from "./offlineSync.js";
import { createTimeoutFetch } from "./network.js";
import { exactArrayBuffer } from "./audioBytes.js";
import {
  feedbackAfterOfflineFailure,
  noticeAfterOnlineRefresh,
  noticeWhileRefreshing,
} from "./connectivityNotice.js";
import { tagUserAffirmation } from "./affirmationPrompt.js";
import { errorMessage, extractErrorMessage } from "./errorMessage.js";
import {
  ListeningSyncRequestError,
  listeningSyncFailureKind,
  listeningSyncRetryDelay,
} from "./listeningSyncRetry.js";
import {
  ExtensionPairingController,
  isRetryableOAuthSessionError,
  OAuthSessionManager,
  type OAuthIdentity,
  type PairingViewState,
} from "./oauthAuth.js";
import {
  entitlementAfterBackgroundCheck,
  isKnownGlowEntitlement,
  migrateCachedGlowEntitlement,
  premiumFeatureMessage,
  resolveGlowEntitlement,
  type GlowEntitlement,
  type KnownGlowEntitlement,
} from "./entitlement.js";
import {
  PREMIUM_CHECKOUT_POLL_INTERVAL_MS,
  PremiumCheckoutError,
  requestPremiumCheckout,
  SIGNED_OUT_PREMIUM_CHECKOUT_URL,
  shouldContinuePremiumCheckoutPolling,
} from "./premiumCheckout.js";
import { loadDashboardSnapshot, type DashboardSnapshot } from "./dashboard.js";
import {
  CommunityClient,
  parseCommunityChatReadCursorChange,
  parseCommunityChatRealtimeChange,
  type CommunityChatChannel,
  type CommunityChatReadCursorChange,
  type CommunityChatReadResult,
  type CommunityChatRealtimeChange,
  type CommunityChatChannelSlug,
  type CommunityChatPage,
  type CommunityChatPostResult,
  type CommunityChatReplyReadResult,
  type CommunityUnreadChatReplies,
  type CommunityDeleteResult,
  type CommunityFeedPage,
  type CommunityLibraryImportResult,
  type CommunityBlockResult,
  type CommunityJoinInput,
  type CommunityJoinResult,
  type CommunityMembership,
  type CommunityMemberProfile,
  type CommunityProfileUpdateInput,
  type CommunityReportReason,
  type CommunityReportResult,
  type CommunityReactionResult,
  type CommunityShareableAffirmation,
  type CommunityShareResult,
} from "./community.js";
import { GlowCommunityPanel } from "./communityPanel.js";

const SUPABASE_URL = "https://pkxugzwphkgpjjfjysyq.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_fkzGivujiKRL4khjMrFb7A_HhEvKqv8";
const DASHBOARD_URL = "https://justglow.dev/dashboard";
const BILLING_PORTAL_URL = "https://justglow.dev/billing/portal";
const PREMIUM_URL = "https://justglow.dev/#pricing";
const OFFLINE_LIBRARY_CACHE_KEY = "sol.offlineLibrary.v1";
const OFFLINE_AUDIO_DIRECTORY = "offline-audio";
const VOLUME_PREFERENCE_KEY = "sol.volume";
const ONBOARDING_COMPLETED_KEY = "glow.onboarding.v1.completed";
const FOCUS_SYNC_DEBOUNCE_MS = 350;
const MAX_LISTENING_SYNC_BATCHES = 10;
const MAX_CANDIDATE_AUDIO_BYTES = 10 * 1024 * 1024;
const PENDING_CANDIDATE_POLL_INTERVAL_MS = 2_000;
const PENDING_CANDIDATE_POLL_ATTEMPTS = 60;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type BusyAction =
  | "auth"
  | "refresh"
  | "favorite"
  | "generate"
  | "regenerate"
  | "delete"
  | "checkout"
  | "confirmCheckout";
type SyncStatus = "loading" | "refreshing" | "online" | "offline";

type SolUser = {
  id: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
};

type CustomAffirmation = {
  id: string;
  title: string;
  affirmation: string;
  offlineReady: boolean;
  durationMs: number | null;
  createdAt: string;
};

type LibraryState = {
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

type CachedCustomAffirmationV1 = {
  id: string;
  title: string;
  affirmation: string;
  durationMs: number | null;
  createdAt: string;
  storageBucket: string;
  storagePath: string;
  fileSizeBytes: number | null;
  audioCached: boolean;
};

type CachedLibraryV2 = {
  version: 2;
  user: SolUser;
  entitlement: KnownGlowEntitlement;
  favoriteIds: string[];
  customAffirmations: CachedCustomAffirmationV1[];
  syncedAt: string;
};

type LibraryData = Pick<
  LibraryState,
  "user" | "entitlement" | "favoriteIds" | "customAffirmations" | "lastSyncedAt"
>;

type LoadedLibrary = {
  state: LibraryData;
  cache: CachedLibraryV2 | null;
  cacheWarning: string | null;
  audioCacheRequests: AudioCacheRequest[];
};

type AudioCacheRequest = {
  userId: string;
  affirmationId: string;
  bucket: string;
  path: string;
  expectedSize: number | null;
};

type FlushResult = {
  completedOperationIds: Set<string>;
  permanentErrors: string[];
};

type RemoteAudioCandidate = {
  id: string;
  index: 1 | 2;
  durationMs: number | null;
  signedUrl: string;
};

type RemoteAudioCandidateSet = {
  id: string;
  affirmationId: string;
  purpose: "create" | "regenerate";
  title: string;
  affirmation: string;
  expiresAt: string;
  candidates: RemoteAudioCandidate[];
};

type WebviewAudioCandidateSet = Omit<RemoteAudioCandidateSet, "candidates"> & {
  candidates: Array<
    Omit<RemoteAudioCandidate, "signedUrl"> & {
      mimeType: "audio/mpeg";
      data: ArrayBuffer;
    }
  >;
};

type WebviewToExtensionMessage =
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

type ExtensionToWebviewMessage =
  | { type: "hostReady"; extensionName: string; onboardingCompleted: boolean }
  | { type: "volumePreference"; volume: number }
  | { type: "libraryState"; state: LibraryState }
  | { type: "pairingState"; state: PairingViewState }
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
    }
  | {
      type: "candidateSet";
      candidateSet: WebviewAudioCandidateSet | null;
    }
  | {
      type: "candidateSelectionSettled";
      candidateSetId: string;
      affirmationId: string;
      succeeded: boolean;
    }
  | { type: "playerCommand"; command: "toggle" | "next" };

type DashboardToExtensionMessage =
  | { type: "dashboardReady" }
  | { type: "refreshDashboard" }
  | { type: "focusGlow" }
  | { type: "openDashboardOnWeb" }
  | { type: "openCommunity" }
  | { type: "openBilling" }
  | { type: "openPremium" };

type DashboardViewState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "ready"; data: DashboardSnapshot }
  | { status: "error"; message: string };

type ExtensionToDashboardMessage = {
  type: "dashboardState";
  state: DashboardViewState;
};

export function activate(context: vscode.ExtensionContext): void {
  const extensionVersion =
    typeof context.extension.packageJSON.version === "string"
      ? context.extension.packageJSON.version
      : "0.0.0";
  const library = new SolLibraryService(context, extensionVersion);
  const community = new GlowCommunityPanel(
    context.extensionUri,
    context.globalState,
    {
      getUser: () => {
        const state = library.getState();
        return state.user
          ? { ...state.user, canContribute: state.entitlement === "premium" }
          : null;
      },
      isOnline: () => library.communityIsOnline(),
      onDidChangeUser: (listener) =>
        library.onDidChangeState((state) =>
          listener(
            state.user
              ? {
                  ...state.user,
                  canContribute: state.entitlement === "premium",
                }
              : null,
          ),
        ),
      membership: () => library.loadCommunityMembership(),
      join: (input) => library.joinCommunity(input),
      affirmations: (cursor) => library.loadCommunityAffirmations(cursor),
      profile: (handle) => library.loadCommunityProfile(handle),
      updateProfile: (input) => library.updateCommunityProfile(input),
      profileAffirmations: (handle, cursor) =>
        library.loadCommunityProfileAffirmations(handle, cursor),
      shareableAffirmations: () => library.loadShareableCommunityAffirmations(),
      shareAffirmation: (sourceAffirmationId, clientNonce) =>
        library.shareCommunityAffirmation(sourceAffirmationId, clientNonce),
      reportMessage: (messageId, reason, details) =>
        library.reportCommunityMessage(messageId, reason, details),
      setBlock: (userId, blocked) => library.setCommunityBlock(userId, blocked),
      chatChannels: () => library.loadCommunityChatChannels(),
      chatMessages: (channel, cursor) =>
        library.loadCommunityChatMessages(channel, cursor),
      unreadChatReplies: (channel) =>
        library.loadCommunityUnreadChatReplies(channel),
      markChatReplyRead: (channel, messageId) =>
        library.markCommunityChatReplyRead(channel, messageId),
      advanceChatReadCursor: (channel, messageId) =>
        library.advanceCommunityChatReadCursor(channel, messageId),
      subscribeToChatChannel: (channelId, listener, readCursorListener) =>
        library.subscribeToCommunityChat(
          channelId,
          listener,
          readCursorListener,
        ),
      postChatMessage: (channel, body, clientNonce, replyToMessageId) =>
        library.postCommunityChatMessage(
          channel,
          body,
          clientNonce,
          replyToMessageId,
        ),
      deleteMessage: (messageId) => library.deleteCommunityMessage(messageId),
      audio: (messageId) => library.loadCommunityAudio(messageId),
      setReaction: (messageId, active) =>
        library.setCommunityReaction(messageId, active),
      addToLibrary: (messageId) =>
        library.addCommunityAffirmationToLibrary(messageId),
      refreshLibrarySilently: () => library.refreshAfterCommunityImport(),
      openPremium: () => library.openPremiumCheckout(),
      signOut: () => library.signOut(),
      setNetworkAvailable: (available) =>
        library.setNetworkAvailable(available),
    },
  );
  const dashboard = new GlowDashboardPanel(
    context.extensionUri,
    library,
    community,
  );
  const provider = new SolSidebarProvider(
    context.extensionUri,
    context.globalStorageUri,
    context.globalState,
    library,
    dashboard,
  );

  context.subscriptions.push(
    provider,
    dashboard,
    community,
    library,
    vscode.window.registerWebviewViewProvider(
      SolSidebarProvider.viewType,
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      },
    ),
    vscode.window.onDidChangeWindowState((windowState) => {
      if (windowState.focused) library.requestFocusSync();
    }),
    vscode.commands.registerCommand("glow.focusSidebar", () => {
      void vscode.commands.executeCommand("workbench.view.extension.glow");
    }),
    vscode.commands.registerCommand("glow.openDashboard", () => {
      void dashboard.show();
    }),
    vscode.commands.registerCommand("glow.openCommunity", () => {
      void community.show();
    }),
    vscode.commands.registerCommand("glow.statusTogglePlayback", () => {
      void provider.sendPlayerCommand("toggle");
    }),
    vscode.commands.registerCommand("glow.statusNextAffirmation", () => {
      void provider.sendPlayerCommand("next");
    }),
  );
}

export function deactivate(): void {}

class SolLibraryService implements vscode.Disposable {
  private readonly client: SupabaseClient;
  private readonly communityClient: CommunityClient;
  private readonly oauthSessions: OAuthSessionManager;
  private readonly pairing: ExtensionPairingController;
  private readonly syncStore: OfflineSyncStore;
  private readonly sharedStateReady: Promise<void>;
  private readonly stateEmitter = new vscode.EventEmitter<LibraryState>();
  private state: LibraryState;
  private baseLibrary: CachedLibraryV2 | null;
  private baseState: LibraryData;
  private sharedRevision = -1;
  private syncPollTimer: ReturnType<typeof setInterval>;
  private pollingSharedState = false;
  private signingOut = false;
  private refreshPromise: Promise<void> | null = null;
  private backgroundRefreshPromise: Promise<void> | null = null;
  private refreshQueued = false;
  private queuedRefreshNotice: string | null = null;
  private queuedListeningRecovery = false;
  private focusSyncTimer: ReturnType<typeof setTimeout> | undefined;
  private networkAvailable = true;
  private communityLibraryRefreshQueued = false;
  private readonly audioCacheInFlight = new Set<string>();
  private readonly audioCacheRetryTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly audioCacheAttempts = new Map<string, number>();
  private readonly listeningContextId = randomUUID();
  private listeningSyncTimer: ReturnType<typeof setTimeout> | undefined;
  private listeningSyncPromise: Promise<void> | null = null;
  private listeningSyncRetryAttempt = 0;
  private listeningSyncRetryNotBefore = 0;
  private listeningSyncBlocked = false;
  private checkoutRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  private checkoutRefreshAttempts = 0;
  private checkoutEntitlementCheckPromise: Promise<boolean> | null = null;
  private pendingCheckout: { userId: string; url: string } | null = null;
  private disposed = false;

  readonly onDidChangeState = this.stateEmitter.event;
  readonly onDidChangePairingState: vscode.Event<PairingViewState>;

  constructor(
    private readonly context: vscode.ExtensionContext,
    extensionVersion: string,
  ) {
    this.syncStore = new OfflineSyncStore(context.globalStorageUri);
    const authFetch = globalThis.fetch.bind(globalThis);
    this.oauthSessions = new OAuthSessionManager(
      context.secrets,
      context.globalStorageUri,
      authFetch,
    );
    this.pairing = new ExtensionPairingController(
      extensionVersion,
      this.oauthSessions,
      authFetch,
    );
    this.communityClient = new CommunityClient(
      createTimeoutFetch(globalThis.fetch.bind(globalThis)),
      () => this.oauthSessions.getValidAccessToken(),
      () => this.oauthSessions.refreshAccessTokenAfterRejection(),
    );
    this.onDidChangePairingState = this.pairing.onDidChangeState;
    const cachedLibrary = parseCachedLibrary(
      context.globalState.get<unknown>(OFFLINE_LIBRARY_CACHE_KEY),
    );
    this.baseLibrary = cachedLibrary;
    this.state = cachedLibrary
      ? this.stateFromCache(cachedLibrary)
      : {
          user: null,
          entitlement: "signed_out",
          checkoutPending: false,
          favoriteIds: [],
          customAffirmations: [],
          syncStatus: "loading",
          lastSyncedAt: null,
          pendingChanges: 0,
          busy: null,
          notice: null,
          error: null,
        };
    this.baseState = libraryData(this.state);

    this.client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      accessToken: () => this.oauthSessions.getValidAccessToken(),
      global: {
        fetch: createTimeoutFetch(globalThis.fetch.bind(globalThis)),
      },
    });

    this.oauthSessions.onDidChangeSession(() => {
      if (this.signingOut || this.disposed) return;
      setTimeout(() => {
        void this.oauthSessions.hasSession().then((hasSession) => {
          if (hasSession) {
            void this.client.realtime.setAuth().catch(() => undefined);
          }
          const pairingStatus = this.pairing.getState().status;
          if (
            hasSession &&
            pairingStatus !== "idle" &&
            pairingStatus !== "exchanging_tokens" &&
            pairingStatus !== "complete"
          ) {
            void this.pairing.cancel(false);
          }
          if (!hasSession && this.state.user) {
            void this.syncStore
              .clearUser(this.state.user.id)
              .then((snapshot) =>
                this.applySharedSnapshot(snapshot, {
                  busy: null,
                  syncStatus: "online",
                  error: null,
                  notice: null,
                }),
              )
              .catch((error) => {
                this.updateState({
                  busy: null,
                  error: errorMessage(error),
                  notice: null,
                });
              });
          } else {
            void this.refresh(null, true);
          }
        });
      }, 0);
    });
    this.sharedStateReady = this.initializeSharedState(cachedLibrary);
    this.syncPollTimer = setInterval(() => void this.pollSharedState(), 1_500);
  }

  getState(): LibraryState {
    return this.state;
  }

  async loadDashboard(): Promise<DashboardSnapshot | null> {
    const state = this.state;
    if (!state.user) return null;

    return loadDashboardSnapshot(
      this.client,
      {
        id: state.user.id,
        displayName: state.user.displayName,
        username: state.user.username,
        avatarUrl: state.user.avatarUrl,
      },
      state.entitlement === "premium" ? "premium" : "free",
    );
  }

  communityIsOnline(): boolean {
    return this.networkAvailable && this.state.syncStatus !== "offline";
  }

  loadCommunityMembership(): Promise<CommunityMembership> {
    return this.communityClient.membership();
  }

  joinCommunity(input: CommunityJoinInput): Promise<CommunityJoinResult> {
    return this.communityClient.join(input);
  }

  loadCommunityAffirmations(
    cursor: string | null = null,
  ): Promise<CommunityFeedPage> {
    return this.communityClient.affirmations(cursor);
  }

  loadCommunityProfile(handle: string): Promise<CommunityMemberProfile> {
    return this.communityClient.profile(handle);
  }

  updateCommunityProfile(
    input: CommunityProfileUpdateInput,
  ): Promise<CommunityMemberProfile> {
    return this.communityClient.updateProfile(input);
  }

  loadShareableCommunityAffirmations(): Promise<
    CommunityShareableAffirmation[]
  > {
    return this.communityClient.shareableAffirmations();
  }

  shareCommunityAffirmation(
    sourceAffirmationId: string,
    clientNonce: string,
  ): Promise<CommunityShareResult> {
    return this.communityClient.shareAffirmation(
      sourceAffirmationId,
      clientNonce,
    );
  }

  reportCommunityMessage(
    messageId: string,
    reason: CommunityReportReason,
    details?: string,
  ): Promise<CommunityReportResult> {
    return this.communityClient.reportMessage(messageId, reason, details);
  }

  setCommunityBlock(
    userId: string,
    blocked: boolean,
  ): Promise<CommunityBlockResult> {
    return this.communityClient.setBlock(userId, blocked);
  }

  loadCommunityProfileAffirmations(
    handle: string,
    cursor: string | null = null,
  ): Promise<CommunityFeedPage> {
    return this.communityClient.profileAffirmations(handle, cursor);
  }

  loadCommunityChatChannels(): Promise<CommunityChatChannel[]> {
    return this.communityClient.chatChannels();
  }

  loadCommunityChatMessages(
    channel: CommunityChatChannelSlug,
    cursor: string | null = null,
  ): Promise<CommunityChatPage> {
    return this.communityClient.chatMessages(channel, cursor);
  }

  loadCommunityUnreadChatReplies(
    channel: CommunityChatChannelSlug,
  ): Promise<CommunityUnreadChatReplies> {
    return this.communityClient.unreadChatReplies(channel);
  }

  markCommunityChatReplyRead(
    channel: CommunityChatChannelSlug,
    messageId: string,
  ): Promise<CommunityChatReplyReadResult> {
    return this.communityClient.markChatReplyRead(channel, messageId);
  }

  advanceCommunityChatReadCursor(
    channel: CommunityChatChannelSlug,
    messageId: string,
  ): Promise<CommunityChatReadResult> {
    return this.communityClient.advanceChatReadCursor(channel, messageId);
  }

  async subscribeToCommunityChat(
    channelId: string,
    listener: (change: CommunityChatRealtimeChange) => void,
    readCursorListener: (change: CommunityChatReadCursorChange) => void,
  ): Promise<vscode.Disposable> {
    if (!/^[1-9]\d*$/u.test(channelId)) {
      throw new Error("The chat channel is invalid.");
    }

    await this.client.realtime.setAuth();
    const channel = this.client
      .channel(`community:chat:${channelId}:messages`, {
        config: { private: true },
      })
      .on("broadcast", { event: "message_changed" }, ({ payload }) => {
        const change = parseCommunityChatRealtimeChange(payload);
        if (change) listener(change);
      })
      .on("broadcast", { event: "read_cursor_changed" }, ({ payload }) => {
        const change = parseCommunityChatReadCursorChange(payload);
        if (change) readCursorListener(change);
      })
      .subscribe();
    let disposed = false;

    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        void this.client.removeChannel(channel);
      },
    };
  }

  postCommunityChatMessage(
    channel: CommunityChatChannelSlug,
    body: string,
    clientNonce: string,
    replyToMessageId: string | null = null,
  ): Promise<CommunityChatPostResult> {
    return this.communityClient.postChatMessage(
      channel,
      body,
      clientNonce,
      replyToMessageId,
    );
  }

  deleteCommunityMessage(messageId: string): Promise<CommunityDeleteResult> {
    return this.communityClient.deleteMessage(messageId);
  }

  loadCommunityAudio(
    messageId: string,
  ): Promise<{ mimeType: string; data: ArrayBuffer }> {
    return this.communityClient.audio(messageId);
  }

  setCommunityReaction(
    messageId: string,
    active: boolean,
  ): Promise<CommunityReactionResult> {
    return this.communityClient.setReaction(messageId, active);
  }

  addCommunityAffirmationToLibrary(
    messageId: string,
  ): Promise<CommunityLibraryImportResult> {
    return this.communityClient.addToLibrary(messageId);
  }

  async refreshAfterCommunityImport(): Promise<void> {
    if (!this.communityIsOnline()) return;
    if (this.state.busy !== null) {
      this.communityLibraryRefreshQueued = true;
      return;
    }
    this.communityLibraryRefreshQueued = false;
    if (this.backgroundRefreshPromise) await this.backgroundRefreshPromise;
    if (this.refreshPromise) await this.refreshPromise;
    if (this.state.busy !== null) {
      this.communityLibraryRefreshQueued = true;
      return;
    }
    await this.refreshInBackground(false);
  }

  reportError(message: string): void {
    this.updateState({ busy: null, error: message, notice: null });
  }

  getPairingState(): PairingViewState {
    return this.pairing.getState();
  }

  async beginPairing(): Promise<void> {
    await this.pairing.begin();
  }

  async submitPairingCode(code: string): Promise<void> {
    await this.pairing.submitCode(code);
  }

  async reopenPairingPage(): Promise<void> {
    await this.pairing.reopen();
  }

  acknowledgePairingComplete(): void {
    this.pairing.acknowledgeComplete();
  }

  async cancelPairing(): Promise<void> {
    await this.pairing.cancel();
  }

  async restartPairing(): Promise<void> {
    await this.pairing.restart();
  }

  async signOut(): Promise<void> {
    if (this.state.pendingChanges > 0) {
      const confirmation = await vscode.window.showWarningMessage(
        `Glow still has ${this.state.pendingChanges} ${this.state.pendingChanges === 1 ? "change" : "changes"} waiting to sync. Signing out will discard them.`,
        { modal: true },
        "Sign out and discard",
      );
      if (confirmation !== "Sign out and discard") return;
    }
    this.updateState({ busy: "auth", error: null, notice: null });
    const userId = this.state.user?.id ?? null;
    this.signingOut = true;
    this.cancelAudioCacheRetries();
    let signOutError: string | null = null;
    try {
      await this.pairing.cancel();
      await this.oauthSessions.clearSession();
      await this.clearOfflineLibrary(userId);
    } catch (error) {
      signOutError = errorMessage(error);
    } finally {
      this.signingOut = false;
    }
    this.clearPendingCheckoutTracking();
    this.state = {
      user: null,
      entitlement: "signed_out",
      checkoutPending: false,
      favoriteIds: [],
      customAffirmations: [],
      syncStatus: "online",
      lastSyncedAt: null,
      pendingChanges: 0,
      busy: null,
      notice: null,
      error: signOutError,
    };
    this.emitState();
  }

  async openPremiumCheckout(): Promise<void> {
    if (this.state.entitlement === "premium") {
      this.updateState({
        busy: null,
        error: null,
        notice: "Glow Premium is already active.",
      });
      return;
    }
    if (!this.requireConnection("open secure checkout")) return;

    if (!this.state.user) {
      this.updateState({ busy: "checkout", error: null, notice: null });
      try {
        const opened = await vscode.env.openExternal(
          vscode.Uri.parse(SIGNED_OUT_PREMIUM_CHECKOUT_URL),
        );
        if (!opened) {
          throw new PremiumCheckoutError(
            "service",
            "VS Code could not open secure checkout in your browser.",
          );
        }
        this.updateState({
          busy: null,
          error: null,
          notice: "Secure checkout opened in your browser.",
        });
      } catch (error) {
        this.updateState({
          busy: null,
          error:
            error instanceof Error
              ? error.message
              : "Secure checkout could not be opened.",
          notice: null,
        });
      }
      return;
    }

    const checkoutUserId = this.state.user.id;
    this.updateState({ busy: "checkout", error: null, notice: null });
    try {
      let accessToken = await this.oauthSessions.getValidAccessToken();
      if (!accessToken) {
        throw new PremiumCheckoutError(
          "authentication",
          "Sign in with GitHub to upgrade.",
        );
      }

      let checkoutUrl: string;
      try {
        checkoutUrl = await requestPremiumCheckout(
          createTimeoutFetch(globalThis.fetch.bind(globalThis)),
          accessToken,
        );
      } catch (error) {
        if (
          !(error instanceof PremiumCheckoutError) ||
          error.kind !== "authentication"
        ) {
          throw error;
        }
        accessToken =
          await this.oauthSessions.refreshAccessTokenAfterRejection();
        if (!accessToken) throw error;
        checkoutUrl = await requestPremiumCheckout(
          createTimeoutFetch(globalThis.fetch.bind(globalThis)),
          accessToken,
        );
      }

      const opened = await vscode.env.openExternal(
        vscode.Uri.parse(checkoutUrl),
      );
      if (!opened) {
        throw new PremiumCheckoutError(
          "service",
          "VS Code could not open secure checkout in your browser.",
        );
      }

      if (this.state.user?.id !== checkoutUserId) {
        throw new PremiumCheckoutError(
          "authentication",
          "Your Glow account changed while checkout was opening.",
        );
      }
      this.pendingCheckout = { userId: checkoutUserId, url: checkoutUrl };
      this.updateState({
        checkoutPending: true,
        busy: null,
        error: null,
        notice: "Secure checkout opened in your browser.",
      });
      this.beginCheckoutEntitlementRefresh();
    } catch (error) {
      if (
        error instanceof PremiumCheckoutError &&
        error.kind === "already_premium"
      ) {
        await this.refresh("Glow Premium is already active.", true);
        return;
      }
      this.updateState({
        busy: null,
        error:
          error instanceof Error
            ? error.message
            : "Secure checkout could not be opened.",
        notice: null,
      });
    }
  }

  async confirmPremiumCheckout(): Promise<void> {
    if (this.state.entitlement === "premium") {
      this.updateState({
        checkoutPending: false,
        busy: null,
        error: null,
        notice: "Glow Premium is already active.",
      });
      return;
    }
    if (!this.currentPendingCheckout()) {
      this.updateState({
        checkoutPending: false,
        busy: null,
        error: "Open secure checkout before confirming your payment.",
        notice: null,
      });
      return;
    }
    if (!this.requireConnection("confirm your payment")) return;

    this.updateState({
      busy: "confirmCheckout",
      error: null,
      notice: null,
    });
    try {
      const activated = await this.checkCheckoutEntitlement();
      if (activated) return;
      this.updateState({
        busy: null,
        error: null,
        notice:
          "Payment is still being confirmed. Glow will keep checking quietly.",
      });
    } catch {
      this.updateState({
        busy: null,
        error: null,
        notice:
          "Glow could not confirm the payment yet. It will keep checking quietly.",
      });
    }
    this.restartCheckoutEntitlementRefreshIfNeeded();
  }

  async reopenPremiumCheckout(): Promise<void> {
    const checkout = this.currentPendingCheckout();
    if (!checkout) {
      this.updateState({
        checkoutPending: false,
        busy: null,
        error:
          "That checkout is no longer available. Open a new one to continue.",
        notice: null,
      });
      return;
    }

    this.updateState({ busy: "checkout", error: null, notice: null });
    const opened = await vscode.env.openExternal(
      vscode.Uri.parse(checkout.url),
    );
    if (opened) this.restartCheckoutEntitlementRefreshIfNeeded();
    this.updateState(
      opened
        ? {
            busy: null,
            error: null,
            notice: "Secure checkout reopened in your browser.",
          }
        : {
            busy: null,
            error: "VS Code could not reopen secure checkout in your browser.",
            notice: null,
          },
    );
  }

  async refresh(
    notice: string | null = null,
    recoverListeningJournal = false,
  ): Promise<void> {
    if (recoverListeningJournal) this.resetListeningSyncRetry();
    if (this.backgroundRefreshPromise) await this.backgroundRefreshPromise;
    if (this.refreshPromise) {
      this.refreshQueued = true;
      if (notice) this.queuedRefreshNotice = notice;
      this.queuedListeningRecovery ||= recoverListeningJournal;
      await this.refreshPromise;
      return;
    }

    let nextNotice = notice;
    let nextListeningRecovery = recoverListeningJournal;
    do {
      this.refreshQueued = false;
      this.queuedListeningRecovery = false;
      const pendingRefresh = this.performRefresh(
        nextNotice,
        nextListeningRecovery,
      );
      this.refreshPromise = pendingRefresh;
      try {
        await pendingRefresh;
      } finally {
        if (this.refreshPromise === pendingRefresh) this.refreshPromise = null;
      }
      nextNotice = this.queuedRefreshNotice;
      this.queuedRefreshNotice = null;
      nextListeningRecovery = this.queuedListeningRecovery;
    } while (this.refreshQueued);
  }

  async refreshForStartup(): Promise<void> {
    if (!this.networkAvailable) return;
    if (this.baseLibrary && this.state.user) {
      await this.refreshInBackground(true);
      return;
    }
    await this.refresh(null, true);
  }

  requestFocusSync(): void {
    if (
      this.disposed ||
      this.signingOut ||
      !this.state.user ||
      !this.networkAvailable ||
      this.state.busy !== null ||
      this.state.syncStatus === "loading" ||
      this.state.syncStatus === "offline"
    ) {
      return;
    }
    if (this.focusSyncTimer) clearTimeout(this.focusSyncTimer);
    this.focusSyncTimer = setTimeout(() => {
      this.focusSyncTimer = undefined;
      if (!this.networkAvailable || this.state.syncStatus === "offline") return;
      void this.refreshInBackground(false);
    }, FOCUS_SYNC_DEBOUNCE_MS);
  }

  setNetworkAvailable(available: boolean): void {
    if (this.disposed || this.signingOut || this.networkAvailable === available)
      return;

    this.networkAvailable = available;
    if (!available) {
      if (this.focusSyncTimer !== undefined) {
        clearTimeout(this.focusSyncTimer);
        this.focusSyncTimer = undefined;
      }
      if (this.state.user) {
        this.updateState({
          busy: this.state.busy === "refresh" ? null : this.state.busy,
          syncStatus: "offline",
        });
      }
      return;
    }

    if (this.state.user) void this.refreshInBackground(true);
    else void this.refresh(null, true);
  }

  private async refreshInBackground(
    recoverListeningJournal: boolean,
  ): Promise<void> {
    if (
      this.disposed ||
      this.signingOut ||
      !this.networkAvailable ||
      this.refreshPromise ||
      this.backgroundRefreshPromise ||
      this.state.busy !== null
    ) {
      return;
    }
    if (recoverListeningJournal) this.resetListeningSyncRetry();
    const pendingRefresh = this.performRefresh(
      null,
      recoverListeningJournal,
      true,
    );
    this.backgroundRefreshPromise = pendingRefresh;
    try {
      await pendingRefresh;
    } finally {
      if (this.backgroundRefreshPromise === pendingRefresh) {
        this.backgroundRefreshPromise = null;
      }
    }
  }

  private async performRefresh(
    notice: string | null,
    requestedListeningRecovery: boolean,
    silent = false,
  ): Promise<void> {
    const previousSyncStatus = this.state.syncStatus;
    const reconnecting = previousSyncStatus === "offline";
    const recoverListeningJournal =
      requestedListeningRecovery ||
      reconnecting ||
      previousSyncStatus === "loading" ||
      previousSyncStatus === "refreshing";
    const currentNotice = this.state.notice;
    if (!silent) {
      this.updateState({
        busy: "refresh",
        syncStatus: "refreshing",
        error: null,
        notice: noticeWhileRefreshing(reconnecting, currentNotice, notice),
      });
    }
    try {
      await this.sharedStateReady;
      const authUser = await this.getAuthenticatedUserForSync();
      const result = await this.syncStore.withFlushLock(async () => {
        const beforeFlush = await this.syncStore.read();
        const listeningSyncAllowed =
          recoverListeningJournal ||
          (!this.listeningSyncBlocked &&
            Date.now() >= this.listeningSyncRetryNotBefore);
        const afterListeningFlush =
          authUser && listeningSyncAllowed
            ? await this.flushListeningStatsSafely(
                beforeFlush,
                authUser,
                recoverListeningJournal,
              )
            : beforeFlush;
        const flushResult = authUser
          ? await this.flushPendingMutations(afterListeningFlush, authUser)
          : { completedOperationIds: new Set<string>(), permanentErrors: [] };
        const loaded = await this.loadLibraryState(authUser);
        let cacheWarning = loaded.cacheWarning;
        let cacheSaved = loaded.cache === null;
        if (loaded.cache) {
          try {
            await this.saveOfflineLibrary(loaded.cache);
            cacheSaved = true;
          } catch (error) {
            cacheWarning = `Synced, but the offline copy could not be updated: ${errorMessage(error)}`;
          }
        }
        const snapshot = cacheSaved
          ? await this.syncStore.removeOperations(
              flushResult.completedOperationIds,
            )
          : await this.syncStore.read();
        return { loaded, flushResult, snapshot, cacheWarning };
      });

      if (result.loaded.state.entitlement === "premium") {
        this.clearPendingCheckoutTracking();
      }
      this.baseState = result.loaded.state;
      this.baseLibrary = result.loaded.cache;
      this.networkAvailable = true;
      this.applySharedSnapshot(result.snapshot, {
        checkoutPending: this.currentPendingCheckout() !== null,
        syncStatus: "online",
        busy: silent ? this.state.busy : null,
        notice: silent
          ? reconnecting
            ? null
            : this.state.notice
          : result.flushResult.permanentErrors.length > 0
            ? null
            : noticeAfterOnlineRefresh(
                reconnecting,
                result.cacheWarning ?? notice,
              ),
        error:
          result.flushResult.permanentErrors.length > 0
            ? result.flushResult.permanentErrors.join(" ")
            : silent
              ? reconnecting
                ? null
                : this.state.error
              : null,
      });
      this.scheduleAudioCaches(result.loaded.audioCacheRequests);
    } catch (error) {
      if (silent) {
        if (isRetryableRemoteError(error)) {
          this.networkAvailable = false;
          this.updateState({
            busy: this.state.busy === "refresh" ? null : this.state.busy,
            syncStatus: "offline",
          });
        }
        console.warn(`Glow background sync deferred: ${errorMessage(error)}`);
        return;
      }
      if (!isRetryableRemoteError(error)) {
        this.updateState({
          busy: null,
          syncStatus: "online",
          error: errorMessage(error),
          notice: null,
        });
        return;
      }

      this.updateState({
        busy: null,
        syncStatus: "offline",
        ...feedbackAfterOfflineFailure(
          reconnecting,
          currentNotice,
          this.state.user !== null,
        ),
      });
      this.networkAvailable = false;
    }
  }

  async toggleFavorite(
    affirmationId: string,
    favorite: boolean,
  ): Promise<void> {
    if (!isValidUuid(affirmationId)) {
      this.updateState({
        error: "That affirmation has an invalid id.",
        notice: null,
      });
      return;
    }
    const user = this.state.user;
    if (!user) {
      this.updateState({
        error: "Sign in with GitHub to save favorites.",
        notice: null,
      });
      return;
    }

    const previousFavoriteIds = this.state.favoriteIds;
    const favoriteIds = new Set(previousFavoriteIds);
    if (favorite) favoriteIds.add(affirmationId);
    else favoriteIds.delete(affirmationId);
    this.updateState({
      favoriteIds: [...favoriteIds],
      pendingChanges: this.state.pendingChanges + 1,
      error: null,
      notice:
        this.state.syncStatus === "offline"
          ? "Saved locally — waiting to sync."
          : null,
    });

    try {
      const snapshot = await this.syncStore.enqueueFavorite(
        user.id,
        affirmationId,
        favorite,
      );
      this.applySharedSnapshot(snapshot);
    } catch (error) {
      this.updateState({
        favoriteIds: previousFavoriteIds,
        pendingChanges: Math.max(0, this.state.pendingChanges - 1),
        error: `Could not save that change locally: ${errorMessage(error)}`,
        notice: null,
      });
      return;
    }

    if (this.state.syncStatus !== "offline") {
      void this.refresh();
    }
  }

  async generateCustom(
    requestId: string,
    title: string,
    affirmation: string,
  ): Promise<RemoteAudioCandidateSet | null> {
    if (!this.requireConnection("create an affirmation")) return null;
    if (!this.requirePremium()) return null;
    if (!isValidUuid(requestId)) {
      this.updateState({
        error: "The generation request id is invalid.",
        notice: null,
      });
      return null;
    }
    if (this.state.busy === "generate") return null;

    this.updateState({ busy: "generate", error: null, notice: null });
    if (!(await this.requireUser())) return null;

    const { data, error } = await this.client.functions.invoke(
      "generate-user-affirmation",
      {
        body: {
          action: "generate",
          workflowVersion: 2,
          requestId,
          title,
          affirmation: tagUserAffirmation(affirmation),
        },
        timeout: 120_000,
      },
    );
    if (error) {
      this.updateState({
        busy: null,
        error: await functionErrorMessage(error),
        notice: null,
      });
      return null;
    }

    const candidateSet = parseRemoteAudioCandidateSet(data);
    if (!candidateSet) {
      this.updateState({
        busy: null,
        error:
          "Glow created the audio, but the recordings could not be loaded.",
        notice: null,
      });
      return null;
    }
    this.updateState({ busy: null, error: null, notice: null });
    return candidateSet;
  }

  async regenerateCustom(
    requestId: string,
    affirmationId: string,
  ): Promise<RemoteAudioCandidateSet | null> {
    if (!this.requireConnection("regenerate an affirmation")) return null;
    if (!this.requirePremium()) return null;
    if (!isValidUuid(requestId) || !isValidUuid(affirmationId)) {
      this.updateState({
        error: "The regeneration request is invalid.",
        notice: null,
      });
      return null;
    }
    if (this.state.busy === "generate" || this.state.busy === "regenerate")
      return null;
    if (
      !this.state.customAffirmations.some(
        (affirmation) => affirmation.id === affirmationId,
      )
    ) {
      this.updateState({
        error: "That custom affirmation could not be found.",
        notice: null,
      });
      return null;
    }

    this.updateState({ busy: "regenerate", error: null, notice: null });
    const user = await this.requireUser();
    if (!user) return null;

    const { data, error } = await this.client.functions.invoke(
      "generate-user-affirmation",
      {
        body: {
          action: "regenerate",
          workflowVersion: 2,
          requestId,
          affirmationId,
        },
        timeout: 120_000,
      },
    );
    if (error) {
      this.updateState({
        busy: null,
        error: await functionErrorMessage(error),
        notice: null,
      });
      return null;
    }

    const candidateSet = parseRemoteAudioCandidateSet(data);
    if (!candidateSet) {
      this.updateState({
        busy: null,
        error:
          "Glow created the audio, but the recordings could not be loaded.",
        notice: null,
      });
      return null;
    }
    this.updateState({ busy: null, error: null, notice: null });
    return candidateSet;
  }

  async loadPendingCandidateSet(): Promise<RemoteAudioCandidateSet | null> {
    if (!this.state.user || this.state.syncStatus === "offline") return null;
    const userId = this.state.user.id;

    for (
      let attempt = 0;
      attempt < PENDING_CANDIDATE_POLL_ATTEMPTS;
      attempt += 1
    ) {
      if (
        this.disposed ||
        this.state.user?.id !== userId ||
        this.getState().syncStatus === "offline"
      ) {
        return null;
      }

      const { data, error } = await this.client.functions.invoke(
        "generate-user-affirmation",
        {
          body: { action: "pending" },
          timeout: 30_000,
        },
      );
      if (error) {
        this.updateState({
          error: await functionErrorMessage(error),
          notice: null,
        });
        return null;
      }

      const candidateSet = parseRemoteAudioCandidateSet(data);
      if (candidateSet) return candidateSet;
      if (!isRemoteCandidateSetGenerating(data)) return null;
      if (attempt + 1 < PENDING_CANDIDATE_POLL_ATTEMPTS) {
        await wait(PENDING_CANDIDATE_POLL_INTERVAL_MS);
      }
    }

    this.updateState({
      error: "Glow is still preparing your audio. Reopen Custom in a moment.",
      notice: null,
    });
    return null;
  }

  async selectCandidate(
    candidateSetId: string,
    affirmationId: string,
    generationId: string,
  ): Promise<boolean> {
    if (
      !isValidUuid(candidateSetId) ||
      !isValidUuid(affirmationId) ||
      !isValidUuid(generationId)
    ) {
      this.updateState({
        error: "That recording could not be selected.",
        notice: null,
      });
      return false;
    }
    const user = await this.requireUser();
    if (!user) return false;
    this.updateState({ busy: "generate", error: null, notice: null });
    const { error } = await this.client.functions.invoke(
      "generate-user-affirmation",
      {
        body: {
          action: "select",
          candidateSetId,
          generationId,
        },
        timeout: 30_000,
      },
    );
    if (error) {
      this.updateState({
        busy: null,
        error: await functionErrorMessage(error),
        notice: null,
      });
      return false;
    }

    await this.invalidateCustomAudioCache(user.id, affirmationId);
    await this.refresh(null, true);
    return true;
  }

  async cancelCandidateSet(candidateSetId: string): Promise<boolean> {
    if (!isValidUuid(candidateSetId)) return false;
    if (!(await this.requireUser())) return false;
    const { error } = await this.client.functions.invoke(
      "generate-user-affirmation",
      {
        body: { action: "cancel", candidateSetId },
        timeout: 30_000,
      },
    );
    if (error) {
      this.updateState({
        error: await functionErrorMessage(error),
        notice: null,
      });
      return false;
    }
    this.updateState({ busy: null, error: null, notice: null });
    return true;
  }

  async deleteCustom(affirmationId: string): Promise<void> {
    if (!isValidUuid(affirmationId)) {
      this.updateState({
        error: "That affirmation has an invalid id.",
        notice: null,
      });
      return;
    }
    const user = this.state.user;
    if (!user) {
      this.updateState({
        error: "Sign in with GitHub to delete an affirmation.",
        notice: null,
      });
      return;
    }

    const previousCustomAffirmations = this.state.customAffirmations;
    if (
      !previousCustomAffirmations.some(
        (affirmation) => affirmation.id === affirmationId,
      )
    )
      return;
    this.updateState({
      customAffirmations: previousCustomAffirmations.filter(
        (affirmation) => affirmation.id !== affirmationId,
      ),
      pendingChanges: this.state.pendingChanges + 1,
      error: null,
      notice:
        this.state.syncStatus === "offline"
          ? "Deleted locally — waiting to sync."
          : null,
    });

    try {
      const snapshot = await this.syncStore.enqueueDeleteCustom(
        user.id,
        affirmationId,
      );
      this.applySharedSnapshot(snapshot);
    } catch (error) {
      this.updateState({
        customAffirmations: previousCustomAffirmations,
        pendingChanges: Math.max(0, this.state.pendingChanges - 1),
        error: `Could not save that deletion locally: ${errorMessage(error)}`,
        notice: null,
      });
      return;
    }

    if (this.state.syncStatus === "offline") return;

    await this.refresh();
  }

  async recordListeningStarted(
    affirmationId: string,
    occurredAt: string,
    timezoneOffsetMinutes: number,
  ): Promise<void> {
    const user = this.state.user;
    if (
      !user ||
      !isValidUuid(affirmationId) ||
      !isValidClientTimestamp(occurredAt) ||
      !Number.isInteger(timezoneOffsetMinutes) ||
      timezoneOffsetMinutes < -840 ||
      timezoneOffsetMinutes > 840
    ) {
      return;
    }

    const snapshot = await this.syncStore.recordListeningStarted(
      user.id,
      this.listeningContextId,
      affirmationId,
      occurredAt,
      timezoneOffsetMinutes,
    );
    this.noteListeningSnapshot(snapshot);
  }

  async recordListeningCompleted(
    affirmationId: string,
    occurredAt: string,
    durationMs: number,
  ): Promise<void> {
    const user = this.state.user;
    if (
      !user ||
      !isValidUuid(affirmationId) ||
      !isValidClientTimestamp(occurredAt) ||
      !Number.isInteger(durationMs) ||
      durationMs <= 0 ||
      durationMs > 60 * 60 * 1000
    ) {
      return;
    }

    const snapshot = await this.syncStore.recordListeningCompleted(
      user.id,
      this.listeningContextId,
      affirmationId,
      occurredAt,
      durationMs,
    );
    this.noteListeningSnapshot(snapshot);
  }

  async recordListeningStopped(
    affirmationId: string,
    occurredAt: string,
  ): Promise<void> {
    const user = this.state.user;
    if (
      !user ||
      !isValidUuid(affirmationId) ||
      !isValidClientTimestamp(occurredAt)
    )
      return;

    const snapshot = await this.syncStore.recordListeningStopped(
      user.id,
      this.listeningContextId,
      affirmationId,
      occurredAt,
    );
    this.noteListeningSnapshot(snapshot);
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.syncPollTimer);
    if (this.checkoutRefreshTimer) clearTimeout(this.checkoutRefreshTimer);
    if (this.listeningSyncTimer !== undefined)
      clearTimeout(this.listeningSyncTimer);
    if (this.focusSyncTimer !== undefined) clearTimeout(this.focusSyncTimer);
    this.cancelAudioCacheRetries();
    this.pairing.dispose();
    this.oauthSessions.dispose();
    this.stateEmitter.dispose();
  }

  private async requireUser(): Promise<OAuthIdentity | null> {
    try {
      const user = await this.oauthSessions.getIdentity();
      if (user) return user;
      this.updateState({
        busy: null,
        error: "Sign in to Glow to use this feature.",
        notice: null,
      });
      return null;
    } catch (error) {
      this.updateState({
        busy: null,
        error: errorMessage(error),
        notice: null,
      });
      return null;
    }
  }

  private noteListeningSnapshot(snapshot: OfflineSyncSnapshot): void {
    this.sharedRevision = snapshot.revision;
    this.scheduleListeningSessionSync(snapshot);
  }

  private scheduleListeningSessionSync(snapshot: OfflineSyncSnapshot): void {
    if (this.listeningSyncTimer !== undefined) {
      clearTimeout(this.listeningSyncTimer);
      this.listeningSyncTimer = undefined;
    }
    if (
      this.disposed ||
      this.signingOut ||
      this.state.syncStatus === "offline" ||
      this.listeningSyncBlocked
    ) {
      return;
    }

    const userId = this.state.user?.id;
    if (!userId) return;
    const nowMs = Date.now();
    const checkpointDelayMs = nextListeningSessionSyncDelay(
      snapshot,
      userId,
      nowMs,
    );
    const retryDelayMs = Math.max(0, this.listeningSyncRetryNotBefore - nowMs);
    const delayMs =
      checkpointDelayMs === null
        ? null
        : Math.max(checkpointDelayMs, retryDelayMs);
    if (delayMs === null) return;

    this.listeningSyncTimer = setTimeout(() => {
      this.listeningSyncTimer = undefined;
      void this.syncListeningInBackground();
    }, delayMs);
  }

  private async syncListeningInBackground(): Promise<void> {
    if (this.listeningSyncPromise) {
      await this.listeningSyncPromise;
      return;
    }

    let attemptedSnapshot: OfflineSyncSnapshot | null = null;
    let synchronizedSnapshot: OfflineSyncSnapshot | null = null;
    const pendingSync = this.syncStore.withFlushLock(async () => {
      const user = await this.getAuthenticatedUserForSync();
      if (!user) return;
      const snapshot = await this.syncStore.read();
      attemptedSnapshot = snapshot;
      const result = await this.flushListeningStats(snapshot, user);
      this.sharedRevision = result.revision;
      synchronizedSnapshot = result;
    });
    this.listeningSyncPromise = pendingSync;
    try {
      await pendingSync;
      if (synchronizedSnapshot) this.resetListeningSyncRetry();
    } catch (error) {
      this.handleListeningSyncFailure(error, attemptedSnapshot);
    } finally {
      if (this.listeningSyncPromise === pendingSync)
        this.listeningSyncPromise = null;
      if (synchronizedSnapshot) {
        this.scheduleListeningSessionSync(synchronizedSnapshot);
      }
    }
  }

  private async flushListeningStats(
    initialSnapshot: OfflineSyncSnapshot,
    user: OAuthIdentity,
    force = false,
  ): Promise<OfflineSyncSnapshot> {
    let snapshot = initialSnapshot;

    for (let batch = 0; batch < MAX_LISTENING_SYNC_BATCHES; batch += 1) {
      const payload = listeningSyncPayload(
        snapshot,
        user.id,
        Date.now(),
        force,
      );
      if (payload.sessions.length === 0 && payload.segments.length === 0) {
        return this.syncStore.pruneFinalizedListening(user.id, Date.now());
      }

      await this.sendListeningBatch(payload.sessions, payload.segments);

      const sessionReferences: ListeningSyncReference[] = payload.sessions.map(
        (session) => ({
          id: session.id,
          revision: session.revision,
        }),
      );
      const segmentReferences: ListeningSyncReference[] = payload.segments.map(
        (segment) => ({
          id: segment.id,
          revision: segment.revision,
        }),
      );
      snapshot = await this.syncStore.acknowledgeListeningSync(
        sessionReferences,
        segmentReferences,
        new Date().toISOString(),
      );
    }

    return this.syncStore.pruneFinalizedListening(user.id, Date.now());
  }

  private async flushListeningStatsSafely(
    initialSnapshot: OfflineSyncSnapshot,
    user: OAuthIdentity,
    force = false,
  ): Promise<OfflineSyncSnapshot> {
    try {
      const synchronized = await this.flushListeningStats(
        initialSnapshot,
        user,
        force,
      );
      this.resetListeningSyncRetry();
      return synchronized;
    } catch (error) {
      this.handleListeningSyncFailure(error, initialSnapshot);
      return initialSnapshot;
    }
  }

  private async sendListeningBatch(
    sessions: OfflineListeningSession[],
    segments: OfflineListeningSegment[],
  ): Promise<void> {
    let refreshedAuthentication = false;
    while (true) {
      const { error, status } = await this.client.rpc("sync_user_listening", {
        requested_sessions: sessions.map(databaseListeningSession),
        requested_segments: segments.map(databaseListeningSegment),
      });
      if (!error) return;

      const requestError = new ListeningSyncRequestError(status, error);
      if (status === 401 && !refreshedAuthentication) {
        refreshedAuthentication = true;
        let accessToken: string | null;
        try {
          accessToken =
            await this.oauthSessions.refreshAccessTokenAfterRejection();
        } catch (refreshError) {
          if (isRetryableOAuthSessionError(refreshError)) {
            throw new ListeningSyncRequestError(0, refreshError);
          }
          throw requestError;
        }
        if (accessToken) continue;
      }
      throw requestError;
    }
  }

  private handleListeningSyncFailure(
    error: unknown,
    snapshot: OfflineSyncSnapshot | null,
  ): void {
    if (this.disposed || this.signingOut) return;
    const failureKind = isRetryableOAuthSessionError(error)
      ? "retryable"
      : listeningSyncFailureKind(error);
    if (failureKind === "retryable") {
      const retryDelayMs = listeningSyncRetryDelay(
        this.listeningSyncRetryAttempt,
      );
      this.listeningSyncRetryAttempt += 1;
      this.listeningSyncRetryNotBefore = Date.now() + retryDelayMs;
      this.listeningSyncBlocked = false;
      console.warn(
        `[Glow listening] Statistics sync will retry in ${Math.ceil(retryDelayMs / 1_000)} seconds.`,
        errorMessage(error),
      );
      if (snapshot) this.scheduleListeningSessionSync(snapshot);
      return;
    }

    this.listeningSyncBlocked = true;
    this.listeningSyncRetryNotBefore = 0;
    console.warn(
      failureKind === "authentication"
        ? "[Glow listening] Statistics sync paused after authentication was rejected twice."
        : "[Glow listening] Statistics sync paused after a non-retryable response.",
      errorMessage(error),
    );
  }

  private resetListeningSyncRetry(): void {
    if (this.listeningSyncTimer !== undefined) {
      clearTimeout(this.listeningSyncTimer);
      this.listeningSyncTimer = undefined;
    }
    this.listeningSyncRetryAttempt = 0;
    this.listeningSyncRetryNotBefore = 0;
    this.listeningSyncBlocked = false;
  }

  private async flushPendingMutations(
    snapshot: OfflineSyncSnapshot,
    user: OAuthIdentity,
  ): Promise<FlushResult> {
    const completedOperationIds = new Set<string>();
    const permanentErrors: string[] = [];
    const mutations = snapshot.mutations
      .filter((mutation) => mutation.userId === user.id)
      .sort((left, right) => left.sequence - right.sequence);

    for (const mutation of mutations) {
      if (!isValidUuid(mutation.affirmationId)) {
        completedOperationIds.add(mutation.operationId);
        permanentErrors.push(
          "A queued change had an invalid affirmation id and was discarded.",
        );
        continue;
      }

      if (mutation.type === "favorite") {
        const query = mutation.favorite
          ? this.client.from("user_affirmation_favorites").upsert(
              {
                user_id: user.id,
                affirmation_id: mutation.affirmationId,
              },
              {
                onConflict: "user_id,affirmation_id",
                ignoreDuplicates: true,
              },
            )
          : this.client
              .from("user_affirmation_favorites")
              .delete()
              .eq("user_id", user.id)
              .eq("affirmation_id", mutation.affirmationId);
        const { error } = await query;
        if (!error) {
          completedOperationIds.add(mutation.operationId);
          continue;
        }
        if (isRetryableRemoteError(error)) throw new Error(error.message);
        completedOperationIds.add(mutation.operationId);
        permanentErrors.push(
          `A favorite change was rejected: ${error.message}`,
        );
        continue;
      }

      const { error } = await this.client.functions.invoke(
        "generate-user-affirmation",
        {
          body: { action: "delete", affirmationId: mutation.affirmationId },
          timeout: 30_000,
        },
      );
      if (
        !error ||
        (error instanceof FunctionsHttpError && error.context.status === 404)
      ) {
        completedOperationIds.add(mutation.operationId);
        continue;
      }
      if (isRetryableRemoteError(error)) throw error;
      completedOperationIds.add(mutation.operationId);
      permanentErrors.push(
        `A deletion was rejected: ${await functionErrorMessage(error)}`,
      );
    }

    return { completedOperationIds, permanentErrors };
  }

  private async getAuthenticatedUserForSync(): Promise<OAuthIdentity | null> {
    const user = await this.oauthSessions.getIdentity();
    if (!user) {
      if (this.state.user) {
        throw new Error("The saved session could not be refreshed.");
      }
      return null;
    }
    return user;
  }

  private async loadLibraryState(
    authUser: OAuthIdentity | null,
  ): Promise<LoadedLibrary> {
    if (!authUser) {
      return {
        state: {
          user: null,
          entitlement: "signed_out",
          favoriteIds: [],
          customAffirmations: [],
          lastSyncedAt: null,
        },
        cache: null,
        cacheWarning: null,
        audioCacheRequests: [],
      };
    }

    const [profileResult, favoriteResult, affirmationResult, billingResult] =
      await Promise.all([
        this.client
          .from("profiles")
          .select("display_name,github_username,avatar_url")
          .eq("id", authUser.id)
          .maybeSingle(),
        this.client
          .from("user_affirmation_favorites")
          .select("affirmation_id")
          .eq("user_id", authUser.id)
          .order("created_at", { ascending: false }),
        this.client
          .from("affirmations")
          .select(
            "id,title,plain_text,active_audio_generation_id,created_at,active_generation:audio_generations!affirmations_active_audio_generation_id_fkey(id,status,storage_bucket,storage_path,duration_ms,file_size_bytes)",
          )
          .eq("user_id", authUser.id)
          .eq("is_user_generated", true)
          .not("active_audio_generation_id", "is", null)
          .order("created_at", { ascending: false }),
        this.client
          .from("user_billing_accounts")
          .select("is_entitled")
          .eq("user_id", authUser.id)
          .maybeSingle(),
      ]);
    if (profileResult.error) throw profileResult.error;
    if (favoriteResult.error) throw favoriteResult.error;
    if (affirmationResult.error) throw affirmationResult.error;

    const affirmations = affirmationResult.data ?? [];
    const customResults = (
      await Promise.all(
        affirmations.map(async (affirmation) => {
          const generation = Array.isArray(affirmation.active_generation)
            ? affirmation.active_generation[0]
            : affirmation.active_generation;
          if (!generation || generation.status !== "ready") return null;

          const fileSizeBytes = readNullableNumber(generation.file_size_bytes);
          const audioUri = this.offlineAudioUri(authUser.id, affirmation.id);
          const localAudioUri = (await isUsableAudioFile(
            audioUri,
            fileSizeBytes,
          ))
            ? audioUri
            : null;

          const cached: CachedCustomAffirmationV1 = {
            id: affirmation.id,
            title: affirmation.title,
            affirmation: affirmation.plain_text,
            durationMs: readNullableNumber(generation.duration_ms),
            createdAt: affirmation.created_at,
            storageBucket: generation.storage_bucket,
            storagePath: generation.storage_path,
            fileSizeBytes,
            audioCached: localAudioUri !== null,
          };
          const custom: CustomAffirmation = {
            id: cached.id,
            title: cached.title,
            affirmation: cached.affirmation,
            offlineReady: cached.audioCached,
            durationMs: cached.durationMs,
            createdAt: cached.createdAt,
          };
          const audioCacheRequest: AudioCacheRequest | null = localAudioUri
            ? null
            : {
                userId: authUser.id,
                affirmationId: affirmation.id,
                bucket: generation.storage_bucket,
                path: generation.storage_path,
                expectedSize: fileSizeBytes,
              };
          return { custom, cached, audioCacheRequest };
        }),
      )
    ).filter(
      (
        result,
      ): result is {
        custom: CustomAffirmation;
        cached: CachedCustomAffirmationV1;
        audioCacheRequest: AudioCacheRequest | null;
      } => result !== null,
    );

    const profile = profileResult.data;
    const username = profile?.github_username ?? null;
    const displayName = profile?.display_name ?? username ?? "Glow user";

    const user: SolUser = {
      id: authUser.id,
      displayName,
      username,
      avatarUrl: profile?.avatar_url ?? null,
    };
    const syncedAt = new Date().toISOString();
    const refreshedEntitlement = resolveGlowEntitlement(
      billingResult.data,
      billingResult.error !== null,
    );
    const cachedEntitlement =
      this.baseLibrary?.user.id === authUser.id
        ? this.baseLibrary.entitlement
        : null;
    const entitlement = entitlementAfterBackgroundCheck(
      refreshedEntitlement,
      cachedEntitlement,
    );
    return {
      state: {
        user,
        entitlement,
        favoriteIds: (favoriteResult.data ?? []).map(
          (favorite) => favorite.affirmation_id,
        ),
        customAffirmations: customResults.map((result) => result.custom),
        lastSyncedAt: syncedAt,
      },
      cache: {
        version: 2,
        user,
        entitlement,
        favoriteIds: (favoriteResult.data ?? []).map(
          (favorite) => favorite.affirmation_id,
        ),
        customAffirmations: customResults.map((result) => result.cached),
        syncedAt,
      },
      cacheWarning:
        billingResult.error === null
          ? null
          : "Glow is using your saved plan while account sync retries.",
      audioCacheRequests: customResults
        .map((result) => result.audioCacheRequest)
        .filter((request): request is AudioCacheRequest => request !== null),
    };
  }

  private scheduleAudioCaches(requests: AudioCacheRequest[]): void {
    for (const request of requests) this.startAudioCache(request);
  }

  private cancelAudioCacheRetries(): void {
    for (const timer of this.audioCacheRetryTimers.values())
      clearTimeout(timer);
    this.audioCacheRetryTimers.clear();
    this.audioCacheAttempts.clear();
  }

  private startAudioCache(request: AudioCacheRequest): void {
    if (this.disposed || this.state.user?.id !== request.userId) return;
    const key = audioCacheKey(request);
    if (this.audioCacheInFlight.has(key) || this.audioCacheRetryTimers.has(key))
      return;

    this.audioCacheInFlight.add(key);
    void this.ensureAudioCached(
      request.userId,
      request.affirmationId,
      request.bucket,
      request.path,
      request.expectedSize,
    )
      .then((audioUri) => {
        if (!audioUri) {
          this.scheduleAudioCacheRetry(request);
          return;
        }
        this.audioCacheAttempts.delete(key);
        if (!this.disposed && this.state.user?.id === request.userId)
          void this.refresh();
      })
      .catch(() => this.scheduleAudioCacheRetry(request))
      .finally(() => this.audioCacheInFlight.delete(key));
  }

  private scheduleAudioCacheRetry(request: AudioCacheRequest): void {
    if (this.disposed || this.state.user?.id !== request.userId) return;
    const key = audioCacheKey(request);
    if (this.audioCacheRetryTimers.has(key)) return;

    const attempt = (this.audioCacheAttempts.get(key) ?? 0) + 1;
    this.audioCacheAttempts.set(key, attempt);
    const delayMs = Math.min(5_000 * 2 ** Math.min(attempt - 1, 4), 60_000);
    const timer = setTimeout(() => {
      this.audioCacheRetryTimers.delete(key);
      this.startAudioCache(request);
    }, delayMs);
    this.audioCacheRetryTimers.set(key, timer);

    if (attempt === 3) {
      this.updateState({
        notice:
          "The affirmation is ready to stream, but its offline copy is still downloading.",
      });
    }
  }

  private stateFromCache(cache: CachedLibraryV2): LibraryState {
    return {
      user: cache.user,
      entitlement: cache.entitlement,
      checkoutPending: false,
      favoriteIds: cache.favoriteIds,
      customAffirmations: cache.customAffirmations.map((affirmation) => ({
        id: affirmation.id,
        title: affirmation.title,
        affirmation: affirmation.affirmation,
        offlineReady: affirmation.audioCached,
        durationMs: affirmation.durationMs,
        createdAt: affirmation.createdAt,
      })),
      syncStatus: "online",
      lastSyncedAt: cache.syncedAt,
      pendingChanges: 0,
      busy: null,
      notice: null,
      error: null,
    };
  }

  private async initializeSharedState(
    legacyCache: CachedLibraryV2 | null,
  ): Promise<void> {
    try {
      const snapshot = await this.syncStore.initializeLibrary(legacyCache);
      if (
        snapshot.libraryInitialized &&
        snapshot.library === null &&
        this.state.user
      ) {
        this.signingOut = true;
        try {
          await this.oauthSessions.clearSession();
        } finally {
          this.signingOut = false;
        }
      }
      this.applySharedSnapshot(snapshot);
    } catch (error) {
      this.updateState({
        error: `The shared offline queue could not be opened: ${errorMessage(error)}`,
        notice: null,
      });
    }
  }

  private async pollSharedState(): Promise<void> {
    if (this.pollingSharedState) return;
    this.pollingSharedState = true;
    try {
      await this.sharedStateReady;
      const snapshot = await this.syncStore.read();
      if (snapshot.revision === this.sharedRevision) return;
      const previousUserId = this.state.user?.id ?? null;
      const signedOutInAnotherWindow =
        snapshot.libraryInitialized &&
        snapshot.library === null &&
        this.state.user !== null;
      if (signedOutInAnotherWindow) {
        this.signingOut = true;
        try {
          await this.oauthSessions.clearSession();
        } finally {
          this.signingOut = false;
        }
      }
      this.applySharedSnapshot(snapshot);
      const userId = this.state.user?.id;
      if (
        userId &&
        this.networkAvailable &&
        (userId !== previousUserId ||
          snapshot.mutations.some((mutation) => mutation.userId === userId))
      ) {
        void this.refresh(null, userId !== previousUserId);
      }
    } catch {
      // A foreground action will surface persistent storage errors to the user.
    } finally {
      this.pollingSharedState = false;
    }
  }

  private applySharedSnapshot(
    snapshot: OfflineSyncSnapshot,
    patch: Partial<LibraryState> = {},
  ): void {
    this.sharedRevision = snapshot.revision;
    const sharedLibrary = parseCachedLibrary(snapshot.library);
    if (sharedLibrary) {
      const libraryChanged =
        this.baseLibrary?.user.id !== sharedLibrary.user.id ||
        this.baseLibrary.syncedAt !== sharedLibrary.syncedAt;
      this.baseLibrary = sharedLibrary;
      if (libraryChanged)
        this.baseState = libraryData(this.stateFromCache(sharedLibrary));
    } else if (snapshot.libraryInitialized && snapshot.library === null) {
      this.baseLibrary = null;
      this.baseState = {
        user: null,
        entitlement: "signed_out",
        favoriteIds: [],
        customAffirmations: [],
        lastSyncedAt: null,
      };
    }

    const favoriteIds = new Set(this.baseState.favoriteIds);
    let customAffirmations = this.baseState.customAffirmations;
    const userId = this.baseState.user?.id ?? null;
    if (this.pendingCheckout && this.pendingCheckout.userId !== userId) {
      this.clearPendingCheckoutTracking();
    }
    const mutations = snapshot.mutations
      .filter((mutation) => mutation.userId === userId)
      .sort((left, right) => left.sequence - right.sequence);
    for (const mutation of mutations) {
      if (mutation.type === "favorite") {
        if (mutation.favorite) favoriteIds.add(mutation.affirmationId);
        else favoriteIds.delete(mutation.affirmationId);
      } else {
        customAffirmations = customAffirmations.filter(
          (affirmation) => affirmation.id !== mutation.affirmationId,
        );
      }
    }

    this.state = {
      ...this.state,
      ...this.baseState,
      checkoutPending: this.pendingCheckout?.userId === userId,
      favoriteIds: [...favoriteIds],
      customAffirmations,
      pendingChanges: mutations.length,
      ...patch,
    };
    this.emitState();
    this.scheduleListeningSessionSync(snapshot);
  }

  private requireConnection(action: string): boolean {
    if (this.state.syncStatus === "online") return true;
    this.updateState({
      busy: null,
      error:
        this.state.syncStatus === "offline"
          ? `Connect to the internet to ${action}.`
          : `Wait for Glow to finish syncing before you ${action}.`,
      notice: null,
    });
    return false;
  }

  private currentPendingCheckout(): { userId: string; url: string } | null {
    return this.pendingCheckout?.userId === this.state.user?.id
      ? this.pendingCheckout
      : null;
  }

  private clearPendingCheckoutTracking(): void {
    if (this.checkoutRefreshTimer) clearTimeout(this.checkoutRefreshTimer);
    this.checkoutRefreshTimer = undefined;
    this.checkoutRefreshAttempts = 0;
    this.pendingCheckout = null;
  }

  private beginCheckoutEntitlementRefresh(): void {
    if (this.checkoutRefreshTimer) clearTimeout(this.checkoutRefreshTimer);
    this.checkoutRefreshTimer = undefined;
    this.checkoutRefreshAttempts = 0;
    this.scheduleCheckoutEntitlementRefresh();
  }

  private restartCheckoutEntitlementRefreshIfNeeded(): void {
    if (!this.currentPendingCheckout() || this.checkoutRefreshTimer) return;
    if (!shouldContinuePremiumCheckoutPolling(this.checkoutRefreshAttempts)) {
      this.checkoutRefreshAttempts = 0;
    }
    this.scheduleCheckoutEntitlementRefresh();
  }

  private scheduleCheckoutEntitlementRefresh(): void {
    if (
      this.checkoutRefreshTimer ||
      !this.currentPendingCheckout() ||
      !shouldContinuePremiumCheckoutPolling(this.checkoutRefreshAttempts)
    ) {
      return;
    }
    this.checkoutRefreshTimer = setTimeout(
      () => void this.refreshCheckoutEntitlement(),
      PREMIUM_CHECKOUT_POLL_INTERVAL_MS,
    );
  }

  private async refreshCheckoutEntitlement(): Promise<void> {
    this.checkoutRefreshTimer = undefined;
    if (
      this.disposed ||
      !this.state.user ||
      this.state.entitlement === "premium" ||
      !this.currentPendingCheckout()
    )
      return;

    this.checkoutRefreshAttempts += 1;
    try {
      if (await this.checkCheckoutEntitlement()) return;
    } catch {
      // Checkout confirmation is webhook-driven; transient reads retry quietly.
    }

    this.scheduleCheckoutEntitlementRefresh();
  }

  private async checkCheckoutEntitlement(): Promise<boolean> {
    if (this.checkoutEntitlementCheckPromise) {
      return this.checkoutEntitlementCheckPromise;
    }
    const userId = this.currentPendingCheckout()?.userId;
    if (!userId) return false;

    const pendingCheck = (async () => {
      const { data, error } = await this.client
        .from("user_billing_accounts")
        .select("is_entitled")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      if (data?.is_entitled !== true) return false;
      if (this.currentPendingCheckout()?.userId !== userId) return false;
      await this.refresh("Glow Premium is ready.", true);
      return this.state.entitlement === "premium";
    })();
    this.checkoutEntitlementCheckPromise = pendingCheck;
    try {
      return await pendingCheck;
    } finally {
      if (this.checkoutEntitlementCheckPromise === pendingCheck) {
        this.checkoutEntitlementCheckPromise = null;
      }
    }
  }

  private requirePremium(): boolean {
    if (this.state.entitlement === "premium") return true;
    this.updateState({
      busy: null,
      error: premiumFeatureMessage(this.state.entitlement),
      notice: null,
    });
    return false;
  }

  private async ensureAudioCached(
    userId: string,
    affirmationId: string,
    bucket: string,
    path: string,
    expectedSize: number | null,
  ): Promise<vscode.Uri | null> {
    const audioUri = this.offlineAudioUri(userId, affirmationId);
    if (await isUsableAudioFile(audioUri, expectedSize)) return audioUri;

    const parentUri = this.offlineAudioDirectory(userId);
    const temporaryUri = vscode.Uri.joinPath(
      parentUri,
      `${affirmationId}.${randomBytes(6).toString("hex")}.part`,
    );

    try {
      const { data, error } = await this.client.storage
        .from(bucket)
        .download(path);
      if (error) throw error;
      if (!data) throw new Error("Supabase returned an empty audio download.");

      const audioBytes = new Uint8Array(await data.arrayBuffer());
      if (audioBytes.byteLength === 0)
        throw new Error("The downloaded audio file was empty.");
      if (expectedSize !== null && audioBytes.byteLength !== expectedSize) {
        throw new Error(
          "The downloaded audio file did not match its expected size.",
        );
      }
      if (this.disposed || this.signingOut || this.state.user?.id !== userId)
        return null;

      await vscode.workspace.fs.createDirectory(parentUri);
      await vscode.workspace.fs.writeFile(temporaryUri, audioBytes);
      await vscode.workspace.fs.rename(temporaryUri, audioUri, {
        overwrite: true,
      });
      return audioUri;
    } catch {
      await deleteIfPresent(temporaryUri);
      return (await isUsableAudioFile(audioUri, expectedSize))
        ? audioUri
        : null;
    }
  }

  private async invalidateCustomAudioCache(
    userId: string,
    affirmationId: string,
  ): Promise<void> {
    const keyPrefix = `${userId}:${affirmationId}:`;
    for (const [key, timer] of this.audioCacheRetryTimers) {
      if (!key.startsWith(keyPrefix)) continue;
      clearTimeout(timer);
      this.audioCacheRetryTimers.delete(key);
      this.audioCacheAttempts.delete(key);
    }
    await deleteIfPresent(this.offlineAudioUri(userId, affirmationId));
  }

  private async saveOfflineLibrary(cache: CachedLibraryV2): Promise<void> {
    const previous = parseCachedLibrary(
      this.context.globalState.get<unknown>(OFFLINE_LIBRARY_CACHE_KEY),
    );
    await this.context.globalState.update(OFFLINE_LIBRARY_CACHE_KEY, cache);
    const sharedSnapshot = await this.syncStore.setLibrary(cache);
    this.sharedRevision = sharedSnapshot.revision;
    await this.cleanupStaleAudio(
      cache.user.id,
      new Set(
        cache.customAffirmations
          .filter((item) => item.audioCached)
          .map((item) => item.id),
      ),
    );

    if (previous && previous.user.id !== cache.user.id) {
      await this.deleteAudioDirectory(previous.user.id);
    }
  }

  private async clearOfflineLibrary(userId: string | null): Promise<void> {
    await this.context.globalState.update(OFFLINE_LIBRARY_CACHE_KEY, undefined);
    const sharedSnapshot = await this.syncStore.clearUser(userId);
    this.sharedRevision = sharedSnapshot.revision;
    this.baseLibrary = null;
    this.baseState = {
      user: null,
      entitlement: "signed_out",
      favoriteIds: [],
      customAffirmations: [],
      lastSyncedAt: null,
    };
    if (userId) await this.deleteAudioDirectory(userId);
  }

  private async cleanupStaleAudio(
    userId: string,
    retainedIds: Set<string>,
  ): Promise<void> {
    const directory = this.offlineAudioDirectory(userId);
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(directory);
    } catch (error) {
      if (isFileNotFound(error)) return;
      throw error;
    }

    await Promise.all(
      entries.map(async ([name, type]) => {
        const retained =
          type === vscode.FileType.File &&
          name.endsWith(".mp3") &&
          retainedIds.has(name.slice(0, -4));
        if (!retained)
          await deleteIfPresent(vscode.Uri.joinPath(directory, name));
      }),
    );
  }

  private async deleteAudioDirectory(userId: string): Promise<void> {
    if (!isValidUuid(userId)) return;
    await deleteIfPresent(this.offlineAudioDirectory(userId), true);
  }

  private offlineAudioDirectory(userId: string): vscode.Uri {
    return vscode.Uri.joinPath(
      this.context.globalStorageUri,
      OFFLINE_AUDIO_DIRECTORY,
      userId,
    );
  }

  private offlineAudioUri(userId: string, affirmationId: string): vscode.Uri {
    return vscode.Uri.joinPath(
      this.offlineAudioDirectory(userId),
      `${affirmationId}.mp3`,
    );
  }

  private updateState(patch: Partial<LibraryState>): void {
    this.state = { ...this.state, ...patch };
    this.emitState();
  }

  private emitState(): void {
    this.stateEmitter.fire(this.state);
    if (
      this.communityLibraryRefreshQueued &&
      this.state.busy === null &&
      this.communityIsOnline() &&
      !this.disposed &&
      !this.signingOut
    ) {
      this.communityLibraryRefreshQueued = false;
      queueMicrotask(() => void this.refreshAfterCommunityImport());
    }
  }
}

class GlowDashboardPanel implements vscode.Disposable {
  static readonly viewType = "glow.dashboard";
  private panel: vscode.WebviewPanel | undefined;
  private loadSequence = 0;
  private lastUserId: string | null = null;
  private readonly stateSubscription: vscode.Disposable;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly library: SolLibraryService,
    private readonly community: GlowCommunityPanel,
  ) {
    this.stateSubscription = this.library.onDidChangeState((state) => {
      if (!this.panel) return;
      const userId = state.user?.id ?? null;
      if (userId === this.lastUserId) return;
      this.lastUserId = userId;
      void this.loadDashboard(false);
    });
  }

  dispose(): void {
    this.loadSequence += 1;
    this.stateSubscription.dispose();
    this.panel?.dispose();
    this.panel = undefined;
  }

  async show(): Promise<void> {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      await this.loadDashboard(false);
      return;
    }

    const webviewRoot = vscode.Uri.joinPath(
      this.extensionUri,
      "dist",
      "webview",
    );
    const panel = vscode.window.createWebviewPanel(
      GlowDashboardPanel.viewType,
      "Dashboard",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
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
    this.lastUserId = this.library.getState().user?.id ?? null;

    panel.onDidDispose(() => {
      if (this.panel !== panel) return;
      this.loadSequence += 1;
      this.panel = undefined;
    });
    panel.webview.onDidReceiveMessage(
      (message: DashboardToExtensionMessage) => {
        void this.handleMessage(message).catch((error) => {
          console.warn(
            "[Glow dashboard] Could not process a dashboard action.",
            errorMessage(error),
          );
        });
      },
    );
    panel.webview.html = await this.getHtml(panel.webview, webviewRoot);
  }

  private async handleMessage(
    message: DashboardToExtensionMessage,
  ): Promise<void> {
    switch (message.type) {
      case "dashboardReady":
        await this.loadDashboard(true);
        return;
      case "refreshDashboard":
        await this.loadDashboard(false);
        return;
      case "focusGlow":
        await vscode.commands.executeCommand("workbench.view.extension.glow");
        return;
      case "openDashboardOnWeb":
        await vscode.env.openExternal(vscode.Uri.parse(DASHBOARD_URL));
        return;
      case "openCommunity":
        await this.community.show();
        return;
      case "openBilling":
        await vscode.env.openExternal(vscode.Uri.parse(BILLING_PORTAL_URL));
        return;
      case "openPremium":
        await vscode.env.openExternal(vscode.Uri.parse(PREMIUM_URL));
        return;
    }
  }

  private async loadDashboard(showLoading: boolean): Promise<void> {
    const panel = this.panel;
    if (!panel) return;
    const sequence = ++this.loadSequence;
    if (showLoading) {
      await this.postMessage(panel, { status: "loading" });
    }

    if (!this.library.getState().user) {
      await this.postMessage(panel, { status: "signed_out" });
      return;
    }

    try {
      const data = await this.library.loadDashboard();
      if (this.panel !== panel || sequence !== this.loadSequence) return;
      await this.postMessage(
        panel,
        data ? { status: "ready", data } : { status: "signed_out" },
      );
    } catch (error) {
      if (this.panel !== panel || sequence !== this.loadSequence) return;
      console.warn(
        "[Glow dashboard] Listening progress could not be loaded.",
        errorMessage(error),
      );
      await this.postMessage(panel, {
        status: "error",
        message:
          "Glow could not load your listening progress. Check your connection and try again.",
      });
    }
  }

  private async postMessage(
    panel: vscode.WebviewPanel,
    state: DashboardViewState,
  ): Promise<void> {
    if (this.panel !== panel) return;
    const message: ExtensionToDashboardMessage = {
      type: "dashboardState",
      state,
    };
    await panel.webview.postMessage(message);
  }

  private async getHtml(
    webview: vscode.Webview,
    webviewRoot: vscode.Uri,
  ): Promise<string> {
    const indexUri = vscode.Uri.joinPath(webviewRoot, "index.html");

    try {
      const bytes = await vscode.workspace.fs.readFile(indexUri);
      const assetRoot = webview.asWebviewUri(webviewRoot).toString(true);
      const baseUri = `${assetRoot}/`;
      const nonce = randomBytes(16).toString("base64");
      const dashboardMode = `<script nonce="${nonce}">document.documentElement.dataset.glowView = "dashboard";</script>`;

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
        .replace("<head>", `<head><base href="${baseUri}">${dashboardMode}`);
    } catch (error) {
      const message = escapeHtml(errorMessage(error));
      return `<!doctype html>
        <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline';">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Dashboard</title>
          </head>
          <body style="padding: 24px; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family);">
            <h2>Dashboard unavailable</h2>
            <p>${message}</p>
          </body>
        </html>`;
    }
  }
}

class SolSidebarProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  static readonly viewType = "glow.sidebarView";
  private webview: vscode.Webview | undefined;
  private messageQueue: Promise<void> = Promise.resolve();
  private stateMessageQueue: Promise<void> = Promise.resolve();
  private onboardingCompletionPromise: Thenable<void> | null = null;
  private readonly playbackStatusItem: vscode.StatusBarItem;
  private readonly nextStatusItem: vscode.StatusBarItem;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly globalStorageUri: vscode.Uri,
    private readonly globalState: vscode.Memento,
    private readonly library: SolLibraryService,
    private readonly dashboard: GlowDashboardPanel,
  ) {
    this.playbackStatusItem = vscode.window.createStatusBarItem(
      "glow.playback",
      vscode.StatusBarAlignment.Right,
      10_001,
    );
    this.playbackStatusItem.name = "Glow Playback";
    this.playbackStatusItem.command = "glow.statusTogglePlayback";

    this.nextStatusItem = vscode.window.createStatusBarItem(
      "glow.nextAffirmation",
      vscode.StatusBarAlignment.Right,
      10_000,
    );
    this.nextStatusItem.name = "Glow Next Affirmation";
    this.nextStatusItem.command = "glow.statusNextAffirmation";
    this.nextStatusItem.text = "$(chevron-right)";
    this.nextStatusItem.tooltip = "Next";
    this.nextStatusItem.accessibilityInformation = {
      label: "Next",
      role: "button",
    };

    this.library.onDidChangeState((state) => {
      if (state.user) void this.markOnboardingCompleted();
      if (this.webview) void this.queueLibraryState(this.webview, state);
    });
    this.library.onDidChangePairingState((state) => {
      if (this.webview) {
        void this.postMessage(this.webview, { type: "pairingState", state });
      }
    });
  }

  dispose(): void {
    this.playbackStatusItem.dispose();
    this.nextStatusItem.dispose();
  }

  async sendPlayerCommand(command: "toggle" | "next"): Promise<void> {
    if (!this.webview) {
      await vscode.commands.executeCommand("workbench.view.extension.glow");
      return;
    }

    const delivered = await this.webview.postMessage({
      type: "playerCommand",
      command,
    });
    if (!delivered) {
      await vscode.commands.executeCommand("workbench.view.extension.glow");
    }
  }

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    const webview = webviewView.webview;
    this.webview = webview;
    const webviewRoot = vscode.Uri.joinPath(
      this.extensionUri,
      "dist",
      "webview",
    );

    webview.options = {
      enableScripts: true,
      localResourceRoots: [webviewRoot],
    };

    webview.html = await this.getHtml(webview, webviewRoot);
    webviewView.onDidDispose(() => {
      if (this.webview === webview) {
        this.webview = undefined;
        this.hideStatusControls();
      }
    });
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) this.library.requestFocusSync();
    });

    webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
      const handle = () => this.handleMessage(webview, message);
      if (
        message.type === "toggleFavorite" ||
        message.type === "deleteCustom" ||
        message.type === "setVolume" ||
        message.type === "listeningStarted" ||
        message.type === "listeningCompleted" ||
        message.type === "listeningStopped"
      ) {
        this.messageQueue = this.messageQueue.then(handle).catch((error) => {
          this.library.reportError(
            `Glow could not save that change: ${errorMessage(error)}`,
          );
        });
      } else {
        void handle().catch((error) => {
          this.library.reportError(
            `Glow could not process that action: ${errorMessage(error)}`,
          );
        });
      }
    });
  }

  private async handleMessage(
    webview: vscode.Webview,
    message: WebviewToExtensionMessage,
  ): Promise<void> {
    switch (message.type) {
      case "networkStatus":
        this.library.setNetworkAvailable(message.online);
        return;
      case "ready":
        await this.sendVolumePreference(webview, message.restoredVolume);
        if (this.library.getState().user) {
          await this.markOnboardingCompleted();
        }
        await this.postMessage(webview, {
          type: "hostReady",
          extensionName: "Glow",
          onboardingCompleted: this.globalState.get<boolean>(
            ONBOARDING_COMPLETED_KEY,
            false,
          ),
        });
        await this.queueLibraryState(webview, this.library.getState());
        await this.postMessage(webview, {
          type: "pairingState",
          state: this.library.getPairingState(),
        });
        void this.library.refreshForStartup();
        return;
      case "setVolume": {
        const volume = normalizeVolume(message.volume);
        if (volume !== null)
          await this.globalState.update(VOLUME_PREFERENCE_KEY, volume);
        return;
      }
      case "beginPairing":
        await this.library.beginPairing();
        return;
      case "submitPairingCode":
        await this.library.submitPairingCode(message.code);
        return;
      case "reopenPairingPage":
        await this.library.reopenPairingPage();
        return;
      case "acknowledgePairingComplete":
        this.library.acknowledgePairingComplete();
        return;
      case "cancelPairing":
        await this.library.cancelPairing();
        return;
      case "restartPairing":
        await this.library.restartPairing();
        return;
      case "signOut":
        await this.library.signOut();
        return;
      case "openDashboard":
        await this.dashboard.show();
        return;
      case "openCommunity":
        await vscode.commands.executeCommand("glow.openCommunity");
        return;
      case "completeOnboarding":
        await this.markOnboardingCompleted();
        return;
      case "openPremium":
        await this.library.openPremiumCheckout();
        return;
      case "confirmPremium":
        await this.library.confirmPremiumCheckout();
        return;
      case "reopenPremium":
        await this.library.reopenPremiumCheckout();
        return;
      case "refreshLibrary":
        await this.library.refresh(null, true);
        return;
      case "toggleFavorite":
        await this.library.toggleFavorite(
          message.affirmationId,
          message.favorite,
        );
        return;
      case "generateCustom":
        await this.postCandidateSet(
          webview,
          await this.library.generateCustom(
            message.requestId,
            message.title,
            message.affirmation,
          ),
        );
        await this.queueLibraryState(webview, this.library.getState());
        return;
      case "regenerateCustom":
        await this.postCandidateSet(
          webview,
          await this.library.regenerateCustom(
            message.requestId,
            message.affirmationId,
          ),
        );
        await this.queueLibraryState(webview, this.library.getState());
        return;
      case "loadPendingCandidates":
        await this.postCandidateSet(
          webview,
          await this.library.loadPendingCandidateSet(),
        );
        return;
      case "selectCandidate": {
        const succeeded = await this.library.selectCandidate(
          message.candidateSetId,
          message.affirmationId,
          message.generationId,
        );
        await this.queueLibraryState(webview, this.library.getState());
        await this.postMessage(webview, {
          type: "candidateSelectionSettled",
          candidateSetId: message.candidateSetId,
          affirmationId: message.affirmationId,
          succeeded,
        });
        return;
      }
      case "cancelCandidates":
        if (await this.library.cancelCandidateSet(message.candidateSetId)) {
          await this.postMessage(webview, {
            type: "candidateSet",
            candidateSet: null,
          });
        }
        await this.queueLibraryState(webview, this.library.getState());
        return;
      case "prepareCustomAudio":
        await this.postCustomAudio(
          webview,
          message.requestId,
          message.affirmationId,
        );
        return;
      case "deleteCustom":
        await this.library.deleteCustom(message.affirmationId);
        return;
      case "listeningStarted":
        await this.library.recordListeningStarted(
          message.affirmationId,
          message.occurredAt,
          message.timezoneOffsetMinutes,
        );
        return;
      case "listeningCompleted":
        await this.library.recordListeningCompleted(
          message.affirmationId,
          message.occurredAt,
          message.durationMs,
        );
        return;
      case "listeningStopped":
        await this.library.recordListeningStopped(
          message.affirmationId,
          message.occurredAt,
        );
        return;
      case "playerStatusChanged":
        this.updateStatusControls(message.isPlaying, message.affirmation);
        return;
    }
  }

  private async markOnboardingCompleted(): Promise<void> {
    if (this.globalState.get<boolean>(ONBOARDING_COMPLETED_KEY, false)) return;
    if (this.onboardingCompletionPromise) {
      await this.onboardingCompletionPromise;
      return;
    }

    const pending = this.globalState.update(ONBOARDING_COMPLETED_KEY, true);
    this.onboardingCompletionPromise = pending;
    try {
      await pending;
    } finally {
      if (this.onboardingCompletionPromise === pending) {
        this.onboardingCompletionPromise = null;
      }
    }
  }

  private updateStatusControls(isPlaying: boolean, affirmation: string): void {
    const label = affirmation.trim() || "Selected affirmation";
    const action = isPlaying ? "Stop" : "Play";
    this.playbackStatusItem.text = isPlaying
      ? "$(primitive-square)"
      : "$(play)";
    this.playbackStatusItem.tooltip = isPlaying
      ? `Glow · ${label}`
      : `Play: ${label}`;
    this.playbackStatusItem.accessibilityInformation = {
      label: `Glow: ${action} ${label}`,
      role: "button",
    };
    this.nextStatusItem.tooltip = "Next";
    this.nextStatusItem.accessibilityInformation = {
      label: "Next",
      role: "button",
    };
    this.playbackStatusItem.show();
    this.nextStatusItem.show();
  }

  private hideStatusControls(): void {
    this.playbackStatusItem.hide();
    this.nextStatusItem.hide();
  }

  private async getHtml(
    webview: vscode.Webview,
    webviewRoot: vscode.Uri,
  ): Promise<string> {
    const indexUri = vscode.Uri.joinPath(webviewRoot, "index.html");

    try {
      const bytes = await vscode.workspace.fs.readFile(indexUri);
      const assetRoot = webview.asWebviewUri(webviewRoot).toString(true);
      const baseUri = `${assetRoot}/`;
      const nonce = randomBytes(16).toString("base64");

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
        .replace("<head>", `<head><base href="${baseUri}">`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.getBuildErrorHtml(webview, message);
    }
  }

  private async sendVolumePreference(
    webview: vscode.Webview,
    restoredVolume: number | undefined,
  ): Promise<void> {
    const savedVolume = normalizeVolume(
      this.globalState.get<unknown>(VOLUME_PREFERENCE_KEY),
    );
    const migratedVolume = normalizeVolume(restoredVolume);
    const volume = savedVolume ?? migratedVolume ?? 0.5;

    if (savedVolume === null) {
      await this.globalState.update(VOLUME_PREFERENCE_KEY, volume);
    }
    await this.postMessage(webview, { type: "volumePreference", volume });
  }

  private async postMessage(
    webview: vscode.Webview,
    message: ExtensionToWebviewMessage,
  ): Promise<void> {
    const delivered = await webview.postMessage(message);
    if (!delivered && this.webview === webview) {
      console.warn(
        `[Glow webview] The ${message.type} message was not delivered.`,
      );
    }
  }

  private queueLibraryState(
    webview: vscode.Webview,
    state: LibraryState,
  ): Promise<void> {
    const queued = this.stateMessageQueue.then(async () => {
      if (this.webview !== webview) return;
      await this.postMessage(webview, { type: "libraryState", state });
    });
    this.stateMessageQueue = queued.catch(() => undefined);
    return queued;
  }

  private async postCandidateSet(
    webview: vscode.Webview,
    candidateSet: RemoteAudioCandidateSet | null,
  ): Promise<void> {
    if (!candidateSet) {
      await this.postMessage(webview, {
        type: "candidateSet",
        candidateSet: null,
      });
      return;
    }

    try {
      const candidates = await Promise.all(
        candidateSet.candidates.map(async (candidate) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 30_000);
          try {
            const response = await fetch(candidate.signedUrl, {
              signal: controller.signal,
            });
            if (!response.ok) {
              throw new Error(
                `The recording download returned HTTP ${response.status}.`,
              );
            }
            const data = await response.arrayBuffer();
            if (
              data.byteLength === 0 ||
              data.byteLength > MAX_CANDIDATE_AUDIO_BYTES
            ) {
              throw new Error(
                "A generated recording had an invalid audio size.",
              );
            }
            return {
              id: candidate.id,
              index: candidate.index,
              durationMs: candidate.durationMs,
              mimeType: "audio/mpeg" as const,
              data,
            };
          } finally {
            clearTimeout(timer);
          }
        }),
      );
      await this.postMessage(webview, {
        type: "candidateSet",
        candidateSet: { ...candidateSet, candidates },
      });
    } catch (error) {
      this.library.reportError(
        `Glow created the recordings, but could not load their previews: ${errorMessage(error)}`,
      );
      await this.postMessage(webview, {
        type: "candidateSet",
        candidateSet: null,
      });
    }
  }

  private async postCustomAudio(
    webview: vscode.Webview,
    requestId: string,
    affirmationId: string,
  ): Promise<void> {
    const state = this.library.getState();
    const affirmation = state.customAffirmations.find(
      (item) => item.id === affirmationId,
    );
    if (
      !state.user ||
      !UUID_PATTERN.test(affirmationId) ||
      !affirmation?.offlineReady
    ) {
      await this.postMessage(webview, {
        type: "customAudioError",
        requestId,
        affirmationId,
        message:
          "This affirmation is still being saved to this device. Try again in a moment.",
      });
      return;
    }

    try {
      const audioUri = vscode.Uri.joinPath(
        this.globalStorageUri,
        OFFLINE_AUDIO_DIRECTORY,
        state.user.id,
        `${affirmationId}.mp3`,
      );
      const bytes = await vscode.workspace.fs.readFile(audioUri);

      await this.postMessage(webview, {
        type: "customAudioData",
        requestId,
        affirmationId,
        mimeType: "audio/mpeg",
        data: exactArrayBuffer(bytes),
      });
    } catch (error) {
      console.warn(
        "[Glow audio] Could not read a cached MP3 for the webview.",
        errorMessage(error),
      );
      await this.postMessage(webview, {
        type: "customAudioError",
        requestId,
        affirmationId,
        message:
          "The offline audio copy could not be read. Reconnect and refresh the library to repair it.",
      });
      if (state.syncStatus === "online") void this.library.refresh();
    }
  }

  private getBuildErrorHtml(webview: vscode.Webview, message: string): string {
    const escapedMessage = escapeHtml(message);
    return `<!doctype html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline';">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Glow</title>
        </head>
        <body style="padding: 16px; color: var(--vscode-foreground); font-family: var(--vscode-font-family);">
          <h2>Webview not built</h2>
          <p>Run <code>bun run build</code>, then reload the extension host.</p>
          <pre style="white-space: pre-wrap;">${escapedMessage}</pre>
        </body>
      </html>`;
  }
}

function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function normalizeVolume(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

function libraryData(state: LibraryState): LibraryData {
  return {
    user: state.user,
    entitlement: state.entitlement,
    favoriteIds: [...state.favoriteIds],
    customAffirmations: [...state.customAffirmations],
    lastSyncedAt: state.lastSyncedAt,
  };
}

function audioCacheKey(request: AudioCacheRequest): string {
  return `${request.userId}:${request.affirmationId}:${request.path}`;
}

function listeningSyncPayload(
  snapshot: OfflineSyncSnapshot,
  userId: string,
  nowMs: number,
  force = false,
): {
  sessions: OfflineListeningSession[];
  segments: OfflineListeningSegment[];
} {
  const dirtySegmentSessionIds = new Set(
    snapshot.listeningSegments
      .filter(
        (segment) =>
          segment.userId === userId &&
          segment.revision > segment.syncedRevision,
      )
      .map((segment) => segment.sessionId),
  );
  const sessions = snapshot.listeningSessions
    .filter(
      (session) =>
        session.userId === userId &&
        (session.revision > session.syncedRevision ||
          dirtySegmentSessionIds.has(session.id)) &&
        (force || listeningSessionCheckpointIsDue(session, nowMs)),
    )
    .sort(
      (left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt),
    )
    .slice(0, 200);
  const includedSessionIds = new Set(sessions.map((session) => session.id));
  const segments = snapshot.listeningSegments
    .filter(
      (segment) =>
        segment.userId === userId &&
        includedSessionIds.has(segment.sessionId) &&
        segment.revision > segment.syncedRevision,
    )
    .sort(
      (left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt),
    )
    .slice(0, 200);

  return {
    sessions,
    segments,
  };
}

function databaseListeningSession(
  session: OfflineListeningSession,
): Record<string, unknown> {
  return {
    id: session.id,
    started_at: session.startedAt,
    ended_at: session.endedAt,
    timezone_offset_minutes: session.timezoneOffsetMinutes,
  };
}

function databaseListeningSegment(
  segment: OfflineListeningSegment,
): Record<string, unknown> {
  return {
    id: segment.id,
    session_id: segment.sessionId,
    affirmation_id: segment.affirmationId,
    sequence: segment.sequence,
    started_at: segment.startedAt,
    ended_at: segment.endedAt,
    completed_listens: segment.completedListens,
    listened_ms: segment.listenedMs,
  };
}

function isValidClientTimestamp(value: string): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isRetryableRemoteError(error: unknown): boolean {
  if (isRetryableOAuthSessionError(error)) return true;
  if (
    error instanceof FunctionsFetchError ||
    error instanceof FunctionsRelayError
  )
    return true;
  if (error instanceof FunctionsHttpError) {
    return (
      error.context.status === 408 ||
      error.context.status === 429 ||
      error.context.status >= 500
    );
  }

  const details = isRecord(error) ? error : {};
  const code = typeof details.code === "string" ? details.code : "";
  const message =
    typeof details.message === "string"
      ? details.message
      : error instanceof Error
        ? error.message
        : String(error);
  return (
    /^08/.test(code) ||
    /^PGRST00[0-3]$/.test(code) ||
    /fetch failed|failed to fetch|network|offline|econn|enotfound|timed?\s*out/i.test(
      message,
    )
  );
}

function parseCachedLibrary(value: unknown): CachedLibraryV2 | null {
  if (
    !isRecord(value) ||
    (value.version !== 1 && value.version !== 2) ||
    !isRecord(value.user)
  )
    return null;

  const user = value.user;
  if (
    typeof user.id !== "string" ||
    !isValidUuid(user.id) ||
    typeof user.displayName !== "string" ||
    !isNullableString(user.username) ||
    !isNullableString(user.avatarUrl) ||
    !Array.isArray(value.favoriteIds) ||
    !value.favoriteIds.every(
      (id) => typeof id === "string" && isValidUuid(id),
    ) ||
    !Array.isArray(value.customAffirmations) ||
    typeof value.syncedAt !== "string" ||
    !Number.isFinite(Date.parse(value.syncedAt))
  ) {
    return null;
  }

  const customAffirmations: CachedCustomAffirmationV1[] = [];
  for (const item of value.customAffirmations) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      !isValidUuid(item.id) ||
      typeof item.title !== "string" ||
      typeof item.affirmation !== "string" ||
      !isNullableFiniteNumber(item.durationMs) ||
      typeof item.createdAt !== "string" ||
      !Number.isFinite(Date.parse(item.createdAt)) ||
      typeof item.storageBucket !== "string" ||
      !item.storageBucket ||
      typeof item.storagePath !== "string" ||
      !item.storagePath ||
      !isNullableFiniteNumber(item.fileSizeBytes) ||
      typeof item.audioCached !== "boolean"
    ) {
      return null;
    }

    customAffirmations.push({
      id: item.id,
      title: item.title,
      affirmation: item.affirmation,
      durationMs: item.durationMs,
      createdAt: item.createdAt,
      storageBucket: item.storageBucket,
      storagePath: item.storagePath,
      fileSizeBytes: item.fileSizeBytes,
      audioCached: item.audioCached,
    });
  }

  const entitlement =
    value.version === 2
      ? isKnownGlowEntitlement(value.entitlement)
        ? value.entitlement
        : null
      : migrateCachedGlowEntitlement(
          value.entitlement,
          customAffirmations.length > 0,
        );
  if (!entitlement) return null;

  return {
    version: 2,
    user: {
      id: user.id,
      displayName: user.displayName,
      username: user.username,
      avatarUrl: user.avatarUrl,
    },
    entitlement,
    favoriteIds: [...value.favoriteIds],
    customAffirmations,
    syncedAt: value.syncedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0)
  );
}

function readNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0)
    return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function parseRemoteAudioCandidateSet(
  value: unknown,
): RemoteAudioCandidateSet | null {
  if (!isRecord(value) || !isRecord(value.candidateSet)) return null;
  const record = value.candidateSet;
  if (
    typeof record.id !== "string" ||
    !isValidUuid(record.id) ||
    typeof record.affirmationId !== "string" ||
    !isValidUuid(record.affirmationId) ||
    (record.purpose !== "create" && record.purpose !== "regenerate") ||
    typeof record.title !== "string" ||
    typeof record.affirmation !== "string" ||
    typeof record.expiresAt !== "string" ||
    !Array.isArray(record.candidates)
  ) {
    return null;
  }

  const candidates = record.candidates
    .map((candidate): RemoteAudioCandidate | null => {
      if (
        !isRecord(candidate) ||
        typeof candidate.id !== "string" ||
        !isValidUuid(candidate.id) ||
        (candidate.index !== 1 && candidate.index !== 2) ||
        typeof candidate.signedUrl !== "string" ||
        candidate.signedUrl.length === 0
      ) {
        return null;
      }
      return {
        id: candidate.id,
        index: candidate.index,
        durationMs: readNullableNumber(candidate.durationMs),
        signedUrl: candidate.signedUrl,
      };
    })
    .filter(
      (candidate): candidate is RemoteAudioCandidate => candidate !== null,
    )
    .sort((left, right) => left.index - right.index);
  if (candidates.length !== 2) return null;

  return {
    id: record.id,
    affirmationId: record.affirmationId,
    purpose: record.purpose,
    title: record.title,
    affirmation: record.affirmation,
    expiresAt: record.expiresAt,
    candidates,
  };
}

function isRemoteCandidateSetGenerating(value: unknown): boolean {
  return (
    isRecord(value) &&
    isRecord(value.candidateSet) &&
    value.candidateSet.status === "generating"
  );
}

async function isUsableAudioFile(
  uri: vscode.Uri,
  expectedSize: number | null,
): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return (
      stat.type === vscode.FileType.File &&
      stat.size > 0 &&
      (expectedSize === null || stat.size === expectedSize)
    );
  } catch {
    return false;
  }
}

async function deleteIfPresent(
  uri: vscode.Uri,
  recursive = false,
): Promise<void> {
  try {
    await vscode.workspace.fs.delete(uri, { recursive, useTrash: false });
  } catch (error) {
    if (!isFileNotFound(error)) throw error;
  }
}

function isFileNotFound(error: unknown): boolean {
  return (
    error instanceof vscode.FileSystemError && error.code === "FileNotFound"
  );
}

function readMetadataString(
  metadata: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

async function functionErrorMessage(error: Error): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const payloadMessage = extractErrorMessage(await error.context.json());
      if (payloadMessage) return payloadMessage;
    } catch {
      // Fall back to the client error below.
    }
  }
  return errorMessage(error);
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    };

    return entities[character] ?? character;
  });
}
