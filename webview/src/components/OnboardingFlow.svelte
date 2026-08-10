<script lang="ts">
  import { onMount } from "svelte";
  import type { TransitionConfig } from "svelte/transition";
  import { solEase } from "$lib/motion";
  import glowIconUrl from "../../../media/glow-icon.png";
  import Icon from "./Icon.svelte";

  type OnboardingSlide = {
    eyebrow: string;
    title: string;
  };

  const slides: OnboardingSlide[] = [
    {
      eyebrow: "",
      title: "",
    },
  ];

  let {
    onComplete,
    onSignIn,
  }: {
    onComplete: () => void;
    onSignIn: () => void;
  } = $props();

  let currentSlide = $state(0);
  let direction = $state<1 | -1>(1);
  let closeButton: HTMLButtonElement;
  const isLastSlide = $derived(currentSlide === slides.length - 1);

  function motionDuration(node: Element, token: string, fallback: number): number {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return 1;
    const raw = getComputedStyle(node).getPropertyValue(token).trim();
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) return fallback;
    return raw.endsWith("s") && !raw.endsWith("ms") ? value * 1_000 : value;
  }

  function slideIn(node: Element): TransitionConfig {
    return {
      duration: motionDuration(node, "--sol-motion-enter", 260),
      easing: solEase,
      css: (progress) => {
        const inverse = 1 - progress;
        return `opacity: ${progress}; transform: translateX(${direction * 18 * inverse}px) scale(${0.99 + progress * 0.01});`;
      },
    };
  }

  function slideOut(node: Element): TransitionConfig {
    const exitDirection = direction;
    return {
      duration: motionDuration(node, "--sol-motion-feedback", 140),
      easing: solEase,
      css: (progress) => {
        const inverse = 1 - progress;
        return `opacity: ${progress}; transform: translateX(${-exitDirection * 12 * inverse}px) scale(${0.995 + progress * 0.005});`;
      },
    };
  }

  function goToSlide(index: number): void {
    if (index < 0 || index >= slides.length || index === currentSlide) return;
    direction = index > currentSlide ? 1 : -1;
    currentSlide = index;
  }

  function next(): void {
    if (!isLastSlide) goToSlide(currentSlide + 1);
  }

  function back(): void {
    goToSlide(currentSlide - 1);
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onComplete();
    } else if (event.key === "ArrowRight" && !isLastSlide) {
      event.preventDefault();
      next();
    } else if (event.key === "ArrowLeft" && currentSlide > 0) {
      event.preventDefault();
      back();
    }
  }

  onMount(() => {
    closeButton?.focus();
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="onboarding"
  role="dialog"
  aria-modal="true"
  aria-labelledby="glow-onboarding-title"
>
  <header class="onboarding-header">
    <button
      bind:this={closeButton}
      class="onboarding-close"
      type="button"
      aria-label="Close onboarding"
      title="Close"
      onclick={onComplete}
    >
      <Icon name="close" />
    </button>
  </header>

  <div class="onboarding-stage">
    {#key currentSlide}
      <article class="onboarding-slide" in:slideIn out:slideOut>
        <div
          class:first-visual={!isLastSlide && currentSlide === 0}
          class:login-visual={isLastSlide}
          class="onboarding-visual"
          aria-hidden={isLastSlide ? undefined : "true"}
        >
          {#if isLastSlide}
            <div class="login-page">
              <div class="login-brand" aria-label="Glow">
                <img class="login-mark" src={glowIconUrl} alt="" draggable="false" />
              </div>
              <div class="login-actions">
                <button class="signin-action" type="button" onclick={onSignIn}>
                  <Icon name="github" weight="fill" />
                  <span>Sign in with GitHub</span>
                </button>
                <button class="later-action" type="button" onclick={onComplete}>
                  Sign in later
                </button>
              </div>
            </div>
          {:else if currentSlide === 0}
            <img class="hero-logo" src={glowIconUrl} alt="" draggable="false" />
          {:else if currentSlide === 1}
            <ul class="capability-list">
              <li>Play featured affirmations</li>
              <li>Create your own affirmations</li>
              <li>Save your favorites</li>
              <li>Listen offline</li>
            </ul>
          {/if}
        </div>

        {#if !isLastSlide}
          <div class="onboarding-copy">
            <p class="onboarding-eyebrow">{slides[currentSlide].eyebrow}</p>
            <h1 id="glow-onboarding-title">{slides[currentSlide].title}</h1>
          </div>
        {:else}
          <h1 id="glow-onboarding-title" class="visually-hidden">Sign in to Glow</h1>
        {/if}
      </article>
    {/key}
  </div>

  {#if !isLastSlide}<footer class="onboarding-footer">
    <div class="onboarding-progress" aria-label={`Step ${currentSlide + 1} of ${slides.length}`}>
      {#each slides as _, index}
        <button
          class:active={index === currentSlide}
          type="button"
          aria-label={`Go to step ${index + 1}`}
          aria-current={index === currentSlide ? "step" : undefined}
          onclick={() => goToSlide(index)}
        ></button>
      {/each}
    </div>

    <div class="onboarding-actions">
      {#if currentSlide > 0}
        <button class="secondary-action" type="button" onclick={back}>Back</button>
      {:else}
        <span class="action-spacer" aria-hidden="true"></span>
      {/if}

      {#if isLastSlide}
        <span class="action-spacer" aria-hidden="true"></span>
      {:else}
        <button class="next-action" type="button" onclick={next}>
          <span>Next</span>
          <Icon name="arrow" />
        </button>
      {/if}
    </div>
  </footer>{/if}
</div>

<style>
  .onboarding {
    position: fixed;
    z-index: 300;
    inset: 0;
    display: grid;
    min-width: 160px;
    grid-template-rows: auto minmax(0, 1fr) auto;
    gap: var(--sol-space-4);
    padding: var(--sol-space-4);
    overflow: hidden;
    color: var(--sol-text);
    background:
      radial-gradient(
        circle at 50% 38%,
        color-mix(in srgb, var(--sol-accent) 13%, transparent) 0,
        transparent 38%
      ),
      var(--sol-bg);
    isolation: isolate;
  }

  .onboarding::before,
  .onboarding::after {
    position: absolute;
    z-index: -1;
    width: min(62vw, 360px);
    aspect-ratio: 1;
    border-radius: 50%;
    background: color-mix(in srgb, var(--sol-accent) 10%, transparent);
    content: "";
    filter: blur(54px);
    opacity: 0.55;
    pointer-events: none;
  }

  .onboarding::before {
    top: -24%;
    left: -28%;
  }

  .onboarding::after {
    right: -34%;
    bottom: -28%;
    opacity: 0.35;
  }

  .onboarding-header {
    display: flex;
    width: 100%;
    max-width: 560px;
    align-items: center;
    justify-content: flex-end;
    gap: var(--sol-space-3);
    margin: 0 auto;
  }

  .onboarding-close {
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
  }

  .onboarding-close:hover {
    color: var(--sol-text);
    background: var(--sol-control-hover);
  }

  .onboarding-close:active {
    transform: scale(var(--sol-press-scale));
  }

  .onboarding-stage {
    display: grid;
    min-height: 0;
    place-items: center;
    overflow-x: hidden;
    overflow-y: auto;
    scrollbar-width: none;
  }

  .onboarding-stage::-webkit-scrollbar {
    display: none;
  }

  .onboarding-slide {
    display: grid;
    width: min(100%, 520px);
    grid-area: 1 / 1;
    gap: clamp(var(--sol-space-5), 4vh, var(--sol-space-8));
    margin: auto;
    text-align: center;
    will-change: opacity, transform;
  }

  .onboarding-visual {
    display: grid;
    width: min(100%, 420px);
    height: clamp(176px, 34vh, 280px);
    place-items: center;
    margin: 0 auto;
    overflow: hidden;
    border: 1px solid var(--sol-border);
    border-radius: var(--sol-radius-surface);
    background:
      linear-gradient(
        145deg,
        color-mix(in srgb, var(--sol-surface) 94%, var(--sol-accent)) 0%,
        var(--sol-surface) 70%
      );
    box-shadow: var(--sol-surface-shadow);
  }

  .onboarding-visual.first-visual {
    overflow: visible;
    border-color: transparent;
    background: transparent;
    box-shadow: none;
  }

  .hero-logo {
    display: block;
    width: min(72%, 230px);
    height: auto;
    pointer-events: none;
    user-select: none;
  }

  .capability-list {
    display: grid;
    width: min(82%, 320px);
    gap: var(--sol-space-1);
    margin: 0;
    padding: 0;
    list-style: none;
    text-align: left;
  }

  .capability-list li {
    display: grid;
    min-height: 48px;
    grid-template-columns: 8px minmax(0, 1fr);
    align-items: center;
    gap: var(--sol-space-3);
    padding: var(--sol-space-2) var(--sol-space-3);
    border-radius: var(--sol-radius-nested);
    color: var(--sol-text);
    font-size: var(--sol-type-body);
    font-weight: var(--sol-weight-semibold);
    line-height: var(--sol-leading-snug);
  }

  .capability-list li::before {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--sol-accent);
    box-shadow: 0 0 10px color-mix(in srgb, var(--sol-accent) 46%, transparent);
    content: "";
  }

  .onboarding-visual.login-visual {
    height: clamp(290px, 46vh, 380px);
  }

  .login-page {
    display: grid;
    width: min(100%, 360px);
    min-height: 100%;
    align-content: center;
    gap: clamp(var(--sol-space-6), 4vh, var(--sol-space-8));
    padding: var(--sol-space-6);
  }

  .login-brand {
    display: grid;
    justify-items: center;
  }

  .login-mark {
    display: block;
    width: clamp(176px, 50vw, 212px);
    height: clamp(176px, 50vw, 212px);
    object-fit: contain;
    filter: var(--sol-brand-shadow-large);
    pointer-events: none;
    user-select: none;
    transition: filter var(--sol-motion-state) var(--sol-motion-ease);
  }

  .login-actions {
    display: grid;
    gap: var(--sol-space-3);
  }

  .onboarding-copy {
    display: grid;
    max-width: 460px;
    gap: var(--sol-space-3);
    justify-self: center;
  }

  .onboarding-eyebrow {
    margin: 0;
    color: var(--sol-accent);
    font-size: var(--sol-type-caption);
    font-weight: var(--sol-weight-bold);
    letter-spacing: var(--sol-tracking-label);
    line-height: var(--sol-leading-snug);
    text-transform: uppercase;
  }

  .onboarding-copy h1 {
    margin: 0;
    font-family: var(--sol-font-brand);
    font-size: clamp(30px, 8vw, 48px);
    font-variation-settings: "SOFT" 76, "WONK" 1, "opsz" 72;
    font-weight: 560;
    line-height: 1.04;
    letter-spacing: -0.03em;
    text-wrap: balance;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .onboarding-footer {
    display: grid;
    width: min(100%, 520px);
    gap: var(--sol-space-4);
    margin: 0 auto;
  }

  .onboarding-progress {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--sol-space-2);
  }

  .onboarding-progress button {
    width: 8px;
    height: 8px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--sol-rule);
    cursor: pointer;
    transition:
      width var(--sol-motion-state) var(--sol-motion-ease),
      background-color var(--sol-motion-feedback) var(--sol-motion-ease),
      transform var(--sol-motion-press) var(--sol-motion-ease);
  }

  .onboarding-progress button:hover {
    background: color-mix(in srgb, var(--sol-accent) 55%, var(--sol-rule));
  }

  .onboarding-progress button.active {
    width: 24px;
    border-radius: var(--sol-radius-compact);
    background: var(--sol-accent);
  }

  .onboarding-progress button:active {
    transform: scale(var(--sol-press-scale));
  }

  .onboarding-actions {
    display: grid;
    min-height: 44px;
    grid-template-columns: minmax(74px, auto) minmax(0, 1fr);
    align-items: stretch;
    gap: var(--sol-space-3);
  }

  .action-spacer {
    display: block;
  }

  .secondary-action,
  .later-action,
  .signin-action,
  .next-action {
    min-height: 44px;
    border-radius: var(--sol-radius-control);
    font-size: var(--sol-type-label);
    font-weight: var(--sol-weight-bold);
    line-height: var(--sol-leading-snug);
    cursor: pointer;
  }

  .secondary-action,
  .later-action {
    border: 1px solid var(--sol-border);
    color: var(--sol-text);
    background: var(--sol-control-bg);
  }

  .secondary-action:hover,
  .later-action:hover {
    background: var(--sol-control-hover);
  }

  .next-action {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--sol-space-2);
    border: 1px solid transparent;
    color: var(--sol-button-fg);
    background: var(--sol-accent);
  }

  .signin-action {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--sol-space-2);
    border: 1px solid transparent;
    color: var(--sol-button-fg);
    background: var(--sol-accent);
  }

  .signin-action:hover {
    background: var(--sol-accent-hover);
  }

  .next-action {
    justify-self: end;
    padding-inline: var(--sol-space-5);
  }

  .next-action:hover {
    background: var(--sol-accent-hover);
  }

  .secondary-action:active,
  .later-action:active,
  .signin-action:active,
  .next-action:active {
    transform: scale(var(--sol-press-scale));
  }

  .later-action {
    padding-inline: var(--sol-space-4);
  }

  @media (max-width: 360px) {
    .onboarding-slide {
      gap: var(--sol-space-5);
    }

    .onboarding-visual {
      height: clamp(164px, 31vh, 224px);
    }

    .onboarding-copy h1 {
      font-size: clamp(27px, 9vw, 38px);
    }

    .onboarding-actions {
      grid-template-columns: 64px minmax(0, 1fr);
      gap: var(--sol-space-2);
    }

    .later-action {
      min-height: 36px;
      border-color: transparent;
      background: transparent;
    }
  }

  @media (max-width: 220px) {
    .onboarding {
      gap: var(--sol-space-3);
      padding: var(--sol-space-2);
    }

    .onboarding-visual {
      height: 148px;
    }

    .onboarding-copy {
      gap: var(--sol-space-2);
    }

    .onboarding-copy h1 {
      font-size: clamp(24px, 13vw, 30px);
    }

    .onboarding-actions {
      grid-template-columns: 48px minmax(0, 1fr);
    }

    .secondary-action {
      overflow: hidden;
      padding-inline: var(--sol-space-1);
    }

    .next-action {
      width: 100%;
      padding-inline: var(--sol-space-3);
    }

    .login-page {
      padding: var(--sol-space-4);
    }
  }

  @media (max-height: 680px) {
    .onboarding {
      gap: var(--sol-space-2);
    }

    .onboarding-visual {
      height: 136px;
    }

    .onboarding-slide {
      gap: var(--sol-space-3);
    }

    .onboarding-copy {
      gap: var(--sol-space-2);
    }

    .onboarding-copy h1 {
      font-size: clamp(25px, 7vw, 34px);
    }

    .onboarding-footer {
      gap: var(--sol-space-2);
    }
  }

</style>
