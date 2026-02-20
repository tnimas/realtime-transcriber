// src/speaker-identifier.ts
import * as sherpa_onnx from "sherpa-onnx-node";
import * as fs from "fs";
import * as path from "path";

interface SpeakerData {
  speakerCount: number;
  speakers: { name: string; embedding: number[]; count?: number }[];
}

const MIN_RELIABLE_SPEAKER_SAMPLES = 1600;
const STRICT_VERIFY_MIN_DURATION_SEC = 0.9;
const STRICT_VERIFY_MIN_SHORT_DURATION_SEC = 0.45;
const STRICT_VERIFY_MIN_KNOWN_SPEAKERS = 2;
const MAX_EMBEDDING_COUNT_FOR_AVG = 20;

function getStrictThreshold(baseThreshold: number, durationSec: number): number {
  if (durationSec >= 1.2) return Math.min(0.95, Math.max(baseThreshold + 0.14, 0.5));
  if (durationSec >= 0.6) return Math.min(0.95, Math.max(baseThreshold + 0.1, 0.42));
  return Math.min(0.95, Math.max(baseThreshold + 0.06, 0.36));
}

function blendEmbeddings(previous: Float32Array, next: Float32Array, previousCount: number): Float32Array {
  const count = Math.max(1, Math.min(previousCount, MAX_EMBEDDING_COUNT_FOR_AVG));
  const out = new Float32Array(previous.length);
  const total = count + 1;

  for (let i = 0; i < previous.length; i++) {
    out[i] = (previous[i] * count + next[i]) / total;
  }

  return out;
}

function isValidEmbedding(v: Float32Array): boolean {
  let normSq = 0;
  for (let i = 0; i < v.length; i++) {
    const value = v[i];
    if (!Number.isFinite(value)) {
      return false;
    }
    normSq += value * value;
  }

  return normSq > 1e-8;
}

export class SpeakerIdentifier {
  private extractor: any;
  private manager: any;
  private speakerCount = 0;
  private sampleRate: number;
  private threshold: number;
  private embeddings = new Map<string, Float32Array>();
  private embeddingCounts = new Map<string, number>();
  private storagePath: string | null;
  private lastSpeaker: string | null = null;

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
    if (audio.length < MIN_RELIABLE_SPEAKER_SAMPLES) {
      return this.lastSpeaker ?? "Unknown";
    }

    const stream = this.extractor.createStream();
    stream.acceptWaveform({ sampleRate: this.sampleRate, samples: audio });

    if (!this.extractor.isReady(stream)) {
      return this.lastSpeaker ?? "Unknown";
    }

    const embedding = this.extractor.compute(stream);
    if (!isValidEmbedding(embedding)) {
      return this.lastSpeaker ?? "Unknown";
    }

    const name = this.manager.search({ v: embedding, threshold: this.threshold });
    const durationSec = audio.length / this.sampleRate;

    if (name !== "") {
      const shouldStrictByDuration = durationSec >= STRICT_VERIFY_MIN_DURATION_SEC;
      const shouldStrictBySpeakerCount =
        this.embeddings.size >= STRICT_VERIFY_MIN_KNOWN_SPEAKERS &&
        durationSec >= STRICT_VERIFY_MIN_SHORT_DURATION_SEC &&
        name !== this.lastSpeaker;
      const canStrictVerify =
        typeof this.manager.verify === "function" &&
        (shouldStrictByDuration || shouldStrictBySpeakerCount);

      if (canStrictVerify) {
        const strictThreshold = getStrictThreshold(this.threshold, durationSec);
        const strictMatch = this.manager.verify({
          name,
          v: embedding,
          threshold: strictThreshold,
        });

        if (!strictMatch) {
          return this.createNewSpeaker(embedding);
        }
      }

      this.updateSpeakerEmbedding(name, embedding);
      this.lastSpeaker = name;
      return name;
    }

    return this.createNewSpeaker(embedding);
  }

  reset(): void {
    this.manager = new sherpa_onnx.SpeakerEmbeddingManager(this.extractor.dim);
    this.speakerCount = 0;
    this.embeddings.clear();
    this.embeddingCounts.clear();
    this.lastSpeaker = null;
    this.save();
  }

  private load(): void {
    if (!this.storagePath || !fs.existsSync(this.storagePath)) return;

    try {
      const data: SpeakerData = JSON.parse(fs.readFileSync(this.storagePath, "utf-8"));
      this.speakerCount = data.speakerCount;
      for (const { name, embedding, count } of data.speakers) {
        const v = new Float32Array(embedding);
        if (!isValidEmbedding(v)) {
          continue;
        }
        this.manager.add({ name, v });
        this.embeddings.set(name, v);
        this.embeddingCounts.set(name, Math.max(1, Math.floor(count ?? 1)));
      }

      const latestName = `Speaker_${this.speakerCount}`;
      if (this.embeddings.has(latestName)) {
        this.lastSpeaker = latestName;
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
        count: this.embeddingCounts.get(name) ?? 1,
      })),
    };

    const dir = path.dirname(this.storagePath);
    const tmpPath = `${this.storagePath}.tmp`;

    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(tmpPath, JSON.stringify(data));
      fs.renameSync(tmpPath, this.storagePath);
    } catch (err) {
      if (fs.existsSync(tmpPath)) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          // ignore temp cleanup failures
        }
      }
      console.error("Failed to persist speakers:", err);
    }
  }

  private createNewSpeaker(embedding: Float32Array): string {
    this.speakerCount++;
    const newName = `Speaker_${this.speakerCount}`;
    this.manager.add({ name: newName, v: embedding });
    this.embeddings.set(newName, new Float32Array(embedding));
    this.embeddingCounts.set(newName, 1);
    this.lastSpeaker = newName;
    this.save();
    return newName;
  }

  private updateSpeakerEmbedding(name: string, currentEmbedding: Float32Array): void {
    const previousEmbedding = this.embeddings.get(name);
    if (!previousEmbedding) {
      this.embeddings.set(name, new Float32Array(currentEmbedding));
      this.embeddingCounts.set(name, 1);
      return;
    }

    const previousCount = this.embeddingCounts.get(name) ?? 1;
    const updated = blendEmbeddings(previousEmbedding, currentEmbedding, previousCount);
    if (!isValidEmbedding(updated)) {
      return;
    }

    this.embeddings.set(name, updated);
    this.embeddingCounts.set(name, previousCount + 1);

    if (typeof this.manager.remove === "function") {
      this.manager.remove(name);
      this.manager.add({ name, v: updated });
    }

    this.save();
  }
}
