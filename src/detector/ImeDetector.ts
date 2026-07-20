import * as vscode from "vscode";
import { DetectorLogEntry, ImeDetectorDebugInfo, ImeSnapshot } from "../model/types";

export interface ImeDetector extends vscode.Disposable {
  readonly onDidChangeSnapshot: vscode.Event<ImeSnapshot>;
  readonly onDidLog: vscode.Event<DetectorLogEntry>;
  start(): Promise<void>;
  refresh(): void;
  getSnapshot(): ImeSnapshot;
  getDebugInfo(): ImeDetectorDebugInfo;
}
