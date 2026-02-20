# Speaker Diarization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add speaker identification to each transcribed speech segment using sherpa-onnx speaker embeddings.

**Architecture:** After VAD emits a speech segment, extract a speaker embedding via SpeakerEmbeddingExtractor, search against known speakers in SpeakerEmbeddingManager, auto-register new speakers. Add `speaker` field to JSONL output.

**Tech Stack:** sherpa-onnx-node (already installed) — SpeakerEmbeddingExtractor + SpeakerEmbeddingManager, 3DSpeaker ONNX model (~25 MB)

---

### Task 1: Download speaker embedding model

**Step 1: Download 3DSpeaker model**

```bash
curl -SL -o "C:\work\transcriber\models\3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx" https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx
```

---

### Task 2: Create SpeakerIdentifier module

**Files:**
- Create: `src/speaker-identifier.ts`

```typescript
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
```

**Commit:** `git add src/speaker-identifier.ts && git commit -m "feat: add SpeakerIdentifier using sherpa-onnx embeddings"`

---

### Task 3: Update config, file-writer, and service

**Files:**
- Modify: `src/config.ts` — add `speakerModelPath` and `speakerThreshold` to interface and defaults
- Modify: `src/file-writer.ts` — add `speaker` field to TranscriptionEntry
- Modify: `src/service.ts` — wire SpeakerIdentifier into speech handler
- Modify: `config.json` — add new fields

**config.ts changes:**

Add to `TranscriberConfig` interface (after line 13):
```typescript
  speakerModelPath: string;
  speakerThreshold: number;
```

Add to `DEFAULTS` (after line 27):
```typescript
  speakerModelPath: "./models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx",
  speakerThreshold: 0.6,
```

Add to `loadConfig` (after line 42):
```typescript
  config.speakerModelPath = path.resolve(expandEnvVars(config.speakerModelPath));
```

**file-writer.ts changes:**

Add to `TranscriptionEntry` (after line 8):
```typescript
  speaker: string;
```

**service.ts changes:**

Add import:
```typescript
import { SpeakerIdentifier } from "./speaker-identifier";
```

Add field:
```typescript
  private speakerIdentifier!: SpeakerIdentifier;
```

In `start()`, after VAD init (after line 37):
```typescript
    this.speakerIdentifier = new SpeakerIdentifier(
      this.config.speakerModelPath,
      this.config.sampleRate,
      this.config.speakerThreshold,
    );
    console.log("Speaker embedding model loaded");
```

In the speech handler (replace lines 42-49):
```typescript
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
```

**config.json** — add two fields:
```json
  "speakerModelPath": "./models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx",
  "speakerThreshold": 0.6
```

**Commit:** `git commit -m "feat: add speaker diarization via sherpa-onnx embeddings"`

---

### Task 4: Update download-models script

**Files:**
- Modify: `scripts/download-models.ts` — add speaker model download

Add after Silero VAD download block (after line 20):
```typescript
// Download 3DSpeaker embedding model
const speakerPath = path.join(modelsDir, "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx");
if (!fs.existsSync(speakerPath)) {
  console.log("Downloading 3DSpeaker embedding model...");
  execSync(
    `curl -SL -o "${speakerPath}" https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx`,
    { stdio: "inherit" }
  );
  console.log("3DSpeaker model downloaded.");
} else {
  console.log("3DSpeaker model already exists, skipping.");
}
```

**Commit:** `git commit -m "chore: add speaker model to download script"`

---

### Task 5: Integration test

Run the service, speak with different voices, verify JSONL output contains `speaker` field with consistent labels.

```bash
npx tsx src/index.ts
```

Expected JSONL:
```json
{"ts":"2026-02-13T10:00:00.000Z","duration":3.2,"text":"Hello","speaker":"Speaker_1"}
{"ts":"2026-02-13T10:00:05.000Z","duration":2.1,"text":"Hi there","speaker":"Speaker_2"}
```
