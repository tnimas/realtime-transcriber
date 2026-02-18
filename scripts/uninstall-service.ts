// scripts/uninstall-service.ts
import * as path from "path";
const Service = require("node-windows").Service;

const svc = new Service({
  name: "Transcriber",
  script: path.resolve(__dirname, "..", "start.js"),
});

svc.on("uninstall", () => {
  console.log("Service uninstalled.");
});

svc.uninstall();
