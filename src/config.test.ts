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
      model: "parakeet",
      outputDir: "%USERPROFILE%\\Documents\\Transcriptions\\",
      audioDevice: null,
      sampleRate: 16000,
      vadSilenceThreshold: 800,
      vadThreshold: 0.5,
    }));

    const config = loadConfig(testConfigPath);

    expect(config.outputDir).not.toContain("%");
    expect(config.outputDir).toContain("Documents");
    expect(config.sampleRate).toBe(16000);
    expect(config.audioDevice).toBeNull();
    expect(config.model).toBe("parakeet");
  });

  it("should use defaults when config file is missing", () => {
    const defaults = loadConfig("nonexistent.json");

    expect(defaults.outputDir).not.toContain("%");
    expect(defaults.sampleRate).toBe(16000);
    expect(defaults.model).toBe("parakeet");
  });

  it("should derive modelDir from model name", () => {
    fs.writeFileSync(testConfigPath, JSON.stringify({ model: "gigaam" }));
    const config = loadConfig(testConfigPath);

    expect(config.model).toBe("gigaam");
    expect(config.modelDir).toContain("giga-am-v2");
  });

  it("should use explicit modelDir when provided", () => {
    fs.writeFileSync(testConfigPath, JSON.stringify({
      model: "parakeet",
      modelDir: "./models/custom-model"
    }));
    const config = loadConfig(testConfigPath);

    expect(config.modelDir).toContain("custom-model");
  });

  it("should default to parakeet for unknown model values", () => {
    fs.writeFileSync(testConfigPath, JSON.stringify({ model: "unknown" }));
    const config = loadConfig(testConfigPath);

    expect(config.model).toBe("parakeet");
    expect(config.modelDir).toContain("parakeet");
  });
});
