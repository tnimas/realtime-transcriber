// scripts/download-models.ts
import * as path from "path";
import { type ModelName, downloadModel, downloadVad, downloadSpeaker } from "../src/model-downloader";

const modelsDir = path.resolve(__dirname, "..", "models");

// Parse --model argument: parakeet | gigaam | all (default: all)
const args = process.argv.slice(2);
const modelIdx = args.indexOf("--model");
const modelArg = modelIdx !== -1 ? args[modelIdx + 1] : "all";

downloadVad(modelsDir);
downloadSpeaker(modelsDir);

if (modelArg === "all") {
  downloadModel("parakeet", modelsDir);
  downloadModel("gigaam", modelsDir);
} else {
  downloadModel(modelArg as ModelName, modelsDir);
}

console.log("All models ready.");
