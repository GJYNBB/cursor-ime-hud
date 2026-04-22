import * as fs from "node:fs";
import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import * as vscode from "vscode";
import { DetectorLogEntry, ImeDetectorDebugInfo, ImeSnapshot } from "../model/types";
import { ImeDetector } from "./ImeDetector";

const STARTUP_TIMEOUT_MS = 4000;
const RESTART_DELAY_MS = 1500;

export class NativeHelperImeDetector implements ImeDetector {
  private readonly onDidChangeSnapshotEmitter = new vscode.EventEmitter<ImeSnapshot>();
  private readonly onDidLogEmitter = new vscode.EventEmitter<DetectorLogEntry>();
  private child?: ChildProcessWithoutNullStreams;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private disposed = false;
  private ready = false;
  private startingPromise?: Promise<void>;
  private snapshot: ImeSnapshot = {
    type: "state",
    state: "unknown",
    timestamp: new Date(0).toISOString(),
    source: "native-helper"
  };

  public readonly onDidChangeSnapshot = this.onDidChangeSnapshotEmitter.event;
  public readonly onDidLog = this.onDidLogEmitter.event;

  public constructor(private readonly helperPath: string) {}

  public async start(): Promise<void> {
    if (this.ready && this.child && !this.child.killed) {
      return;
    }

    if (this.startingPromise) {
      return this.startingPromise;
    }

    this.startingPromise = this.spawnAndWaitForFirstSnapshot();
    try {
      await this.startingPromise;
    } finally {
      this.startingPromise = undefined;
    }
  }

  public refresh(): void {
    this.writeCommand({ command: "refresh" });
  }

  public getSnapshot(): ImeSnapshot {
    return this.snapshot;
  }

  public getDebugInfo(): ImeDetectorDebugInfo {
    return {
      source: "native-helper",
      backendName: "WinImeWatcher",
      helperPath: this.helperPath,
      usingFallback: false
    };
  }

  public dispose(): void {
    this.disposed = true;
    this.child?.kill();
    this.onDidChangeSnapshotEmitter.dispose();
    this.onDidLogEmitter.dispose();
  }

  private async spawnAndWaitForFirstSnapshot(): Promise<void> {
    if (!fs.existsSync(this.helperPath)) {
      throw new Error(`IME helper not found at ${this.helperPath}`);
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const startupTimer = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        this.child?.kill();
        reject(new Error(`IME helper did not produce a snapshot within ${STARTUP_TIMEOUT_MS}ms.`));
      }, STARTUP_TIMEOUT_MS);

      const child = spawn(this.helperPath, [], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      });

      this.child = child;
      this.stdoutBuffer = "";
      this.stderrBuffer = "";
      this.ready = false;

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      child.on("error", (error: Error) => {
        this.emitLog("error", "Failed to spawn IME helper.", { error: error.message });
        if (!settled) {
          settled = true;
          clearTimeout(startupTimer);
          reject(error);
        }
      });

      child.stdout.on("data", (chunk: string) => {
        this.stdoutBuffer += chunk;
        this.consumeBufferedLines("stdout");
        if (this.ready && !settled) {
          settled = true;
          clearTimeout(startupTimer);
          resolve();
        }
      });

      child.stderr.on("data", (chunk: string) => {
        this.stderrBuffer += chunk;
        this.consumeBufferedLines("stderr");
      });

      child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
        const details = { code, signal };
        if (!settled) {
          settled = true;
          clearTimeout(startupTimer);
          reject(new Error(`IME helper exited before initialization: ${JSON.stringify(details)}`));
          return;
        }

        this.emitLog("warn", "IME helper exited. Scheduling restart.", details);
        this.child = undefined;
        this.ready = false;

        if (!this.disposed) {
          setTimeout(() => {
            if (!this.disposed) {
              void this.restart();
            }
          }, RESTART_DELAY_MS);
        }
      });

      this.writeCommand({ command: "refresh" });
    });
  }

  private async restart(): Promise<void> {
    try {
      await this.start();
      this.emitLog("info", "IME helper restarted successfully.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitLog("error", "IME helper restart failed.", { error: message });
      if (!this.disposed) {
        setTimeout(() => {
          if (!this.disposed) {
            void this.restart();
          }
        }, RESTART_DELAY_MS * 2);
      }
    }
  }

  private consumeBufferedLines(stream: "stdout" | "stderr"): void {
    const buffer = stream === "stdout" ? this.stdoutBuffer : this.stderrBuffer;
    const lines = buffer.split(/\r?\n/);
    const remainder = lines.pop() ?? "";

    if (stream === "stdout") {
      this.stdoutBuffer = remainder;
    } else {
      this.stderrBuffer = remainder;
    }

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }

      if (stream === "stdout") {
        this.handleSnapshotLine(trimmed);
      } else {
        this.handleLogLine(trimmed);
      }
    }
  }

  private handleSnapshotLine(line: string): void {
    try {
      const parsed = JSON.parse(line) as Partial<ImeSnapshot>;
      if (parsed.type !== "state") {
        return;
      }

      const nextState = parsed.state === "cn" || parsed.state === "en" || parsed.state === "unknown" ? parsed.state : "unknown";
      this.snapshot = {
        type: "state",
        state: nextState,
        timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : new Date().toISOString(),
        source: "native-helper",
        imeName: typeof parsed.imeName === "string" ? parsed.imeName : undefined,
        isOpen: typeof parsed.isOpen === "boolean" ? parsed.isOpen : undefined,
        layoutHex: typeof parsed.layoutHex === "string" ? parsed.layoutHex : undefined,
        threadId: typeof parsed.threadId === "number" ? parsed.threadId : undefined,
        hwnd: typeof parsed.hwnd === "string" ? parsed.hwnd : undefined
      };
      this.ready = true;
      this.onDidChangeSnapshotEmitter.fire(this.snapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitLog("warn", "Failed to parse IME helper stdout line.", { line, error: message });
    }
  }

  private handleLogLine(line: string): void {
    try {
      const parsed = JSON.parse(line) as Partial<DetectorLogEntry>;
      if (parsed.type === "log" && typeof parsed.message === "string") {
        this.onDidLogEmitter.fire({
          type: "log",
          level: parsed.level === "error" || parsed.level === "warn" ? parsed.level : "info",
          message: parsed.message,
          timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : new Date().toISOString(),
          details: parsed.details,
          source: typeof parsed.source === "string" ? parsed.source : "native-helper"
        });
        return;
      }
    } catch {
      // fall through to raw log handling
    }

    this.emitLog("info", line);
  }

  private emitLog(level: DetectorLogEntry["level"], message: string, details?: unknown): void {
    this.onDidLogEmitter.fire({
      type: "log",
      level,
      message,
      timestamp: new Date().toISOString(),
      details,
      source: "native-helper"
    });
  }

  private writeCommand(command: Record<string, string>): void {
    const child = this.child;
    if (!child || child.killed) {
      return;
    }

    child.stdin.write(`${JSON.stringify(command)}\n`);
  }
}
