import * as vscode from "vscode";
import { HudDisplayReason, ImeState } from "../model/types";

export interface StatusBarRenderInput {
  enabled: boolean;
  label: string;
  imeName?: string;
  source: string;
  isFallback: boolean;
  detectedState: ImeState;
  displayReason: HudDisplayReason;
  reason?: string;
  confidence?: number;
}

export interface StatusBarPresenterContract extends vscode.Disposable {
  render(input: StatusBarRenderInput): void;
}

export class StatusBarPresenter implements StatusBarPresenterContract {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);

  public constructor() {
    this.item.command = "cursorImeHud.showDiagnostics";
    this.item.name = "Cursor IME HUD";
  }

  public render(input: StatusBarRenderInput): void {
    if (!input.enabled) {
      this.item.hide();
      return;
    }

    this.item.text = `IME: ${input.label}`;
    this.item.tooltip = this.buildTooltip(input);
    this.item.show();
  }

  public dispose(): void {
    this.item.dispose();
  }

  private buildTooltip(input: StatusBarRenderInput): string {
    const lines = [
      `Cursor IME HUD`,
      `Displayed state: ${input.label}`,
      `Detected state: ${input.detectedState}`,
      `Source: ${input.source}`
    ];

    if (input.imeName) {
      lines.push(`IME: ${input.imeName}`);
    }

    if (input.isFallback) {
      lines.push("Running in fallback mode.");
    }

    if (input.displayReason === "grace-period") {
      lines.push("Displaying the last stable state during the short unknown grace window.");
    } else if (input.displayReason === "unknown") {
      lines.push("The current IME state is unknown, so the overlay is hidden.");
    }

    if (input.reason) {
      lines.push(`Reason: ${input.reason}`);
    }

    if (typeof input.confidence === "number") {
      lines.push(`Confidence: ${input.confidence.toFixed(2)}`);
    }

    lines.push("Run 'Cursor IME HUD: Show Diagnostics' for details.");
    return lines.join("\n");
  }
}
