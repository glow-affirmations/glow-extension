<script lang="ts">
  let {
    size = "prominent",
  }: {
    size?: "small" | "control" | "prominent";
  } = $props();

  const sizes = {
    small: "var(--sol-icon-small)",
    control: "var(--sol-icon-control)",
    prominent: "var(--sol-icon-prominent)",
  };
</script>

<svg
  class="glow-mark"
  viewBox="0 0 64 64"
  fill="none"
  aria-hidden="true"
  focusable="false"
  style={`--glow-mark-size: ${sizes[size]};`}
>
  <defs>
    <path
      id="glow-organic-contour"
      d="M30.8 7.6C39.2 6.7 47.4 12.7 52.1 21.5C57.5 31.6 56.4 44.2 47.7 51.5C38.9 58.9 24.8 59.4 15.8 52.2C7.3 45.4 6.2 33.2 11.1 23.5C15.3 15.2 22.5 8.5 30.8 7.6Z"
    />
    <filter id="glow-mark-aura" x="-70%" y="-70%" width="240%" height="240%">
      <feGaussianBlur stdDeviation="5.5" />
    </filter>
    <filter id="glow-contour-soft" x="-35%" y="-35%" width="170%" height="170%">
      <feGaussianBlur stdDeviation="1.7" />
    </filter>
    <filter id="glow-core-soft" x="-70%" y="-70%" width="240%" height="240%">
      <feGaussianBlur stdDeviation="2.6" />
    </filter>
  </defs>

  <use
    class="glow-mark-aura"
    href="#glow-organic-contour"
    fill="#ff7b68"
    opacity="0.42"
    filter="url(#glow-mark-aura)"
  />
  <g class="glow-mark-form">
    <use href="#glow-organic-contour" fill="#ee5d78" />
    <use
      href="#glow-organic-contour"
      fill="#ff8066"
      transform="translate(32 32) scale(.88) translate(-32 -32)"
      filter="url(#glow-contour-soft)"
    />
    <use
      href="#glow-organic-contour"
      fill="#ffc66c"
      transform="translate(32 32) scale(.67) translate(-32 -32)"
      filter="url(#glow-contour-soft)"
    />
    <use
      href="#glow-organic-contour"
      fill="#fff0b2"
      transform="translate(32 32) scale(.45) translate(-32 -32)"
      filter="url(#glow-core-soft)"
    />
    <use
      href="#glow-organic-contour"
      fill="#fffdf0"
      transform="translate(32 32) scale(.22) translate(-32 -32)"
      filter="url(#glow-core-soft)"
    />
  </g>
</svg>

<style>
  .glow-mark {
    display: block;
    width: var(--glow-mark-size);
    height: var(--glow-mark-size);
    flex: 0 0 auto;
    overflow: visible;
  }

  .glow-mark-aura,
  .glow-mark-form {
    transform-origin: center;
    transform-box: fill-box;
    transition:
      filter var(--sol-motion-state) var(--sol-motion-ease),
      transform var(--sol-motion-state) var(--sol-motion-ease);
  }

  .glow-mark-aura {
    opacity: var(--sol-brand-aura-rest);
  }

  @media (prefers-reduced-motion: no-preference) {
    .glow-mark-form {
      animation: glow-form-breathe 3.6s var(--sol-motion-ease) infinite alternate;
    }

    .glow-mark-aura {
      animation: glow-aura-breathe 3.6s var(--sol-motion-ease) infinite alternate;
    }
  }

  @keyframes glow-form-breathe {
    from {
      transform: scale(0.97) rotate(-0.7deg);
      filter: brightness(0.98) saturate(0.98);
    }

    to {
      transform: scale(1.025) rotate(0.7deg);
      filter: brightness(1.08) saturate(1.04);
    }
  }

  @keyframes glow-aura-breathe {
    from {
      transform: scale(0.92);
      opacity: var(--sol-brand-aura-min);
    }

    to {
      transform: scale(1.12);
      opacity: var(--sol-brand-aura-max);
    }
  }
</style>
