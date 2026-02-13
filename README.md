# Transcriber

Real-time speech-to-text transcription service for Windows with speaker diarization. Captures microphone audio, detects speech segments, transcribes them using NVIDIA Parakeet, and identifies speakers — all locally, no cloud APIs.

## How it works

```
Microphone → Audio Capture → VAD → Transcriber → Speaker ID → JSONL file
              (naudiodon)   (Silero) (Parakeet v3)  (3DSpeaker)
```

1. **Audio Capture** — records mono 16kHz PCM from the system microphone via PortAudio
2. **Voice Activity Detection** — Silero VAD detects speech start/end in real-time
3. **Transcription** — NVIDIA Parakeet TDT v3 (0.6B, int8) transcribes each speech segment offline
4. **Speaker Diarization** — 3DSpeaker embedding model identifies and tracks speakers (`Speaker_1`, `Speaker_2`, ...)
5. **Output** — appends JSONL entries to daily files in the output directory

### Output format

```
~/Documents/Transcriptions/2026-02-13.jsonl
```

```json
{"ts":"2026-02-13T10:00:00.000Z","duration":3.2,"text":"Hello everyone","speaker":"Speaker_1"}
{"ts":"2026-02-13T10:00:05.000Z","duration":2.1,"text":"Hi there","speaker":"Speaker_2"}
```

## Requirements

- Windows 10/11
- Node.js 18+
- ~1.5 GB disk space for models

## Installation

### Quick setup

```bat
scripts\setup.bat
```

This installs npm dependencies and downloads all models (~1.2 GB).

### Manual setup

```bash
npm install
npx tsx scripts/download-models.ts
```

### Models downloaded

| Model | Size | Purpose |
|---|---|---|
| Silero VAD | ~2 MB | Voice activity detection |
| 3DSpeaker ERes2Net | ~25 MB | Speaker embedding extraction |
| Parakeet TDT v3 int8 | ~1.2 GB | Speech-to-text (Multilang) |

## Usage

### Run standalone

```bash
npx tsx src/index.ts
```

Stop with `Ctrl+C` (graceful shutdown).

### Install as Windows Service

Run as Administrator:

```bash
npx tsx scripts/install-service.ts
```

Uninstall:

```bash
npx tsx scripts/uninstall-service.ts
```

## Configuration

Edit `config.json`:

```json
{
  "outputDir": "%USERPROFILE%\\Documents\\Transcriptions\\",
  "audioDevice": null,
  "sampleRate": 16000,
  "vadSilenceThreshold": 800,
  "vadThreshold": 0.5,
  "modelDir": "./models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
  "vadModelPath": "./models/silero_vad.onnx",
  "speakerModelPath": "./models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx",
  "speakerThreshold": 0.4
}
```

| Parameter | Default | Description |
|---|---|---|
| `outputDir` | `~/Documents/Transcriptions/` | Directory for daily JSONL files |
| `audioDevice` | `null` | Microphone device ID (`null` = system default) |
| `sampleRate` | `16000` | Audio sample rate in Hz |
| `vadSilenceThreshold` | `800` | Silence duration (ms) before speech segment ends |
| `vadThreshold` | `0.5` | VAD probability threshold (0-1) |
| `speakerModelPath` | `./models/3dspeaker_...onnx` | Path to speaker embedding model |
| `speakerThreshold` | `0.4` | Speaker matching threshold (lower = more lenient) |

## Architecture

```
src/
  index.ts              # Entry point with graceful shutdown
  service.ts            # Orchestrator — wires all components
  audio-capture.ts      # Microphone capture via naudiodon/PortAudio
  vad.ts                # Silero VAD with speech buffering state machine
  transcriber.ts        # Offline ASR using sherpa-onnx Parakeet v3
  speaker-identifier.ts # Speaker diarization via sherpa-onnx embeddings
  file-writer.ts        # Daily-rotating JSONL writer
  config.ts             # Config loader with env var expansion
scripts/
  setup.bat             # One-click setup
  download-models.ts    # Model downloader
  install-service.ts    # Windows Service installer
  uninstall-service.ts  # Windows Service uninstaller
```

## Tech stack

- [sherpa-onnx-node](https://github.com/k2-fsa/sherpa-onnx) — ASR + speaker embeddings
- [onnxruntime-node](https://github.com/microsoft/onnxruntime) — Silero VAD inference
- [naudiodon](https://github.com/Streampunk/naudiodon) — PortAudio bindings for Node.js
- [node-windows](https://github.com/coreybutler/node-windows) — Windows Service wrapper
