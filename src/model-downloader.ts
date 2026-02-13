// src/model-downloader.ts
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

export type ModelName = "parakeet" | "gigaam";

interface ModelInfo {
  dir: string;
  url: string;
  archive: string;
}

const MODELS: Record<ModelName, ModelInfo> = {
  parakeet: {
    dir: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2",
    archive: "parakeet-v3.tar.bz2",
  },
  gigaam: {
    dir: "sherpa-onnx-nemo-transducer-giga-am-v2-russian-2025-04-19",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-transducer-giga-am-v2-russian-2025-04-19.tar.bz2",
    archive: "gigaam-v2.tar.bz2",
  },
};

const VAD_URL = "https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx";
const SPEAKER_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx";

export function downloadModel(model: ModelName, modelsDir: string): void {
  fs.mkdirSync(modelsDir, { recursive: true });

  const info = MODELS[model];
  const modelDir = path.join(modelsDir, info.dir);

  if (fs.existsSync(modelDir)) {
    console.log(`${model} model already exists, skipping.`);
    return;
  }

  const label = model === "parakeet" ? "Parakeet v3" : "GigaAM v2";
  console.log(`Downloading ${label} model (this may take a while)...`);
  const archivePath = path.join(modelsDir, info.archive);
  execSync(`curl -SL -o "${archivePath}" ${info.url}`, { stdio: "inherit" });
  execSync(`tar xjf "${archivePath}" -C "${modelsDir}"`, { stdio: "inherit" });
  fs.unlinkSync(archivePath);
  console.log(`${label} downloaded and extracted.`);
}

export function downloadVad(modelsDir: string): void {
  fs.mkdirSync(modelsDir, { recursive: true });
  const vadPath = path.join(modelsDir, "silero_vad.onnx");
  if (fs.existsSync(vadPath)) {
    console.log("Silero VAD already exists, skipping.");
    return;
  }
  console.log("Downloading Silero VAD model...");
  execSync(`curl -SL -o "${vadPath}" ${VAD_URL}`, { stdio: "inherit" });
  console.log("Silero VAD downloaded.");
}

export function downloadSpeaker(modelsDir: string): void {
  fs.mkdirSync(modelsDir, { recursive: true });
  const speakerPath = path.join(modelsDir, "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx");
  if (fs.existsSync(speakerPath)) {
    console.log("3DSpeaker model already exists, skipping.");
    return;
  }
  console.log("Downloading 3DSpeaker embedding model...");
  execSync(`curl -SL -o "${speakerPath}" ${SPEAKER_URL}`, { stdio: "inherit" });
  console.log("3DSpeaker model downloaded.");
}

export function getModelDir(model: ModelName): string {
  return MODELS[model].dir;
}
