import * as vscode from "vscode";
import { CursorImeHudSettings, ImeState } from "../model/types";
import { OverlayPlacement, PositionStrategy } from "./PositionStrategy";
import {
  ContentProvider,
  OverlayContent,
  OverlayRenderInput,
  OverlayRenderer,
  TextContentProvider
} from "./contracts";

const DEFAULT_EDITOR_FONT_SIZE_PX = 14;
const HUD_FONT_SCALE = 0.85;
const ICON_TILE_SIZE_EM = 1.34;
const ICON_TILE_HORIZONTAL_PADDING_EM = 0.16;
const ICON_TILE_RADIUS_EM = 0.26;

// Re-export so existing imports of `OverlayRenderer` from this module
// continue to work after the interface was lifted to `./contracts`.
export type { OverlayRenderer } from "./contracts";

/**
 * Default concrete `OverlayRenderer` used by the HUD. Maintains two
 * `TextEditorDecorationType` instances (one for `before` and one for `after`
 * attachment) and a small cache that maps the visual style to the
 * decoration types so it can rebuild them only when the user changes the
 * opacity / offset / overlay mode settings.
 *
 * The class also tracks every editor that has ever been rendered into and
 * clears them all on `clearCurrentRender` so an editor that has since left
 * `vscode.window.visibleTextEditors` does not leak its decoration.
 */
export class CursorOverlayRenderer implements OverlayRenderer {
  private beforeDecorationType?: vscode.TextEditorDecorationType;
  private afterDecorationType?: vscode.TextEditorDecorationType;
  /**
   * Cache key for the currently-allocated decoration types. Re-computed via
   * `getStyleKey`; when it changes the decoration types are rebuilt so the
   * new style takes effect on the very next `render` call.
   */
  private styleCacheKey = "";
  private currentRender?: {
    editor: vscode.TextEditor;
    attachment: "before" | "after";
  };
  /**
   * Editors we have ever rendered into. We keep this around so
   * `clearCurrentRender` can scrub decorations from editors that are no
   * longer in `vscode.window.visibleTextEditors` (e.g. closed editors) or
   * from split editors that share the same document URI.
   */
  private readonly recentlyRenderedEditors = new Set<vscode.TextEditor>();
  private readonly contentProvider: ContentProvider;

  public constructor(
    private readonly positionStrategy: PositionStrategy,
    contentProvider?: ContentProvider
  ) {
    this.contentProvider = contentProvider ?? new TextContentProvider();
  }

  public getStyleKey(settings: CursorImeHudSettings): string {
    return JSON.stringify({
      opacity: settings.opacity,
      offsetX: settings.offsetX,
      offsetY: settings.offsetY,
      overlayMode: settings.overlayMode,
      cnColor: settings.cnColor,
      enColor: settings.enColor,
      backgroundEnabled: settings.backgroundEnabled,
      backgroundOpacity: settings.backgroundOpacity
    });
  }

  public resolvePlacement(editor: vscode.TextEditor): OverlayPlacement | undefined {
    return this.positionStrategy.resolve(editor.document, editor.selection.active);
  }

  public render(input: OverlayRenderInput): void {
    this.ensureDecorationTypes(input.settings);
    if (
      this.currentRender &&
      (this.currentRender.editor !== input.editor ||
        this.currentRender.attachment !== input.placement.attachment)
    ) {
      this.clearCurrentRender();
    }

    // Remember this editor after any cross-editor/attachment cleanup so a
    // later `clearCurrentRender` can still scrub it if it has left
    // `visibleTextEditors` by then.
    this.recentlyRenderedEditors.add(input.editor);

    const content = this.contentProvider.resolveContent(input, input.label);
    const stateColor = this.resolveColor(input.settings, input.state);
    const option = this.createDecorationOption(
      input.placement,
      content,
      input.settings,
      stateColor
    );
    if (input.placement.attachment === "before") {
      input.editor.setDecorations(this.beforeDecorationType!, [option]);
      input.editor.setDecorations(this.afterDecorationType!, []);
    } else {
      input.editor.setDecorations(this.beforeDecorationType!, []);
      input.editor.setDecorations(this.afterDecorationType!, [option]);
    }

    this.currentRender = {
      editor: input.editor,
      attachment: input.placement.attachment
    };
  }

  public clearEditor(editor: vscode.TextEditor): void {
    if (this.beforeDecorationType) {
      editor.setDecorations(this.beforeDecorationType, []);
    }

    if (this.afterDecorationType) {
      editor.setDecorations(this.afterDecorationType, []);
    }
  }

  public clearCurrentRender(): void {
    // Scrub the current editor and every editor we have ever rendered into,
    // so decoration types are not leaked onto editors that left the visible
    // set or onto same-document split editors.
    if (this.currentRender) {
      this.clearEditor(this.currentRender.editor);
    }

    for (const editor of this.recentlyRenderedEditors.values()) {
      this.clearEditor(editor);
    }
    this.recentlyRenderedEditors.clear();

    this.currentRender = undefined;
  }

  public dispose(): void {
    this.clearCurrentRender();
    this.beforeDecorationType?.dispose();
    this.afterDecorationType?.dispose();
  }

  private ensureDecorationTypes(settings: CursorImeHudSettings): void {
    const nextCacheKey = this.getStyleKey(settings);

    if (
      nextCacheKey === this.styleCacheKey &&
      this.beforeDecorationType &&
      this.afterDecorationType
    ) {
      return;
    }

    this.beforeDecorationType?.dispose();
    this.afterDecorationType?.dispose();

    const offsetX = this.toHudEm(settings.offsetX);
    const offsetY = this.toHudEm(settings.offsetY);

    const sharedAttachmentStyles = this.buildAttachmentStyles(settings, offsetX, offsetY);

    this.beforeDecorationType = vscode.window.createTextEditorDecorationType({
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      before: sharedAttachmentStyles
    });

    this.afterDecorationType = vscode.window.createTextEditorDecorationType({
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      after: sharedAttachmentStyles
    });

    this.styleCacheKey = nextCacheKey;
  }

  private buildAttachmentStyles(
    settings: CursorImeHudSettings,
    offsetX: string,
    offsetY: string
  ): vscode.ThemableDecorationAttachmentRenderOptions {
    if (settings.overlayMode === "text+icon") {
      return {
        color: "#F7FAFC",
        fontWeight: "700",
        textDecoration: `none; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; min-width: ${ICON_TILE_SIZE_EM}em; height: ${ICON_TILE_SIZE_EM}em; padding: 0 ${ICON_TILE_HORIZONTAL_PADDING_EM}em; border-radius: ${ICON_TILE_RADIUS_EM}em; font-size: ${HUD_FONT_SCALE}em; line-height: 1; position: absolute; z-index: 20; pointer-events: none; white-space: nowrap; opacity: ${settings.opacity.toFixed(2)}; transform: translate(${offsetX}, ${offsetY}); text-shadow: 0 0 0.18em rgba(255, 255, 255, 0.38); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.10);`
      };
    }

    return {
      color: "#F7FAFC",
      fontWeight: "600",
      textDecoration: `none; font-size: ${HUD_FONT_SCALE}em; line-height: 1; position: absolute; z-index: 20; pointer-events: none; white-space: nowrap; opacity: ${settings.opacity.toFixed(2)}; transform: translate(${offsetX}, ${offsetY});${settings.backgroundEnabled ? " padding: 0 2px; border-radius: 3px;" : ""}`,
      ...(settings.backgroundEnabled
        ? {
            backgroundColor: `rgba(17, 24, 39, ${settings.backgroundOpacity.toFixed(2)})`,
            border: "1px solid rgba(255, 255, 255, 0.16)"
          }
        : {})
    };
  }

  private toHudEm(offsetPxAtDefaultZoom: number): string {
    const offsetEm = offsetPxAtDefaultZoom / (DEFAULT_EDITOR_FONT_SIZE_PX * HUD_FONT_SCALE);
    return `${offsetEm.toFixed(4)}em`;
  }

  /**
   * Resolve the label color for the given IME state. Returns `undefined`
   * for states without a dedicated color (e.g. `unknown`) so the decoration
   * type's neutral default color is used instead.
   */
  private resolveColor(settings: CursorImeHudSettings, state: ImeState): string | undefined {
    if (state === "cn") {
      return settings.cnColor;
    }

    if (state === "en") {
      return settings.enColor;
    }

    return undefined;
  }

  private iconTileColors(
    settings: CursorImeHudSettings,
    stateColor?: string
  ): vscode.ThemableDecorationAttachmentRenderOptions {
    const color = stateColor ?? "#F7FAFC";
    const rgb = this.cssColorToRgb(color);
    const backgroundOpacity = settings.backgroundOpacity.toFixed(2);
    const backgroundPercent = `${Math.round(settings.backgroundOpacity * 100)}%`;

    return {
      color: "#F7FAFC",
      backgroundColor: rgb
        ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${backgroundOpacity})`
        : `color-mix(in srgb, ${color} ${backgroundPercent}, transparent)`,
      border: rgb
        ? `1px solid rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.62)`
        : `1px solid color-mix(in srgb, ${color} 62%, transparent)`
    };
  }

  private cssColorToRgb(color: string): { r: number; g: number; b: number } | undefined {
    const short = /^#([0-9a-fA-F]{3})([0-9a-fA-F]?)$/.exec(color);
    if (short) {
      const [r, g, b] = short[1].split("").map((part) => parseInt(part + part, 16));
      return { r, g, b };
    }

    const long = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(color);
    if (long) {
      return {
        r: parseInt(long[1].slice(0, 2), 16),
        g: parseInt(long[1].slice(2, 4), 16),
        b: parseInt(long[1].slice(4, 6), 16)
      };
    }

    const rgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+[\d.]+)?\s*\)$/i.exec(
      color
    );
    if (!rgb) {
      return undefined;
    }

    const [r, g, b] = rgb.slice(1, 4).map((part) => Math.min(255, Number(part)));
    return { r, g, b };
  }

  private createDecorationOption(
    placement: OverlayPlacement,
    content: OverlayContent,
    settings: CursorImeHudSettings,
    stateColor?: string
  ): vscode.DecorationOptions {
    const attachment: vscode.ThemableDecorationAttachmentRenderOptions = {
      contentText: content.contentText,
      ...(settings.overlayMode === "text+icon"
        ? this.iconTileColors(settings, stateColor)
        : stateColor
          ? { color: stateColor }
          : {})
    };

    if (placement.attachment === "before") {
      return {
        range: placement.range,
        renderOptions: { before: attachment },
        hoverMessage: content.hoverMessage
      };
    }

    return {
      range: placement.range,
      renderOptions: { after: attachment },
      hoverMessage: content.hoverMessage
    };
  }
}
