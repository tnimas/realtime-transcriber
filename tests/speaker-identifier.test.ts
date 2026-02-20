import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

type Stream = {
  samples: Float32Array;
  acceptWaveform: (input: { sampleRate: number; samples: Float32Array }) => void;
};

function embed(samples: Float32Array): Float32Array {
  let sumAbs = 0;
  let sum = 0;
  let max = -Infinity;
  let min = Infinity;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    sumAbs += Math.abs(s);
    sum += s;
    max = Math.max(max, s);
    min = Math.min(min, s);
  }

  const len = samples.length || 1;
  return new Float32Array([sumAbs / len, sum / len, max, min]);
}

vi.mock("sherpa-onnx-node", () => {
  class MockExtractor {
    dim = 4;

    createStream(): Stream {
      return {
        samples: new Float32Array(0),
        acceptWaveform: function ({ samples }: { sampleRate: number; samples: Float32Array }) {
          this.samples = samples;
        },
      };
    }

    isReady(stream: Stream): boolean {
      return stream.samples.length >= 160;
    }

    compute(stream: Stream): Float32Array {
      return embed(stream.samples);
    }
  }

  class MockManager {
    private vectors = new Map<string, Float32Array>();

    constructor(_dim: number) {}

    add({ name, v }: { name: string; v: Float32Array }): void {
      this.vectors.set(name, new Float32Array(v));
    }

    search({ v, threshold }: { v: Float32Array; threshold: number }): string {
      for (const [name, known] of this.vectors.entries()) {
        let sum = 0;
        for (let i = 0; i < v.length; i++) {
          const diff = v[i] - known[i];
          sum += diff * diff;
        }
        if (Math.sqrt(sum) <= threshold) {
          return name;
        }
      }
      return "";
    }
  }

  return {
    SpeakerEmbeddingExtractor: MockExtractor,
    SpeakerEmbeddingManager: MockManager,
  };
});

import { SpeakerIdentifier } from "../src/speaker-identifier";

function readWavSamples(filePath: string): Float32Array {
  const buffer = fs.readFileSync(filePath);
  const dataChunkOffset = buffer.indexOf("data");
  if (dataChunkOffset === -1) throw new Error("WAV data chunk not found");

  const dataSize = buffer.readUInt32LE(dataChunkOffset + 4);
  const pcmStart = dataChunkOffset + 8;
  const sampleCount = dataSize / 2;
  const out = new Float32Array(sampleCount);

  for (let i = 0; i < sampleCount; i++) {
    out[i] = buffer.readInt16LE(pcmStart + i * 2) / 32768;
  }

  return out;
}

function repeatSamples(samples: Float32Array, targetLength: number): Float32Array {
  const out = new Float32Array(targetLength);
  if (samples.length === 0) {
    return out;
  }

  for (let i = 0; i < targetLength; i++) {
    out[i] = samples[i % samples.length];
  }

  return out;
}

describe("SpeakerIdentifier", () => {
  const tmpDirs: string[] = [];
  const speechA = readWavSamples(path.join(process.cwd(), "test-assets", "audio", "digit0_george.wav"));
  const speechB = readWavSamples(path.join(process.cwd(), "test-assets", "audio", "digit1_jackson.wav"));

  afterEach(() => {
    vi.clearAllMocks();
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns Unknown for segments that are too short", () => {
    const identifier = new SpeakerIdentifier("dummy.onnx", 16000, 0.3, null);
    expect(identifier.identify(new Float32Array([0.1, -0.2]))).toBe("Unknown");
  });

  it("reuses last speaker for short segments", () => {
    const identifier = new SpeakerIdentifier("dummy.onnx", 16000, 0.3, null);
    expect(identifier.identify(speechA)).toBe("Speaker_1");
    expect(identifier.identify(new Float32Array([0.1, -0.2]))).toBe("Speaker_1");
  });

  it("creates another speaker for reliable mismatch", () => {
    const identifier = new SpeakerIdentifier("dummy.onnx", 16000, 0.1, null);
    expect(identifier.identify(speechA)).toBe("Speaker_1");
    expect(identifier.identify(speechB)).toBe("Speaker_2");
  });

  it("ignores invalid embeddings instead of creating new speakers", () => {
    const identifier = new SpeakerIdentifier("dummy.onnx", 16000, 0.1, null);
    const invalid = new Float32Array(2000);
    invalid.fill(Number.NaN);

    expect(identifier.identify(invalid)).toBe("Unknown");
    expect(identifier.identify(speechA)).toBe("Speaker_1");
  });

  it("uses stricter verification for long segments", () => {
    const identifier = new SpeakerIdentifier("dummy.onnx", 16000, 0.01, null);
    const longSpeech = repeatSamples(speechA, 18000);
    expect(identifier.identify(longSpeech)).toBe("Speaker_1");

    const internals = identifier as unknown as {
      manager: { verify: (obj: { name: string; v: Float32Array; threshold: number }) => boolean };
    };
    const verifySpy = vi.fn(() => false);
    internals.manager.verify = verifySpy;

    expect(identifier.identify(longSpeech)).toBe("Speaker_2");
    expect(verifySpy).toHaveBeenCalled();
  });

  it("creates and persists a new speaker", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transcriber-speakers-"));
    tmpDirs.push(dir);
    const storage = path.join(dir, "speakers.json");

    const identifier = new SpeakerIdentifier("dummy.onnx", 16000, 0.01, storage);
    const first = identifier.identify(speechA);
    const second = identifier.identify(speechA);

    expect(first).toBe("Speaker_1");
    expect(second).toBe("Speaker_1");

    const saved = JSON.parse(fs.readFileSync(storage, "utf-8")) as {
      speakerCount: number;
      speakers: Array<{ name: string; embedding: number[] }>;
    };

    expect(saved.speakerCount).toBe(1);
    expect(saved.speakers).toHaveLength(1);
    expect(saved.speakers[0].name).toBe("Speaker_1");
  });

  it("creates another speaker for different speech when threshold is strict", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transcriber-speakers-"));
    tmpDirs.push(dir);
    const storage = path.join(dir, "speakers.json");

    const identifier = new SpeakerIdentifier("dummy.onnx", 16000, 0.0001, storage);
    const first = identifier.identify(speechA);
    const second = identifier.identify(speechB);

    expect(first).toBe("Speaker_1");
    expect(second).toBe("Speaker_2");
  });

  it("creates missing storage directories and writes atomically", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transcriber-speakers-"));
    tmpDirs.push(dir);
    const storage = path.join(dir, "nested", "state", "speakers.json");

    const identifier = new SpeakerIdentifier("dummy.onnx", 16000, 0.01, storage);
    expect(identifier.identify(speechA)).toBe("Speaker_1");

    expect(fs.existsSync(storage)).toBe(true);
    expect(fs.existsSync(`${storage}.tmp`)).toBe(false);
  });

  it("loads previously saved embeddings", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transcriber-speakers-"));
    tmpDirs.push(dir);
    const storage = path.join(dir, "speakers.json");

    const existing = {
      speakerCount: 7,
      speakers: [{ name: "Speaker_7", embedding: Array.from(embed(speechA)) }],
    };
    fs.writeFileSync(storage, JSON.stringify(existing));

    const identifier = new SpeakerIdentifier("dummy.onnx", 16000, 0.0001, storage);
    expect(identifier.identify(speechA)).toBe("Speaker_7");
  });

  it("ignores corrupted storage files and starts fresh", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transcriber-speakers-"));
    tmpDirs.push(dir);
    const storage = path.join(dir, "speakers.json");
    fs.writeFileSync(storage, "{invalid json");

    const identifier = new SpeakerIdentifier("dummy.onnx", 16000, 0.01, storage);
    expect(identifier.identify(speechA)).toBe("Speaker_1");
  });

  it("reset clears in-memory and persisted speakers", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transcriber-speakers-"));
    tmpDirs.push(dir);
    const storage = path.join(dir, "speakers.json");

    const identifier = new SpeakerIdentifier("dummy.onnx", 16000, 0.01, storage);
    identifier.identify(speechA);
    identifier.reset();

    const saved = JSON.parse(fs.readFileSync(storage, "utf-8")) as {
      speakerCount: number;
      speakers: Array<{ name: string; embedding: number[] }>;
    };

    expect(saved.speakerCount).toBe(0);
    expect(saved.speakers).toHaveLength(0);
    expect(identifier.identify(speechA)).toBe("Speaker_1");
  });

  it("handles persistence errors without failing speaker identification", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transcriber-speakers-"));
    tmpDirs.push(dir);
    const storage = path.join(dir, "state-dir");
    fs.mkdirSync(storage);

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const identifier = new SpeakerIdentifier("dummy.onnx", 16000, 0.01, storage);
    const speaker = identifier.identify(speechA);

    expect(speaker).toBe("Speaker_1");
    expect(consoleError).toHaveBeenCalledWith("Failed to persist speakers:", expect.any(Error));
    expect(fs.existsSync(`${storage}.tmp`)).toBe(false);
  });
});
