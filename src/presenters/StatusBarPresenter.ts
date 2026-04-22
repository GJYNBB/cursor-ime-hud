import * as vscode from "vscode";

interface StatusBarRenderInput {
  enabled: boolean;
  label: string;
  imeName?: string;
  source: string;
  isFallback: boolean;
}

export class StatusBarPresenter implements vscode.Disposable {
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
      `State: ${input.label}`,
      `Source: ${input.source}`
    ];

    if (input.imeName) {
      lines.push(`IME: ${input.imeName}`);
    }

    if (input.isFallback) {
      lines.push("Running in fallback mode.");
    }

    lines.push("Run 'Cursor IME HUD: Show Diagnostics' for details.");
    return lines.join("\n");
  }
}
