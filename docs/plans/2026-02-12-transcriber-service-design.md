# Transcriber Windows Service — Design

## Overview

Windows Service on Node.js + TypeScript that continuously captures microphone audio, detects speech via VAD, transcribes it using Parakeet v3 (ONNX Runtime), and writes results to daily JSONL files.

## Pipeline

```
Microphone → AudioCapture (naudiodon/PortAudio) → VAD (Silero VAD / ONNX)
  → Audio buffer (speech segments) → Parakeet v3 (ONNX Runtime) → JSONL file
```

## Components

- **AudioCapture** (`audio-capture.ts`) — captures raw PCM 16kHz mono 16-bit from microphone via `naudiodon`
- **VoiceActivityDetector** (`vad.ts`) — Silero VAD via ONNX Runtime, 30ms frames, detects speech start/end
- **Transcriber** (`transcriber.ts`) — Parakeet v3 via `onnxruntime-node`, receives Float32Array audio segment, returns text
- **FileWriter** (`file-writer.ts`) — appends JSONL to daily file, rotates at midnight
- **ConfigManager** (`config.ts`) — reads `config.json`, provides settings with defaults
- **ServiceHost** (`service.ts`) — entry point, orchestrates lifecycle
- **install-service.ts** — script to register/unregister Windows Service via `node-windows`

## Data Flow

1. AudioCapture streams PCM continuously
2. VAD processes 30ms frames, detects speech onset → starts buffering audio
3. VAD detects end of speech (silence ≥ 800ms) → sends buffered audio to Transcriber
4. Transcriber runs Parakeet v3 ONNX inference → returns text
5. FileWriter appends JSONL record to current day's file

## Output Format

File: `2026-02-12.jsonl`

```jsonl
{"ts":"2026-02-12T14:35:22.103Z","duration":3.2,"text":"Hello, how are you?"}
{"ts":"2026-02-12T14:35:28.540Z","duration":1.8,"text":"Fine, thanks"}
```

File rotation: on each write, compare current date with file date. If different, close and open new file.

## Configuration

`config.json`:

```json
{
  "outputDir": "%USERPROFILE%\\Documents\\Transcriptions\\",
  "audioDevice": null,
  "sampleRate": 16000,
  "vadSilenceThreshold": 800,
  "modelPath": "./models/parakeet-v3"
}
```

- `outputDir` — default `%USERPROFILE%\Documents\Transcriptions\`, supports env vars
- `audioDevice` — `null` = system default, otherwise device name/ID
- `vadSilenceThreshold` — silence duration in ms to detect end of phrase

## Project Structure

```
C:\work\transcriber\
├── src/
│   ├── index.ts
│   ├── service.ts
│   ├── audio-capture.ts
│   ├── vad.ts
│   ├── transcriber.ts
│   ├── file-writer.ts
│   └── config.ts
├── models/                   # ONNX models (gitignored)
│   ├── parakeet-v3/
│   └── silero-vad/
├── scripts/
│   ├── install-service.ts
│   ├── download-models.ts
│   └── setup.bat
├── config.json
├── package.json
├── tsconfig.json
└── .gitignore
```

## Dependencies

- `onnxruntime-node` — inference for Parakeet v3 and Silero VAD
- `naudiodon` — microphone audio capture (PortAudio bindings)
- `node-windows` — register as Windows Service
- `typescript`, `tsx` — build and run

## Error Handling

- Transcription failure on a segment: log error, skip segment, continue
- Microphone disconnect: retry with backoff, log warning
- Service must never crash from a single bad audio segment

## Portability

MVP: ZIP archive + `setup.bat` that checks Node.js, runs `npm install`, downloads models, registers service. Works on any Windows x64 with internet.

## Future

- Speaker diarization (next step)
- Single executable packaging via `pkg` or Node SEA
