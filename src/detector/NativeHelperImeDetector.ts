import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import * as vscode from "vscode";
import { DetectorLogEntry, ImeDetectorDebugInfo, ImeSnapshot } from "../model/types";
import { ImeDetector } from "./ImeDetector";
import { parseHelloLine, parseLogLine, parseSnapshotLine, PROTOCOL_VERSION } from "./helperProtocol";

const STARTUP_TIMEOUT_MS = 4000;
const RESTART_DELAY_MS = 1500;
const MAX_LINE_BYTES = 64 * 1024;
const MAX_BUFFER_BYTES = 1024 * 1024;
const MAX_RESTART_ATTEMPTS = 10;
const RESTART_JITTER_RATIO = 0.2;
// Helper integrity is enforced via the generated .sha256 sidecar.
const SHUTDOWN_TIMEOUT_MS = 2000;

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
  private restartAttempts = 0;
  private helloReceived = false;
  private pendingExitCleanup?: Promise<void>;
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
          this.restartAttempts = 0;
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

    // Graceful shutdown:
    //  1. Detach listeners so a late exit does not feed the restart loop.
    //  2. End stdin so the C# helper's `Console.In.ReadLineAsync` returns
    //     null and its main loop can fall through cleanly.
    //  3. Send SIGTERM (Node's default `kill()`; on Windows it maps to
    //     `TerminateProcess`).
    //  4. Kick off an async wait for the child to exit. If it has not
    //     exited within `SHUTDOWN_TIMEOUT_MS`, escalate to `taskkill /F /T`
    //     on Windows so any descendants also die.
    //
    // `vscode.Disposable.dispose()` is synchronous, so the await runs as
    // a fire-and-forget promise. We keep the reference on
    // `pendingExitCleanup` so the test harness (and dispose() callers
    // that want deterministic teardown) can await it.
    const child = this.child;
    if (child) {
      this.teardownSpecificChild(child, false);
      this.requestChildShutdown(child);
      this.pendingExitCleanup = this.awaitChildExit(child);
    }

    this.lifecycleState = "disposed";
    this.onDidChangeSnapshotEmitter.dispose();
    this.onDidLogEmitter.dispose();
  }

  /**
   * Promise tracking the post-dispose child exit wait. Tests can await
   * this for deterministic teardown; production callers can ignore it.
   */
  public async waitForPendingExit(): Promise<void> {
    if (this.pendingExitCleanup) {
      await this.pendingExitCleanup;
    }
  }

  private async spawnAndWaitForFirstSnapshot(): Promise<void> {
    if (!fs.existsSync(this.helperPath)) {
      throw new Error(`IME helper not found at ${this.helperPath}`);
    }

    this.verifyHelperIntegrity(this.helperPath);

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
        try {
          const receivedSnapshot = this.consumeBufferedLines("stdout");
          if (receivedSnapshot && !startupCompleted) {
            startupCompleted = true;
            clearStartupTimer();
            resolve();
          }
        } catch (lineError) {
          const message = lineError instanceof Error ? lineError.message : String(lineError);
          this.emitLog("error", "IME helper stdout handler failed.", { error: message });
          if (!startupCompleted) {
            startupFailed = true;
            clearStartupTimer();
            this.teardownSpecificChild(child, true);
            reject(lineError);
          } else {
            this.scheduleRestart(RESTART_DELAY_MS);
          }
        }
      };

      const onStderrData = (chunk: string): void => {
        if (this.child !== child || this.disposed) {
          return;
        }

        this.stderrBuffer += chunk;
        try {
          this.consumeBufferedLines("stderr");
        } catch (lineError) {
          const message = lineError instanceof Error ? lineError.message : String(lineError);
          this.emitLog("error", "IME helper stderr handler failed.", { error: message });
          if (!startupCompleted) {
            startupFailed = true;
            clearStartupTimer();
            this.teardownSpecificChild(child, true);
            reject(lineError);
          } else {
            this.scheduleRestart(RESTART_DELAY_MS);
          }
        }
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

        const reason = code === 2
          ? "helper-exited-health-check-failed"
          : "helper-exited";
        this.synthesizeUnknownSnapshot(reason, details);
        this.emitLog("warn", "IME helper exited. Scheduling restart.", { reason, ...details });
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

    const jitterFactor = 1 + (Math.random() * 2 - 1) * RESTART_JITTER_RATIO;
    const jitteredDelay = Math.max(0, Math.round(delayMs * jitterFactor));
    this.emitLog("info", "IME helper restart scheduled.", { delayMs: jitteredDelay, baseDelayMs: delayMs });

    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      if (!this.disposed) {
        void this.restart();
      }
    }, jitteredDelay);
  }

  private async restart(): Promise<void> {
    this.restartAttempts += 1;
    if (this.restartAttempts > MAX_RESTART_ATTEMPTS) {
      this.emitLog("error", "IME helper gave up after exceeding the maximum restart attempts.", {
        attempts: this.restartAttempts,
        max: MAX_RESTART_ATTEMPTS
      });
      return;
    }

    try {
      await this.start();
      this.emitLog("info", "IME helper restarted successfully.", { attempt: this.restartAttempts });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitLog("error", "IME helper restart failed.", { error: message, attempt: this.restartAttempts });
      this.scheduleRestart(RESTART_DELAY_MS * 2);
    }
  }

  private consumeBufferedLines(stream: "stdout" | "stderr"): boolean {
    const buffer = stream === "stdout" ? this.stdoutBuffer : this.stderrBuffer;
    const bufferBytes = Buffer.byteLength(buffer, "utf8");
    if (bufferBytes > MAX_BUFFER_BYTES) {
      this.resetBuffer(stream);
      throw new Error(
        `IME helper ${stream} buffer exceeded ${MAX_BUFFER_BYTES} bytes (had ${bufferBytes}).`
      );
    }

    const lines = buffer.split(/\r?\n/);
    const remainder = lines.pop() ?? "";
    const remainderBytes = Buffer.byteLength(remainder, "utf8");
    if (remainderBytes > MAX_LINE_BYTES) {
      this.resetBuffer(stream);
      throw new Error(
        `IME helper ${stream} line exceeded ${MAX_LINE_BYTES} bytes (had ${remainderBytes}).`
      );
    }

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
        receivedSnapshot = this.handleStdoutLine(trimmed) || receivedSnapshot;
      } else {
        this.handleLogLine(trimmed);
      }
    }

    return receivedSnapshot;
  }

  private handleStdoutLine(line: string): boolean {
    if (!this.helloReceived) {
      const hello = parseHelloLine(line);
      if (hello) {
        if (hello.version !== PROTOCOL_VERSION) {
          this.emitLog("error", "IME helper protocol version mismatch.", {
            expected: PROTOCOL_VERSION,
            actual: hello.version
          });
          throw new Error(
            `IME helper protocol version mismatch: expected ${PROTOCOL_VERSION}, got ${hello.version}.`
          );
        }

        this.helloReceived = true;
        this.emitLog("info", "IME helper hello received.", {
          version: hello.version,
          capabilities: hello.capabilities
        });
        return false;
      }

      this.emitLog("error", "IME helper did not send hello as the first line. Refusing to start.", { line });
      throw new Error("IME helper did not send hello as the first line. Refusing to start.");
    }

    return this.handleSnapshotLine(line);
  }

  private resetBuffer(stream: "stdout" | "stderr"): void {
    if (stream === "stdout") {
      this.stdoutBuffer = "";
    } else {
      this.stderrBuffer = "";
    }
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

  private verifyHelperIntegrity(helperPath: string): void {
    const hashPath = `${helperPath}.sha256`;
    if (!fs.existsSync(hashPath)) {
      this.emitLog("warn", "IME helper hash sidecar is missing; skipping integrity check.", {
        helperPath,
        hashPath
      });
      return;
    }

    const expected = fs.readFileSync(hashPath, "utf8").trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expected)) {
      throw new Error(`IME helper hash sidecar is invalid: ${hashPath}`);
    }

    const fileBuffer = fs.readFileSync(helperPath);
    const actual = crypto.createHash("sha256").update(fileBuffer).digest("hex").toLowerCase();
    if (actual !== expected) {
      throw new Error(
        `IME helper SHA-256 mismatch. expected=${expected} actual=${actual} path=${helperPath}`
      );
    }
  }

  private synthesizeUnknownSnapshot(reason: string, details?: unknown): void {
    const unknownSnapshot: ImeSnapshot = {
      type: "state",
      state: "unknown",
      timestamp: new Date().toISOString(),
      source: "native-helper",
      imeName: this.snapshot.imeName,
      isOpen: undefined,
      layoutHex: this.snapshot.layoutHex,
      threadId: this.snapshot.threadId,
      hwnd: this.snapshot.hwnd,
      reason,
      confidence: 0,
      rawStateAvailable: false
    };
    this.snapshot = unknownSnapshot;
    if (!this.disposed) {
      this.onDidChangeSnapshotEmitter.fire(unknownSnapshot);
      if (details !== undefined) {
        this.emitLog("info", "Synthesized unknown snapshot after helper exit.", { reason, details });
      }
    }
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

  private requestChildShutdown(child: ChildProcessWithoutNullStreams): void {
    const stdin = child.stdin;
    if (stdin && !stdin.destroyed && stdin.writable) {
      try {
        stdin.end();
      } catch {
        // Ignore stdin close races; the kill below is the authoritative shutdown signal.
      }
    }

    if (!child.killed && child.exitCode === null && child.signalCode === null) {
      try {
        child.kill();
      } catch {
        // Ignore kill races; the OS will reap the process when its handles close.
      }
    }
  }

  private async awaitChildExit(child: ChildProcessWithoutNullStreams): Promise<void> {
    const exited = (): boolean => child.exitCode !== null || child.signalCode !== null;

    if (exited()) {
      return;
    }

    const exitPromise = new Promise<void>((resolve) => {
      const finalize = (): void => resolve();
      child.once("exit", finalize);
      child.once("error", finalize);
    });

    const timeoutPromise = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, SHUTDOWN_TIMEOUT_MS);
      // Don't keep the event loop alive just for this timer.
      if (typeof timer.unref === "function") {
        timer.unref();
      }
    });

    await Promise.race([exitPromise, timeoutPromise]);

    if (!exited() && process.platform === "win32" && child.pid) {
      await new Promise<void>((resolve) => {
        try {
          const killer = spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)], {
            windowsHide: true,
            stdio: "ignore"
          });
          killer.once("exit", () => resolve());
          killer.once("error", () => resolve());
        } catch {
          resolve();
        }
      });
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
