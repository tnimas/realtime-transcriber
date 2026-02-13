// src/vad.ts
import { RealTimeVAD, type RealTimeVADOptions } from "avr-vad";
import { EventEmitter } from "events";

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
    // Each frame = 1536 samples at 16kHz = 96ms
    const frameDurationMs = (1536 / 16000) * 1000;
    const redemptionFrames = Math.round(this.opts.silenceThresholdMs / frameDurationMs);

    this.vad = await RealTimeVAD.new({
      sampleRate: this.opts.sampleRate,
      positiveSpeechThreshold: this.opts.threshold,
      negativeSpeechThreshold: this.opts.threshold - 0.15,
      redemptionFrames,
      onSpeechStart: () => {
        this.speechStartTime = new Date();
      },
      onSpeechEnd: (audio: Float32Array) => {
        const duration = audio.length / 16000; // avr-vad resamples to 16kHz internally
        this.emit("speech", {
          audio,
          startTime: this.speechStartTime!,
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
