<script lang="ts">
  import { tick } from "svelte";
  import type { PairingViewState, SolHostApi } from "$lib/host";
  import { completePairingCode } from "$lib/pairingCode";
  import Icon from "./Icon.svelte";
  import LoadingSpinner from "./LoadingSpinner.svelte";

  let {
    state: pairingState,
    hostApi,
    compact = false,
    onCancel = () => undefined,
  }: {
    state: PairingViewState;
    hostApi: SolHostApi;
    compact?: boolean;
    onCancel?: () => void;
  } = $props();

  let code = $state("");
  let codeInput = $state<HTMLInputElement>();
  let submissionPending = $state(false);
  let previousStatus: PairingViewState["status"] = "idle";

  const isWorking = $derived(
    pairingState.status === "starting" ||
      pairingState.status === "redeeming" ||
      pairingState.status === "exchanging_tokens",
  );

  $effect(() => {
    const status = pairingState.status;
    if (status === "waiting_for_code" && previousStatus !== status) {
      submissionPending = false;
      void tick().then(() => codeInput?.focus());
    } else if (status === "idle") {
      code = "";
      submissionPending = false;
    }
    previousStatus = status;
  });

  function submitCode(): void {
    if (
      isWorking ||
      submissionPending ||
      pairingState.status !== "waiting_for_code"
    ) {
      return;
    }
    const normalized = completePairingCode(code);
    if (!normalized) return;
    submissionPending = true;
    hostApi.postMessage({ type: "submitPairingCode", code: normalized });
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    submitCode();
  }

  function handleInput(event: Event): void {
    code = (event.currentTarget as HTMLInputElement).value;
    submitCode();
  }

  function cancel(): void {
    code = "";
    hostApi.postMessage({ type: "cancelPairing" });
    onCancel();
  }
</script>

<div class:compact class="pairing-panel">
  {#if pairingState.status === "idle"}
    <button class="primary" type="button" disabled aria-busy="true">
      <LoadingSpinner size="small" />
      <span>Opening browser…</span>
    </button>
  {:else if pairingState.status === "starting"}
    <button class="primary" type="button" disabled aria-busy="true">
      <LoadingSpinner size="small" />
      <span>Opening Glow…</span>
    </button>
    <button class="quiet" type="button" onclick={cancel}>Cancel</button>
  {:else if pairingState.status === "waiting_for_code"}
    <form onsubmit={submit}>
      <label for="glow-pairing-code">Enter the code from your browser</label>
      <input
        bind:this={codeInput}
        id="glow-pairing-code"
        type="text"
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength="7"
        placeholder="000 000"
        value={code}
        oninput={handleInput}
      />
      {#if pairingState.message}
        <small class="message">{pairingState.message}</small>
      {/if}
    </form>
    <div class="secondary-actions">
      <button
        class="quiet"
        type="button"
        onclick={() => hostApi.postMessage({ type: "reopenPairingPage" })}
      >
        Reopen code page
      </button>
      <button class="quiet" type="button" onclick={cancel}>Cancel</button>
    </div>
  {:else if pairingState.status === "redeeming" || pairingState.status === "exchanging_tokens"}
    <button class="primary" type="button" disabled aria-busy="true">
      <LoadingSpinner size="small" />
      <span>Signing you in…</span>
    </button>
    <button class="quiet" type="button" disabled>Cancel</button>
  {:else if pairingState.status === "complete"}
    <div class="status-copy" aria-live="polite">
      <strong>Signed in</strong>
    </div>
  {:else if pairingState.status === "expired" || pairingState.status === "locked" || pairingState.status === "denied" || pairingState.status === "failed"}
    <div class="status-copy">
      <strong>Sign in was not completed</strong>
      <small>{pairingState.message}</small>
    </div>
    <button
      class="primary"
      type="button"
      onclick={() => hostApi.postMessage({ type: "restartPairing" })}
    >
      Start again
    </button>
  {/if}
</div>

<style>
  .pairing-panel {
    display: grid;
    width: min(100%, 320px);
    gap: var(--sol-space-2);
  }

  form,
  .status-copy {
    display: grid;
    gap: var(--sol-space-2);
  }

  label,
  strong {
    color: var(--sol-text);
    font-family: var(--sol-font-ui);
    font-size: var(--sol-type-label);
    font-weight: var(--sol-weight-semibold);
    line-height: var(--sol-leading-snug);
  }

  input {
    width: 100%;
    min-height: 42px;
    box-sizing: border-box;
    padding: var(--sol-space-2) var(--sol-space-3);
    border: 1px solid var(--sol-border);
    border-radius: var(--sol-radius-control);
    outline: none;
    color: var(--sol-text);
    background: var(--sol-control-bg);
    font-family: var(--sol-font-ui);
    font-size: var(--sol-type-body);
    font-weight: var(--sol-weight-semibold);
    letter-spacing: 0.14em;
    text-align: center;
    transition:
      border-color var(--sol-motion-feedback) var(--sol-motion-ease),
      background-color var(--sol-motion-feedback) var(--sol-motion-ease);
  }

  input:focus {
    border-color: var(--sol-accent);
  }

  small {
    color: var(--sol-muted);
    font-family: var(--sol-font-ui);
    font-size: var(--sol-type-caption);
    line-height: var(--sol-leading-body);
  }

  .message {
    text-align: left;
  }

  button {
    min-height: 40px;
    border-radius: var(--sol-radius-control);
    font-family: var(--sol-font-ui);
    font-size: var(--sol-type-label);
    font-weight: var(--sol-weight-bold);
    line-height: var(--sol-leading-snug);
    cursor: pointer;
    transition:
      color var(--sol-motion-feedback) var(--sol-motion-ease),
      border-color var(--sol-motion-feedback) var(--sol-motion-ease),
      background-color var(--sol-motion-feedback) var(--sol-motion-ease),
      transform var(--sol-motion-press) var(--sol-motion-ease),
      opacity var(--sol-motion-feedback) var(--sol-motion-ease);
  }

  button:active:not(:disabled) {
    transform: scale(var(--sol-press-scale));
  }

  button:disabled {
    cursor: wait;
    opacity: 0.62;
  }

  .primary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--sol-space-2);
    padding-inline: var(--sol-space-4);
    border: 1px solid transparent;
    color: var(--sol-button-fg);
    background: var(--sol-accent);
  }

  .primary:hover:not(:disabled) {
    background: var(--sol-accent-hover);
  }

  .quiet {
    border: 1px solid var(--sol-border);
    color: var(--sol-text);
    background: var(--sol-control-bg);
  }

  .quiet:hover:not(:disabled) {
    background: var(--sol-control-hover);
  }

  .secondary-actions {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--sol-space-2);
  }

  .compact {
    width: 100%;
  }

  .compact button {
    min-height: 36px;
  }

  .compact .secondary-actions {
    grid-template-columns: 1fr;
  }
</style>
