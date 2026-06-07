import * as vscode from "vscode";
import {
  DetectorLogEntry,
  DetectorSource,
  ImeDetectorDebugInfo,
  ImeSnapshot
} from "../model/types";
import { ImeDetector } from "./ImeDetector";

export class SampleImeDetector implements ImeDetector {
  private readonly onDidChangeSnapshotEmitter = new vscode.EventEmitter<ImeSnapshot>();
  private readonly onDidLogEmitter = new vscode.EventEmitter<DetectorLogEntry>();
  private snapshot: ImeSnapshot;
  private started = false;
  private disposed = false;

  public readonly onDidChangeSnapshot = this.onDidChangeSnapshotEmitter.event;
  public readonly onDidLog = this.onDidLogEmitter.event;

  public constructor(
    private readonly source: DetectorSource,
    private readonly reason?: string
  ) {
    this.snapshot = this.createSnapshot();
  }

  public async start(): Promise<void> {
    if (this.started || this.disposed) {
      return;
    }

    this.started = true;
    this.emitLog("warn", this.reason ?? "Using sample detector.");
    this.onDidChangeSnapshotEmitter.fire(this.snapshot);
  }

  public refresh(): void {
    if (this.disposed) {
      return;
    }

    this.snapshot = this.createSnapshot();
    this.emitLog("info", "Sample detector refresh requested.");
    this.onDidChangeSnapshotEmitter.fire(this.snapshot);
  }

  public getSnapshot(): ImeSnapshot {
    return this.snapshot;
  }

  public getDebugInfo(): ImeDetectorDebugInfo {
    return {
      source: this.source,
      backendName: "SampleImeDetector",
      usingFallback: this.source !== "sample",
      fallbackReason: this.reason,
      lifecycleState: this.disposed ? "disposed" : this.started ? "running" : "idle"
    };
  }

  public dispose(): void {
    this.disposed = true;
    this.onDidChangeSnapshotEmitter.dispose();
    this.onDidLogEmitter.dispose();
  }

  private createSnapshot(): ImeSnapshot {
    return {
      type: "state",
      state: "unknown",
      timestamp: new Date().toISOString(),
      source: this.source,
      imeName: this.source === "sample" ? "Sample Detector" : "Fallback Detector",
      reason: this.reason ?? "sample-detector",
      confidence: 0,
      rawStateAvailable: false
    };
  }

  private emitLog(level: DetectorLogEntry["level"], message: string): void {
    this.onDidLogEmitter.fire({
      type: "log",
      level,
      message,
      timestamp: new Date().toISOString(),
      source: this.source
    });
  }
}
