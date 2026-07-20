import * as assert from "node:assert";
import * as vscode from "vscode";
import { PositionStrategy } from "../../renderer/PositionStrategy";

suite("PositionStrategy", () => {
  const strategy = new PositionStrategy();

  async function assertCaretAnchor(content: string, cursor: vscode.Position): Promise<void> {
    const document = await vscode.workspace.openTextDocument({ content });
    const placement = strategy.resolve(document, cursor);

    assert.ok(placement);
    assert.equal(placement?.attachment, "after");
    assert.equal(placement?.range.start.line, cursor.line);
    assert.equal(placement?.range.start.character, cursor.character);
    assert.equal(placement?.range.end.line, cursor.line);
    assert.equal(placement?.range.end.character, cursor.character);
  }

  test("anchors to the caret at line start", async () => {
    await assertCaretAnchor("abc", new vscode.Position(0, 0));
  });

  test("anchors to the caret in the middle of a line", async () => {
    await assertCaretAnchor("abcd", new vscode.Position(0, 2));
  });

  test("anchors to the caret at line end", async () => {
    await assertCaretAnchor("abcd", new vscode.Position(0, 4));
  });

  test("anchors to the caret on empty lines", async () => {
    await assertCaretAnchor("\n", new vscode.Position(0, 0));
  });

  test("anchors to the caret on interior empty lines", async () => {
    await assertCaretAnchor("abc\n\nxyz", new vscode.Position(1, 0));
  });
});
