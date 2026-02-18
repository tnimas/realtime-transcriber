// src/service.ts
import { AudioCapture } from "./audio-capture";
import { VoiceActivityDetector } from "./vad";
import { Transcriber } from "./transcriber";
import { TranscriptionLogger } from "./logger";
import { SpeakerIdentifier } from "./speaker-identifier";
import { loadConfig, TranscriberConfig } from "./config";
import { downloadModel } from "./model-downloader";
import * as fs from "fs";
import * as path from "path";

export class TranscriberService {
  private config: TranscriberConfig;
  private audioCapture!: AudioCapture;
  private vad!: VoiceActivityDetector;
  private transcriber!: Transcriber;
  private fileWriter!: TranscriptionLogger;
  private speakerIdentifier!: SpeakerIdentifier;
  private running = false;

  constructor(configPath: string) {
    this.config = loadConfig(configPath);
  }

  async start(): Promise<void> {
    console.log("Starting transcriber service...");
    console.log(`ASR model: ${this.config.model}`);
    console.log("Output directory:", this.config.outputDir);

    // Auto-download ASR model if missing
    if (!fs.existsSync(this.config.modelDir)) {
      console.log("Model not found, downloading...");
      const modelsDir = path.resolve("./models");
      downloadModel(this.config.model, modelsDir);
      console.log("Model ready.");
    }

    // Initialize components
    this.fileWriter = new TranscriptionLogger(this.config.outputDir);

    this.transcriber = new Transcriber(this.config.modelDir, this.config.sampleRate);
    const modelLabel = this.config.model === "gigaam" ? "GigaAM v2" : "Parakeet v3";
    console.log(`${modelLabel} model loaded`);

    this.vad = new VoiceActivityDetector({
      threshold: this.config.vadThreshold,
      silenceThresholdMs: this.config.vadSilenceThreshold,
      sampleRate: this.config.sampleRate,
    });
    await this.vad.init();
    console.log("Silero VAD loaded");

    this.speakerIdentifier = new SpeakerIdentifier(
      this.config.speakerModelPath,
      this.config.sampleRate,
      this.config.speakerThreshold,
      path.join(this.config.outputDir, "speakers.json"),
    );
    console.log("Speaker embedding model loaded");

    // Wire up: VAD speech event → transcribe → write
    this.vad.on("speech", (event: { audio: Float32Array; startTime: Date; duration: number }) => {
      try {
        const text = this.transcriber.transcribe(event.audio);
        if (text.length > 0) {
          const speaker = this.speakerIdentifier.identify(event.audio);
          this.fileWriter.write({
            ts: event.startTime.toISOString(),
            duration: Math.round(event.duration * 100) / 100,
            text,
            speaker,
          });
          console.log(`[${event.startTime.toISOString()}] [${speaker}] (${event.duration.toFixed(1)}s) ${text}`);
        }
      } catch (err) {
        console.error("Transcription error:", err);
      }
    });

    // Start audio capture
    const devices = AudioCapture.listDevices();
    const activeDevice = this.config.audioDevice !== null
      ? devices.find(d => d.id === this.config.audioDevice)
      : devices.find(d => d.id === -1) || devices[0];
    const deviceName = activeDevice ? `${activeDevice.name} (id=${activeDevice.id})` : `id=${this.config.audioDevice ?? "default"}`;
    console.log(`Microphone: ${deviceName}`);

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
    console.log(`Service started at ${new Date().toISOString()}. Listening...`);
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
