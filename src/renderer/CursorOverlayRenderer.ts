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
      enColor: settings.enColor
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

    const topMargin = settings.offsetY;

    // No background pill: the label is rendered as bare text. `opacity` now
    // applies to the text itself, and `position: absolute` keeps the chip out
    // of the inline text flow so characters after the caret are not shifted.
    const sharedAttachmentStyles: vscode.ThemableDecorationAttachmentRenderOptions = {
      color: "#F7FAFC",
      fontWeight: "600",
      textDecoration: `none; font-size: 0.85em; position: absolute; z-index: 20; pointer-events: none; white-space: nowrap; opacity: ${settings.opacity.toFixed(2)};`
    };

    this.beforeDecorationType = vscode.window.createTextEditorDecorationType({
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      before: {
        ...sharedAttachmentStyles,
        margin: `${topMargin}px ${settings.offsetX}px 0 0`
      }
    });

    this.afterDecorationType = vscode.window.createTextEditorDecorationType({
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      after: {
        ...sharedAttachmentStyles,
        margin: `${topMargin}px 0 0 ${settings.offsetX}px`
      }
    });

    this.styleCacheKey = nextCacheKey;
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
