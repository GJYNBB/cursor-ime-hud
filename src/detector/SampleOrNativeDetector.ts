import * as vscode from "vscode";
import { DetectorLogEntry, ImeDetectorDebugInfo, ImeSnapshot } from "../model/types";
import { ImeDetector } from "./ImeDetector";
import { NativeHelperImeDetector } from "./NativeHelperImeDetector";
import { NativeHelperDescriptor, NativeHelperResolution } from "./nativeHelperPath";
import { SampleImeDetector } from "./SampleImeDetector";

type DetectorFactory = (helper: NativeHelperDescriptor) => ImeDetector;
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
    private readonly helperResolution: NativeHelperResolution,
    private readonly nativeDetectorFactory: DetectorFactory = (helper) =>
      new NativeHelperImeDetector(helper.helperPath, helper.backendName)
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
    return this.withLifecycleState(this.debugInfo);
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
    if ("reason" in this.helperResolution) {
      await this.activateDetector(this.createFallbackDetector(this.helperResolution.reason));
      if (this.disposed) {
        return;
      }

      this.lifecycleState = "running";
      this.debugInfo = this.withLifecycleState(this.activeDetector.getDebugInfo());
      this.onDidLogEmitter.fire({
        type: "log",
        level: "warn",
        message: "Using sample detector because no native helper is available for this platform.",
        timestamp: new Date().toISOString(),
        details: { reason: this.helperResolution.reason },
        source: "fallback"
      });
      return;
    }

    const nativeDetector = this.nativeDetectorFactory(this.helperResolution);
    try {
      await this.activateDetector(nativeDetector);
    } catch (error) {
      nativeDetector.dispose();
      const message = error instanceof Error ? error.message : String(error);
      await this.activateDetector(
        this.createFallbackDetector(`Native helper failed to start: ${message}`)
      );
      this.onDidLogEmitter.fire({
        type: "log",
        level: "warn",
        message: "Falling back to sample detector because the native helper could not start.",
        timestamp: new Date().toISOString(),
        details: {
          error: message,
          helperPath: this.helperResolution.helperPath,
          platformKey: this.helperResolution.platformKey
        },
        source: "fallback"
      });
    }

    if (this.disposed) {
      return;
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
