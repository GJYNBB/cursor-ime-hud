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
 * The strategy tries to be smart about empty lines: it will not produce a
 * placement for a line with no text because there is nothing to anchor
 * the decoration to (and a before/after decoration on a non-existent
 * character is undefined behaviour in VS Code). Callers should treat
 * `undefined` as "hide the overlay" and not as an error.
 */
export class PositionStrategy {
  /**
   * Resolve a placement. The semantics of the return value:
   *   - `undefined` means "there is no sensible place to render" (empty
   *     line) and the caller should hide the overlay for this frame.
   *   - a `before` placement is used when the cursor is at the start of
   *     the line so the chip appears in front of the next character.
   *   - an `after` placement is used when the cursor is anywhere else
   *     and the chip is anchored to the character immediately preceding
   *     the cursor (mirrors the way the original HUD behaved).
   */
  public resolve(
    document: vscode.TextDocument,
    cursor: vscode.Position
  ): OverlayPlacement | undefined {
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
