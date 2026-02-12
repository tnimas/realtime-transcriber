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
