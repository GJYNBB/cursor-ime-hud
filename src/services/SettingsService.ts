import * as vscode from "vscode";
import { CursorImeHudSettings, ImeState, LabelPreset } from "../model/types";
import { SettingsConfigKey } from "../controller/ports";

const CSS_COLOR_KEYWORDS = new Set([
  "aliceblue",
  "antiquewhite",
  "aqua",
  "aquamarine",
  "azure",
  "beige",
  "bisque",
  "black",
  "blanchedalmond",
  "blue",
  "blueviolet",
  "brown",
  "burlywood",
  "cadetblue",
  "chartreuse",
  "chocolate",
  "coral",
  "cornflowerblue",
  "cornsilk",
  "crimson",
  "cyan",
  "darkblue",
  "darkcyan",
  "darkgoldenrod",
  "darkgray",
  "darkgreen",
  "darkgrey",
  "darkkhaki",
  "darkmagenta",
  "darkolivegreen",
  "darkorange",
  "darkorchid",
  "darkred",
  "darksalmon",
  "darkseagreen",
  "darkslateblue",
  "darkslategray",
  "darkslategrey",
  "darkturquoise",
  "darkviolet",
  "deeppink",
  "deepskyblue",
  "dimgray",
  "dimgrey",
  "dodgerblue",
  "firebrick",
  "floralwhite",
  "forestgreen",
  "fuchsia",
  "gainsboro",
  "ghostwhite",
  "gold",
  "goldenrod",
  "gray",
  "green",
  "greenyellow",
  "grey",
  "honeydew",
  "hotpink",
  "indianred",
  "indigo",
  "ivory",
  "khaki",
  "lavender",
  "lavenderblush",
  "lawngreen",
  "lemonchiffon",
  "lightblue",
  "lightcoral",
  "lightcyan",
  "lightgoldenrodyellow",
  "lightgray",
  "lightgreen",
  "lightgrey",
  "lightpink",
  "lightsalmon",
  "lightseagreen",
  "lightskyblue",
  "lightslategray",
  "lightslategrey",
  "lightsteelblue",
  "lightyellow",
  "lime",
  "limegreen",
  "linen",
  "magenta",
  "maroon",
  "mediumaquamarine",
  "mediumblue",
  "mediumorchid",
  "mediumpurple",
  "mediumseagreen",
  "mediumslateblue",
  "mediumspringgreen",
  "mediumturquoise",
  "mediumvioletred",
  "midnightblue",
  "mintcream",
  "mistyrose",
  "moccasin",
  "navajowhite",
  "navy",
  "oldlace",
  "olive",
  "olivedrab",
  "orange",
  "orangered",
  "orchid",
  "palegoldenrod",
  "palegreen",
  "paleturquoise",
  "palevioletred",
  "papayawhip",
  "peachpuff",
  "peru",
  "pink",
  "plum",
  "powderblue",
  "purple",
  "rebeccapurple",
  "red",
  "rosybrown",
  "royalblue",
  "saddlebrown",
  "salmon",
  "sandybrown",
  "seagreen",
  "seashell",
  "sienna",
  "silver",
  "skyblue",
  "slateblue",
  "slategray",
  "slategrey",
  "snow",
  "springgreen",
  "steelblue",
  "tan",
  "teal",
  "thistle",
  "tomato",
  "transparent",
  "turquoise",
  "violet",
  "wheat",
  "white",
  "whitesmoke",
  "yellow",
  "yellowgreen"
]);

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
  /** Applied until the configuration write is observed. */
  private optimisticOverlayEnabled?: boolean;

  public readonly onDidChange = this.onDidChangeEmitter.event;

  public constructor() {
    this.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(this.configurationSection)) {
          this.optimisticOverlayEnabled = undefined;
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
    const labels = this.resolveLabels(labelPreset);

    return {
      overlayEnabled: this.optimisticOverlayEnabled ?? this.asBoolean(overlay.enabled, true),
      labelPreset,
      cnLabel: labels.cnLabel,
      enLabel: labels.enLabel,
      cnColor: this.asColor(overlay.cnColor, "#FF5252"),
      enColor: this.asColor(overlay.enColor, "#1E90FF"),
      backgroundEnabled: this.asBoolean(overlay.backgroundEnabled, true),
      backgroundOpacity: this.clampNumber(overlay.backgroundOpacity, 0.72, 0, 1),
      opacity: this.clampNumber(overlay.opacity, 0.78, 0.15, 1),
      overlayMode: overlay.mode === "text" ? "text" : "text+icon",
      statusBarEnabled: this.asBoolean(statusBar.enabled, true),
      hideWhenEditorUnfocused: this.asBoolean(overlay.hideWhenEditorUnfocused, true),
      offsetX: this.clampNumber(overlay.offsetX, 6, -50, 50),
      offsetY: this.clampNumber(overlay.offsetY, 20, -50, 50)
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
    const currentValue =
      this.optimisticOverlayEnabled ?? configuration.get<boolean>("overlay.enabled", true);
    const nextValue = !currentValue;
    // Optimistic so getSettings() / status bar flip before the config write settles.
    this.optimisticOverlayEnabled = nextValue;
    this.onDidChangeEmitter.fire(this.getSettings());
    await configuration.update("overlay.enabled", nextValue, vscode.ConfigurationTarget.Global);
  }

  public async updateSetting(
    key: SettingsConfigKey,
    value: boolean | number | string
  ): Promise<void> {
    const configuration = vscode.workspace.getConfiguration(this.configurationSection);
    await configuration.update(key, value, vscode.ConfigurationTarget.Global);
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
    return value === "en-zh" ? "en-zh" : "zh-en";
  }

  private resolveLabels(
    labelPreset: LabelPreset
  ): Pick<CursorImeHudSettings, "cnLabel" | "enLabel"> {
    if (labelPreset === "en-zh") {
      return { cnLabel: "ZH", enLabel: "EN" };
    }

    return { cnLabel: "中", enLabel: "英" };
  }

  /**
   * Validate a user-supplied CSS color before it is injected into the
   * decoration's `color` style. Only hex (`#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`),
   * `rgb()/rgba()/hsl()/hsla()` functions, and bare color keywords are
   * accepted; anything containing CSS-breaking characters (`;`, `{`, `}`,
   * quotes, …) falls back to the default so a malformed value cannot corrupt
   * or escape the inline style.
   */
  private asColor(value: unknown, fallback: string): string {
    if (typeof value !== "string") {
      return fallback;
    }

    const trimmed = value.trim();
    const hex = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
    const func = /^(?:rgb|rgba|hsl|hsla)\([0-9.,%\s/]+\)$/i;
    const keyword = /^[a-zA-Z]+$/;

    if (
      hex.test(trimmed) ||
      func.test(trimmed) ||
      (keyword.test(trimmed) && CSS_COLOR_KEYWORDS.has(trimmed.toLowerCase()))
    ) {
      return trimmed;
    }

    return fallback;
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
