import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";

type TestConfig = {
  model: "parakeet" | "gigaam";
  outputDir: string;
  audioDevice: number | null;
  sampleRate: number;
  vadSilenceThreshold: number;
  vadThreshold: number;
  vadInputTargetPeak: number;
  vadInputMaxGain: number;
  vadInputNoiseGateRms: number;
  asrOverlapMs: number;
  asrOverlapMaxGapMs: number;
  asrTargetPeak: number;
  asrMaxGain: number;
  asrNoiseGateRms: number;
  modelDir: string;
  speakerModelPath: string;
  speakerThreshold: number;
};

type ServiceTestSetup = {
  TranscriberService: typeof import("../src/service").TranscriberService;
  config: TestConfig;
  mocks: {
    loadConfigMock: ReturnType<typeof vi.fn>;
    downloadModelMock: ReturnType<typeof vi.fn>;
    downloadSpeakerMock: ReturnType<typeof vi.fn>;
    audioInstances: Array<EventEmitter & {
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
      getSampleRate: ReturnType<typeof vi.fn>;
      options: { deviceId: number | null; sampleRate: number };
    }>;
    vadInstances: Array<EventEmitter & { init: ReturnType<typeof vi.fn>; processAudio: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }>;
    transcriberInstances: Array<{ transcribe: ReturnType<typeof vi.fn> }>;
    loggerInstances: Array<{ write: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }>;
    speakerInstances: Array<{ identify: ReturnType<typeof vi.fn> }>;
    listDevicesMock: ReturnType<typeof vi.fn>;
    existsSyncMock: ReturnType<typeof vi.fn>;
  };
};

type ServiceLoadOptions = {
  deviceList?: Array<{ id: number; name: string; maxInputChannels: number }>;
  vadInitReject?: Error;
  captureSampleRate?: number;
};

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

async function loadServiceModule(
  configOverride: Partial<TestConfig> = {},
  options: ServiceLoadOptions = {},
): Promise<ServiceTestSetup> {
  vi.resetModules();

  const config: TestConfig = {
    model: "parakeet",
    outputDir: path.resolve("tmp-output"),
    audioDevice: null,
    sampleRate: 16000,
    vadSilenceThreshold: 800,
    vadThreshold: 0.5,
    vadInputTargetPeak: 0.12,
    vadInputMaxGain: 24,
    vadInputNoiseGateRms: 0,
    asrOverlapMs: 300,
    asrOverlapMaxGapMs: 600,
    asrTargetPeak: 0.65,
    asrMaxGain: 8,
    asrNoiseGateRms: 0,
    modelDir: path.resolve("models", "fake-asr"),
    speakerModelPath: path.resolve("models", "speaker.onnx"),
    speakerThreshold: 0.4,
    ...configOverride,
  };

  const loadConfigMock = vi.fn(() => config);
  const downloadModelMock = vi.fn();
  const downloadSpeakerMock = vi.fn();
  const existsSyncMock = vi.fn(() => true);

  const audioInstances: ServiceTestSetup["mocks"]["audioInstances"] = [];
  const vadInstances: ServiceTestSetup["mocks"]["vadInstances"] = [];
  const transcriberInstances: ServiceTestSetup["mocks"]["transcriberInstances"] = [];
  const loggerInstances: ServiceTestSetup["mocks"]["loggerInstances"] = [];
  const speakerInstances: ServiceTestSetup["mocks"]["speakerInstances"] = [];

  const listDevicesMock = vi.fn(() => options.deviceList ?? [
    { id: -1, name: "Microsoft Sound Mapper - Input", maxInputChannels: 1 },
    { id: 5, name: "USB Mic", maxInputChannels: 1 },
  ]);

  class MockAudioCapture extends EventEmitter {
    static listDevices = listDevicesMock;

    start = vi.fn();
    stop = vi.fn();
    getSampleRate = vi.fn(() => options.captureSampleRate ?? this.options.sampleRate);

    constructor(public options: { deviceId: number | null; sampleRate: number }) {
      super();
      audioInstances.push(this);
    }
  }

  class MockVAD extends EventEmitter {
    init = options.vadInitReject
      ? vi.fn().mockRejectedValue(options.vadInitReject)
      : vi.fn().mockResolvedValue(undefined);
    processAudio = vi.fn().mockResolvedValue(undefined);
    destroy = vi.fn().mockResolvedValue(undefined);

    constructor(public options: { threshold: number; silenceThresholdMs: number; sampleRate: number }) {
      super();
      vadInstances.push(this);
    }
  }

  class MockTranscriber {
    transcribe = vi.fn(() => "hello from mock");

    constructor(public modelDir: string, public sampleRate: number) {
      transcriberInstances.push(this);
    }
  }

  class MockLogger {
    write = vi.fn();
    close = vi.fn();

    constructor(public outputDir: string) {
      loggerInstances.push(this);
    }
  }

  class MockSpeakerIdentifier {
    identify = vi.fn(() => "Speaker_1");

    constructor(
      public modelPath: string,
      public sampleRate: number,
      public threshold: number,
      public storagePath: string,
    ) {
      speakerInstances.push(this);
    }
  }

  vi.doMock("../src/audio-capture", () => ({ AudioCapture: MockAudioCapture }));
  vi.doMock("../src/vad", () => ({ VoiceActivityDetector: MockVAD }));
  vi.doMock("../src/transcriber", () => ({ Transcriber: MockTranscriber }));
  vi.doMock("../src/logger", () => ({ TranscriptionLogger: MockLogger }));
  vi.doMock("../src/speaker-identifier", () => ({ SpeakerIdentifier: MockSpeakerIdentifier }));
  vi.doMock("../src/config", () => ({ loadConfig: loadConfigMock }));
  vi.doMock("../src/model-downloader", () => ({
    downloadModel: downloadModelMock,
    downloadSpeaker: downloadSpeakerMock,
  }));
  vi.doMock("fs", async () => {
    const actual = await vi.importActual<typeof import("fs")>("fs");
    return {
      ...actual,
      existsSync: existsSyncMock,
    };
  });

  const { TranscriberService } = await import("../src/service");

  return {
    TranscriberService,
    config,
    mocks: {
      loadConfigMock,
      downloadModelMock,
      downloadSpeakerMock,
      audioInstances,
      vadInstances,
      transcriberInstances,
      loggerInstances,
      speakerInstances,
      listDevicesMock,
      existsSyncMock,
    },
  };
}

describe("TranscriberService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("downloads missing ASR model and starts all components", async () => {
    const { TranscriberService, config, mocks } = await loadServiceModule();
    mocks.existsSyncMock.mockImplementation((p: string) => p !== config.modelDir);

    const service = new TranscriberService(path.resolve("config.json"));
    await service.start();

    expect(mocks.loadConfigMock).toHaveBeenCalledTimes(1);
    expect(mocks.downloadModelMock).toHaveBeenCalledWith("parakeet", path.resolve("./models"));
    expect(mocks.downloadSpeakerMock).not.toHaveBeenCalled();
    expect(mocks.listDevicesMock).toHaveBeenCalledTimes(1);
    expect(mocks.audioInstances[0].start).toHaveBeenCalledTimes(1);
    expect(mocks.vadInstances[0].init).toHaveBeenCalledTimes(1);
    expect(mocks.vadInstances[0].options.sampleRate).toBe(16000);
  });

  it("downloads missing speaker model and starts all components", async () => {
    const { TranscriberService, config, mocks } = await loadServiceModule();
    mocks.existsSyncMock.mockImplementation((p: string) => p !== config.speakerModelPath);

    const service = new TranscriberService(path.resolve("config.json"));
    await service.start();

    expect(mocks.downloadModelMock).not.toHaveBeenCalled();
    expect(mocks.downloadSpeakerMock).toHaveBeenCalledWith(path.dirname(config.speakerModelPath));
    expect(mocks.listDevicesMock).toHaveBeenCalledTimes(1);
    expect(mocks.audioInstances[0].start).toHaveBeenCalledTimes(1);
    expect(mocks.vadInstances[0].init).toHaveBeenCalledTimes(1);
  });

  it("processes speech events and writes rounded entries", async () => {
    const { TranscriberService, mocks } = await loadServiceModule();
    mocks.existsSyncMock.mockReturnValue(true);

    const service = new TranscriberService(path.resolve("config.json"));
    await service.start();

    const speechAudio = readWavSamples(path.join(process.cwd(), "test-assets", "audio", "digit0_george.wav"));
    mocks.transcriberInstances[0].transcribe.mockReturnValue("recognized phrase");
    mocks.speakerInstances[0].identify.mockReturnValue("Speaker_42");

    const startTime = new Date("2026-02-20T10:00:00.000Z");
    mocks.vadInstances[0].emit("speech", {
      audio: speechAudio,
      startTime,
      duration: 1.236,
    });

    const decodeInput = mocks.transcriberInstances[0].transcribe.mock.calls[0][0] as Float32Array;
    expect(decodeInput.length).toBe(speechAudio.length);
    expect(mocks.speakerInstances[0].identify).toHaveBeenCalledWith(speechAudio);
    expect(mocks.loggerInstances[0].write).toHaveBeenCalledWith({
      ts: startTime.toISOString(),
      duration: 1.24,
      text: "recognized phrase",
      speaker: "Speaker_42",
    });
  });

  it("boosts quiet segments before ASR decode", async () => {
    const { TranscriberService, mocks } = await loadServiceModule();
    mocks.existsSyncMock.mockReturnValue(true);

    const service = new TranscriberService(path.resolve("config.json"));
    await service.start();

    const quiet = new Float32Array([0.01, -0.02, 0.015, -0.01]);
    mocks.vadInstances[0].emit("speech", {
      audio: quiet,
      startTime: new Date("2026-02-20T10:00:00.000Z"),
      duration: 0.2,
    });

    const decodeInput = mocks.transcriberInstances[0].transcribe.mock.calls[0][0] as Float32Array;
    expect(decodeInput).not.toBe(quiet);
    expect(decodeInput[0]).toBeCloseTo(0.08, 6);
    expect(decodeInput[1]).toBeCloseTo(-0.16, 6);
  });

  it("applies ASR noise gate when configured", async () => {
    const { TranscriberService, mocks } = await loadServiceModule({ asrNoiseGateRms: 0.02 });
    mocks.existsSyncMock.mockReturnValue(true);

    const service = new TranscriberService(path.resolve("config.json"));
    await service.start();

    const lowLevel = new Float32Array([0.001, -0.001, 0.001, -0.001]);
    mocks.vadInstances[0].emit("speech", {
      audio: lowLevel,
      startTime: new Date("2026-02-20T10:00:00.000Z"),
      duration: 0.2,
    });

    const decodeInput = mocks.transcriberInstances[0].transcribe.mock.calls[0][0] as Float32Array;
    expect(Array.from(decodeInput)).toEqual([0, 0, 0, 0]);
  });

  it("prepends overlap tail and deduplicates repeated prefix", async () => {
    const { TranscriberService, mocks } = await loadServiceModule({ asrOverlapMs: 300, asrOverlapMaxGapMs: 600 });
    mocks.existsSyncMock.mockReturnValue(true);

    const service = new TranscriberService(path.resolve("config.json"));
    await service.start();

    const firstAudio = new Float32Array(10000);
    const secondAudio = new Float32Array(8000);
    for (let i = 0; i < firstAudio.length; i++) {
      firstAudio[i] = i / firstAudio.length;
    }
    for (let i = 0; i < secondAudio.length; i++) {
      secondAudio[i] = -i / secondAudio.length;
    }

    mocks.transcriberInstances[0].transcribe
      .mockReturnValueOnce("привет мир")
      .mockReturnValueOnce("мир как дела");

    mocks.vadInstances[0].emit("speech", {
      audio: firstAudio,
      startTime: new Date("2026-02-20T10:00:00.000Z"),
      duration: 1,
    });

    mocks.vadInstances[0].emit("speech", {
      audio: secondAudio,
      startTime: new Date("2026-02-20T10:00:01.200Z"),
      duration: 0.5,
    });

    const secondCallInput = mocks.transcriberInstances[0].transcribe.mock.calls[1][0] as Float32Array;
    expect(secondCallInput.length).toBe(4800 + secondAudio.length);
    expect(Array.from(secondCallInput.slice(0, 3))).toEqual(Array.from(firstAudio.slice(firstAudio.length - 4800, firstAudio.length - 4797)));
    expect(Array.from(secondCallInput.slice(4800, 4803))).toEqual(Array.from(secondAudio.slice(0, 3)));

    expect(mocks.speakerInstances[0].identify.mock.calls[1][0]).toBe(secondAudio);
    expect(mocks.loggerInstances[0].write.mock.calls[1][0].text).toBe("как дела");
  });

  it("keeps text unchanged when overlap has no textual prefix match", async () => {
    const { TranscriberService, mocks } = await loadServiceModule({ asrOverlapMs: 300, asrOverlapMaxGapMs: 600 });
    mocks.existsSyncMock.mockReturnValue(true);

    const service = new TranscriberService(path.resolve("config.json"));
    await service.start();

    mocks.transcriberInstances[0].transcribe
      .mockReturnValueOnce("один два")
      .mockReturnValueOnce("три четыре");

    mocks.vadInstances[0].emit("speech", {
      audio: new Float32Array(4000),
      startTime: new Date("2026-02-20T10:00:00.000Z"),
      duration: 1,
    });

    mocks.vadInstances[0].emit("speech", {
      audio: new Float32Array(2000),
      startTime: new Date("2026-02-20T10:00:01.200Z"),
      duration: 0.5,
    });

    expect(mocks.loggerInstances[0].write.mock.calls[1][0].text).toBe("три четыре");
  });

  it("drops overlap-only whitespace transcripts", async () => {
    const { TranscriberService, mocks } = await loadServiceModule({ asrOverlapMs: 300, asrOverlapMaxGapMs: 600 });
    mocks.existsSyncMock.mockReturnValue(true);

    const service = new TranscriberService(path.resolve("config.json"));
    await service.start();

    mocks.transcriberInstances[0].transcribe
      .mockReturnValueOnce("hello")
      .mockReturnValueOnce("   ");

    mocks.vadInstances[0].emit("speech", {
      audio: new Float32Array(4000),
      startTime: new Date("2026-02-20T10:00:00.000Z"),
      duration: 1,
    });

    mocks.vadInstances[0].emit("speech", {
      audio: new Float32Array(2000),
      startTime: new Date("2026-02-20T10:00:01.100Z"),
      duration: 0.5,
    });

    expect(mocks.loggerInstances[0].write).toHaveBeenCalledTimes(1);
  });

  it("does not prepend overlap after long silence", async () => {
    const { TranscriberService, mocks } = await loadServiceModule({ asrOverlapMs: 300, asrOverlapMaxGapMs: 600 });
    mocks.existsSyncMock.mockReturnValue(true);

    const service = new TranscriberService(path.resolve("config.json"));
    await service.start();

    const firstAudio = new Float32Array(1000);
    const secondAudio = new Float32Array(1000);

    mocks.vadInstances[0].emit("speech", {
      audio: firstAudio,
      startTime: new Date("2026-02-20T10:00:00.000Z"),
      duration: 1,
    });

    mocks.vadInstances[0].emit("speech", {
      audio: secondAudio,
      startTime: new Date("2026-02-20T10:00:03.000Z"),
      duration: 0.5,
    });

    expect(mocks.transcriberInstances[0].transcribe.mock.calls[1][0]).toBe(secondAudio);
  });

  it("supports disabling overlap", async () => {
    const { TranscriberService, mocks } = await loadServiceModule({ asrOverlapMs: 0, asrOverlapMaxGapMs: 600 });
    mocks.existsSyncMock.mockReturnValue(true);

    const service = new TranscriberService(path.resolve("config.json"));
    await service.start();

    const firstAudio = new Float32Array(1000);
    const secondAudio = new Float32Array(1000);

    mocks.vadInstances[0].emit("speech", {
      audio: firstAudio,
      startTime: new Date("2026-02-20T10:00:00.000Z"),
      duration: 1,
    });

    mocks.vadInstances[0].emit("speech", {
      audio: secondAudio,
      startTime: new Date("2026-02-20T10:00:01.100Z"),
      duration: 0.5,
    });

    expect(mocks.transcriberInstances[0].transcribe.mock.calls[1][0]).toBe(secondAudio);
  });

  it("skips write when recognizer returns empty text", async () => {
    const { TranscriberService, mocks } = await loadServiceModule();
    mocks.existsSyncMock.mockReturnValue(true);

    const service = new TranscriberService(path.resolve("config.json"));
    await service.start();

    mocks.transcriberInstances[0].transcribe.mockReturnValue("");
    mocks.vadInstances[0].emit("speech", {
      audio: new Float32Array(320),
      startTime: new Date("2026-02-20T10:00:00.000Z"),
      duration: 0.2,
    });

    expect(mocks.loggerInstances[0].write).not.toHaveBeenCalled();
    expect(mocks.speakerInstances[0].identify).not.toHaveBeenCalled();
  });

  it("handles transcription errors without crashing", async () => {
    const { TranscriberService, mocks } = await loadServiceModule();
    mocks.existsSyncMock.mockReturnValue(true);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const service = new TranscriberService(path.resolve("config.json"));
    await service.start();

    mocks.transcriberInstances[0].transcribe.mockImplementation(() => {
      throw new Error("decode failed");
    });

    mocks.vadInstances[0].emit("speech", {
      audio: new Float32Array(320),
      startTime: new Date("2026-02-20T10:00:00.000Z"),
      duration: 0.2,
    });

    expect(consoleError).toHaveBeenCalled();
    expect(mocks.loggerInstances[0].write).not.toHaveBeenCalled();
  });

  it("forwards audio chunks to VAD and logs audio/VAD errors", async () => {
    const { TranscriberService, mocks } = await loadServiceModule();
    mocks.existsSyncMock.mockReturnValue(true);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const service = new TranscriberService(path.resolve("config.json"));
    await service.start();

    const chunk = new Float32Array([0.2, -0.2, 0.1]);
    const vadError = new Error("vad failed");
    mocks.vadInstances[0].processAudio.mockRejectedValueOnce(vadError);

    mocks.audioInstances[0].emit("audio", chunk);
    await Promise.resolve();

    expect(mocks.vadInstances[0].processAudio).toHaveBeenCalledWith(chunk);
    expect(consoleError).toHaveBeenCalledWith("VAD error:", vadError);

    const audioError = new Error("audio failed");
    mocks.audioInstances[0].emit("error", audioError);
    expect(consoleError).toHaveBeenCalledWith("Audio capture error:", audioError);
  });

  it("boosts quiet input chunks before VAD", async () => {
    const { TranscriberService, mocks } = await loadServiceModule();
    mocks.existsSyncMock.mockReturnValue(true);

    const service = new TranscriberService(path.resolve("config.json"));
    await service.start();

    const quiet = new Float32Array([0.005, -0.005, 0.004]);
    mocks.audioInstances[0].emit("audio", quiet);
    await Promise.resolve();

    const vadInput = mocks.vadInstances[0].processAudio.mock.calls[0][0] as Float32Array;
    expect(vadInput).not.toBe(quiet);
    expect(vadInput[0]).toBeCloseTo(0.12, 5);
    expect(vadInput[1]).toBeCloseTo(-0.12, 5);
  });

  it("applies VAD noise gate when configured", async () => {
    const { TranscriberService, mocks } = await loadServiceModule({ vadInputNoiseGateRms: 0.01 });
    mocks.existsSyncMock.mockReturnValue(true);

    const service = new TranscriberService(path.resolve("config.json"));
    await service.start();

    mocks.audioInstances[0].emit("audio", new Float32Array([0.001, -0.001, 0.0005]));
    await Promise.resolve();

    const vadInput = mocks.vadInstances[0].processAudio.mock.calls[0][0] as Float32Array;
    expect(Array.from(vadInput)).toEqual([0, 0, 0]);
  });

  it("stops only when service is running", async () => {
    const { TranscriberService, mocks } = await loadServiceModule();
    mocks.existsSyncMock.mockReturnValue(true);

    const service = new TranscriberService(path.resolve("config.json"));
    await service.stop();
    expect(mocks.audioInstances).toHaveLength(0);

    await service.start();
    await service.stop();

    expect(mocks.audioInstances[0].stop).toHaveBeenCalledTimes(1);
    expect(mocks.vadInstances[0].destroy).toHaveBeenCalledTimes(1);
    expect(mocks.loggerInstances[0].close).toHaveBeenCalledTimes(1);
  });

  it("uses explicit microphone id when configured device exists", async () => {
    const { TranscriberService, mocks } = await loadServiceModule({ audioDevice: 5 });
    mocks.existsSyncMock.mockReturnValue(true);

    const service = new TranscriberService(path.resolve("config.json"));
    await service.start();

    expect(mocks.audioInstances[0].options.deviceId).toBe(5);
  });

  it("falls back to a physical microphone when configured id is missing", async () => {
    const { TranscriberService, mocks } = await loadServiceModule(
      { audioDevice: 99 },
      {
        deviceList: [
          { id: -1, name: "Microsoft Sound Mapper - Input", maxInputChannels: 1 },
          { id: 5, name: "USB Mic", maxInputChannels: 1 },
        ],
      },
    );
    mocks.existsSyncMock.mockReturnValue(true);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const service = new TranscriberService(path.resolve("config.json"));
    await service.start();

    expect(mocks.audioInstances[0].options.deviceId).toBe(5);
    expect(consoleWarn).toHaveBeenCalledWith(
      "Configured audioDevice id=99 not found. Falling back to automatic input selection.",
    );
  });

  it("falls back to first input device when default marker is unavailable", async () => {
    const { TranscriberService, mocks } = await loadServiceModule(
      { audioDevice: 99 },
      {
        deviceList: [{ id: 5, name: "USB Mic", maxInputChannels: 1 }],
      },
    );
    mocks.existsSyncMock.mockReturnValue(true);

    const service = new TranscriberService(path.resolve("config.json"));
    await service.start();

    expect(mocks.audioInstances[0].options.deviceId).toBe(5);
  });

  it("prefers physical microphone over sound mapper by default", async () => {
    const { TranscriberService, mocks } = await loadServiceModule(
      { audioDevice: null },
      {
        deviceList: [
          { id: -1, name: "Microsoft Sound Mapper - Input", maxInputChannels: 1 },
          { id: 7, name: "Realtek Mic", maxInputChannels: 1 },
        ],
      },
    );
    mocks.existsSyncMock.mockReturnValue(true);

    const service = new TranscriberService(path.resolve("config.json"));
    await service.start();

    expect(mocks.audioInstances[0].options.deviceId).toBe(7);
  });

  it("uses sound mapper when it is the only available input", async () => {
    const { TranscriberService, mocks } = await loadServiceModule(
      { audioDevice: null },
      {
        deviceList: [{ id: -1, name: "Microsoft Sound Mapper - Input", maxInputChannels: 1 }],
      },
    );
    mocks.existsSyncMock.mockReturnValue(true);

    const service = new TranscriberService(path.resolve("config.json"));
    await service.start();

    expect(mocks.audioInstances[0].options.deviceId).toBe(-1);
  });

  it("starts even when input device list is empty", async () => {
    const { TranscriberService, mocks } = await loadServiceModule(
      { audioDevice: null },
      { deviceList: [] },
    );
    mocks.existsSyncMock.mockReturnValue(true);

    const service = new TranscriberService(path.resolve("config.json"));
    await service.start();

    expect(mocks.audioInstances[0].options.deviceId).toBeNull();
  });

  it("cleans up partially initialized resources when start fails", async () => {
    const startupError = new Error("vad init failed");
    const { TranscriberService, mocks } = await loadServiceModule({}, { vadInitReject: startupError });
    mocks.existsSyncMock.mockReturnValue(true);

    const service = new TranscriberService(path.resolve("config.json"));
    await expect(service.start()).rejects.toThrow("vad init failed");

    expect(mocks.loggerInstances[0].close).toHaveBeenCalledTimes(1);
    expect(mocks.audioInstances).toHaveLength(1);
    expect(mocks.audioInstances[0].stop).toHaveBeenCalledTimes(1);
  });

  it("continues stop cleanup even if one component throws", async () => {
    const { TranscriberService, mocks } = await loadServiceModule();
    mocks.existsSyncMock.mockReturnValue(true);

    const service = new TranscriberService(path.resolve("config.json"));
    await service.start();

    const audioStopError = new Error("audio stop failed");
    const vadDestroyError = new Error("vad destroy failed");
    const loggerCloseError = new Error("logger close failed");

    mocks.audioInstances[0].stop.mockImplementation(() => {
      throw audioStopError;
    });
    mocks.vadInstances[0].destroy.mockRejectedValueOnce(vadDestroyError);
    mocks.loggerInstances[0].close.mockImplementation(() => {
      throw loggerCloseError;
    });

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(service.stop()).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith("Audio stop error:", audioStopError);
    expect(consoleError).toHaveBeenCalledWith("VAD destroy error:", vadDestroyError);
    expect(consoleError).toHaveBeenCalledWith("Logger close error:", loggerCloseError);
  });

  it("does not restart components when start is called twice", async () => {
    const { TranscriberService, mocks } = await loadServiceModule();
    mocks.existsSyncMock.mockReturnValue(true);

    const service = new TranscriberService(path.resolve("config.json"));
    await service.start();
    await service.start();

    expect(mocks.audioInstances).toHaveLength(1);
    expect(mocks.audioInstances[0].start).toHaveBeenCalledTimes(1);
  });

  it("ignores late audio and speech events after cleanup", async () => {
    const { TranscriberService, mocks } = await loadServiceModule();
    mocks.existsSyncMock.mockReturnValue(true);

    const service = new TranscriberService(path.resolve("config.json"));
    await service.start();

    const oldAudio = mocks.audioInstances[0];
    const oldVad = mocks.vadInstances[0];

    await service.stop();

    oldAudio.emit("audio", new Float32Array([0.1, -0.1]));
    oldVad.emit("speech", {
      audio: new Float32Array(160),
      startTime: new Date("2026-02-20T10:00:00.000Z"),
      duration: 0.01,
    });

    expect(mocks.transcriberInstances[0].transcribe).not.toHaveBeenCalled();
    expect(mocks.loggerInstances[0].write).not.toHaveBeenCalled();
  });

  it("covers gigaam model label branch", async () => {
    const { TranscriberService, mocks } = await loadServiceModule({ model: "gigaam" });
    mocks.existsSyncMock.mockReturnValue(true);
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const service = new TranscriberService(path.resolve("config.json"));
    await service.start();

    expect(consoleLog).toHaveBeenCalledWith("GigaAM v2 model loaded");
  });

  it("uses capture backend sample rate for VAD when it differs", async () => {
    const { TranscriberService, mocks } = await loadServiceModule({}, { captureSampleRate: 48000 });
    mocks.existsSyncMock.mockReturnValue(true);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const service = new TranscriberService(path.resolve("config.json"));
    await service.start();

    expect(mocks.audioInstances[0].options.sampleRate).toBe(16000);
    expect(mocks.audioInstances[0].getSampleRate).toHaveBeenCalledTimes(1);
    expect(mocks.vadInstances[0].options.sampleRate).toBe(48000);
    expect(consoleWarn).toHaveBeenCalledWith(
      "Requested capture sampleRate=16000Hz, using 48000Hz from audio backend.",
    );
  });
});
