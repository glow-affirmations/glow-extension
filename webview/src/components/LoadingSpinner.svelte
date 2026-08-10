<script lang="ts">
  type SpinnerSize = "small" | "control" | "prominent";

  let { size = "control" }: { size?: SpinnerSize } = $props();
</script>

<span class={`loading-spinner ${size}`} aria-hidden="true"></span>

<style>
  .loading-spinner {
    display: block;
    width: var(--sol-icon-control);
    height: var(--sol-icon-control);
    flex: 0 0 auto;
    box-sizing: border-box;
    border: 2px solid color-mix(in srgb, currentColor 32%, transparent);
    border-top-color: currentColor;
    border-radius: 50%;
    animation: sol-spinner-rotate var(--sol-motion-spin) linear infinite;
  }

  .loading-spinner.small {
    width: var(--sol-icon-small);
    height: var(--sol-icon-small);
  }

  .loading-spinner.prominent {
    width: var(--sol-icon-prominent);
    height: var(--sol-icon-prominent);
    border-width: 2.5px;
  }

  @keyframes sol-spinner-rotate {
    to {
      transform: rotate(360deg);
    }
  }
</style>
