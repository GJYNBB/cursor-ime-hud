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
    editorUri: string;
    attachment: "before" | "after";
  };
  /**
   * Editors we have ever rendered into, keyed by document URI. We keep this
   * around so `clearCurrentRender` can scrub decorations from editors that
   * are no longer in `vscode.window.visibleTextEditors` (e.g. closed
   * editors) without leaking ghost decorations.
   */
  private readonly recentlyRenderedEditors = new Map<string, vscode.TextEditor>();
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
    const editorUri = input.editor.document.uri.toString();
    // Remember this editor so a later `clearCurrentRender` can scrub it
    // even if the editor is no longer in `visibleTextEditors` at that
    // moment (fixes CC-002 decoration leaks on closed editors).
    this.recentlyRenderedEditors.set(editorUri, input.editor);

    if (
      this.currentRender &&
      (this.currentRender.editorUri !== editorUri ||
        this.currentRender.attachment !== input.placement.attachment)
    ) {
      this.clearCurrentRender();
    }

    const content = this.contentProvider.resolveContent(input, input.label);
    const color = this.resolveColor(input.settings, input.state);
    const option = this.createDecorationOption(input.placement, content, color);
    if (input.placement.attachment === "before") {
      input.editor.setDecorations(this.beforeDecorationType!, [option]);
      input.editor.setDecorations(this.afterDecorationType!, []);
    } else {
      input.editor.setDecorations(this.beforeDecorationType!, []);
      input.editor.setDecorations(this.afterDecorationType!, [option]);
    }

    this.currentRender = {
      editorUri,
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
    // Scrub the current editor first (if it is still in
    // `visibleTextEditors`) and then every editor we have ever rendered
    // into, so decoration types are not leaked onto editors that left the
    // visible set.
    if (this.currentRender) {
      const targetEditor = vscode.window.visibleTextEditors.find(
        (editor) => editor.document.uri.toString() === this.currentRender?.editorUri
      );
      if (targetEditor) {
        this.clearEditor(targetEditor);
      }
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

    const sharedAttachmentStyles: vscode.ThemableDecorationAttachmentRenderOptions = {
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

  private toHudEm(offsetPxAtDefaultZoom: number): string {
    const offsetEm = offsetPxAtDefaultZoom / (DEFAULT_EDITOR_FONT_SIZE_PX * HUD_FONT_SCALE);
    return `${offsetEm.toFixed(4)}em`;
  }

  /**
   * Resolve the label color for the given IME state. Returns `undefined`
   * for states without a dedicated color (e.g. `unknown`) so the decoration
   * type's neutral default color is used instead.
   */
  private resolveColor(settings: CursorImeHudSettings, state?: ImeState): string | undefined {
    if (state === "cn") {
      return settings.cnColor;
    }

    if (state === "en") {
      return settings.enColor;
    }

    return undefined;
  }

  private createDecorationOption(
    placement: OverlayPlacement,
    content: OverlayContent,
    color?: string
  ): vscode.DecorationOptions {
    const attachment: vscode.ThemableDecorationAttachmentRenderOptions = {
      contentText: content.contentText,
      ...(color ? { color } : {})
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
