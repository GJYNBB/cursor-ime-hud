import * as vscode from "vscode";

/**
 * Where a decoration should be attached and which character range it
 * covers. The renderer treats the range as a zero-width caret anchor and
 * paints the HUD attachment after that anchor.
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
 * The VS Code renderer paints the chip as an absolutely-positioned `after`
 * attachment so it does not participate in inline text layout. Keeping the
 * range zero-width and exactly at the caret mirrors the JetBrains HUD: the
 * chip follows the cursor itself instead of being attached to a neighboring
 * character, and characters after the cursor are not pushed to the right.
 */
export class PositionStrategy {
  /** Resolve a placement anchored at the active caret. */
  public resolve(
    _document: vscode.TextDocument,
    cursor: vscode.Position
  ): OverlayPlacement | undefined {
    return {
      range: new vscode.Range(cursor, cursor),
      attachment: "after"
    };
  }
}
