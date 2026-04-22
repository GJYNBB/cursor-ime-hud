import * as vscode from "vscode";
import { DetectorLogEntry, DetectorSource, ImeDetectorDebugInfo, ImeSnapshot } from "../model/types";
import { ImeDetector } from "./ImeDetector";

export class SampleImeDetector implements ImeDetector {
  private readonly onDidChangeSnapshotEmitter = new vscode.EventEmitter<ImeSnapshot>();
  private readonly onDidLogEmitter = new vscode.EventEmitter<DetectorLogEntry>();
  private snapshot: ImeSnapshot;

  public readonly onDidChangeSnapshot = this.onDidChangeSnapshotEmitter.event;
  public readonly onDidLog = this.onDidLogEmitter.event;

  public constructor(private readonly source: DetectorSource, private readonly reason?: string) {
    this.snapshot = this.createSnapshot();
  }

  public async start(): Promise<void> {
    this.emitLog("warn", this.reason ?? "Using sample detector.");
    this.onDidChangeSnapshotEmitter.fire(this.snapshot);
  }

  public refresh(): void {
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
      fallbackReason: this.reason
    };
  }

  public dispose(): void {
    this.onDidChangeSnapshotEmitter.dispose();
    this.onDidLogEmitter.dispose();
  }

  private createSnapshot(): ImeSnapshot {
    return {
      type: "state",
      state: "en",
      timestamp: new Date().toISOString(),
      source: this.source,
      imeName: this.source === "sample" ? "Sample Detector" : "Fallback Detector",
      isOpen: false
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
