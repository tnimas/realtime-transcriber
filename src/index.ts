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
