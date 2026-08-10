<script lang="ts">
  import { onMount } from "svelte";
  import AffirmView from "../components/AffirmView.svelte";
  import AuthFlowScreen from "../components/AuthFlowScreen.svelte";
  import DashboardView from "../components/DashboardView.svelte";
  import CommunityView from "../components/CommunityView.svelte";
  import OnboardingFlow from "../components/OnboardingFlow.svelte";
  import ThemePicker from "../components/ThemePicker.svelte";
  import type { SolWebviewState } from "$lib/playerState";
  import {
    clampVolume,
    firstVolume,
    readVolumePreference,
    validVolume,
    writeVolumePreference,
  } from "$lib/volumePreference";
  import {
    clampRepeatPauseSeconds,
    firstRepeatPauseSeconds,
    readRepeatPausePreference,
    writeRepeatPausePreference,
  } from "$lib/repeatPausePreference";
  import { BinauralAudioEngine, binauralMixBalance } from "$lib/binauralAudio";
  import {
    clampBinauralVolume,
    DEFAULT_ACTIVE_BINAURAL_VOLUME,
    firstBinauralPreset,
    firstBinauralVolume,
    isPremiumBinauralPreset,
    readBinauralPreferences,
    writeBinauralPreferences,
    type BinauralPreset,
  } from "$lib/binauralPreference";
  import {
    ONBOARDING_COMPLETED_FOR_TESTING,
    resolveOnboardingCompleted,
  } from "$lib/onboarding";
  import {
    initialLibraryState,
    type CandidateSelectionSettledMessage,
    type CandidateSetMessage,
    type CustomAudioMessage,
    type CommunityHostApi,
    type DashboardHostApi,
    type ExtensionToWebviewMessage,
    type LibraryState,
    type PairingViewState,
    type PlayerCommandMessage,
    type SolHostApi,
  } from "$lib/host";

  const vscode = acquireVsCodeApi<SolWebviewState>() as SolHostApi;
  const dashboardHostApi = vscode as unknown as DashboardHostApi;
  const communityHostApi = vscode as unknown as CommunityHostApi;
  const dashboardMode =
    typeof document !== "undefined" &&
    document.documentElement.dataset.glowView === "dashboard";
  const communityMode =
    typeof document !== "undefined" &&
    document.documentElement.dataset.glowView === "community";
  const restoredPlayer = vscode.getState()?.player;
  const locallyStoredVolume =
    typeof localStorage === "undefined" ? null : readVolumePreference(localStorage);
  const locallyStoredRepeatPause =
    typeof localStorage === "undefined" ? null : readRepeatPausePreference(localStorage);
  const locallyStoredBinaural =
    typeof localStorage === "undefined"
      ? { volume: null, preset: null }
      : readBinauralPreferences(localStorage);
  let libraryState = $state<LibraryState>(initialLibraryState);
  let pairingState = $state<PairingViewState>({ status: "idle" });
  let audioMessage = $state<CustomAudioMessage | null>(null);
  let candidateSetMessage = $state<CandidateSetMessage | null>(null);
  let candidateSelectionMessage = $state<CandidateSelectionSettledMessage | null>(null);
  let playerCommand = $state<PlayerCommandMessage | null>(null);
  let onboardingResolved = $state(ONBOARDING_COMPLETED_FOR_TESTING !== null);
  let onboardingCompleted = $state(
    resolveOnboardingCompleted(false, ONBOARDING_COMPLETED_FOR_TESTING),
  );
  let authScreenOpen = $state(false);
  let appRevealState = $state<"hidden" | "revealing" | "settled">("hidden");
  let volume = $state(
    firstVolume(
      locallyStoredVolume,
      restoredPlayer?.version === 3 || restoredPlayer?.version === 4
        ? restoredPlayer.volume
        : undefined,
    ),
  );
  let volumeChangedInThisView = false;
  let repeatPauseSeconds = $state(
    firstRepeatPauseSeconds(
      locallyStoredRepeatPause,
      restoredPlayer?.version === 4 ? restoredPlayer.repeatPauseSeconds : undefined,
    ),
  );
  let binauralVolume = $state(
    firstBinauralVolume(
      locallyStoredBinaural.volume,
      restoredPlayer?.version === 4 ? restoredPlayer.binauralVolume : undefined,
    ),
  );
  let binauralPreset = $state<BinauralPreset>(
    firstBinauralPreset(
      locallyStoredBinaural.preset,
      restoredPlayer?.version === 4 ? restoredPlayer.binauralPreset : undefined,
    ),
  );
  let binauralEnabled = $state(false);
  let affirmationSessionActive = $state(false);
  const audioMixBalance = $derived(resolveAudioMixBalance());
  let binauralEngine: BinauralAudioEngine | undefined;
  let revealFrame: number | undefined;
  let revealTimer: ReturnType<typeof setTimeout> | undefined;

  function clearRevealSchedule(): void {
    if (revealFrame !== undefined) cancelAnimationFrame(revealFrame);
    if (revealTimer !== undefined) clearTimeout(revealTimer);
    revealFrame = undefined;
    revealTimer = undefined;
  }

  function revealApp(reducedMotion: MediaQueryList): void {
    clearRevealSchedule();
    if (document.hidden) {
      appRevealState = "hidden";
      return;
    }
    if (reducedMotion.matches) {
      appRevealState = "settled";
      return;
    }

    appRevealState = "hidden";
    revealFrame = requestAnimationFrame(() => {
      revealFrame = undefined;
      appRevealState = "revealing";
      revealTimer = setTimeout(() => {
        revealTimer = undefined;
        appRevealState = "settled";
      }, 400);
    });
  }

  function cacheVolume(nextVolume: number): void {
    writeVolumePreference(localStorage, nextVolume);
  }

  function resolveAudioMixBalance(sessionActive = affirmationSessionActive): number {
    return binauralMixBalance(
      volume,
      binauralVolume,
      binauralPreset,
      binauralEnabled && sessionActive,
    );
  }

  function applyAudioMixBalance(sessionActive = affirmationSessionActive): number {
    const balance = resolveAudioMixBalance(sessionActive);
    binauralEngine?.setMixBalance(balance);
    return balance;
  }

  function updatePlayerVolume(nextVolume: number): void {
    const state = vscode.getState();
    if (state?.player?.version !== 3 && state?.player?.version !== 4) return;
    vscode.setState({
      ...state,
      player: { ...state.player, volume: nextVolume },
    });
  }

  function handleVolumeChange(nextVolume: number): void {
    volume = clampVolume(nextVolume);
    applyAudioMixBalance();
    volumeChangedInThisView = true;
    cacheVolume(volume);
    updatePlayerVolume(volume);
    vscode.postMessage({ type: "setVolume", volume });
  }

  function handleRepeatPauseChange(nextSeconds: number): void {
    repeatPauseSeconds = clampRepeatPauseSeconds(nextSeconds);
    writeRepeatPausePreference(localStorage, repeatPauseSeconds);

    const state = vscode.getState();
    if (state?.player?.version !== 4) return;
    vscode.setState({
      ...state,
      player: { ...state.player, repeatPauseSeconds },
    });
  }

  function persistBinauralState(): void {
    writeBinauralPreferences(localStorage, binauralVolume, binauralPreset);
    const state = vscode.getState();
    if (state?.player?.version !== 4) return;
    vscode.setState({
      ...state,
      player: { ...state.player, binauralVolume, binauralPreset },
    });
  }

  function handleBinauralVolumeChange(nextVolume: number): void {
    binauralVolume = clampBinauralVolume(nextVolume);
    persistBinauralState();
    applyAudioMixBalance();
    binauralEngine?.setVolume(binauralVolume);
    if (binauralVolume === 0 && binauralEnabled) {
      binauralEnabled = false;
      binauralEngine?.setEnabled(false);
    }
  }

  function handleBinauralPresetChange(nextPreset: BinauralPreset): void {
    if (
      isPremiumBinauralPreset(nextPreset) &&
      libraryState.entitlement !== "premium"
    ) {
      vscode.postMessage({ type: "openPremium" });
      return;
    }
    binauralPreset = nextPreset;
    persistBinauralState();
    applyAudioMixBalance();
    binauralEngine?.setPreset(binauralPreset);
  }

  function handleBinauralEnabledChange(enabled: boolean): void {
    if (
      enabled &&
      isPremiumBinauralPreset(binauralPreset) &&
      libraryState.entitlement !== "premium"
    ) {
      vscode.postMessage({ type: "openPremium" });
      return;
    }
    if (enabled && binauralVolume === 0) {
      binauralVolume = DEFAULT_ACTIVE_BINAURAL_VOLUME;
      persistBinauralState();
      binauralEngine?.setVolume(binauralVolume);
    }
    binauralEnabled = enabled;
    applyAudioMixBalance();
    binauralEngine?.setEnabled(enabled);
  }

  function handlePlaybackSessionChange(active: boolean): number {
    affirmationSessionActive = active;
    return applyAudioMixBalance(active);
  }

  $effect(() => {
    binauralEngine?.setMixBalance(audioMixBalance);
  });

  onMount(() => {
    if (dashboardMode || communityMode) return;

    binauralEngine = new BinauralAudioEngine();
    binauralEngine.setPreset(binauralPreset);
    binauralEngine.setVolume(binauralVolume);
    binauralEngine.setMixBalance(audioMixBalance);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleVisibilityChange = () => revealApp(reducedMotion);
    const handleReducedMotionChange = () => revealApp(reducedMotion);
    const reportNetworkStatus = () => {
      vscode.postMessage({ type: "networkStatus", online: navigator.onLine });
    };
    const handleMessage = (event: MessageEvent<ExtensionToWebviewMessage>) => {
      if (event.data.type === "libraryState") {
        libraryState = event.data.state;
        if (event.data.state.user) {
          authScreenOpen = false;
          if (!onboardingCompleted) completeOnboarding();
        }
      } else if (event.data.type === "pairingState") {
        pairingState = event.data.state;
        if (event.data.state.status === "complete") {
          authScreenOpen = false;
          vscode.postMessage({ type: "acknowledgePairingComplete" });
        }
      } else if (event.data.type === "hostReady") {
        onboardingCompleted = resolveOnboardingCompleted(
          event.data.onboardingCompleted,
          ONBOARDING_COMPLETED_FOR_TESTING,
        );
        onboardingResolved = true;
      } else if (event.data.type === "volumePreference") {
        const persistedVolume = validVolume(event.data.volume);
        if (persistedVolume !== null && !volumeChangedInThisView) {
          volume = persistedVolume;
          applyAudioMixBalance();
          cacheVolume(volume);
          updatePlayerVolume(volume);
        }
      } else if (event.data.type === "candidateSet") {
        candidateSetMessage = event.data;
      } else if (event.data.type === "candidateSelectionSettled") {
        candidateSelectionMessage = event.data;
      } else if (event.data.type === "playerCommand") {
        playerCommand = event.data;
      } else if (
        event.data.type === "customAudioData" ||
        event.data.type === "customAudioError"
      ) {
        audioMessage = event.data;
      }
    };

    window.addEventListener("message", handleMessage);
    window.addEventListener("online", reportNetworkStatus);
    window.addEventListener("offline", reportNetworkStatus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    reducedMotion.addEventListener("change", handleReducedMotionChange);
    revealApp(reducedMotion);
    reportNetworkStatus();
    vscode.postMessage({ type: "ready", restoredVolume: volume });
    return () => {
      binauralEngine?.close();
      binauralEngine = undefined;
      clearRevealSchedule();
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("online", reportNetworkStatus);
      window.removeEventListener("offline", reportNetworkStatus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      reducedMotion.removeEventListener("change", handleReducedMotionChange);
    };
  });

  function completeOnboarding(): void {
    onboardingCompleted = true;
    vscode.postMessage({ type: "completeOnboarding" });
  }

  function openAuthScreen(): void {
    authScreenOpen = true;
    if (pairingState.status === "idle") {
      vscode.postMessage({ type: "beginPairing" });
    }
  }

  function completeOnboardingAndOpenAuth(): void {
    completeOnboarding();
    openAuthScreen();
  }

  function closeAuthScreen(): void {
    authScreenOpen = false;
  }

  function cancelAuthScreen(): void {
    pairingState = { status: "idle" };
    authScreenOpen = false;
  }

</script>

<svelte:head>
  <title>Glow</title>
  <meta name="description" content="A quiet affirmation space inside VS Code" />
</svelte:head>

{#if dashboardMode}
  <DashboardView hostApi={dashboardHostApi} />
{:else if communityMode}
  <CommunityView hostApi={communityHostApi} />
{:else}
<main
  class="sol-app"
  class:onboarding-obscured={!onboardingResolved || !onboardingCompleted || authScreenOpen}
  data-app-reveal={appRevealState}
  aria-hidden={(onboardingResolved && !onboardingCompleted) || authScreenOpen}
  inert={(onboardingResolved && !onboardingCompleted) || authScreenOpen}
>
  <ThemePicker {libraryState} hostApi={vscode} {volume} {repeatPauseSeconds} {binauralVolume} {binauralPreset} {binauralEnabled} onVolumeChange={handleVolumeChange} onRepeatPauseChange={handleRepeatPauseChange} onBinauralVolumeChange={handleBinauralVolumeChange} onBinauralPresetChange={handleBinauralPresetChange} onBinauralEnabledChange={handleBinauralEnabledChange} onSignIn={openAuthScreen} />
  <AffirmView stateApi={vscode} hostApi={vscode} {libraryState} {audioMessage} {candidateSetMessage} {candidateSelectionMessage} {playerCommand} {volume} {repeatPauseSeconds} {binauralVolume} {binauralPreset} {audioMixBalance} onPlaybackSessionChange={handlePlaybackSessionChange} onSignIn={openAuthScreen} />
</main>

{#if onboardingResolved && !onboardingCompleted && !authScreenOpen}
  <OnboardingFlow
    onComplete={completeOnboarding}
    onSignIn={completeOnboardingAndOpenAuth}
  />
{/if}

{#if authScreenOpen}
  <AuthFlowScreen
    {pairingState}
    hostApi={vscode}
    onClose={closeAuthScreen}
    onCancel={cancelAuthScreen}
  />
{/if}
{/if}

<style>
  .sol-app.onboarding-obscured {
    opacity: 0;
    pointer-events: none;
  }
</style>
