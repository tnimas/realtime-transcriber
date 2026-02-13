import { describe, it, expect, afterAll } from "vitest";
import { loadConfig } from "./config";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const tmpDir = os.tmpdir();
const testConfigPath = path.join(tmpDir, "test-config.json");

describe("loadConfig", () => {
  afterAll(() => {
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
  });

  it("should load config and expand env vars", () => {
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

    expect(config.outputDir).not.toContain("%");
    expect(config.outputDir).toContain("Documents");
    expect(config.sampleRate).toBe(16000);
    expect(config.audioDevice).toBeNull();
  });

  it("should use defaults when config file is missing", () => {
    const defaults = loadConfig("nonexistent.json");

    expect(defaults.outputDir).not.toContain("%");
    expect(defaults.sampleRate).toBe(16000);
  });
});
