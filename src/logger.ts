// src/logger.ts
import * as fs from "fs";
import * as path from "path";

export interface TranscriptionEntry {
  ts: string;
  duration: number;
  text: string;
  speaker: string;
}

export class TranscriptionLogger {
  private outputDir: string;
  private currentDate: string = "";
  private fd: number | null = null;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
    fs.mkdirSync(outputDir, { recursive: true });
  }

  write(entry: TranscriptionEntry): void {
    const today = new Date().toISOString().split("T")[0];
    if (today !== this.currentDate) {
      this.rotate(today);
    }
    const line = JSON.stringify(entry) + "\n";
    fs.writeSync(this.fd!, line);
  }

  private rotate(date: string): void {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
    }
    this.currentDate = date;
    const filePath = path.join(this.outputDir, `${date}.jsonl`);
    this.fd = fs.openSync(filePath, "a");
  }

  close(): void {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }
}
