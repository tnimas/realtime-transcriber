// scripts/download-models.ts
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const modelsDir = path.resolve(__dirname, "..", "models");
fs.mkdirSync(modelsDir, { recursive: true });

// Download Silero VAD
const vadPath = path.join(modelsDir, "silero_vad.onnx");
if (!fs.existsSync(vadPath)) {
  console.log("Downloading Silero VAD model...");
  execSync(
    `curl -SL -o "${vadPath}" https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx`,
    { stdio: "inherit" }
  );
  console.log("Silero VAD downloaded.");
} else {
  console.log("Silero VAD already exists, skipping.");
}

// Download 3DSpeaker embedding model
const speakerPath = path.join(modelsDir, "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx");
if (!fs.existsSync(speakerPath)) {
  console.log("Downloading 3DSpeaker embedding model...");
  execSync(
    `curl -SL -o "${speakerPath}" https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx`,
    { stdio: "inherit" }
  );
  console.log("3DSpeaker model downloaded.");
} else {
  console.log("3DSpeaker model already exists, skipping.");
}

// Download Parakeet v3
const parakeetDir = path.join(modelsDir, "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8");
if (!fs.existsSync(parakeetDir)) {
  console.log("Downloading Parakeet v3 model (this may take a while)...");
  const archivePath = path.join(modelsDir, "parakeet-v3.tar.bz2");
  execSync(
    `curl -SL -o "${archivePath}" https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2`,
    { stdio: "inherit" }
  );
  execSync(`tar xjf "${archivePath}" -C "${modelsDir}"`, { stdio: "inherit" });
  fs.unlinkSync(archivePath);
  console.log("Parakeet v3 downloaded and extracted.");
} else {
  console.log("Parakeet v3 already exists, skipping.");
}

console.log("All models ready.");
