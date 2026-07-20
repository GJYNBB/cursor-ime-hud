import * as crypto from "node:crypto";
import * as fs from "node:fs";
import {
  ChildProcessWithoutNullStreams,
  spawn,
  SpawnOptionsWithStdioTuple,
  StdioPipe
} from "node:child_process";
import * as vscode from "vscode";
import { DetectorLogEntry, ImeDetectorDebugInfo, ImeSnapshot } from "../model/types";
import { ImeDetector } from "./ImeDetector";
import {
  parseHelloLine,
  parseLogLine,
  parseSnapshotLine,
  PROTOCOL_VERSION
} from "./helperProtocol";

const STARTUP_TIMEOUT_MS = 4000;
const RESTART_BASE_DELAY_MS = 1500;
const RESTART_MAX_DELAY_MS = 30_000;
const MAX_LINE_BYTES = 64 * 1024;
const MAX_BUFFER_BYTES = 1024 * 1024;
export const NATIVE_HELPER_MAX_RESTART_ATTEMPTS = 10;
export const NATIVE_HELPER_STABLE_RUN_MS = 30_000;
export const NATIVE_HELPER_FAILURE_WINDOW_MS = 5 * 60_000;
const RESTART_JITTER_RATIO = 0.2;
// Helper integrity is enforced via the generated .sha256 sidecar.
const SHUTDOWN_TIMEOUT_MS = 2000;

type HelperLifecycleState = "idle" | "starting" | "running" | "stopping" | "disposed";
type HelperSpawnOptions = SpawnOptionsWithStdioTuple<StdioPipe, StdioPipe, StdioPipe>;
type HelperSpawner = (
  command: string,
  args: readonly string[],
  options: HelperSpawnOptions
) => ChildProcessWithoutNullStreams;

export interface NativeHelperImeDetectorOptions {
  /** Test seam for the native process. Production uses node:child_process.spawn. */
  spawn?: HelperSpawner;
  /** Monotonic-enough wall clock used by the rolling failure window. */
  now?: () => number;
  /** Random source used to jitter restart delays. */
  random?: () => number;
}

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
  private stableRunTimer?: NodeJS.Timeout;
  private restartAttempts = 0;
  private restartFailureTimes: number[] = [];
  private circuitOpen = false;
  /** True while an automatic restart is waiting for start() to settle. */
  private automaticStartInProgress = false;
  /** Prevents restart() from counting the same start failure twice. */
  private automaticFailureRecorded = false;
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
  private helperPathExists = false;
  private helperSha256PathExists = false;
  private helperHashStatus: NonNullable<ImeDetectorDebugInfo["helperHashStatus"]> = "not-checked";
  private helperProtocolVersion?: number;
  private readonly spawnHelper: HelperSpawner;
  private readonly now: () => number;
  private readonly random: () => number;

  public readonly onDidChangeSnapshot = this.onDidChangeSnapshotEmitter.event;
  public readonly onDidLog = this.onDidLogEmitter.event;

  public constructor(
    private readonly helperPath: string,
    private readonly backendName: string = "ime-watcher",
    private readonly platformKey?: string,
    private readonly sha256Path: string = `${helperPath}.sha256`,
    options: NativeHelperImeDetectorOptions = {}
  ) {
    this.spawnHelper =
      options.spawn ?? ((command, args, spawnOptions) => spawn(command, [...args], spawnOptions));
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  public async start(): Promise<void> {
    if (this.disposed || this.lifecycleState === "disposed") {
      throw new Error("输入法辅助程序检测器已释放。");
    }

    if (this.circuitOpen) {
      throw new Error("输入法辅助程序自动重启熔断已开启，请手动刷新后重试。");
    }

    if (this.lifecycleState === "running" && this.child && !this.child.killed) {
      return;
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.clearRestartTimer();
    this.clearStableRunTimer();
    this.lifecycleState = "starting";
    this.startPromise = this.spawnAndWaitForFirstSnapshot()
      .then(() => {
        // The helper can emit its first snapshot and exit before the promise
        // continuation runs. Do not resurrect the lifecycle state (or arm a
        // stability timer) after the exit handler has already moved it back
        // to idle and detached the child.
        if (
          !this.disposed &&
          this.lifecycleState === "starting" &&
          this.child &&
          !this.child.killed
        ) {
          this.lifecycleState = "running";
          this.armStableRunReset();
        }
      })
      .catch((error) => {
        if (!this.disposed) {
          this.lifecycleState = "idle";

          if (
            this.automaticStartInProgress &&
            !this.circuitOpen &&
            !this.automaticFailureRecorded
          ) {
            const message = error instanceof Error ? error.message : String(error);
            this.recordFailureAndScheduleRestart("helper-start-failed", { error: message });
            this.automaticFailureRecorded = true;
          }
        }

        throw error;
      })
      .finally(() => {
        this.startPromise = undefined;
      });

    return this.startPromise;
  }

  public refresh(): void {
    if (this.disposed) {
      return;
    }

    // A command initiated by the user is the explicit recovery path from the
    // circuit breaker. It also cancels a pending backoff so the retry happens
    // immediately instead of making the user wait for the next timer tick.
    this.resetRestartBudget();
    this.clearRestartTimer();

    if (
      this.lifecycleState === "running" &&
      this.child &&
      !this.child.killed &&
      this.tryWriteCommand({ command: "refresh" }, this.child)
    ) {
      return;
    }

    if (this.startPromise) {
      return;
    }

    this.clearStableRunTimer();
    void this.start().catch((error) => {
      if (this.disposed) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      this.emitLog("error", "手动刷新时，输入法辅助程序启动失败。", { error: message });
      this.recordFailureAndScheduleRestart("manual-refresh-start-failed", { error: message });
    });
  }

  public getSnapshot(): ImeSnapshot {
    return this.snapshot;
  }

  public getDebugInfo(): ImeDetectorDebugInfo {
    return {
      source: "native-helper",
      backendName: this.backendName,
      helperPath: this.helperPath,
      helperPathExists: this.helperPathExists,
      helperPlatformKey: this.platformKey,
      helperSha256Path: this.sha256Path,
      helperSha256PathExists: this.helperSha256PathExists,
      helperHashStatus: this.helperHashStatus,
      helperProtocolVersion: this.helperProtocolVersion,
      usingFallback: false,
      lifecycleState: this.lifecycleState,
      restartAttempts: this.currentRestartAttempts(),
      circuitOpen: this.circuitOpen
    };
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.lifecycleState = "stopping";
    this.clearRestartTimer();
    this.clearStableRunTimer();

    // Graceful shutdown:
    //  1. Detach listeners so a late exit does not feed the restart loop.
    //  2. End stdin so the Rust helper's stdin reader observes EOF and
    //     its main loop can fall through cleanly.
    //  3. Kick off an async wait for the child to exit. If it has not
    //     exited within `SHUTDOWN_TIMEOUT_MS`, escalate to `taskkill /F /T`
    //     on Windows so any descendants also die, or `kill()` elsewhere.
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
    this.helperPathExists = fs.existsSync(this.helperPath);
    if (!this.helperPathExists) {
      throw new Error("未找到输入法辅助程序（IME helper not found）。");
    }

    this.verifyHelperIntegrity(this.helperPath);
    this.ensureHelperExecutable(this.helperPath);

    await new Promise<void>((resolve, reject) => {
      const child = this.spawnHelper(this.helperPath, [], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      });

      let startupCompleted = false;
      let startupFailed = false;
      const startupTimer = setTimeout(() => {
        startupFailed = true;
        this.teardownSpecificChild(child, true);
        reject(
          new Error(`输入法辅助程序在 ${STARTUP_TIMEOUT_MS} 毫秒内未产生快照（startup timeout）。`)
        );
      }, STARTUP_TIMEOUT_MS);

      this.child = child;
      this.stdoutBuffer = "";
      this.stderrBuffer = "";
      this.helloReceived = false;

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      const clearStartupTimer = (): void => {
        clearTimeout(startupTimer);
      };

      const onChildError = (error: Error): void => {
        this.emitLog("error", "输入法辅助程序进程发生错误。", { error: error.message });
        if (!startupCompleted) {
          startupFailed = true;
          clearStartupTimer();
          this.teardownSpecificChild(child, true);
          reject(new Error("启动输入法辅助程序失败（spawn failed）。"));
          return;
        }

        this.failActiveChildAndScheduleRestart(child, "process", error.message);
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
          this.emitLog("error", "输入法辅助程序的标准输出处理失败。", { error: message });
          if (!startupCompleted) {
            startupFailed = true;
            clearStartupTimer();
            this.teardownSpecificChild(child, true);
            reject(lineError);
          } else {
            this.failActiveChildAndScheduleRestart(child, "stdout", message);
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
          this.emitLog("error", "输入法辅助程序的标准错误输出处理失败。", {
            error: message
          });
          if (!startupCompleted) {
            startupFailed = true;
            clearStartupTimer();
            this.teardownSpecificChild(child, true);
            reject(lineError);
          } else {
            this.failActiveChildAndScheduleRestart(child, "stderr", message);
          }
        }
      };

      const onStdinError = (error: Error): void => {
        if (this.disposed || this.lifecycleState === "stopping" || this.child !== child) {
          return;
        }

        this.emitLog("warn", "输入法辅助程序的标准输入流发生错误。", {
          error: error.message
        });
      };

      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        const details = { code, signal };
        clearStartupTimer();
        this.teardownSpecificChild(child, false);

        if (
          this.disposed ||
          this.lifecycleState === "stopping" ||
          this.lifecycleState === "disposed"
        ) {
          return;
        }

        this.lifecycleState = "idle";
        this.clearStableRunTimer();

        if (startupFailed) {
          return;
        }

        if (!startupCompleted) {
          reject(new Error(`输入法辅助程序在初始化前退出：${JSON.stringify(details)}`));
          return;
        }

        const reason = code === 2 ? "helper-exited-health-check-failed" : "helper-exited";
        this.synthesizeUnknownSnapshot(reason, details);
        this.emitLog("warn", "输入法辅助程序意外退出，准备按退避策略重启。", {
          reason,
          ...details
        });
        this.recordFailureAndScheduleRestart(reason, details);
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

  private failActiveChildAndScheduleRestart(
    child: ChildProcessWithoutNullStreams,
    stream: "stdout" | "stderr" | "process",
    error: string
  ): void {
    if (this.disposed || this.child !== child) {
      return;
    }

    const reason =
      stream === "process" ? "helper-process-failed" : `helper-${stream}-stream-failed`;
    this.synthesizeUnknownSnapshot(reason, { error });
    this.lifecycleState = "idle";
    this.clearStableRunTimer();
    this.teardownSpecificChild(child, true);
    this.pendingExitCleanup = this.awaitChildExit(child);
    this.recordFailureAndScheduleRestart(reason, { error });
  }

  private scheduleRestart(delayMs: number): void {
    this.clearRestartTimer();
    if (this.disposed || this.circuitOpen) {
      return;
    }

    this.emitLog("info", "已安排输入法辅助程序重启。", {
      delayMs,
      restartAttempts: this.restartAttempts,
      failureWindowMs: NATIVE_HELPER_FAILURE_WINDOW_MS
    });

    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      if (!this.disposed && !this.circuitOpen) {
        void this.restart();
      }
    }, delayMs);
  }

  private async restart(): Promise<void> {
    if (this.disposed || this.circuitOpen) {
      return;
    }

    this.pruneFailureWindow();
    const attempt = this.restartAttempts;
    this.automaticStartInProgress = true;
    this.automaticFailureRecorded = false;
    try {
      await this.start();
      // `start()` resolves once the first snapshot arrives. The child can
      // still exit in the same turn before the promise continuation runs;
      // only call this a successful restart if the lifecycle actually reached
      // running and the process is still attached.
      if (!this.disposed && this.lifecycleState === "running" && this.child && !this.child.killed) {
        this.emitLog("info", "输入法辅助程序已重新启动；连续稳定运行 30 秒后会清零失败预算。", {
          attempt,
          stableRunMs: NATIVE_HELPER_STABLE_RUN_MS
        });
      }
    } catch (error) {
      if (this.disposed || this.circuitOpen) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      this.emitLog("error", "输入法辅助程序重启失败。", {
        error: message,
        attempt
      });
      if (!this.automaticFailureRecorded && !this.circuitOpen) {
        this.recordFailureAndScheduleRestart("helper-restart-failed", { error: message });
      }
    } finally {
      this.automaticStartInProgress = false;
      this.automaticFailureRecorded = false;
    }
  }

  private recordFailureAndScheduleRestart(reason: string, details?: unknown): void {
    if (this.disposed) {
      return;
    }

    this.clearStableRunTimer();
    const now = this.now();
    this.pruneFailureWindow(now);
    this.restartFailureTimes.push(now);
    this.restartAttempts = this.restartFailureTimes.length;

    if (this.restartAttempts >= NATIVE_HELPER_MAX_RESTART_ATTEMPTS) {
      this.circuitOpen = true;
      this.clearRestartTimer();
      this.emitLog(
        "error",
        "输入法辅助程序连续失败次数过多，已停止自动重启。请执行“刷新输入法状态”后手动重试。",
        {
          reason,
          details,
          restartAttempts: this.restartAttempts,
          maxRestartAttempts: NATIVE_HELPER_MAX_RESTART_ATTEMPTS,
          failureWindowMs: NATIVE_HELPER_FAILURE_WINDOW_MS
        }
      );
      return;
    }

    const baseDelayMs = Math.min(
      RESTART_MAX_DELAY_MS,
      RESTART_BASE_DELAY_MS * 2 ** Math.max(0, this.restartAttempts - 1)
    );
    const jitterFactor = 1 + (this.random() * 2 - 1) * RESTART_JITTER_RATIO;
    const delayMs = Math.min(
      RESTART_MAX_DELAY_MS,
      Math.max(0, Math.round(baseDelayMs * jitterFactor))
    );
    this.emitLog("warn", "输入法辅助程序发生故障，正在执行指数退避。", {
      reason,
      details,
      restartAttempts: this.restartAttempts,
      baseDelayMs,
      delayMs
    });
    this.scheduleRestart(delayMs);
  }

  private armStableRunReset(): void {
    this.clearStableRunTimer();
    this.stableRunTimer = setTimeout(() => {
      this.stableRunTimer = undefined;
      if (this.disposed || this.lifecycleState !== "running") {
        return;
      }

      const hadFailures = this.restartFailureTimes.length > 0 || this.restartAttempts > 0;
      this.resetRestartBudget();
      if (hadFailures) {
        this.emitLog("info", "输入法辅助程序已稳定运行 30 秒，重启失败预算已清零。", {
          stableRunMs: NATIVE_HELPER_STABLE_RUN_MS
        });
      }
    }, NATIVE_HELPER_STABLE_RUN_MS);
  }

  private resetRestartBudget(): void {
    this.restartFailureTimes = [];
    this.restartAttempts = 0;
    this.circuitOpen = false;
  }

  private pruneFailureWindow(now = this.now()): void {
    const cutoff = now - NATIVE_HELPER_FAILURE_WINDOW_MS;
    this.restartFailureTimes = this.restartFailureTimes.filter(
      (failureTime) => failureTime >= cutoff
    );
    this.restartAttempts = this.restartFailureTimes.length;
  }

  private currentRestartAttempts(): number {
    this.pruneFailureWindow();
    return this.restartAttempts;
  }

  private consumeBufferedLines(stream: "stdout" | "stderr"): boolean {
    const buffer = stream === "stdout" ? this.stdoutBuffer : this.stderrBuffer;
    const bufferBytes = Buffer.byteLength(buffer, "utf8");
    if (bufferBytes > MAX_BUFFER_BYTES) {
      this.resetBuffer(stream);
      throw new Error(
        `输入法辅助程序 ${stream} 缓冲区超过 ${MAX_BUFFER_BYTES} 字节（实际 ${bufferBytes}）。`
      );
    }

    const lines = buffer.split(/\r?\n/);
    const remainder = lines.pop() ?? "";
    const remainderBytes = Buffer.byteLength(remainder, "utf8");
    if (remainderBytes > MAX_LINE_BYTES) {
      this.resetBuffer(stream);
      throw new Error(
        `输入法辅助程序 ${stream} 单行超过 ${MAX_LINE_BYTES} 字节（实际 ${remainderBytes}）。`
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
          this.emitLog("error", "输入法辅助程序协议版本不匹配。", {
            expected: PROTOCOL_VERSION,
            actual: hello.version
          });
          throw new Error(
            `输入法辅助程序协议版本不匹配：expected=${PROTOCOL_VERSION} actual=${hello.version}。`
          );
        }

        this.helloReceived = true;
        this.helperProtocolVersion = hello.version;
        this.emitLog("info", "已收到输入法辅助程序 hello 消息。", {
          version: hello.version,
          capabilities: hello.capabilities
        });
        return false;
      }

      this.emitLog("error", "输入法辅助程序首行不是 hello 消息，拒绝启动。", {
        line
      });
      throw new Error("输入法辅助程序首行不是 hello 消息，拒绝启动。");
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
      this.emitLog("warn", "解析输入法辅助程序标准输出行失败。", { length: line.length });
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

  private ensureHelperExecutable(helperPath: string): void {
    if (process.platform === "win32") {
      return;
    }

    try {
      fs.chmodSync(helperPath, 0o755);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`为输入法辅助程序设置可执行权限失败：${message}`);
    }
  }

  private verifyHelperIntegrity(helperPath: string): void {
    this.helperHashStatus = "not-checked";
    this.helperSha256PathExists = fs.existsSync(this.sha256Path);
    if (!this.helperSha256PathExists) {
      this.helperHashStatus = "missing-sidecar";
      throw new Error("输入法辅助程序哈希校验文件缺失（IME helper hash sidecar is missing）。");
    }

    const expected = fs.readFileSync(this.sha256Path, "utf8").trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expected)) {
      this.helperHashStatus = "invalid-sidecar";
      throw new Error("输入法辅助程序哈希校验文件无效（IME helper hash sidecar is invalid）。");
    }

    try {
      const fileBuffer = fs.readFileSync(helperPath);
      const actual = crypto.createHash("sha256").update(fileBuffer).digest("hex").toLowerCase();
      this.helperHashStatus = actual === expected ? "match" : "mismatch";
      if (this.helperHashStatus !== "match") {
        throw new Error("输入法辅助程序 SHA-256 校验不匹配（IME helper SHA-256 mismatch）。");
      }
    } catch (error) {
      if (this.helperHashStatus !== "mismatch") {
        this.helperHashStatus = "error";
      }
      throw error;
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
        this.emitLog("info", "输入法辅助程序退出后已生成 unknown 快照。", {
          reason,
          details
        });
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

  private tryWriteCommand(
    command: Record<string, string>,
    child: ChildProcessWithoutNullStreams | undefined
  ): boolean {
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
      this.emitLog("warn", "向输入法辅助程序写入命令失败。", {
        error: message,
        command
      });
      return false;
    }
  }

  private requestChildShutdown(child: ChildProcessWithoutNullStreams): void {
    const stdin = child.stdin;
    if (stdin && !stdin.destroyed && stdin.writable) {
      try {
        stdin.end();
      } catch {
        // Ignore stdin close races; timeout escalation handles unresponsive processes.
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

    if (!exited()) {
      if (process.platform === "win32" && child.pid) {
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
      } else {
        try {
          child.kill();
        } catch {
          // Ignore kill races; the OS will reap the process when its handles close.
        }
      }
    }
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }
  }

  private clearStableRunTimer(): void {
    if (this.stableRunTimer) {
      clearTimeout(this.stableRunTimer);
      this.stableRunTimer = undefined;
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
