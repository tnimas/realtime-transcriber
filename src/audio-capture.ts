// src/audio-capture.ts
import { EventEmitter } from "events";
import * as portAudio from "naudiodon";

const FALLBACK_SAMPLE_RATES = [48000, 44100, 32000, 24000, 22050, 16000] as const;
const AUDIO_HIGHWATER_MARK = 16384;

function toSampleRate(value: unknown): number | null {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface AudioInputDevice {
  id: number;
  name: string;
  maxInputChannels: number;
  hostAPIName?: string;
  defaultSampleRate?: number;
  isDefaultInput?: boolean;
}

export interface AudioCaptureOptions {
  deviceId: number | null;
  sampleRate: number;
}

export class AudioCapture extends EventEmitter {
  private audioIO: any | null = null;
  private sampleRate: number;

  constructor(options: AudioCaptureOptions) {
    super();
    this.sampleRate = toSampleRate(options.sampleRate) ?? 16000;

    const deviceId = options.deviceId ?? -1;

    const devices = AudioCapture.listDevices();
    const selectedDevice = devices.find((d) => d.id === deviceId);
    const triedRates = new Set<number>();
    const candidateRates: number[] = [];

    const preferredRate = toSampleRate(options.sampleRate);
    if (preferredRate !== null) {
      triedRates.add(preferredRate);
      candidateRates.push(preferredRate);
    }

    const defaultRate = toSampleRate(selectedDevice?.defaultSampleRate);
    if (defaultRate !== null && !triedRates.has(defaultRate)) {
      triedRates.add(defaultRate);
      candidateRates.push(defaultRate);
    }

    for (const rate of FALLBACK_SAMPLE_RATES) {
      if (!triedRates.has(rate)) {
        triedRates.add(rate);
        candidateRates.push(rate);
      }
    }

    const openErrors: string[] = [];
    for (const rate of candidateRates) {
      try {
        this.audioIO = portAudio.AudioIO({
          inOptions: {
            channelCount: 1,
            sampleFormat: portAudio.SampleFormat16Bit,
            sampleRate: rate,
            deviceId,
            closeOnError: false,
            highwaterMark: AUDIO_HIGHWATER_MARK,
          },
        });
        this.sampleRate = rate;
        break;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        openErrors.push(`${rate}Hz: ${message}`);
      }
    }

    if (!this.audioIO) {
      const deviceName = selectedDevice?.name ?? `id=${deviceId}`;
      throw new Error(`Unable to open audio input ${deviceName}. Tried sample rates: ${openErrors.join("; ")}`);
    }

    if (preferredRate !== null && this.sampleRate !== preferredRate) {
      const deviceName = selectedDevice?.name ?? `id=${deviceId}`;
      console.warn(`Audio input ${deviceName} does not support ${preferredRate}Hz. Using ${this.sampleRate}Hz.`);
    }

    this.audioIO.on("data", (buffer: Buffer) => {
      // Convert Int16 PCM to Float32 [-1, 1] for VAD/ASR
      const int16 = new Int16Array(
        buffer.buffer,
        buffer.byteOffset,
        buffer.length / 2
      );
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768;
      }
      this.emit("audio", float32);
    });

    this.audioIO.on("error", (err: Error) => {
      this.emit("error", err);
    });
  }

  start(): void {
    this.audioIO?.start();
  }

  stop(): void {
    this.audioIO?.quit();
  }

  getSampleRate(): number {
    return this.sampleRate;
  }

  static listDevices(): AudioInputDevice[] {
    return portAudio
      .getDevices()
      .filter((d: any) => d.maxInputChannels > 0)
      .map((d: any) => ({
        id: Number(d.id),
        name: String(d.name),
        maxInputChannels: Number(d.maxInputChannels),
        hostAPIName: typeof d.hostAPIName === "string" ? d.hostAPIName : undefined,
        defaultSampleRate: toSampleRate(d.defaultSampleRate) ?? undefined,
        isDefaultInput: Boolean(d.isDefaultInput),
      }));
  }
}
