// src/service.ts
import { AudioCapture, type AudioInputDevice } from "./audio-capture";
import { VoiceActivityDetector } from "./vad";
import { Transcriber } from "./transcriber";
import { TranscriptionLogger } from "./logger";
import { SpeakerIdentifier } from "./speaker-identifier";
import { loadConfig, TranscriberConfig } from "./config";
import { downloadModel, downloadSpeaker } from "./model-downloader";
import * as fs from "fs";
import * as path from "path";

const SEGMENT_SAMPLE_RATE = 16000;

type InputDevice = AudioInputDevice;

function isSoundMapperDevice(name: string): boolean {
  return /microsoft\s+sound\s+mapper/i.test(name);
}

function hostApiScore(hostAPIName?: string): number {
  const value = (hostAPIName ?? "").toLowerCase();
  if (value.includes("wasapi")) return 30;
  if (value.includes("wdm")) return 20;
  if (value.includes("mme")) return 10;
  return 0;
}

function scoreInputDevice(device: InputDevice): number {
  let score = hostApiScore(device.hostAPIName);
  if (!isSoundMapperDevice(device.name)) score += 100;
  if (device.isDefaultInput) score += 40;
  if (device.id !== -1) score += 10;
  score += Math.min(device.maxInputChannels, 2);
  return score;
}

function resolveInputDevice(devices: InputDevice[], configuredDeviceId: number | null): InputDevice | null {
  if (devices.length === 0) {
    return null;
  }

  if (configuredDeviceId !== null) {
    const configured = devices.find((d) => d.id === configuredDeviceId);
    if (configured) {
      return configured;
    }
  }

  const sorted = [...devices].sort((a, b) => scoreInputDevice(b) - scoreInputDevice(a));
  return sorted[0] ?? null;
}

function concatAudio(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

type GainStageOptions = {
  targetPeak: number;
  maxGain: number;
  minPeak: number;
  minGainToApply: number;
  noiseGateRms: number;
};

function applyGainStage(audio: Float32Array, options: GainStageOptions): Float32Array {
  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < audio.length; i++) {
    const value = audio[i];
    sumSq += value * value;
    const abs = Math.abs(value);
    if (abs > peak) peak = abs;
  }

  const rms = Math.sqrt(sumSq / Math.max(1, audio.length));
  if (options.noiseGateRms > 0 && rms < options.noiseGateRms) {
    return new Float32Array(audio.length);
  }

  if (peak < options.minPeak) {
    return audio;
  }

  const gain = Math.min(options.maxGain, options.targetPeak / peak);
  if (gain <= options.minGainToApply) {
    return audio;
  }

  const normalized = new Float32Array(audio.length);
  for (let i = 0; i < audio.length; i++) {
    const scaled = audio[i] * gain;
    normalized[i] = Math.max(-1, Math.min(1, scaled));
  }

  return normalized;
}

function normalizeToken(token: string): string {
  return token.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function dedupeOverlapText(previousText: string, currentText: string): string {
  const prevTokens = previousText.trim().split(/\s+/).filter(Boolean);
  const currTokens = currentText.trim().split(/\s+/).filter(Boolean);

  if (prevTokens.length === 0 || currTokens.length === 0) {
    return currentText.trim();
  }

  const prevNorm = prevTokens.map(normalizeToken);
  const currNorm = currTokens.map(normalizeToken);
  const maxOverlap = Math.min(prevNorm.length, currNorm.length, 12);

  for (let overlapSize = maxOverlap; overlapSize >= 1; overlapSize--) {
    let matches = true;
    for (let i = 0; i < overlapSize; i++) {
      const prev = prevNorm[prevNorm.length - overlapSize + i];
      const curr = currNorm[i];
      if (prev === "" || curr === "" || prev !== curr) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return currTokens.slice(overlapSize).join(" ").trim();
    }
  }

  return currentText.trim();
}

export class TranscriberService {
  private config: TranscriberConfig;
  private audioCapture: AudioCapture | null = null;
  private vad: VoiceActivityDetector | null = null;
  private transcriber: Transcriber | null = null;
  private fileWriter: TranscriptionLogger | null = null;
  private speakerIdentifier: SpeakerIdentifier | null = null;
  private asrOverlapSamples = 0;
  private asrOverlapMaxGapMs = 0;
  private previousSpeechTail: Float32Array | null = null;
  private lastSpeechEndMs: number | null = null;
  private previousTranscript = "";
  private running = false;

  constructor(configPath: string) {
    this.config = loadConfig(configPath);
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    console.log("Starting transcriber service...");
    console.log(`ASR model: ${this.config.model}`);
    console.log("Output directory:", this.config.outputDir);

    this.asrOverlapSamples = Math.max(0, Math.round((this.config.asrOverlapMs / 1000) * SEGMENT_SAMPLE_RATE));
    this.asrOverlapMaxGapMs = this.config.asrOverlapMaxGapMs;
    this.previousSpeechTail = null;
    this.lastSpeechEndMs = null;
    this.previousTranscript = "";

    try {
      // Auto-download ASR model if missing
      if (!fs.existsSync(this.config.modelDir)) {
        console.log("Model not found, downloading...");
        const modelsDir = path.resolve("./models");
        downloadModel(this.config.model, modelsDir);
        console.log("Model ready.");
      }

      if (!fs.existsSync(this.config.speakerModelPath)) {
        console.log("Speaker model not found, downloading...");
        downloadSpeaker(path.dirname(this.config.speakerModelPath));
        console.log("Speaker model ready.");
      }

      // Initialize components
      this.fileWriter = new TranscriptionLogger(this.config.outputDir);

      this.transcriber = new Transcriber(this.config.modelDir, SEGMENT_SAMPLE_RATE);
      const modelLabel = this.config.model === "gigaam" ? "GigaAM v2" : "Parakeet v3";
      console.log(`${modelLabel} model loaded`);

      // Start audio capture first so VAD uses the actual device sample rate
      const devices = AudioCapture.listDevices() as InputDevice[];
      const activeDevice = resolveInputDevice(devices, this.config.audioDevice);
      if (this.config.audioDevice !== null && !devices.some((d) => d.id === this.config.audioDevice)) {
        console.warn(`Configured audioDevice id=${this.config.audioDevice} not found. Falling back to automatic input selection.`);
      }

      const selectedDeviceId = activeDevice ? activeDevice.id : this.config.audioDevice;
      const deviceHost = activeDevice?.hostAPIName ? ` via ${activeDevice.hostAPIName}` : "";
      const deviceName = activeDevice ? `${activeDevice.name} (id=${activeDevice.id}${deviceHost})` : `id=${selectedDeviceId ?? "default"}`;
      console.log(`Microphone: ${deviceName}`);

      this.audioCapture = new AudioCapture({
        deviceId: selectedDeviceId,
        sampleRate: this.config.sampleRate,
      });

      const captureSampleRate = this.audioCapture.getSampleRate();
      if (captureSampleRate !== this.config.sampleRate) {
        console.warn(`Requested capture sampleRate=${this.config.sampleRate}Hz, using ${captureSampleRate}Hz from audio backend.`);
      }
      console.log(`Capture sample rate: ${captureSampleRate} Hz`);

      this.vad = new VoiceActivityDetector({
        threshold: this.config.vadThreshold,
        silenceThresholdMs: this.config.vadSilenceThreshold,
        sampleRate: captureSampleRate,
      });
      await this.vad.init();
      console.log("Silero VAD loaded");

      this.speakerIdentifier = new SpeakerIdentifier(
        this.config.speakerModelPath,
        SEGMENT_SAMPLE_RATE,
        this.config.speakerThreshold,
        path.join(this.config.outputDir, "speakers.json"),
      );
      console.log("Speaker embedding model loaded");

      // Wire up: VAD speech event → transcribe → write
      this.vad.on("speech", (event: { audio: Float32Array; startTime: Date; duration: number }) => {
        try {
          if (!this.transcriber || !this.speakerIdentifier || !this.fileWriter) {
            return;
          }

          const cleanAudio = event.audio;
          const { audioForAsr, usedOverlap } = this.prepareAudioForAsr(cleanAudio, event.startTime);
          this.updateSpeechContext(cleanAudio, event.startTime, event.duration);

          const asrAudio = applyGainStage(audioForAsr, {
            targetPeak: this.config.asrTargetPeak,
            maxGain: this.config.asrMaxGain,
            minPeak: 1e-4,
            minGainToApply: 1.05,
            noiseGateRms: this.config.asrNoiseGateRms,
          });
          const rawText = this.transcriber.transcribe(asrAudio);
          const text = usedOverlap
            ? dedupeOverlapText(this.previousTranscript, rawText)
            : rawText.trim();

          if (text.length > 0) {
            const speaker = this.speakerIdentifier.identify(cleanAudio);
            this.fileWriter.write({
              ts: event.startTime.toISOString(),
              duration: Math.round(event.duration * 100) / 100,
              text,
              speaker,
            });
            console.log(`[${event.startTime.toISOString()}] [${speaker}] (${event.duration.toFixed(1)}s) ${text}`);
            this.previousTranscript = text;
          }
        } catch (err) {
          console.error("Transcription error:", err);
        }
      });

      this.audioCapture.on("audio", (audio: Float32Array) => {
        if (!this.vad) {
          return;
        }

        const vadAudio = applyGainStage(audio, {
          targetPeak: this.config.vadInputTargetPeak,
          maxGain: this.config.vadInputMaxGain,
          minPeak: 5e-4,
          minGainToApply: 1.2,
          noiseGateRms: this.config.vadInputNoiseGateRms,
        });
        this.vad.processAudio(vadAudio).catch((err: Error) => {
          console.error("VAD error:", err);
        });
      });

      this.audioCapture.on("error", (err: Error) => {
        console.error("Audio capture error:", err);
      });

      this.audioCapture.start();
      this.running = true;
      console.log(`Service started at ${new Date().toISOString()}. Listening...`);
    } catch (err) {
      await this.cleanup();
      throw err;
    }
  }

  private async cleanup(): Promise<void> {
    const audioCapture = this.audioCapture;
    const vad = this.vad;
    const fileWriter = this.fileWriter;

    this.audioCapture = null;
    this.vad = null;
    this.transcriber = null;
    this.fileWriter = null;
    this.speakerIdentifier = null;
    this.previousSpeechTail = null;
    this.lastSpeechEndMs = null;
    this.previousTranscript = "";
    this.running = false;

    if (audioCapture) {
      try {
        audioCapture.stop();
      } catch (err) {
        console.error("Audio stop error:", err);
      }
    }

    if (vad) {
      try {
        await vad.destroy();
      } catch (err) {
        console.error("VAD destroy error:", err);
      }
    }

    if (fileWriter) {
      try {
        fileWriter.close();
      } catch (err) {
        console.error("Logger close error:", err);
      }
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    console.log("Stopping transcriber service...");
    await this.cleanup();
    console.log("Service stopped.");
  }

  private prepareAudioForAsr(audio: Float32Array, startTime: Date): { audioForAsr: Float32Array; usedOverlap: boolean } {
    if (!this.previousSpeechTail || this.lastSpeechEndMs === null || this.asrOverlapSamples <= 0) {
      return { audioForAsr: audio, usedOverlap: false };
    }

    const gapMs = startTime.getTime() - this.lastSpeechEndMs;
    if (gapMs > this.asrOverlapMaxGapMs) {
      return { audioForAsr: audio, usedOverlap: false };
    }

    return {
      audioForAsr: concatAudio(this.previousSpeechTail, audio),
      usedOverlap: true,
    };
  }

  private updateSpeechContext(audio: Float32Array, startTime: Date, duration: number): void {
    if (this.asrOverlapSamples <= 0) {
      this.previousSpeechTail = null;
    } else {
      const overlapStart = Math.max(0, audio.length - this.asrOverlapSamples);
      this.previousSpeechTail = audio.slice(overlapStart);
    }

    this.lastSpeechEndMs = startTime.getTime() + duration * 1000;
  }
}
