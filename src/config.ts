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
  modelDir: string;
  speakerModelPath: string;
  speakerThreshold: number;
}

function expandEnvVars(str: string): string {
  return str.replace(/%([^%]+)%/g, (_, key) => process.env[key] || _);
}

const DEFAULTS: Omit<TranscriberConfig, "modelDir"> = {
  model: "parakeet",
  outputDir: path.join(os.homedir(), "Documents", "Transcriptions"),
  audioDevice: null,
  sampleRate: 16000,
  vadSilenceThreshold: 800,
  vadThreshold: 0.5,
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

  const config: TranscriberConfig = {
    model,
    outputDir: expandEnvVars(String(merged.outputDir)),
    audioDevice: merged.audioDevice as number | null,
    sampleRate: Number(merged.sampleRate),
    vadSilenceThreshold: Number(merged.vadSilenceThreshold),
    vadThreshold: Number(merged.vadThreshold),
    modelDir: path.resolve(expandEnvVars(modelDir)),
    speakerModelPath: path.resolve(expandEnvVars(String(merged.speakerModelPath))),
    speakerThreshold: Number(merged.speakerThreshold),
  };

  return config;
}
