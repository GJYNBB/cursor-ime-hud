import * as fs from "node:fs";
import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import * as vscode from "vscode";
import { DetectorLogEntry, ImeDetectorDebugInfo, ImeSnapshot } from "../model/types";
import { ImeDetector } from "./ImeDetector";
import { parseLogLine, parseSnapshotLine } from "./helperProtocol";

const STARTUP_TIMEOUT_MS = 4000;
const RESTART_DELAY_MS = 1500;

type HelperLifecycleState = "idle" | "starting" | "running" | "stopping" | "disposed";

export class NativeHelperImeDetector implements ImeDetector {
  private readonly onDidChangeSnapshotEmitter = new vscode.EventEmitter<ImeSnapshot>();
  private readonly onDidLogEmitter = new vscode.EventEmitter<DetectorLogEntry>();
  private child?: ChildProcessWithoutNullStreams;
  private childCleanup?: () => void;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private disposed = false;
  private lifecycleState: HelperLifecycleState = "idle";
  private startPromise?: Promise<void>;
  private restartTimer?: NodeJS.Timeout;
  private snapshot: ImeSnapshot = {
    type: "state",
    state: "unknown",
    timestamp: new Date(0).toISOString(),
    source: "native-helper",
    reason: "detector-idle",
    confidence: 0,
    rawStateAvailable: false
  };

  public readonly onDidChangeSnapshot = this.onDidChangeSnapshotEmitter.event;
  public readonly onDidLog = this.onDidLogEmitter.event;

  public constructor(private readonly helperPath: string) {}

  public async start(): Promise<void> {
    if (this.disposed || this.lifecycleState === "disposed") {
      throw new Error("NativeHelperImeDetector has been disposed.");
    }

    if (this.lifecycleState === "running" && this.child && !this.child.killed) {
      return;
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.clearRestartTimer();
    this.lifecycleState = "starting";
    this.startPromise = this.spawnAndWaitForFirstSnapshot()
      .then(() => {
        if (!this.disposed) {
          this.lifecycleState = "running";
        }
      })
      .catch((error) => {
        if (!this.disposed) {
          this.lifecycleState = "idle";
        }

        throw error;
      })
      .finally(() => {
        this.startPromise = undefined;
      });

    return this.startPromise;
  }

  public refresh(): void {
    this.tryWriteCommand({ command: "refresh" }, this.child);
  }

  public getSnapshot(): ImeSnapshot {
    return this.snapshot;
  }

  public getDebugInfo(): ImeDetectorDebugInfo {
    return {
      source: "native-helper",
      backendName: "WinImeWatcher",
      helperPath: this.helperPath,
      usingFallback: false,
      lifecycleState: this.lifecycleState
    };
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.lifecycleState = "stopping";
    this.clearRestartTimer();
    this.teardownChild(true);
    this.lifecycleState = "disposed";
    this.onDidChangeSnapshotEmitter.dispose();
    this.onDidLogEmitter.dispose();
  }

  private async spawnAndWaitForFirstSnapshot(): Promise<void> {
    if (!fs.existsSync(this.helperPath)) {
      throw new Error(`IME helper not found at ${this.helperPath}`);
    }

    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.helperPath, [], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      });

      let startupCompleted = false;
      let startupFailed = false;
      const startupTimer = setTimeout(() => {
        startupFailed = true;
        this.teardownSpecificChild(child, true);
        reject(new Error(`IME helper did not produce a snapshot within ${STARTUP_TIMEOUT_MS}ms.`));
      }, STARTUP_TIMEOUT_MS);

      this.child = child;
      this.stdoutBuffer = "";
      this.stderrBuffer = "";

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      const clearStartupTimer = (): void => {
        clearTimeout(startupTimer);
      };

      const onChildError = (error: Error): void => {
        startupFailed = true;
        this.emitLog("error", "Failed to spawn IME helper.", { error: error.message });
        clearStartupTimer();
        this.teardownSpecificChild(child, true);
        reject(error);
      };

      const onStdoutData = (chunk: string): void => {
        if (this.child !== child || this.disposed) {
          return;
        }

        this.stdoutBuffer += chunk;
        const receivedSnapshot = this.consumeBufferedLines("stdout");
        if (receivedSnapshot && !startupCompleted) {
          startupCompleted = true;
          clearStartupTimer();
          resolve();
        }
      };

      const onStderrData = (chunk: string): void => {
        if (this.child !== child || this.disposed) {
          return;
        }

        this.stderrBuffer += chunk;
        this.consumeBufferedLines("stderr");
      };

      const onStdinError = (error: Error): void => {
        if (this.disposed || this.lifecycleState === "stopping" || this.child !== child) {
          return;
        }

        this.emitLog("warn", "IME helper stdin stream reported an error.", { error: error.message });
      };

      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        const details = { code, signal };
        clearStartupTimer();
        this.teardownSpecificChild(child, false);

        if (this.disposed || this.lifecycleState === "stopping" || this.lifecycleState === "disposed") {
          return;
        }

        this.lifecycleState = "idle";

        if (startupFailed) {
          return;
        }

        if (!startupCompleted) {
          reject(new Error(`IME helper exited before initialization: ${JSON.stringify(details)}`));
          return;
        }

        this.emitLog("warn", "IME helper exited. Scheduling restart.", details);
        this.scheduleRestart(RESTART_DELAY_MS);
      };

      this.childCleanup = () => {
        clearStartupTimer();
        child.removeListener("error", onChildError);
        child.removeListener("exit", onExit);
        child.stdout.removeListener("data", onStdoutData);
        child.stderr.removeListener("data", onStderrData);
        child.stdin.removeListener("error", onStdinError);
      };

      child.on("error", onChildError);
      child.on("exit", onExit);
      child.stdout.on("data", onStdoutData);
      child.stderr.on("data", onStderrData);
      child.stdin.on("error", onStdinError);

      this.tryWriteCommand({ command: "refresh" }, child);
    });
  }

  private scheduleRestart(delayMs: number): void {
    this.clearRestartTimer();
    if (this.disposed) {
      return;
    }

    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      if (!this.disposed) {
        void this.restart();
      }
    }, delayMs);
  }

  private async restart(): Promise<void> {
    try {
      await this.start();
      this.emitLog("info", "IME helper restarted successfully.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitLog("error", "IME helper restart failed.", { error: message });
      this.scheduleRestart(RESTART_DELAY_MS * 2);
    }
  }

  private consumeBufferedLines(stream: "stdout" | "stderr"): boolean {
    const buffer = stream === "stdout" ? this.stdoutBuffer : this.stderrBuffer;
    const lines = buffer.split(/\r?\n/);
    const remainder = lines.pop() ?? "";

    if (stream === "stdout") {
      this.stdoutBuffer = remainder;
    } else {
      this.stderrBuffer = remainder;
    }

    let receivedSnapshot = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }

      if (stream === "stdout") {
        receivedSnapshot = this.handleSnapshotLine(trimmed) || receivedSnapshot;
      } else {
        this.handleLogLine(trimmed);
      }
    }

    return receivedSnapshot;
  }

  private handleSnapshotLine(line: string): boolean {
    const snapshot = parseSnapshotLine(line);
    if (!snapshot) {
      this.emitLog("warn", "Failed to parse IME helper stdout line.", { line });
      return false;
    }

    this.snapshot = snapshot;
    if (!this.disposed) {
      this.onDidChangeSnapshotEmitter.fire(snapshot);
    }

    return true;
  }

  private handleLogLine(line: string): void {
    const entry = parseLogLine(line);
    if (entry) {
      if (!this.disposed) {
        this.onDidLogEmitter.fire(entry);
      }
      return;
    }

    this.emitLog("info", line);
  }

  private emitLog(level: DetectorLogEntry["level"], message: string, details?: unknown): void {
    if (this.disposed) {
      return;
    }

    this.onDidLogEmitter.fire({
      type: "log",
      level,
      message,
      timestamp: new Date().toISOString(),
      details,
      source: "native-helper"
    });
  }

  private tryWriteCommand(command: Record<string, string>, child: ChildProcessWithoutNullStreams | undefined): boolean {
    if (
      !child ||
      child.killed ||
      this.disposed ||
      this.lifecycleState === "stopping" ||
      this.lifecycleState === "disposed"
    ) {
      return false;
    }

    const stdin = child.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable || stdin.writableEnded) {
      return false;
    }

    try {
      stdin.write(`${JSON.stringify(command)}\n`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitLog("warn", "Failed to write a command to the IME helper.", { error: message, command });
      return false;
    }
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }
  }

  private teardownChild(killProcess: boolean): void {
    if (!this.child) {
      return;
    }

    this.teardownSpecificChild(this.child, killProcess);
  }

  private teardownSpecificChild(child: ChildProcessWithoutNullStreams, killProcess: boolean): void {
    if (this.childCleanup) {
      this.childCleanup();
      this.childCleanup = undefined;
    }

    if (killProcess && !child.killed) {
      try {
        child.kill();
      } catch {
        // Ignore shutdown races.
      }
    }

    if (this.child === child) {
      this.child = undefined;
    }
  }
}
