import { AudioCapture } from "../src/audio-capture";

function getArg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return fallback;
}

const deviceIdArg = getArg("--device", "-1");
const sampleRateArg = getArg("--sample-rate", "16000");

const deviceId = Number(deviceIdArg);
const sampleRate = Number(sampleRateArg);

if (!Number.isInteger(deviceId)) {
  throw new Error(`Invalid --device value: ${deviceIdArg}`);
}

if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
  throw new Error(`Invalid --sample-rate value: ${sampleRateArg}`);
}

const capture = new AudioCapture({
  deviceId,
  sampleRate,
});

let sampleCount = 0;
let sumSq = 0;
let peak = 0;

capture.on("audio", (chunk: Float32Array) => {
  for (let i = 0; i < chunk.length; i++) {
    const v = chunk[i];
    sampleCount++;
    sumSq += v * v;
    const abs = Math.abs(v);
    if (abs > peak) peak = abs;
  }
});

capture.on("error", (err: Error) => {
  console.error("Audio error:", err.message);
});

const actualSampleRate = capture.getSampleRate();
console.log(`Monitoring mic level for device=${deviceId}; requested=${sampleRate}Hz actual=${actualSampleRate}Hz`);
console.log("Speak normally for a few seconds. Press Ctrl+C to stop.");

const interval = setInterval(() => {
  const rms = Math.sqrt(sumSq / Math.max(1, sampleCount));
  console.log(`RMS=${rms.toFixed(5)} peak=${peak.toFixed(5)} samples=${sampleCount}`);
  sampleCount = 0;
  sumSq = 0;
  peak = 0;
}, 1000);

capture.start();

process.on("SIGINT", () => {
  clearInterval(interval);
  capture.stop();
  process.exit(0);
});
