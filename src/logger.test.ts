import { describe, it, expect, afterAll } from "vitest";
import { TranscriptionLogger } from "./logger";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const testDir = path.join(os.tmpdir(), "transcriber-test-" + Date.now());

describe("TranscriptionLogger", () => {
  const writer = new TranscriptionLogger(testDir);

  afterAll(() => {
    writer.close();
    fs.rmSync(testDir, { recursive: true });
  });

  it("should write entries to a dated .jsonl file", () => {
    writer.write({ ts: new Date().toISOString(), duration: 2.5, text: "Hello world", speaker: "Speaker 1" });
    writer.write({ ts: new Date().toISOString(), duration: 1.2, text: "Test entry", speaker: "Speaker 2" });
    writer.close();

    const today = new Date().toISOString().split("T")[0];
    const filePath = path.join(testDir, `${today}.jsonl`);

    expect(fs.existsSync(filePath)).toBe(true);

    const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);

    const entry1 = JSON.parse(lines[0]);
    expect(entry1.text).toBe("Hello world");
    expect(entry1.duration).toBe(2.5);

    const entry2 = JSON.parse(lines[1]);
    expect(entry2.text).toBe("Test entry");
  });
});
