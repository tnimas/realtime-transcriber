// src/speaker-identifier.ts
import * as sherpa_onnx from "sherpa-onnx-node";

export class SpeakerIdentifier {
  private extractor: any;
  private manager: any;
  private speakerCount = 0;
  private sampleRate: number;
  private threshold: number;

  constructor(modelPath: string, sampleRate: number = 16000, threshold: number = 0.6) {
    this.sampleRate = sampleRate;
    this.threshold = threshold;

    this.extractor = new sherpa_onnx.SpeakerEmbeddingExtractor({
      model: modelPath,
      numThreads: 2,
      provider: "cpu",
    });

    this.manager = new sherpa_onnx.SpeakerEmbeddingManager(this.extractor.dim);
  }

  identify(audio: Float32Array): string {
    const stream = this.extractor.createStream();
    stream.acceptWaveform({ sampleRate: this.sampleRate, samples: audio });

    if (!this.extractor.isReady(stream)) {
      return "Unknown";
    }

    const embedding = this.extractor.compute(stream);
    const name = this.manager.search({ v: embedding, threshold: this.threshold });

    if (name !== "") {
      return name;
    }

    this.speakerCount++;
    const newName = `Speaker_${this.speakerCount}`;
    this.manager.add({ name: newName, v: embedding });
    return newName;
  }

  reset(): void {
    this.manager = new sherpa_onnx.SpeakerEmbeddingManager(this.extractor.dim);
    this.speakerCount = 0;
  }
}
