// src/config.test.ts
import { loadConfig, TranscriberConfig } from "./config";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Test: loads config and expands env vars
const tmpDir = os.tmpdir();
const testConfigPath = path.join(tmpDir, "test-config.json");

fs.writeFileSync(testConfigPath, JSON.stringify({
  outputDir: "%USERPROFILE%\\Documents\\Transcriptions\\",
  audioDevice: null,
  sampleRate: 16000,
  vadSilenceThreshold: 800,
  vadThreshold: 0.5,
  modelDir: "./models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
  vadModelPath: "./models/silero_vad.onnx"
}));

const config = loadConfig(testConfigPath);

// outputDir should have %USERPROFILE% expanded
console.assert(!config.outputDir.includes("%"), `Expected expanded path, got: ${config.outputDir}`);
console.assert(config.outputDir.includes("Documents"), `Expected Documents in path, got: ${config.outputDir}`);
console.assert(config.sampleRate === 16000, `Expected 16000, got: ${config.sampleRate}`);
console.assert(config.audioDevice === null, `Expected null, got: ${config.audioDevice}`);

// Test: defaults when config file missing
const defaults = loadConfig("nonexistent.json");
console.assert(!defaults.outputDir.includes("%"), `Expected expanded default path`);
console.assert(defaults.sampleRate === 16000, `Expected default sampleRate 16000`);

fs.unlinkSync(testConfigPath);
console.log("config tests passed");
