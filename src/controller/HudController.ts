import * as vscode from "vscode";
import { resolveHudDisplayState, UNKNOWN_GRACE_PERIOD_MS } from "./HudState";
import { ImeDetector } from "../detector/ImeDetector";
import { HudDisplayReason, ImeSnapshot } from "../model/types";
import { StatusBarPresenterContract } from "../presenters/StatusBarPresenter";
import { createOverlayRenderState, overlayRenderStateEquals, OverlayRenderState } from "../renderer/OverlayRenderState";
import { OverlayRenderer } from "../renderer/CursorOverlayRenderer";
import { LoggerService } from "../services/LoggerService";
import { SettingsService } from "../services/SettingsService";

const HIGH_FREQUENCY_RENDER_DELAY_MS = 16;

interface HudControllerDependencies {
  detector: ImeDetector;
  settingsService: SettingsService;
  logger: LoggerService;
  overlayRenderer: OverlayRenderer;
  statusBarPresenter: StatusBarPresenterContract;
  now?: () => number;
}

export class HudController implements vscode.Disposable {
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly now: () => number;
  private latestSnapshot: ImeSnapshot;
  private lastStableSnapshot?: ImeSnapshot;
  private lastStableObservedAt?: number;
  private lastRenderState?: OverlayRenderState;
  private renderTimer?: NodeJS.Timeout;
  private graceTimer?: NodeJS.Timeout;
  private started = false;
  private disposed = false;

  public constructor(private readonly dependencies: HudControllerDependencies) {
    this.now = dependencies.now ?? Date.now;
    this.latestSnapshot = dependencies.detector.getSnapshot();

    if (this.latestSnapshot.state !== "unknown") {
      this.lastStableSnapshot = this.latestSnapshot;
      this.lastStableObservedAt = this.now();
    }
  }

  public async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.started = true;
    this.subscriptions.push(
      this.dependencies.detector.onDidChangeSnapshot((snapshot) => this.handleSnapshotChange(snapshot)),
      this.dependencies.detector.onDidLog((entry) => this.dependencies.logger.recordDetectorLog(entry)),
      this.dependencies.settingsService.onDidChange(() => this.requestRender(true)),
      vscode.window.onDidChangeActiveTextEditor(() => this.requestRender(true)),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor === vscode.window.activeTextEditor) {
          this.requestRender(false);
        }
      }),
      vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
        if (event.textEditor === vscode.window.activeTextEditor) {
          this.requestRender(false);
        }
      }),
      vscode.window.onDidChangeWindowState(() => this.requestRender(true))
    );

    await this.dependencies.detector.start();
    this.dependencies.logger.info("Cursor IME HUD started.", this.dependencies.detector.getDebugInfo());
    this.requestRender(true);
  }

  public async toggleOverlay(): Promise<void> {
    await this.dependencies.settingsService.toggleOverlay();
  }

  public refreshImeState(): void {
    this.dependencies.detector.refresh();
    this.dependencies.logger.info("Manual IME refresh requested.");
    this.requestRender(true);
  }

  public showDiagnostics(): void {
    const settings = this.dependencies.settingsService.getSettings();
    const currentSnapshot = this.latestSnapshot;
    const displayState = resolveHudDisplayState({
      detectedSnapshot: currentSnapshot,
      lastStableSnapshot: this.lastStableSnapshot,
      lastStableObservedAt: this.lastStableObservedAt,
      now: this.now(),
      gracePeriodMs: UNKNOWN_GRACE_PERIOD_MS
    });
    const debugInfo = this.dependencies.detector.getDebugInfo();
    const logs = this.dependencies.logger.getRecentEntries(20);
    const activeEditor = vscode.window.activeTextEditor;
    const reportLines = [
      "# Cursor IME HUD Diagnostics",
      "",
      `Generated: ${new Date().toISOString()}`,
      `Detected state: ${currentSnapshot.state}`,
      `Displayed state: ${displayState.displaySnapshot.state}`,
      `Display reason: ${displayState.displayReason}`,
      `IME name: ${currentSnapshot.imeName ?? "(unknown)"}`,
      `Last updated: ${currentSnapshot.timestamp}`,
      `Snapshot reason: ${currentSnapshot.reason ?? "(none)"}`,
      `Snapshot confidence: ${typeof currentSnapshot.confidence === "number" ? currentSnapshot.confidence.toFixed(2) : "(none)"}`,
      `Raw state available: ${currentSnapshot.rawStateAvailable === undefined ? "(unknown)" : currentSnapshot.rawStateAvailable ? "yes" : "no"}`,
      `Last stable observed at: ${this.lastStableObservedAt ? new Date(this.lastStableObservedAt).toISOString() : "(none)"}`,
      `Detector source: ${debugInfo.source}`,
      `Backend: ${debugInfo.backendName}`,
      `Detector lifecycle: ${debugInfo.lifecycleState ?? "(unknown)"}`,
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
      "## Last Stable Snapshot",
      "```json",
      JSON.stringify(this.lastStableSnapshot ?? null, null, 2),
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
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.clearTimers();

    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }

    this.dependencies.overlayRenderer.clearCurrentRender();
  }

  private handleSnapshotChange(snapshot: ImeSnapshot): void {
    this.latestSnapshot = snapshot;
    if (snapshot.state !== "unknown") {
      this.lastStableSnapshot = snapshot;
      this.lastStableObservedAt = this.now();
    }

    this.requestRender(true);
  }

  private requestRender(immediate: boolean): void {
    if (this.disposed) {
      return;
    }

    if (immediate) {
      if (this.renderTimer) {
        clearTimeout(this.renderTimer);
        this.renderTimer = undefined;
      }

      this.performRender();
      return;
    }

    if (this.renderTimer) {
      return;
    }

    this.renderTimer = setTimeout(() => {
      this.renderTimer = undefined;
      this.performRender();
    }, HIGH_FREQUENCY_RENDER_DELAY_MS);
  }

  private performRender(): void {
    if (this.disposed) {
      return;
    }

    const settings = this.dependencies.settingsService.getSettings();
    const displayState = resolveHudDisplayState({
      detectedSnapshot: this.latestSnapshot,
      lastStableSnapshot: this.lastStableSnapshot,
      lastStableObservedAt: this.lastStableObservedAt,
      now: this.now(),
      gracePeriodMs: UNKNOWN_GRACE_PERIOD_MS
    });

    this.scheduleGraceRender(displayState.displayReason, displayState.graceExpiresAt);

    const displayLabel = this.dependencies.settingsService.getLabelForState(displayState.displaySnapshot.state);
    const statusBarLabel = displayLabel ?? "?";
    const debugInfo = this.dependencies.detector.getDebugInfo();

    this.dependencies.statusBarPresenter.render({
      enabled: settings.statusBarEnabled,
      label: statusBarLabel,
      imeName: this.latestSnapshot.imeName,
      source: debugInfo.backendName,
      isFallback: debugInfo.usingFallback,
      detectedState: this.latestSnapshot.state,
      displayReason: displayState.displayReason,
      reason: this.latestSnapshot.reason,
      confidence: this.latestSnapshot.confidence
    });

    const editor = vscode.window.activeTextEditor;
    const shouldShowOverlay =
      settings.overlayEnabled &&
      !!editor &&
      !!displayLabel &&
      (!settings.hideWhenEditorUnfocused || vscode.window.state.focused);

    const placement = shouldShowOverlay && editor
      ? this.dependencies.overlayRenderer.resolvePlacement(editor)
      : undefined;
    const styleKey = this.dependencies.overlayRenderer.getStyleKey(settings);
    const nextRenderState = createOverlayRenderState({
      editorUri: editor?.document.uri.toString() ?? null,
      label: displayLabel ?? null,
      visible: Boolean(shouldShowOverlay && placement),
      styleKey,
      placement
    });

    if (overlayRenderStateEquals(this.lastRenderState, nextRenderState)) {
      return;
    }

    if (!nextRenderState.visible || !editor || !displayLabel || !placement) {
      if (this.lastRenderState?.visible) {
        this.dependencies.overlayRenderer.clearCurrentRender();
      }

      this.lastRenderState = nextRenderState;
      return;
    }

    this.dependencies.overlayRenderer.render({
      editor,
      label: displayLabel,
      settings,
      placement
    });
    this.lastRenderState = nextRenderState;
  }

  private scheduleGraceRender(displayReason: HudDisplayReason, graceExpiresAt?: number): void {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = undefined;
    }

    if (displayReason !== "grace-period" || !graceExpiresAt) {
      return;
    }

    const delayMs = Math.max(1, graceExpiresAt - this.now());
    this.graceTimer = setTimeout(() => {
      this.graceTimer = undefined;
      this.performRender();
    }, delayMs);
  }

  private clearTimers(): void {
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = undefined;
    }

    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = undefined;
    }
  }
}
