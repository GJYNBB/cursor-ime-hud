import * as vscode from "vscode";
import { CursorImeHudSettings } from "../model/types";
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
      overlayMode: settings.overlayMode
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
    const option = this.createDecorationOption(input.placement, content);
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

    const backgroundColor = `rgba(28, 32, 38, ${settings.opacity.toFixed(2)})`;
    const borderColor = `rgba(255, 255, 255, ${(settings.opacity * 0.3).toFixed(2)})`;
    const topMargin = settings.offsetY;

    const sharedAttachmentStyles: vscode.ThemableDecorationAttachmentRenderOptions = {
      color: "#F7FAFC",
      backgroundColor,
      border: `1px solid ${borderColor}`,
      fontWeight: "600",
      textDecoration: "none; font-size: 0.85em; border-radius: 999px;"
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

  private createDecorationOption(
    placement: OverlayPlacement,
    content: OverlayContent
  ): vscode.DecorationOptions {
    if (placement.attachment === "before") {
      return {
        range: placement.range,
        renderOptions: {
          before: {
            contentText: content.contentText
          }
        },
        hoverMessage: content.hoverMessage
      };
    }

    return {
      range: placement.range,
      renderOptions: {
        after: {
          contentText: content.contentText
        }
      },
      hoverMessage: content.hoverMessage
    };
  }
}
