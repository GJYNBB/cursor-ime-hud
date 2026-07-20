import * as vscode from "vscode";
import { CursorImeHudSettings, DetectorLogEntry, ImeState } from "../model/types";

export type SettingsConfigKey =
  | "overlay.enabled"
  | "overlay.labelPreset"
  | "overlay.mode"
  | "overlay.cnColor"
  | "overlay.enColor"
  | "overlay.opacity"
  | "overlay.backgroundOpacity"
  | "overlay.backgroundEnabled"
  | "overlay.offsetX"
  | "overlay.offsetY"
  | "overlay.hideWhenEditorUnfocused"
  | "statusBar.enabled";

export interface SettingsReader extends vscode.Disposable {
  getSettings(): CursorImeHudSettings;
  getLabelForState(state: ImeState): string | undefined;
  toggleOverlay(): Promise<void>;
  updateSetting(key: SettingsConfigKey, value: boolean | number | string): Promise<void>;
  readonly onDidChange: vscode.Event<CursorImeHudSettings>;
}

export interface DiagnosticsProvider extends vscode.Disposable {
  info(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
  recordDetectorLog(entry: DetectorLogEntry): void;
  getRecentEntries(limit?: number): readonly DetectorLogEntry[];
  showReport(report: string): void;
}
