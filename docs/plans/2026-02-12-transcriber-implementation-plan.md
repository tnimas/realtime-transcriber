# Transcriber Windows Service — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Windows Service that continuously captures microphone audio, detects speech via Silero VAD, transcribes via Parakeet v3, and writes timestamped JSONL log files daily.

**Architecture:** Audio capture via `naudiodon` streams raw PCM 16kHz mono to Silero VAD (via `onnxruntime-node`). When speech ends, buffered audio is sent to `sherpa-onnx-node` (Parakeet v3 TDT int8) for transcription. Results are appended to daily JSONL files. The whole thing runs as a Windows Service via `node-windows`.

**Tech Stack:** Node.js, TypeScript, naudiodon (PortAudio), onnxruntime-node (Silero VAD), sherpa-onnx-node (Parakeet v3), node-windows

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `config.json`

**Step 1: Initialize project**

```bash
cd C:\work\transcriber
git init
npm init -y
```

**Step 2: Install dependencies**

```bash
npm install naudiodon onnxruntime-node sherpa-onnx-node node-windows
npm install -D typescript @types/node tsx
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "models"]
}
```

**Step 4: Create .gitignore**

```
node_modules/
dist/
models/
*.log
```

**Step 5: Create config.json**

```json
{
  "outputDir": "%USERPROFILE%\\Documents\\Transcriptions\\",
  "audioDevice": null,
  "sampleRate": 16000,
  "vadSilenceThreshold": 800,
  "vadThreshold": 0.5,
  "modelDir": "./models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
  "vadModelPath": "./models/silero_vad.onnx"
}
```

**Step 6: Commit**

```bash
git add package.json tsconfig.json .gitignore config.json
git commit -m "chore: scaffold project with dependencies and config"
```

---

### Task 2: ConfigManager

**Files:**
- Create: `src/config.ts`
- Create: `src/config.test.ts`

**Step 1: Write the test**

```typescript
// src/config.test.ts
import { loadConfig, TranscriberConfig } from "./config";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Test: loads config and expands env vars
const tmpDir = os.tmpdir();
const testConfigPath = path.join(tmpDir, "test-config.json");

fs.writeFileSync(testConfigPath, JSON.stringify({
  outputDir: "%USERPROFILE%\\Documents\\Transcriptions\\",
  audioDevice: null,
  sampleRate: 16000,
  vadSilenceThreshold: 800,
  vadThreshold: 0.5,
  modelDir: "./models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
  vadModelPath: "./models/silero_vad.onnx"
}));

const config = loadConfig(testConfigPath);

// outputDir should have %USERPROFILE% expanded
console.assert(!config.outputDir.includes("%"), `Expected expanded path, got: ${config.outputDir}`);
console.assert(config.outputDir.includes("Documents"), `Expected Documents in path, got: ${config.outputDir}`);
console.assert(config.sampleRate === 16000, `Expected 16000, got: ${config.sampleRate}`);
console.assert(config.audioDevice === null, `Expected null, got: ${config.audioDevice}`);

// Test: defaults when config file missing
const defaults = loadConfig("nonexistent.json");
console.assert(!defaults.outputDir.includes("%"), `Expected expanded default path`);
console.assert(defaults.sampleRate === 16000, `Expected default sampleRate 16000`);

fs.unlinkSync(testConfigPath);
console.log("config tests passed");
```

**Step 2: Run test to verify it fails**

```bash
npx tsx src/config.test.ts
```

Expected: FAIL — module `./config` not found

**Step 3: Write implementation**

```typescript
// src/config.ts
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface TranscriberConfig {
  outputDir: string;
  audioDevice: number | null;
  sampleRate: number;
  vadSilenceThreshold: number;
  vadThreshold: number;
  modelDir: string;
  vadModelPath: string;
}

function expandEnvVars(str: string): string {
  return str.replace(/%([^%]+)%/g, (_, key) => process.env[key] || _);
}

const DEFAULTS: TranscriberConfig = {
  outputDir: path.join(os.homedir(), "Documents", "Transcriptions"),
  audioDevice: null,
  sampleRate: 16000,
  vadSilenceThreshold: 800,
  vadThreshold: 0.5,
  modelDir: "./models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
  vadModelPath: "./models/silero_vad.onnx",
};

export function loadConfig(configPath: string): TranscriberConfig {
  let raw: Partial<TranscriberConfig> = {};
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    raw = JSON.parse(content);
  } catch {
    // Use defaults if config missing or invalid
  }

  const config: TranscriberConfig = { ...DEFAULTS, ...raw };
  config.outputDir = expandEnvVars(config.outputDir);
  config.modelDir = path.resolve(expandEnvVars(config.modelDir));
  config.vadModelPath = path.resolve(expandEnvVars(config.vadModelPath));

  return config;
}
```

**Step 4: Run test to verify it passes**

```bash
npx tsx src/config.test.ts
```

Expected: "config tests passed"

**Step 5: Commit**

```bash
git add src/config.ts src/config.test.ts
git commit -m "feat: add ConfigManager with env var expansion and defaults"
```

---

### Task 3: FileWriter

**Files:**
- Create: `src/file-writer.ts`
- Create: `src/file-writer.test.ts`

**Step 1: Write the test**

```typescript
// src/file-writer.test.ts
import { FileWriter } from "./file-writer";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const testDir = path.join(os.tmpdir(), "transcriber-test-" + Date.now());

const writer = new FileWriter(testDir);

// Write two entries
writer.write({ ts: new Date().toISOString(), duration: 2.5, text: "Hello world" });
writer.write({ ts: new Date().toISOString(), duration: 1.2, text: "Test entry" });

writer.close();

// Verify file exists with today's date
const today = new Date().toISOString().split("T")[0];
const filePath = path.join(testDir, `${today}.jsonl`);
console.assert(fs.existsSync(filePath), `File should exist: ${filePath}`);

// Verify content
const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
console.assert(lines.length === 2, `Expected 2 lines, got ${lines.length}`);

const entry1 = JSON.parse(lines[0]);
console.assert(entry1.text === "Hello world", `Expected 'Hello world', got '${entry1.text}'`);
console.assert(entry1.duration === 2.5, `Expected 2.5, got ${entry1.duration}`);

const entry2 = JSON.parse(lines[1]);
console.assert(entry2.text === "Test entry", `Expected 'Test entry', got '${entry2.text}'`);

// Cleanup
fs.rmSync(testDir, { recursive: true });
console.log("file-writer tests passed");
```

**Step 2: Run test to verify it fails**

```bash
npx tsx src/file-writer.test.ts
```

Expected: FAIL — module `./file-writer` not found

**Step 3: Write implementation**

```typescript
// src/file-writer.ts
import * as fs from "fs";
import * as path from "path";

export interface TranscriptionEntry {
  ts: string;
  duration: number;
  text: string;
}

export class FileWriter {
  private outputDir: string;
  private currentDate: string = "";
  private fd: number | null = null;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
    fs.mkdirSync(outputDir, { recursive: true });
  }

  write(entry: TranscriptionEntry): void {
    const today = new Date().toISOString().split("T")[0];
    if (today !== this.currentDate) {
      this.rotate(today);
    }
    const line = JSON.stringify(entry) + "\n";
    fs.writeSync(this.fd!, line);
  }

  private rotate(date: string): void {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
    }
    this.currentDate = date;
    const filePath = path.join(this.outputDir, `${date}.jsonl`);
    this.fd = fs.openSync(filePath, "a");
  }

  close(): void {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }
}
```

**Step 4: Run test to verify it passes**

```bash
npx tsx src/file-writer.test.ts
```

Expected: "file-writer tests passed"

**Step 5: Commit**

```bash
git add src/file-writer.ts src/file-writer.test.ts
git commit -m "feat: add FileWriter with daily JSONL rotation"
```

---

### Task 4: AudioCapture

**Files:**
- Create: `src/audio-capture.ts`

**Step 1: Write implementation**

```typescript
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

    this.audioIO = new portAudio.AudioIO({
      inOptions: {
        channelCount: 1,
        sampleFormat: portAudio.SampleFormat16Bit,
        sampleRate: options.sampleRate,
        deviceId,
        closeOnError: false,
      },
    });

    this.audioIO.on("data", (buffer: Buffer) => {
      // Convert Int16 PCM to Float32 [-1, 1] for VAD/ASR
      const int16 = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
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

  static listDevices(): Array<{ id: number; name: string; maxInputChannels: number }> {
    return portAudio.getDevices().filter((d: any) => d.maxInputChannels > 0);
  }
}
```

**Step 2: Manual smoke test**

```bash
npx tsx -e "
const { AudioCapture } = require('./src/audio-capture');
console.log('Input devices:', AudioCapture.listDevices());
const cap = new AudioCapture({ deviceId: null, sampleRate: 16000 });
cap.on('audio', (buf) => { console.log('Got audio chunk:', buf.length, 'samples'); });
cap.start();
setTimeout(() => { cap.stop(); process.exit(0); }, 3000);
"
```

Expected: prints device list, then audio chunk sizes for 3 seconds

**Step 3: Commit**

```bash
git add src/audio-capture.ts
git commit -m "feat: add AudioCapture with naudiodon PortAudio bindings"
```

---

### Task 5: Silero VAD

**Files:**
- Create: `src/vad.ts`

**Step 1: Download Silero VAD ONNX model**

```bash
mkdir models 2>nul
curl -SL -o models/silero_vad.onnx https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx
```

**Step 2: Write implementation**

```typescript
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
```

**Step 3: Commit**

```bash
git add src/vad.ts
git commit -m "feat: add Silero VAD with speech segment detection"
```

---

### Task 6: Transcriber (sherpa-onnx)

**Files:**
- Create: `src/transcriber.ts`

**Step 1: Download Parakeet v3 int8 model**

```bash
cd C:\work\transcriber\models
curl -SL -o parakeet-v3.tar.bz2 https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2
tar xjf parakeet-v3.tar.bz2
del parakeet-v3.tar.bz2
```

**Step 2: Write implementation**

```typescript
// src/transcriber.ts
import * as sherpa_onnx from "sherpa-onnx-node";
import * as path from "path";

export class Transcriber {
  private recognizer: any;
  private sampleRate: number;

  constructor(modelDir: string, sampleRate: number = 16000) {
    this.sampleRate = sampleRate;

    const config = {
      featConfig: {
        sampleRate,
        featureDim: 80,
      },
      modelConfig: {
        transducer: {
          encoder: path.join(modelDir, "encoder.int8.onnx"),
          decoder: path.join(modelDir, "decoder.int8.onnx"),
          joiner: path.join(modelDir, "joiner.int8.onnx"),
        },
        tokens: path.join(modelDir, "tokens.txt"),
        numThreads: 4,
        provider: "cpu",
        debug: 0,
        modelType: "nemo_transducer",
      },
    };

    this.recognizer = new sherpa_onnx.OfflineRecognizer(config);
  }

  transcribe(audio: Float32Array): string {
    const stream = this.recognizer.createStream();
    stream.acceptWaveform({ sampleRate: this.sampleRate, samples: audio });
    this.recognizer.decode(stream);
    return this.recognizer.getResult(stream).text.trim();
  }
}
```

**Step 3: Manual smoke test with a WAV file**

```bash
npx tsx -e "
const { Transcriber } = require('./src/transcriber');
const t = new Transcriber('./models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8');
console.log('Transcriber initialized successfully');
"
```

Expected: "Transcriber initialized successfully"

**Step 4: Commit**

```bash
git add src/transcriber.ts
git commit -m "feat: add Transcriber using sherpa-onnx Parakeet v3"
```

---

### Task 7: Service Orchestrator

**Files:**
- Create: `src/service.ts`

**Step 1: Write implementation**

```typescript
// src/service.ts
import { AudioCapture } from "./audio-capture";
import { VoiceActivityDetector } from "./vad";
import { Transcriber } from "./transcriber";
import { FileWriter } from "./file-writer";
import { loadConfig, TranscriberConfig } from "./config";
import * as path from "path";

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
      this.vad.processAudio(audio).catch((err) => {
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
```

**Step 2: Commit**

```bash
git add src/service.ts
git commit -m "feat: add TranscriberService orchestrator"
```

---

### Task 8: Entry Point (standalone + service modes)

**Files:**
- Create: `src/index.ts`

**Step 1: Write implementation**

```typescript
// src/index.ts
import { TranscriberService } from "./service";
import * as path from "path";

const configPath = path.resolve(__dirname, "..", "config.json");
const service = new TranscriberService(configPath);

// Handle graceful shutdown
process.on("SIGINT", async () => {
  await service.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await service.stop();
  process.exit(0);
});

service.start().catch((err) => {
  console.error("Failed to start service:", err);
  process.exit(1);
});
```

**Step 2: Smoke test — run standalone**

```bash
npx tsx src/index.ts
```

Expected: prints initialization messages, then "Listening...", transcribes speech from microphone. Press Ctrl+C to stop.

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add entry point with graceful shutdown"
```

---

### Task 9: Windows Service Installation

**Files:**
- Create: `scripts/install-service.ts`
- Create: `scripts/uninstall-service.ts`

**Step 1: Write install script**

```typescript
// scripts/install-service.ts
import * as path from "path";
const Service = require("node-windows").Service;

const svc = new Service({
  name: "Transcriber",
  description: "Continuous microphone transcription service",
  script: path.resolve(__dirname, "..", "src", "index.ts"),
  nodeOptions: [],
  execPath: process.execPath,
});

svc.on("install", () => {
  console.log("Service installed. Starting...");
  svc.start();
});

svc.on("alreadyinstalled", () => {
  console.log("Service already installed.");
});

svc.on("error", (err: Error) => {
  console.error("Error:", err);
});

svc.install();
```

**Step 2: Write uninstall script**

```typescript
// scripts/uninstall-service.ts
import * as path from "path";
const Service = require("node-windows").Service;

const svc = new Service({
  name: "Transcriber",
  script: path.resolve(__dirname, "..", "src", "index.ts"),
});

svc.on("uninstall", () => {
  console.log("Service uninstalled.");
});

svc.uninstall();
```

**Step 3: Commit**

```bash
git add scripts/install-service.ts scripts/uninstall-service.ts
git commit -m "feat: add Windows Service install/uninstall scripts"
```

---

### Task 10: Model Download Script & Setup

**Files:**
- Create: `scripts/download-models.ts`
- Create: `scripts/setup.bat`

**Step 1: Write model download script**

```typescript
// scripts/download-models.ts
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const modelsDir = path.resolve(__dirname, "..", "models");
fs.mkdirSync(modelsDir, { recursive: true });

// Download Silero VAD
const vadPath = path.join(modelsDir, "silero_vad.onnx");
if (!fs.existsSync(vadPath)) {
  console.log("Downloading Silero VAD model...");
  execSync(
    `curl -SL -o "${vadPath}" https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx`,
    { stdio: "inherit" }
  );
  console.log("Silero VAD downloaded.");
} else {
  console.log("Silero VAD already exists, skipping.");
}

// Download Parakeet v3
const parakeetDir = path.join(modelsDir, "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8");
if (!fs.existsSync(parakeetDir)) {
  console.log("Downloading Parakeet v3 model (this may take a while)...");
  const archivePath = path.join(modelsDir, "parakeet-v3.tar.bz2");
  execSync(
    `curl -SL -o "${archivePath}" https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2`,
    { stdio: "inherit" }
  );
  execSync(`tar xjf "${archivePath}" -C "${modelsDir}"`, { stdio: "inherit" });
  fs.unlinkSync(archivePath);
  console.log("Parakeet v3 downloaded and extracted.");
} else {
  console.log("Parakeet v3 already exists, skipping.");
}

console.log("All models ready.");
```

**Step 2: Write setup.bat**

```batch
@echo off
echo === Transcriber Service Setup ===

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: Node.js not found. Install from https://nodejs.org/
    pause
    exit /b 1
)

echo Installing dependencies...
call npm install

echo Downloading models...
call npx tsx scripts/download-models.ts

echo.
echo Setup complete! To run standalone:
echo   npx tsx src/index.ts
echo.
echo To install as Windows Service (run as Administrator):
echo   npx tsx scripts/install-service.ts
echo.
pause
```

**Step 3: Commit**

```bash
git add scripts/download-models.ts scripts/setup.bat
git commit -m "feat: add model download script and setup.bat"
```

---

### Task 11: End-to-End Integration Test

**Step 1: Run the full pipeline standalone**

```bash
npx tsx src/index.ts
```

**Step 2: Speak into the microphone for 10-15 seconds**

Expected:
- Console shows transcribed phrases with timestamps
- JSONL file created at `%USERPROFILE%\Documents\Transcriptions\YYYY-MM-DD.jsonl`
- Each line is valid JSON with `ts`, `duration`, `text` fields

**Step 3: Verify JSONL output**

```bash
type "%USERPROFILE%\Documents\Transcriptions\2026-02-12.jsonl"
```

Expected: valid JSONL entries with transcribed text

**Step 4: Test graceful shutdown**

Press Ctrl+C. Expected: "Stopping transcriber service..." → "Service stopped."

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: integration test verified, MVP complete"
```
