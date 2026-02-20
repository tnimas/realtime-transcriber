import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "transcriber-config-"));
}

describe("loadConfig", () => {
  const createdDirs: string[] = [];

  afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("expands env vars and derives modelDir from model", () => {
    const tmpDir = createTmpDir();
    createdDirs.push(tmpDir);
    const configPath = path.join(tmpDir, "config.json");

    process.env.TRANSCRIBER_TEST_OUTPUT = path.join(tmpDir, "out-root");
    process.env.TRANSCRIBER_TEST_MODELS = path.join(tmpDir, "models-root");

    fs.writeFileSync(
      configPath,
      JSON.stringify({
        model: "gigaam",
        outputDir: "%TRANSCRIBER_TEST_OUTPUT%\\jsonl",
        speakerModelPath: "%TRANSCRIBER_TEST_MODELS%\\speaker.onnx",
      }),
    );

    const config = loadConfig(configPath);

    expect(config.model).toBe("gigaam");
    expect(config.outputDir).toBe(path.join(process.env.TRANSCRIBER_TEST_OUTPUT!, "jsonl"));
    expect(config.modelDir).toContain("giga-am-v2");
    expect(config.speakerModelPath).toBe(path.resolve(process.env.TRANSCRIBER_TEST_MODELS!, "speaker.onnx"));
  });

  it("auto-creates config from .example next to it", () => {
    const tmpDir = createTmpDir();
    createdDirs.push(tmpDir);
    const configPath = path.join(tmpDir, "config.json");
    const examplePath = path.join(tmpDir, "config.example.json");

    fs.writeFileSync(
      examplePath,
      JSON.stringify({
        model: "parakeet",
        outputDir: "%USERPROFILE%\\Documents\\Transcriptions\\",
        sampleRate: 22050,
      }),
    );

    const config = loadConfig(configPath);

    expect(fs.existsSync(configPath)).toBe(true);
    expect(config.sampleRate).toBe(22050);
    expect(config.model).toBe("parakeet");
  });

  it("falls back to defaults when json is invalid", () => {
    const tmpDir = createTmpDir();
    createdDirs.push(tmpDir);
    const configPath = path.join(tmpDir, "broken.json");
    fs.writeFileSync(configPath, "{ bad json");

    const config = loadConfig(configPath);

    expect(config.model).toBe("parakeet");
    expect(config.sampleRate).toBe(16000);
    expect(config.vadThreshold).toBe(0.5);
    expect(config.vadInputTargetPeak).toBe(0.12);
    expect(config.asrTargetPeak).toBe(0.65);
    expect(config.asrOverlapMs).toBe(300);
    expect(config.asrOverlapMaxGapMs).toBe(600);
    expect(config.audioDevice).toBeNull();
  });

  it("uses explicit modelDir and keeps unknown env placeholders", () => {
    const tmpDir = createTmpDir();
    createdDirs.push(tmpDir);
    const configPath = path.join(tmpDir, "config.json");

    fs.writeFileSync(
      configPath,
      JSON.stringify({
        model: "parakeet",
        modelDir: "%UNKNOWN_TEST_ENV%\\custom-model",
      }),
    );

    const config = loadConfig(configPath);

    expect(config.modelDir).toContain("%UNKNOWN_TEST_ENV%");
    expect(config.modelDir).toContain("custom-model");
  });

  it("defaults to parakeet for unknown model names", () => {
    const tmpDir = createTmpDir();
    createdDirs.push(tmpDir);
    const configPath = path.join(tmpDir, "config.json");
    fs.writeFileSync(configPath, JSON.stringify({ model: "unsupported-model" }));

    const config = loadConfig(configPath);

    expect(config.model).toBe("parakeet");
    expect(config.modelDir).toContain("parakeet");
  });

  it("sanitizes numeric fields and audioDevice", () => {
    const tmpDir = createTmpDir();
    createdDirs.push(tmpDir);
    const configPath = path.join(tmpDir, "config.json");

    fs.writeFileSync(
      configPath,
      JSON.stringify({
        sampleRate: "not-a-number",
        vadSilenceThreshold: 0,
        vadThreshold: 9,
        vadInputTargetPeak: 9,
        vadInputMaxGain: 999,
        vadInputNoiseGateRms: -1,
        asrOverlapMs: -10,
        asrOverlapMaxGapMs: "bad",
        asrTargetPeak: 0,
        asrMaxGain: 0,
        asrNoiseGateRms: 999,
        speakerThreshold: -5,
        audioDevice: "2",
      }),
    );

    const config = loadConfig(configPath);

    expect(config.sampleRate).toBe(16000);
    expect(config.vadSilenceThreshold).toBe(1);
    expect(config.vadThreshold).toBe(1);
    expect(config.vadInputTargetPeak).toBe(0.9);
    expect(config.vadInputMaxGain).toBe(64);
    expect(config.vadInputNoiseGateRms).toBe(0);
    expect(config.asrOverlapMs).toBe(0);
    expect(config.asrOverlapMaxGapMs).toBe(600);
    expect(config.asrTargetPeak).toBe(0.05);
    expect(config.asrMaxGain).toBe(1);
    expect(config.asrNoiseGateRms).toBe(0.1);
    expect(config.speakerThreshold).toBe(0);
    expect(config.audioDevice).toBe(2);
  });

  it("uses null audioDevice for invalid values", () => {
    const tmpDir = createTmpDir();
    createdDirs.push(tmpDir);
    const configPath = path.join(tmpDir, "config.json");
    fs.writeFileSync(configPath, JSON.stringify({ audioDevice: "abc" }));

    const config = loadConfig(configPath);
    expect(config.audioDevice).toBeNull();
  });
});
