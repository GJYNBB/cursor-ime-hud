import * as vscode from "vscode";
import { resolveHudDisplayState, UNKNOWN_GRACE_PERIOD_MS } from "./HudState";
import { EditorHost, VSCodeEditorHost } from "./EditorHost";
import { ImeDetector } from "../detector/ImeDetector";
import { CursorImeHudSettings, HudDisplayReason, ImeSnapshot } from "../model/types";
import { StatusBarPresenterContract } from "../presenters/StatusBarPresenter";
import {
  buildSettingsMenuItems,
  buildStatusBarMenuItems,
  SettingsMenuItem,
  StatusBarMenuItem
} from "../presenters/statusBarMenu";
import { DiagnosticsProvider, SettingsReader } from "./ports";
import {
  createOverlayRenderState,
  overlayRenderStateEquals,
  OverlayRenderState
} from "../renderer/OverlayRenderState";
import { OverlayRenderer } from "../renderer/contracts";
import { OverlayPlacement } from "../renderer/PositionStrategy";

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
  settingsService: SettingsReader;
  logger: DiagnosticsProvider;
  overlayRenderer: OverlayRenderer;
  statusBarPresenter: StatusBarPresenterContract;
  editorHost?: EditorHost;
  now?: () => number;
}

export class HudController implements vscode.Disposable {
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly now: () => number;
  private readonly editorHost: EditorHost;
  private readonly ownsEditorHost: boolean;
  private latestSnapshot: ImeSnapshot;
  private lastStableSnapshot?: ImeSnapshot;
  private lastStableObservedAt?: number;
  private unknownObservedAt?: number;
  private lastRenderState?: OverlayRenderState;
  private renderTimer?: NodeJS.Timeout;
  private graceTimer?: NodeJS.Timeout;
  private readonly editorIds = new WeakMap<vscode.TextEditor, number>();
  private nextEditorId = 1;
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
    } else {
      this.unknownObservedAt = this.now();
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
    // We must not abort activation: log the error, keep presenting the
    // detector's current snapshot (usually unknown/fallback), and continue
    // running so the user can still toggle the overlay or read diagnostics.
    try {
      await this.dependencies.detector.start();
    } catch (error) {
      this.dependencies.logger.error("输入法状态检测器启动失败。", error);
      this.latestSnapshot = this.dependencies.detector.getSnapshot();
      this.requestRender(true);
      return;
    }
    this.dependencies.logger.info(
      "Cursor IME HUD 已启动。",
      this.dependencies.detector.getDebugInfo()
    );
    this.requestRender(true);
  }

  public async toggleOverlay(): Promise<void> {
    await this.dependencies.settingsService.toggleOverlay();
  }

  public refreshImeState(): void {
    this.dependencies.detector.refresh();
    this.dependencies.logger.info("已手动请求刷新输入法状态。");
    this.requestRender(true);
  }

  /**
   * Status-bar click handler: QuickPick with toggle HUD, refresh, diagnostics,
   * and open settings. Keeps the status-bar item itself as a single compact
   * label while still exposing every entry point one click away.
   */
  public async showStatusBarMenu(): Promise<void> {
    if (this.disposed) {
      return;
    }

    const settings = this.dependencies.settingsService.getSettings();
    const items = buildStatusBarMenuItems(settings.overlayEnabled);
    const picked = await vscode.window.showQuickPick(
      items.map((item) => ({
        label: item.label,
        description: item.description,
        action: item.action
      })),
      {
        title: "输入法状态",
        placeHolder: "选择操作"
      }
    );

    if (!picked || this.disposed) {
      return;
    }

    await this.runStatusBarMenuAction(picked.action);
  }

  public async runStatusBarMenuAction(action: StatusBarMenuItem["action"]): Promise<void> {
    switch (action) {
      case "toggleOverlay":
        await this.toggleOverlay();
        return;
      case "refreshImeState":
        this.refreshImeState();
        return;
      case "showDiagnostics":
        this.showDiagnostics();
        return;
      case "openSettingsMenu":
        await this.showSettingsMenu();
        return;
      default: {
        const _exhaustive: never = action;
        void _exhaustive;
      }
    }
  }

  /**
   * Nested QuickPick for common overlay/status-bar options so users can
   * adjust settings without leaving the editor for the full settings UI.
   */
  public async showSettingsMenu(): Promise<void> {
    while (!this.disposed) {
      const settings = this.dependencies.settingsService.getSettings();
      const items = buildSettingsMenuItems(settings);
      const picked = await vscode.window.showQuickPick(
        items.map((item) => ({
          label: item.label,
          description: item.description,
          detail: item.detail,
          action: item.action
        })),
        {
          title: "输入法状态 · 设置",
          placeHolder: "选择要修改的选项"
        }
      );

      if (!picked || this.disposed) {
        return;
      }

      const stayInMenu = await this.runSettingsMenuAction(picked.action);
      if (!stayInMenu) {
        return;
      }
    }
  }

  public async runSettingsMenuAction(action: SettingsMenuItem["action"]): Promise<boolean> {
    const settings = this.dependencies.settingsService;
    const current = settings.getSettings();

    switch (action) {
      case "setLabelPreset": {
        await settings.updateSetting(
          "overlay.labelPreset",
          current.labelPreset === "zh-en" ? "en-zh" : "zh-en"
        );
        return true;
      }
      case "setOverlayMode": {
        await settings.updateSetting(
          "overlay.mode",
          current.overlayMode === "text+icon" ? "text" : "text+icon"
        );
        return true;
      }
      case "setCnColor": {
        const value = await this.promptString("中文颜色", current.cnColor, "例如 #FF5252");
        if (value === undefined) {
          return true;
        }
        await settings.updateSetting("overlay.cnColor", value);
        return true;
      }
      case "setEnColor": {
        const value = await this.promptString("英文颜色", current.enColor, "例如 #1E90FF");
        if (value === undefined) {
          return true;
        }
        await settings.updateSetting("overlay.enColor", value);
        return true;
      }
      case "setOpacity": {
        const value = await this.promptNumber(
          "整体透明度",
          current.opacity,
          0.15,
          1,
          "范围 0.15 ~ 1"
        );
        if (value === undefined) {
          return true;
        }
        await settings.updateSetting("overlay.opacity", value);
        return true;
      }
      case "setBackgroundOpacity": {
        const value = await this.promptNumber(
          "背景透明度",
          current.backgroundOpacity,
          0,
          1,
          "范围 0 ~ 1"
        );
        if (value === undefined) {
          return true;
        }
        await settings.updateSetting("overlay.backgroundOpacity", value);
        return true;
      }
      case "toggleBackgroundEnabled": {
        await settings.updateSetting("overlay.backgroundEnabled", !current.backgroundEnabled);
        return true;
      }
      case "setOffsetX": {
        const value = await this.promptNumber(
          "水平偏移",
          current.offsetX,
          -50,
          50,
          "范围 -50 ~ 50"
        );
        if (value === undefined) {
          return true;
        }
        await settings.updateSetting("overlay.offsetX", value);
        return true;
      }
      case "setOffsetY": {
        const value = await this.promptNumber(
          "垂直偏移",
          current.offsetY,
          -50,
          50,
          "范围 -50 ~ 50"
        );
        if (value === undefined) {
          return true;
        }
        await settings.updateSetting("overlay.offsetY", value);
        return true;
      }
      case "toggleHideWhenUnfocused": {
        await settings.updateSetting(
          "overlay.hideWhenEditorUnfocused",
          !current.hideWhenEditorUnfocused
        );
        return true;
      }
      case "toggleStatusBar": {
        await settings.updateSetting("statusBar.enabled", !current.statusBarEnabled);
        return true;
      }
      case "openFullSettings": {
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "@ext:chestnut-ch.cursor-ime-hud"
        );
        return false;
      }
      default: {
        const _exhaustive: never = action;
        void _exhaustive;
        return false;
      }
    }
  }

  private async promptString(
    title: string,
    value: string,
    placeHolder: string
  ): Promise<string | undefined> {
    const result = await vscode.window.showInputBox({
      title,
      value,
      placeHolder,
      ignoreFocusOut: true
    });
    if (result === undefined) {
      return undefined;
    }
    const trimmed = result.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private async promptNumber(
    title: string,
    value: number,
    minimum: number,
    maximum: number,
    placeHolder: string
  ): Promise<number | undefined> {
    const result = await vscode.window.showInputBox({
      title,
      value: String(value),
      placeHolder,
      ignoreFocusOut: true,
      validateInput: (input) => {
        const parsed = Number(input);
        if (!Number.isFinite(parsed)) {
          return "请输入数字";
        }
        if (parsed < minimum || parsed > maximum) {
          return `请输入 ${minimum} ~ ${maximum} 之间的数字`;
        }
        return undefined;
      }
    });
    if (result === undefined) {
      return undefined;
    }
    const parsed = Number(result);
    if (!Number.isFinite(parsed)) {
      return undefined;
    }
    return Math.min(maximum, Math.max(minimum, parsed));
  }

  public showDiagnostics(): void {
    const settings = this.dependencies.settingsService.getSettings();
    const currentSnapshot = this.latestSnapshot;
    const displayState = resolveHudDisplayState({
      detectedSnapshot: currentSnapshot,
      lastStableSnapshot: this.lastStableSnapshot,
      unknownObservedAt: this.unknownObservedAt,
      now: this.now(),
      gracePeriodMs: UNKNOWN_GRACE_PERIOD_MS
    });
    const debugInfo = this.dependencies.detector.getDebugInfo();
    const logs = this.dependencies.logger
      .getRecentEntries(20)
      .map((entry) => this.redactDiagnosticValue(entry));
    const activeEditor = this.editorHost.getActiveEditor();
    const windowState = this.editorHost.getWindowState();
    const reportLines = [
      "# Cursor IME HUD 诊断信息",
      "",
      `生成时间：${new Date().toISOString()}`,
      `检测状态（state）：${currentSnapshot.state}`,
      `显示状态：${displayState.displaySnapshot.state}`,
      `显示原因（displayReason）：${displayState.displayReason}`,
      `输入法名称是否可用：${currentSnapshot.imeName === undefined ? "否" : "是"}`,
      `最后更新时间：${currentSnapshot.timestamp}`,
      `快照原因（reason）：${this.summarizeReason(currentSnapshot.reason)}`,
      `快照可信度：${typeof currentSnapshot.confidence === "number" ? currentSnapshot.confidence.toFixed(2) : "（无）"}`,
      `原始状态是否可用：${currentSnapshot.rawStateAvailable === undefined ? "（未知）" : currentSnapshot.rawStateAvailable ? "是" : "否"}`,
      `最近可靠状态的记录时间：${typeof this.lastStableObservedAt === "number" ? new Date(this.lastStableObservedAt).toISOString() : "（无）"}`,
      `未知状态的记录时间：${typeof this.unknownObservedAt === "number" ? new Date(this.unknownObservedAt).toISOString() : "（无）"}`,
      `检测来源（source）：${debugInfo.source}`,
      `检测后端（backend）：${debugInfo.backendName}`,
      `检测器生命周期：${debugInfo.lifecycleState ?? "（未知）"}`,
      `包装器生命周期：${debugInfo.wrapperLifecycleState ?? "（不适用）"}`,
      `滚动窗口内的重启失败次数：${debugInfo.restartAttempts ?? "（未知）"}`,
      `自动重启熔断器是否开启：${debugInfo.circuitOpen === undefined ? "（未知）" : debugInfo.circuitOpen ? "是" : "否"}`,
      `是否启用回退检测：${debugInfo.usingFallback ? "是" : "否"}`,
      `回退是否可通过刷新恢复：${
        debugInfo.fallbackRecoverable === undefined
          ? "（不适用）"
          : debugInfo.fallbackRecoverable
            ? "是（可执行“刷新输入法状态”重试 Native Helper）"
            : "否（需修复安装或 Reload Window）"
      }`,
      `回退原因：${this.summarizeReason(debugInfo.fallbackReason)}`,
      `辅助程序平台标识：${debugInfo.helperPlatformKey ?? "（无）"}`,
      `辅助程序路径：${debugInfo.helperPath ? "已提供" : "（无）"}`,
      `辅助程序文件是否存在：${debugInfo.helperPathExists === undefined ? "（未知）" : debugInfo.helperPathExists ? "是" : "否"}`,
      `SHA-256 校验文件路径：${debugInfo.helperSha256Path ? "已提供" : "（无）"}`,
      `SHA-256 校验文件是否存在：${debugInfo.helperSha256PathExists === undefined ? "（未知）" : debugInfo.helperSha256PathExists ? "是" : "否"}`,
      `辅助程序哈希状态：${debugInfo.helperHashStatus ?? "（未知）"}`,
      `辅助程序协议版本：${debugInfo.helperProtocolVersion ?? "（未知）"}`,
      `窗口是否聚焦：${windowState.focused ? "是" : "否"}`,
      `当前编辑器：${this.describeActiveEditor(activeEditor)}`,
      `当前语言：${activeEditor?.document.languageId ?? "（无）"}`,
      `是否启用光标旁提示：${settings.overlayEnabled ? "是" : "否"}`,
      `是否启用状态栏提示：${settings.statusBarEnabled ? "是" : "否"}`,
      `标签预设：${settings.labelPreset}`,
      `最终标签：cn=${settings.cnLabel}, en=${settings.enLabel}`,
      ...this.buildOverlayDiagnostics(settings, displayState.displaySnapshot.state),
      "",
      "## 当前快照摘要",
      "```json",
      JSON.stringify(this.snapshotSummary(currentSnapshot), null, 2),
      "```",
      "",
      "## 最近一次可靠快照摘要",
      "```json",
      JSON.stringify(
        this.lastStableSnapshot ? this.snapshotSummary(this.lastStableSnapshot) : null,
        null,
        2
      ),
      "```",
      "",
      "## 最近日志",
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
    const previousSnapshot = this.latestSnapshot;
    const observedAt = this.now();
    this.latestSnapshot = snapshot;

    if (snapshot.state !== "unknown") {
      this.lastStableSnapshot = snapshot;
      this.lastStableObservedAt = observedAt;
      this.unknownObservedAt = undefined;
    } else if (previousSnapshot.state !== "unknown") {
      // Consecutive unknown snapshots must not extend the grace window.
      this.unknownObservedAt = observedAt;
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
      unknownObservedAt: this.unknownObservedAt,
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
      overlayEnabled: settings.overlayEnabled,
      label: statusBarLabel,
      imeName: this.latestSnapshot.imeName,
      source: debugInfo.backendName,
      isFallback: debugInfo.usingFallback,
      detectedState: this.latestSnapshot.state,
      displayReason: displayState.displayReason,
      reason: this.summarizeReason(this.latestSnapshot.reason),
      confidence: this.latestSnapshot.confidence
    });

    const overlayDecision = this.resolveOverlayVisibility(settings, displayLabel);
    const editor = overlayDecision.editor;
    const placement = overlayDecision.placement;
    const styleKey = this.dependencies.overlayRenderer.getStyleKey(settings);
    const nextRenderState = createOverlayRenderState({
      editorId: editor ? this.getEditorId(editor) : null,
      editorUri: editor?.document.uri.toString() ?? null,
      label: displayLabel ?? null,
      visible: overlayDecision.visible,
      styleKey,
      placement,
      state: displayState.displaySnapshot.state
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
      placement,
      state: displayState.displaySnapshot.state
    });
    this.lastRenderState = nextRenderState;
  }

  private summarizeReason(reason: string | undefined): string {
    if (!reason) {
      return "（无）";
    }
    return reason
      .replace(/[A-Za-z]:\\(?:(?!;\s*raw=)[^\r\n"'`<>|])+/g, "<path>")
      .replace(
        /\/(?:Users|home|tmp|var|opt|private|Applications|usr|etc|bin|sbin|lib|mnt|Volumes)\/(?:(?!;\s*raw=)[^\r\n"'`<>])*/g,
        "<path>"
      )
      .replace(/raw=[^\r\n"'`<>]*/g, "raw=<redacted>");
  }

  private redactDiagnosticValue(value: unknown, seen = new WeakSet<object>()): unknown {
    if (typeof value === "string") {
      return this.summarizeReason(value);
    }
    if (Array.isArray(value)) {
      if (seen.has(value)) {
        return "[Circular]";
      }
      seen.add(value);
      const redacted = value.map((item) => this.redactDiagnosticValue(item, seen));
      seen.delete(value);
      return redacted;
    }
    if (value && typeof value === "object") {
      if (seen.has(value)) {
        return "[Circular]";
      }
      seen.add(value);
      const redacted = Object.fromEntries(
        Object.entries(value).map(([key, entryValue]) => [
          key,
          this.redactDiagnosticValue(entryValue, seen)
        ])
      );
      seen.delete(value);
      return redacted;
    }
    return value;
  }

  private snapshotSummary(snapshot: ImeSnapshot): Record<string, unknown> {
    return {
      type: snapshot.type,
      state: snapshot.state,
      timestamp: snapshot.timestamp,
      source: snapshot.source,
      reason: this.summarizeReason(snapshot.reason),
      confidence: snapshot.confidence,
      rawStateAvailable: snapshot.rawStateAvailable,
      imeNameAvailable: snapshot.imeName !== undefined,
      layoutHexAvailable: snapshot.layoutHex !== undefined,
      threadIdAvailable: snapshot.threadId !== undefined,
      hwndAvailable: snapshot.hwnd !== undefined
    };
  }

  private buildOverlayDiagnostics(
    settings: CursorImeHudSettings,
    state: ImeSnapshot["state"]
  ): string[] {
    const label = this.dependencies.settingsService.getLabelForState(state);
    const decision = this.resolveOverlayVisibility(settings, label);
    const cursor = decision.editor?.selection.active;

    return [
      `光标旁提示是否可见：${decision.visible ? "是" : "否"}`,
      `隐藏原因：${decision.visible ? "（无）" : decision.reason}`,
      `提示位置：${decision.placement ? `${decision.placement.attachment} ${decision.placement.range.start.line}:${decision.placement.range.start.character}-${decision.placement.range.end.line}:${decision.placement.range.end.character}` : "（无）"}`,
      `光标位置：${cursor ? `${cursor.line}:${cursor.character}` : "（无）"}`
    ];
  }

  private describeActiveEditor(editor: vscode.TextEditor | undefined): string {
    if (!editor) {
      return "（无）";
    }

    return `已打开（URI scheme=${editor.document.uri.scheme}）`;
  }

  private getEditorId(editor: vscode.TextEditor): number {
    const existing = this.editorIds.get(editor);
    if (existing) {
      return existing;
    }

    const next = this.nextEditorId++;
    this.editorIds.set(editor, next);
    return next;
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

    if (displayReason !== "grace-period" || typeof graceExpiresAt !== "number") {
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
