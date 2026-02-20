// src/config.ts
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { type ModelName, getModelDir } from "./model-downloader";

export interface TranscriberConfig {
  model: ModelName;
  outputDir: string;
  audioDevice: number | null;
  sampleRate: number;
  vadSilenceThreshold: number;
  vadThreshold: number;
  vadInputTargetPeak: number;
  vadInputMaxGain: number;
  vadInputNoiseGateRms: number;
  asrOverlapMs: number;
  asrOverlapMaxGapMs: number;
  asrTargetPeak: number;
  asrMaxGain: number;
  asrNoiseGateRms: number;
  modelDir: string;
  speakerModelPath: string;
  speakerThreshold: number;
}

function expandEnvVars(str: string): string {
  return str.replace(/%([^%]+)%/g, (_, key) => process.env[key] || _);
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toAudioDevice(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const DEFAULTS: Omit<TranscriberConfig, "modelDir"> = {
  model: "parakeet",
  outputDir: path.join(os.homedir(), "Documents", "Transcriptions"),
  audioDevice: null,
  sampleRate: 16000,
  vadSilenceThreshold: 800,
  vadThreshold: 0.5,
  vadInputTargetPeak: 0.12,
  vadInputMaxGain: 24,
  vadInputNoiseGateRms: 0,
  asrOverlapMs: 300,
  asrOverlapMaxGapMs: 600,
  asrTargetPeak: 0.65,
  asrMaxGain: 8,
  asrNoiseGateRms: 0,
  speakerModelPath: "./models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx",
  speakerThreshold: 0.4,
};

export function loadConfig(configPath: string): TranscriberConfig {
  // Auto-create config.json from config.example.json if missing
  if (!fs.existsSync(configPath)) {
    const examplePath = configPath.replace(/\.json$/, ".example.json");
    if (fs.existsSync(examplePath)) {
      fs.copyFileSync(examplePath, configPath);
    }
  }

  let raw: Record<string, unknown> = {};
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    raw = JSON.parse(content);
  } catch {
    // Use defaults if config missing or invalid
  }

  const merged = { ...DEFAULTS, ...raw };
  const model = (merged.model === "gigaam" ? "gigaam" : "parakeet") as ModelName;

  // modelDir: use explicit value from config, otherwise derive from model
  const modelDir = typeof raw.modelDir === "string"
    ? raw.modelDir
    : `./models/${getModelDir(model)}`;

  const sampleRate = toFiniteNumber(merged.sampleRate, DEFAULTS.sampleRate);
  const vadSilenceThreshold = Math.max(1, toFiniteNumber(merged.vadSilenceThreshold, DEFAULTS.vadSilenceThreshold));
  const vadThreshold = clamp(toFiniteNumber(merged.vadThreshold, DEFAULTS.vadThreshold), 0, 1);
  const vadInputTargetPeak = clamp(toFiniteNumber(merged.vadInputTargetPeak, DEFAULTS.vadInputTargetPeak), 0.01, 0.9);
  const vadInputMaxGain = clamp(toFiniteNumber(merged.vadInputMaxGain, DEFAULTS.vadInputMaxGain), 1, 64);
  const vadInputNoiseGateRms = clamp(toFiniteNumber(merged.vadInputNoiseGateRms, DEFAULTS.vadInputNoiseGateRms), 0, 0.1);
  const asrOverlapMs = Math.max(0, toFiniteNumber(merged.asrOverlapMs, DEFAULTS.asrOverlapMs));
  const asrOverlapMaxGapMs = Math.max(0, toFiniteNumber(merged.asrOverlapMaxGapMs, DEFAULTS.asrOverlapMaxGapMs));
  const asrTargetPeak = clamp(toFiniteNumber(merged.asrTargetPeak, DEFAULTS.asrTargetPeak), 0.05, 0.95);
  const asrMaxGain = clamp(toFiniteNumber(merged.asrMaxGain, DEFAULTS.asrMaxGain), 1, 32);
  const asrNoiseGateRms = clamp(toFiniteNumber(merged.asrNoiseGateRms, DEFAULTS.asrNoiseGateRms), 0, 0.1);
  const speakerThreshold = Math.max(0, toFiniteNumber(merged.speakerThreshold, DEFAULTS.speakerThreshold));
  const outputDir = typeof merged.outputDir === "string" ? merged.outputDir : DEFAULTS.outputDir;
  const speakerModelPath = typeof merged.speakerModelPath === "string" ? merged.speakerModelPath : DEFAULTS.speakerModelPath;

  const config: TranscriberConfig = {
    model,
    outputDir: expandEnvVars(outputDir),
    audioDevice: toAudioDevice(merged.audioDevice),
    sampleRate,
    vadSilenceThreshold,
    vadThreshold,
    vadInputTargetPeak,
    vadInputMaxGain,
    vadInputNoiseGateRms,
    asrOverlapMs,
    asrOverlapMaxGapMs,
    asrTargetPeak,
    asrMaxGain,
    asrNoiseGateRms,
    modelDir: path.resolve(expandEnvVars(modelDir)),
    speakerModelPath: path.resolve(expandEnvVars(speakerModelPath)),
    speakerThreshold,
  };

  return config;
}
