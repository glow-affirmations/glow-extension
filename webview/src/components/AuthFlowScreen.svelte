<script lang="ts">
  import { onMount } from "svelte";
  import type { TransitionConfig } from "svelte/transition";
  import type { PairingViewState, SolHostApi } from "$lib/host";
  import { solEase } from "$lib/motion";
  import glowIconUrl from "../../../media/glow-icon.png";
  import Icon from "./Icon.svelte";
  import PairingPanel from "./PairingPanel.svelte";

  let {
    pairingState,
    hostApi,
    onClose,
    onCancel,
  }: {
    pairingState: PairingViewState;
    hostApi: SolHostApi;
    onClose: () => void;
    onCancel: () => void;
  } = $props();

  let closeButton: HTMLButtonElement;
  const signInCommitted = $derived(
    pairingState.status === "redeeming" ||
      pairingState.status === "exchanging_tokens" ||
      pairingState.status === "complete",
  );

  function duration(node: Element, token: string, fallback: number): number {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return 1;
    const raw = getComputedStyle(node).getPropertyValue(token).trim();
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) return fallback;
    return raw.endsWith("s") && !raw.endsWith("ms") ? value * 1_000 : value;
  }

  function screenIn(node: Element): TransitionConfig {
    return {
      duration: duration(node, "--sol-motion-enter", 260),
      easing: solEase,
      css: (progress) => {
        const inverse = 1 - progress;
        return `opacity: ${progress}; transform: translateY(${8 * inverse}px) scale(${0.992 + progress * 0.008});`;
      },
    };
  }

  function screenOut(node: Element): TransitionConfig {
    return {
      duration: duration(node, "--sol-motion-feedback", 140),
      easing: solEase,
      css: (progress) => {
        const inverse = 1 - progress;
        return `opacity: ${progress}; transform: translateY(${5 * inverse}px) scale(${0.996 + progress * 0.004});`;
      },
    };
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || signInCommitted) return;
    event.preventDefault();
    onClose();
  }

  onMount(() => closeButton?.focus());
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="auth-screen"
  role="dialog"
  aria-modal="true"
  aria-labelledby="glow-auth-title"
  in:screenIn
  out:screenOut
>
  <header>
    <button
      bind:this={closeButton}
      class="close-button"
      type="button"
      aria-label="Close sign in"
      title="Close"
      disabled={signInCommitted}
      onclick={onClose}
    >
      <Icon name="close" />
    </button>
  </header>

  <main>
    <div class="auth-card">
      <img class="auth-logo" src={glowIconUrl} alt="" draggable="false" />
      <div class="auth-copy">
        <p>Glow account</p>
        <h1 id="glow-auth-title">Sign in to Glow</h1>
        <span>Paste the six-digit code shown in your browser.</span>
      </div>
      <PairingPanel state={pairingState} {hostApi} {onCancel} />
    </div>
  </main>
</div>

<style>
  .auth-screen {
    position: fixed;
    z-index: 400;
    inset: 0;
    display: grid;
    min-width: 160px;
    grid-template-rows: auto minmax(0, 1fr);
    gap: var(--sol-space-4);
    padding: var(--sol-space-4);
    overflow: hidden;
    color: var(--sol-text);
    background:
      radial-gradient(
        circle at 50% 42%,
        color-mix(in srgb, var(--sol-accent) 11%, transparent) 0,
        transparent 40%
      ),
      var(--sol-bg);
    isolation: isolate;
    will-change: opacity, transform;
  }

  header {
    display: flex;
    width: min(100%, 520px);
    justify-content: flex-end;
    margin: 0 auto;
  }

  .close-button {
    display: grid;
    width: 36px;
    height: 36px;
    place-items: center;
    padding: 0;
    border: 1px solid var(--sol-border);
    border-radius: var(--sol-radius-control);
    color: var(--sol-muted);
    background: var(--sol-surface);
    cursor: pointer;
    transition:
      color var(--sol-motion-feedback) var(--sol-motion-ease),
      background-color var(--sol-motion-feedback) var(--sol-motion-ease),
      transform var(--sol-motion-press) var(--sol-motion-ease);
  }

  .close-button:hover {
    color: var(--sol-text);
    background: var(--sol-control-hover);
  }

  .close-button:active {
    transform: scale(var(--sol-press-scale));
  }

  .close-button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  main {
    display: grid;
    min-height: 0;
    place-items: center;
    overflow-y: auto;
    scrollbar-width: none;
  }

  main::-webkit-scrollbar {
    display: none;
  }

  .auth-card {
    display: grid;
    width: min(100%, 380px);
    justify-items: center;
    gap: var(--sol-space-5);
    padding: clamp(var(--sol-space-5), 7vw, var(--sol-space-8));
    border: 1px solid var(--sol-border);
    border-radius: var(--sol-radius-surface);
    background: var(--sol-surface);
    box-shadow: var(--sol-surface-shadow);
    text-align: center;
  }

  .auth-logo {
    display: block;
    width: clamp(112px, 38vw, 168px);
    height: clamp(112px, 38vw, 168px);
    object-fit: contain;
    filter: var(--sol-brand-shadow-large);
    pointer-events: none;
    user-select: none;
  }

  .auth-copy {
    display: grid;
    gap: var(--sol-space-2);
  }

  .auth-copy p,
  .auth-copy h1,
  .auth-copy span {
    margin: 0;
  }

  .auth-copy p {
    color: var(--sol-accent);
    font-size: var(--sol-type-caption);
    font-weight: var(--sol-weight-bold);
    letter-spacing: var(--sol-tracking-label);
    line-height: var(--sol-leading-snug);
    text-transform: uppercase;
  }

  .auth-copy h1 {
    font-family: var(--sol-font-brand);
    font-size: clamp(28px, 9vw, 40px);
    font-variation-settings: "SOFT" 76, "WONK" 1, "opsz" 72;
    font-weight: 560;
    line-height: 1.05;
    letter-spacing: -0.03em;
  }

  .auth-copy span {
    color: var(--sol-muted);
    font-size: var(--sol-type-label);
    line-height: var(--sol-leading-body);
  }

  @media (max-width: 240px) {
    .auth-screen {
      padding: var(--sol-space-2);
    }

    .auth-card {
      gap: var(--sol-space-4);
      padding: var(--sol-space-4);
    }

    .auth-logo {
      width: 92px;
      height: 92px;
    }
  }

  @media (max-height: 520px) {
    .auth-screen {
      gap: var(--sol-space-2);
      padding-block: var(--sol-space-2);
    }

    .auth-card {
      grid-template-columns: auto minmax(0, 1fr);
      gap: var(--sol-space-3);
      padding: var(--sol-space-4);
      text-align: left;
    }

    .auth-logo {
      width: 72px;
      height: 72px;
    }

    .auth-card :global(.pairing-panel) {
      grid-column: 1 / -1;
    }
  }
</style>
