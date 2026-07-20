import * as vscode from "vscode";
import { DetectorLogEntry, ImeDetectorDebugInfo, ImeSnapshot } from "../model/types";
import { ImeDetector } from "./ImeDetector";
import { NativeHelperImeDetector } from "./NativeHelperImeDetector";
import { SampleImeDetector } from "./SampleImeDetector";
import { NativeHelperDescriptor, NativeHelperResolution } from "./nativeHelperPath";

type DetectorFactory = (helper: NativeHelperDescriptor) => ImeDetector;
type WrapperLifecycleState = "idle" | "starting" | "running" | "disposed";
/** Permanent fallback cannot recover without reloading the extension. */
type FallbackMode = "none" | "permanent" | "recoverable";

/**
 * Integrity / packaging failures are permanent: retrying will not fix a missing
 * binary or a hash mismatch. Spawn timeouts, process exits, and protocol
 * handshakes are treated as temporary so a manual refresh can recover.
 */
export function isPermanentNativeStartFailure(errorMessage: string): boolean {
  return (
    /not found/i.test(errorMessage) ||
    /hash sidecar is missing/i.test(errorMessage) ||
    /hash sidecar is invalid/i.test(errorMessage) ||
    /SHA-256 mismatch/i.test(errorMessage)
  );
}

function fallbackReasonForNativeStartFailure(
  errorMessage: string,
  helper: NativeHelperDescriptor
): string {
  if (/not found/i.test(errorMessage)) {
    return `原生输入法辅助程序文件缺失（平台：${helper.platformKey}）。`;
  }
  if (/hash sidecar is missing/i.test(errorMessage)) {
    return `原生输入法辅助程序的哈希校验文件缺失（平台：${helper.platformKey}）。`;
  }
  if (/hash sidecar is invalid/i.test(errorMessage)) {
    return `原生输入法辅助程序的哈希校验文件无效（平台：${helper.platformKey}）。`;
  }
  if (/SHA-256 mismatch/i.test(errorMessage)) {
    return `原生输入法辅助程序哈希校验失败（平台：${helper.platformKey}）。`;
  }
  return `原生输入法辅助程序启动失败（平台：${helper.platformKey}）：${errorMessage}`;
}

function fallbackLogMessage(fallbackReason: string, permanent: boolean): string {
  if (/文件缺失|file is missing/i.test(fallbackReason)) {
    return "由于随附的原生输入法辅助程序文件缺失，已切换到回退检测。";
  }
  if (/哈希|hash/i.test(fallbackReason)) {
    return "由于随附的原生输入法辅助程序完整性校验失败，已切换到回退检测。";
  }
  if (permanent) {
    return "由于原生输入法辅助程序无法启动，已切换到回退检测。";
  }
  return "由于原生输入法辅助程序暂时无法启动，已切换到回退检测。可执行“刷新输入法状态”后重试。";
}

export class SampleOrNativeDetector implements ImeDetector {
  private readonly onDidChangeSnapshotEmitter = new vscode.EventEmitter<ImeSnapshot>();
  private readonly onDidLogEmitter = new vscode.EventEmitter<DetectorLogEntry>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private activeDetector: ImeDetector;
  private debugInfo: ImeDetectorDebugInfo;
  private lifecycleState: WrapperLifecycleState = "idle";
  private fallbackMode: FallbackMode = "none";
  private startPromise?: Promise<void>;
  private disposed = false;

  public readonly onDidChangeSnapshot = this.onDidChangeSnapshotEmitter.event;
  public readonly onDidLog = this.onDidLogEmitter.event;

  public constructor(
    private readonly helperResolution: NativeHelperResolution,
    private readonly nativeDetectorFactory: DetectorFactory = (helper) =>
      new NativeHelperImeDetector(
        helper.helperPath,
        helper.backendName,
        helper.platformKey,
        helper.sha256Path
      )
  ) {
    this.activeDetector = new SampleImeDetector("sample", "输入法状态检测器尚未启动。");
    this.debugInfo = this.withWrapperDebugFields(this.activeDetector.getDebugInfo());
    this.bindActiveDetector(this.activeDetector);
  }

  public async start(): Promise<void> {
    if (this.disposed) {
      throw new Error("输入法检测器包装器已释放。");
    }

    if (this.lifecycleState === "running") {
      return;
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.lifecycleState = "starting";
    this.debugInfo = this.withWrapperDebugFields(this.activeDetector.getDebugInfo());
    this.startPromise = this.startInternal();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }
  }

  public refresh(): void {
    if (this.disposed) {
      return;
    }

    // Coalesce with an in-flight start/retry; the active detector is mid-transition.
    if (this.startPromise) {
      return;
    }

    if (this.canRetryNative()) {
      void this.retryNativeFromFallback();
      return;
    }

    this.activeDetector.refresh();
  }

  public getSnapshot(): ImeSnapshot {
    return this.activeDetector.getSnapshot();
  }

  public getDebugInfo(): ImeDetectorDebugInfo {
    // Native helper restart/circuit-breaker diagnostics change after startup,
    // so read the active detector instead of returning the startup snapshot.
    return this.withWrapperDebugFields(this.activeDetector.getDebugInfo());
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.lifecycleState = "disposed";

    for (const subscription of this.subscriptions.splice(0)) {
      subscription.dispose();
    }

    this.activeDetector.dispose();
    this.onDidChangeSnapshotEmitter.dispose();
    this.onDidLogEmitter.dispose();
  }

  private canRetryNative(): boolean {
    return this.fallbackMode === "recoverable" && !("reason" in this.helperResolution);
  }

  private async retryNativeFromFallback(): Promise<void> {
    if (this.disposed || !this.canRetryNative() || this.startPromise) {
      return;
    }

    const helperResolution = this.helperResolution;
    if ("reason" in helperResolution) {
      return;
    }

    this.lifecycleState = "starting";
    this.debugInfo = this.withWrapperDebugFields(this.activeDetector.getDebugInfo());
    this.onDidLogEmitter.fire({
      type: "log",
      level: "info",
      message: "正在根据用户刷新重试原生输入法辅助程序。",
      timestamp: new Date().toISOString(),
      details: { platformKey: helperResolution.platformKey },
      source: "fallback"
    });

    this.startPromise = this.attemptNativeActivation(helperResolution);
    try {
      await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }
  }

  private async startInternal(): Promise<void> {
    const helperResolution = this.helperResolution;
    if ("reason" in helperResolution) {
      this.fallbackMode = "permanent";
      await this.activateDetector(this.createFallbackDetector(helperResolution.reason));
      if (this.disposed) {
        return;
      }

      this.lifecycleState = "running";
      this.debugInfo = this.withWrapperDebugFields(this.activeDetector.getDebugInfo());
      this.onDidLogEmitter.fire({
        type: "log",
        level: "warn",
        message: "当前平台没有可用的原生输入法辅助程序，已使用回退检测。",
        timestamp: new Date().toISOString(),
        details: {
          platform: process.platform,
          arch: process.arch,
          reason: helperResolution.reason,
          recoverable: false
        },
        source: "fallback"
      });
      return;
    }

    await this.attemptNativeActivation(helperResolution);
  }

  /**
   * Start the native detector offline first. Only swap it into the active seat
   * after start() succeeds so temporary failures do not briefly publish a
   * "native" debug surface, and so refresh recovery cannot lose the previous
   * fallback snapshot until a real helper is running.
   */
  private async attemptNativeActivation(helper: NativeHelperDescriptor): Promise<void> {
    const nativeDetector = this.nativeDetectorFactory(helper);
    const pendingLogs: DetectorLogEntry[] = [];
    const pendingSnapshots: ImeSnapshot[] = [];
    const tempSubscriptions = [
      nativeDetector.onDidLog((entry) => {
        pendingLogs.push(entry);
      }),
      nativeDetector.onDidChangeSnapshot((snapshot) => {
        pendingSnapshots.push(snapshot);
      })
    ];

    try {
      await nativeDetector.start();
    } catch (error) {
      for (const subscription of tempSubscriptions) {
        subscription.dispose();
      }
      nativeDetector.dispose();
      if (this.disposed) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      const permanent = isPermanentNativeStartFailure(message);
      this.fallbackMode = permanent ? "permanent" : "recoverable";
      const fallbackReason = fallbackReasonForNativeStartFailure(message, helper);

      // Keep an existing fallback seat if we are retrying; only build a new one
      // when the active detector is not already the fallback for this reason.
      const activeDebug = this.activeDetector.getDebugInfo();
      const alreadyOnFallback =
        activeDebug.usingFallback === true && activeDebug.fallbackReason === fallbackReason;
      if (!alreadyOnFallback) {
        await this.activateDetector(this.createFallbackDetector(fallbackReason));
      }

      if (this.disposed) {
        return;
      }

      this.lifecycleState = "running";
      this.debugInfo = this.withWrapperDebugFields(this.activeDetector.getDebugInfo());
      this.onDidLogEmitter.fire({
        type: "log",
        level: "warn",
        message: fallbackLogMessage(fallbackReason, permanent),
        timestamp: new Date().toISOString(),
        details: {
          error: message,
          platformKey: helper.platformKey,
          recoverable: !permanent
        },
        source: "fallback"
      });
      return;
    }

    for (const subscription of tempSubscriptions) {
      subscription.dispose();
    }

    if (this.disposed) {
      nativeDetector.dispose();
      return;
    }

    this.unbindActiveDetector();
    this.activeDetector.dispose();
    this.activeDetector = nativeDetector;
    this.bindActiveDetector(nativeDetector);
    this.fallbackMode = "none";
    this.lifecycleState = "running";
    this.debugInfo = this.withWrapperDebugFields(nativeDetector.getDebugInfo());

    for (const entry of pendingLogs) {
      this.onDidLogEmitter.fire(entry);
    }
    const snapshot = pendingSnapshots.at(-1) ?? nativeDetector.getSnapshot();
    this.onDidChangeSnapshotEmitter.fire(snapshot);
  }

  private async activateDetector(detector: ImeDetector): Promise<void> {
    if (this.disposed) {
      detector.dispose();
      return;
    }

    if (this.activeDetector !== detector) {
      this.unbindActiveDetector();
      this.activeDetector.dispose();
      this.activeDetector = detector;
      this.bindActiveDetector(detector);
    }

    this.debugInfo = this.withWrapperDebugFields(detector.getDebugInfo());
    await detector.start();
    this.debugInfo = this.withWrapperDebugFields(detector.getDebugInfo());
  }

  private bindActiveDetector(detector: ImeDetector): void {
    this.subscriptions.push(
      detector.onDidChangeSnapshot((snapshot) => {
        if (!this.disposed) {
          this.onDidChangeSnapshotEmitter.fire(snapshot);
        }
      }),
      detector.onDidLog((entry) => {
        if (!this.disposed) {
          this.onDidLogEmitter.fire(entry);
        }
      })
    );
  }

  private unbindActiveDetector(): void {
    for (const subscription of this.subscriptions.splice(0)) {
      subscription.dispose();
    }
  }

  private createFallbackDetector(reason: string): ImeDetector {
    return new SampleImeDetector("fallback", reason);
  }

  private withWrapperDebugFields(debugInfo: ImeDetectorDebugInfo): ImeDetectorDebugInfo {
    // Keep the active detector's lifecycleState so native restart/idle/circuit
    // states are not masked by the wrapper's sticky "running" after first start.
    const withWrapper: ImeDetectorDebugInfo = {
      ...debugInfo,
      lifecycleState: debugInfo.lifecycleState ?? this.lifecycleState,
      wrapperLifecycleState: this.lifecycleState
    };

    if (this.fallbackMode === "none") {
      return withWrapper;
    }

    return {
      ...withWrapper,
      fallbackRecoverable: this.fallbackMode === "recoverable"
    };
  }
}
