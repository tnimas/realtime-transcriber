import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "child_process";
import { downloadModel, downloadSpeaker, downloadVad, getModelDir } from "../src/model-downloader";

describe("model-downloader", () => {
  const createdDirs: string[] = [];

  afterEach(() => {
    vi.clearAllMocks();
    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns model directory by model name", () => {
    expect(getModelDir("parakeet")).toContain("parakeet");
    expect(getModelDir("gigaam")).toContain("giga-am-v2");
  });

  it("throws clear error for unsupported model name", () => {
    expect(() => getModelDir("unknown" as never)).toThrow("Unsupported model");
  });

  it("skips ASR download when model directory already exists", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transcriber-models-"));
    createdDirs.push(dir);

    fs.mkdirSync(path.join(dir, getModelDir("parakeet")));
    downloadModel("parakeet", dir);

    expect(execSync).not.toHaveBeenCalled();
  });

  it("downloads and extracts ASR model when missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transcriber-models-"));
    createdDirs.push(dir);

    fs.writeFileSync(path.join(dir, "gigaam-v2.tar.bz2"), "stub");
    downloadModel("gigaam", dir);

    expect(execSync).toHaveBeenCalledTimes(2);
    const execMock = vi.mocked(execSync);
    expect(execMock.mock.calls[0][0]).toContain("curl -SL -o");
    expect(execMock.mock.calls[1][0]).toContain("tar xjf");
  });

  it("downloads VAD only when missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transcriber-models-"));
    createdDirs.push(dir);

    downloadVad(dir);
    expect(execSync).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    fs.writeFileSync(path.join(dir, "silero_vad.onnx"), "stub");
    downloadVad(dir);
    expect(execSync).not.toHaveBeenCalled();
  });

  it("downloads speaker model only when missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transcriber-models-"));
    createdDirs.push(dir);

    downloadSpeaker(dir);
    expect(execSync).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    fs.writeFileSync(path.join(dir, "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx"), "stub");
    downloadSpeaker(dir);
    expect(execSync).not.toHaveBeenCalled();
  });

  it("throws for unsupported model in downloader", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transcriber-models-"));
    createdDirs.push(dir);

    expect(() => downloadModel("bad-model" as never, dir)).toThrow("Unsupported model");
  });
});
