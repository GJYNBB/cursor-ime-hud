import * as vscode from "vscode";
import { CursorImeHudSettings, ImeState } from "../model/types";

export class SettingsService implements vscode.Disposable {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<CursorImeHudSettings>();
  private readonly configurationSection = "cursorImeHud";
  private readonly subscriptions: vscode.Disposable[] = [];

  public readonly onDidChange = this.onDidChangeEmitter.event;

  public constructor() {
    this.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(this.configurationSection)) {
          this.onDidChangeEmitter.fire(this.getSettings());
        }
      })
    );
  }

  public getSettings(): CursorImeHudSettings {
    const configuration = vscode.workspace.getConfiguration(this.configurationSection);
    const overlay = configuration.get<Record<string, unknown>>("overlay", {});
    const statusBar = configuration.get<Record<string, unknown>>("statusBar", {});

    return {
      overlayEnabled: this.asBoolean(overlay.enabled, true),
      cnLabel: this.asNonEmptyString(overlay.cnLabel, "\u4e2d"),
      enLabel: this.asNonEmptyString(overlay.enLabel, "\u82f1"),
      opacity: this.clampNumber(overlay.opacity, 0.78, 0.15, 1),
      overlayMode: overlay.mode === "text+icon" ? "text+icon" : "text",
      statusBarEnabled: this.asBoolean(statusBar.enabled, true),
      hideWhenEditorUnfocused: this.asBoolean(overlay.hideWhenEditorUnfocused, true),
      offsetX: this.clampNumber(overlay.offsetX, 6, 0, 32),
      offsetY: this.clampNumber(overlay.offsetY, 0, -16, 16)
    };
  }

  public getLabelForState(state: ImeState): string | undefined {
    const settings = this.getSettings();
    if (state === "cn") {
      return settings.cnLabel;
    }

    if (state === "en") {
      return settings.enLabel;
    }

    return undefined;
  }

  public async toggleOverlay(): Promise<void> {
    const configuration = vscode.workspace.getConfiguration(this.configurationSection);
    const currentValue = configuration.get<boolean>("overlay.enabled", true);
    await configuration.update("overlay.enabled", !currentValue, vscode.ConfigurationTarget.Global);
  }

  public dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }

    this.onDidChangeEmitter.dispose();
  }

  private asBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
  }

  private asNonEmptyString(value: unknown, fallback: string): string {
    return typeof value === "string" && value.trim().length > 0 ? value : fallback;
  }

  private clampNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return fallback;
    }

    return Math.min(maximum, Math.max(minimum, value));
  }
}
