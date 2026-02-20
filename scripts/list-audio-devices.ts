import { AudioCapture } from "../src/audio-capture";

const devices = AudioCapture.listDevices();

if (devices.length === 0) {
  console.log("No input audio devices found.");
  process.exit(0);
}

console.log("Input audio devices:");
for (const device of devices) {
  const host = device.hostAPIName ? ` api=${device.hostAPIName}` : "";
  const rate = device.defaultSampleRate ? ` defaultRate=${device.defaultSampleRate}` : "";
  const isDefault = device.isDefaultInput ? " defaultInput=true" : "";
  console.log(`- id=${device.id} channels=${device.maxInputChannels}${host}${rate}${isDefault} name=${device.name}`);
}
