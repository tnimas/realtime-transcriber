import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const createStreamSpy = vi.fn();
const decodeSpy = vi.fn();
const getResultSpy = vi.fn();
const offlineRecognizerCtor = vi.fn();

vi.mock("sherpa-onnx-node", () => ({
  OfflineRecognizer: function (config: unknown) {
    offlineRecognizerCtor(config);
    return {
      createStream: createStreamSpy,
      decode: decodeSpy,
      getResult: getResultSpy,
    };
  },
}));

import { Transcriber } from "../src/transcriber";

function writeRecognizerFiles(modelDir: string, useInt8: boolean): void {
  const suffix = useInt8 ? ".int8.onnx" : ".onnx";
  fs.writeFileSync(path.join(modelDir, `encoder${suffix}`), "stub");
  fs.writeFileSync(path.join(modelDir, `decoder${suffix}`), "stub");
  fs.writeFileSync(path.join(modelDir, `joiner${suffix}`), "stub");
  fs.writeFileSync(path.join(modelDir, "tokens.txt"), "<blk>\n");
}

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

describe("Transcriber", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    vi.clearAllMocks();
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prefers .int8.onnx files when present", () => {
    const modelDir = fs.mkdtempSync(path.join(os.tmpdir(), "transcriber-model-"));
    tmpDirs.push(modelDir);
    writeRecognizerFiles(modelDir, true);

    new Transcriber(modelDir, 16000);

    const config = offlineRecognizerCtor.mock.calls[0][0] as {
      modelConfig: { transducer: { encoder: string; decoder: string; joiner: string } };
    };

    expect(config.modelConfig.transducer.encoder.endsWith("encoder.int8.onnx")).toBe(true);
    expect(config.modelConfig.transducer.decoder.endsWith("decoder.int8.onnx")).toBe(true);
    expect(config.modelConfig.transducer.joiner.endsWith("joiner.int8.onnx")).toBe(true);
  });

  it("falls back to .onnx files when int8 versions are absent", () => {
    const modelDir = fs.mkdtempSync(path.join(os.tmpdir(), "transcriber-model-"));
    tmpDirs.push(modelDir);
    writeRecognizerFiles(modelDir, false);

    new Transcriber(modelDir, 22050);

    const config = offlineRecognizerCtor.mock.calls[0][0] as {
      featConfig: { sampleRate: number };
      modelConfig: { transducer: { encoder: string; decoder: string; joiner: string } };
    };

    expect(config.featConfig.sampleRate).toBe(22050);
    expect(config.modelConfig.transducer.encoder.endsWith("encoder.onnx")).toBe(true);
    expect(config.modelConfig.transducer.decoder.endsWith("decoder.onnx")).toBe(true);
    expect(config.modelConfig.transducer.joiner.endsWith("joiner.onnx")).toBe(true);
  });

  it("transcribes speech samples and trims recognizer output", () => {
    const modelDir = fs.mkdtempSync(path.join(os.tmpdir(), "transcriber-model-"));
    tmpDirs.push(modelDir);
    writeRecognizerFiles(modelDir, false);

    const acceptWaveform = vi.fn();
    const stream = { acceptWaveform };
    createStreamSpy.mockReturnValue(stream);
    getResultSpy.mockReturnValue({ text: "  spoken text  " });

    const wavPath = path.join(process.cwd(), "test-assets", "audio", "digit0_george.wav");
    const speechAudio = readWavSamples(wavPath);

    const transcriber = new Transcriber(modelDir, 8000);
    const text = transcriber.transcribe(speechAudio);

    expect(acceptWaveform).toHaveBeenCalledWith({ sampleRate: 8000, samples: speechAudio });
    expect(decodeSpy).toHaveBeenCalledWith(stream);
    expect(text).toBe("spoken text");
  });
});
