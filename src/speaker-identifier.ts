// src/speaker-identifier.ts
import * as sherpa_onnx from "sherpa-onnx-node";
import * as fs from "fs";
import * as path from "path";

interface SpeakerData {
  speakerCount: number;
  speakers: { name: string; embedding: number[] }[];
}

export class SpeakerIdentifier {
  private extractor: any;
  private manager: any;
  private speakerCount = 0;
  private sampleRate: number;
  private threshold: number;
  private embeddings = new Map<string, Float32Array>();
  private storagePath: string | null;

  constructor(modelPath: string, sampleRate: number = 16000, threshold: number = 0.6, storagePath: string | null = null) {
    this.sampleRate = sampleRate;
    this.threshold = threshold;
    this.storagePath = storagePath;

    this.extractor = new sherpa_onnx.SpeakerEmbeddingExtractor({
      model: modelPath,
      numThreads: 2,
      provider: "cpu",
    });

    this.manager = new sherpa_onnx.SpeakerEmbeddingManager(this.extractor.dim);
    this.load();
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
    this.embeddings.set(newName, new Float32Array(embedding));
    this.save();
    return newName;
  }

  reset(): void {
    this.manager = new sherpa_onnx.SpeakerEmbeddingManager(this.extractor.dim);
    this.speakerCount = 0;
    this.embeddings.clear();
    this.save();
  }

  private load(): void {
    if (!this.storagePath || !fs.existsSync(this.storagePath)) return;

    try {
      const data: SpeakerData = JSON.parse(fs.readFileSync(this.storagePath, "utf-8"));
      this.speakerCount = data.speakerCount;
      for (const { name, embedding } of data.speakers) {
        const v = new Float32Array(embedding);
        this.manager.add({ name, v });
        this.embeddings.set(name, v);
      }
    } catch {
      // Corrupted file — start fresh
    }
  }

  private save(): void {
    if (!this.storagePath) return;

    const data: SpeakerData = {
      speakerCount: this.speakerCount,
      speakers: Array.from(this.embeddings.entries()).map(([name, v]) => ({
        name,
        embedding: Array.from(v),
      })),
    };

    const dir = path.dirname(this.storagePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.storagePath, JSON.stringify(data));
  }
}
