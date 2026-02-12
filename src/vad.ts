// src/vad.ts
import * as ort from "onnxruntime-node";
import { EventEmitter } from "events";

export interface VADOptions {
  modelPath: string;
  threshold: number;
  silenceThresholdMs: number;
  sampleRate: 16000 | 8000;
}

export class VoiceActivityDetector extends EventEmitter {
  private session!: ort.InferenceSession;
  private state!: Float32Array;
  private context!: Float32Array;
  private opts: VADOptions;

  private readonly numSamples: number;
  private readonly contextSize: number;

  // State machine
  private triggered = false;
  private tempEnd = 0;
  private currentSample = 0;
  private speechBuffer: Float32Array[] = [];
  private speechStartTime: Date | null = null;

  private minSilenceSamples: number;

  constructor(opts: VADOptions) {
    super();
    this.opts = opts;
    this.numSamples = opts.sampleRate === 16000 ? 512 : 256;
    this.contextSize = opts.sampleRate === 16000 ? 64 : 32;
    this.minSilenceSamples = (opts.sampleRate * opts.silenceThresholdMs) / 1000;
    this.state = new Float32Array(2 * 1 * 128);
    this.context = new Float32Array(this.contextSize);
  }

  async init(): Promise<void> {
    this.session = await ort.InferenceSession.create(this.opts.modelPath, {
      interOpNumThreads: 1,
      intraOpNumThreads: 1,
      executionProviders: ["cpu"],
    });
  }

  /**
   * Feed raw Float32 audio. Buffers internally, processes in 512-sample frames.
   * Emits "speech" event with { audio: Float32Array, startTime: Date, duration: number }
   */
  private pendingSamples = new Float32Array(0);

  async processAudio(audio: Float32Array): Promise<void> {
    // Append to pending buffer
    const combined = new Float32Array(this.pendingSamples.length + audio.length);
    combined.set(this.pendingSamples);
    combined.set(audio, this.pendingSamples.length);
    this.pendingSamples = combined;

    // Process complete frames
    while (this.pendingSamples.length >= this.numSamples) {
      const frame = this.pendingSamples.slice(0, this.numSamples);
      this.pendingSamples = this.pendingSamples.slice(this.numSamples);
      await this.processFrame(frame);
    }
  }

  private async processFrame(frame: Float32Array): Promise<void> {
    this.currentSample += this.numSamples;

    // Prepend context
    const inputSize = this.contextSize + this.numSamples;
    const inputData = new Float32Array(inputSize);
    inputData.set(this.context, 0);
    inputData.set(frame, this.contextSize);

    // Run inference
    const inputTensor = new ort.Tensor("float32", inputData, [1, inputSize]);
    const stateTensor = new ort.Tensor("float32", this.state, [2, 1, 128]);
    const srTensor = new ort.Tensor(
      "int64",
      BigInt64Array.from([BigInt(this.opts.sampleRate)]),
      []
    );

    const results = await this.session.run({
      input: inputTensor,
      state: stateTensor,
      sr: srTensor,
    });

    const prob = (results["output"].data as Float32Array)[0];
    this.state = new Float32Array(results["stateN"].data as Float32Array);
    this.context = inputData.slice(inputSize - this.contextSize);

    // State machine
    if (prob >= this.opts.threshold && this.tempEnd) {
      this.tempEnd = 0; // Cancel pending end
    }

    if (prob >= this.opts.threshold && !this.triggered) {
      this.triggered = true;
      this.speechStartTime = new Date();
      this.speechBuffer = [];
    }

    if (this.triggered) {
      this.speechBuffer.push(frame);
    }

    if (prob < this.opts.threshold - 0.15 && this.triggered) {
      if (!this.tempEnd) {
        this.tempEnd = this.currentSample;
      }
      if (this.currentSample - this.tempEnd >= this.minSilenceSamples) {
        // Speech ended — emit buffered audio
        const totalLength = this.speechBuffer.reduce((s, b) => s + b.length, 0);
        const fullAudio = new Float32Array(totalLength);
        let offset = 0;
        for (const buf of this.speechBuffer) {
          fullAudio.set(buf, offset);
          offset += buf.length;
        }
        const duration = totalLength / this.opts.sampleRate;

        this.emit("speech", {
          audio: fullAudio,
          startTime: this.speechStartTime!,
          duration,
        });

        this.triggered = false;
        this.tempEnd = 0;
        this.speechBuffer = [];
        this.speechStartTime = null;
      }
    }
  }

  async destroy(): Promise<void> {
    await this.session.release();
  }
}
