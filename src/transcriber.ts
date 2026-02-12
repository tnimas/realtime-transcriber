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
