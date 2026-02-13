// src/transcriber.ts
import * as sherpa_onnx from "sherpa-onnx-node";
import * as fs from "fs";
import * as path from "path";

function resolveModel(modelDir: string, name: string): string {
  const int8 = path.join(modelDir, `${name}.int8.onnx`);
  if (fs.existsSync(int8)) return int8;
  return path.join(modelDir, `${name}.onnx`);
}

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
          encoder: resolveModel(modelDir, "encoder"),
          decoder: resolveModel(modelDir, "decoder"),
          joiner: resolveModel(modelDir, "joiner"),
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
