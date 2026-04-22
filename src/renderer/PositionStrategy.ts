import * as vscode from "vscode";

export interface OverlayPlacement {
  range: vscode.Range;
  attachment: "before" | "after";
}

export class PositionStrategy {
  public resolve(document: vscode.TextDocument, cursor: vscode.Position): OverlayPlacement | undefined {
    const line = document.lineAt(cursor.line);

    if (line.text.length === 0) {
      return undefined;
    }

    if (cursor.character <= 0) {
      const endCharacter = Math.min(1, line.text.length);
      return {
        range: new vscode.Range(cursor.line, 0, cursor.line, endCharacter),
        attachment: "before"
      };
    }

    const anchorCharacter = Math.min(cursor.character - 1, line.text.length - 1);
    return {
      range: new vscode.Range(cursor.line, anchorCharacter, cursor.line, anchorCharacter + 1),
      attachment: "after"
    };
  }
}
