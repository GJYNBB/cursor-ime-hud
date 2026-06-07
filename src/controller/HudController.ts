import * as vscode from "vscode";
import { resolveHudDisplayState, UNKNOWN_GRACE_PERIOD_MS } from "./HudState";
import { EditorHost, VSCodeEditorHost } from "./EditorHost";
import { ImeDetector } from "../detector/ImeDetector";
import { CursorImeHudSettings, HudDisplayReason, ImeSnapshot } from "../model/types";
import { StatusBarPresenterContract } from "../presenters/StatusBarPresenter";
import {
  createOverlayRenderState,
  overlayRenderStateEquals,
  OverlayRenderState
} from "../renderer/OverlayRenderState";
import { OverlayRenderer } from "../renderer/contracts";
import { OverlayPlacement } from "../renderer/PositionStrategy";
import { LoggerService } from "../services/LoggerService";
import { SettingsService } from "../services/SettingsService";

// ~one 60fps frame; debounce to coalesce burst events (selection changes,
// visible-range changes) into a single render per frame.
const HIGH_FREQUENCY_RENDER_DELAY_MS = 16;

interface OverlayVisibilityDecision {
  editor?: vscode.TextEditor;
  windowFocused: boolean;
  placement?: OverlayPlacement;
  visible: boolean;
  reason: string;
}

interface HudControllerDependencies {
  detector: ImeDetector;
  settingsService: SettingsService;
  logger: LoggerService;
  overlayRenderer: OverlayRenderer;
  statusBarPresenter: StatusBarPresenterContract;
  /**
   * Optional for backward compatibility with tests that pre-date the
   * `EditorHost` extraction. When omitted the controller lazily builds
   * a `VSCodeEditorHost`, so production code never has to supply one
   * explicitly (the composition root does it for clarity).
   */
  editorHost?: EditorHost;
  now?: () => number;
}

/**
 * Top-level orchestrator for the Cursor IME HUD. Owns the lifecycle of the
 * IME detector subscription, debounces render triggers, and translates the
 * latest detector snapshot into both a status-bar update and a cursor
 * overlay update. The controller never reaches into `vscode` directly — it
 * reads the workbench through the injected `EditorHost`, which keeps the
 * class testable without an Extension Host.
 */
export class HudController implements vscode.Disposable {
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly now: () => number;
  private readonly editorHost: EditorHost;
  private readonly ownsEditorHost: boolean;
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

    if (dependencies.editorHost) {
      this.editorHost = dependencies.editorHost;
      this.ownsEditorHost = false;
    } else {
      // No host was injected (e.g. legacy tests). Build a real
      // VSCodeEditorHost on demand and own its lifetime so disposing the
      // controller cleans up the subscriptions.
      const host = new VSCodeEditorHost();
      this.editorHost = host;
      this.ownsEditorHost = true;
      this.subscriptions.push(host);
    }

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
      this.dependencies.detector.onDidChangeSnapshot((snapshot) =>
        this.handleSnapshotChange(snapshot)
      ),
      this.dependencies.detector.onDidLog((entry) =>
        this.dependencies.logger.recordDetectorLog(entry)
      ),
      this.dependencies.settingsService.onDidChange(() => this.requestRender(true)),
      this.editorHost.onDidChangeActiveTextEditor(() => this.requestRender(true)),
      this.editorHost.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor === this.editorHost.getActiveEditor()) {
          this.requestRender(false);
        }
      }),
      this.editorHost.onDidChangeTextEditorVisibleRanges((event) => {
        if (event.textEditor === this.editorHost.getActiveEditor()) {
          this.requestRender(false);
        }
      }),
      this.editorHost.onDidChangeWindowState(() => this.requestRender(true))
    );

    // Detector startup can fail (helper missing, permission denied, etc.).
    // We must not abort activation: log the error, fall back to a
    // "unknown" snapshot so the HUD still shows the safe "?" placeholder in
    // the status bar, and continue running so the user can still toggle
    // the overlay or read the diagnostics.
    try {
      await this.dependencies.detector.start();
    } catch (error) {
      this.dependencies.logger.error("Failed to start IME detector.", error);
      this.latestSnapshot = this.dependencies.detector.getSnapshot();
      this.requestRender(true);
      return;
    }
    this.dependencies.logger.info(
      "Cursor IME HUD started.",
      this.dependencies.detector.getDebugInfo()
    );
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
    const activeEditor = this.editorHost.getActiveEditor();
    const windowState = this.editorHost.getWindowState();
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
      `Window focused: ${windowState.focused ? "yes" : "no"}`,
      `Active editor: ${activeEditor?.document.uri.toString() ?? "(none)"}`,
      `Active language: ${activeEditor?.document.languageId ?? "(none)"}`,
      `Overlay enabled: ${settings.overlayEnabled ? "yes" : "no"}`,
      `Status bar enabled: ${settings.statusBarEnabled ? "yes" : "no"}`,
      `Overlay label preset: ${settings.labelPreset}`,
      `Overlay labels: cn=${settings.cnLabel}, en=${settings.enLabel}`,
      ...this.buildOverlayDiagnostics(settings, displayState.displaySnapshot.state),
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

    const displayLabel = this.dependencies.settingsService.getLabelForState(
      displayState.displaySnapshot.state
    );
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

    const overlayDecision = this.resolveOverlayVisibility(settings, displayLabel);
    const editor = overlayDecision.editor;
    const placement = overlayDecision.placement;
    const styleKey = this.dependencies.overlayRenderer.getStyleKey(settings);
    const nextRenderState = createOverlayRenderState({
      editorUri: editor?.document.uri.toString() ?? null,
      label: displayLabel ?? null,
      visible: overlayDecision.visible,
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

  private buildOverlayDiagnostics(
    settings: CursorImeHudSettings,
    state: ImeSnapshot["state"]
  ): string[] {
    const label = this.dependencies.settingsService.getLabelForState(state);
    const decision = this.resolveOverlayVisibility(settings, label);
    const editor = decision.editor;
    const cursor = editor?.selection.active;
    const lineText = cursor ? editor?.document.lineAt(cursor.line).text : undefined;

    return [
      `Overlay visible: ${decision.visible ? "yes" : "no"}`,
      `Overlay hidden reason: ${decision.visible ? "(none)" : decision.reason}`,
      `Overlay placement: ${decision.placement ? `${decision.placement.attachment} ${decision.placement.range.start.line}:${decision.placement.range.start.character}-${decision.placement.range.end.line}:${decision.placement.range.end.character}` : "(none)"}`,
      `Cursor position: ${cursor ? `${cursor.line}:${cursor.character}` : "(none)"}`,
      `Active line length: ${typeof lineText === "string" ? lineText.length : "(none)"}`
    ];
  }

  private resolveOverlayVisibility(
    settings: CursorImeHudSettings,
    displayLabel: string | undefined
  ): OverlayVisibilityDecision {
    const editor = this.editorHost.getActiveEditor();
    const windowFocused = this.editorHost.getWindowState().focused;

    if (!settings.overlayEnabled) {
      return { editor, windowFocused, visible: false, reason: "overlay-disabled" };
    }

    if (!editor) {
      return { editor, windowFocused, visible: false, reason: "no-active-text-editor" };
    }

    if (!displayLabel) {
      return { editor, windowFocused, visible: false, reason: "no-display-label" };
    }

    if (settings.hideWhenEditorUnfocused && !windowFocused) {
      return { editor, windowFocused, visible: false, reason: "window-unfocused" };
    }

    const placement = this.dependencies.overlayRenderer.resolvePlacement(editor);
    if (!placement) {
      return { editor, windowFocused, visible: false, reason: "no-overlay-placement" };
    }

    return { editor, windowFocused, placement, visible: true, reason: "visible" };
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
