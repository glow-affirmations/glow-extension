<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from "svelte";
  import {
    affirmationCategories,
    affirmationCollections,
    includedAffirmations,
    type Affirmation,
    type AffirmationCategory,
  } from "$lib/affirmations";
  import { displayAffirmationText } from "$lib/affirmationDisplay";
  import { customAudioBlob } from "$lib/audioBlob";
  import { shouldAutoOpenComposer } from "$lib/composer";
  import { buildFavoriteTracks, type FavoriteTrack } from "$lib/favoriteTracks";
  import {
    adjacentTrackAfterRemoval,
    restoredPlayingTrack,
    restoredTrackId,
    selectedTrackOrFirst,
  } from "$lib/librarySelection";
  import {
    libraryNoticeTone,
    notificationDurationMs,
    type NotificationTone,
  } from "$lib/notifications";
  import {
    listItemOut,
    listReorder,
    motionDuration,
    popoverIn,
    popoverOut,
    solMotion,
    type PopoverMotionOptions,
  } from "$lib/motion";
  import type {
    AudioCandidateSet,
    CandidateSelectionSettledMessage,
    CandidateSetMessage,
    CustomAudioMessage,
    LibraryState,
    PlayerCommandMessage,
    SolHostApi,
  } from "$lib/host";
  import { audioSourceKind } from "$lib/audioSource";
  import type { BinauralPreset } from "$lib/binauralPreference";
  import type {
    LibraryTab,
    LibraryTrackSelections,
    PersistedPlayerState,
    PlayerStateApi,
    SolWebviewState,
  } from "$lib/playerState";
  import AppToast from "./AppToast.svelte";
  import Icon from "./Icon.svelte";
  import LoadingSpinner from "./LoadingSpinner.svelte";

  type CustomTrack = Affirmation & { offlineReady: boolean };
  type CustomWorkflow = "library" | "compose" | "generating" | "choosing" | "selecting";

  function customWorkflowIn(node: Element) {
    return solMotion(node, {
      durationToken: "--sol-motion-enter",
      fallbackDuration: 260,
      offsetY: 6,
      scaleDelta: 0.015,
    });
  }

  function customWorkflowOut(node: Element) {
    return solMotion(node, {
      durationToken: "--sol-motion-feedback",
      fallbackDuration: 140,
      offsetY: 5,
      scaleDelta: 0.01,
    });
  }

  const libraryTabs: {
    id: LibraryTab;
    label: string;
    icon: "library" | "heart" | "sparkles";
  }[] = [
    { id: "included", label: "Featured", icon: "library" },
    { id: "favorites", label: "Favorites", icon: "heart" },
    { id: "custom", label: "Custom", icon: "sparkles" },
  ];
  const CUSTOM_AFFIRMATION_LIMIT = 111;

  let {
    stateApi,
    hostApi,
    libraryState,
    audioMessage,
    candidateSetMessage,
    candidateSelectionMessage,
    playerCommand,
    volume,
    repeatPauseSeconds,
    binauralVolume,
    binauralPreset,
    audioMixBalance,
    onPlaybackSessionChange,
    onSignIn,
  }: {
    stateApi: PlayerStateApi;
    hostApi: SolHostApi;
    libraryState: LibraryState;
    audioMessage: CustomAudioMessage | null;
    candidateSetMessage: CandidateSetMessage | null;
    candidateSelectionMessage: CandidateSelectionSettledMessage | null;
    playerCommand: PlayerCommandMessage | null;
    volume: number;
    repeatPauseSeconds: number;
    binauralVolume: number;
    binauralPreset: BinauralPreset;
    audioMixBalance: number;
    onPlaybackSessionChange: (active: boolean) => number;
    onSignIn: () => void;
  } = $props();

  const effectiveVoiceVolume = $derived(
    Math.min(1, Math.max(0, volume * audioMixBalance)),
  );

  function readRestoredState(): SolWebviewState["player"] {
    return stateApi.getState()?.player;
  }

  const restoredState = readRestoredState();
  const restoresCategoryState =
    restoredState?.version === 2 ||
    restoredState?.version === 3 ||
    restoredState?.version === 4;
  const restoresLibraryState = restoredState?.version === 3 || restoredState?.version === 4;
  const restoredCategory =
    restoresCategoryState && isAffirmationCategory(restoredState.selectedCategory)
      ? restoredState.selectedCategory
      : "soul";
  const restoredIndices = {
    mind:
      restoresCategoryState && isValidTrackIndex(restoredState.selectedIndices?.mind, "mind")
        ? restoredState.selectedIndices.mind
        : 0,
    soul:
      restoresCategoryState && isValidTrackIndex(restoredState.selectedIndices?.soul, "soul")
        ? restoredState.selectedIndices.soul
        : 0,
  };
  const restoredPlayingCategory =
    restoresLibraryState && isAffirmationCategory(restoredState.playingCategory)
      ? restoredState.playingCategory
      : restoredCategory;
  const restoredLibraryTab =
    restoresLibraryState && isLibraryTab(restoredState.selectedLibraryTab)
      ? restoredState.selectedLibraryTab
      : "included";
  const restoredTrackIds: LibraryTrackSelections = {
    favorites:
      restoresLibraryState
        ? restoredTrackId(restoredState.selectedTrackIds?.favorites)
        : null,
    custom:
      restoresLibraryState
        ? restoredTrackId(restoredState.selectedTrackIds?.custom)
        : null,
  };
  const restoredPlayerTrack =
    restoredState?.version === 4 ? restoredPlayingTrack(restoredState.playingTrack) : null;
  const restoredPlayingLibraryTab =
    restoredPlayerTrack?.source ?? (restoresLibraryState ? restoredLibraryTab : "included");
  const restoredPlayingTrackId =
    restoredPlayerTrack?.id ??
    (restoredPlayingLibraryTab === "favorites"
      ? restoredTrackIds.favorites
      : restoredPlayingLibraryTab === "custom"
        ? restoredTrackIds.custom
        : null);
  const restoredTime =
    restoresCategoryState && isValidTime(restoredState.currentTime) ? restoredState.currentTime : 0;
  const restoredIncludedTrack =
    affirmationCollections[restoredPlayingCategory][restoredIndices[restoredPlayingCategory]] ??
    includedAffirmations[0]!;
  const restoredBundledPlayerTrack =
    restoredPlayerTrack && !restoredPlayerTrack.isCustom
      ? includedAffirmations.find((track) => track.id === restoredPlayerTrack.id)
      : undefined;
  const initialPlayerTrack: Affirmation =
    restoredBundledPlayerTrack ??
    (restoredPlayerTrack?.isCustom
      ? {
          id: restoredPlayerTrack.id,
          title: restoredPlayerTrack.title,
          affirmation: restoredPlayerTrack.affirmation,
          audio: "",
        }
      : restoredIncludedTrack);
  let audioElement: HTMLAudioElement;
  let visualizerCanvas: HTMLCanvasElement;
  let affirmationCopyFrame: HTMLDivElement;
  let affirmationCopyMeasure: HTMLDivElement;
  let affirmationCopyObserver: ResizeObserver | undefined;
  let affirmationCopyFrameId: number | undefined;
  let hasMeasuredAffirmationCopy = false;
  let selectedLibraryTab = $state<LibraryTab>(restoredLibraryTab);
  let selectedTrackIds = $state<LibraryTrackSelections>(restoredTrackIds);
  let selectedCategory = $state<AffirmationCategory>(restoredCategory);
  let selectedIndices = $state<Record<AffirmationCategory, number>>(restoredIndices);
  let playingLibraryTab = $state<LibraryTab>(restoredPlayingLibraryTab);
  let playingCategory = $state<AffirmationCategory>(restoredPlayingCategory);
  let selectedTrackIsCustom = $state(
    restoredPlayerTrack?.isCustom ?? restoredPlayingLibraryTab === "custom",
  );
  let selectedTrack = $state<Affirmation>(initialPlayerTrack);
  let customInput = $state<HTMLInputElement>();
  let customListElement = $state<HTMLDivElement>();
  let customText = $state("");
  let customComposerOpen = $state(false);
  let customWorkflow = $state<CustomWorkflow>("library");
  let autoOpenedComposerForUserId: string | null = null;
  let pendingCandidatesRequestedForUserId: string | null = null;
  let customListMotionActive = $state(false);
  let customListMotionTimer: ReturnType<typeof setTimeout> | undefined;
  let customMenuElement = $state<HTMLDivElement>();
  let customMenuTrackId = $state<string | null>(null);
  let customMenuPosition = $state({ top: 0, left: 0 });
  let customMenuPlacement = $state<NonNullable<PopoverMotionOptions["placement"]>>("below");
  let pendingGenerationRequestId = $state<string | null>(null);
  let pendingRegenerationRequestId = $state<string | null>(null);
  let pendingRegenerationAffirmationId = $state<string | null>(null);
  let activeCandidateSet = $state<AudioCandidateSet | null>(null);
  let processedCandidateSetMessage: CandidateSetMessage | null = null;
  let processedCandidateSelectionMessage: CandidateSelectionSettledMessage | null = null;
  let candidateBlobUrls = $state<Record<string, string>>({});
  let candidateAudioElement = $state<HTMLAudioElement>();
  let playingCandidateId = $state<string | null>(null);
  let candidateReplayTimer: ReturnType<typeof setTimeout> | undefined;
  let selectedCandidateId = $state<string | null>(null);
  let selectedCandidateAffirmationId = $state<string | null>(null);
  let playbackError = $state<string | null>(null);
  let optimisticFavoriteOverrides = $state<Record<string, boolean>>({});
  let optimisticDeletedCustomIds = $state<Record<string, true>>({});
  let isPlaying = $state(false);
  let isWaiting = $state(false);
  let currentTime = $state(restoredTime);
  let duration = $state(0);
  let replayTimer: ReturnType<typeof setTimeout> | undefined;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let scheduledToastKey = "";
  let dismissedToastKey = $state("");
  let localNotice = $state<{
    key: string;
    message: string;
    tone: NotificationTone;
  } | null>(null);
  let visualizerFrame: number | undefined;
  let visualizerEnergy = 0;
  let visualizerPhase = 0;
  let prefersReducedMotion = false;
  let reducedMotionQuery: MediaQueryList | undefined;
  let shouldRestorePlayback = restoresCategoryState ? restoredState.isPlaying : false;
  let hasRestoredMedia = false;
  let hasRestoredLibrarySelection = $state(restoredPlayingLibraryTab === "included");
  let lastPersistedSecond = Math.floor(restoredTime);
  let customAudioRequestId: string | null = null;
  let customAudioBlobUrl: string | null = null;
  let customAudioTrackId: string | null = null;
  let playCustomWhenReady = false;
  let restartCustomWhenReady = false;
  let guardPlaybackStart = false;
  let statusControlsAvailable = false;
  let listeningActiveTrackId: string | null = null;
  const sets = includedAffirmations;
  const selected = $derived(selectedTrack);
  const selectedDisplayText = $derived(displayAffirmationText(selectedTrack.affirmation));
  const customTitle = $derived(displayAffirmationText(customText));
  const customCharactersRemaining = $derived(CUSTOM_AFFIRMATION_LIMIT - customText.length);
  const allIncludedAffirmations = includedAffirmations;
  const favoriteIdSet = $derived.by(() => {
    const favoriteIds = new Set(libraryState.favoriteIds);
    for (const [affirmationId, favorite] of Object.entries(optimisticFavoriteOverrides)) {
      if (favorite) favoriteIds.add(affirmationId);
      else favoriteIds.delete(affirmationId);
    }
    return favoriteIds;
  });
  const customSets = $derived<CustomTrack[]>(
    libraryState.customAffirmations
      .filter((affirmation) => !optimisticDeletedCustomIds[affirmation.id])
      .map((affirmation) => ({
        id: affirmation.id,
        title: affirmation.title,
        affirmation: affirmation.affirmation,
        audio: "",
        offlineReady: affirmation.offlineReady,
      })),
  );
  const generatingAffirmationText = $derived(
    pendingRegenerationAffirmationId
      ? displayAffirmationText(
          customSets.find((track) => track.id === pendingRegenerationAffirmationId)?.affirmation ?? "",
        )
      : customTitle,
  );
  const favoriteSets = $derived(
    buildFavoriteTracks(allIncludedAffirmations, customSets, favoriteIdSet),
  );
  const customMenuTrack = $derived(
    customSets.find((track) => track.id === customMenuTrackId) ?? null,
  );
  const isOffline = $derived(libraryState.syncStatus === "offline");
  const serverReady = $derived(libraryState.syncStatus === "online");
  const isCreating = $derived(
    pendingGenerationRequestId !== null || libraryState.busy === "generate",
  );
  const isRegenerating = $derived(
    pendingRegenerationRequestId !== null || libraryState.busy === "regenerate",
  );
  const pendingAudioChangeId = $derived(selectedCandidateAffirmationId);
  const pendingAudioLabel = $derived(
    selectedCandidateAffirmationId ? "Saving your affirmation" : null,
  );
  const createActionLabel = $derived(
    isCreating
      ? "Creating"
      : !serverReady
        ? isOffline
          ? "Connect to create"
          : "Waiting for sync…"
        : "Create affirmation",
  );
  const makeAffirmationLabel = $derived(
    isOffline
      ? "You’re offline — reconnect to create an affirmation"
      : !serverReady
        ? "Waiting for sync…"
        : "Make affirmation",
  );
  const toastMessage = $derived(
    playbackError ?? libraryState.error ?? localNotice?.message ?? libraryState.notice,
  );
  const toastTone = $derived<NotificationTone>(
    playbackError || libraryState.error
      ? "error"
      : localNotice?.tone ?? libraryNoticeTone(libraryState.notice),
  );
  const toastIsError = $derived(toastTone === "error");
  const toastKey = $derived(
    toastMessage
      ? toastIsError
        ? `error:${toastMessage}`
        : localNotice?.message === toastMessage
          ? localNotice.key
          : `notice:${toastMessage}`
      : "",
  );
  const showToast = $derived(Boolean(toastMessage) && dismissedToastKey !== toastKey);

  $effect(() => {
    const userId = libraryState.user?.id ?? null;
    if (!userId) {
      autoOpenedComposerForUserId = null;
      return;
    }
    if (
      !shouldAutoOpenComposer({
        userId,
        handledUserId: autoOpenedComposerForUserId,
        entitlement: libraryState.entitlement,
        syncStatus: libraryState.syncStatus,
        customAffirmationCount: libraryState.customAffirmations.length,
      })
    ) {
      return;
    }

    autoOpenedComposerForUserId = userId;
    untrack(() => {
      selectedLibraryTab = "custom";
      customComposerOpen = true;
      customWorkflow = "compose";
      void tick().then(() => customInput?.focus());
    });
  });

  $effect(() => {
    const userId = libraryState.user?.id ?? null;
    if (
      !userId ||
      libraryState.entitlement !== "premium" ||
      libraryState.syncStatus !== "online"
    ) {
      if (!userId) pendingCandidatesRequestedForUserId = null;
      return;
    }
    if (pendingCandidatesRequestedForUserId === userId) return;
    pendingCandidatesRequestedForUserId = userId;
    hostApi.postMessage({ type: "loadPendingCandidates" });
  });

  function publishPlayerStatus(): void {
    if (!statusControlsAvailable) return;
    hostApi.postMessage({
      type: "playerStatusChanged",
      isPlaying,
      affirmation: selectedDisplayText,
    });
  }

  $effect(() => {
    if (audioElement) audioElement.volume = effectiveVoiceVolume;
    if (candidateAudioElement) candidateAudioElement.volume = effectiveVoiceVolume;
  });

  $effect(() => {
    repeatPauseSeconds;
    untrack(() => {
      if (replayTimer !== undefined) scheduleReplay();
    });
  });

  $effect(() => {
    const command = playerCommand;
    if (!command || !statusControlsAvailable) return;
    untrack(() => {
      if (command.command === "next") void move(1, true);
      else togglePlayback();
    });
  });

  $effect(() => {
    const message = audioMessage;
    if (
      !message ||
      message.requestId !== customAudioRequestId ||
      !selectedTrackIsCustom ||
      message.affirmationId !== selectedTrack.id
    ) {
      return;
    }

    customAudioRequestId = null;
    if (message.type === "customAudioError") {
      isWaiting = false;
      playCustomWhenReady = false;
      restartCustomWhenReady = false;
      guardPlaybackStart = false;
      playbackError = message.message;
      return;
    }

    try {
      const blobUrl = URL.createObjectURL(customAudioBlob(message.data, message.mimeType));
      releaseCustomAudio();
      customAudioBlobUrl = blobUrl;
      customAudioTrackId = message.affirmationId;
      selectedTrack = { ...selectedTrack, audio: blobUrl };
      playbackError = null;
      isWaiting = true;

      void tick().then(() => {
        if (
          selectedTrackIsCustom &&
          selectedTrack.id === message.affirmationId &&
          selectedTrack.audio === blobUrl
        ) {
          audioElement.load();
        }
      });
    } catch (error) {
      isWaiting = false;
      playCustomWhenReady = false;
      restartCustomWhenReady = false;
      guardPlaybackStart = false;
      playbackError = playbackErrorMessage(error);
    }
  });

  $effect(() => {
    const message = candidateSetMessage;
    if (!message || message === processedCandidateSetMessage) return;
    processedCandidateSetMessage = message;

    if (!message.candidateSet) {
      if (pendingGenerationRequestId) {
        pendingGenerationRequestId = null;
        customWorkflow = "compose";
        customComposerOpen = true;
      } else if (pendingRegenerationRequestId) {
        pendingRegenerationRequestId = null;
        pendingRegenerationAffirmationId = null;
        customWorkflow = "library";
      }
      return;
    }

    const candidateSet = message.candidateSet;
    untrack(() => {
      releaseCandidatePreviews();
      const urls: Record<string, string> = {};
      for (const candidate of candidateSet.candidates) {
        urls[candidate.id] = URL.createObjectURL(
          customAudioBlob(candidate.data, candidate.mimeType),
        );
      }
      candidateBlobUrls = urls;
      activeCandidateSet = candidateSet;
      selectedCandidateId = null;
      pendingGenerationRequestId = null;
      pendingRegenerationRequestId = null;
      pendingRegenerationAffirmationId =
        candidateSet.purpose === "regenerate"
          ? candidateSet.affirmationId
          : null;
      customComposerOpen = false;
      customWorkflow = "choosing";
      selectedLibraryTab = "custom";
    });
  });

  $effect(() => {
    const message = candidateSelectionMessage;
    if (
      !message ||
      message === processedCandidateSelectionMessage ||
      !activeCandidateSet ||
      message.candidateSetId !== activeCandidateSet.id
    ) {
      return;
    }
    processedCandidateSelectionMessage = message;
    if (!message.succeeded) {
      selectedCandidateId = null;
      customWorkflow = "choosing";
      return;
    }

    selectedCandidateAffirmationId = message.affirmationId;
    pendingRegenerationAffirmationId = null;
    stopCandidatePreview();
    customText = "";
    customWorkflow = "selecting";
  });

  $effect(() => {
    if (!selectedCandidateAffirmationId) return;
    const track = customSets.find(
      (item) =>
        item.id === selectedCandidateAffirmationId && item.offlineReady,
    );
    if (!track) return;

    releaseCandidatePreviews();
    activeCandidateSet = null;
    selectedCandidateId = null;
    selectedCandidateAffirmationId = null;
    customComposerOpen = false;
    customWorkflow = "library";
    selectedLibraryTab = "custom";
    hasRestoredLibrarySelection = true;
    void loadTrack(track, "custom", selectedCategory, true, false);
  });

  $effect(() => {
    if (hasRestoredLibrarySelection || restoredPlayingLibraryTab === "included") return;
    if (libraryState.syncStatus === "loading") return;

    if (!libraryState.user) {
      if (libraryState.syncStatus !== "refreshing") {
        hasRestoredLibrarySelection = true;
        persistPlayerState();
      }
      return;
    }

    if (restoredPlayingLibraryTab === "favorites") {
      const playableFavorites = favoriteSets.filter(canPlayFavorite);
      const track = selectedTrackOrFirst(playableFavorites, restoredPlayingTrackId);
      if (track) {
        hasRestoredLibrarySelection = true;
        void loadTrack(track, "favorites", selectedCategory, track.isCustom, false);
      } else if (libraryState.syncStatus !== "refreshing") {
        hasRestoredLibrarySelection = true;
        persistPlayerState();
      }
      return;
    }

    const playableCustomSets = customSets.filter((track) => canPlayCustom(track));
    const track = selectedTrackOrFirst(playableCustomSets, restoredPlayingTrackId);
    if (track) {
      hasRestoredLibrarySelection = true;
      void loadTrack(track, "custom", selectedCategory, true, false);
    } else if (customSets.length === 0 && libraryState.syncStatus !== "refreshing") {
      hasRestoredLibrarySelection = true;
      persistPlayerState();
    }
  });

  $effect(() => {
    if (!toastKey) {
      scheduledToastKey = "";
      dismissedToastKey = "";
      if (toastTimer !== undefined) clearTimeout(toastTimer);
      toastTimer = undefined;
      return;
    }
    if (toastKey === scheduledToastKey) return;

    const currentToastKey = toastKey;
    scheduledToastKey = currentToastKey;
    dismissedToastKey = "";
    if (toastTimer !== undefined) clearTimeout(toastTimer);
    toastTimer = setTimeout(
      () => {
        if (localNotice?.key === currentToastKey) localNotice = null;
        else dismissedToastKey = currentToastKey;
        toastTimer = undefined;
      },
      notificationDurationMs(toastTone),
    );
  });

  $effect(() => {
    const mutationFailed =
      libraryState.error?.includes("Could not save") ||
      libraryState.error?.includes("was rejected");
    if (mutationFailed) {
      optimisticFavoriteOverrides = {};
      optimisticDeletedCustomIds = {};
      return;
    }

    const serverFavorites = new Set(libraryState.favoriteIds);
    const nextFavoriteOverrides = { ...optimisticFavoriteOverrides };
    let favoritesChanged = false;
    for (const [affirmationId, favorite] of Object.entries(nextFavoriteOverrides)) {
      if (serverFavorites.has(affirmationId) === favorite) {
        delete nextFavoriteOverrides[affirmationId];
        favoritesChanged = true;
      }
    }
    if (favoritesChanged) optimisticFavoriteOverrides = nextFavoriteOverrides;

    const serverCustomIds = new Set(
      libraryState.customAffirmations.map((affirmation) => affirmation.id),
    );
    const nextDeletedCustomIds = { ...optimisticDeletedCustomIds };
    let deletedCustomsChanged = false;
    for (const affirmationId of Object.keys(nextDeletedCustomIds)) {
      if (!serverCustomIds.has(affirmationId)) {
        delete nextDeletedCustomIds[affirmationId];
        deletedCustomsChanged = true;
      }
    }
    if (deletedCustomsChanged) optimisticDeletedCustomIds = nextDeletedCustomIds;
  });

  function isAffirmationCategory(value: string | undefined): value is AffirmationCategory {
    return value === "mind" || value === "soul";
  }

  function isLibraryTab(value: string | undefined): value is LibraryTab {
    return value === "included" || value === "favorites" || value === "custom";
  }

  function isValidTrackIndex(value: number | undefined, category: AffirmationCategory): value is number {
    return (
      Number.isInteger(value) &&
      value !== undefined &&
      value >= 0 &&
      value < affirmationCollections[category].length
    );
  }

  function isValidTime(value: number | undefined): value is number {
    return value !== undefined && Number.isFinite(value) && value >= 0;
  }

  function playbackErrorMessage(error: unknown): string {
    const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
    return `This affirmation could not be played.${detail}`;
  }

  function formatCandidateDuration(durationMs: number | null): string {
    if (durationMs === null) return "Ready to preview";
    const seconds = Math.max(1, Math.round(durationMs / 1000));
    return `${seconds} sec`;
  }

  function candidateLabel(index: 1 | 2): "A" | "B" {
    return index === 1 ? "A" : "B";
  }

  function mediaErrorMessage(error: MediaError | null): string {
    if (error?.code === MediaError.MEDIA_ERR_NETWORK) {
      return "Playback was interrupted by a network problem. Try again when the connection is stable.";
    }
    if (error?.code === MediaError.MEDIA_ERR_DECODE) {
      return "VS Code could not decode this affirmation’s audio.";
    }
    if (error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
      return "This affirmation’s audio source is unavailable or unsupported.";
    }
    return "This affirmation could not be loaded for playback.";
  }

  function persistPlayerState(): void {
    const player: PersistedPlayerState = {
      version: 4,
      selectedLibraryTab,
      selectedTrackIds: { ...selectedTrackIds },
      playingTrack: {
        source: playingLibraryTab,
        id: selectedTrack.id,
        title: selectedTrack.title,
        affirmation: selectedTrack.affirmation,
        isCustom: selectedTrackIsCustom,
      },
      selectedCategory,
      playingCategory,
      selectedIndices: { ...selectedIndices },
      currentTime: playingLibraryTab === "included" ? currentTime : 0,
      isPlaying: playingLibraryTab === "included" ? isPlaying : false,
      loopEnabled: true,
      volume,
      repeatPauseSeconds,
      binauralVolume,
      binauralPreset,
    };

    stateApi.setState({
      ...stateApi.getState(),
      player,
    });
    lastPersistedSecond = Math.floor(currentTime);
  }

  function clearReplayTimer(): void {
    if (replayTimer !== undefined) {
      clearTimeout(replayTimer);
      replayTimer = undefined;
    }
  }

  function scheduleReplay(): void {
    clearReplayTimer();
    replayTimer = setTimeout(() => {
      replayTimer = undefined;
      audioElement.currentTime = 0;
      currentTime = 0;
      void startPlayback();
    }, repeatPauseSeconds * 1000);
  }

  function reportListeningStarted(): void {
    if (listeningActiveTrackId === selectedTrack.id) return;
    reportListeningStopped();
    listeningActiveTrackId = selectedTrack.id;
    hostApi.postMessage({
      type: "listeningStarted",
      affirmationId: selectedTrack.id,
      occurredAt: new Date().toISOString(),
      timezoneOffsetMinutes: new Date().getTimezoneOffset(),
    });
  }

  function reportListeningCompleted(): void {
    if (listeningActiveTrackId !== selectedTrack.id) return;
    const completedDuration = Number.isFinite(audioElement.duration)
      ? audioElement.duration
      : duration;
    const durationMs = Math.round(completedDuration * 1000);
    if (durationMs <= 0) return;
    hostApi.postMessage({
      type: "listeningCompleted",
      affirmationId: selectedTrack.id,
      occurredAt: new Date().toISOString(),
      durationMs,
    });
  }

  function reportListeningStopped(): void {
    if (!listeningActiveTrackId) return;
    hostApi.postMessage({
      type: "listeningStopped",
      affirmationId: listeningActiveTrackId,
      occurredAt: new Date().toISOString(),
    });
    listeningActiveTrackId = null;
  }

  function releaseCustomAudio(): void {
    if (!customAudioBlobUrl) return;
    if (audioElement) {
      audioElement.pause();
      audioElement.removeAttribute("src");
    }
    URL.revokeObjectURL(customAudioBlobUrl);
    customAudioBlobUrl = null;
    customAudioTrackId = null;
  }

  function requestCustomAudio(affirmationId: string): void {
    if (customAudioRequestId || customAudioTrackId === affirmationId) return;

    const track = customSets.find((item) => item.id === affirmationId);
    if (!track?.offlineReady) {
      isWaiting = false;
      playCustomWhenReady = false;
      restartCustomWhenReady = false;
      guardPlaybackStart = false;
      playbackError = "This affirmation is still being saved to this device. Try again in a moment.";
      return;
    }

    const requestId = crypto.randomUUID();
    customAudioRequestId = requestId;
    isWaiting = true;
    hostApi.postMessage({ type: "prepareCustomAudio", requestId, affirmationId });
  }

  async function loadTrack(
    track: Affirmation,
    source: LibraryTab,
    category: AffirmationCategory = selectedCategory,
    requiresCustomAudio = source === "custom",
    shouldResume = isPlaying,
  ): Promise<void> {
    if (pendingAudioChangeId && track.id !== pendingAudioChangeId) return;

    clearReplayTimer();
    customAudioRequestId = null;
    playCustomWhenReady = false;
    restartCustomWhenReady = false;
    guardPlaybackStart = false;
    reportListeningStopped();
    audioElement.pause();
    isPlaying = false;
    releaseCustomAudio();
    selectedTrack = track;
    selectedTrackIsCustom = requiresCustomAudio;
    playingLibraryTab = source;
    playingCategory = category;
    if (source === "favorites") {
      selectedTrackIds = { ...selectedTrackIds, favorites: track.id };
    } else if (source === "custom") {
      selectedTrackIds = { ...selectedTrackIds, custom: track.id };
    }
    currentTime = 0;
    duration = 0;
    isWaiting = false;
    playbackError = null;
    shouldRestorePlayback = false;
    hasRestoredMedia = true;
    publishPlayerStatus();
    persistPlayerState();

    await tick();

    if (requiresCustomAudio) {
      selectedTrack = { ...track, audio: "" };
      playCustomWhenReady = shouldResume;
      restartCustomWhenReady = shouldResume;
      requestCustomAudio(track.id);
      return;
    }

    audioElement.load();

    if (shouldResume) {
      await startPlayback(true);
    }
  }

  async function selectSet(index: number): Promise<void> {
    const track = sets[index];
    if (!track) return;
    const location = includedTrackLocation(track);
    if (!location) return;
    selectedCategory = location.category;
    selectedIndices = { ...selectedIndices, [location.category]: location.index };
    await loadTrack(track, "included", location.category, false, true);
  }

  function selectLibraryTab(tab: LibraryTab): void {
    hasRestoredLibrarySelection = true;
    customMenuTrackId = null;
    selectedLibraryTab = tab;
    persistPlayerState();
  }

  function handleLibraryKeydown(event: KeyboardEvent): void {
    const currentIndex = libraryTabs.findIndex((tab) => tab.id === selectedLibraryTab);
    let nextIndex: number;

    if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + libraryTabs.length) % libraryTabs.length;
    } else if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % libraryTabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = libraryTabs.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const nextTab = libraryTabs[nextIndex].id;
    selectLibraryTab(nextTab);
    void tick().then(() => {
      document.getElementById(`library-tab-${nextTab}`)?.focus();
    });
  }

  function adjacentTrack(
    playingSets: readonly Affirmation[],
    direction: -1 | 1,
  ): Affirmation | null {
    if (playingSets.length === 0) return null;
    const currentIndex = playingSets.findIndex((track) => track.id === selected.id);
    if (currentIndex < 0) return null;
    const nextIndex = (currentIndex + direction + playingSets.length) % playingSets.length;
    return playingSets[nextIndex] ?? null;
  }

  async function move(direction: -1 | 1, shouldPlay = isPlaying): Promise<void> {
    const playableFavorites = favoriteSets.filter(canPlayFavorite);
    const playableCustom = customSets.filter(canPlayCustom);
    const primarySets =
      playingLibraryTab === "included"
        ? sets
        : playingLibraryTab === "favorites"
          ? playableFavorites
          : playableCustom;
    let nextTrack = adjacentTrack(primarySets, direction);
    let nextSource = playingLibraryTab;

    // A restored player can briefly know the track before its original queue is
    // available. A one-item Favorites queue also has nowhere meaningful to go.
    // Resolve the track's canonical library in either case so Next always advances.
    if (!nextTrack || (nextTrack.id === selected.id && primarySets.length === 1)) {
      const canonicalSets = selectedTrackIsCustom ? playableCustom : sets;
      const canonicalTrack = adjacentTrack(canonicalSets, direction);
      if (canonicalTrack) {
        nextTrack = canonicalTrack;
        nextSource = selectedTrackIsCustom ? "custom" : "included";
      }
    }

    if (!nextTrack) return;

    if (nextSource === "included") {
      const location = includedTrackLocation(nextTrack);
      if (!location) return;
      selectedCategory = location.category;
      selectedIndices = { ...selectedIndices, [location.category]: location.index };
      await loadTrack(nextTrack, "included", location.category, false, shouldPlay);
      return;
    }

    const requiresCustomAudio =
      nextSource === "custom" ||
      (nextSource === "favorites" && customSets.some((track) => track.id === nextTrack.id));
    await loadTrack(
      nextTrack,
      nextSource,
      selectedCategory,
      requiresCustomAudio,
      shouldPlay,
    );
  }

  function toggleFavorite(affirmationId: string): void {
    if (!libraryState.user) {
      onSignIn();
      return;
    }
    const favorite = !favoriteIdSet.has(affirmationId);
    optimisticFavoriteOverrides = {
      ...optimisticFavoriteOverrides,
      [affirmationId]: favorite,
    };
    hostApi.postMessage({
      type: "toggleFavorite",
      affirmationId,
      favorite,
    });
  }

  function openPremium(): void {
    hostApi.postMessage({ type: "openPremium" });
  }

  function confirmPremium(): void {
    hostApi.postMessage({ type: "confirmPremium" });
  }

  function reopenPremium(): void {
    hostApi.postMessage({ type: "reopenPremium" });
  }

  function toggleCustomMenu(track: CustomTrack, event: MouseEvent): void {
    event.stopPropagation();
    if (customMenuTrackId === track.id) {
      customMenuTrackId = null;
      return;
    }

    const button = event.currentTarget as HTMLButtonElement;
    const bounds = button.getBoundingClientRect();
    const menuWidth = Math.min(190, Math.max(0, window.innerWidth - 16));
    const menuHeight = 134;
    const gap = 6;
    const opensBelow = bounds.bottom + gap + menuHeight <= window.innerHeight - 8;
    const top = opensBelow
      ? bounds.bottom + gap
      : Math.max(8, bounds.top - menuHeight - gap);
    const left = Math.max(8, Math.min(bounds.right - menuWidth, window.innerWidth - menuWidth - 8));

    customMenuPosition = { top, left };
    customMenuPlacement = opensBelow ? "below" : "above";
    customMenuTrackId = track.id;
    void tick().then(() => {
      customMenuElement?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    });
  }

  function toggleCustomFavorite(track: CustomTrack): void {
    customMenuTrackId = null;
    toggleFavorite(track.id);
  }

  function regenerateCustomFromMenu(track: CustomTrack): void {
    customMenuTrackId = null;
    if (!serverReady || isCreating || isRegenerating || !track.offlineReady) return;

    localNotice = null;
    const requestId = crypto.randomUUID();
    clearReplayTimer();
    customAudioRequestId = null;
    playCustomWhenReady = false;
    restartCustomWhenReady = false;
    guardPlaybackStart = false;
    reportListeningStopped();
    audioElement.pause();
    isPlaying = false;
    onPlaybackSessionChange(false);
    selectedLibraryTab = "custom";
    playbackError = null;
    pendingRegenerationRequestId = requestId;
    pendingRegenerationAffirmationId = track.id;
    customWorkflow = "generating";
    customComposerOpen = false;
    persistPlayerState();
    hostApi.postMessage({ type: "regenerateCustom", requestId, affirmationId: track.id });
  }

  function deleteCustomFromMenu(track: CustomTrack): void {
    customMenuTrackId = null;
    optimisticallyDeleteCustom(track);
  }

  function beginCustomListRemovalMotion(): void {
    customListMotionActive = true;
    if (customListMotionTimer !== undefined) clearTimeout(customListMotionTimer);

    const exitDuration = customListElement
      ? motionDuration(customListElement, "--sol-motion-feedback", 140)
      : 140;
    const layoutDuration = customListElement
      ? motionDuration(customListElement, "--sol-motion-state", 200)
      : 200;

    customListMotionTimer = setTimeout(() => {
      customListMotionActive = false;
      customListMotionTimer = undefined;
    }, exitDuration + layoutDuration);
  }

  function generateCustom(event: SubmitEvent): void {
    event.preventDefault();
    if (isOffline) return;
    const affirmation = customText.trim();
    const title = displayAffirmationText(affirmation);
    if (!title || !affirmation || isCreating) return;
    const requestId = crypto.randomUUID();
    pendingGenerationRequestId = requestId;
    customWorkflow = "generating";
    customComposerOpen = false;
    clearReplayTimer();
    reportListeningStopped();
    audioElement.pause();
    isPlaying = false;
    onPlaybackSessionChange(false);
    hostApi.postMessage({
      type: "generateCustom",
      requestId,
      title,
      affirmation,
    });
  }

  function openCustomComposer(): void {
    customComposerOpen = true;
    customWorkflow = "compose";
    void tick().then(() => customInput?.focus());
  }

  function closeCustomComposer(): void {
    if (isCreating) return;
    customInput?.blur();
    customComposerOpen = false;
    customWorkflow = "library";
  }

  function releaseCandidatePreviews(): void {
    clearCandidateReplayTimer();
    candidateAudioElement?.pause();
    if (candidateAudioElement) {
      candidateAudioElement.currentTime = 0;
      candidateAudioElement.removeAttribute("src");
      candidateAudioElement.load();
    }
    for (const url of Object.values(candidateBlobUrls)) URL.revokeObjectURL(url);
    candidateBlobUrls = {};
    playingCandidateId = null;
  }

  function clearCandidateReplayTimer(): void {
    if (candidateReplayTimer !== undefined) {
      clearTimeout(candidateReplayTimer);
      candidateReplayTimer = undefined;
    }
  }

  function stopCandidatePreview(): void {
    clearCandidateReplayTimer();
    candidateAudioElement?.pause();
    if (candidateAudioElement) candidateAudioElement.currentTime = 0;
    playingCandidateId = null;
  }

  function handleCandidateEnded(): void {
    const candidateId = playingCandidateId;
    if (!candidateId || customWorkflow === "selecting") {
      stopCandidatePreview();
      return;
    }

    clearCandidateReplayTimer();
    candidateReplayTimer = setTimeout(() => {
      candidateReplayTimer = undefined;
      const audio = candidateAudioElement;
      if (!audio || playingCandidateId !== candidateId || customWorkflow === "selecting") return;

      audio.currentTime = 0;
      audio.volume = effectiveVoiceVolume;
      void audio.play().catch((error) => {
        audio.currentTime = 0;
        playingCandidateId = null;
        playbackError = playbackErrorMessage(error);
      });
    }, 1000);
  }

  function toggleCandidatePreview(candidateId: string): void {
    const audio = candidateAudioElement;
    const url = candidateBlobUrls[candidateId];
    if (!audio || !url || customWorkflow === "selecting") return;

    if (playingCandidateId === candidateId) {
      stopCandidatePreview();
      return;
    }
    stopCandidatePreview();
    audio.src = url;
    audio.currentTime = 0;
    audio.volume = effectiveVoiceVolume;
    playingCandidateId = candidateId;
    void audio.play().catch((error) => {
      audio.currentTime = 0;
      playingCandidateId = null;
      playbackError = playbackErrorMessage(error);
    });
  }

  function selectCandidate(candidateId: string): void {
    if (!activeCandidateSet || customWorkflow === "selecting") return;
    stopCandidatePreview();
    selectedCandidateId = candidateId;
    customWorkflow = "selecting";
    hostApi.postMessage({
      type: "selectCandidate",
      candidateSetId: activeCandidateSet.id,
      affirmationId: activeCandidateSet.affirmationId,
      generationId: candidateId,
    });
  }

  function cancelCandidateChoice(): void {
    if (!activeCandidateSet || customWorkflow === "selecting") return;
    const candidateSet = activeCandidateSet;
    releaseCandidatePreviews();
    activeCandidateSet = null;
    selectedCandidateId = null;
    pendingGenerationRequestId = null;
    pendingRegenerationRequestId = null;
    pendingRegenerationAffirmationId = null;
    customComposerOpen = candidateSet.purpose === "create";
    customWorkflow = candidateSet.purpose === "create" ? "compose" : "library";
    hostApi.postMessage({
      type: "cancelCandidates",
      candidateSetId: candidateSet.id,
    });
    if (customComposerOpen) void tick().then(() => customInput?.focus());
  }

  function optimisticallyDeleteCustom(track: Affirmation): void {
    const adjacentCustomTrack = adjacentTrackAfterRemoval(
      customSets,
      track.id,
      canPlayCustom,
    );
    beginCustomListRemovalMotion();
    optimisticDeletedCustomIds = { ...optimisticDeletedCustomIds, [track.id]: true };
    if (selectedTrackIds.custom === track.id) {
      selectedTrackIds = { ...selectedTrackIds, custom: null };
    }
    if (selectedTrackIds.favorites === track.id) {
      selectedTrackIds = { ...selectedTrackIds, favorites: null };
    }
    if (selectedTrackIsCustom && selected.id === track.id) {
      stopPlayback();
      if (adjacentCustomTrack) {
        void loadTrack(adjacentCustomTrack, "custom", selectedCategory, true);
      } else {
        const featuredFallback =
          affirmationCollections[selectedCategory][selectedIndices[selectedCategory]];
        if (featuredFallback) {
          void loadTrack(featuredFallback, "included", selectedCategory);
        }
      }
    }
    hostApi.postMessage({ type: "deleteCustom", affirmationId: track.id });
  }

  function canPlayCustom(track: CustomTrack): boolean {
    return track.offlineReady;
  }

  function canPlayFavorite(track: FavoriteTrack): boolean {
    return !track.isCustom || track.offlineReady;
  }

  function includedTrackLocation(
    track: Affirmation,
  ): { category: AffirmationCategory; index: number } | null {
    for (const category of affirmationCategories) {
      const index = affirmationCollections[category].findIndex((item) => item.id === track.id);
      if (index >= 0) return { category, index };
    }
    return null;
  }

  function dismissToast(): void {
    if (localNotice?.key === toastKey) localNotice = null;
    else dismissedToastKey = toastKey;
    if (toastTimer !== undefined) clearTimeout(toastTimer);
    toastTimer = undefined;
  }

  async function startPlayback(restartFromBeginning = false): Promise<void> {
    clearReplayTimer();
    playbackError = null;

    if (selectedTrack.id === pendingAudioChangeId) {
      isWaiting = true;
      playCustomWhenReady = true;
      restartCustomWhenReady = restartCustomWhenReady || restartFromBeginning;
      return;
    }

    if (selectedTrackIsCustom) {
      if (!selectedTrack.audio) {
        playCustomWhenReady = true;
        restartCustomWhenReady = restartCustomWhenReady || restartFromBeginning;
        requestCustomAudio(selectedTrack.id);
        return;
      }
      if (audioElement.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
        playCustomWhenReady = true;
        restartCustomWhenReady = restartCustomWhenReady || restartFromBeginning;
        isWaiting = true;
        audioElement.load();
        return;
      }
    }

    const shouldRestart = restartFromBeginning || restartCustomWhenReady;
    playCustomWhenReady = false;
    restartCustomWhenReady = false;
    isWaiting = false;

    if (shouldRestart || audioElement.ended) {
      audioElement.pause();
      audioElement.currentTime = 0;
      currentTime = 0;
    }
    if (Number.isFinite(audioElement.duration)) {
      duration = audioElement.duration;
    }

    try {
      guardPlaybackStart = shouldRestart;
      const startingMixBalance = isPlaying
        ? audioMixBalance
        : onPlaybackSessionChange(true);
      audioElement.volume = Math.min(1, Math.max(0, volume * startingMixBalance));
      await audioElement.play();
      isPlaying = true;
      reportListeningStarted();
      statusControlsAvailable = true;
      publishPlayerStatus();
      persistPlayerState();
    } catch (error) {
      guardPlaybackStart = false;
      isPlaying = false;
      onPlaybackSessionChange(false);
      reportListeningStopped();
      publishPlayerStatus();
      reportAudioFailure("play-rejected", error);
      playbackError = playbackErrorMessage(error);
      persistPlayerState();
    }
  }

  function handleAudioError(): void {
    if (selectedTrackIsCustom && !selectedTrack.audio) return;
    reportListeningStopped();
    isPlaying = false;
    onPlaybackSessionChange(false);
    isWaiting = false;
    playCustomWhenReady = false;
    restartCustomWhenReady = false;
    guardPlaybackStart = false;
    publishPlayerStatus();
    reportAudioFailure("media-error");
    playbackError = mediaErrorMessage(audioElement.error);
    persistPlayerState();
  }

  function stopPlayback(): void {
    clearReplayTimer();
    reportListeningStopped();
    audioElement.pause();
    audioElement.currentTime = 0;
    currentTime = 0;
    isPlaying = false;
    onPlaybackSessionChange(false);
    isWaiting = false;
    playCustomWhenReady = false;
    restartCustomWhenReady = false;
    guardPlaybackStart = false;
    publishPlayerStatus();
    persistPlayerState();
  }

  function togglePlayback(): void {
    if (isPlaying) {
      stopPlayback();
    } else {
      void startPlayback(true);
    }
  }

  function handleEnded(): void {
    reportListeningCompleted();
    currentTime = duration;
    isWaiting = true;
    persistPlayerState();
    scheduleReplay();
  }

  function handleCanPlay(): void {
    if (
      !selectedTrackIsCustom ||
      selectedTrack.audio !== customAudioBlobUrl ||
      audioElement.currentSrc !== customAudioBlobUrl
    ) {
      return;
    }
    isWaiting = false;
    if (playCustomWhenReady) {
      const shouldRestart = restartCustomWhenReady;
      playCustomWhenReady = false;
      restartCustomWhenReady = false;
      void startPlayback(shouldRestart);
    }
  }

  function handlePlaying(): void {
    if (!guardPlaybackStart) return;
    guardPlaybackStart = false;
    if (audioElement.currentTime <= 0.25) return;
    audioElement.currentTime = 0;
    currentTime = 0;
  }

  function handleLoadedMetadata(): void {
    duration = audioElement.duration;

    if (!hasRestoredMedia) {
      hasRestoredMedia = true;
      const safeRestoredTime = restoredTime < duration ? restoredTime : 0;
      audioElement.currentTime = safeRestoredTime;
      currentTime = safeRestoredTime;

      if (shouldRestorePlayback) {
        shouldRestorePlayback = false;
        void startPlayback();
        return;
      }
    }

    persistPlayerState();
  }

  function reportAudioFailure(stage: "media-error" | "play-rejected", error?: unknown): void {
    const source = audioElement?.currentSrc || selectedTrack.audio;
    console.warn("[Glow audio] Playback failure.", {
      stage,
      sourceKind: audioSourceKind(source),
      sourceLength: source.length,
      mediaErrorCode: audioElement?.error?.code ?? null,
      networkState: audioElement?.networkState ?? null,
      readyState: audioElement?.readyState ?? null,
      errorName: error instanceof Error ? error.name : null,
    });
  }

  function handleTimeUpdate(): void {
    currentTime = audioElement.currentTime;

    if (Math.floor(currentTime) !== lastPersistedSecond) {
      persistPlayerState();
    }
  }

  function handleVisibilityChange(): void {
    persistPlayerState();

    if (document.hidden) {
      stopVisualizer();
    } else {
      startVisualizer();
    }

    if (!document.hidden && isPlaying && !isWaiting && audioElement.paused) {
      void startPlayback();
    }
  }

  function startVisualizer(): void {
    if (visualizerFrame === undefined) {
      visualizerFrame = requestAnimationFrame(drawVisualizer);
    }
  }

  function stopVisualizer(): void {
    if (visualizerFrame !== undefined) {
      cancelAnimationFrame(visualizerFrame);
      visualizerFrame = undefined;
    }
  }

  function handleReducedMotionChange(event: MediaQueryListEvent): void {
    prefersReducedMotion = event.matches;
    visualizerEnergy = 0;
    stopVisualizer();
    startVisualizer();
  }

  function drawVisualizer(): void {
    visualizerFrame = undefined;

    if (!visualizerCanvas) {
      return;
    }

    const width = visualizerCanvas.clientWidth;
    const height = visualizerCanvas.clientHeight;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const renderWidth = Math.max(1, Math.round(width * pixelRatio));
    const renderHeight = Math.max(1, Math.round(height * pixelRatio));

    if (visualizerCanvas.width !== renderWidth || visualizerCanvas.height !== renderHeight) {
      visualizerCanvas.width = renderWidth;
      visualizerCanvas.height = renderHeight;
    }

    const context = visualizerCanvas.getContext("2d");
    if (!context) {
      return;
    }

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);

    const styles = getComputedStyle(visualizerCanvas);
    const accent = styles.getPropertyValue("--sol-accent").trim() || "#ff5636";
    const track = styles.getPropertyValue("--sol-progress-track").trim() || "rgba(127, 127, 127, 0.2)";
    const center = height / 2;

    context.strokeStyle = track;
    context.lineWidth = 1;
    context.globalAlpha = 0.5;
    context.beginPath();
    context.moveTo(0, center);
    context.lineTo(width, center);
    context.stroke();

    const targetEnergy = isPlaying && !prefersReducedMotion
      ? 0.24 + (Math.sin(visualizerPhase * 2.1) + 1) * 0.06
      : 0;
    const easing = targetEnergy > visualizerEnergy ? 0.035 : 0.018;
    visualizerEnergy += (targetEnergy - visualizerEnergy) * easing;

    if (isPlaying && !prefersReducedMotion) {
      visualizerPhase += 0.012 + visualizerEnergy * 0.014;
    }

    const amplitude = 1 + visualizerEnergy * height * 0.38;
    const pointCount = Math.max(48, Math.min(120, Math.floor(width / 4)));
    const wavePath = new Path2D();

    for (let index = 0; index <= pointCount; index += 1) {
      const position = index / pointCount;
      const envelope = Math.pow(Math.sin(position * Math.PI), 0.72);
      const primaryWave = Math.sin(position * Math.PI * 2.2 + visualizerPhase);
      const secondaryWave = Math.sin(position * Math.PI * 4.4 - visualizerPhase * 0.62) * 0.26;
      const x = position * width;
      const y = center + (primaryWave + secondaryWave) * amplitude * envelope;

      if (index === 0) {
        wavePath.moveTo(x, y);
      } else {
        wavePath.lineTo(x, y);
      }
    }

    context.strokeStyle = accent;
    context.lineCap = "round";
    context.lineJoin = "round";

    context.globalAlpha = 0.08 + visualizerEnergy * 0.12;
    context.lineWidth = 9;
    context.stroke(wavePath);

    context.globalAlpha = 0.18 + visualizerEnergy * 0.18;
    context.lineWidth = 4;
    context.stroke(wavePath);

    context.globalAlpha = isPlaying ? 0.76 : 0.42;
    context.lineWidth = 1.5;
    context.stroke(wavePath);

    context.globalAlpha = 1;

    if (!document.hidden && !prefersReducedMotion) {
      startVisualizer();
    }
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && customMenuTrackId) {
      const trackId = customMenuTrackId;
      customMenuTrackId = null;
      void tick().then(() => document.getElementById(`custom-menu-button-${trackId}`)?.focus());
      return;
    }

    if (
      event.code !== "Space" ||
      event.repeat ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }

    const target = event.target;
    if (
      target instanceof Element &&
      target.closest("button, input, textarea, select, a, [contenteditable='true']")
    ) {
      return;
    }

    event.preventDefault();
    togglePlayback();
  }

  function handleDocumentPointerDown(event: PointerEvent): void {
    if (!customMenuTrackId || !(event.target instanceof Element)) return;
    if (event.target.closest("[data-custom-menu]")) return;
    customMenuTrackId = null;
  }

  function handleDocumentScroll(): void {
    customMenuTrackId = null;
  }

  function syncAffirmationCopyHeight(): void {
    if (affirmationCopyFrameId !== undefined) {
      cancelAnimationFrame(affirmationCopyFrameId);
    }

    affirmationCopyFrameId = requestAnimationFrame(() => {
      affirmationCopyFrameId = undefined;
      const measuredHeight = Math.ceil(affirmationCopyMeasure.getBoundingClientRect().height * 2) / 2;
      if (measuredHeight <= 0) return;

      const currentHeight = Number.parseFloat(affirmationCopyFrame.style.height);
      if (Number.isFinite(currentHeight) && Math.abs(currentHeight - measuredHeight) < 0.5) {
        return;
      }

      if (!hasMeasuredAffirmationCopy) {
        affirmationCopyFrame.style.transition = "none";
        affirmationCopyFrame.style.height = `${measuredHeight}px`;
        void affirmationCopyFrame.offsetHeight;
        affirmationCopyFrame.style.removeProperty("transition");
        hasMeasuredAffirmationCopy = true;
        return;
      }

      affirmationCopyFrame.style.height = `${measuredHeight}px`;
    });
  }

  onMount(() => {
    reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    prefersReducedMotion = reducedMotionQuery.matches;
    reducedMotionQuery.addEventListener("change", handleReducedMotionChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("pointerdown", handleDocumentPointerDown);
    document.addEventListener("scroll", handleDocumentScroll, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleDocumentScroll);
    affirmationCopyObserver = new ResizeObserver(syncAffirmationCopyHeight);
    affirmationCopyObserver.observe(affirmationCopyMeasure);
    syncAffirmationCopyHeight();
    audioElement.volume = effectiveVoiceVolume;
    startVisualizer();

    if (audioElement.readyState >= HTMLMediaElement.HAVE_METADATA) {
      handleLoadedMetadata();
    }
  });

  onDestroy(() => {
    onPlaybackSessionChange(false);
    persistPlayerState();
    clearReplayTimer();
    reportListeningStopped();
    if (toastTimer !== undefined) clearTimeout(toastTimer);
    if (customListMotionTimer !== undefined) clearTimeout(customListMotionTimer);
    customAudioRequestId = null;
    releaseCustomAudio();
    releaseCandidatePreviews();
    stopVisualizer();
    affirmationCopyObserver?.disconnect();
    if (affirmationCopyFrameId !== undefined) cancelAnimationFrame(affirmationCopyFrameId);
    reducedMotionQuery?.removeEventListener("change", handleReducedMotionChange);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    document.removeEventListener("pointerdown", handleDocumentPointerDown);
    document.removeEventListener("scroll", handleDocumentScroll, true);
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("resize", handleDocumentScroll);
  });
</script>

<div class="affirm-view">
<div class="player-cards" role="group" aria-label="Affirmation player">
  <section class="panel affirmation-card" aria-label="Selected affirmation">
    <div bind:this={affirmationCopyFrame} class="affirmation-copy-frame">
      <div bind:this={affirmationCopyMeasure} class="affirmation-copy-measure">
        {#key selectedTrack.id}
          <p class="affirmation">{selectedDisplayText}</p>
        {/key}
      </div>
    </div>
    <canvas
      bind:this={visualizerCanvas}
      class="audio-visualizer"
      aria-hidden="true"
    ></canvas>
  </section>

  <section class="playback-card" aria-label="Playback controls">
    <audio
      bind:this={audioElement}
      src={selected.audio || undefined}
      preload="metadata"
      oncanplay={handleCanPlay}
      onplaying={handlePlaying}
      onloadedmetadata={handleLoadedMetadata}
      ontimeupdate={handleTimeUpdate}
      onended={handleEnded}
      onerror={handleAudioError}
    ></audio>
    <audio
      bind:this={candidateAudioElement}
      preload="metadata"
      onended={handleCandidateEnded}
    ></audio>

    <div class="audio-controls">
      <button class="icon-button transport-button" type="button" aria-label="Previous affirmation" disabled={pendingAudioChangeId !== null} onclick={() => move(-1)}>
        <Icon name="previous" />
      </button>
      <button
        class:loading={pendingAudioChangeId !== null}
        class="play-button"
        type="button"
        aria-label={pendingAudioLabel ?? (isPlaying ? "Stop selected affirmation" : "Play selected affirmation from the beginning")}
        aria-pressed={pendingAudioChangeId === null ? isPlaying : undefined}
        aria-busy={pendingAudioChangeId !== null}
        disabled={pendingAudioChangeId !== null}
        title={pendingAudioLabel ?? (isPlaying ? "Stop (Space)" : "Play from beginning (Space)")}
        onclick={togglePlayback}
      >
        {#key pendingAudioLabel ?? (isPlaying ? "stop" : "play")}
          <span class="play-state-icon">
            {#if pendingAudioChangeId !== null}
              <LoadingSpinner size="prominent" />
            {:else}
              <Icon name={isPlaying ? "stop" : "play"} size="prominent" weight="fill" />
            {/if}
          </span>
        {/key}
      </button>
      <button class="icon-button transport-button" type="button" aria-label="Next affirmation" disabled={pendingAudioChangeId !== null} onclick={() => move(1)}>
        <Icon name="next" />
      </button>
    </div>
  </section>
</div>

<div class="panel library-tabs" role="tablist" aria-label="Affirmation library">
  <span
    class="library-tab-indicator"
    data-selected={selectedLibraryTab}
    aria-hidden="true"
  ></span>
  {#each libraryTabs as tab, tabIndex}
    <button
      id={`library-tab-${tab.id}`}
      class:active={selectedLibraryTab === tab.id}
      class="library-tab"
      style={`grid-column: ${tabIndex + 1}; grid-row: 1;`}
      type="button"
      role="tab"
      aria-selected={selectedLibraryTab === tab.id}
      aria-controls="affirmation-library-panel"
      aria-label={tab.label}
      title={tab.label}
      tabindex={selectedLibraryTab === tab.id ? 0 : -1}
      onclick={() => selectLibraryTab(tab.id)}
      onkeydown={handleLibraryKeydown}
    >
      <span class="library-tab-icon" aria-hidden="true">
        <Icon name={tab.icon} weight={selectedLibraryTab === tab.id ? "bold" : "regular"} />
      </span>
      <span class="library-tab-label">{tab.label}</span>
    </button>
  {/each}
</div>

{#if showToast && toastMessage}
  <AppToast message={toastMessage} tone={toastTone} onDismiss={dismissToast} />
{/if}

<div
  id="affirmation-library-panel"
  class="set-section"
  role="tabpanel"
  aria-labelledby={`library-tab-${selectedLibraryTab}`}
>
  <div class="library-content">
    {#if selectedLibraryTab === "included"}
    <div
      id="affirmation-set-list"
      class="panel set-list included-list"
      aria-label="Featured affirmations"
    >
      {#each sets as set, index}
        <div
          class:active={selected.id === set.id}
          class="set-row"
        >
          <button
            class="set-row-main"
            type="button"
            aria-pressed={selected.id === set.id}
            title={displayAffirmationText(set.affirmation)}
            onclick={() => selectSet(index)}
          >
            <span class="set-copy">
              <strong>{displayAffirmationText(set.affirmation)}</strong>
            </span>
          </button>
          <button
            class:active={favoriteIdSet.has(set.id)}
            class="row-action favorite-button"
            type="button"
            aria-label={favoriteIdSet.has(set.id)
              ? `Remove ${displayAffirmationText(set.affirmation)} from favorites`
              : `Add ${displayAffirmationText(set.affirmation)} to favorites`}
            aria-pressed={favoriteIdSet.has(set.id)}
            disabled={libraryState.busy === "favorite"}
            title={isOffline ? "Save this change now and sync it later" : undefined}
            onclick={() => toggleFavorite(set.id)}
          >
            <Icon name="heart" size="small" weight={favoriteIdSet.has(set.id) ? "fill" : "regular"} />
          </button>
        </div>
      {/each}
    </div>
  {:else if !libraryState.user}
    <div class="panel auth-gate">
      <span class="empty-library-mark" aria-hidden="true">
        <Icon name={selectedLibraryTab === "favorites" ? "heart" : "waveform"} size="prominent" weight="duotone" />
      </span>
      <strong>Keep your affirmations with you</strong>
      <small>Sign in to sync favorites and create your own affirmations.</small>
      <button class="primary-action" type="button" onclick={onSignIn}>
        <Icon name="github" weight="fill" />
        <span>Sign in with GitHub</span>
      </button>
    </div>
  {:else if selectedLibraryTab === "favorites"}
    {#if favoriteSets.length > 0}
      <div class="panel set-list" aria-label="Favorite affirmations">
        {#each favoriteSets as set}
          <div
            class:active={selected.id === set.id}
            class="set-row"
          >
            <button
              class="set-row-main"
              type="button"
              aria-pressed={selected.id === set.id}
              disabled={!canPlayFavorite(set)}
              title={!canPlayFavorite(set)
                ? "Glow is saving this audio to the device"
                : displayAffirmationText(set.affirmation)}
              onclick={() => {
                if (canPlayFavorite(set)) {
                  void loadTrack(set, "favorites", selectedCategory, set.isCustom, true);
                }
              }}
            >
              <span class="set-copy">
                <strong>{displayAffirmationText(set.affirmation)}</strong>
              </span>
            </button>
            <button
              class="row-action favorite-button active"
              type="button"
              aria-label={`Remove ${displayAffirmationText(set.affirmation)} from favorites`}
              aria-pressed="true"
              disabled={libraryState.busy === "favorite"}
              title={isOffline ? "Save this change now and sync it later" : undefined}
              onclick={() => toggleFavorite(set.id)}
            >
              <Icon name="heart" size="small" weight="fill" />
            </button>
          </div>
        {/each}
      </div>
    {:else}
      <div class="panel empty-library">
        <span class="empty-library-mark" aria-hidden="true">
          <Icon name="heart" size="prominent" weight="duotone" />
        </span>
        <strong>No favorite affirmations yet</strong>
      </div>
    {/if}
  {:else if libraryState.entitlement === "free"}
    <div class="panel auth-gate premium-gate">
      <span class="empty-library-mark" aria-hidden="true">
        <Icon name="waveform" size="prominent" weight="duotone" />
      </span>
      <strong>Make it personal</strong>
    </div>
  {:else if libraryState.entitlement === "unavailable"}
    <div class="panel auth-gate">
      <span class="empty-library-mark" aria-hidden="true">
        <Icon name="waveform" size="prominent" weight="duotone" />
      </span>
      <strong>Plan unavailable</strong>
      <small>Reconnect and refresh Glow to confirm your plan.</small>
      <button
        class="primary-action"
        type="button"
        onclick={() => hostApi.postMessage({ type: "refreshLibrary" })}
      >
        <span>Refresh</span>
      </button>
    </div>
  {:else}
    {#if customWorkflow === "compose"}
      <form
        class="panel custom-form custom-workflow"
        aria-busy={isCreating}
        onsubmit={generateCustom}
        in:customWorkflowIn
        out:customWorkflowOut
      >
        <div class="custom-workflow-heading">
          <span>YOUR AFFIRMATION</span>
          <strong>What do you want to reinforce?</strong>
        </div>
        <div class="custom-input-field">
          <input
            bind:this={customInput}
            bind:value={customText}
            maxlength={CUSTOM_AFFIRMATION_LIMIT}
            placeholder="Write your affirmation"
            aria-label="Affirmation"
            aria-describedby={customCharactersRemaining <= 33 ? "affirmation-character-count" : undefined}
            required
            disabled={isCreating}
          />
          {#if customCharactersRemaining <= 33}
            <small id="affirmation-character-count" class="character-count">
              {customCharactersRemaining} left
            </small>
          {/if}
        </div>
        <div class="custom-form-actions">
          <button
            class="secondary-action"
            type="button"
            aria-label="Cancel affirmation"
            title="Cancel"
            disabled={isCreating}
            onclick={closeCustomComposer}
          >
            <span class="custom-action-icon" aria-hidden="true">
              <Icon name="close" weight="bold" />
            </span>
            <span class="custom-action-label">Cancel</span>
          </button>
          <button
            class="primary-action"
            type="submit"
            aria-label={createActionLabel}
            disabled={!serverReady || isCreating || !customTitle || !customText.trim()}
            title={createActionLabel}
          >
            {#if isCreating}
              <LoadingSpinner />
            {:else}
              <span class="custom-action-icon" aria-hidden="true">
                <Icon name="sparkles" weight="bold" />
              </span>
            {/if}
            <span class="custom-action-label">{createActionLabel}</span>
          </button>
        </div>
      </form>
    {:else if customWorkflow === "generating"}
      <div class="panel custom-workflow custom-generation-state" aria-live="polite">
        <div class="custom-workflow-heading">
          <span>YOUR AFFIRMATION</span>
          <strong>{generatingAffirmationText}</strong>
        </div>
        <div class="custom-generation-progress">
          <LoadingSpinner size="small" />
          <strong>Creating affirmation</strong>
        </div>
      </div>
    {:else if (customWorkflow === "choosing" || customWorkflow === "selecting") && activeCandidateSet}
      <div
        class="panel custom-workflow candidate-chooser"
        aria-busy={customWorkflow === "selecting"}
      >
        <div class="custom-workflow-heading">
          <span>YOUR AFFIRMATION</span>
          <strong>{displayAffirmationText(activeCandidateSet.title)}</strong>
        </div>
        <div class="candidate-options">
          {#each activeCandidateSet.candidates as candidate}
            <div
              class:selected={selectedCandidateId === candidate.id}
              class="candidate-option"
            >
              <button
                class:playing={playingCandidateId === candidate.id}
                class="candidate-preview"
                type="button"
                disabled={customWorkflow === "selecting"}
                aria-label={`${playingCandidateId === candidate.id ? "Stop" : "Play"} recording ${candidateLabel(candidate.index)}`}
                aria-pressed={playingCandidateId === candidate.id}
                onclick={() => toggleCandidatePreview(candidate.id)}
              >
                <span class="candidate-play-icon">
                  <Icon
                    name={playingCandidateId === candidate.id ? "stop" : "play"}
                    size="small"
                    weight="fill"
                  />
                </span>
                <span class="candidate-copy">
                  <strong>{candidateLabel(candidate.index)}</strong>
                  <small>{formatCandidateDuration(candidate.durationMs)}</small>
                </span>
              </button>
              <button
                class:saving={customWorkflow === "selecting" && selectedCandidateId === candidate.id}
                class="candidate-use"
                type="button"
                disabled={customWorkflow === "selecting"}
                aria-label={`Choose recording ${candidateLabel(candidate.index)}`}
                title={`Choose recording ${candidateLabel(candidate.index)}`}
                onclick={() => selectCandidate(candidate.id)}
              >
                {#if customWorkflow === "selecting" && selectedCandidateId === candidate.id}
                  <LoadingSpinner size="small" />
                  <span>Saving…</span>
                {:else}
                  <Icon name="check" size="small" weight="bold" />
                  <span>Choose</span>
                {/if}
              </button>
            </div>
          {/each}
        </div>
        <button
          class="candidate-cancel"
          type="button"
          disabled={customWorkflow === "selecting"}
          onclick={cancelCandidateChoice}
        >
          <Icon name="back" size="small" />
          <span>Go back</span>
        </button>
      </div>
    {:else}
      <div
        class="panel custom-library"
        in:customWorkflowIn
        out:customWorkflowOut
      >
        {#if customSets.length > 0}
        <div
          bind:this={customListElement}
          class:settling={customListMotionActive}
          class="set-list custom-list"
          aria-label="Custom affirmations"
        >
          {#each customSets as set (set.id)}
            <div
              class="set-row-motion"
              animate:listReorder
              out:listItemOut
            >
              <div
                class:active={selected.id === set.id}
                class="set-row"
              >
                <button
                  class="set-row-main"
                  type="button"
                  aria-pressed={selected.id === set.id}
                  disabled={!canPlayCustom(set)}
                  title={!canPlayCustom(set)
                    ? "Glow is saving this audio to the device"
                    : displayAffirmationText(set.affirmation)}
                  onclick={() => {
                    if (canPlayCustom(set)) {
                      void loadTrack(set, "custom", selectedCategory, true, true);
                    }
                  }}
                >
                  <span class="set-copy">
                    <strong>{displayAffirmationText(set.affirmation)}</strong>
                  </span>
                </button>
                <button
                  id={`custom-menu-button-${set.id}`}
                  class:active={customMenuTrackId === set.id}
                  class="row-action custom-menu-button"
                  type="button"
                  aria-label={`Open actions for ${displayAffirmationText(set.affirmation)}`}
                  aria-haspopup="menu"
                  aria-expanded={customMenuTrackId === set.id}
                  data-custom-menu
                  onclick={(event) => toggleCustomMenu(set, event)}
                >
                  <Icon name="more" size="small" weight={customMenuTrackId === set.id ? "bold" : "regular"} />
                </button>
              </div>
            </div>
          {/each}
        </div>
        {:else}
          <div class="empty-library custom-empty">
            <span class="empty-library-mark" aria-hidden="true">
              <Icon name="waveform" size="prominent" weight="duotone" />
            </span>
            <strong>No custom affirmations yet</strong>
            <small>Create an affirmation in your own words.</small>
          </div>
        {/if}

        <div class="custom-action-footer visible">
          <div class="custom-action-footer-content">
            <button
              class="primary-action make-affirmation-action"
              type="button"
              aria-label={makeAffirmationLabel}
              title={makeAffirmationLabel}
              disabled={!serverReady}
              onclick={openCustomComposer}
            >
              <Icon name="plus" weight="bold" />
            </button>
          </div>
        </div>
      </div>
    {/if}
    {/if}
  </div>

  {#if libraryState.entitlement === "signed_out" || libraryState.entitlement === "free"}
    <aside class="panel lifetime-offer" aria-label="Glow Premium lifetime offer">
      <strong>Glow Premium for life</strong>
      {#if libraryState.checkoutPending && libraryState.user}
        <div class="checkout-actions">
          <button
            class="primary-action"
            type="button"
            disabled={libraryState.busy === "confirmCheckout" || libraryState.busy === "checkout"}
            onclick={confirmPremium}
          >
            <span>
              {libraryState.busy === "confirmCheckout"
                ? "Confirming payment..."
                : "I've completed checkout"}
            </span>
          </button>
          <button
            class="checkout-link"
            type="button"
            disabled={libraryState.busy === "checkout" || libraryState.busy === "confirmCheckout"}
            onclick={reopenPremium}
          >
            {libraryState.busy === "checkout" ? "Opening checkout..." : "Open checkout again"}
          </button>
        </div>
      {:else}
        <button
          class="primary-action"
          type="button"
          disabled={libraryState.busy === "checkout"}
          onclick={openPremium}
        >
          <span>
            {libraryState.busy === "checkout"
              ? "Opening secure checkout..."
              : "Get it — $12 once"}
          </span>
        </button>
      {/if}

      {#if !libraryState.user}
        <button class="checkout-link lifetime-sign-in" type="button" onclick={onSignIn}>
          Already purchased? Sign in
        </button>
      {/if}
    </aside>
  {/if}
</div>
</div>

{#if customMenuTrack}
  {#key customMenuTrack.id}
  <div
    bind:this={customMenuElement}
    class="custom-row-menu"
    role="menu"
    aria-label={`Actions for ${displayAffirmationText(customMenuTrack.affirmation)}`}
    data-custom-menu
    style={`top: ${customMenuPosition.top}px; left: ${customMenuPosition.left}px; transform-origin: ${customMenuPlacement === "below" ? "top" : "bottom"} right;`}
    in:popoverIn={{ placement: customMenuPlacement }}
    out:popoverOut={{ placement: customMenuPlacement }}
  >
    <button
      class:active={favoriteIdSet.has(customMenuTrack.id)}
      type="button"
      role="menuitem"
      disabled={libraryState.busy === "favorite" || isRegenerating}
      onclick={() => toggleCustomFavorite(customMenuTrack)}
    >
      <Icon name="heart" size="small" weight={favoriteIdSet.has(customMenuTrack.id) ? "fill" : "regular"} />
      <span>{favoriteIdSet.has(customMenuTrack.id) ? "Remove from Favorites" : "Favorite"}</span>
    </button>
    <button
      type="button"
      role="menuitem"
      disabled={!serverReady || isCreating || isRegenerating || !customMenuTrack.offlineReady}
      title={!serverReady
        ? "Connect to regenerate this affirmation"
        : !customMenuTrack.offlineReady
          ? "Wait for this audio to finish saving"
          : "Regenerate"}
      onclick={() => regenerateCustomFromMenu(customMenuTrack)}
    >
      <Icon name="regenerate" size="small" />
      <span>{isRegenerating && pendingRegenerationAffirmationId === customMenuTrack.id ? "Regenerating…" : "Regenerate"}</span>
    </button>
    <button
      class="custom-menu-danger"
      type="button"
      role="menuitem"
      disabled={libraryState.busy === "delete" || isRegenerating}
      title={isOffline ? "Delete now and sync this change later" : undefined}
      onclick={() => deleteCustomFromMenu(customMenuTrack)}
    >
      <Icon name="trash" size="small" />
      <span>Delete</span>
    </button>
  </div>
  {/key}
{/if}

<style>
  .affirm-view {
    display: flex;
    min-height: 0;
    flex: 1 1 auto;
    flex-direction: column;
    overflow: hidden;
  }

  .player-cards {
    display: grid;
    flex: 0 0 auto;
    gap: var(--sol-space-5);
    transition: gap var(--sol-motion-state) var(--sol-motion-ease);
  }

  .affirmation-card {
    display: flex;
    min-height: clamp(104px, 24vw, 170px);
    flex-direction: column;
    align-items: stretch;
    justify-content: center;
    gap: var(--sol-space-6);
    padding: clamp(var(--sol-space-6), 5.5vw, var(--sol-space-10));
    box-shadow: none;
    transition:
      min-height var(--sol-motion-state) var(--sol-motion-ease),
      gap var(--sol-motion-state) var(--sol-motion-ease),
      padding var(--sol-motion-state) var(--sol-motion-ease),
      background-color var(--sol-motion-state) var(--sol-motion-ease),
      border-color var(--sol-motion-state) var(--sol-motion-ease);
  }

  .affirmation {
    width: 100%;
    margin: 0;
    padding-bottom: 0.12em;
    overflow-wrap: anywhere;
    text-wrap: balance;
    white-space: pre-line;
    font-family: var(--sol-font-display);
    font-size: clamp(32px, 8vw, 60px);
    font-variation-settings: "SOFT" 64, "WONK" 1, "opsz" 72;
    font-weight: var(--sol-weight-regular);
    line-height: 1.04;
    letter-spacing: -0.025em;
    transition:
      font-size var(--sol-motion-state) var(--sol-motion-ease),
      line-height var(--sol-motion-state) var(--sol-motion-ease);
    animation: sol-content-enter var(--sol-motion-state) var(--sol-motion-ease);
  }

  .affirmation-copy-frame {
    width: 100%;
    flex: 0 0 auto;
    overflow: hidden;
    transition: height var(--sol-motion-state) var(--sol-motion-ease);
  }

  .affirmation-copy-measure {
    width: 100%;
  }

  .playback-card {
    flex: 0 0 auto;
  }

  .audio-visualizer {
    display: block;
    width: 100%;
    height: clamp(34px, 8vw, 50px);
    margin-top: 0;
    overflow: hidden;
    transition: height var(--sol-motion-state) var(--sol-motion-ease);
  }

  .audio-controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: clamp(var(--sol-space-3), 4vw, var(--sol-space-6));
    transition: gap var(--sol-motion-state) var(--sol-motion-ease);
  }

  .transport-button {
    width: clamp(42px, 10vw, 58px);
    height: clamp(42px, 10vw, 58px);
    overflow: hidden;
    border-radius: var(--sol-radius-control);
    opacity: 1;
    visibility: visible;
    transition:
      width var(--sol-motion-state) var(--sol-motion-ease),
      color var(--sol-motion-feedback) var(--sol-motion-ease),
      background-color var(--sol-motion-feedback) var(--sol-motion-ease),
      border-color var(--sol-motion-feedback) var(--sol-motion-ease),
      opacity var(--sol-motion-feedback) var(--sol-motion-ease),
      transform var(--sol-motion-state) var(--sol-motion-ease),
      visibility 0s linear 0s;
  }

  .play-button {
    display: grid;
    width: clamp(58px, 14vw, 80px);
    height: clamp(58px, 14vw, 80px);
    place-items: center;
    padding: 0 0 0 2px;
    border: 1px solid var(--sol-accent);
    border-radius: 50%;
    color: var(--sol-button-fg);
    background: var(--sol-accent);
    box-shadow: none;
    cursor: pointer;
    transition:
      width var(--sol-motion-state) var(--sol-motion-ease),
      height var(--sol-motion-state) var(--sol-motion-ease),
      color var(--sol-motion-feedback) var(--sol-motion-ease),
      background-color var(--sol-motion-feedback) var(--sol-motion-ease),
      border-color var(--sol-motion-feedback) var(--sol-motion-ease),
      opacity var(--sol-motion-feedback) var(--sol-motion-ease),
      transform var(--sol-motion-press) var(--sol-motion-ease);
  }

  .play-button:hover:not(:disabled) {
    border-color: var(--sol-accent-hover);
    background: var(--sol-accent-hover);
  }

  .play-button.loading {
    padding-left: 0;
  }

  .play-button:not(:disabled):active,
  .transport-button:not(:disabled):active {
    transform: scale(var(--sol-press-scale));
  }

  .play-state-icon {
    display: grid;
    place-items: center;
    animation: sol-icon-enter var(--sol-motion-feedback) var(--sol-motion-ease);
  }

  .play-button:disabled {
    cursor: wait;
    opacity: 0.82;
  }

  .transport-button:disabled {
    cursor: wait;
    opacity: 0.5;
  }

  .library-tabs {
    display: grid;
    flex: 0 0 auto;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--sol-space-1);
    margin-top: var(--sol-space-6);
    overflow: hidden;
    padding: var(--sol-space-1);
    box-shadow: none;
    transition:
      margin-top var(--sol-motion-state) var(--sol-motion-ease),
      padding var(--sol-motion-state) var(--sol-motion-ease),
      background-color var(--sol-motion-state) var(--sol-motion-ease),
      border-color var(--sol-motion-state) var(--sol-motion-ease),
      box-shadow var(--sol-motion-state) var(--sol-motion-ease);
  }

  .library-tab-indicator {
    grid-column: 1;
    grid-row: 1;
    z-index: 0;
    border-radius: var(--sol-radius-nested);
    background: var(--sol-accent);
    box-shadow: 0 8px 20px color-mix(in srgb, var(--sol-accent) 24%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.28);
    pointer-events: none;
    transform: translateX(0);
    transition:
      transform var(--sol-motion-enter) var(--sol-motion-ease),
      background-color var(--sol-motion-state) var(--sol-motion-ease),
      box-shadow var(--sol-motion-state) var(--sol-motion-ease);
  }

  .library-tab-indicator[data-selected="favorites"] {
    transform: translateX(calc(100% + var(--sol-space-1)));
  }

  .library-tab-indicator[data-selected="custom"] {
    transform: translateX(calc(200% + var(--sol-space-1) + var(--sol-space-1)));
  }

  .library-tab {
    display: grid;
    z-index: 1;
    min-width: 0;
    min-height: clamp(38px, 9vw, 46px);
    place-items: center;
    padding: var(--sol-space-2);
    border: 0;
    border-radius: var(--sol-radius-nested);
    color: var(--sol-muted);
    background: transparent;
    font-family: var(--sol-font-ui);
    font-size: var(--sol-type-label);
    font-weight: var(--sol-weight-semibold);
    line-height: var(--sol-leading-snug);
    letter-spacing: 0;
    cursor: pointer;
    transition:
      min-height var(--sol-motion-state) var(--sol-motion-ease),
      padding var(--sol-motion-state) var(--sol-motion-ease),
      color var(--sol-motion-feedback) var(--sol-motion-ease),
      background-color var(--sol-motion-feedback) var(--sol-motion-ease),
      box-shadow var(--sol-motion-state) var(--sol-motion-ease),
      opacity var(--sol-motion-feedback) var(--sol-motion-ease),
      transform var(--sol-motion-press) var(--sol-motion-ease);
  }

  .library-tab-icon {
    display: grid;
    grid-area: 1 / 1;
    place-items: center;
    opacity: 0;
    transform: scale(0.82);
    visibility: hidden;
    transition:
      opacity var(--sol-motion-feedback) var(--sol-motion-ease),
      transform var(--sol-motion-state) var(--sol-motion-ease),
      visibility 0s linear var(--sol-motion-state);
  }

  .library-tab-label {
    grid-area: 1 / 1;
    opacity: 1;
    transform: scale(1);
    visibility: visible;
    transition:
      opacity var(--sol-motion-feedback) var(--sol-motion-ease),
      transform var(--sol-motion-state) var(--sol-motion-ease),
      visibility 0s linear 0s;
  }

  .library-tab:hover:not(.active) {
    color: var(--sol-text);
    background: var(--sol-control-hover);
  }

  .library-tab.active {
    color: var(--sol-button-fg);
    background: transparent;
    box-shadow: none;
  }

  .library-tab:not(:disabled):active {
    transform: scale(var(--sol-press-scale));
  }

  .set-section {
    --custom-fab-size: clamp(48px, 12vw, 54px);
    position: relative;
    display: flex;
    min-height: 0;
    flex: 1 1 auto;
    flex-direction: column;
    margin-top: var(--sol-space-3);
    overflow: hidden;
    transition: margin-top var(--sol-motion-state) var(--sol-motion-ease);
  }

  .library-content {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    min-height: 0;
    flex: 1 1 auto;
  }

  .library-content > .panel {
    grid-area: 1 / 1;
    min-width: 0;
  }

  .set-list {
    --sol-list-gutter: var(--sol-space-1);
    min-height: 0;
    flex: 1 1 auto;
    padding: var(--sol-list-gutter);
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: none;
  }

  .set-list::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
  }

  .empty-library {
    display: grid;
    min-height: 150px;
    place-items: center;
    align-content: center;
    gap: var(--sol-space-2);
    padding: var(--sol-space-6);
    text-align: center;
  }

  .auth-gate {
    display: grid;
    min-height: 190px;
    place-items: center;
    align-content: center;
    gap: var(--sol-space-2);
    padding: var(--sol-space-6) var(--sol-space-5);
    text-align: center;
  }

  .auth-gate strong {
    font-family: var(--sol-font-ui);
    font-size: var(--sol-type-heading);
    font-weight: var(--sol-weight-semibold);
    line-height: var(--sol-leading-snug);
  }

  .auth-gate small {
    max-width: 310px;
    color: var(--sol-muted);
    font-family: var(--sol-font-ui);
    font-size: var(--sol-type-label);
    line-height: var(--sol-leading-body);
  }

  .primary-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--sol-space-2);
    min-height: 38px;
    padding: var(--sol-space-2) var(--sol-space-4);
    border: 1px solid var(--sol-accent);
    border-radius: var(--sol-radius-control);
    color: var(--sol-button-fg);
    background: var(--sol-accent);
    font-family: var(--sol-font-ui);
    font-size: var(--sol-type-label);
    font-weight: var(--sol-weight-bold);
    line-height: var(--sol-leading-snug);
    cursor: pointer;
  }

  .primary-action:hover:not(:disabled) {
    background: var(--sol-accent-hover);
  }

  .primary-action:active:not(:disabled),
  .secondary-action:active:not(:disabled) {
    transform: scale(var(--sol-press-scale));
  }

  .primary-action:disabled,
  .row-action:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .checkout-actions {
    display: grid;
    justify-items: center;
    gap: var(--sol-space-1);
  }

  .lifetime-offer {
    display: grid;
    min-width: 0;
    flex: 0 0 auto;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--sol-space-2) var(--sol-space-3);
    margin-top: var(--sol-space-2);
    padding: var(--sol-space-3);
    border-color: color-mix(in srgb, var(--sol-accent) 44%, var(--sol-border));
    background: color-mix(in srgb, var(--sol-accent) 7%, var(--sol-panel));
  }

  .lifetime-offer > strong {
    min-width: 0;
    color: var(--sol-text);
    font-family: var(--sol-font-ui);
    font-size: var(--sol-type-label);
    font-weight: var(--sol-weight-semibold);
    line-height: var(--sol-leading-snug);
  }

  .lifetime-offer > .primary-action {
    min-height: 34px;
    padding: var(--sol-space-2) var(--sol-space-3);
    white-space: nowrap;
  }

  .lifetime-offer > .checkout-actions {
    justify-items: end;
  }

  .lifetime-sign-in {
    grid-column: 1 / -1;
    justify-self: end;
  }

  .checkout-link {
    min-height: 28px;
    padding: var(--sol-space-1) var(--sol-space-2);
    border: 0;
    color: var(--sol-muted);
    background: transparent;
    font-family: var(--sol-font-ui);
    font-size: var(--sol-type-label);
    line-height: var(--sol-leading-snug);
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }

  .checkout-link:hover:not(:disabled) {
    color: var(--sol-fg);
  }

  .checkout-link:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .custom-form {
    display: grid;
    flex: 0 0 auto;
    gap: var(--sol-space-3);
    padding: clamp(var(--sol-space-4), 4vw, var(--sol-space-6));
    opacity: 0;
    transform: translateY(6px) scale(0.985);
    transform-origin: top center;
    transition:
      padding var(--sol-motion-state) var(--sol-motion-ease),
      background-color var(--sol-motion-state) var(--sol-motion-ease),
      border-color var(--sol-motion-state) var(--sol-motion-ease),
      box-shadow var(--sol-motion-state) var(--sol-motion-ease),
      opacity var(--sol-motion-enter) var(--sol-motion-ease),
      transform var(--sol-motion-enter) var(--sol-motion-ease);
  }

  .custom-form-actions {
    display: grid;
    grid-template-columns: minmax(82px, 0.7fr) minmax(0, 1.3fr);
    gap: var(--sol-space-2);
  }

  .custom-form-actions button {
    position: relative;
  }

  .custom-action-icon {
    position: absolute;
    display: inline-grid;
    place-items: center;
    opacity: 0;
    transform: scale(0.82);
    visibility: hidden;
    transition:
      opacity var(--sol-motion-feedback) var(--sol-motion-ease),
      transform var(--sol-motion-state) var(--sol-motion-ease),
      visibility 0s linear var(--sol-motion-state);
  }

  .custom-action-label {
    opacity: 1;
    transform: scale(1);
    visibility: visible;
    transition:
      opacity var(--sol-motion-feedback) var(--sol-motion-ease),
      transform var(--sol-motion-state) var(--sol-motion-ease),
      visibility 0s linear 0s;
  }

  .secondary-action {
    min-height: 38px;
    padding: var(--sol-space-2) var(--sol-space-3);
    border: 1px solid var(--sol-border);
    border-radius: var(--sol-radius-control);
    color: var(--sol-text);
    background: var(--sol-control-bg);
    font-family: var(--sol-font-ui);
    font-size: var(--sol-type-label);
    font-weight: var(--sol-weight-semibold);
    line-height: var(--sol-leading-snug);
    cursor: pointer;
  }

  .secondary-action:hover:not(:disabled) {
    background: var(--sol-control-hover);
  }

  .secondary-action:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .make-affirmation-action {
    width: var(--custom-fab-size);
    height: var(--custom-fab-size);
    min-height: var(--custom-fab-size);
    flex: 0 0 auto;
    padding: 0;
    border-radius: var(--sol-radius-surface);
    box-shadow: none;
  }

  .make-affirmation-action:active:not(:disabled) {
    transform: scale(var(--sol-press-scale));
  }

  @keyframes sol-fab-enter {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.9);
    }

    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .custom-input-field {
    display: grid;
    gap: var(--sol-space-1);
  }

  .custom-form .character-count {
    justify-self: end;
    color: var(--sol-muted);
    font-family: var(--sol-font-ui);
    font-size: var(--sol-type-caption);
    line-height: var(--sol-leading-snug);
    animation: sol-content-enter var(--sol-motion-state) var(--sol-motion-ease);
  }

  .custom-form input {
    width: 100%;
    padding: var(--sol-space-2) var(--sol-space-3);
    border: 1px solid var(--sol-rule);
    border-radius: var(--sol-radius-control);
    color: var(--sol-text);
    background: color-mix(in srgb, var(--sol-panel) 76%, transparent);
    font-family: var(--sol-font-ui);
    font-size: var(--sol-type-body);
    line-height: var(--sol-leading-body);
    transition:
      background-color var(--sol-motion-feedback) var(--sol-motion-ease),
      border-color var(--sol-motion-feedback) var(--sol-motion-ease),
      box-shadow var(--sol-motion-state) var(--sol-motion-ease);
  }

  .custom-form input:focus {
    border-color: var(--sol-focus);
    outline: 1px solid var(--sol-focus);
    outline-offset: -1px;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--sol-focus) 16%, transparent);
  }

  .custom-workflow {
    min-height: 0;
    flex: 1 1 auto;
    padding: clamp(var(--sol-space-4), 4vw, var(--sol-space-6));
    overflow-x: hidden;
    overflow-y: auto;
  }

  .custom-form.custom-workflow {
    align-content: start;
    opacity: 1;
    transform: none;
  }

  .custom-workflow-heading {
    display: grid;
    gap: var(--sol-space-1);
  }

  .custom-workflow-heading > span {
    color: var(--sol-accent);
    font-family: var(--sol-font-ui);
    font-size: var(--sol-type-caption);
    font-weight: var(--sol-weight-bold);
    line-height: var(--sol-leading-snug);
  }

  .custom-workflow-heading > strong {
    overflow-wrap: anywhere;
    color: var(--sol-text);
    font-family: var(--sol-font-ui);
    font-size: var(--sol-type-heading);
    font-weight: var(--sol-weight-semibold);
    line-height: var(--sol-leading-snug);
  }

  .custom-generation-state {
    display: flex;
    align-items: stretch;
    flex-direction: column;
    gap: var(--sol-space-6);
  }

  .custom-generation-progress {
    display: flex;
    align-items: center;
    gap: var(--sol-space-2);
    color: var(--sol-muted);
  }

  .custom-generation-progress strong {
    font-family: var(--sol-font-ui);
    font-size: var(--sol-type-label);
    font-weight: var(--sol-weight-semibold);
    line-height: var(--sol-leading-snug);
  }

  .candidate-chooser {
    display: flex;
    flex-direction: column;
    gap: var(--sol-space-4);
  }

  .candidate-options {
    display: grid;
    gap: var(--sol-space-2);
  }

  .candidate-option {
    display: grid;
    min-height: 54px;
    grid-template-columns: minmax(0, 1fr) auto;
    border: 1px solid var(--sol-border);
    border-radius: var(--sol-radius-nested);
    background: var(--sol-control-bg);
    overflow: hidden;
    transition:
      background-color var(--sol-motion-feedback) var(--sol-motion-ease),
      border-color var(--sol-motion-feedback) var(--sol-motion-ease);
  }

  .candidate-option:hover {
    border-color: color-mix(in srgb, var(--sol-row-active-border) 64%, var(--sol-border));
  }

  .candidate-option.selected {
    border-color: var(--sol-row-active-border);
    background: var(--sol-row-active);
  }

  .candidate-preview,
  .candidate-use,
  .candidate-cancel {
    border: 0;
    color: var(--sol-text);
    background: transparent;
    font-family: var(--sol-font-ui);
    cursor: pointer;
  }

  .candidate-preview {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: var(--sol-space-3);
    padding: var(--sol-space-2) var(--sol-space-3);
    border-radius: var(--sol-radius-nested) 0 0 var(--sol-radius-nested);
    text-align: left;
    transition: background-color var(--sol-motion-feedback) var(--sol-motion-ease);
  }

  .candidate-preview:hover:not(:disabled),
  .candidate-preview.playing {
    background: var(--sol-control-hover);
  }

  .candidate-play-icon {
    display: grid;
    width: 28px;
    height: 28px;
    flex: 0 0 auto;
    place-items: center;
    border-radius: 50%;
    color: var(--sol-button-fg);
    background: var(--sol-accent);
  }

  .candidate-copy {
    display: grid;
    min-width: 0;
    gap: 2px;
  }

  .candidate-copy strong {
    font-size: var(--sol-type-body);
    font-weight: var(--sol-weight-semibold);
    line-height: var(--sol-leading-snug);
  }

  .candidate-copy small {
    color: var(--sol-muted);
    font-size: var(--sol-type-caption);
    line-height: var(--sol-leading-snug);
  }

  .candidate-use {
    display: inline-flex;
    min-width: 82px;
    align-items: center;
    justify-content: center;
    gap: var(--sol-space-1);
    padding: var(--sol-space-2) var(--sol-space-3);
    place-items: center;
    border-left: 1px solid var(--sol-border);
    border-radius: 0 var(--sol-radius-nested) var(--sol-radius-nested) 0;
    color: var(--sol-muted);
    font-size: var(--sol-type-label);
    font-weight: var(--sol-weight-semibold);
  }

  .candidate-use:hover:not(:disabled) {
    color: var(--sol-accent);
    background: var(--sol-control-hover);
  }

  .candidate-cancel {
    display: inline-flex;
    align-self: flex-start;
    min-height: 32px;
    align-items: center;
    gap: var(--sol-space-1);
    padding: var(--sol-space-1) var(--sol-space-2);
    border-radius: var(--sol-radius-control);
    color: var(--sol-muted);
    font-size: var(--sol-type-label);
    font-weight: var(--sol-weight-medium);
  }

  .candidate-cancel:hover:not(:disabled) {
    color: var(--sol-text);
    background: var(--sol-control-hover);
  }

  .candidate-preview:disabled,
  .candidate-use:disabled,
  .candidate-cancel:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .candidate-use.saving:disabled {
    color: var(--sol-text);
    opacity: 1;
  }

  .custom-library {
    display: flex;
    min-height: 0;
    flex: 1 1 auto;
    flex-direction: column;
    overflow: hidden;
  }

  .custom-list {
    padding-bottom: var(--sol-space-3);
    scroll-padding-bottom: var(--sol-space-3);
  }

  .custom-empty {
    min-height: 0;
    flex: 1 1 auto;
  }

  .custom-action-footer {
    display: grid;
    flex: 0 0 auto;
    grid-template-rows: 0fr;
    opacity: 0;
    pointer-events: none;
    visibility: hidden;
    background: linear-gradient(
      to bottom,
      transparent,
      color-mix(in srgb, var(--sol-panel) 38%, transparent)
    );
    transition:
      grid-template-rows var(--sol-motion-enter) var(--sol-motion-ease),
      opacity var(--sol-motion-feedback) var(--sol-motion-ease),
      visibility 0s linear var(--sol-motion-enter);
  }

  .custom-action-footer.visible {
    grid-template-rows: 1fr;
    opacity: 1;
    pointer-events: auto;
    visibility: visible;
    transition:
      grid-template-rows var(--sol-motion-enter) var(--sol-motion-ease),
      opacity var(--sol-motion-feedback) var(--sol-motion-ease),
      visibility 0s linear 0s;
  }

  .custom-action-footer-content {
    display: grid;
    min-height: 0;
    place-items: center;
    overflow: hidden;
    padding: 0 var(--sol-space-3);
    transition: padding var(--sol-motion-enter) var(--sol-motion-ease);
  }

  .custom-action-footer.visible .custom-action-footer-content {
    padding: var(--sol-space-2) var(--sol-space-3) var(--sol-space-3);
  }

  .custom-action-footer.visible .make-affirmation-action {
    animation: sol-fab-enter var(--sol-motion-enter) var(--sol-motion-ease);
  }

  .empty-library-mark {
    display: grid;
    width: 42px;
    height: 42px;
    margin-bottom: var(--sol-space-1);
    place-items: center;
    border: 1px solid var(--sol-border);
    border-radius: 50%;
    color: var(--sol-accent);
    background: var(--sol-control-bg);
  }

  .empty-library strong {
    font-family: var(--sol-font-ui);
    font-size: var(--sol-type-heading);
    font-weight: var(--sol-weight-semibold);
    line-height: var(--sol-leading-snug);
  }

  .empty-library small {
    color: var(--sol-muted);
    font-family: var(--sol-font-ui);
    font-size: var(--sol-type-label);
    line-height: var(--sol-leading-body);
  }

  .set-row {
    position: relative;
    isolation: isolate;
    display: grid;
    width: 100%;
    grid-template-columns: minmax(0, 1fr) clamp(38px, 9vw, 48px);
    align-items: center;
    border: 0;
    border-radius: var(--sol-radius-nested);
    color: var(--sol-text);
    background-color: var(--sol-row-bg);
    transform-origin: center;
    transition:
      grid-template-columns var(--sol-motion-state) var(--sol-motion-ease),
      background-color var(--sol-motion-feedback) var(--sol-motion-ease),
      box-shadow var(--sol-motion-state) var(--sol-motion-ease),
      transform var(--sol-motion-press) var(--sol-motion-ease);
  }

  .set-row::before {
    position: absolute;
    z-index: 0;
    inset: 0;
    border-radius: inherit;
    background-color: var(--sol-row-hover);
    content: "";
    opacity: 0;
    pointer-events: none;
    transform: scale(0.985);
    transition:
      opacity var(--sol-motion-feedback) var(--sol-motion-ease),
      transform var(--sol-motion-state) var(--sol-motion-ease);
  }

  .set-row + .set-row {
    margin-top: var(--sol-list-gutter);
  }

  .set-row-motion {
    width: 100%;
  }

  .set-row-motion + .set-row-motion {
    margin-top: var(--sol-list-gutter);
  }

  .custom-list.settling .set-row:not(.active)::before {
    opacity: 0;
    transform: scale(0.985);
  }

  .custom-list.settling .set-row:not(.active) .custom-menu-button {
    opacity: 0;
    pointer-events: none;
    transform: scale(0.86);
  }

  .set-row:hover,
  .set-row:has(:focus-visible) {
    z-index: 1;
  }

  .set-row:hover::before,
  .set-row:has(:focus-visible)::before {
    opacity: 1;
    transform: scale(1);
  }

  .set-row:has(.set-row-main:active) {
    transform: scale(var(--sol-surface-press-scale));
  }

  .set-row-main {
    position: relative;
    z-index: 1;
    display: grid;
    width: 100%;
    grid-template-columns: minmax(0, 1fr);
    align-items: center;
    min-height: 56px;
    padding: var(--sol-space-3) var(--sol-space-2) var(--sol-space-3) var(--sol-space-4);
    border: 0;
    color: inherit;
    background: transparent;
    text-align: left;
    cursor: pointer;
    transition:
      padding var(--sol-motion-state) var(--sol-motion-ease),
      opacity var(--sol-motion-feedback) var(--sol-motion-ease),
      transform var(--sol-motion-press) var(--sol-motion-ease);
  }

  .set-row-main:disabled {
    cursor: not-allowed;
    opacity: 0.58;
  }

  .row-action {
    position: relative;
    z-index: 1;
    display: grid;
    width: 32px;
    height: 32px;
    place-self: center;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 50%;
    color: var(--sol-muted);
    background: transparent;
    cursor: pointer;
  }

  .row-action:hover:not(:disabled) {
    color: var(--sol-accent);
    background: var(--sol-control-hover);
  }

  .row-action:not(:disabled):active {
    transform: scale(var(--sol-press-scale));
  }

  .included-list .favorite-button:not(.active) {
    opacity: 0;
    pointer-events: none;
    transform: scale(0.86);
  }

  .included-list .set-row:hover .favorite-button:not(.active),
  .included-list .set-row:has(:focus-visible) .favorite-button:not(.active) {
    opacity: 1;
    pointer-events: auto;
    transform: scale(1);
  }

  .custom-list .custom-menu-button {
    opacity: 0;
    pointer-events: none;
    transform: scale(0.86);
  }

  .custom-list .set-row:hover .custom-menu-button,
  .custom-list .set-row:has(:focus-visible) .custom-menu-button,
  .custom-list .set-row.active .custom-menu-button {
    opacity: 1;
    pointer-events: auto;
    transform: scale(1);
  }

  .row-action :global(svg) {
    transition:
      fill var(--sol-motion-feedback) var(--sol-motion-ease),
      transform var(--sol-motion-state) var(--sol-motion-ease);
  }

  .custom-menu-button.active {
    color: var(--sol-accent);
    background: var(--sol-control-hover);
  }

  .custom-row-menu {
    position: fixed;
    z-index: 160;
    display: grid;
    width: min(190px, calc(100vw - 16px));
    gap: var(--sol-space-1);
    padding: var(--sol-space-1);
    border: 1px solid var(--sol-border);
    border-radius: var(--sol-radius-nested);
    color: var(--sol-text);
    background: var(--sol-surface);
    box-shadow: var(--sol-surface-shadow);
    -webkit-backdrop-filter: var(--sol-surface-filter);
    backdrop-filter: var(--sol-surface-filter);
    will-change: opacity, transform;
  }

  .custom-row-menu button {
    display: flex;
    min-height: 38px;
    align-items: center;
    gap: var(--sol-space-2);
    padding: var(--sol-space-2) var(--sol-space-3);
    border: 0;
    border-radius: var(--sol-radius-compact);
    color: var(--sol-text);
    background: transparent;
    font-family: var(--sol-font-ui);
    font-size: var(--sol-type-label);
    font-weight: var(--sol-weight-medium);
    line-height: var(--sol-leading-snug);
    text-align: left;
    cursor: pointer;
  }

  .custom-row-menu button:hover:not(:disabled),
  .custom-row-menu button.active {
    color: var(--sol-accent);
    background: var(--sol-control-hover);
  }

  .custom-row-menu button:active:not(:disabled) {
    transform: scale(var(--sol-surface-press-scale));
  }

  .custom-row-menu button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .custom-row-menu .custom-menu-danger:hover:not(:disabled) {
    color: var(--vscode-errorForeground, #d33f49);
  }

  .favorite-button.active {
    color: var(--sol-accent);
    opacity: 1;
    pointer-events: auto;
  }

  .favorite-button.active :global(svg) {
    animation: sol-icon-enter var(--sol-motion-state) var(--sol-motion-ease);
  }

  .set-row.active {
    z-index: 1;
    border-radius: var(--sol-radius-nested);
    background-color: var(--sol-row-active);
    box-shadow: var(--sol-row-active-shadow);
    outline: 1px solid var(--sol-row-active-border);
    outline-offset: -1px;
  }

  .set-row.active::before {
    opacity: 0;
    transform: scale(1);
  }

  .set-copy {
    display: flex;
    min-width: 0;
    align-items: center;
  }

  .set-copy strong {
    display: block;
    width: 100%;
    min-width: 0;
    overflow: hidden;
    font-family: var(--sol-font-ui);
    font-size: var(--sol-type-body);
    font-weight: var(--sol-weight-semibold);
    line-height: var(--sol-leading-snug);
    letter-spacing: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Compact sidebar: preserve the layout rhythm while replacing labels that no longer fit. */
  @media (max-width: 280px) {
    .player-cards {
      gap: var(--sol-space-4);
    }

    .library-tabs {
      margin-top: var(--sol-space-4);
    }

    .library-tab {
      min-height: 40px;
      padding: 0;
    }

    .library-tab-icon {
      opacity: 1;
      transform: scale(1);
      visibility: visible;
      transition:
        opacity var(--sol-motion-feedback) var(--sol-motion-ease),
        transform var(--sol-motion-state) var(--sol-motion-ease),
        visibility 0s linear 0s;
    }

    .library-tab-label {
      opacity: 0;
      transform: scale(0.88);
      visibility: hidden;
      transition:
        opacity var(--sol-motion-feedback) var(--sol-motion-ease),
        transform var(--sol-motion-state) var(--sol-motion-ease),
        visibility 0s linear var(--sol-motion-state);
    }

    .set-section {
      margin-top: var(--sol-space-2);
    }

    .affirmation-card {
      padding: var(--sol-space-3);
    }

    .affirmation {
      font-size: 28px;
    }

    .set-row {
      grid-template-columns: minmax(0, 1fr) 34px;
    }

    .set-row-main {
      padding-inline: var(--sol-space-2);
    }

    .custom-form {
      padding: var(--sol-space-3);
    }

    .custom-form-actions {
      width: max-content;
      grid-template-columns: repeat(2, 38px);
      justify-self: center;
    }

    .custom-form-actions button {
      display: grid;
      width: 38px;
      height: 38px;
      min-height: 38px;
      align-items: center;
      justify-items: center;
      place-items: center;
      padding: 0;
      line-height: 0;
    }

    .custom-action-icon {
      position: static;
      display: grid;
      width: var(--sol-icon-control);
      height: var(--sol-icon-control);
      opacity: 1;
      place-items: center;
      transform: scale(1);
      visibility: visible;
      transition:
        opacity var(--sol-motion-feedback) var(--sol-motion-ease),
        transform var(--sol-motion-state) var(--sol-motion-ease),
        visibility 0s linear 0s;
    }

    .custom-action-label {
      position: absolute;
      opacity: 0;
      transform: scale(0.88);
      visibility: hidden;
      transition:
        opacity var(--sol-motion-feedback) var(--sol-motion-ease),
        transform var(--sol-motion-state) var(--sol-motion-ease),
        visibility 0s linear var(--sol-motion-state);
    }
  }

  /* Compressed sidebar: prioritize the primary action and a calm, centered silhouette. */
  @media (max-width: 220px) {
    .affirmation-card {
      min-height: 112px;
      gap: var(--sol-space-3);
    }

    .affirmation {
      overflow-wrap: break-word;
      word-break: normal;
      font-size: clamp(18px, 11vw, 24px);
      line-height: 1.08;
    }

    .audio-visualizer {
      height: 28px;
    }

    .transport-button {
      width: 0;
      border-color: transparent;
      opacity: 0;
      pointer-events: none;
      transform: scale(0.82);
      visibility: hidden;
      transition:
        width var(--sol-motion-state) var(--sol-motion-ease),
        color var(--sol-motion-feedback) var(--sol-motion-ease),
        background-color var(--sol-motion-feedback) var(--sol-motion-ease),
        border-color var(--sol-motion-feedback) var(--sol-motion-ease),
        opacity var(--sol-motion-feedback) var(--sol-motion-ease),
        transform var(--sol-motion-state) var(--sol-motion-ease),
        visibility 0s linear var(--sol-motion-state);
    }

    .play-button {
      width: 58px;
      height: 58px;
    }

    .library-tabs {
      margin-top: var(--sol-space-3);
    }

    .set-row-main {
      min-height: 50px;
    }

    .set-row {
      grid-template-columns: minmax(0, 1fr);
    }

    .row-action {
      position: absolute;
      right: var(--sol-space-1);
      opacity: 0;
      pointer-events: none;
    }

    .favorite-button,
    .favorite-button.active {
      opacity: 0;
      pointer-events: none;
      transform: scale(0.82);
      visibility: hidden;
    }

    .custom-list .set-row:hover .row-action,
    .custom-list .set-row:has(:focus-visible) .row-action,
    .custom-list .set-row.active .row-action {
      opacity: 1;
      pointer-events: auto;
    }

    .custom-list .set-row:hover .set-row-main,
    .custom-list .set-row:has(:focus-visible) .set-row-main,
    .custom-list .set-row.active .set-row-main {
      padding-right: calc(34px + var(--sol-space-1));
    }

    .empty-library,
    .auth-gate {
      padding: var(--sol-space-4) var(--sol-space-3);
    }
  }

  @media (max-width: 180px) {
    .lifetime-offer {
      grid-template-columns: minmax(0, 1fr);
      text-align: center;
    }

    .lifetime-offer > .primary-action,
    .lifetime-offer > .checkout-actions {
      width: 100%;
      justify-self: stretch;
      justify-items: stretch;
    }

    .lifetime-sign-in {
      justify-self: center;
    }

    .affirmation {
      font-size: 18px;
    }
  }
</style>
