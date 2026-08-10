<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { LibraryState, SolHostApi } from "$lib/host";
  import { popoverIn, popoverOut } from "$lib/motion";
  import {
    MAX_REPEAT_PAUSE_SECONDS,
    MIN_REPEAT_PAUSE_SECONDS,
    REPEAT_PAUSE_STEP_SECONDS,
  } from "$lib/repeatPausePreference";
  import {
    BINAURAL_PRESETS,
    isPremiumBinauralPreset,
    type BinauralPreset,
    type BinauralPresetDefinition,
  } from "$lib/binauralPreference";
  import { anchoredPopoverHorizontalPosition } from "$lib/popoverPosition";
  import GlowMark from "./GlowMark.svelte";
  import Icon from "./Icon.svelte";

  type GlowTheme = "light" | "dark" | "editor";
  type ThemeIcon = "sun" | "moon";
  type EditorTheme = "light" | "dark";

  const storageKey = "glow.theme";
  const legacyStorageKey = "sol.theme";
  const themes: {
    id: GlowTheme;
    label: string;
    description: string;
    icon: ThemeIcon;
  }[] = [
    { id: "light", label: "Glow Light", description: "Warm and luminous", icon: "sun" },
    { id: "dark", label: "Glow Dark", description: "Quiet and grounded", icon: "moon" },
    {
      id: "editor",
      label: "Use theme of IDE",
      description: "Matches your IDE colors",
      icon: "moon",
    },
  ];

  let {
    libraryState,
    hostApi,
    volume,
    repeatPauseSeconds,
    binauralVolume,
    binauralPreset,
    binauralEnabled,
    onVolumeChange,
    onRepeatPauseChange,
    onBinauralVolumeChange,
    onBinauralPresetChange,
    onBinauralEnabledChange,
    onSignIn,
  }: {
    libraryState: LibraryState;
    hostApi: SolHostApi;
    volume: number;
    repeatPauseSeconds: number;
    binauralVolume: number;
    binauralPreset: BinauralPreset;
    binauralEnabled: boolean;
    onVolumeChange: (volume: number) => void;
    onRepeatPauseChange: (seconds: number) => void;
    onBinauralVolumeChange: (volume: number) => void;
    onBinauralPresetChange: (preset: BinauralPreset) => void;
    onBinauralEnabledChange: (enabled: boolean) => void;
    onSignIn: () => void;
  } = $props();

  let selectedTheme = $state<GlowTheme>("editor");
  let editorTheme = $state<EditorTheme>("dark");
  let accountMenuOpen = $state(false);
  let accountMenuStyle = $state("");
  let volumeMenuOpen = $state(false);
  let binauralMenuOpen = $state(false);
  let themeMenuOpen = $state(false);
  let accountControl = $state<HTMLDivElement>();
  let accountButton = $state<HTMLButtonElement>();
  let volumeControl: HTMLDivElement;
  let volumeButton: HTMLButtonElement;
  let binauralButton: HTMLButtonElement;
  let binauralOptions = $state<HTMLDivElement>();
  let themeControl: HTMLDivElement;
  let themeButton: HTMLButtonElement;
  let themeMenu = $state<HTMLDivElement>();
  const activeTheme = $derived(themes.find((theme) => theme.id === selectedTheme) ?? themes[2]);
  const activeThemeIcon = $derived(themeIcon(selectedTheme));
  const activeThemeDescription = $derived(
    selectedTheme === "editor"
      ? `${activeTheme.label}, currently ${editorTheme}`
      : activeTheme.label,
  );
  const volumePercent = $derived(Math.round(volume * 100));
  const binauralVolumePercent = $derived(Math.round(binauralVolume * 100));
  const volumeIcon = $derived<"volume-high" | "volume-low" | "volume-muted">(
    volume === 0 ? "volume-muted" : volume < 0.5 ? "volume-low" : "volume-high",
  );

  function isGlowTheme(value: string | null): value is GlowTheme {
    return value === "light" || value === "dark" || value === "editor";
  }

  function detectEditorTheme(): EditorTheme {
    return document.body.classList.contains("vscode-light") ||
      document.body.classList.contains("vscode-high-contrast-light")
      ? "light"
      : "dark";
  }

  function themeIcon(theme: GlowTheme): ThemeIcon {
    if (theme === "editor") return editorTheme === "light" ? "sun" : "moon";
    return theme === "light" ? "sun" : "moon";
  }

  function applyTheme(theme: GlowTheme): void {
    selectedTheme = theme;
    document.documentElement.dataset.solTheme = theme;

    try {
      localStorage.setItem(storageKey, theme);
    } catch {
      // Theme persistence is optional when storage is unavailable.
    }
  }

  function positionAccountMenu(): void {
    if (!accountButton) return;
    const buttonBounds = accountButton.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const { left, width } = anchoredPopoverHorizontalPosition(
      buttonBounds.right,
      viewportWidth,
    );
    const top = buttonBounds.bottom + 8;
    const maxHeight = Math.max(0, window.innerHeight - top - 12);
    accountMenuStyle = [
      `top: ${Math.round(top)}px`,
      `left: ${Math.round(left)}px`,
      `width: ${Math.round(width)}px`,
      `max-height: ${Math.round(maxHeight)}px`,
    ].join("; ");
  }

  function toggleAccountMenu(): void {
    volumeMenuOpen = false;
    binauralMenuOpen = false;
    themeMenuOpen = false;
    const opening = !accountMenuOpen;
    if (opening) positionAccountMenu();
    accountMenuOpen = opening;
    if (opening) void tick().then(positionAccountMenu);
  }

  function toggleVolumeMenu(): void {
    accountMenuOpen = false;
    binauralMenuOpen = false;
    themeMenuOpen = false;
    volumeMenuOpen = !volumeMenuOpen;
  }

  function toggleBinauralMenu(): void {
    accountMenuOpen = false;
    volumeMenuOpen = false;
    themeMenuOpen = false;
    binauralMenuOpen = !binauralMenuOpen;
  }

  function toggleThemeMenu(): void {
    accountMenuOpen = false;
    volumeMenuOpen = false;
    binauralMenuOpen = false;
    themeMenuOpen = !themeMenuOpen;
    if (themeMenuOpen) {
      void tick().then(() => {
        themeMenu
          ?.querySelector<HTMLButtonElement>(`[data-theme-id="${selectedTheme}"]`)
          ?.focus();
      });
    }
  }

  function chooseTheme(theme: GlowTheme): void {
    applyTheme(theme);
    themeMenuOpen = false;
    void tick().then(() => themeButton?.focus());
  }

  function handleThemeMenuKeydown(event: KeyboardEvent): void {
    const options = [
      ...(themeMenu?.querySelectorAll<HTMLButtonElement>("[data-theme-id]") ?? []),
    ];
    if (options.length === 0) return;
    const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number;

    if (event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1 + options.length) % options.length;
    } else if (event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + options.length) % options.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = options.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    options[nextIndex]?.focus();
  }

  function handleVolumeInput(event: Event): void {
    const nextVolume = (event.currentTarget as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(nextVolume)) onVolumeChange(nextVolume);
  }

  function handleBinauralVolumeInput(event: Event): void {
    const nextVolume = (event.currentTarget as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(nextVolume)) onBinauralVolumeChange(nextVolume);
  }

  function binauralPresetMeta(preset: BinauralPresetDefinition): string {
    return preset.kind === "binaural" ? `${preset.beatHz} Hz` : "Noise";
  }

  function handleBinauralOptionsKeydown(event: KeyboardEvent): void {
    const options = [
      ...(binauralOptions?.querySelectorAll<HTMLButtonElement>("[data-sound-id]") ?? []),
    ];
    if (options.length === 0) return;
    const focusedIndex = options.indexOf(document.activeElement as HTMLButtonElement);
    const selectedIndex = options.findIndex(
      (option) => option.dataset.soundId === binauralPreset,
    );
    const currentIndex = focusedIndex >= 0 ? focusedIndex : Math.max(0, selectedIndex);
    let nextIndex: number;

    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % options.length;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + options.length) % options.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = options.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const nextOption = options[nextIndex];
    if (!nextOption) return;
    onBinauralPresetChange(nextOption.dataset.soundId as BinauralPreset);
    nextOption.focus();
  }

  function adjustRepeatPause(direction: -1 | 1): void {
    onRepeatPauseChange(repeatPauseSeconds + direction * REPEAT_PAUSE_STEP_SECONDS);
  }

  function signOut(): void {
    accountMenuOpen = false;
    hostApi.postMessage({ type: "signOut" });
  }

  function openDashboard(): void {
    accountMenuOpen = false;
    hostApi.postMessage({ type: "openDashboard" });
  }

  function openCommunity(): void {
    accountMenuOpen = false;
    hostApi.postMessage({ type: "openCommunity" });
  }

  function signIn(): void {
    accountMenuOpen = false;
    onSignIn();
  }

  onMount(() => {
    let savedTheme: string | null = null;

    try {
      savedTheme = localStorage.getItem(storageKey) ?? localStorage.getItem(legacyStorageKey);
    } catch {
      // Keep the adaptive editor theme when storage is unavailable.
    }

    const migratedTheme = savedTheme === "vscode" ? "editor" : savedTheme;
    editorTheme = detectEditorTheme();
    applyTheme(isGlowTheme(migratedTheme) ? migratedTheme : "editor");

    const editorThemeObserver = new MutationObserver(() => {
      editorTheme = detectEditorTheme();
    });
    editorThemeObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });

    const handlePointerDown = (event: PointerEvent) => {
      if (
        accountMenuOpen &&
        event.target instanceof Node &&
        !accountControl?.contains(event.target)
      ) {
        accountMenuOpen = false;
      }
      if (
        (volumeMenuOpen || binauralMenuOpen) &&
        event.target instanceof Node &&
        !volumeControl.contains(event.target)
      ) {
        volumeMenuOpen = false;
        binauralMenuOpen = false;
      }
      if (
        themeMenuOpen &&
        event.target instanceof Node &&
        !themeControl.contains(event.target)
      ) {
        themeMenuOpen = false;
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (themeMenuOpen) {
        themeMenuOpen = false;
        themeButton.focus();
      } else if (volumeMenuOpen) {
        volumeMenuOpen = false;
        volumeButton.focus();
      } else if (binauralMenuOpen) {
        binauralMenuOpen = false;
        binauralButton.focus();
      } else if (accountMenuOpen) {
        accountMenuOpen = false;
        accountButton?.focus();
      }
    };
    const handleResize = () => {
      if (accountMenuOpen) positionAccountMenu();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);
    return () => {
      editorThemeObserver.disconnect();
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
    };
  });
</script>

<section class="theme-picker" aria-label="Glow toolbar">
  <div class="brand-lockup" aria-label="Glow">
    <span class="brand-mark" aria-hidden="true"><GlowMark /></span>
    <span class="brand">Glow</span>
  </div>
  <div class="toolbar-actions">
    {#if libraryState.user}
      <div class="account-control" bind:this={accountControl}>
      <button
        bind:this={accountButton}
        class:active={accountMenuOpen}
        class="toolbar-button"
        type="button"
        aria-label="Open account menu"
        aria-haspopup="menu"
        aria-expanded={accountMenuOpen}
        aria-controls="sol-account-menu"
        title={libraryState.user.username ? `@${libraryState.user.username}` : "Account"}
        onclick={toggleAccountMenu}
      >
        <Icon name="user" />
      </button>

      {#if accountMenuOpen}
        <div
          id="sol-account-menu"
          class="account-menu"
          style={accountMenuStyle}
          role="menu"
          in:popoverIn
          out:popoverOut
        >
          <div class="account-identity">
            <strong>{libraryState.user.displayName}</strong>
            {#if libraryState.user.username}
              <small>@{libraryState.user.username}</small>
            {/if}
            <small class:premium={libraryState.entitlement === "premium"} class="account-plan">
              {libraryState.entitlement === "premium"
                ? "Premium plan"
                : libraryState.entitlement === "free"
                  ? "Free plan"
                  : "Plan unavailable"}
            </small>
            {#if libraryState.syncStatus === "refreshing"}
              <small class="account-status">Syncing…</small>
            {:else if libraryState.syncStatus === "offline"}
              <small class="account-status offline">Offline</small>
            {/if}
            {#if libraryState.pendingChanges > 0}
              <small class="account-status">
                {libraryState.pendingChanges} pending
              </small>
            {/if}
          </div>
          <button
            class="account-action"
            type="button"
            role="menuitem"
            onclick={openDashboard}
          >
            <span>Dashboard</span>
            <span class="account-action-icon" aria-hidden="true">
              <Icon name="dashboard" size="small" />
            </span>
          </button>
          <button
            class="account-action"
            type="button"
            role="menuitem"
            onclick={openCommunity}
          >
            <span>Community</span>
            <span class="account-action-icon" aria-hidden="true">
              <Icon name="community" size="small" />
            </span>
          </button>
          <button
            class="account-action"
            type="button"
            role="menuitem"
            disabled={libraryState.busy !== null}
            onclick={signOut}
          >
            Sign out
          </button>
        </div>
      {/if}
      </div>
    {:else}
      <button class="sign-in-button" type="button" onclick={signIn}>Sign in</button>
    {/if}

    <div class="volume-control audio-pill-control" bind:this={volumeControl}>
      <div class="audio-pill" role="group" aria-label="Audio controls">
        <button
          bind:this={volumeButton}
          class:active={volumeMenuOpen}
          class="audio-pill-button"
          type="button"
          aria-label={`Affirmation voice volume, ${volumePercent}%`}
          aria-haspopup="dialog"
          aria-expanded={volumeMenuOpen}
          aria-controls="sol-volume-menu"
          title={`Voice volume: ${volumePercent}%`}
          onclick={toggleVolumeMenu}
        >
          <Icon name={volumeIcon} />
        </button>
        <button
          bind:this={binauralButton}
          class:active={binauralMenuOpen || binauralEnabled}
          class="audio-pill-button"
          type="button"
          aria-label={binauralEnabled
            ? "Binaural beats playing. Open controls"
            : "Binaural beats stopped. Open controls"}
          aria-haspopup="dialog"
          aria-expanded={binauralMenuOpen}
          aria-controls="sol-binaural-menu"
          title={binauralEnabled ? "Binaural beats playing" : "Binaural beats"}
          onclick={toggleBinauralMenu}
        >
          <Icon name="waveform" />
        </button>
      </div>

      {#if volumeMenuOpen}
        <div
          id="sol-volume-menu"
          class="volume-menu"
          role="dialog"
          aria-label="Affirmation voice settings"
          in:popoverIn
          out:popoverOut
        >
          <div class="volume-menu-heading">
            <span>Voice volume</span>
            <output for="affirmation-volume">{volumePercent}%</output>
          </div>
          <input
            id="affirmation-volume"
            class="volume-slider"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            style={`--volume-level: ${volumePercent}%;`}
            aria-label="Affirmation volume"
            aria-valuetext={`${volumePercent}%`}
            oninput={handleVolumeInput}
          />
          <div class="volume-menu-divider"></div>
          <div class="repeat-pause-setting">
            <div class="repeat-pause-copy"><span>Loop pause</span></div>
            <div class="repeat-pause-stepper" role="group" aria-label="Pause between repeats">
              <button
                type="button"
                aria-label="Decrease pause between repeats"
                disabled={repeatPauseSeconds <= MIN_REPEAT_PAUSE_SECONDS}
                onclick={() => adjustRepeatPause(-1)}
              >−</button>
              <output aria-live="polite" aria-atomic="true">
                {repeatPauseSeconds} {repeatPauseSeconds === 1 ? "sec" : "secs"}
              </output>
              <button
                type="button"
                aria-label="Increase pause between repeats"
                disabled={repeatPauseSeconds >= MAX_REPEAT_PAUSE_SECONDS}
                onclick={() => adjustRepeatPause(1)}
              >+</button>
            </div>
          </div>
        </div>
      {/if}

      {#if binauralMenuOpen}
        <div
          id="sol-binaural-menu"
          class="volume-menu binaural-menu"
          role="dialog"
          aria-label="Binaural beat settings"
          in:popoverIn
          out:popoverOut
        >
          <div class="binaural-power-row">
            <span>Binaural beats</span>
            <button
              class:active={binauralEnabled}
              class="binaural-power"
              type="button"
              aria-pressed={binauralEnabled}
              onclick={() => onBinauralEnabledChange(!binauralEnabled)}
            >
              <span class="binaural-power-track" aria-hidden="true">
                <span class="binaural-power-thumb"></span>
              </span>
              <span>{binauralEnabled ? "On" : "Off"}</span>
            </button>
          </div>
          <div
            bind:this={binauralOptions}
            class="sound-options"
            role="radiogroup"
            aria-label="Choose a binaural beat or noise"
            tabindex="-1"
            onkeydown={handleBinauralOptionsKeydown}
          >
            {#each Object.entries(BINAURAL_PRESETS) as [presetId, preset]}
              <button
                type="button"
                class="sound-option"
                class:active={binauralPreset === presetId}
                data-sound-id={presetId}
                role="radio"
                aria-checked={binauralPreset === presetId}
                tabindex={binauralPreset === presetId ? 0 : -1}
                onclick={() => onBinauralPresetChange(presetId as BinauralPreset)}
              >
                <span class="sound-option-label">{preset.label}</span>
                <small>
                  {#if preset.kind === "binaural"}
                    <Icon name="headphones" size="micro" />
                  {/if}
                  {binauralPresetMeta(preset)}{isPremiumBinauralPreset(
                    presetId as BinauralPreset,
                  ) && libraryState.entitlement !== "premium"
                    ? " · Premium"
                    : ""}
                </small>
                <span class="sound-option-check" aria-hidden="true">
                  {#if binauralPreset === presetId}
                    <Icon name="check" size="small" weight="bold" />
                  {/if}
                </span>
              </button>
            {/each}
          </div>
          <div class="volume-menu-heading binaural-level-heading">
            <span>Level</span>
            <output for="binaural-volume">{binauralVolumePercent}%</output>
          </div>
          <input
            id="binaural-volume"
            class="volume-slider"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={binauralVolume}
            style={`--volume-level: ${binauralVolumePercent}%;`}
            aria-label="Binaural beat and noise volume"
            aria-valuetext={`${binauralVolumePercent}%`}
            oninput={handleBinauralVolumeInput}
          />
        </div>
      {/if}
    </div>

    <div class="theme-control" bind:this={themeControl}>
      <button
        bind:this={themeButton}
        class:active={themeMenuOpen}
        class="toolbar-button"
        type="button"
        aria-label={`${activeThemeDescription}. Open theme menu`}
        aria-haspopup="menu"
        aria-expanded={themeMenuOpen}
        aria-controls="sol-theme-menu"
        title={`${activeThemeDescription} · choose theme`}
        onclick={toggleThemeMenu}
      >
        {#key activeTheme.id}
          <span class="theme-icon"><Icon name={activeThemeIcon} /></span>
        {/key}
      </button>

      {#if themeMenuOpen}
        <div
          id="sol-theme-menu"
          bind:this={themeMenu}
          class="theme-menu"
          role="menu"
          tabindex="-1"
          aria-label="Choose theme"
          onkeydown={handleThemeMenuKeydown}
          in:popoverIn
          out:popoverOut
        >
          <div class="theme-options">
            {#each themes as theme}
              <button
                class:active={selectedTheme === theme.id}
                class="theme-option"
                type="button"
                role="menuitemradio"
                aria-checked={selectedTheme === theme.id}
                data-theme-id={theme.id}
                tabindex={selectedTheme === theme.id ? 0 : -1}
                onclick={() => chooseTheme(theme.id)}
              >
                <span class={`theme-option-mark ${theme.id}`} aria-hidden="true">
                  <Icon name={themeIcon(theme.id)} size="small" weight={selectedTheme === theme.id ? "bold" : "regular"} />
                </span>
                <span class="theme-option-copy">
                  <strong>{theme.label}</strong>
                  <small>{theme.description}</small>
                </span>
                <span class="theme-option-check" aria-hidden="true">
                  {#if selectedTheme === theme.id}
                    <Icon name="check" size="small" weight="bold" />
                  {/if}
                </span>
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </div>
</section>

<style>
  .theme-picker {
    --sol-toolbar-size: clamp(36px, 8vw, 44px);
    display: grid;
    width: 100%;
    flex: 0 0 auto;
    grid-template-columns:
      minmax(36px, 1fr)
      auto
      calc(var(--sol-toolbar-size) * 2)
      var(--sol-toolbar-size);
    align-items: center;
    gap: var(--sol-space-2);
    margin-bottom: var(--sol-space-4);
    padding-inline: 0;
    transition:
      grid-template-columns var(--sol-motion-state) var(--sol-motion-ease),
      gap var(--sol-motion-state) var(--sol-motion-ease),
      margin-bottom var(--sol-motion-state) var(--sol-motion-ease),
      padding-inline var(--sol-motion-state) var(--sol-motion-ease);
  }

  .brand-lockup {
    display: flex;
    min-width: 0;
    height: var(--sol-toolbar-size);
    align-items: center;
    gap: var(--sol-space-2);
    overflow: hidden;
    padding-inline: 0;
    opacity: 1;
    transform: scale(1);
    visibility: visible;
    transition:
      gap var(--sol-motion-state) var(--sol-motion-ease),
      padding-inline var(--sol-motion-state) var(--sol-motion-ease),
      opacity var(--sol-motion-feedback) var(--sol-motion-ease),
      transform var(--sol-motion-state) var(--sol-motion-ease),
      visibility 0s linear 0s;
  }

  .brand-mark {
    display: grid;
    place-items: center;
    color: var(--sol-accent);
    filter: var(--sol-brand-shadow);
    transition:
      color var(--sol-motion-state) var(--sol-motion-ease),
      filter var(--sol-motion-state) var(--sol-motion-ease);
  }

  .brand {
    max-width: 88px;
    overflow: hidden;
    color: var(--sol-text);
    font-family: var(--sol-font-brand);
    font-size: var(--sol-type-heading);
    font-variation-settings: "SOFT" 72, "WONK" 1, "opsz" 72;
    font-weight: 650;
    line-height: var(--sol-leading-tight);
    letter-spacing: -0.025em;
    opacity: 1;
    white-space: nowrap;
    transform: translateX(0);
    visibility: visible;
    transition:
      max-width var(--sol-motion-state) var(--sol-motion-ease),
      opacity var(--sol-motion-feedback) var(--sol-motion-ease),
      transform var(--sol-motion-state) var(--sol-motion-ease),
      visibility 0s linear 0s;
  }

  .toolbar-actions {
    display: contents;
  }

  .account-control,
  .theme-control {
    position: relative;
    width: var(--sol-toolbar-size);
    height: var(--sol-toolbar-size);
  }

  .volume-control {
    position: relative;
    width: calc(var(--sol-toolbar-size) * 2);
    height: var(--sol-toolbar-size);
  }

  .toolbar-button {
    display: grid;
    width: var(--sol-toolbar-size);
    height: var(--sol-toolbar-size);
    flex: 0 0 auto;
    place-items: center;
    padding: 0;
    border: 1px solid var(--sol-border);
    border-radius: var(--sol-radius-nested);
    color: var(--sol-text);
    background: var(--sol-surface);
    box-shadow: var(--sol-surface-shadow);
    -webkit-backdrop-filter: var(--sol-surface-filter);
    backdrop-filter: var(--sol-surface-filter);
    cursor: pointer;
  }

  .toolbar-button:hover,
  .toolbar-button.active {
    color: var(--sol-accent);
    background: var(--sol-control-hover);
  }

  .toolbar-button:not(:disabled):active {
    transform: scale(var(--sol-press-scale));
  }

  .audio-pill {
    display: grid;
    width: 100%;
    height: 100%;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    overflow: hidden;
    border: 1px solid var(--sol-border);
    border-radius: var(--sol-radius-nested);
    background: var(--sol-surface);
    box-shadow: var(--sol-surface-shadow);
    -webkit-backdrop-filter: var(--sol-surface-filter);
    backdrop-filter: var(--sol-surface-filter);
  }

  .audio-pill-button {
    display: grid;
    min-width: 0;
    place-items: center;
    padding: 0;
    border: 0;
    color: var(--sol-text);
    background: transparent;
    cursor: pointer;
  }

  .audio-pill-button + .audio-pill-button {
    border-left: 1px solid var(--sol-border);
  }

  .audio-pill-button:hover,
  .audio-pill-button.active {
    color: var(--sol-accent);
    background: var(--sol-control-hover);
  }

  .audio-pill-button:active {
    transform: scale(var(--sol-press-scale));
  }

  .audio-pill-button:focus-visible {
    position: relative;
    z-index: 1;
    outline: 1px solid var(--sol-focus);
    outline-offset: -3px;
  }

  .sign-in-button {
    min-height: var(--sol-toolbar-size);
    padding: 0 var(--sol-space-3);
    border: 1px solid var(--sol-border);
    border-radius: var(--sol-radius-nested);
    color: var(--sol-text);
    background: var(--sol-surface);
    box-shadow: var(--sol-surface-shadow);
    font-family: var(--sol-font-ui);
    font-size: var(--sol-type-label);
    font-weight: var(--sol-weight-semibold);
    cursor: pointer;
  }

  .sign-in-button:hover {
    border-color: var(--sol-row-active-border);
    color: var(--sol-accent);
    background: var(--sol-control-hover);
  }

  .sign-in-button:active {
    transform: scale(var(--sol-press-scale));
  }

  .theme-icon {
    display: grid;
    place-items: center;
    animation: sol-icon-enter var(--sol-motion-state) var(--sol-motion-ease);
  }

  .account-menu {
    position: fixed;
    z-index: 120;
    top: 0;
    left: 0;
    width: min(220px, calc(100vw - 24px));
    overflow-x: hidden;
    overflow-y: auto;
    border: 1px solid var(--sol-border);
    border-radius: var(--sol-radius-surface);
    color: var(--sol-text);
    background: var(--sol-surface);
    box-shadow: var(--sol-surface-shadow);
    -webkit-backdrop-filter: var(--sol-surface-filter);
    backdrop-filter: var(--sol-surface-filter);
    transform-origin: top right;
    will-change: opacity, transform;
  }

  .volume-menu {
    position: absolute;
    z-index: 120;
    top: calc(100% + var(--sol-space-2));
    right: 0;
    display: grid;
    width: min(220px, calc(100vw - 16px));
    gap: 10px;
    padding: 11px;
    border: 1px solid var(--sol-border);
    border-radius: var(--sol-radius-surface);
    color: var(--sol-text);
    background: var(--sol-surface);
    box-shadow: var(--sol-surface-shadow);
    -webkit-backdrop-filter: var(--sol-surface-filter);
    backdrop-filter: var(--sol-surface-filter);
    transform-origin: top right;
    will-change: opacity, transform;
  }

  .binaural-menu {
    max-height: calc(100vh - 68px);
    overflow-x: hidden;
    overflow-y: auto;
    scrollbar-width: none;
  }

  .binaural-menu::-webkit-scrollbar {
    display: none;
  }

  .theme-menu {
    position: absolute;
    z-index: 120;
    top: calc(100% + var(--sol-space-2));
    right: 0;
    display: grid;
    width: min(260px, calc(100vw - 24px));
    max-height: calc(100vh - 68px);
    gap: var(--sol-space-2);
    padding: var(--sol-space-2);
    overflow-x: hidden;
    overflow-y: auto;
    border: 1px solid var(--sol-border);
    border-radius: var(--sol-radius-surface);
    color: var(--sol-text);
    background: var(--sol-surface);
    box-shadow: var(--sol-surface-shadow);
    -webkit-backdrop-filter: var(--sol-surface-filter);
    backdrop-filter: var(--sol-surface-filter);
    scrollbar-width: none;
    transform-origin: top right;
    will-change: opacity, transform;
  }

  .theme-menu::-webkit-scrollbar {
    display: none;
  }

  .theme-options {
    display: grid;
    gap: var(--sol-space-1);
  }

  .theme-option {
    display: grid;
    min-height: 52px;
    grid-template-columns: 32px minmax(0, 1fr) 20px;
    align-items: center;
    gap: var(--sol-space-3);
    padding: var(--sol-space-2);
    border: 1px solid transparent;
    border-radius: var(--sol-radius-nested);
    color: var(--sol-text);
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  .theme-option:hover,
  .theme-option:focus-visible {
    background: var(--sol-control-hover);
  }

  .theme-option.active {
    border-color: var(--sol-row-active-border);
    background: var(--sol-row-active);
  }

  .theme-option:active {
    transform: scale(var(--sol-surface-press-scale));
  }

  .theme-option-mark {
    display: grid;
    width: 32px;
    height: 32px;
    place-items: center;
    border: 1px solid var(--sol-border);
    border-radius: var(--sol-radius-compact);
    color: var(--sol-accent);
    background: var(--sol-control-bg);
    transition:
      color var(--sol-motion-feedback) var(--sol-motion-ease),
      background-color var(--sol-motion-feedback) var(--sol-motion-ease),
      border-color var(--sol-motion-feedback) var(--sol-motion-ease);
  }

  .theme-option-mark.light {
    color: var(--sol-accent);
  }

  .theme-option-mark.dark {
    color: color-mix(in srgb, var(--sol-text) 78%, var(--sol-accent));
  }

  .theme-option-mark.editor {
    color: color-mix(in srgb, var(--sol-accent) 76%, var(--sol-text));
  }

  .theme-option-copy {
    display: grid;
    min-width: 0;
    gap: 2px;
    font-family: var(--sol-font-ui);
    line-height: var(--sol-leading-snug);
  }

  .theme-option-copy strong {
    overflow: hidden;
    font-size: var(--sol-type-label);
    font-weight: var(--sol-weight-semibold);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .theme-option-copy small {
    overflow: hidden;
    color: var(--sol-muted);
    font-size: var(--sol-type-caption);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .theme-option-check {
    display: grid;
    width: var(--sol-icon-small);
    height: var(--sol-icon-small);
    place-items: center;
    color: var(--sol-accent);
  }

  .volume-menu-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sol-space-3);
    font-family: var(--sol-font-ui);
    font-size: var(--sol-type-label);
    font-weight: var(--sol-weight-semibold);
    line-height: var(--sol-leading-snug);
  }

  .volume-menu output {
    color: var(--sol-muted);
    font-variant-numeric: tabular-nums;
  }

  .volume-slider {
    width: 100%;
    height: 18px;
    margin: 0;
    appearance: none;
    color: var(--sol-accent);
    background: transparent;
    cursor: pointer;
  }

  .volume-slider::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 999px;
    background: linear-gradient(
      to right,
      var(--sol-accent) 0 var(--volume-level),
      var(--sol-progress-track) var(--volume-level) 100%
    );
  }

  .volume-slider::-webkit-slider-thumb {
    width: 16px;
    height: 16px;
    margin-top: -6px;
    appearance: none;
    border: 2px solid var(--sol-button-fg);
    border-radius: 50%;
    background: var(--sol-accent);
    box-shadow: 0 4px 12px color-mix(in srgb, var(--sol-accent) 30%, transparent);
    transition:
      background-color var(--sol-motion-feedback) var(--sol-motion-ease),
      box-shadow var(--sol-motion-state) var(--sol-motion-ease),
      transform var(--sol-motion-press) var(--sol-motion-ease);
  }

  .volume-slider:hover::-webkit-slider-thumb {
    background: var(--sol-accent-hover);
    box-shadow: 0 5px 16px color-mix(in srgb, var(--sol-accent) 42%, transparent);
  }

  .volume-slider:active::-webkit-slider-thumb {
    transform: scale(1.08);
  }

  .volume-slider:focus-visible {
    outline: 1px solid var(--sol-focus);
    outline-offset: 4px;
  }

  .volume-menu-divider {
    height: 1px;
    background: var(--sol-border);
  }

  .binaural-power-row {
    display: flex;
    min-height: 28px;
    align-items: center;
    justify-content: space-between;
    gap: var(--sol-space-3);
    font-family: var(--sol-font-ui);
    font-size: var(--sol-type-label);
    font-weight: var(--sol-weight-semibold);
    line-height: var(--sol-leading-snug);
  }

  .binaural-power {
    display: flex;
    min-height: 28px;
    align-items: center;
    gap: 6px;
    padding: 0;
    border: 0;
    color: var(--sol-muted);
    background: transparent;
    font-family: var(--sol-font-ui);
    font-size: var(--sol-type-caption);
    font-weight: var(--sol-weight-semibold);
    cursor: pointer;
  }

  .binaural-power:hover,
  .binaural-power.active {
    color: var(--sol-text);
  }

  .binaural-power:focus-visible {
    outline: 1px solid var(--sol-focus);
    outline-offset: 3px;
  }

  .binaural-power-track {
    display: flex;
    width: 30px;
    height: 18px;
    align-items: center;
    padding: 2px;
    border: 1px solid var(--sol-border);
    border-radius: 999px;
    background: var(--sol-control-bg);
    transition:
      border-color var(--sol-motion-feedback) var(--sol-motion-ease),
      background-color var(--sol-motion-feedback) var(--sol-motion-ease);
  }

  .binaural-power-thumb {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--sol-muted);
    transform: translateX(0);
    transition:
      background-color var(--sol-motion-feedback) var(--sol-motion-ease),
      transform var(--sol-motion-state) var(--sol-motion-ease);
  }

  .binaural-power.active .binaural-power-track {
    border-color: color-mix(in srgb, var(--sol-accent) 58%, var(--sol-border));
    background: color-mix(in srgb, var(--sol-accent) 16%, var(--sol-control-bg));
  }

  .binaural-power.active .binaural-power-thumb {
    background: var(--sol-accent);
    transform: translateX(12px);
  }

  .sound-options {
    display: grid;
    gap: 2px;
  }

  .sound-option {
    display: grid;
    min-width: 0;
    min-height: 36px;
    grid-template-columns: minmax(0, 1fr) auto var(--sol-icon-small);
    align-items: center;
    gap: var(--sol-space-2);
    padding: 0 var(--sol-space-2);
    border: 0;
    border-radius: calc(var(--sol-radius-nested) - 3px);
    color: var(--sol-muted);
    background: transparent;
    font-family: var(--sol-font-ui);
    text-align: left;
    cursor: pointer;
  }

  .sound-option:hover {
    color: var(--sol-text);
    background: var(--sol-control-hover);
  }

  .sound-option.active {
    color: var(--sol-text);
    background: var(--sol-row-active);
    box-shadow: inset 0 0 0 1px var(--sol-row-active-border);
  }

  .sound-option:active {
    transform: scale(var(--sol-surface-press-scale));
  }

  .sound-option:focus-visible {
    outline: 1px solid var(--sol-focus);
    outline-offset: -2px;
  }

  .sound-option-label {
    overflow: hidden;
    font-size: var(--sol-type-caption);
    font-weight: var(--sol-weight-semibold);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sound-option small {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--sol-muted);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
  }

  .sound-option-check {
    display: grid;
    width: var(--sol-icon-small);
    height: var(--sol-icon-small);
    place-items: center;
    color: var(--sol-accent);
  }

  .binaural-level-heading {
    margin-top: 2px;
  }

  .repeat-pause-setting {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 100px;
    align-items: center;
    gap: var(--sol-space-2);
  }

  .repeat-pause-copy {
    display: grid;
    gap: 2px;
    font-family: var(--sol-font-ui);
    line-height: var(--sol-leading-snug);
  }

  .repeat-pause-copy > span {
    font-size: var(--sol-type-label);
    font-weight: var(--sol-weight-semibold);
  }

  .repeat-pause-stepper {
    display: grid;
    min-height: 34px;
    grid-template-columns: 30px minmax(0, 1fr) 30px;
    overflow: hidden;
    border: 1px solid var(--sol-border);
    border-radius: var(--sol-radius-nested);
    background: var(--sol-control-bg);
  }

  .repeat-pause-stepper button {
    padding: 0;
    border: 0;
    color: var(--sol-text);
    background: transparent;
    font-family: var(--sol-font-ui);
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
  }

  .repeat-pause-stepper button:hover:not(:disabled) {
    color: var(--sol-accent);
    background: var(--sol-control-hover);
  }

  .repeat-pause-stepper button:active:not(:disabled) {
    transform: scale(var(--sol-press-scale));
  }

  .repeat-pause-stepper button:focus-visible {
    outline: 1px solid var(--sol-focus);
    outline-offset: -3px;
  }

  .repeat-pause-stepper button:disabled {
    cursor: not-allowed;
    opacity: 0.34;
  }

  .repeat-pause-stepper output {
    display: grid;
    place-items: center;
    border-inline: 1px solid var(--sol-border);
    color: var(--sol-text);
    font-family: var(--sol-font-ui);
    font-size: var(--sol-type-label);
    font-weight: var(--sol-weight-medium);
    font-variant-numeric: tabular-nums;
    line-height: 1;
    text-align: center;
  }

  .account-identity {
    display: grid;
    gap: var(--sol-space-1);
    padding: var(--sol-space-3) var(--sol-space-4);
    font-family: var(--sol-font-ui);
    overflow-wrap: anywhere;
  }

  .account-identity strong {
    font-size: var(--sol-type-body);
    font-weight: var(--sol-weight-semibold);
    line-height: var(--sol-leading-snug);
  }

  .account-identity small {
    color: var(--sol-muted);
    font-size: var(--sol-type-caption);
    line-height: var(--sol-leading-body);
  }

  .account-identity .account-status {
    margin-top: var(--sol-space-1);
  }

  .account-identity .account-plan {
    color: var(--sol-muted);
  }

  .account-identity .account-plan.premium {
    color: var(--sol-accent);
  }

  .account-identity .offline {
    color: var(--sol-accent);
  }

  .account-action {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sol-space-3);
    width: 100%;
    padding: var(--sol-space-3) var(--sol-space-4);
    border: 0;
    border-top: 1px solid var(--sol-rule);
    color: var(--sol-text);
    background: transparent;
    font-family: var(--sol-font-ui);
    font-size: var(--sol-type-label);
    font-weight: var(--sol-weight-semibold);
    line-height: var(--sol-leading-snug);
    text-align: left;
    cursor: pointer;
  }

  .account-action:hover:not(:disabled) {
    color: var(--sol-accent);
    background: var(--sol-control-hover);
  }

  .account-action:active:not(:disabled) {
    transform: scale(var(--sol-surface-press-scale));
  }

  .account-action-icon {
    display: grid;
    flex: 0 0 auto;
    place-items: center;
    color: var(--sol-muted);
  }

  .account-action:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  /* The account menu is measured and viewport-clamped at every width. */
  @media (max-width: 280px) {
    .volume-menu,
    .theme-menu {
      position: fixed;
      top: 52px;
      right: var(--sol-space-1);
      left: var(--sol-space-1);
      width: auto;
    }

    .theme-menu {
      max-height: calc(100vh - 60px);
    }
  }

  /* At compressed sidebar widths, preserve the three utilities and let branding yield. */
  @media (max-width: 220px) {
    .theme-picker {
      --sol-toolbar-size: 36px;
      grid-template-columns:
        0
        auto
        calc(var(--sol-toolbar-size) * 2)
        var(--sol-toolbar-size);
      justify-content: center;
      padding-inline: 0;
      margin-bottom: var(--sol-space-3);
    }

    .brand-lockup {
      gap: 0;
      padding-inline: 0;
      opacity: 0;
      pointer-events: none;
      transform: scale(0.82);
      visibility: hidden;
      transition:
        gap var(--sol-motion-state) var(--sol-motion-ease),
        padding-inline var(--sol-motion-state) var(--sol-motion-ease),
        opacity var(--sol-motion-feedback) var(--sol-motion-ease),
        transform var(--sol-motion-state) var(--sol-motion-ease),
        visibility 0s linear var(--sol-motion-state);
    }

    .brand {
      max-width: 0;
      opacity: 0;
      transform: translateX(-4px);
      visibility: hidden;
      transition:
        max-width var(--sol-motion-state) var(--sol-motion-ease),
        opacity var(--sol-motion-feedback) var(--sol-motion-ease),
        transform var(--sol-motion-state) var(--sol-motion-ease),
        visibility 0s linear var(--sol-motion-state);
    }

  }

</style>
