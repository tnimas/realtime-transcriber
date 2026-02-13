// src/audio-capture.ts
import { EventEmitter } from "events";
import * as portAudio from "naudiodon";

export interface AudioCaptureOptions {
  deviceId: number | null;
  sampleRate: number;
}

export class AudioCapture extends EventEmitter {
  private audioIO: any;
  private sampleRate: number;

  constructor(options: AudioCaptureOptions) {
    super();
    this.sampleRate = options.sampleRate;

    const deviceId = options.deviceId ?? -1;

    this.audioIO = portAudio.AudioIO({
      inOptions: {
        channelCount: 1,
        sampleFormat: portAudio.SampleFormat16Bit,
        sampleRate: options.sampleRate,
        deviceId,
        closeOnError: false,
        highwaterMark: 65536,
      },
    });

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
    this.audioIO.start();
  }

  stop(): void {
    this.audioIO.quit();
  }

  static listDevices(): Array<{
    id: number;
    name: string;
    maxInputChannels: number;
  }> {
    return portAudio.getDevices().filter((d: any) => d.maxInputChannels > 0);
  }
}
