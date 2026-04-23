import * as vscode from "vscode";
import { CursorImeHudSettings } from "../model/types";
import { OverlayPlacement, PositionStrategy } from "./PositionStrategy";

export interface OverlayRenderInput {
  editor: vscode.TextEditor;
  label: string;
  settings: CursorImeHudSettings;
  placement: OverlayPlacement;
}

export interface OverlayRenderer extends vscode.Disposable {
  getStyleKey(settings: CursorImeHudSettings): string;
  resolvePlacement(editor: vscode.TextEditor): OverlayPlacement | undefined;
  render(input: OverlayRenderInput): void;
  clearCurrentRender(): void;
}

export class CursorOverlayRenderer implements OverlayRenderer {
  private beforeDecorationType?: vscode.TextEditorDecorationType;
  private afterDecorationType?: vscode.TextEditorDecorationType;
  private styleCacheKey = "";
  private currentRender?: {
    editorUri: string;
    attachment: "before" | "after";
  };

  public constructor(private readonly positionStrategy: PositionStrategy) {}

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

    if (
      this.currentRender &&
      (this.currentRender.editorUri !== editorUri || this.currentRender.attachment !== input.placement.attachment)
    ) {
      this.clearCurrentRender();
    }

    const option = this.createDecorationOption(input.placement, input.label);
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
    if (!this.currentRender) {
      return;
    }

    const targetEditor = vscode.window.visibleTextEditors.find(
      (editor) => editor.document.uri.toString() === this.currentRender?.editorUri
    );
    if (targetEditor) {
      this.clearEditor(targetEditor);
    }

    this.currentRender = undefined;
  }

  public dispose(): void {
    this.clearCurrentRender();
    this.beforeDecorationType?.dispose();
    this.afterDecorationType?.dispose();
  }

  private ensureDecorationTypes(settings: CursorImeHudSettings): void {
    const nextCacheKey = this.getStyleKey(settings);

    if (nextCacheKey === this.styleCacheKey && this.beforeDecorationType && this.afterDecorationType) {
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

  private createDecorationOption(placement: OverlayPlacement, label: string): vscode.DecorationOptions {
    if (placement.attachment === "before") {
      return {
        range: placement.range,
        renderOptions: {
          before: {
            contentText: label
          }
        }
      };
    }

    return {
      range: placement.range,
      renderOptions: {
        after: {
          contentText: label
        }
      }
    };
  }
}
