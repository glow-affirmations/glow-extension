<script lang="ts">
  import type { NotificationTone } from "$lib/notifications";
  import { solMotion } from "$lib/motion";
  import Icon from "./Icon.svelte";

  type NotificationIcon = "info" | "success" | "warning" | "error";

  let {
    message,
    tone = "info",
    onDismiss,
  }: {
    message: string;
    tone?: NotificationTone;
    onDismiss: () => void;
  } = $props();

  const metadata: Record<NotificationTone, { label: string; icon: NotificationIcon }> = {
    info: { label: "Notice", icon: "info" },
    success: { label: "Success", icon: "success" },
    warning: { label: "Warning", icon: "warning" },
    error: { label: "Error", icon: "error" },
  };
  const presentation = $derived(metadata[tone]);

  function toastIn(node: Element) {
    return solMotion(node, {
      durationToken: "--sol-motion-enter",
      fallbackDuration: 260,
      offsetY: -6,
      scaleDelta: 0.015,
    });
  }

  function toastOut(node: Element) {
    return solMotion(node, {
      durationToken: "--sol-motion-feedback",
      fallbackDuration: 140,
      offsetY: -4,
      scaleDelta: 0.01,
    });
  }
</script>

<div class="toast-viewport" aria-live="off">
  <div
    class={`app-toast ${tone}`}
    role={tone === "error" ? "alert" : "status"}
    aria-live={tone === "error" ? "assertive" : "polite"}
    aria-atomic="true"
    in:toastIn
    out:toastOut
  >
    <span class="toast-icon" aria-hidden="true">
      <Icon name={presentation.icon} size="small" weight={tone === "info" ? "regular" : "fill"} />
    </span>
    <span class="toast-copy">
      <strong>{presentation.label}</strong>
      <span>{message}</span>
    </span>
    <button type="button" aria-label="Dismiss notification" title="Dismiss" onclick={onDismiss}>
      <Icon name="close" size="small" weight="bold" />
    </button>
  </div>
</div>

<style>
  .toast-viewport {
    position: fixed;
    z-index: 110;
    top: calc(var(--sol-space-4) + clamp(36px, 8vw, 44px) + var(--sol-space-2));
    right: 0;
    left: 0;
    display: flex;
    justify-content: center;
    padding-inline: var(--sol-space-3);
    pointer-events: none;
  }

  .app-toast {
    display: grid;
    width: min(360px, 100%);
    min-height: 56px;
    grid-template-columns: 30px minmax(0, 1fr) 28px;
    align-items: center;
    gap: var(--sol-space-3);
    padding: var(--sol-space-2) var(--sol-space-2) var(--sol-space-2) var(--sol-space-3);
    border: 1px solid color-mix(in srgb, var(--sol-accent) 16%, var(--sol-border));
    border-radius: var(--sol-radius-surface);
    color: var(--sol-text);
    background: color-mix(in srgb, var(--sol-panel) 96%, var(--sol-bg));
    box-shadow: 0 14px 36px rgba(16, 12, 10, 0.24), inset 0 1px 0 color-mix(in srgb, var(--sol-text) 12%, transparent);
    font-family: var(--sol-font-ui);
    pointer-events: auto;
    transform-origin: top center;
    will-change: opacity, transform;
  }

  .toast-icon {
    display: grid;
    width: 30px;
    height: 30px;
    place-items: center;
    border-radius: var(--sol-radius-compact);
    color: var(--sol-accent);
    background: color-mix(in srgb, var(--sol-accent) 10%, transparent);
  }

  .toast-copy {
    display: grid;
    min-width: 0;
    gap: 2px;
    line-height: var(--sol-leading-snug);
  }

  .toast-copy strong {
    color: var(--sol-text);
    font-size: var(--sol-type-caption);
    font-weight: var(--sol-weight-semibold);
  }

  .toast-copy span {
    overflow-wrap: anywhere;
    font-size: var(--sol-type-label);
    font-weight: var(--sol-weight-regular);
  }

  button {
    display: grid;
    width: 28px;
    height: 28px;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 50%;
    color: var(--sol-muted);
    background: transparent;
    cursor: pointer;
  }

  button:hover {
    color: var(--sol-text);
    background: var(--sol-control-hover);
  }

  button:active {
    transform: scale(var(--sol-press-scale));
  }

  @media (max-width: 280px) {
    .toast-viewport {
      top: calc(var(--sol-space-2) + 36px + var(--sol-space-2));
      padding-inline: var(--sol-space-2);
    }

    .app-toast {
      gap: var(--sol-space-2);
      padding-left: var(--sol-space-2);
    }
  }

  @media (max-width: 220px) {
    .app-toast {
      min-height: 48px;
      grid-template-columns: 28px minmax(0, 1fr) 26px;
    }

    .toast-icon,
    button {
      width: 26px;
      height: 26px;
    }

    .toast-copy strong {
      display: none;
    }

    .toast-copy span {
      font-size: var(--sol-type-caption);
    }
  }
</style>
