import {
  BINAURAL_PRESETS,
  clampBinauralVolume,
  type BackgroundNoiseColor,
  type BinauralPreset,
} from "./binauralPreference";

const MAX_OUTPUT_GAIN = 0.56;
export const BINAURAL_MIX_BACKGROUND_WEIGHT = 15 / 17;
export const BINAURAL_MIX_SAFE_LIMIT = 487 / 340;
const NOISE_BUFFER_SECONDS = 8;
const NOISE_PEAK_LIMIT = 1.1;
const SUSPEND_DELAY_MS = 240;

const BUTTERWORTH_SIXTH_ORDER_Q = [0.517_638_1, 0.707_106_8, 1.931_851_7] as const;
const BUTTERWORTH_Q = 0.707_106_8;

export const NOISE_SHAPING = {
  white: { brownPoleHz: 16, highpassHz: 185, lowpassHz: 4_500 },
  brown: { lowpassHz: 360 },
} as const;

export const NOISE_TARGET_RMS: Record<BackgroundNoiseColor, number> = {
  white: 0.16,
  brown: 0.24,
};

type BiquadType = "lowpass" | "highpass";
type BiquadCoefficients = readonly [
  b0: number,
  b1: number,
  b2: number,
  a1: number,
  a2: number,
];

function biquadCoefficients(
  type: BiquadType,
  frequencyHz: number,
  sampleRate: number,
  q: number,
): BiquadCoefficients {
  const omega = (2 * Math.PI * frequencyHz) / sampleRate;
  const cosine = Math.cos(omega);
  const alpha = Math.sin(omega) / (2 * q);
  const a0 = 1 + alpha;
  const common = type === "lowpass" ? 1 - cosine : 1 + cosine;
  const direction = type === "lowpass" ? 1 : -1;
  return [
    common / (2 * a0),
    (direction * common) / a0,
    common / (2 * a0),
    (-2 * cosine) / a0,
    (1 - alpha) / a0,
  ];
}

function filterCircular(
  input: Float32Array,
  coefficients: BiquadCoefficients,
): Float32Array {
  const output = new Float32Array(input.length);
  const [b0, b1, b2, a1, a2] = coefficients;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  for (let pass = 0; pass < 2; pass += 1) {
    for (let index = 0; index < input.length; index += 1) {
      const x0 = input[index];
      const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      if (pass === 1) output[index] = y0;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y0;
    }
  }

  return output;
}

function shapeNoise(
  color: BackgroundNoiseColor,
  source: Float32Array,
  sampleRate: number,
): Float32Array {
  if (color === "brown") {
    let shaped = source;
    for (const q of BUTTERWORTH_SIXTH_ORDER_Q) {
      shaped = filterCircular(
        shaped,
        biquadCoefficients(
          "lowpass",
          NOISE_SHAPING.brown.lowpassHz,
          sampleRate,
          q,
        ),
      );
    }
    return shaped;
  }

  const pole = Math.exp((-2 * Math.PI * NOISE_SHAPING.white.brownPoleHz) / sampleRate);
  let shaped = filterCircular(source, [1 - pole, 0, 0, -pole, 0]);
  shaped = filterCircular(
    shaped,
    biquadCoefficients(
      "highpass",
      NOISE_SHAPING.white.highpassHz,
      sampleRate,
      BUTTERWORTH_Q,
    ),
  );
  return filterCircular(
    shaped,
    biquadCoefficients(
      "lowpass",
      NOISE_SHAPING.white.lowpassHz,
      sampleRate,
      BUTTERWORTH_Q,
    ),
  );
}

export function createNoiseSamples(
  color: BackgroundNoiseColor,
  frameCount: number,
  initialSeed: number,
  sampleRate = 48_000,
): Float32Array {
  const source = new Float32Array(Math.max(0, Math.floor(frameCount)));
  if (source.length === 0) return source;

  let seed = initialSeed >>> 0;
  for (let index = 0; index < source.length; index += 1) {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    source[index] = (seed / 0x1_00_00_00_00) * 2 - 1;
  }
  const safeSampleRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48_000;
  const samples = shapeNoise(color, source, safeSampleRate);

  let mean = 0;
  for (const sample of samples) mean += sample;
  mean /= samples.length;

  let squareSum = 0;
  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] -= mean;
    squareSum += samples[index] * samples[index];
    peak = Math.max(peak, Math.abs(samples[index]));
  }

  const rms = Math.sqrt(squareSum / samples.length);
  const rmsScale = rms > 0 ? NOISE_TARGET_RMS[color] / rms : 1;
  const peakScale = peak > 0 ? NOISE_PEAK_LIMIT / peak : 1;
  const scale = Math.min(rmsScale, peakScale);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] *= scale;
  }

  return samples;
}

export function binauralOutputGain(volume: number): number {
  const normalized = clampBinauralVolume(volume);
  return normalized * normalized * MAX_OUTPUT_GAIN;
}

export function binauralMixBalance(
  voiceVolume: number,
  backgroundVolume: number,
  preset: BinauralPreset,
  sessionActive: boolean,
): number {
  if (!sessionActive || BINAURAL_PRESETS[preset].kind !== "binaural") return 1;

  const voice = clampBinauralVolume(voiceVolume);
  const background = clampBinauralVolume(backgroundVolume);
  const load = voice + BINAURAL_MIX_BACKGROUND_WEIGHT * background * background;
  return load > BINAURAL_MIX_SAFE_LIMIT ? BINAURAL_MIX_SAFE_LIMIT / load : 1;
}

export class BinauralAudioEngine {
  private context: AudioContext | null = null;
  private leftOscillator: OscillatorNode | null = null;
  private rightOscillator: OscillatorNode | null = null;
  private whiteNoiseSource: AudioBufferSourceNode | null = null;
  private brownNoiseSource: AudioBufferSourceNode | null = null;
  private toneGain: GainNode | null = null;
  private whiteNoiseGain: GainNode | null = null;
  private brownNoiseGain: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private volume = 0;
  private mixBalance = 1;
  private preset: BinauralPreset = "calm";
  private enabled = false;
  private suspendTimer: ReturnType<typeof setTimeout> | undefined;

  setVolume(volume: number): void {
    this.volume = clampBinauralVolume(volume);
    this.applyOutputState();
  }

  setMixBalance(balance: number): void {
    this.mixBalance = Number.isFinite(balance) ? Math.min(1, Math.max(0, balance)) : 1;
    this.applyOutputState();
  }

  setPreset(preset: BinauralPreset): void {
    this.preset = preset;
    this.applyPreset();
    this.applyOutputState();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.applyOutputState();
  }

  close(): void {
    if (this.suspendTimer !== undefined) clearTimeout(this.suspendTimer);
    this.suspendTimer = undefined;
    this.leftOscillator?.stop();
    this.rightOscillator?.stop();
    this.whiteNoiseSource?.stop();
    this.brownNoiseSource?.stop();
    this.leftOscillator = null;
    this.rightOscillator = null;
    this.whiteNoiseSource = null;
    this.brownNoiseSource = null;
    this.toneGain = null;
    this.whiteNoiseGain = null;
    this.brownNoiseGain = null;
    this.masterGain = null;
    if (this.context) void this.context.close();
    this.context = null;
  }

  private shouldOutput(): boolean {
    return this.enabled && this.volume > 0;
  }

  private ensureGraph(): void {
    if (this.context) return;
    const AudioContextConstructor = window.AudioContext;
    const context = new AudioContextConstructor();
    const leftOscillator = context.createOscillator();
    const rightOscillator = context.createOscillator();
    const whiteNoiseSource = context.createBufferSource();
    const brownNoiseSource = context.createBufferSource();
    const stereoMerger = context.createChannelMerger(2);
    const toneGain = context.createGain();
    const whiteNoiseGain = context.createGain();
    const brownNoiseGain = context.createGain();
    const mixBus = context.createGain();
    const masterGain = context.createGain();
    const limiter = context.createDynamicsCompressor();
    const initialFrequencies = BINAURAL_PRESETS[this.preset];

    leftOscillator.type = "sine";
    rightOscillator.type = "sine";
    if (initialFrequencies.kind === "binaural") {
      leftOscillator.frequency.value = initialFrequencies.leftHz;
      rightOscillator.frequency.value = initialFrequencies.rightHz;
    } else {
      const fallback = BINAURAL_PRESETS.calm;
      leftOscillator.frequency.value = fallback.leftHz;
      rightOscillator.frequency.value = fallback.rightHz;
    }

    whiteNoiseSource.buffer = this.createNoiseBuffer(context, "white");
    whiteNoiseSource.loop = true;
    brownNoiseSource.buffer = this.createNoiseBuffer(context, "brown");
    brownNoiseSource.loop = true;

    toneGain.gain.value = initialFrequencies.kind === "binaural" ? 1 : 0;
    whiteNoiseGain.gain.value = this.preset === "white" ? 1 : 0;
    brownNoiseGain.gain.value = this.preset === "brown" ? 1 : 0;

    mixBus.gain.value = 1;
    masterGain.gain.value = 0;
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;

    leftOscillator.connect(stereoMerger, 0, 0);
    rightOscillator.connect(stereoMerger, 0, 1);
    stereoMerger.connect(toneGain).connect(mixBus);
    whiteNoiseSource.connect(whiteNoiseGain).connect(mixBus);
    brownNoiseSource.connect(brownNoiseGain).connect(mixBus);
    mixBus.connect(masterGain).connect(limiter).connect(context.destination);
    leftOscillator.start();
    rightOscillator.start();
    whiteNoiseSource.start();
    brownNoiseSource.start();

    this.context = context;
    this.leftOscillator = leftOscillator;
    this.rightOscillator = rightOscillator;
    this.whiteNoiseSource = whiteNoiseSource;
    this.brownNoiseSource = brownNoiseSource;
    this.toneGain = toneGain;
    this.whiteNoiseGain = whiteNoiseGain;
    this.brownNoiseGain = brownNoiseGain;
    this.masterGain = masterGain;
    this.applyPreset();
  }

  private createNoiseBuffer(
    context: AudioContext,
    color: BackgroundNoiseColor,
  ): AudioBuffer {
    const frameCount = Math.round(context.sampleRate * NOISE_BUFFER_SECONDS);
    const buffer = context.createBuffer(2, frameCount, context.sampleRate);
    const colorSeed = color === "white" ? 0x57_48_49_54 : 0x42_52_4f_57;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      buffer
        .getChannelData(channel)
        .set(createNoiseSamples(color, frameCount, colorSeed + channel, context.sampleRate));
    }
    return buffer;
  }

  private applyPreset(): void {
    if (
      !this.context ||
      !this.leftOscillator ||
      !this.rightOscillator ||
      !this.toneGain ||
      !this.whiteNoiseGain ||
      !this.brownNoiseGain
    ) {
      return;
    }
    const preset = BINAURAL_PRESETS[this.preset];
    const now = this.context.currentTime;
    if (preset.kind === "binaural") {
      this.leftOscillator.frequency.setTargetAtTime(preset.leftHz, now, 0.035);
      this.rightOscillator.frequency.setTargetAtTime(preset.rightHz, now, 0.035);
    }

    const targets: Array<[GainNode, number]> = [
      [this.toneGain, preset.kind === "binaural" ? 1 : 0],
      [this.whiteNoiseGain, this.preset === "white" ? 1 : 0],
      [this.brownNoiseGain, this.preset === "brown" ? 1 : 0],
    ];
    for (const [gain, target] of targets) {
      gain.gain.cancelAndHoldAtTime(now);
      gain.gain.setTargetAtTime(target, now, 0.025);
    }
  }

  private applyOutputState(): void {
    if (this.shouldOutput()) {
      this.ensureGraph();
      if (!this.context || !this.masterGain) return;
      if (this.suspendTimer !== undefined) clearTimeout(this.suspendTimer);
      this.suspendTimer = undefined;
      void this.context.resume();
      this.masterGain.gain.setTargetAtTime(
        binauralOutputGain(this.volume) * this.mixBalance,
        this.context.currentTime,
        0.025,
      );
      return;
    }

    if (!this.context || !this.masterGain) return;
    this.masterGain.gain.setTargetAtTime(0, this.context.currentTime, 0.025);
    if (this.suspendTimer !== undefined) clearTimeout(this.suspendTimer);
    this.suspendTimer = setTimeout(() => {
      this.suspendTimer = undefined;
      if (!this.shouldOutput() && this.context?.state === "running") {
        void this.context.suspend();
      }
    }, SUSPEND_DELAY_MS);
  }
}
