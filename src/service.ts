// src/service.ts
import { AudioCapture } from "./audio-capture";
import { VoiceActivityDetector } from "./vad";
import { Transcriber } from "./transcriber";
import { FileWriter } from "./file-writer";
import { loadConfig, TranscriberConfig } from "./config";

export class TranscriberService {
  private config: TranscriberConfig;
  private audioCapture!: AudioCapture;
  private vad!: VoiceActivityDetector;
  private transcriber!: Transcriber;
  private fileWriter!: FileWriter;
  private running = false;

  constructor(configPath: string) {
    this.config = loadConfig(configPath);
  }

  async start(): Promise<void> {
    console.log("Starting transcriber service...");
    console.log("Output directory:", this.config.outputDir);

    // Initialize components
    this.fileWriter = new FileWriter(this.config.outputDir);

    this.transcriber = new Transcriber(this.config.modelDir, this.config.sampleRate);
    console.log("Parakeet v3 model loaded");

    this.vad = new VoiceActivityDetector({
      modelPath: this.config.vadModelPath,
      threshold: this.config.vadThreshold,
      silenceThresholdMs: this.config.vadSilenceThreshold,
      sampleRate: this.config.sampleRate as 16000 | 8000,
    });
    await this.vad.init();
    console.log("Silero VAD loaded");

    // Wire up: VAD speech event → transcribe → write
    this.vad.on("speech", (event: { audio: Float32Array; startTime: Date; duration: number }) => {
      try {
        const text = this.transcriber.transcribe(event.audio);
        if (text.length > 0) {
          this.fileWriter.write({
            ts: event.startTime.toISOString(),
            duration: Math.round(event.duration * 100) / 100,
            text,
          });
          console.log(`[${event.startTime.toISOString()}] (${event.duration.toFixed(1)}s) ${text}`);
        }
      } catch (err) {
        console.error("Transcription error:", err);
      }
    });

    // Start audio capture
    this.audioCapture = new AudioCapture({
      deviceId: this.config.audioDevice,
      sampleRate: this.config.sampleRate,
    });

    this.audioCapture.on("audio", (audio: Float32Array) => {
      this.vad.processAudio(audio).catch((err: Error) => {
        console.error("VAD error:", err);
      });
    });

    this.audioCapture.on("error", (err: Error) => {
      console.error("Audio capture error:", err);
    });

    this.audioCapture.start();
    this.running = true;
    console.log("Service started. Listening...");
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    console.log("Stopping transcriber service...");
    this.audioCapture.stop();
    await this.vad.destroy();
    this.fileWriter.close();
    this.running = false;
    console.log("Service stopped.");
  }
}
