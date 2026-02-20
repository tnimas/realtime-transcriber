import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TranscriptionLogger } from "../src/logger";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

describe("TranscriptionLogger", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "transcriber-logger-"));
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("writes JSONL entries to daily file", () => {
    vi.setSystemTime(new Date("2026-02-20T09:00:00.000Z"));
    const logger = new TranscriptionLogger(testDir);

    logger.write({ ts: "2026-02-20T09:00:00.000Z", duration: 2.5, text: "Hello world", speaker: "Speaker_1" });
    logger.write({ ts: "2026-02-20T09:00:03.000Z", duration: 1.2, text: "Test entry", speaker: "Speaker_2" });
    logger.close();

    const filePath = path.join(testDir, "2026-02-20.jsonl");
    const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).text).toBe("Hello world");
    expect(JSON.parse(lines[1]).speaker).toBe("Speaker_2");
  });

  it("rotates file descriptor when day changes", () => {
    const logger = new TranscriptionLogger(testDir);

    vi.setSystemTime(new Date("2026-02-20T23:59:59.000Z"));
    logger.write({ ts: "2026-02-20T23:59:59.000Z", duration: 0.5, text: "Before midnight", speaker: "Speaker_1" });

    vi.setSystemTime(new Date("2026-02-21T00:00:01.000Z"));
    logger.write({ ts: "2026-02-21T00:00:01.000Z", duration: 0.4, text: "After midnight", speaker: "Speaker_1" });
    logger.close();

    expect(fs.existsSync(path.join(testDir, "2026-02-20.jsonl"))).toBe(true);
    expect(fs.existsSync(path.join(testDir, "2026-02-21.jsonl"))).toBe(true);
  });

  it("close is idempotent", () => {
    vi.setSystemTime(new Date("2026-02-20T00:00:00.000Z"));
    const logger = new TranscriptionLogger(testDir);
    logger.write({ ts: "2026-02-20T00:00:00.000Z", duration: 1, text: "x", speaker: "Speaker_1" });
    logger.close();

    expect(() => logger.close()).not.toThrow();
  });
});
