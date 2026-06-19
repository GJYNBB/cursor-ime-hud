import * as vscode from "vscode";
import { CursorImeHudSettings, ImeState, LabelPreset } from "../model/types";

/**
 * Wraps `vscode.workspace.getConfiguration` for the
 * `cursorImeHud` configuration section. The class validates every read
 * and falls back to a safe default if a value is missing or the wrong
 * type, so the HUD always has a usable settings object.
 *
 * Emits `onDidChange` whenever the user changes a value through the
 * settings UI so the controller can re-render.
 */
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

    const labelPreset = this.asLabelPreset(overlay.labelPreset);
    const labels = this.resolveLabels(overlay, labelPreset);

    return {
      overlayEnabled: this.asBoolean(overlay.enabled, true),
      labelPreset,
      cnLabel: labels.cnLabel,
      enLabel: labels.enLabel,
      opacity: this.clampNumber(overlay.opacity, 0.78, 0.15, 1),
      overlayMode: overlay.mode === "text+icon" ? "text+icon" : "text",
      statusBarEnabled: this.asBoolean(statusBar.enabled, true),
      hideWhenEditorUnfocused: this.asBoolean(overlay.hideWhenEditorUnfocused, true),
      offsetX: this.clampNumber(overlay.offsetX, 6, 0, 32),
      offsetY: this.clampNumber(overlay.offsetY, 20, -16, 30)
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

  private asLabelPreset(value: unknown): LabelPreset {
    return value === "zh-en" || value === "en-zh" ? value : "custom";
  }

  private resolveLabels(
    overlay: Record<string, unknown>,
    labelPreset: LabelPreset
  ): Pick<CursorImeHudSettings, "cnLabel" | "enLabel"> {
    if (labelPreset === "zh-en") {
      return { cnLabel: "中", enLabel: "英" };
    }

    if (labelPreset === "en-zh") {
      return { cnLabel: "ZH", enLabel: "EN" };
    }

    return {
      cnLabel: this.asNonEmptyString(overlay.cnLabel, "中"),
      enLabel: this.asNonEmptyString(overlay.enLabel, "英")
    };
  }

  /**
   * Coerce a configuration value into a non-empty string. Empty / whitespace
   * strings and non-string values both fall back to the default so the HUD
   * never has to render an empty chip.
   */
  private asNonEmptyString(value: unknown, fallback: string): string {
    return typeof value === "string" && value.trim().length > 0 ? value : fallback;
  }

  /**
   * Clamp a numeric configuration value into `[minimum, maximum]`. Non-number
   * values (including `NaN`) fall back to `fallback`, which is also clamped
   * to the same range so a misconfigured default cannot break the renderer.
   */
  private clampNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return fallback;
    }

    return Math.min(maximum, Math.max(minimum, value));
  }
}
