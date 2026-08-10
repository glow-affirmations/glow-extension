import { flip, type AnimationConfig } from "svelte/animate";

type PopoverPlacement = "above" | "below";

export type SolMotionDurationToken =
  | "--sol-motion-feedback"
  | "--sol-motion-state"
  | "--sol-motion-enter";

type SolMotionOptions = {
  durationToken: SolMotionDurationToken;
  fallbackDuration: number;
  offsetY: number;
  scaleDelta: number;
};

type ListReorderBounds = {
  from: DOMRect;
  to: DOMRect;
};

export type PopoverMotionOptions = {
  placement?: PopoverPlacement;
};

function sampleCurve(time: number, first: number, second: number): number {
  const inverse = 1 - time;
  return 3 * inverse * inverse * time * first +
    3 * inverse * time * time * second +
    time * time * time;
}

function sampleCurveSlope(time: number, first: number, second: number): number {
  const inverse = 1 - time;
  return 3 * inverse * inverse * first +
    6 * inverse * time * (second - first) +
    3 * time * time * (1 - second);
}

/** CSS cubic-bezier(0.2, 0, 0, 1), expressed for Svelte transitions. */
export function solEase(position: number): number {
  if (position <= 0 || position >= 1) return position;
  let time = position;

  for (let iteration = 0; iteration < 6; iteration += 1) {
    const slope = sampleCurveSlope(time, 0.2, 0);
    if (Math.abs(slope) < 0.0001) break;
    time -= (sampleCurve(time, 0.2, 0) - position) / slope;
    time = Math.min(1, Math.max(0, time));
  }

  return sampleCurve(time, 0, 1);
}

export function motionDuration(
  node: Element,
  token: SolMotionDurationToken,
  fallback: number,
): number {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return 1;

  const value = getComputedStyle(node).getPropertyValue(token).trim();
  const duration = Number.parseFloat(value);
  if (!Number.isFinite(duration)) return fallback;
  return value.endsWith("s") && !value.endsWith("ms") ? duration * 1_000 : duration;
}

export function solMotion(node: Element, options: SolMotionOptions) {
  return {
    duration: motionDuration(node, options.durationToken, options.fallbackDuration),
    easing: solEase,
    css: (progress: number) => {
      const inverse = 1 - progress;
      return `opacity: ${progress}; transform: translateY(${options.offsetY * inverse}px) scale(${1 - options.scaleDelta * inverse});`;
    },
  };
}

/** Removed rows recede softly before the surrounding list closes around them. */
export function listItemOut(node: Element) {
  return solMotion(node, {
    durationToken: "--sol-motion-feedback",
    fallbackDuration: 140,
    offsetY: -2,
    scaleDelta: 0.01,
  });
}

/** Surviving rows settle into their new positions over the standard state duration. */
export function listReorder(
  node: Element,
  bounds: ListReorderBounds,
): AnimationConfig {
  return flip(node, bounds, {
    duration: motionDuration(node, "--sol-motion-state", 200),
    easing: solEase,
  });
}

/** Menus emerge from their trigger over the standard structural-motion duration. */
export function popoverIn(
  node: Element,
  { placement = "below" }: PopoverMotionOptions = {},
) {
  return solMotion(node, {
    durationToken: "--sol-motion-enter",
    fallbackDuration: 260,
    offsetY: placement === "below" ? -6 : 6,
    scaleDelta: 0.015,
  });
}

/** Menus return toward their trigger using the faster feedback duration. */
export function popoverOut(
  node: Element,
  { placement = "below" }: PopoverMotionOptions = {},
) {
  return solMotion(node, {
    durationToken: "--sol-motion-feedback",
    fallbackDuration: 140,
    offsetY: placement === "below" ? -4 : 4,
    scaleDelta: 0.01,
  });
}
