import * as vscode from "vscode";
import { DetectorLogEntry, ImeDetectorDebugInfo, ImeSnapshot } from "../model/types";
import { ImeDetector } from "./ImeDetector";
import { NativeHelperImeDetector } from "./NativeHelperImeDetector";
import { SampleImeDetector } from "./SampleImeDetector";

type DetectorFactory = (helperPath: string) => ImeDetector;
type WrapperLifecycleState = "idle" | "starting" | "running" | "disposed";

export class SampleOrNativeDetector implements ImeDetector {
  private readonly onDidChangeSnapshotEmitter = new vscode.EventEmitter<ImeSnapshot>();
  private readonly onDidLogEmitter = new vscode.EventEmitter<DetectorLogEntry>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private activeDetector: ImeDetector;
  private debugInfo: ImeDetectorDebugInfo;
  private lifecycleState: WrapperLifecycleState = "idle";
  private startPromise?: Promise<void>;
  private disposed = false;

  public readonly onDidChangeSnapshot = this.onDidChangeSnapshotEmitter.event;
  public readonly onDidLog = this.onDidLogEmitter.event;

  public constructor(
    private readonly helperPath: string,
    private readonly nativeDetectorFactory: DetectorFactory = (path) => new NativeHelperImeDetector(path)
  ) {
    this.activeDetector = new SampleImeDetector("sample", "Detector has not started yet.");
    this.debugInfo = this.withLifecycleState(this.activeDetector.getDebugInfo());
    this.bindActiveDetector(this.activeDetector);
  }

  public async start(): Promise<void> {
    if (this.disposed) {
      throw new Error("SampleOrNativeDetector has been disposed.");
    }

    if (this.lifecycleState === "running") {
      return;
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.lifecycleState = "starting";
    this.debugInfo = this.withLifecycleState(this.activeDetector.getDebugInfo());
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

    this.activeDetector.refresh();
  }

  public getSnapshot(): ImeSnapshot {
    return this.activeDetector.getSnapshot();
  }

  public getDebugInfo(): ImeDetectorDebugInfo {
    return this.debugInfo;
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

  private async startInternal(): Promise<void> {
    if (process.platform !== "win32") {
      await this.activateDetector(this.createFallbackDetector("Windows-only detector is unavailable on this platform."));
      this.lifecycleState = "running";
      this.debugInfo = this.withLifecycleState(this.activeDetector.getDebugInfo());
      return;
    }

    const nativeDetector = this.nativeDetectorFactory(this.helperPath);
    try {
      await this.activateDetector(nativeDetector);
    } catch (error) {
      nativeDetector.dispose();
      const message = error instanceof Error ? error.message : String(error);
      await this.activateDetector(this.createFallbackDetector(`Native helper failed to start: ${message}`));
      this.onDidLogEmitter.fire({
        type: "log",
        level: "warn",
        message: "Falling back to sample detector because the native helper could not start.",
        timestamp: new Date().toISOString(),
        details: { error: message },
        source: "fallback"
      });
    }

    this.lifecycleState = "running";
    this.debugInfo = this.withLifecycleState(this.activeDetector.getDebugInfo());
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

    this.debugInfo = this.withLifecycleState(detector.getDebugInfo());
    await detector.start();
    this.debugInfo = this.withLifecycleState(detector.getDebugInfo());
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

  private withLifecycleState(debugInfo: ImeDetectorDebugInfo): ImeDetectorDebugInfo {
    return {
      ...debugInfo,
      lifecycleState: this.lifecycleState
    };
  }
}
