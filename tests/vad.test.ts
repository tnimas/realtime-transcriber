import { afterEach, describe, expect, it, vi } from "vitest";

const startSpy = vi.fn();
const processAudioSpy = vi.fn().mockResolvedValue(undefined);
const destroySpy = vi.fn();
let capturedOptions: Record<string, unknown> | null = null;

vi.mock("avr-vad", () => ({
  RealTimeVAD: {
    new: vi.fn(async (options: Record<string, unknown>) => {
      capturedOptions = options;
      return {
        start: startSpy,
        processAudio: processAudioSpy,
        destroy: destroySpy,
      };
    }),
  },
}));

import { VoiceActivityDetector } from "../src/vad";

describe("VoiceActivityDetector", () => {
  afterEach(() => {
    vi.clearAllMocks();
    capturedOptions = null;
  });

  it("initializes RealTimeVAD with expected thresholds", async () => {
    const vad = new VoiceActivityDetector({ threshold: 0.5, silenceThresholdMs: 800, sampleRate: 16000 });
    await vad.init();

    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(capturedOptions).toMatchObject({
      sampleRate: 16000,
      positiveSpeechThreshold: 0.5,
      negativeSpeechThreshold: 0.35,
      frameSamples: 512,
      minSpeechFrames: 6,
      preSpeechPadFrames: 3,
      redemptionFrames: 25,
    });
  });

  it("clamps negativeSpeechThreshold and minimum redemptionFrames", async () => {
    const vad = new VoiceActivityDetector({ threshold: 0.1, silenceThresholdMs: 1, sampleRate: 16000 });
    await vad.init();

    expect(capturedOptions).toMatchObject({
      negativeSpeechThreshold: 0,
      redemptionFrames: 1,
    });
  });

  it("emits speech event with start time and duration", async () => {
    const vad = new VoiceActivityDetector({ threshold: 0.5, silenceThresholdMs: 800, sampleRate: 16000 });
    const onSpeech = vi.fn();
    vad.on("speech", onSpeech);

    await vad.init();
    (capturedOptions?.onSpeechStart as () => void)();

    const audio = new Float32Array(32000);
    (capturedOptions?.onSpeechEnd as (audio: Float32Array) => void)(audio);

    const payload = onSpeech.mock.calls[0][0] as {
      audio: Float32Array;
      startTime: Date;
      duration: number;
    };

    expect(payload.audio).toBe(audio);
    expect(payload.startTime instanceof Date).toBe(true);
    expect(payload.duration).toBe(2);
  });

  it("uses fallback start time if speech end arrives first", async () => {
    const vad = new VoiceActivityDetector({ threshold: 0.5, silenceThresholdMs: 800, sampleRate: 16000 });
    const onSpeech = vi.fn();
    vad.on("speech", onSpeech);

    await vad.init();
    (capturedOptions?.onSpeechEnd as (audio: Float32Array) => void)(new Float32Array(16000));

    const payload = onSpeech.mock.calls[0][0] as { startTime: Date; duration: number };
    expect(payload.startTime instanceof Date).toBe(true);
    expect(payload.duration).toBe(1);
  });

  it("forwards processAudio and destroy calls", async () => {
    const vad = new VoiceActivityDetector({ threshold: 0.5, silenceThresholdMs: 800, sampleRate: 16000 });
    await vad.init();

    const audio = new Float32Array([0.1, -0.1]);
    await vad.processAudio(audio);
    await vad.destroy();

    expect(processAudioSpy).toHaveBeenCalledWith(audio);
    expect(destroySpy).toHaveBeenCalledTimes(1);
  });
});
