// src/config.ts
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface TranscriberConfig {
  outputDir: string;
  audioDevice: number | null;
  sampleRate: number;
  vadSilenceThreshold: number;
  vadThreshold: number;
  modelDir: string;
  vadModelPath: string;
  speakerModelPath: string;
  speakerThreshold: number;
}

function expandEnvVars(str: string): string {
  return str.replace(/%([^%]+)%/g, (_, key) => process.env[key] || _);
}

const DEFAULTS: TranscriberConfig = {
  outputDir: path.join(os.homedir(), "Documents", "Transcriptions"),
  audioDevice: null,
  sampleRate: 16000,
  vadSilenceThreshold: 800,
  vadThreshold: 0.5,
  modelDir: "./models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
  vadModelPath: "./models/silero_vad.onnx",
  speakerModelPath: "./models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx",
  speakerThreshold: 0.4,
};

export function loadConfig(configPath: string): TranscriberConfig {
  let raw: Partial<TranscriberConfig> = {};
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    raw = JSON.parse(content);
  } catch {
    // Use defaults if config missing or invalid
  }

  const config: TranscriberConfig = { ...DEFAULTS, ...raw };
  config.outputDir = expandEnvVars(config.outputDir);
  config.modelDir = path.resolve(expandEnvVars(config.modelDir));
  config.vadModelPath = path.resolve(expandEnvVars(config.vadModelPath));
  config.speakerModelPath = path.resolve(expandEnvVars(config.speakerModelPath));

  return config;
}
