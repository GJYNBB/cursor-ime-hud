import * as vscode from "vscode";
import { HudDisplayReason, ImeState } from "../model/types";

/**
 * Render payload handed to `StatusBarPresenter.render`. The presenter does
 * not own IME detection or HUD state — it only formats the data the
 * controller gives it into a status-bar item.
 */
export interface StatusBarRenderInput {
  enabled: boolean;
  /** Whether the caret-adjacent overlay/icon is currently enabled. */
  overlayEnabled: boolean;
  label: string;
  imeName?: string;
  source: string;
  isFallback: boolean;
  detectedState: ImeState;
  displayReason: HudDisplayReason;
  reason?: string;
  confidence?: number;
}

/**
 * Public surface the controller depends on. `StatusBarPresenter` is the
 * default production implementation; tests can supply their own.
 */
export interface StatusBarPresenterContract extends vscode.Disposable {
  render(input: StatusBarRenderInput): void;
}

export function formatDetectedStateForUi(state: ImeState): string {
  switch (state) {
    case "cn":
      return "中文";
    case "en":
      return "英文";
    case "unknown":
      return "未知";
    default:
      return state;
  }
}

export function buildStatusBarText(
  input: Pick<StatusBarRenderInput, "label" | "overlayEnabled">
): string {
  // Codicon in the status-bar text always updates live (unlike an open hover).
  const eye = input.overlayEnabled ? "$(eye)" : "$(eye-closed)";
  return `${eye} 输入法：${input.label}`;
}

/**
 * Build the hover tooltip shown on the status-bar item. Uses a trusted
 * MarkdownString so command links stay clickable without opening a QuickPick.
 * The toggle label always reflects the current overlay state.
 *
 * Note: VS Code does not re-render an already-open status-bar hover. When the
 * overlay flag flips, {@link StatusBarPresenter} hide/shows the item so the
 * hover is dismissed and can reopen with the new label under the cursor.
 */
export function buildStatusBarTooltip(input: StatusBarRenderInput): vscode.MarkdownString {
  const toggleLabel = input.overlayEnabled ? "点击关闭光标旁图标" : "点击开启光标旁图标";
  const settingsArgs = encodeURIComponent(JSON.stringify(["@ext:chestnut-ch.cursor-ime-hud"]));

  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = {
    enabledCommands: ["cursorImeHud.toggleOverlay", "workbench.action.openSettings"]
  };
  md.supportThemeIcons = true;

  md.appendMarkdown(`**当前显示：** ${input.label}  \n`);
  md.appendMarkdown(`**检测状态：** ${formatDetectedStateForUi(input.detectedState)}  \n\n`);
  md.appendMarkdown(`[${toggleLabel}](command:cursorImeHud.toggleOverlay)  \n`);
  md.appendMarkdown(`[打开设置](command:workbench.action.openSettings?${settingsArgs})`);

  return md;
}

/**
 * Renders the HUD's status-bar companion. The underlying `StatusBarItem` is
 * created by the composition root and injected so the presenter does not
 * touch the `vscode` singleton directly (helps testability and prevents
 * accidental double-allocation of the status-bar slot).
 */
export class StatusBarPresenter implements StatusBarPresenterContract {
  private lastOverlayEnabled?: boolean;
  private refreshTimer?: ReturnType<typeof setTimeout>;

  public constructor(private readonly item: vscode.StatusBarItem) {
    // No click action: hover tooltip carries toggle/settings links.
    this.item.command = undefined;
    this.item.name = "输入法状态提示";
  }

  public render(input: StatusBarRenderInput): void {
    if (!input.enabled) {
      this.clearRefreshTimer();
      this.lastOverlayEnabled = undefined;
      this.item.hide();
      return;
    }

    const text = buildStatusBarText(input);
    const tooltip = buildStatusBarTooltip(input);
    const overlayFlipped =
      this.lastOverlayEnabled !== undefined && this.lastOverlayEnabled !== input.overlayEnabled;
    this.lastOverlayEnabled = input.overlayEnabled;

    this.item.text = text;
    this.item.tooltip = tooltip;

    if (overlayFlipped) {
      // VS Code keeps a stale open hover until the item is hidden. Drop and
      // re-show so a still-hovered cursor can pick up the flipped toggle label.
      this.clearRefreshTimer();
      this.item.hide();
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = undefined;
        this.item.text = text;
        this.item.tooltip = tooltip;
        this.item.show();
      }, 0);
      return;
    }

    this.item.show();
  }

  public dispose(): void {
    this.clearRefreshTimer();
    this.item.dispose();
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer !== undefined) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }
}
