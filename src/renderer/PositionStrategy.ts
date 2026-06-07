import * as vscode from "vscode";

/**
 * Where a decoration should be attached and which character range it
 * covers. The renderer treats `attachment === "before"` as "decorate the
 * character at the start of `range`" and `attachment === "after"` as
 * "decorate the character at the end of `range`".
 */
export interface OverlayPlacement {
  /** Document range the decoration is anchored to. */
  range: vscode.Range;
  /** Side of the range the decoration renders on. */
  attachment: "before" | "after";
}

/**
 * Decides where the HUD chip should appear relative to the cursor.
 *
 * The strategy supports empty lines by anchoring the decoration to a
 * zero-width range at the caret. For non-empty lines it anchors to the
 * nearest real character so the chip remains visually tied to typed text.
 */
export class PositionStrategy {
  /**
   * Resolve a placement. The semantics of the return value:
   *   - an `after` placement with a zero-width range is used on empty
   *     lines so the chip appears to the right of the caret.
   *   - a `before` placement is used when the cursor is at the start of
   *     a non-empty line so the chip appears in front of the next character.
   *   - an `after` placement is used anywhere else on a non-empty line
   *     and is anchored to the character immediately preceding the cursor
   *     (mirrors the way the original HUD behaved).
   */
  public resolve(
    document: vscode.TextDocument,
    cursor: vscode.Position
  ): OverlayPlacement | undefined {
    const line = document.lineAt(cursor.line);

    if (line.text.length === 0) {
      return {
        range: new vscode.Range(cursor, cursor),
        attachment: "after"
      };
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
