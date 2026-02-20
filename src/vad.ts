// src/vad.ts
import { RealTimeVAD, type RealTimeVADOptions } from "avr-vad";
import { EventEmitter } from "events";

const VAD_OUTPUT_SAMPLE_RATE = 16000;
const VAD_FRAME_SAMPLES = 512;
const VAD_MIN_SPEECH_FRAMES = 6;
const VAD_PRE_SPEECH_PAD_FRAMES = 3;

export interface VADOptions {
  threshold: number;
  silenceThresholdMs: number;
  sampleRate: number;
}

export class VoiceActivityDetector extends EventEmitter {
  private vad!: RealTimeVAD;
  private opts: VADOptions;
  private speechStartTime: Date | null = null;

  constructor(opts: VADOptions) {
    super();
    this.opts = opts;
  }

  async init(): Promise<void> {
    // redemptionFrames ≈ silenceThresholdMs converted to frames
    const frameDurationMs = (VAD_FRAME_SAMPLES / VAD_OUTPUT_SAMPLE_RATE) * 1000;
    const redemptionFrames = Math.max(1, Math.round(this.opts.silenceThresholdMs / frameDurationMs));
    const negativeSpeechThreshold = Math.max(0, this.opts.threshold - 0.15);

    this.vad = await RealTimeVAD.new({
      sampleRate: this.opts.sampleRate,
      positiveSpeechThreshold: this.opts.threshold,
      negativeSpeechThreshold,
      frameSamples: VAD_FRAME_SAMPLES,
      minSpeechFrames: VAD_MIN_SPEECH_FRAMES,
      preSpeechPadFrames: VAD_PRE_SPEECH_PAD_FRAMES,
      redemptionFrames,
      onSpeechStart: () => {
        this.speechStartTime = new Date();
      },
      onSpeechEnd: (audio: Float32Array) => {
        const duration = audio.length / VAD_OUTPUT_SAMPLE_RATE; // avr-vad outputs speech in 16kHz frames
        const startTime = this.speechStartTime ?? new Date();
        this.emit("speech", {
          audio,
          startTime,
          duration,
        });
        this.speechStartTime = null;
      },
      onFrameProcessed: () => {},
      onVADMisfire: () => {},
      onSpeechRealStart: () => {},
    } satisfies Partial<RealTimeVADOptions>);

    this.vad.start();
  }

  async processAudio(audio: Float32Array): Promise<void> {
    await this.vad.processAudio(audio);
  }

  async destroy(): Promise<void> {
    this.vad.destroy();
  }
}
