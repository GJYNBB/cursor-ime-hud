import * as vscode from "vscode";
import { ImeDetector } from "../detector/ImeDetector";
import { ImeSnapshot } from "../model/types";
import { StatusBarPresenter } from "../presenters/StatusBarPresenter";
import { CursorOverlayRenderer } from "../renderer/CursorOverlayRenderer";
import { LoggerService } from "../services/LoggerService";
import { SettingsService } from "../services/SettingsService";

interface HudControllerDependencies {
  detector: ImeDetector;
  settingsService: SettingsService;
  logger: LoggerService;
  overlayRenderer: CursorOverlayRenderer;
  statusBarPresenter: StatusBarPresenter;
}

export class HudController implements vscode.Disposable {
  private readonly subscriptions: vscode.Disposable[] = [];
  private latestSnapshot: ImeSnapshot;
  private lastStableSnapshot: ImeSnapshot;

  public constructor(private readonly dependencies: HudControllerDependencies) {
    this.latestSnapshot = dependencies.detector.getSnapshot();
    this.lastStableSnapshot = this.latestSnapshot.state === "unknown"
      ? {
          type: "state",
          state: "en",
          timestamp: new Date().toISOString(),
          source: "fallback",
          imeName: "Initial Fallback"
        }
      : this.latestSnapshot;
  }

  public async start(): Promise<void> {
    this.subscriptions.push(
      this.dependencies.detector.onDidChangeSnapshot((snapshot) => this.handleSnapshotChange(snapshot)),
      this.dependencies.detector.onDidLog((entry) => this.dependencies.logger.recordDetectorLog(entry)),
      this.dependencies.settingsService.onDidChange(() => this.render()),
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.dependencies.overlayRenderer.clearVisibleEditors();
        this.render();
      }),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor === vscode.window.activeTextEditor) {
          this.render();
        }
      }),
      vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
        if (event.textEditor === vscode.window.activeTextEditor) {
          this.render();
        }
      }),
      vscode.window.onDidChangeWindowState(() => this.render())
    );

    await this.dependencies.detector.start();
    this.dependencies.logger.info("Cursor IME HUD started.", this.dependencies.detector.getDebugInfo());
    this.render();
  }

  public async toggleOverlay(): Promise<void> {
    await this.dependencies.settingsService.toggleOverlay();
  }

  public refreshImeState(): void {
    this.dependencies.detector.refresh();
    this.dependencies.logger.info("Manual IME refresh requested.");
    this.render();
  }

  public showDiagnostics(): void {
    const settings = this.dependencies.settingsService.getSettings();
    const currentSnapshot = this.latestSnapshot;
    const effectiveSnapshot = this.getEffectiveSnapshot();
    const debugInfo = this.dependencies.detector.getDebugInfo();
    const logs = this.dependencies.logger.getRecentEntries(20);
    const activeEditor = vscode.window.activeTextEditor;
    const reportLines = [
      "# Cursor IME HUD Diagnostics",
      "",
      `Generated: ${new Date().toISOString()}`,
      `Detected state: ${currentSnapshot.state}`,
      `Displayed state: ${effectiveSnapshot.state}`,
      `IME name: ${currentSnapshot.imeName ?? "(unknown)"}`,
      `Last updated: ${currentSnapshot.timestamp}`,
      `Detector source: ${debugInfo.source}`,
      `Backend: ${debugInfo.backendName}`,
      `Fallback active: ${debugInfo.usingFallback ? "yes" : "no"}`,
      `Fallback reason: ${debugInfo.fallbackReason ?? "(none)"}`,
      `Helper path: ${debugInfo.helperPath ?? "(none)"}`,
      `Window focused: ${vscode.window.state.focused ? "yes" : "no"}`,
      `Active editor: ${activeEditor?.document.uri.toString() ?? "(none)"}`,
      `Active language: ${activeEditor?.document.languageId ?? "(none)"}`,
      `Overlay enabled: ${settings.overlayEnabled ? "yes" : "no"}`,
      `Status bar enabled: ${settings.statusBarEnabled ? "yes" : "no"}`,
      `Overlay labels: cn=${settings.cnLabel}, en=${settings.enLabel}`,
      "",
      "## Latest Snapshot",
      "```json",
      JSON.stringify(currentSnapshot, null, 2),
      "```",
      "",
      "## Recent Logs",
      "```json",
      JSON.stringify(logs, null, 2),
      "```"
    ];

    this.dependencies.logger.showReport(reportLines.join("\n"));
  }

  public dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }

    this.dependencies.overlayRenderer.clearVisibleEditors();
  }

  private handleSnapshotChange(snapshot: ImeSnapshot): void {
    this.latestSnapshot = snapshot;
    if (snapshot.state !== "unknown") {
      this.lastStableSnapshot = snapshot;
    }

    this.render();
  }

  private render(): void {
    const settings = this.dependencies.settingsService.getSettings();
    const effectiveSnapshot = this.getEffectiveSnapshot();
    const overlayLabel = this.dependencies.settingsService.getLabelForState(effectiveSnapshot.state);
    const statusBarLabel = overlayLabel === "--" ? "?" : overlayLabel;
    const debugInfo = this.dependencies.detector.getDebugInfo();

    this.dependencies.statusBarPresenter.render({
      enabled: settings.statusBarEnabled,
      label: statusBarLabel,
      imeName: this.latestSnapshot.imeName,
      source: debugInfo.backendName,
      isFallback: debugInfo.usingFallback
    });

    const editor = vscode.window.activeTextEditor;
    const shouldHideOverlay =
      !settings.overlayEnabled ||
      !editor ||
      (settings.hideWhenEditorUnfocused && !vscode.window.state.focused);

    if (shouldHideOverlay || overlayLabel === "--") {
      this.dependencies.overlayRenderer.clearVisibleEditors();
      return;
    }

    this.dependencies.overlayRenderer.clearVisibleEditors();
    this.dependencies.overlayRenderer.render({
      editor,
      label: overlayLabel,
      settings
    });
  }

  private getEffectiveSnapshot(): ImeSnapshot {
    return this.latestSnapshot.state === "unknown" ? this.lastStableSnapshot : this.latestSnapshot;
  }
}
