import * as vscode from "vscode";
import { DetectorLogEntry, ImeDetectorDebugInfo, ImeSnapshot } from "../model/types";
import { ImeDetector } from "./ImeDetector";
import { NativeHelperImeDetector } from "./NativeHelperImeDetector";
import { SampleImeDetector } from "./SampleImeDetector";

export class SampleOrNativeDetector implements ImeDetector {
  private readonly onDidChangeSnapshotEmitter = new vscode.EventEmitter<ImeSnapshot>();
  private readonly onDidLogEmitter = new vscode.EventEmitter<DetectorLogEntry>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private activeDetector: ImeDetector;
  private debugInfo: ImeDetectorDebugInfo;

  public readonly onDidChangeSnapshot = this.onDidChangeSnapshotEmitter.event;
  public readonly onDidLog = this.onDidLogEmitter.event;

  public constructor(private readonly helperPath: string) {
    this.activeDetector = new SampleImeDetector("sample", "Detector has not started yet.");
    this.debugInfo = this.activeDetector.getDebugInfo();
  }

  public async start(): Promise<void> {
    await this.swapDetector(await this.createPreferredDetector());
  }

  public refresh(): void {
    this.activeDetector.refresh();
  }

  public getSnapshot(): ImeSnapshot {
    return this.activeDetector.getSnapshot();
  }

  public getDebugInfo(): ImeDetectorDebugInfo {
    return this.debugInfo;
  }

  public dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }

    this.activeDetector.dispose();
    this.onDidChangeSnapshotEmitter.dispose();
    this.onDidLogEmitter.dispose();
  }

  private async createPreferredDetector(): Promise<ImeDetector> {
    if (process.platform !== "win32") {
      return new SampleImeDetector("fallback", "Windows-only detector is unavailable on this platform.");
    }

    const nativeDetector = new NativeHelperImeDetector(this.helperPath);
    try {
      await nativeDetector.start();
      return nativeDetector;
    } catch (error) {
      nativeDetector.dispose();
      const message = error instanceof Error ? error.message : String(error);
      return new SampleImeDetector("fallback", `Falling back because native helper failed to start: ${message}`);
    }
  }

  private async swapDetector(detector: ImeDetector): Promise<void> {
    for (const subscription of this.subscriptions.splice(0)) {
      subscription.dispose();
    }

    if (this.activeDetector !== detector) {
      this.activeDetector.dispose();
      this.activeDetector = detector;
    }

    this.debugInfo = detector.getDebugInfo();
    this.subscriptions.push(
      detector.onDidChangeSnapshot((snapshot) => this.onDidChangeSnapshotEmitter.fire(snapshot)),
      detector.onDidLog((entry) => this.onDidLogEmitter.fire(entry))
    );

    await detector.start();
    this.onDidChangeSnapshotEmitter.fire(detector.getSnapshot());
  }
}
