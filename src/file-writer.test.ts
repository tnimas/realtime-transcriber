// src/file-writer.test.ts
import { FileWriter } from "./file-writer";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const testDir = path.join(os.tmpdir(), "transcriber-test-" + Date.now());

const writer = new FileWriter(testDir);

// Write two entries
writer.write({ ts: new Date().toISOString(), duration: 2.5, text: "Hello world" });
writer.write({ ts: new Date().toISOString(), duration: 1.2, text: "Test entry" });

writer.close();

// Verify file exists with today's date
const today = new Date().toISOString().split("T")[0];
const filePath = path.join(testDir, `${today}.jsonl`);
console.assert(fs.existsSync(filePath), `File should exist: ${filePath}`);

// Verify content
const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
console.assert(lines.length === 2, `Expected 2 lines, got ${lines.length}`);

const entry1 = JSON.parse(lines[0]);
console.assert(entry1.text === "Hello world", `Expected 'Hello world', got '${entry1.text}'`);
console.assert(entry1.duration === 2.5, `Expected 2.5, got ${entry1.duration}`);

const entry2 = JSON.parse(lines[1]);
console.assert(entry2.text === "Test entry", `Expected 'Test entry', got '${entry2.text}'`);

// Cleanup
fs.rmSync(testDir, { recursive: true });
console.log("file-writer tests passed");
