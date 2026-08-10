import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(import.meta.dir, "../webview/src/app.css"), "utf8");

function themeTokens(theme: "light" | "dark"): Record<string, string> {
  const block = css.match(
    new RegExp(`:root\\[data-sol-theme="${theme}"\\] \\{([\\s\\S]*?)\\n\\}`),
  )?.[1];
  if (!block) throw new Error(`Could not find the ${theme} theme.`);

  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)].map((match) => [match[1], match[2]]),
  );
}

function luminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/../g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(first: string, second: string): number {
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

describe("Glow base theme contrast", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`${theme} keeps core semantic pairs readable`, () => {
      const tokens = themeTokens(theme);
      expect(contrast(tokens["sol-text"], tokens["sol-bg"])).toBeGreaterThanOrEqual(7);
      expect(contrast(tokens["sol-muted"], tokens["sol-bg"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens["sol-button-fg"], tokens["sol-accent"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens["sol-accent"], tokens["sol-panel"])).toBeGreaterThanOrEqual(4.5);
    });
  }
});
