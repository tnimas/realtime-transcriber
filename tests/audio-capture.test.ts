import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";

type AudioIoMock = EventEmitter & {
  start: ReturnType<typeof vi.fn>;
  quit: ReturnType<typeof vi.fn>;
  inOptions?: unknown;
};

let lastAudioIO: AudioIoMock | null = null;
let audioIOFactory: ReturnType<typeof vi.fn>;
let getDevices: ReturnType<typeof vi.fn>;
let unsupportedRates = new Set<number>();
let alwaysFail = false;

async function loadAudioCaptureModule() {
  vi.resetModules();
  lastAudioIO = null;
  unsupportedRates = new Set<number>();
  alwaysFail = false;

  audioIOFactory = vi.fn((opts: { inOptions: { sampleRate: number } }) => {
    if (alwaysFail || unsupportedRates.has(opts.inOptions.sampleRate)) {
      throw new Error(`Format not supported: Invalid sample rate (${opts.inOptions.sampleRate})`);
    }

    const io = Object.assign(new EventEmitter(), {
      start: vi.fn(),
      quit: vi.fn(),
      inOptions: opts.inOptions,
    }) as AudioIoMock;

    lastAudioIO = io;
    return io;
  });

  getDevices = vi.fn(() => [
    { id: -1, name: "Default", maxInputChannels: 1, defaultSampleRate: 44100, hostAPIName: "MME", isDefaultInput: true },
    { id: 2, name: "Mic 2", maxInputChannels: 2, defaultSampleRate: 48000, hostAPIName: "Windows WASAPI", isDefaultInput: false },
    { id: 5, name: "Output only", maxInputChannels: 0 },
  ]);

  vi.doMock("naudiodon", () => ({
    AudioIO: audioIOFactory,
    SampleFormat16Bit: 16,
    getDevices,
  }));

  return import("../src/audio-capture");
}

function readWavPcmChunk(filePath: string, bytes: number): Buffer {
  const buffer = fs.readFileSync(filePath);
  const dataChunkOffset = buffer.indexOf("data");
  if (dataChunkOffset === -1) throw new Error("WAV data chunk not found");

  const dataSize = buffer.readUInt32LE(dataChunkOffset + 4);
  const pcmStart = dataChunkOffset + 8;
  const size = Math.min(bytes, dataSize);
  return buffer.subarray(pcmStart, pcmStart + size);
}

describe("AudioCapture", () => {
  it("configures naudiodon with default device when deviceId is null", async () => {
    const { AudioCapture } = await loadAudioCaptureModule();
    const capture = new AudioCapture({ deviceId: null, sampleRate: 16000 });

    expect(audioIOFactory).toHaveBeenCalledTimes(1);
    expect(lastAudioIO?.inOptions).toMatchObject({ deviceId: -1, sampleRate: 16000, channelCount: 1 });
    expect(capture.getSampleRate()).toBe(16000);
  });

  it("falls back to device default sample rate when preferred rate is unsupported", async () => {
    const { AudioCapture } = await loadAudioCaptureModule();
    unsupportedRates.add(16000);

    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const capture = new AudioCapture({ deviceId: 2, sampleRate: 16000 });

    expect(audioIOFactory).toHaveBeenCalledTimes(2);
    expect(capture.getSampleRate()).toBe(48000);
    expect(lastAudioIO?.inOptions).toMatchObject({ deviceId: 2, sampleRate: 48000 });
    expect(consoleWarn).toHaveBeenCalledWith("Audio input Mic 2 does not support 16000Hz. Using 48000Hz.");
  });

  it("throws clear error when no sample rate can open the device", async () => {
    const { AudioCapture } = await loadAudioCaptureModule();
    alwaysFail = true;

    expect(() => new AudioCapture({ deviceId: 999, sampleRate: 16000 })).toThrow("Unable to open audio input id=999");
  });

  it("converts incoming PCM16 data to Float32 audio", async () => {
    const { AudioCapture } = await loadAudioCaptureModule();
    const capture = new AudioCapture({ deviceId: 2, sampleRate: 16000 });
    const wavPath = path.join(process.cwd(), "test-assets", "audio", "digit1_jackson.wav");
    const pcmChunk = readWavPcmChunk(wavPath, 200);

    const onAudio = vi.fn();
    capture.on("audio", onAudio);
    lastAudioIO?.emit("data", pcmChunk);

    const emitted = onAudio.mock.calls[0][0] as Float32Array;
    const firstInt16 = pcmChunk.readInt16LE(0);

    expect(emitted.length).toBe(pcmChunk.length / 2);
    expect(emitted[0]).toBeCloseTo(firstInt16 / 32768, 6);
  });

  it("re-emits errors from audio backend", async () => {
    const { AudioCapture } = await loadAudioCaptureModule();
    const capture = new AudioCapture({ deviceId: 2, sampleRate: 16000 });
    const onError = vi.fn();
    capture.on("error", onError);

    const err = new Error("backend failure");
    lastAudioIO?.emit("error", err);

    expect(onError).toHaveBeenCalledWith(err);
  });

  it("starts and stops underlying stream", async () => {
    const { AudioCapture } = await loadAudioCaptureModule();
    const capture = new AudioCapture({ deviceId: 2, sampleRate: 16000 });
    capture.start();
    capture.stop();

    expect(lastAudioIO?.start).toHaveBeenCalledTimes(1);
    expect(lastAudioIO?.quit).toHaveBeenCalledTimes(1);
  });

  it("lists input-capable devices only", async () => {
    const { AudioCapture } = await loadAudioCaptureModule();
    const devices = AudioCapture.listDevices();

    expect(getDevices).toHaveBeenCalledTimes(1);
    expect(devices.map((d) => d.id)).toEqual([-1, 2]);
    expect(devices[1].hostAPIName).toBe("Windows WASAPI");
    expect(devices[1].defaultSampleRate).toBe(48000);
  });
});
