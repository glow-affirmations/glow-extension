import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BINAURAL_MIX_BACKGROUND_WEIGHT,
  BINAURAL_MIX_SAFE_LIMIT,
  NOISE_SHAPING,
  NOISE_TARGET_RMS,
  binauralMixBalance,
  binauralOutputGain,
  createNoiseSamples,
} from "../webview/src/lib/binauralAudio";
import {
  BINAURAL_PRESETS,
  BINAURAL_PRESET_STORAGE_KEY,
  BINAURAL_VOLUME_STORAGE_KEY,
  DEFAULT_BINAURAL_PRESET,
  DEFAULT_BINAURAL_VOLUME,
  DEFAULT_ACTIVE_BINAURAL_VOLUME,
  firstBinauralPreset,
  firstBinauralVolume,
  isPremiumBinauralPreset,
  readBinauralPreferences,
  writeBinauralPreferences,
} from "../webview/src/lib/binauralPreference";
import { anchoredPopoverHorizontalPosition } from "../webview/src/lib/popoverPosition";

const themePickerSource = readFileSync(
  resolve(import.meta.dir, "../webview/src/components/ThemePicker.svelte"),
  "utf8",
);
const iconSource = readFileSync(
  resolve(import.meta.dir, "../webview/src/components/Icon.svelte"),
  "utf8",
);

describe("binaural beat preferences", () => {
  test("labels the control clearly and marks Hz presets for headphones", () => {
    expect(themePickerSource).toContain("<span>Binaural beats</span>");
    expect(themePickerSource).not.toContain("<span>Background sound</span>");
    expect(themePickerSource).toContain('preset.kind === "binaural"');
    expect(themePickerSource).toContain(
      '<Icon name="headphones" size="micro" />',
    );
    expect(iconSource).toContain("headphones: HeadphonesIcon");
  });

  test("keeps the account dropdown inside the viewport after the audio pill shifts its anchor", () => {
    expect(anchoredPopoverHorizontalPosition(166, 329)).toEqual({
      left: 12,
      width: 220,
    });
    expect(anchoredPopoverHorizontalPosition(300, 480)).toEqual({
      left: 80,
      width: 220,
    });
    expect(anchoredPopoverHorizontalPosition(92, 180)).toEqual({
      left: 12,
      width: 156,
    });
    expect(themePickerSource).toContain("positionAccountMenu");
    expect(themePickerSource).toContain(
      'window.addEventListener("resize", handleResize)',
    );
  });

  test("keeps the appearance menu focused on its self-explanatory theme choices", () => {
    expect(themePickerSource).not.toContain('<div class="theme-menu-heading">');
    expect(themePickerSource).not.toContain("<strong>Appearance</strong>");
    expect(themePickerSource).not.toContain("<small>Base themes</small>");
  });

  test("uses the compact Loop pause label for the replay interval", () => {
    expect(themePickerSource).toContain("<span>Loop pause</span>");
    expect(themePickerSource).not.toContain("<span>Repeat pause</span>");
  });

  test("defaults to silent Calm mode", () => {
    expect(DEFAULT_BINAURAL_VOLUME).toBe(0);
    expect(DEFAULT_ACTIVE_BINAURAL_VOLUME).toBe(0.35);
    expect(DEFAULT_BINAURAL_PRESET).toBe("calm");
    expect(firstBinauralVolume(undefined, -1)).toBe(0);
    expect(firstBinauralPreset(undefined, "unknown")).toBe("calm");
  });

  test("uses the researched carrier pairs", () => {
    expect(BINAURAL_PRESETS.calm).toEqual({
      kind: "binaural",
      label: "Calm",
      beatHz: 6,
      leftHz: 134,
      rightHz: 140,
    });
    expect(BINAURAL_PRESETS.focus).toEqual({
      kind: "binaural",
      label: "Focus",
      beatHz: 40,
      leftHz: 134,
      rightHz: 174,
    });
    expect(BINAURAL_PRESETS.white).toEqual({
      kind: "noise",
      label: "White noise",
      noiseColor: "white",
    });
    expect(BINAURAL_PRESETS.brown).toEqual({
      kind: "noise",
      label: "Brown noise",
      noiseColor: "brown",
    });
  });

  test("keeps noise free while reserving binaural beats for Premium", () => {
    expect(isPremiumBinauralPreset("calm")).toBe(true);
    expect(isPremiumBinauralPreset("focus")).toBe(true);
    expect(isPremiumBinauralPreset("white")).toBe(false);
    expect(isPremiumBinauralPreset("brown")).toBe(false);
  });

  test("uses a curved gain with safe peak headroom", () => {
    expect(binauralOutputGain(0)).toBe(0);
    expect(binauralOutputGain(0.5)).toBeCloseTo(0.14);
    expect(binauralOutputGain(1)).toBeCloseTo(0.56);
    expect(binauralOutputGain(1)).toBeLessThan(10 ** (-2 / 20));
  });

  test("balances only overloaded voice and binaural combinations", () => {
    expect(BINAURAL_MIX_BACKGROUND_WEIGHT).toBeCloseTo(0.882_352_941_2);
    expect(BINAURAL_MIX_SAFE_LIMIT).toBeCloseTo(1.432_352_941_2);
    expect(binauralMixBalance(1, 0.7, "focus", true)).toBe(1);
    expect(binauralMixBalance(0.55, 1, "focus", true)).toBe(1);
    expect(binauralMixBalance(1, 1, "focus", true)).toBeCloseTo(0.760_937_5);
    expect(binauralMixBalance(1, 1, "calm", true)).toBeCloseTo(0.760_937_5);
    expect(binauralMixBalance(1, 1, "white", true)).toBe(1);
    expect(binauralMixBalance(1, 1, "brown", true)).toBe(1);
    expect(binauralMixBalance(1, 1, "focus", false)).toBe(1);

    const balance = binauralMixBalance(1, 1, "focus", true);
    const balancedLoad = balance + BINAURAL_MIX_BACKGROUND_WEIGHT * balance;
    expect(balancedLoad).toBeCloseTo(BINAURAL_MIX_SAFE_LIMIT);
  });

  test("keeps both presets pure without per-ear modulation sidebands", () => {
    const sampleRate = 48_000;
    const magnitudeAt = (carrierHz: number, frequencyHz: number): number => {
      let real = 0;
      let imaginary = 0;
      for (let index = 0; index < sampleRate; index += 1) {
        const time = index / sampleRate;
        const sample = Math.sin(2 * Math.PI * carrierHz * time);
        real += sample * Math.cos(2 * Math.PI * frequencyHz * time);
        imaginary += sample * Math.sin(2 * Math.PI * frequencyHz * time);
      }
      return (2 / sampleRate) * Math.hypot(real, imaginary);
    };

    for (const preset of Object.values(BINAURAL_PRESETS)) {
      if (preset.kind !== "binaural") continue;
      for (const carrierHz of [preset.leftHz, preset.rightHz]) {
        expect(magnitudeAt(carrierHz, carrierHz)).toBeCloseTo(1, 6);
        expect(magnitudeAt(carrierHz, carrierHz - preset.beatHz)).toBeLessThan(
          1e-10,
        );
        expect(magnitudeAt(carrierHz, carrierHz + preset.beatHz)).toBeLessThan(
          1e-10,
        );
        expect(magnitudeAt(carrierHz, carrierHz * 2)).toBeLessThan(1e-10);
      }
    }
  });

  test("generates deterministic, centered, reference-shaped noise", () => {
    const frameCount = 48_000;
    const white = createNoiseSamples("white", frameCount, 1234);
    const repeatedWhite = createNoiseSamples("white", frameCount, 1234);
    const brown = createNoiseSamples("brown", frameCount, 5678);
    const mean = (samples: Float32Array): number =>
      samples.reduce((total, sample) => total + sample, 0) / samples.length;
    const rms = (samples: Float32Array): number =>
      Math.sqrt(
        samples.reduce((total, sample) => total + sample * sample, 0) /
          samples.length,
      );
    const differenceRms = (samples: Float32Array): number => {
      let squareSum = 0;
      for (let index = 1; index < samples.length; index += 1) {
        const difference = samples[index] - samples[index - 1];
        squareSum += difference * difference;
      }
      return Math.sqrt(squareSum / (samples.length - 1));
    };
    const zeroCrossingRate = (samples: Float32Array): number => {
      let crossings = 0;
      for (let index = 1; index < samples.length; index += 1) {
        if (Math.sign(samples[index]) !== Math.sign(samples[index - 1]))
          crossings += 1;
      }
      return crossings / (samples.length - 1);
    };

    expect(NOISE_SHAPING).toEqual({
      white: { brownPoleHz: 16, highpassHz: 185, lowpassHz: 4_500 },
      brown: { lowpassHz: 360 },
    });
    expect(white).toEqual(repeatedWhite);
    expect(mean(white)).toBeCloseTo(0, 6);
    expect(mean(brown)).toBeCloseTo(0, 6);
    expect(rms(white)).toBeCloseTo(NOISE_TARGET_RMS.white, 3);
    expect(rms(brown)).toBeCloseTo(NOISE_TARGET_RMS.brown, 3);
    expect(
      Math.max(...white.map(Math.abs)) * binauralOutputGain(1),
    ).toBeLessThan(10 ** (-2 / 20));
    expect(
      Math.max(...brown.map(Math.abs)) * binauralOutputGain(1),
    ).toBeLessThan(10 ** (-2 / 20));
    expect(Math.abs(white[white.length - 1] - white[0])).toBeLessThan(
      differenceRms(white) * 2,
    );
    expect(Math.abs(brown[brown.length - 1] - brown[0])).toBeLessThan(
      differenceRms(brown) * 2,
    );
    expect(zeroCrossingRate(white)).toBeGreaterThan(0.025);
    expect(zeroCrossingRate(white)).toBeLessThan(0.05);
    expect(zeroCrossingRate(brown)).toBeGreaterThan(0.005);
    expect(zeroCrossingRate(brown)).toBeLessThan(0.015);
    expect(differenceRms(brown)).toBeLessThan(differenceRms(white) * 0.4);
  });

  test("matches the measured octave-band contours of both references", () => {
    const sampleRate = 48_000;
    const white = createNoiseSamples("white", sampleRate, 1234);
    const brown = createNoiseSamples("brown", sampleRate, 5678);
    const bandPower = (
      samples: Float32Array,
      lowHz: number,
      highHz: number,
    ): number => {
      const frequencySamples = 12;
      let totalPower = 0;
      for (
        let sampleIndex = 0;
        sampleIndex < frequencySamples;
        sampleIndex += 1
      ) {
        const frequencyHz = Math.round(
          lowHz + ((highHz - lowHz) * (sampleIndex + 0.5)) / frequencySamples,
        );
        let real = 0;
        let imaginary = 0;
        for (let index = 0; index < samples.length; index += 1) {
          const phase = (2 * Math.PI * frequencyHz * index) / sampleRate;
          real += samples[index] * Math.cos(phase);
          imaginary -= samples[index] * Math.sin(phase);
        }
        totalPower += real * real + imaginary * imaginary;
      }
      return totalPower / frequencySamples;
    };
    const relativeDb = (
      samples: Float32Array,
      lowHz: number,
      highHz: number,
    ): number =>
      10 *
      Math.log10(
        bandPower(samples, lowHz, highHz) / bandPower(samples, 160, 320),
      );

    expect(relativeDb(brown, 20, 40)).toBeGreaterThan(-3);
    expect(relativeDb(brown, 20, 40)).toBeLessThan(3);
    expect(relativeDb(brown, 640, 1_280)).toBeLessThan(-30);
    expect(relativeDb(white, 20, 40)).toBeGreaterThan(-18);
    expect(relativeDb(white, 20, 40)).toBeLessThan(-8);
    expect(relativeDb(white, 640, 1_280)).toBeGreaterThan(-14);
    expect(relativeDb(white, 640, 1_280)).toBeLessThan(-6);
    expect(relativeDb(white, 10_240, 20_000)).toBeLessThan(-40);
  });

  test("round-trips volume and preset through storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };

    expect(writeBinauralPreferences(storage, 0.35, "focus")).toBe(true);
    expect(values.get(BINAURAL_VOLUME_STORAGE_KEY)).toBe("0.35");
    expect(values.get(BINAURAL_PRESET_STORAGE_KEY)).toBe("focus");
    expect(readBinauralPreferences(storage)).toEqual({
      volume: 0.35,
      preset: "focus",
    });

    expect(writeBinauralPreferences(storage, 0.2, "brown")).toBe(true);
    expect(readBinauralPreferences(storage)).toEqual({
      volume: 0.2,
      preset: "brown",
    });
  });
});
