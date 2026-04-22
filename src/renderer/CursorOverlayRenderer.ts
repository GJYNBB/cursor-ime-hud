import * as vscode from "vscode";
import { CursorImeHudSettings } from "../model/types";
import { OverlayPlacement, PositionStrategy } from "./PositionStrategy";

interface OverlayRenderInput {
  editor: vscode.TextEditor;
  label: string;
  settings: CursorImeHudSettings;
}

export class CursorOverlayRenderer implements vscode.Disposable {
  private beforeDecorationType?: vscode.TextEditorDecorationType;
  private afterDecorationType?: vscode.TextEditorDecorationType;
  private styleCacheKey = "";

  public constructor(private readonly positionStrategy: PositionStrategy) {}

  public render(input: OverlayRenderInput): void {
    this.ensureDecorationTypes(input.settings);

    const placement = this.positionStrategy.resolve(input.editor.document, input.editor.selection.active);
    if (!placement) {
      this.clearEditor(input.editor);
      return;
    }

    const option = this.createDecorationOption(placement, input.label);
    if (placement.attachment === "before") {
      input.editor.setDecorations(this.beforeDecorationType!, [option]);
      input.editor.setDecorations(this.afterDecorationType!, []);
      return;
    }

    input.editor.setDecorations(this.beforeDecorationType!, []);
    input.editor.setDecorations(this.afterDecorationType!, [option]);
  }

  public clearEditor(editor: vscode.TextEditor): void {
    if (this.beforeDecorationType) {
      editor.setDecorations(this.beforeDecorationType, []);
    }

    if (this.afterDecorationType) {
      editor.setDecorations(this.afterDecorationType, []);
    }
  }

  public clearVisibleEditors(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.clearEditor(editor);
    }
  }

  public dispose(): void {
    this.beforeDecorationType?.dispose();
    this.afterDecorationType?.dispose();
  }

  private ensureDecorationTypes(settings: CursorImeHudSettings): void {
    const nextCacheKey = JSON.stringify({
      opacity: settings.opacity,
      offsetX: settings.offsetX,
      offsetY: settings.offsetY,
      overlayMode: settings.overlayMode
    });

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
